import { isIP } from "node:net";
import type { NextFunction, Request, Response } from "express";

// Production traffic reaches the copilot through Traefik on a private Docker network.
// Trust only loopback/link-local/private proxy hops so `req.ip` resolves to the first
// public hop that the proxy appended, never a client-supplied X-Forwarded-For entry.
export const TRUSTED_PROXY_HOPS = ["loopback", "linklocal", "uniquelocal"];

/** Client address for rate limiting; requires `app.set("trust proxy", TRUSTED_PROXY_HOPS)`. */
export function clientIp(req: Request): string {
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

/** Normalized per-client rate-limit key for a request (see `rateLimitKey`). */
export function clientRateLimitKey(req: Request): string {
  return rateLimitKey(clientIp(req));
}

interface WindowLimit {
  windowMs: number;
  max: number;
}

/**
 * Sliding-window limiter over one or more windows, bounded in the number of tracked keys. At capacity,
 * expired keys are reclaimed first; a live key is never discarded to admit an unseen key, so such keys
 * are denied with `AT_CAPACITY` (fail-closed) until a key expires. Existing keys keep their windows.
 */
export class SlidingWindowLimiter {
  /** `hit` result for an unseen key refused because every tracked key is still live. */
  static readonly AT_CAPACITY = -2;

  private readonly hits = new Map<string, number[]>();
  private readonly longestWindow: number;
  // Lower bound on the earliest moment any tracked key becomes reclaimable.
  private nextExpiry = Infinity;

  constructor(private readonly limits: WindowLimit[], private readonly maxKeys = 50_000) {
    if (limits.length === 0) throw new Error("at least one window is required");
    this.longestWindow = Math.max(...limits.map((l) => l.windowMs));
  }

  /** Records a hit and returns true, or returns false without recording when any window is full or at capacity. */
  check(key: string, now = Date.now()): boolean {
    return this.hit(key, now) === -1;
  }

  /**
   * Records a hit and returns -1, returns the index of the first full window without recording,
   * or returns `AT_CAPACITY` for an unseen key when no tracked key can be reclaimed.
   */
  hit(key: string, now = Date.now()): number {
    const stored = this.hits.get(key);
    if (!stored && this.hits.size >= this.maxKeys) {
      if (now >= this.nextExpiry) this.reclaim(now);
      if (this.hits.size >= this.maxKeys) return SlidingWindowLimiter.AT_CAPACITY;
    }
    const recent = (stored || []).filter((t) => now - t < this.longestWindow);
    let full = -1;
    for (const [index, { windowMs, max }] of this.limits.entries()) {
      if (recent.filter((t) => now - t < windowMs).length >= max) {
        full = index;
        break;
      }
    }
    if (full === -1) recent.push(now);
    this.hits.set(key, recent);
    this.nextExpiry = Math.min(this.nextExpiry, this.expiry(recent, now));
    return full;
  }

  get size(): number {
    return this.hits.size;
  }

  private expiry(times: number[], now: number): number {
    return times.length > 0 ? times[times.length - 1] + this.longestWindow : now;
  }

  private reclaim(now: number): void {
    let next = Infinity;
    for (const [key, times] of this.hits) {
      const expiresAt = this.expiry(times, now);
      if (expiresAt <= now) this.hits.delete(key);
      else next = Math.min(next, expiresAt);
    }
    this.nextExpiry = next;
  }
}

/**
 * Chat reply for a `SlidingWindowLimiter.hit` result over the [minute, hour] chat windows: null only
 * when the hit was admitted; every other result, including `AT_CAPACITY`, is a denial message.
 */
export function chatRateLimitMessage(full: number): string | null {
  if (full === -1) return null;
  if (full === 0) return "Slow down! Max 5 messages per minute.";
  if (full === 1) return "Too many requests. Please try again in an hour.";
  return "The assistant is busy right now. Please try again in a few minutes.";
}

/** Express middleware: per-client-IP limit with a JSON 429 response. */
export function ipRateLimit(limiter: SlidingWindowLimiter, message: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!limiter.check(clientRateLimitKey(req))) {
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
