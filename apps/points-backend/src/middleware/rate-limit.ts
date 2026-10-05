import { isIP } from "node:net";
import { Request, Response, NextFunction } from "express";

interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window counters, bounded in the number of tracked keys. At capacity, expired windows are
 * reclaimed first; a live window is never discarded to admit an unseen key, so such keys are
 * denied (fail-closed) until a window expires. Existing keys keep their windows and limits.
 */
export class FixedWindowBuckets {
  private readonly buckets = new Map<string, RateBucket>();
  // Lower bound on the earliest `resetAt` in the map: no window can be reclaimed before it.
  private nextExpiry = Infinity;

  constructor(private readonly maxKeys = 50_000) {}

  /** Counts a hit and returns true, or returns false when the key's window is full or the map is at capacity. */
  check(key: string, maxCount: number, windowMs: number, now = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now) {
      if (bucket.count >= maxCount) return false;
      bucket.count++;
      return true;
    }
    if (!bucket && this.buckets.size >= this.maxKeys) {
      if (now >= this.nextExpiry) this.cleanup(now);
      if (this.buckets.size >= this.maxKeys) return false;
    }
    this.buckets.set(key, { count: 1, resetAt: now + windowMs });
    this.nextExpiry = Math.min(this.nextExpiry, now + windowMs);
    return true;
  }

  /** Drops expired windows. */
  cleanup(now = Date.now()): void {
    let next = Infinity;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
      else next = Math.min(next, bucket.resetAt);
    }
    this.nextExpiry = next;
  }

  get size(): number {
    return this.buckets.size;
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

/**
 * Coarser IPv6 aggregation key for the SIWE nonce tier: the /48, the common site/customer
 * allocation, so an attacker holding a whole /48 (65,536 /64s) shares one budget. IPv4 (including
 * IPv4-mapped IPv6) and non-IP values return null: IPv4 stays keyed per address, because a /24 is
 * routinely shared by unrelated users (CGNAT/mobile/cloud pools) and single IPv4 addresses are
 * already scarce for an attacker.
 */
export function ipv6Prefix48Key(ip: string): string | null {
  const addr = ip.split("%")[0].toLowerCase();
  if (isIP(addr) !== 6) return null;
  const g = ipv6Groups(addr);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return null;
  return `${g.slice(0, 3).map((x) => x.toString(16)).join(":")}::/48`;
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

export const NONCE_WINDOW_MS = 10 * 60_000;
export const NONCE_PER_CLIENT = 30;
/**
 * Per-/48 nonce budget. Nonces live 5 minutes (< one window), so with fixed windows a /48 can hold
 * at most two windows' worth (boundary burst) = 500 outstanding nonces, i.e. at most 5% of the
 * global MAX_OUTSTANDING_NONCES (10,000) in routes/auth.ts.
 */
export const NONCE_PER_IPV6_48 = 250;

// Dedicated bounded map for the /48 tier, same fail-closed admission as the shared buckets.
const nonce48Buckets = new FixedWindowBuckets(20_000);
setInterval(() => nonce48Buckets.cleanup(), 5 * 60 * 1000).unref();

/**
 * SIWE nonce admission: max 30 per client key (IPv4 address or IPv6 /64) and, for IPv6, max 250
 * per /48 per 10 minutes. The /64 tier is checked first so an exhausted /64 cannot drain the
 * shared /48 budget of its neighbours.
 */
export function admitNonce(
  clientIp: string,
  now = Date.now(),
  clientBuckets: FixedWindowBuckets = buckets,
  prefixBuckets: FixedWindowBuckets = nonce48Buckets,
): boolean {
  if (!clientBuckets.check(`nonce:${rateLimitKey(clientIp)}`, NONCE_PER_CLIENT, NONCE_WINDOW_MS, now)) return false;
  const prefix = ipv6Prefix48Key(clientIp);
  return prefix === null || prefixBuckets.check(`nonce48:${prefix}`, NONCE_PER_IPV6_48, NONCE_WINDOW_MS, now);
}

/** Max 30 SIWE nonces per client key and 250 per IPv6 /48 per 10 minutes */
export function siweNonceLimit(req: Request, res: Response, next: NextFunction): void {
  if (!admitNonce(getClientIp(req))) {
    res.status(429).json({ error: "Too many nonce requests. Try again later." });
    return;
  }
  next();
}
