import { Request, Response, NextFunction } from "express";

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

function cleanupBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

// Cleanup every 5 minutes
setInterval(cleanupBuckets, 5 * 60 * 1000).unref();

// Production traffic reaches points-backend through Traefik on a private Docker network.
// Trust only loopback/link-local/private proxy hops so `req.ip` is the proxy-appended client hop;
// a client-supplied X-Forwarded-For entry can never become the rate-limit key.
export const TRUSTED_PROXY_HOPS = ["loopback", "linklocal", "uniquelocal"];

/** Client address for rate limiting; requires `app.set("trust proxy", TRUSTED_PROXY_HOPS)`. */
export function getClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function checkLimit(key: string, maxCount: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= maxCount) return false;
  bucket.count++;
  return true;
}

/** Max 60 requests per IP per minute */
export function generalRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);
  if (!checkLimit(`general:${ip}`, 60, 60_000)) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }
  next();
}

/** Max 5 SIWE verifies per IP per hour */
export function siweVerifyLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);
  if (!checkLimit(`siwe:${ip}`, 5, 3600_000)) {
    res.status(429).json({ error: "SIWE verify rate limit exceeded. Try again in 1 hour." });
    return;
  }
  next();
}

/** Max 30 SIWE nonces per client IP per 10 minutes */
export function siweNonceLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);
  if (!checkLimit(`nonce:${ip}`, 30, 10 * 60_000)) {
    res.status(429).json({ error: "Too many nonce requests. Try again later." });
    return;
  }
  next();
}
