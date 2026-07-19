import rateLimit from 'express-rate-limit';

export const sessionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 200,
  message: { error: 'Too many sessions created. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const attestRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: 'Too many attest attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const sellerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  message: { error: 'Too many seller actions. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const challengeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  message: { error: 'Too many challenge requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const customerHistoryRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 180,
  message: { error: 'Too many customer history requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const discoveryRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many offer searches. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});
