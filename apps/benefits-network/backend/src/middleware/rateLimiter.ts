import rateLimit from 'express-rate-limit';

export const sessionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100,
  keyGenerator: (req) => req.body?.businessId || req.ip || 'unknown',
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
