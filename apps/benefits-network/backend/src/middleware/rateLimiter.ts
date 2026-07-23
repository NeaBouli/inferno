import rateLimit from 'express-rate-limit';
import { createPublicRateLimitStore } from '../services/rateLimitInfrastructure';

export const sessionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 200,
  store: createPublicRateLimitStore('sessions'),
  message: { error: 'Too many sessions created. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const attestRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  store: createPublicRateLimitStore('attest'),
  keyGenerator: (req) => req.ip || 'unknown',
  message: { error: 'Too many attest attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const sellerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  store: createPublicRateLimitStore('seller-ip'),
  message: { error: 'Too many seller actions. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const challengeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  store: createPublicRateLimitStore('challenge'),
  message: { error: 'Too many challenge requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const customerHistoryRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 180,
  store: createPublicRateLimitStore('customer-history'),
  message: { error: 'Too many customer history requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const customerPassRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  store: createPublicRateLimitStore('customer-pass'),
  message: { error: 'Too many checkout pass requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const discoveryRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  store: createPublicRateLimitStore('discovery'),
  message: { error: 'Too many offer searches. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});
