import { ethers } from 'ethers';

type TestWallet = ReturnType<typeof ethers.Wallet.createRandom>;
import * as authenticatedRateLimiter from '../src/services/authenticatedRateLimiter';

const mockCheckLock = jest.fn();
const mockRecoverSigner = jest.fn();

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: (...args: unknown[]) => mockCheckLock(...args),
  recoverSigner: (...args: unknown[]) => mockRecoverSigner(...args),
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
import { server } from '../src/index';

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function createPass(wallet: TestWallet) {
  const challengeResponse = await fetch(`${baseUrl()}/api/passes/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: wallet.address }),
  });
  expect(challengeResponse.status).toBe(200);
  const challenge = await challengeResponse.json() as { message: string; nonce: string };
  const payload = {
    walletAddress: wallet.address,
    nonce: challenge.nonce,
    signature: await wallet.signMessage(challenge.message),
  };
  const response = await fetch(`${baseUrl()}/api/passes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { response, payload, body: await response.json() as {
    passId: string; controlToken: string; qrUrl: string; expiresAt: string;
  } };
}

async function sellerHeaders(
  seller: TestWallet,
  businessId: string,
  passId: string,
  ruleId: string
) {
  const scope = `${passId}:${ruleId}`;
  const query = new URLSearchParams({
    action: 'passes:bind', businessId, walletAddress: seller.address, scope,
  });
  const response = await fetch(`${baseUrl()}/api/seller/auth-message?${query}`);
  expect(response.status).toBe(200);
  const challenge = await response.json() as { message: string; timestamp: string; nonce: string };
  return {
    'content-type': 'application/json',
    'x-ifr-wallet': seller.address,
    'x-ifr-signature': await seller.signMessage(challenge.message),
    'x-ifr-timestamp': challenge.timestamp,
    'x-ifr-nonce': challenge.nonce,
  };
}

async function bindPass(
  seller: TestWallet,
  businessId: string,
  ruleId: string,
  passId: string
) {
  return fetch(`${baseUrl()}/api/passes/${passId}/bind`, {
    method: 'POST',
    headers: await sellerHeaders(seller, businessId, passId, ruleId),
    body: JSON.stringify({ businessId, benefitRuleId: ruleId }),
  });
}

describe('customer-presented checkout passes', () => {
  const customer = ethers.Wallet.createRandom();
  const otherCustomer = ethers.Wallet.createRandom();
  const seller = ethers.Wallet.createRandom();
  const otherSeller = ethers.Wallet.createRandom();
  let businessId: string;
  let ruleId: string;
  let otherBusinessId: string;
  let otherRuleId: string;
  let limiterSpy: jest.SpyInstance;

  beforeEach(async () => {
    limiterSpy = jest.spyOn(authenticatedRateLimiter, 'assertSellerWalletActionAllowed')
      .mockImplementation(() => undefined);
    await prisma.rewardEvent.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.customerPass.deleteMany();
    await prisma.customerPassChallenge.deleteMany();
    await prisma.sellerAuthorizationChallenge.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.sellerRewardLink.deleteMany();
    await prisma.business.deleteMany();

    const first = await prisma.business.create({
      data: { name: 'Pass Seller', ownerAddress: seller.address, discountPercent: 10, requiredLockIFR: 1000 },
    });
    businessId = first.id;
    ruleId = (await prisma.benefitRule.create({
      data: {
        businessId, label: 'Coffee benefit', category: 'Coffee', productName: 'Espresso',
        discountPercent: 15, requiredLockIFR: 1000, ttlSeconds: 120,
      },
    })).id;
    const second = await prisma.business.create({
      data: { name: 'Other Seller', ownerAddress: otherSeller.address, discountPercent: 5, requiredLockIFR: 500 },
    });
    otherBusinessId = second.id;
    otherRuleId = (await prisma.benefitRule.create({
      data: {
        businessId: otherBusinessId, label: 'Other benefit', category: 'Retail', productName: 'Item',
        discountPercent: 5, requiredLockIFR: 500, ttlSeconds: 120,
      },
    })).id;
  });

  afterEach(() => limiterSpy.mockRestore());

  afterAll(async () => {
    await prisma.rewardEvent.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.customerPass.deleteMany();
    await prisma.customerPassChallenge.deleteMany();
    await prisma.sellerAuthorizationChallenge.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.sellerRewardLink.deleteMany();
    await prisma.business.deleteMany();
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('creates a one-time opaque pass without storing or publishing its control token', async () => {
    const created = await createPass(customer);
    expect(created.response.status).toBe(201);
    expect(created.body.passId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.body.qrUrl).toBe(`/p/${created.body.passId}`);
    const stored = await prisma.customerPass.findUniqueOrThrow({ where: { id: created.body.passId } });
    expect(stored.walletAddress).toBe(customer.address);
    expect(stored.controlHash).not.toContain(created.body.controlToken);

    const publicResponse = await fetch(`${baseUrl()}/api/passes/${created.body.passId}`);
    const publicBody = await publicResponse.json() as Record<string, unknown>;
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('cache-control')).toContain('no-store');
    expect(publicBody).toEqual({ available: true, expiresAt: created.body.expiresAt });
    expect(JSON.stringify(publicBody)).not.toMatch(/wallet|session|signature|control|lock/i);

    const replay = await fetch(`${baseUrl()}/api/passes`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(created.payload),
    });
    expect(replay.status).toBe(401);
  });

  it('atomically lets exactly one seller bind a copied pass', async () => {
    const created = await createPass(customer);
    const [first, second] = await Promise.all([
      bindPass(seller, businessId, ruleId, created.body.passId),
      bindPass(otherSeller, otherBusinessId, otherRuleId, created.body.passId),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await prisma.session.count({ where: { customerPassId: created.body.passId } })).toBe(1);
  });

  it('requires the original customer to confirm the exact bound seller rule', async () => {
    const created = await createPass(customer);
    const bound = await bindPass(seller, businessId, ruleId, created.body.passId);
    expect(bound.status).toBe(201);
    const boundBody = await bound.json() as { sessionId: string };

    expect((await fetch(`${baseUrl()}/api/sessions/${boundBody.sessionId}/challenge`)).status).toBe(403);
    expect((await fetch(`${baseUrl()}/api/attest`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: boundBody.sessionId, signature: '0xdeadbeef' }),
    })).status).toBe(403);

    const controlHeaders = { authorization: `Bearer ${created.body.controlToken}` };
    const controlled = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/control`, {
      headers: controlHeaders,
    });
    expect(await controlled.json()).toMatchObject({
      status: 'BOUND',
      checkout: { businessId, benefitRuleId: ruleId, sellerName: 'Pass Seller' },
    });
    const challengeResponse = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/challenge`, {
      method: 'POST', headers: controlHeaders,
    });
    const challenge = await challengeResponse.json() as { message: string };
    expect(challenge.message).toContain(`Benefit Rule: ${ruleId}`);
    expect(challenge.message).toContain('Discount Percent: 15');

    mockRecoverSigner.mockReturnValue(otherCustomer.address);
    expect((await fetch(`${baseUrl()}/api/passes/${created.body.passId}/confirm`, {
      method: 'POST', headers: { ...controlHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ signature: '0xdeadbeef' }),
    })).status).toBe(403);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: boundBody.sessionId } })).status).toBe('PENDING');

    mockRecoverSigner.mockReturnValue(customer.address);
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '2500.0' });
    const confirmed = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/confirm`, {
      method: 'POST', headers: { ...controlHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ signature: '0xdeadbeef' }),
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ status: 'APPROVED', wallet: customer.address });
  });

  it('cancels an open or pending bound pass and invalidates its session', async () => {
    const created = await createPass(customer);
    const bound = await bindPass(seller, businessId, ruleId, created.body.passId);
    const boundBody = await bound.json() as { sessionId: string };
    const response = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/cancel`, {
      method: 'POST', headers: { authorization: `Bearer ${created.body.controlToken}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'CANCELLED' });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: boundBody.sessionId } })).status).toBe('REJECTED');
    expect((await bindPass(otherSeller, otherBusinessId, otherRuleId, created.body.passId)).status).toBe(409);
  });

  it('expires a bound pass and linked session consistently across control endpoints', async () => {
    const created = await createPass(customer);
    const bound = await bindPass(seller, businessId, ruleId, created.body.passId);
    const { sessionId } = await bound.json() as { sessionId: string };
    await prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const headers = { authorization: `Bearer ${created.body.controlToken}` };
    const controlled = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/control`, { headers });
    expect(controlled.status).toBe(200);
    expect(await controlled.json()).toMatchObject({ status: 'EXPIRED', checkout: { status: 'EXPIRED' } });
    expect((await prisma.customerPass.findUniqueOrThrow({ where: { id: created.body.passId } })).status).toBe('EXPIRED');
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('EXPIRED');
    expect((await fetch(`${baseUrl()}/api/passes/${created.body.passId}/challenge`, { method: 'POST', headers })).status).toBe(409);
    expect((await fetch(`${baseUrl()}/api/passes/${created.body.passId}/cancel`, { method: 'POST', headers })).status).toBe(409);
  });

  it('never reports cancellation while leaving the checkout approved under a confirm race', async () => {
    const created = await createPass(customer);
    const bound = await bindPass(seller, businessId, ruleId, created.body.passId);
    const { sessionId } = await bound.json() as { sessionId: string };
    mockRecoverSigner.mockReturnValue(customer.address);
    mockCheckLock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { eligible: true, lockedAmount: '2500.0' };
    });
    const headers = { authorization: `Bearer ${created.body.controlToken}` };
    const [confirmation, cancellation] = await Promise.all([
      fetch(`${baseUrl()}/api/passes/${created.body.passId}/confirm`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ signature: '0xdeadbeef' }),
      }),
      fetch(`${baseUrl()}/api/passes/${created.body.passId}/cancel`, { method: 'POST', headers }),
    ]);
    expect([confirmation.status, cancellation.status].sort()).toEqual([200, 409]);
    const pass = await prisma.customerPass.findUniqueOrThrow({ where: { id: created.body.passId } });
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(`${pass.status}:${session.status}`).toMatch(/^(BOUND:APPROVED|CANCELLED:REJECTED)$/);
  });

  it('rechecks checkout operator authorization inside the pass binding transaction', async () => {
    const operator = ethers.Wallet.createRandom();
    const row = await prisma.checkoutOperator.create({
      data: { businessId, walletAddress: operator.address, label: 'Revoked pass scanner' },
    });
    const created = await createPass(customer);
    const headers = await sellerHeaders(operator, businessId, created.body.passId, ruleId);
    await prisma.checkoutOperator.update({ where: { id: row.id }, data: { active: false } });
    const response = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/bind`, {
      method: 'POST', headers,
      body: JSON.stringify({ businessId, benefitRuleId: ruleId }),
    });
    expect(response.status).toBe(403);
    expect(await prisma.session.count({ where: { customerPassId: created.body.passId } })).toBe(0);
    expect((await prisma.customerPass.findUniqueOrThrow({ where: { id: created.body.passId } })).status).toBe('OPEN');
  });
});
