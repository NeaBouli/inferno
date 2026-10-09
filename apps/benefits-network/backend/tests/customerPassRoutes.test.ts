import { ethers } from 'ethers';

type TestWallet = ReturnType<typeof ethers.Wallet.createRandom>;
import * as authenticatedRateLimiter from '../src/services/authenticatedRateLimiter';

const mockCheckLock = jest.fn();
const mockRecoverSigner = jest.fn();

jest.mock('../src/services/ifrLockService', () => ({
  // Real EIP-191 recovery by default (set in beforeEach); tests may override it.
  checkLock: (...args: unknown[]) => mockCheckLock(...args),
  checkBenefitEligibility: async (...args: unknown[]) => {
    const result = await mockCheckLock(...args);
    return {
      lockEligible: result.eligible,
      heldEligible: true,
      walletAmount: null,
      walletBalanceRaw: null,
      ifrLockAmount: result.lockedAmount,
      commitmentAmount: null,
      verifiedLockSource: result.eligible ? 'ifrlock' : null,
      verificationBlock: 1,
      ...result,
    };
  },
  recoverSigner: (...args: unknown[]) => mockRecoverSigner(...args),
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

// Owner decision B (T-231b): a pass is created without any wallet or signature.
async function createPass() {
  const response = await fetch(`${baseUrl()}/api/passes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return { response, body: await response.json() as {
    passId: string; controlToken: string; qrUrl: string; expiresAt: string;
  } };
}

async function passChallenge(passId: string, controlToken: string, walletAddress: string) {
  return fetch(`${baseUrl()}/api/passes/${passId}/challenge`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress }),
  });
}

async function confirmPass(passId: string, controlToken: string, walletAddress: string, signature: string) {
  return fetch(`${baseUrl()}/api/passes/${passId}/confirm`, {
    method: 'POST',
    headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress, signature }),
  });
}

async function sellerHeaders(
  seller: TestWallet,
  businessId: string,
  passId: string,
  ruleId: string
) {
  const scope = `${passId}:${ruleId}`;
  const query = new URLSearchParams({
    action: 'passes:bind', businessId, scope,
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
      .mockResolvedValue(undefined);
    mockCheckLock.mockReset();
    mockRecoverSigner.mockReset();
    mockRecoverSigner.mockImplementation((message: string, signature: string) => ethers.verifyMessage(message, signature));
    await prisma.rewardEvent.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.customerPass.deleteMany();
    await prisma.sellerAuthorizationChallenge.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.sellerRewardLink.deleteMany();
    await prisma.business.deleteMany();

    const first = await prisma.business.create({
      data: {
        name: 'Pass Seller',
        logoUrl: 'https://assets.example.com/pass-seller.png',
        ownerAddress: seller.address,
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
    businessId = first.id;
    const firstProduct = await prisma.product.create({
      data: {
        businessId,
        name: 'Espresso',
        category: 'Coffee',
        basePriceMinor: '450',
        currency: 'EUR',
      },
    });
    ruleId = (await prisma.benefitRule.create({
      data: {
        businessId, productId: firstProduct.id, label: 'Coffee benefit', category: 'Coffee', productName: 'Espresso',
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
    await prisma.sellerAuthorizationChallenge.deleteMany();
    await prisma.benefitRule.deleteMany();
    await prisma.product.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.sellerRewardLink.deleteMany();
    await prisma.business.deleteMany();
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('creates a one-time opaque pass without a wallet and without storing or publishing its control token', async () => {
    const created = await createPass();
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get('cache-control')).toContain('no-store');
    expect(created.body.passId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.body.qrUrl).toBe(`/p/${created.body.passId}`);
    const stored = await prisma.customerPass.findUniqueOrThrow({ where: { id: created.body.passId } });
    expect(stored.controlHash).not.toContain(created.body.controlToken);
    expect(JSON.stringify(stored)).not.toMatch(/walletAddress|0x[0-9a-fA-F]{40}/);

    const publicResponse = await fetch(`${baseUrl()}/api/passes/${created.body.passId}`);
    const publicBody = await publicResponse.json() as Record<string, unknown>;
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('cache-control')).toContain('no-store');
    expect(publicBody).toEqual({ available: true, expiresAt: created.body.expiresAt });
    expect(JSON.stringify(publicBody)).not.toMatch(/wallet|session|signature|control|lock/i);

    // The former wallet challenge is gone; a legacy wallet/signature payload is refused outright
    // (nothing to replay) and never creates a pass.
    const passesBefore = await prisma.customerPass.count();
    const legacyChallenge = await fetch(`${baseUrl()}/api/passes/challenge`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: customer.address }),
    });
    expect(legacyChallenge.status).toBe(410);
    const legacyCreate = await fetch(`${baseUrl()}/api/passes`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: customer.address, nonce: 'legacy', signature: '0xdeadbeef' }),
    });
    expect(legacyCreate.status).toBe(400);
    expect(await prisma.customerPass.count()).toBe(passesBefore);

    // Every creation yields a fresh, independent capability.
    const second = await createPass();
    expect(second.response.status).toBe(201);
    expect(second.body.passId).not.toBe(created.body.passId);
    expect(second.body.controlToken).not.toBe(created.body.controlToken);
  });

  it('keeps control polling separate from the mutation budget', async () => {
    const clientIp = '198.51.100.29';
    const created = await createPass();
    const controlHeaders = {
      authorization: `Bearer ${created.body.controlToken}`,
      'x-forwarded-for': clientIp,
    };

    for (let index = 0; index < 121; index += 1) {
      const response = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/control`, {
        headers: controlHeaders,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('ratelimit-limit')).toBe('1800');
    }

    const cancelResponse = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/cancel`, {
      method: 'POST',
      headers: controlHeaders,
    });
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.headers.get('ratelimit-limit')).toBe('120');
  }, 15_000);

  it('IP-limits malformed control references without allocating a private read bucket', async () => {
    const response = await fetch(`${baseUrl()}/api/passes/not-a-pass/control`, {
      headers: { authorization: 'Bearer invalid-control-token' },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('ratelimit-limit')).toBe('36000');

    const publicResponse = await fetch(`${baseUrl()}/api/passes/not-a-pass`);
    expect(publicResponse.status).toBe(404);
    expect(publicResponse.headers.get('ratelimit-limit')).toBe('120');
  });

  it('atomically lets exactly one seller bind a copied pass', async () => {
    const created = await createPass();
    const [first, second] = await Promise.all([
      bindPass(seller, businessId, ruleId, created.body.passId),
      bindPass(otherSeller, otherBusinessId, otherRuleId, created.body.passId),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await prisma.session.count({ where: { customerPassId: created.body.passId } })).toBe(1);
  });

  it('requires a proof from the claimed wallet over the exact bound seller rule and redeems on confirm', async () => {
    const created = await createPass();
    const bound = await bindPass(seller, businessId, ruleId, created.body.passId);
    expect(bound.status).toBe(201);
    const boundBody = await bound.json() as { sessionId: string };

    // A pass-bound checkout can only be proven through the pass control token.
    expect((await fetch(`${baseUrl()}/api/sessions/${boundBody.sessionId}/challenge`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: customer.address }),
    })).status).toBe(403);
    expect((await fetch(`${baseUrl()}/api/attest`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: boundBody.sessionId, walletAddress: customer.address, signature: '0xdeadbeef' }),
    })).status).toBe(403);

    const controlHeaders = { authorization: `Bearer ${created.body.controlToken}` };
    const controlled = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/control`, {
      headers: controlHeaders,
    });
    expect(await controlled.json()).toMatchObject({
      status: 'BOUND',
      checkout: {
        businessId,
        benefitRuleId: ruleId,
        sellerName: 'Pass Seller',
        sellerLogoUrl: 'https://assets.example.com/pass-seller.png',
        benefit: {
          basePriceMinor: '450',
          currency: 'EUR',
        },
      },
    });
    await prisma.product.updateMany({
      where: { businessId },
      data: { basePriceMinor: '500', currency: 'EUR' },
    });
    const controlledAfterPriceEdit = await fetch(`${baseUrl()}/api/passes/${created.body.passId}/control`, {
      headers: controlHeaders,
    });
    expect(await controlledAfterPriceEdit.json()).toMatchObject({
      checkout: {
        benefit: {
          basePriceMinor: '450',
          currency: 'EUR',
        },
      },
    });
    // Challenge and confirm require the claimed wallet in the request body.
    expect((await fetch(`${baseUrl()}/api/passes/${created.body.passId}/challenge`, {
      method: 'POST', headers: controlHeaders,
    })).status).toBe(400);
    expect((await passChallenge(created.body.passId, 'x'.repeat(43), customer.address)).status).toBe(401);
    const challengeResponse = await passChallenge(created.body.passId, created.body.controlToken, customer.address);
    expect(challengeResponse.status).toBe(200);
    const challenge = await challengeResponse.json() as { message: string };
    expect(challenge.message).toContain(`Wallet: ${customer.address}`);
    expect(challenge.message).toContain(`Session: ${boundBody.sessionId}`);
    expect(challenge.message).toContain(`Benefit Rule: ${ruleId}`);
    expect(challenge.message).toContain('Reference Price: EUR 450 minor units');
    expect(challenge.message).toContain('Discount Percent: 15');
    mockCheckLock.mockResolvedValue({ eligible: true, lockedAmount: '2500.0' });

    // A different wallet signing the text for the claimed wallet is an explicit mismatch.
    const foreignSignature = await otherCustomer.signMessage(challenge.message);
    const mismatch = await confirmPass(created.body.passId, created.body.controlToken, customer.address, foreignSignature);
    expect(mismatch.status).toBe(403);
    expect((await mismatch.json() as { error: string }).error).toBe('Customer signature does not match the claimed wallet address');
    // Claiming the other wallet with the same signature does not match its own proof text either.
    expect((await confirmPass(created.body.passId, created.body.controlToken, otherCustomer.address, foreignSignature)).status).toBe(403);
    expect(mockCheckLock).not.toHaveBeenCalled();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: boundBody.sessionId } })).status).toBe('PENDING');

    // Wrong control token cannot confirm even with a valid proof.
    const signature = await customer.signMessage(challenge.message);
    expect((await confirmPass(created.body.passId, 'y'.repeat(43), customer.address, signature)).status).toBe(401);

    const confirmed = await confirmPass(created.body.passId, created.body.controlToken, customer.address, signature);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      status: 'REDEEMED',
      wallet: customer.address,
      eligible: true,
      proof: { sessionId: boundBody.sessionId, businessId, selfRedemption: false },
    });
    expect(mockCheckLock).toHaveBeenCalledTimes(1);
    expect(mockCheckLock.mock.calls[0][0]).toBe(customer.address);
    const redeemed = await prisma.session.findUniqueOrThrow({ where: { id: boundBody.sessionId } });
    expect(redeemed).toMatchObject({ status: 'REDEEMED', selfRedemption: false, proofVersion: 2 });
    const redeemedAudit = await prisma.auditLog.findFirstOrThrow({ where: { sessionId: boundBody.sessionId, type: 'REDEEMED' } });
    expect(JSON.parse(redeemedAudit.payload)).toMatchObject({ actorWallet: seller.address, actorRole: 'OWNER', confirmation: 'passes:bind' });

    // Single use: replaying the accepted proof is refused.
    expect((await confirmPass(created.body.passId, created.body.controlToken, customer.address, signature)).status).toBe(409);
  });

  it('cancels an open or pending bound pass and invalidates its session', async () => {
    const created = await createPass();
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
    const created = await createPass();
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
    expect((await passChallenge(created.body.passId, created.body.controlToken, customer.address)).status).toBe(409);
    expect((await fetch(`${baseUrl()}/api/passes/${created.body.passId}/cancel`, { method: 'POST', headers })).status).toBe(409);
  });

  it('never reports cancellation while leaving the checkout redeemed under a confirm race', async () => {
    const created = await createPass();
    const bound = await bindPass(seller, businessId, ruleId, created.body.passId);
    const { sessionId } = await bound.json() as { sessionId: string };
    const challenge = await (await passChallenge(created.body.passId, created.body.controlToken, customer.address))
      .json() as { message: string };
    const signature = await customer.signMessage(challenge.message);
    mockCheckLock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { eligible: true, lockedAmount: '2500.0' };
    });
    const headers = { authorization: `Bearer ${created.body.controlToken}` };
    const [confirmation, cancellation] = await Promise.all([
      confirmPass(created.body.passId, created.body.controlToken, customer.address, signature),
      fetch(`${baseUrl()}/api/passes/${created.body.passId}/cancel`, { method: 'POST', headers }),
    ]);
    expect([confirmation.status, cancellation.status].sort()).toEqual([200, 409]);
    const pass = await prisma.customerPass.findUniqueOrThrow({ where: { id: created.body.passId } });
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(`${pass.status}:${session.status}`).toMatch(/^(BOUND:REDEEMED|CANCELLED:REJECTED)$/);
  });

  it('rechecks checkout operator authorization inside the pass binding transaction', async () => {
    const operator = ethers.Wallet.createRandom();
    const row = await prisma.checkoutOperator.create({
      data: { businessId, walletAddress: operator.address, label: 'Revoked pass scanner' },
    });
    const created = await createPass();
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
