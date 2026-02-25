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

function getClientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
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

/** Max 1 voucher per wallet per day */
export function voucherWalletLimit(wallet: string): boolean {
  return checkLimit(`voucher:${wallet}`, 1, 86400_000);
}
