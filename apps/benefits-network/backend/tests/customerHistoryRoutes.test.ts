import { ethers } from 'ethers';

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
  recoverSigner: jest.fn(),
  initProvider: jest.fn(),
}));

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 11155111,
    RPC_URL: 'https://mock-rpc.example.com',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    ADMIN_SECRET: 'test-secret-12345',
    DATABASE_URL: 'file:./test.db',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    PORT: 0,
  },
}));

import { prisma } from '../src/services/sessionService';
import { app, server } from '../src/index';

void app;

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function issueChallenge(walletAddress: string) {
  const response = await fetch(`${baseUrl()}/api/customer/history/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress }),
  });
  return { response, body: await response.json() as { message: string; nonce: string; expiresAt: string } };
}

async function authorize(wallet: ethers.Wallet, challenge?: { message: string; nonce: string }) {
  const issued = challenge ?? (await issueChallenge(wallet.address)).body;
  const signature = await wallet.signMessage(issued.message);
  const response = await fetch(`${baseUrl()}/api/customer/history/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: wallet.address, nonce: issued.nonce, signature }),
  });
  return { response, body: await response.json() as { accessToken?: string; expiresAt?: string; error?: string }, signature, challenge: issued };
}

async function getHistory(
  accessToken?: string,
  query: { limit?: number; cursor?: string; snapshot?: string } = {}
) {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.snapshot) params.set('snapshot', query.snapshot);
  return fetch(`${baseUrl()}/api/customer/history${params.size ? `?${params}` : ''}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
  });
}

describe('Customer benefits history authorization and pagination', () => {
  const customer = ethers.Wallet.createRandom();
  const otherCustomer = ethers.Wallet.createRandom();
  let businessId: string;

  beforeEach(async () => {
    await prisma.customerHistoryAccess.deleteMany();
    await prisma.customerHistoryChallenge.deleteMany();
    await prisma.rewardEvent.deleteMany();
    await prisma.sellerRewardLink.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.business.deleteMany();
    const business = await prisma.business.create({
      data: {
        name: 'Customer History Seller',
        discountPercent: 10,
        requiredLockIFR: 1000,
        ttlSeconds: 120,
      },
    });
    businessId = business.id;
  });

  afterAll(async () => {
    await prisma.customerHistoryAccess.deleteMany();
    await prisma.customerHistoryChallenge.deleteMany();
    await prisma.rewardEvent.deleteMany();
    await prisma.sellerRewardLink.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.business.deleteMany();
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('exchanges one signed challenge for a short-lived read token exactly once', async () => {
    const issued = await issueChallenge(customer.address);
    expect(issued.response.status).toBe(200);
    expect(issued.body.message).toContain('Domain: shop.ifrunit.tech');
    expect(issued.body.message).toContain('Action: Read My Benefits History');
    expect(issued.body.message).toContain('does not move tokens');

    const authorized = await authorize(customer, issued.body);
    expect(authorized.response.status).toBe(200);
    expect(authorized.response.headers.get('cache-control')).toContain('no-store');
    expect(authorized.response.headers.get('pragma')).toBe('no-cache');
    expect(authorized.body.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await prisma.customerHistoryAccess.count()).toBe(1);

    const replay = await fetch(`${baseUrl()}/api/customer/history/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        walletAddress: customer.address,
        nonce: issued.body.nonce,
        signature: authorized.signature,
      }),
    });
    expect(replay.status).toBe(401);
    expect(await prisma.customerHistoryAccess.count()).toBe(1);
  });

  it('rejects forged signatures without consuming the rightful customer challenge', async () => {
    const issued = (await issueChallenge(customer.address)).body;
    const forged = await authorize(otherCustomer, issued);
    expect(forged.response.status).toBe(401);
    expect(await prisma.customerHistoryChallenge.findUniqueOrThrow({ where: { nonce: issued.nonce } }))
      .toMatchObject({ consumedAt: null });

    const rightful = await authorize(customer, issued);
    expect(rightful.response.status).toBe(200);
  });

  it('returns only the signer sessions and exposes no wallet or authorization material', async () => {
    const now = Date.now();
    await prisma.session.createMany({ data: [
      {
        id: 'customer-history-own',
        businessId,
        nonce: 'customer-history-own-nonce',
        expiresAt: new Date(now + 10 * 60_000),
        createdAt: new Date(now - 3 * 60_000),
        status: 'REDEEMED',
        recoveredAddress: customer.address,
        redeemedAt: new Date(now - 2 * 60_000),
        benefitSnapshotVersion: 2,
        benefitLabel: 'Member coffee',
        benefitCategory: 'Coffee',
        benefitProductName: 'Reserve espresso',
        benefitDiscountPercent: 15,
        benefitRequiredLockIFR: 1000,
      },
      {
        id: 'customer-history-other',
        businessId,
        nonce: 'customer-history-other-nonce',
        expiresAt: new Date(now + 11 * 60_000),
        createdAt: new Date(now - 2 * 60_000),
        status: 'APPROVED',
        recoveredAddress: otherCustomer.address,
      },
      {
        id: 'customer-history-unverified',
        businessId,
        nonce: 'customer-history-unverified-nonce',
        expiresAt: new Date(now + 12 * 60_000),
        createdAt: new Date(now - 60_000),
        status: 'PENDING',
      },
    ] });

    const authorization = await authorize(customer);
    const response = await getHistory(authorization.body.accessToken);
    const body = await response.json() as { sessions: Array<Record<string, unknown>> };
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      id: 'customer-history-own',
      status: 'REDEEMED',
      seller: { id: businessId, name: 'Customer History Seller' },
      benefit: {
        label: 'Member coffee',
        category: 'Coffee',
        productName: 'Reserve espresso',
        discountPercent: 15,
        requiredLockIFR: 1000,
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(customer.address);
    expect(serialized).not.toContain(otherCustomer.address);
    expect(serialized).not.toMatch(/signature|nonce|auditLog|accessToken|lockAmountRaw/);
  });

  it('keeps a stable snapshot and rejects another wallet cursor or invalid pagination', async () => {
    const now = Date.now();
    const createdAt = [now - 60_000, now - 2 * 60_000, now - 3 * 60_000];
    for (let index = 0; index < createdAt.length; index += 1) {
      await prisma.session.create({
        data: {
          id: `customer-page-${index + 1}`,
          businessId,
          nonce: `customer-page-nonce-${index + 1}`,
          expiresAt: new Date(now + (index + 1) * 60_000),
          createdAt: new Date(createdAt[index]),
          status: 'APPROVED',
          recoveredAddress: customer.address,
        },
      });
    }
    await prisma.session.create({
      data: {
        id: 'other-customer-cursor',
        businessId,
        nonce: 'other-customer-cursor-nonce',
        expiresAt: new Date(now + 4 * 60_000),
        createdAt: new Date(now - 30_000),
        status: 'APPROVED',
        recoveredAddress: otherCustomer.address,
      },
    });

    const authorization = await authorize(customer);
    const firstResponse = await getHistory(authorization.body.accessToken, { limit: 2 });
    const first = await firstResponse.json() as {
      sessions: Array<{ id: string }>;
      pagination: { nextCursor: string; snapshot: string; hasMore: boolean };
    };
    expect(first.sessions.map((item) => item.id)).toEqual(['customer-page-1', 'customer-page-2']);
    expect(first.pagination.hasMore).toBe(true);

    await prisma.session.create({
      data: {
        id: 'customer-page-new-after-snapshot',
        businessId,
        nonce: 'customer-page-new-after-snapshot-nonce',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(Date.now() + 1_000),
        status: 'APPROVED',
        recoveredAddress: customer.address,
      },
    });
    const secondResponse = await getHistory(authorization.body.accessToken, {
      limit: 2,
      cursor: first.pagination.nextCursor,
      snapshot: first.pagination.snapshot,
    });
    const second = await secondResponse.json() as { sessions: Array<{ id: string }> };
    expect(second.sessions.map((item) => item.id)).toEqual(['customer-page-3']);

    expect((await getHistory(authorization.body.accessToken, { cursor: 'other-customer-cursor' })).status).toBe(400);
    expect((await getHistory(authorization.body.accessToken, { limit: 51 })).status).toBe(400);
    expect((await getHistory(authorization.body.accessToken, { snapshot: 'not-a-date' })).status).toBe(400);
    expect((await getHistory(authorization.body.accessToken, { snapshot: first.pagination.snapshot })).status).toBe(400);
    expect((await getHistory(authorization.body.accessToken, {
      cursor: first.pagination.nextCursor,
      snapshot: '2099-01-01T00:00:00.000Z',
    })).status).toBe(400);
  });

  it('rejects missing and expired access tokens', async () => {
    expect((await getHistory()).status).toBe(401);
    const authorization = await authorize(customer);
    const access = await prisma.customerHistoryAccess.findFirstOrThrow({
      where: { walletAddress: customer.address },
    });
    await prisma.customerHistoryAccess.update({
      where: { tokenHash: access.tokenHash },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await getHistory(authorization.body.accessToken)).status).toBe(401);
  });
});
