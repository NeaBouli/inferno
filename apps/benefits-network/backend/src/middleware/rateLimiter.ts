import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
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

/**
 * Proxy hops trusted for `X-Forwarded-For` (Express `trust proxy`). Production traffic reaches the
 * backend only through Traefik and the Next.js frontend on private Docker networks, so only
 * loopback, link-local and unique-local/private peers are trusted; a public peer is always req.ip.
 */
export const TRUSTED_PROXY_SUBNETS = ['loopback', 'linklocal', 'uniquelocal'];

/** Expands a validated IPv6 address (optionally with an embedded dotted IPv4 tail) to eight 16-bit groups. */
function ipv6Groups(addr: string): number[] {
  let text = addr;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((g) => parseInt(g, 16));
}

/**
 * Rate-limit key for a client address. IPv4 (including IPv4-mapped IPv6) is keyed by the single
 * address; IPv6 is keyed by its /64, the smallest prefix a single subscriber is routinely given,
 * so rotating addresses inside one /64 cannot mint fresh buckets. Non-IP values pass through.
 */
export function rateLimitIpKey(ip: string): string {
  const addr = ip.split('%')[0].toLowerCase();
  const family = isIP(addr);
  if (family === 4) return addr;
  if (family !== 6) return ip;
  const g = ipv6Groups(addr);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/** express-rate-limit key generator over the trusted `req.ip` (see `rateLimitIpKey`). */
export function clientIpRateLimitKey(request: { ip?: string }): string {
  return rateLimitIpKey(request.ip || 'unknown');
}

export const sessionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 200,
  keyGenerator: clientIpRateLimitKey,
  store: createPublicRateLimitStore('sessions'),
  message: { error: 'Too many sessions created. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public checkout status polling (seller console and customer page poll every 3 s).
export const sessionStatusRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 7200,
  keyGenerator: clientIpRateLimitKey,
  store: createPublicRateLimitStore('session-status'),
  message: { error: 'Too many session status requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const attestRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  store: createPublicRateLimitStore('attest'),
  keyGenerator: clientIpRateLimitKey,
  message: { error: 'Too many attest attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const sellerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  keyGenerator: clientIpRateLimitKey,
  store: createPublicRateLimitStore('seller-ip'),
  message: { error: 'Too many seller actions. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const redeemRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  keyGenerator: clientIpRateLimitKey,
  store: createPublicRateLimitStore('redeem-ip'),
  message: { error: 'Too many redeem attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const challengeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  keyGenerator: clientIpRateLimitKey,
  store: createPublicRateLimitStore('challenge'),
  message: { error: 'Too many challenge requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const customerHistoryRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 180,
  keyGenerator: clientIpRateLimitKey,
  store: createPublicRateLimitStore('customer-history'),
  message: { error: 'Too many customer history requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const customerPassRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  keyGenerator: clientIpRateLimitKey,
  store: createPublicRateLimitStore('customer-pass'),
  message: { error: 'Too many checkout pass requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const customerPassReadIpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 36000,
  keyGenerator: clientIpRateLimitKey,
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
  keyGenerator: clientIpRateLimitKey,
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
    keyGenerator: clientIpRateLimitKey,
    store: createPublicRateLimitStore('admin'),
    message: { error: 'Too many admin requests. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export const adminRateLimiter = createAdminRateLimiter();
