import type { NextFunction, Request, Response } from "express";

// Production traffic reaches the copilot through Traefik on a private Docker network.
// Trust only loopback/link-local/private proxy hops so `req.ip` resolves to the first
// public hop that the proxy appended, never a client-supplied X-Forwarded-For entry.
export const TRUSTED_PROXY_HOPS = ["loopback", "linklocal", "uniquelocal"];

/** Client address for rate limiting; requires `app.set("trust proxy", TRUSTED_PROXY_HOPS)`. */
export function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

interface WindowLimit {
  windowMs: number;
  max: number;
}

/** Sliding-window limiter over one or more windows, bounded in the number of tracked keys. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly longestWindow: number;

  constructor(private readonly limits: WindowLimit[], private readonly maxKeys = 50_000) {
    if (limits.length === 0) throw new Error("at least one window is required");
    this.longestWindow = Math.max(...limits.map((l) => l.windowMs));
  }

  /** Records a hit and returns true, or returns false without recording when any window is full. */
  check(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.longestWindow);
    for (const { windowMs, max } of this.limits) {
      if (recent.filter((t) => now - t < windowMs).length >= max) {
        this.hits.set(key, recent);
        return false;
      }
    }
    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    this.evict(now);
    return true;
  }

  get size(): number {
    return this.hits.size;
  }

  private evict(now: number): void {
    if (this.hits.size <= this.maxKeys) return;
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.longestWindow)) this.hits.delete(key);
    }
    // Still over the bound: drop the least recently used keys (Map keeps insertion order).
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

/** Express middleware: per-client-IP limit with a JSON 429 response. */
export function ipRateLimit(limiter: SlidingWindowLimiter, message: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!limiter.check(clientIp(req))) {
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}

/**
 * TTL cache with single-flight loading and a bounded stale fallback.
 * Fresh entries are served directly; concurrent misses share one upstream call;
 * when the upstream fails, a stale entry younger than `staleMs` is served instead.
 */
export class SingleFlightCache<T> {
  private readonly entries = new Map<string, { data: T; ts: number }>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly staleMs: number,
    private readonly maxEntries = 500,
  ) {}

  async get(key: string, load: () => Promise<T>, now = () => Date.now()): Promise<{ data: T; stale: boolean }> {
    const entry = this.entries.get(key);
    if (entry && now() - entry.ts < this.ttlMs) return { data: entry.data, stale: false };

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = load().finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    try {
      const data = await pending;
      this.entries.delete(key);
      this.entries.set(key, { data, ts: now() });
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value as string;
        this.entries.delete(oldest);
      }
      return { data, stale: false };
    } catch (err) {
      if (entry && now() - entry.ts < this.staleMs) return { data: entry.data, stale: true };
      throw err;
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Caps concurrent upstream calls; excess callers wait in FIFO order. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("max must be >= 1");
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    // A released slot is handed directly to the next waiter, so `active` never exceeds `max`.
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }

  get inUse(): number {
    return this.active;
  }
}

/** Reads a positive integer from the environment, falling back to `fallback`; invalid values abort startup. */
export function positiveIntEnv(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  return Number(raw);
}
