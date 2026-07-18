import {
  AuthenticatedRateLimitError,
  FixedWindowKeyLimiter,
} from '../src/services/authenticatedRateLimiter';

describe('Authenticated seller wallet limiter', () => {
  it('limits one normalized recovered-wallet key without affecting another wallet', () => {
    let now = 1_000;
    const limiter = new FixedWindowKeyLimiter({ windowMs: 10_000, max: 2, now: () => now });

    limiter.consume('seller:0xAbC');
    limiter.consume('SELLER:0xabc');
    expect(() => limiter.consume('seller:0xABC')).toThrow(AuthenticatedRateLimitError);
    expect(() => limiter.consume('seller:0xdef')).not.toThrow();

    now += 10_001;
    expect(() => limiter.consume('seller:0xabc')).not.toThrow();
  });

  it('reports a bounded retry time and evicts the oldest key when the store is full', () => {
    const limiter = new FixedWindowKeyLimiter({ windowMs: 5_000, max: 1, maxKeys: 1, now: () => 2_000 });

    limiter.consume('seller:wallet-a');
    expect(() => limiter.consume('seller:wallet-a')).toThrow(
      expect.objectContaining({ retryAfterSeconds: 5 })
    );
    expect(() => limiter.consume('seller:wallet-b')).not.toThrow();
    expect(() => limiter.consume('seller:wallet-a')).not.toThrow();
  });

  it('rejects empty or invalid limiter configuration', () => {
    expect(() => new FixedWindowKeyLimiter({ windowMs: 0, max: 1 })).toThrow('must be positive');
    const limiter = new FixedWindowKeyLimiter({ windowMs: 1_000, max: 1 });
    expect(() => limiter.consume('   ')).toThrow('key is required');
  });
});
