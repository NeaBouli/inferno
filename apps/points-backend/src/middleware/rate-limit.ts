import { isIP } from "node:net";
import { Request, Response, NextFunction } from "express";

interface RateBucket {
  count: number;
  resetAt: number;
}

/** Fixed-window counters, bounded in the number of tracked keys (oldest-first eviction). */
export class FixedWindowBuckets {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(private readonly maxKeys = 50_000) {}

  /** Counts a hit and returns true, or returns false when the key's window is full. */
  check(key: string, maxCount: number, windowMs: number, now = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.delete(key);
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      this.evict(now);
      return true;
    }
    if (bucket.count >= maxCount) return false;
    bucket.count++;
    return true;
  }

  /** Drops expired windows. */
  cleanup(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }

  private evict(now: number): void {
    if (this.buckets.size <= this.maxKeys) return;
    this.cleanup(now);
    // Still over the bound: drop the oldest windows first (Map keeps insertion order).
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= this.maxKeys) break;
      this.buckets.delete(key);
    }
  }
}

const buckets = new FixedWindowBuckets();

// Cleanup every 5 minutes
setInterval(() => buckets.cleanup(), 5 * 60 * 1000).unref();

// Production traffic reaches points-backend through Traefik on a private Docker network.
// Trust only loopback/link-local/private proxy hops so `req.ip` is the proxy-appended client hop;
// a client-supplied X-Forwarded-For entry can never become the rate-limit key.
export const TRUSTED_PROXY_HOPS = ["loopback", "linklocal", "uniquelocal"];

/** Client address for rate limiting; requires `app.set("trust proxy", TRUSTED_PROXY_HOPS)`. */
export function getClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/** Expands a validated IPv6 address (optionally with an embedded dotted IPv4 tail) to eight 16-bit groups. */
function ipv6Groups(addr: string): number[] {
  let text = addr;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((g) => parseInt(g, 16));
}

/**
 * Rate-limit key for a client address. IPv4 (including IPv4-mapped IPv6) is keyed by the single
 * address; IPv6 is keyed by its /64, the smallest prefix a single subscriber is routinely given,
 * so rotating addresses inside one /64 cannot mint fresh buckets. Non-IP values pass through.
 */
export function rateLimitKey(ip: string): string {
  const addr = ip.split("%")[0].toLowerCase();
  const family = isIP(addr);
  if (family === 4) return addr;
  if (family !== 6) return ip;
  const g = ipv6Groups(addr);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

function checkLimit(key: string, maxCount: number, windowMs: number): boolean {
  return buckets.check(key, maxCount, windowMs);
}

/** Max 60 requests per IP per minute */
export function generalRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = rateLimitKey(getClientIp(req));
  if (!checkLimit(`general:${ip}`, 60, 60_000)) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }
  next();
}

/** Max 5 SIWE verifies per IP per hour */
export function siweVerifyLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = rateLimitKey(getClientIp(req));
  if (!checkLimit(`siwe:${ip}`, 5, 3600_000)) {
    res.status(429).json({ error: "SIWE verify rate limit exceeded. Try again in 1 hour." });
    return;
  }
  next();
}

/** Max 30 SIWE nonces per client IP per 10 minutes */
export function siweNonceLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = rateLimitKey(getClientIp(req));
  if (!checkLimit(`nonce:${ip}`, 30, 10 * 60_000)) {
    res.status(429).json({ error: "Too many nonce requests. Try again later." });
    return;
  }
  next();
}
