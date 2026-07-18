export class AuthenticatedRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many authenticated seller actions. Try again later.');
    this.name = 'AuthenticatedRateLimitError';
  }
}

type FixedWindowLimiterOptions = {
  windowMs: number;
  max: number;
  maxKeys?: number;
  now?: () => number;
};

type WindowEntry = {
  count: number;
  resetAt: number;
};

export class FixedWindowKeyLimiter {
  private readonly entries = new Map<string, WindowEntry>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(private readonly options: FixedWindowLimiterOptions) {
    if (options.windowMs <= 0 || options.max <= 0) {
      throw new Error('Authenticated limiter window and max must be positive');
    }
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  consume(rawKey: string) {
    const key = rawKey.trim().toLowerCase();
    if (!key) throw new Error('Authenticated limiter key is required');

    const now = this.now();
    const current = this.entries.get(key);
    if (current && current.resetAt > now) {
      if (current.count >= this.options.max) {
        throw new AuthenticatedRateLimitError(Math.max(1, Math.ceil((current.resetAt - now) / 1000)));
      }
      current.count += 1;
      return;
    }

    if (current) this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.resetAt <= now) this.entries.delete(entryKey);
      }
    }
    if (this.entries.size >= this.maxKeys) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey) this.entries.delete(oldestKey);
    }

    this.entries.set(key, { count: 1, resetAt: now + this.options.windowMs });
  }
}

const sellerWalletLimiter = new FixedWindowKeyLimiter({
  windowMs: 60 * 60 * 1000,
  max: 120,
});

export function assertSellerWalletActionAllowed(walletAddress: string) {
  sellerWalletLimiter.consume(`seller:${walletAddress}`);
}
