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
import { server } from '../src/index';

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
});
