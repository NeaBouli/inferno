import { ethers } from 'ethers';

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
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

/**
 * Owner decision B (T-231b): the server keeps no customer-linked history. The former wallet
 * challenge -> access token -> paginated history flow (and its replay/forgery/cursor/token tests)
 * is removed; history lives in device-local signed receipts (see customerSessionPrivacy.test.ts,
 * 'device-local receipt'). These endpoints must fail explicitly and must not touch the database.
 */
describe('Customer benefits history is device-local only', () => {
  const customer = ethers.Wallet.createRandom();

  afterAll(async () => {
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  async function expectGone(response: Response, expectedLimit: string) {
    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    // The former per-route IP limiters still front the 410 responses.
    expect(response.headers.get('ratelimit-limit')).toBe(expectedLimit);
    const body = await response.json() as { error: string; storage: string };
    expect(body.storage).toBe('device-local');
    expect(body.error).toMatch(/no longer stored by the server/);
    expect(JSON.stringify(body)).not.toMatch(/accessToken|nonce|message|sessions/);
  }

  it('answers 410 device-local for challenge, authorize and history, regardless of input', async () => {
    const signature = await customer.signMessage('legacy history challenge');
    const auditBefore = await prisma.auditLog.count();
    const sessionsBefore = await prisma.session.count();

    await expectGone(await fetch(`${baseUrl()}/api/customer/history/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: customer.address }),
    }), '200');
    await expectGone(await fetch(`${baseUrl()}/api/customer/history/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: customer.address, nonce: 'legacy-nonce', signature }),
    }), '180');
    await expectGone(await fetch(`${baseUrl()}/api/customer/history`), '180');
    await expectGone(await fetch(`${baseUrl()}/api/customer/history?limit=2&cursor=x&snapshot=2099-01-01T00:00:00.000Z`, {
      headers: { authorization: `Bearer ${'a'.repeat(43)}` },
    }), '180');

    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect(await prisma.session.count()).toBe(sessionsBefore);
  });

  it('has no customer-history or customer-pass-challenge tables in the schema', async () => {
    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    const names = tables.map((table) => table.name);
    expect(names).toContain('Session');
    for (const removed of ['CustomerHistoryChallenge', 'CustomerHistoryAccess', 'CustomerPassChallenge']) {
      expect(names).not.toContain(removed);
    }
    expect((prisma as unknown as Record<string, unknown>).customerHistoryAccess).toBeUndefined();
    expect((prisma as unknown as Record<string, unknown>).customerHistoryChallenge).toBeUndefined();
  });
});
