jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
  checkBenefitEligibility: jest.fn(),
  recoverSigner: jest.fn(),
  initProvider: jest.fn(),
}));

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 11155111,
    SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://mock-rpc.example.com',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    ADMIN_SECRET: 'test-secret-12345',
    DATABASE_URL: 'file:./test.db',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: 25,
    PORT: 0,
  },
}));

import { prisma } from '../src/services/sessionService';
import { server, isPublicDiscoveryRequest, resolveAllowedOrigins } from '../src/index';

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

describe('public discovery CORS (serverless partner widget)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('allows any origin to read public business discovery without credentials', async () => {
    const response = await fetch(`${baseUrl()}/api/businesses`, { headers: { Origin: 'https://partner.example' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('answers the preflight for discovery with GET/HEAD only', async () => {
    const response = await fetch(`${baseUrl()}/api/businesses/unknown/rules`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://partner.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const methods = response.headers.get('access-control-allow-methods') || '';
    expect(methods).toContain('GET');
    expect(methods).not.toMatch(/POST|PUT|PATCH|DELETE/);
  });

  it('keeps the origin allowlist on seller and session routes', async () => {
    for (const path of ['/api/seller/auth-message', '/api/sessions/x']) {
      const response = await fetch(`${baseUrl()}${path}`, { headers: { Origin: 'https://partner.example' } });
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('gives no wildcard to actual write methods on discovery paths from a foreign origin', async () => {
    for (const path of ['/api/businesses', '/api/businesses/x', '/api/businesses/x/rules', '/api/businesses/x/products']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await fetch(`${baseUrl()}${path}`, {
          method,
          headers: { Origin: 'https://partner.example', 'Content-Type': 'application/json' },
          body: '{}',
        });
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
      }
    }
  });

  it('keeps normal allowlist handling for write methods from an allowed origin', async () => {
    const response = await fetch(`${baseUrl()}/api/businesses/x`, {
      method: 'POST',
      headers: { Origin: 'https://shop.ifrunit.tech', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://shop.ifrunit.tech');
  });

  it('refuses a wildcard preflight for write methods and for non-discovery sub-paths', async () => {
    const write = await fetch(`${baseUrl()}/api/businesses/x/rules`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://partner.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(write.headers.get('access-control-allow-origin')).toBeNull();
    const deeper = await fetch(`${baseUrl()}/api/businesses/x/rules/extra`, { headers: { Origin: 'https://partner.example' } });
    expect(deeper.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('classifies only exact discovery paths with GET/HEAD (or their preflight) as public', () => {
    expect(isPublicDiscoveryRequest('GET', '/api/businesses')).toBe(true);
    expect(isPublicDiscoveryRequest('HEAD', '/api/businesses/catalog-index')).toBe(true);
    expect(isPublicDiscoveryRequest('GET', '/api/businesses/abc/rules')).toBe(true);
    expect(isPublicDiscoveryRequest('GET', '/api/businesses/abc/products')).toBe(true);
    expect(isPublicDiscoveryRequest('OPTIONS', '/api/businesses/abc', 'get')).toBe(true);
    expect(isPublicDiscoveryRequest('OPTIONS', '/api/businesses/abc', 'POST')).toBe(false);
    expect(isPublicDiscoveryRequest('OPTIONS', '/api/businesses/abc')).toBe(false);
    expect(isPublicDiscoveryRequest('POST', '/api/businesses')).toBe(false);
    expect(isPublicDiscoveryRequest('DELETE', '/api/businesses/abc')).toBe(false);
    expect(isPublicDiscoveryRequest('GET', '/api/businesses/abc/admin')).toBe(false);
    expect(isPublicDiscoveryRequest('GET', '/api/businesses/abc/rules/x')).toBe(false);
    expect(isPublicDiscoveryRequest('GET', '/api/seller/auth-message')).toBe(false);
  });
});

describe('allowlist defaults (T-212b-10)', () => {
  it('never falls back to localhost in production', () => {
    const prod = resolveAllowedOrigins({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(prod.length).toBeGreaterThan(0);
    expect(prod.every((o) => o.startsWith('https://'))).toBe(true);
    expect(prod.some((o) => o.includes('localhost'))).toBe(false);
  });
  it('keeps local origins outside production and honours ALLOWED_ORIGINS', () => {
    expect(resolveAllowedOrigins({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toContain('http://localhost:3000');
    expect(resolveAllowedOrigins({ NODE_ENV: 'production', ALLOWED_ORIGINS: ' https://a.example , ' } as NodeJS.ProcessEnv)).toEqual(['https://a.example']);
  });
});
