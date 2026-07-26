import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { createPublicRateLimitStore } from '../services/rateLimitInfrastructure';

type CustomerPassControlRateLimitRequest = {
  params: Record<string, string | undefined>;
  get(name: 'authorization'): string | undefined;
};

export function customerPassControlRateLimitKey(
  request: CustomerPassControlRateLimitRequest
) {
  const authorizationDigest = createHash('sha256')
    .update(request.get('authorization') || '')
    .digest('hex');
  return `${String(request.params.id || 'unknown')}:${authorizationDigest}`;
}

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

export const customerPassReadIpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 36000,
  store: createPublicRateLimitStore('customer-pass-read-ip'),
  message: { error: 'Too many checkout pass status requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const customerPassReadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1800,
  keyGenerator: customerPassControlRateLimitKey,
  store: createPublicRateLimitStore('customer-pass-read'),
  message: { error: 'Too many checkout pass status requests. Try again later.' },
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

type AdminRateLimiterOptions = {
  windowMs?: number;
  max?: number;
};

export function createAdminRateLimiter(options: AdminRateLimiterOptions = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? 60 * 60 * 1000,
    max: options.max ?? 60,
    keyGenerator: (req) => req.ip || 'unknown',
    store: createPublicRateLimitStore('admin'),
    message: { error: 'Too many admin requests. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export const adminRateLimiter = createAdminRateLimiter();
