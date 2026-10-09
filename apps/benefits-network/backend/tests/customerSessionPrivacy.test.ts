/**
 * T-231b / owner decision B: storage-free customer sessions.
 *
 * Covers: explicit claimed-wallet binding, cross-shop/session/chain/audience/terms/expiry
 * substitution, single use under concurrency/retry/restart, failure paths leaving the checkout OPEN,
 * fresh eligibility at the final redemption, seller confirmation inside the atomic transition,
 * self-redemption, device receipt verification and a DB-wide + log scan for customer data.
 * All data is dummy data.
 */
import { createHash } from 'crypto';
import { ethers } from 'ethers';
import * as authenticatedRateLimiter from '../src/services/authenticatedRateLimiter';

jest.setTimeout(30_000);

const mockEligibility = jest.fn();

jest.mock('../src/services/ifrLockService', () => {
  const actual = jest.requireActual('ethers');
  return {
    checkLock: jest.fn(),
    checkBenefitEligibility: (...args: unknown[]) => mockEligibility(...args),
    recoverSigner: (message: string, signature: string) => actual.verifyMessage(message, signature),
    initProvider: jest.fn(),
  };
});

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

import { CHECKOUT_PROOF_VERSION_LABEL, prisma } from '../src/services/sessionService';
// Cross-check the device-side parser against the server derivation (no aliases, dependency-free).
import { canonicalTermsJson, parseCheckoutProof } from '../../frontend/src/lib/checkoutProof';
import { server } from '../src/index';

type Wallet = ReturnType<typeof ethers.Wallet.createRandom>;

function eligible(verifiedLockSource = 'ifrlock') {
  return {
    eligible: true,
    lockEligible: true,
    heldEligible: true,
    lockedAmount: '2500.0',
    walletAmount: '10.0',
    walletBalanceRaw: '10000000000000000000',
    ifrLockAmount: '2500.0',
    commitmentAmount: null,
    verifiedLockSource,
    verificationBlock: 123456,
  };
}

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function sellerHeaders(wallet: Wallet, action: string, businessId: string, scope: string) {
  const query = new URLSearchParams({ action, businessId, scope });
  const response = await fetch(`${baseUrl()}/api/seller/auth-message?${query}`);
  expect(response.status).toBe(200);
  const challenge = await response.json() as { message: string; timestamp: string; nonce: string };
  return {
    'content-type': 'application/json',
    'x-ifr-wallet': wallet.address,
    'x-ifr-signature': await wallet.signMessage(challenge.message),
    'x-ifr-timestamp': challenge.timestamp,
    'x-ifr-nonce': challenge.nonce,
  };
}

async function openCheckout(seller: Wallet, businessId: string, benefitRuleId?: string) {
  const response = await fetch(`${baseUrl()}/api/sessions`, {
    method: 'POST',
    headers: await sellerHeaders(seller, 'sessions:create', businessId, benefitRuleId || 'default'),
    body: JSON.stringify({ businessId, benefitRuleId }),
  });
  const body = await response.json() as { sessionId: string; error?: string };
  return { status: response.status, body };
}

async function challengeFor(sessionId: string, wallet: string) {
  const response = await fetch(`${baseUrl()}/api/sessions/${sessionId}/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: wallet }),
  });
  expect(response.status).toBe(200);
  return (await response.json() as { message: string }).message;
}

async function postProof(sessionId: string, walletAddress: string, signature: string) {
  const response = await fetch(`${baseUrl()}/api/attest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, walletAddress, signature }),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function sessionState(sessionId: string) {
  return prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
}

async function resetDb() {
  await prisma.rewardEvent.deleteMany();
  await prisma.sellerRewardLink.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.customerPass.deleteMany();
  await prisma.sellerAuthorizationChallenge.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.checkoutOperator.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.business.deleteMany();
}

const seller = ethers.Wallet.createRandom();
const operator = ethers.Wallet.createRandom();
const customer = ethers.Wallet.createRandom();
const other = ethers.Wallet.createRandom();
let businessId: string;
let otherBusinessId: string;
let limiterSpy: jest.SpyInstance;
const logLines: string[] = [];
const consoleSpies: jest.SpyInstance[] = [];

beforeAll(() => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logLines.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    }));
  }
});

beforeEach(async () => {
  limiterSpy = jest.spyOn(authenticatedRateLimiter, 'assertSellerWalletActionAllowed').mockResolvedValue(undefined);
  mockEligibility.mockReset();
  mockEligibility.mockResolvedValue(eligible());
  await resetDb();
  businessId = (await prisma.business.create({
    data: { name: 'Privacy Shop', ownerAddress: seller.address, discountPercent: 10, requiredLockIFR: 1000, ttlSeconds: 300 },
  })).id;
  otherBusinessId = (await prisma.business.create({
    data: { name: 'Other Shop', ownerAddress: seller.address, discountPercent: 50, requiredLockIFR: 1, ttlSeconds: 300 },
  })).id;
});

afterEach(() => limiterSpy.mockRestore());

afterAll(async () => {
  for (const spy of consoleSpies) spy.mockRestore();
  await resetDb();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('checkout proof v2 binding', () => {
  it('derives a versioned text bound to wallet, audience, chain, shop, session, expiry and terms without storing anything', async () => {
    const { body } = await openCheckout(seller, businessId);
    const auditBefore = await prisma.auditLog.count();
    const message = await challengeFor(body.sessionId, customer.address);
    const lines = message.split('\n');
    const session = await sessionState(body.sessionId);

    expect(lines).toEqual(expect.arrayContaining([
      `Version: ${CHECKOUT_PROOF_VERSION_LABEL}`,
      `Wallet: ${customer.address}`,
      'Audience: shop.example.test',
      'Chain ID: 11155111',
      `Shop: ${businessId}`,
      `Session: ${body.sessionId}`,
      `Nonce: ${session.nonce}`,
      `Expires: ${session.expiresAt.toISOString()}`,
      'Discount Percent: 10',
    ]));
    expect(lines.some((line) => /^Terms Digest: sha256:[0-9a-f]{64}$/.test(line))).toBe(true);
    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect((await sessionState(body.sessionId)).status).toBe('PENDING');
  });

  it('rejects a valid signature from wallet X presented as wallet Y with an explicit mismatch', async () => {
    const { body } = await openCheckout(seller, businessId);
    const messageForY = await challengeFor(body.sessionId, other.address);
    const signatureByX = await customer.signMessage(messageForY);

    const result = await postProof(body.sessionId, other.address, signatureByX);

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('Customer signature does not match the claimed wallet address');
    expect(mockEligibility).not.toHaveBeenCalled();
    expect((await sessionState(body.sessionId)).status).toBe('PENDING');
  });

  it.each([
    ['shop', (m: string) => m.replace(/^Shop: .*$/m, 'Shop: other-shop')],
    ['session', (m: string) => m.replace(/^Session: .*$/m, 'Session: other-session')],
    ['chain', (m: string) => m.replace(/^Chain ID: .*$/m, 'Chain ID: 1')],
    ['audience', (m: string) => m.replace(/^Audience: .*$/m, 'Audience: evil.example')],
    ['terms', (m: string) => m.replace(/^Discount Percent: .*$/m, 'Discount Percent: 90')],
    ['terms digest', (m: string) => m.replace(/^Terms Digest: .*$/m, `Terms Digest: sha256:${'0'.repeat(64)}`)],
    ['expiry', (m: string) => m.replace(/^Expires: .*$/m, 'Expires: 2099-01-01T00:00:00.000Z')],
    ['version', (m: string) => m.replace(/^Version: .*$/m, 'Version: ifr-benefits/checkout-proof/1')],
  ])('rejects a tampered %s with an explicit mismatch and leaves the checkout OPEN', async (_label, tamper) => {
    const { body } = await openCheckout(seller, businessId);
    const genuine = await challengeFor(body.sessionId, customer.address);
    const tampered = tamper(genuine);
    expect(tampered).not.toBe(genuine);
    const signature = await customer.signMessage(tampered);

    const result = await postProof(body.sessionId, customer.address, signature);

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('Customer signature does not match the claimed wallet address');
    expect(mockEligibility).not.toHaveBeenCalled();
    const state = await sessionState(body.sessionId);
    expect(state.status).toBe('PENDING');
    expect(state.attestAttempts).toBe(0);
  });

  it('rejects a proof signed for another shop or another checkout (cross-shop/session substitution)', async () => {
    const first = (await openCheckout(seller, businessId)).body.sessionId;
    const foreign = (await openCheckout(seller, otherBusinessId)).body.sessionId;
    const signatureForForeign = await customer.signMessage(await challengeFor(foreign, customer.address));

    const result = await postProof(first, customer.address, signatureForForeign);

    expect(result.status).toBe(403);
    expect((await sessionState(first)).status).toBe('PENDING');
    expect((await sessionState(foreign)).status).toBe('PENDING');
  });

  it('rejects a malformed claimed wallet before any work', async () => {
    const { body } = await openCheckout(seller, businessId);
    const response = await fetch(`${baseUrl()}/api/sessions/${body.sessionId}/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAddress: 'not-a-wallet' }),
    });
    expect(response.status).toBe(400);
    // The address never travels in a URL (access logs): the GET form is gone.
    const legacyGet = await fetch(`${baseUrl()}/api/sessions/${body.sessionId}/challenge?wallet=${customer.address}`);
    expect(legacyGet.status).toBe(410);
  });
});

describe('atomic single-use redemption', () => {
  it('redeems once with fresh eligibility and records the seller confirmation in the same transaction', async () => {
    const { body } = await openCheckout(seller, businessId);
    const message = await challengeFor(body.sessionId, customer.address);
    const signature = await customer.signMessage(message);

    const result = await postProof(body.sessionId, customer.address, signature);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('REDEEMED');
    expect(mockEligibility).toHaveBeenCalledTimes(1);
    expect(mockEligibility.mock.calls[0][0]).toBe(customer.address);
    const state = await sessionState(body.sessionId);
    expect(state).toMatchObject({ status: 'REDEEMED', selfRedemption: false, proofVersion: 2, verifiedLockSource: 'ifrlock' });
    expect(state.redeemedAt).toBeInstanceOf(Date);
    const redeemedAudit = await prisma.auditLog.findMany({ where: { sessionId: body.sessionId, type: 'REDEEMED' } });
    expect(redeemedAudit).toHaveLength(1);
    expect(JSON.parse(redeemedAudit[0].payload)).toMatchObject({ actorWallet: seller.address, actorRole: 'OWNER', confirmation: 'sessions:create' });

    const status = await (await fetch(`${baseUrl()}/api/sessions/${body.sessionId}`)).json() as { status: string };
    expect(status.status).toBe('REDEEMED');
  });

  it('lets exactly one of two parallel proofs succeed and rejects later retries', async () => {
    const { body } = await openCheckout(seller, businessId);
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));

    const results = await Promise.all([
      postProof(body.sessionId, customer.address, signature),
      postProof(body.sessionId, customer.address, signature),
    ]);
    const statuses = results.map((item) => item.status).sort();
    expect(statuses).toEqual([200, 409]);

    const retry = await postProof(body.sessionId, customer.address, signature);
    expect(retry.status).toBe(409);
    expect(await prisma.auditLog.count({ where: { sessionId: body.sessionId, type: 'REDEEMED' } })).toBe(1);
  });

  it('keeps single use across a simulated restart (fresh module registry and Prisma client)', async () => {
    const { body } = await openCheckout(seller, businessId);
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));
    expect((await postProof(body.sessionId, customer.address, signature)).status).toBe(200);

    let restartedAttest: typeof import('../src/services/sessionService').attest | undefined;
    let restartedPrisma: typeof prisma | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const restarted = require('../src/services/sessionService') as typeof import('../src/services/sessionService');
      restartedAttest = restarted.attest;
      restartedPrisma = restarted.prisma;
    });
    expect(restartedPrisma).not.toBe(prisma);
    await expect(restartedAttest!(body.sessionId, customer.address, signature)).rejects.toThrow(/REDEEMED|already redeemed/);
    await restartedPrisma!.$disconnect();
    expect(await prisma.auditLog.count({ where: { sessionId: body.sessionId, type: 'REDEEMED' } })).toBe(1);
  });

  it('expires on the server clock and refuses the proof', async () => {
    const { body } = await openCheckout(seller, businessId);
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));
    await prisma.session.update({ where: { id: body.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await postProof(body.sessionId, customer.address, signature);

    expect(result.status).toBe(409);
    expect((await sessionState(body.sessionId)).status).not.toBe('REDEEMED');
  });
});

describe('failures leave the checkout OPEN', () => {
  it('ineligible wallet: no state change, no audit', async () => {
    mockEligibility.mockResolvedValue({ ...eligible(), eligible: false, lockEligible: false, verifiedLockSource: null, ifrLockAmount: '1.0' });
    const { body } = await openCheckout(seller, businessId);
    const auditBefore = await prisma.auditLog.count({ where: { sessionId: body.sessionId } });
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));

    const result = await postProof(body.sessionId, customer.address, signature);

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('REJECTED');
    const state = await sessionState(body.sessionId);
    expect(state.status).toBe('PENDING');
    expect(state.attestAttempts).toBe(0);
    expect(await prisma.auditLog.count({ where: { sessionId: body.sessionId } })).toBe(auditBefore);
  });

  it('RPC failure: generic error without the address, nothing logged with customer data', async () => {
    mockEligibility.mockRejectedValue(new Error(`call revert exception data="0x70a08231000000000000000000000000${customer.address.slice(2).toLowerCase()}"`));
    const { body } = await openCheckout(seller, businessId);
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));

    const result = await postProof(body.sessionId, customer.address, signature);

    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body).toLowerCase()).not.toContain(customer.address.slice(2).toLowerCase());
    expect((await sessionState(body.sessionId)).status).toBe('PENDING');
  });

  it('seller authority revoked after opening: refused inside the transaction, stays OPEN', async () => {
    const op = await prisma.checkoutOperator.create({ data: { businessId, walletAddress: operator.address, active: true } });
    const { body, status } = await openCheckout(operator, businessId);
    expect(status).toBe(201);
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));
    await prisma.checkoutOperator.update({ where: { id: op.id }, data: { active: false } });

    const result = await postProof(body.sessionId, customer.address, signature);

    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/no longer authorized/);
    expect((await sessionState(body.sessionId)).status).toBe('PENDING');
  });

  it('a checkout without a seller confirmation cannot be redeemed', async () => {
    // Pre-cutover shape: an open checkout without a recorded seller confirmation.
    const { body } = await openCheckout(seller, businessId);
    const session = await prisma.session.update({
      where: { id: body.sessionId },
      data: { confirmedByWallet: null, confirmedByRole: null, confirmedByOperatorId: null },
    });
    const signature = await customer.signMessage(await challengeFor(session.id, customer.address));

    const result = await postProof(session.id, customer.address, signature);

    expect(result.status).toBe(409);
    expect((await sessionState(session.id)).status).toBe('PENDING');
  });
});

describe('self-redemption and reward outcome', () => {
  async function verifiedLink(extra: { rewardWallet?: string; builderWallet?: string } = {}) {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId: `0x${'ab'.repeat(32)}`, ...extra },
    });
  }

  it('flags the owner, any operator and reward/builder wallets as self-redemption and skips the reward', async () => {
    const rewardWallet = ethers.Wallet.createRandom();
    const inactiveOperator = ethers.Wallet.createRandom();
    await verifiedLink({ rewardWallet: rewardWallet.address });
    await prisma.checkoutOperator.create({ data: { businessId, walletAddress: inactiveOperator.address, active: false } });

    for (const wallet of [seller, rewardWallet, inactiveOperator]) {
      const { body } = await openCheckout(seller, businessId);
      const signature = await wallet.signMessage(await challengeFor(body.sessionId, wallet.address));
      const result = await postProof(body.sessionId, wallet.address, signature);
      expect(result.status).toBe(200);
      expect((await sessionState(body.sessionId)).selfRedemption).toBe(true);
      expect(await prisma.rewardEvent.count({ where: { sessionId: body.sessionId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { sessionId: body.sessionId, type: 'REWARD_SKIPPED_POLICY' } })).toBe(1);
    }
  });

  it('records only a non-payable BLOCKED_POLICY outcome for a regular customer', async () => {
    await verifiedLink();
    const { body } = await openCheckout(seller, businessId);
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));
    expect((await postProof(body.sessionId, customer.address, signature)).status).toBe(200);

    const events = await prisma.rewardEvent.findMany({ where: { sessionId: body.sessionId } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('BLOCKED_POLICY');
  });
});

describe('device-local receipt', () => {
  it('returns a receipt that verifies offline against the full address inside the signed text', async () => {
    const { body } = await openCheckout(seller, businessId);
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));
    const result = await postProof(body.sessionId, customer.address, signature);
    const proof = result.body.proof as { message: string; sessionId: string; businessId: string; version: string; termsDigest: string };

    const walletLine = proof.message.split('\n').find((line) => line.startsWith('Wallet: '))!;
    const fullAddress = walletLine.slice('Wallet: '.length);
    expect(ethers.verifyMessage(proof.message, signature)).toBe(fullAddress);
    expect(proof.message).toContain(`Session: ${proof.sessionId}`);
    expect(proof.message).toContain(`Shop: ${proof.businessId}`);
    expect(proof.message).toContain(`Terms Digest: ${proof.termsDigest}`);
    expect(proof.version).toBe(CHECKOUT_PROOF_VERSION_LABEL);
    const parsed = parseCheckoutProof(proof.message);
    expect(parsed).not.toBeNull();
    expect(parsed!.wallet).toBe(customer.address);
    expect(parsed!.terms.discountPercent).toBe(10);
    expect(`sha256:${createHash('sha256').update(canonicalTermsJson(parsed!.terms)).digest('hex')}`).toBe(proof.termsDigest);
    // A redacted display label alone is not a verification input.
    expect(ethers.verifyMessage(proof.message, signature)).not.toBe(`${fullAddress.slice(0, 6)}...${fullAddress.slice(-4)}`);
  });
});

describe('per-customer limits are not IFR-hosted', () => {
  it('refuses non-zero limits on rule create and refuses to open a checkout for a legacy limited rule', async () => {
    const create = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rules`, {
      method: 'POST',
      headers: await sellerHeaders(seller, 'rules:create', businessId, businessId),
      body: JSON.stringify({ label: 'Limited', category: 'Coffee', productName: 'Espresso', discountPercent: 10, requiredLockIFR: 1000, dailyRedemptionLimit: 1 }),
    });
    expect(create.status).toBe(400);

    const legacy = await prisma.benefitRule.create({
      data: { businessId, label: 'Legacy', category: 'Coffee', productName: 'Espresso', discountPercent: 10, requiredLockIFR: 1000, monthlyRedemptionLimit: 3 },
    });
    const opened = await openCheckout(seller, businessId, legacy.id);
    expect(opened.status).toBe(409);
    expect(opened.body.error).toMatch(/not enforced by IFR|no longer enforced by IFR/);
  });
});

describe('per-customer limits in an existing snapshot', () => {
  it('fails closed for an open checkout whose snapshot still carries a limit', async () => {
    const { body } = await openCheckout(seller, businessId);
    await prisma.session.update({ where: { id: body.sessionId }, data: { benefitDailyRedemptionLimit: 1 } });
    const signature = await customer.signMessage(await challengeFor(body.sessionId, customer.address));

    const result = await postProof(body.sessionId, customer.address, signature);

    expect(result.status).toBe(409);
    expect(mockEligibility).not.toHaveBeenCalled();
    expect((await sessionState(body.sessionId)).status).toBe('PENDING');
  });
});

describe('removed customer-linked endpoints', () => {
  it('answers 410 for server history, pass wallet challenges and the separate seller redeem', async () => {
    const { body } = await openCheckout(seller, businessId);
    const responses = await Promise.all([
      fetch(`${baseUrl()}/api/customer/history`),
      fetch(`${baseUrl()}/api/customer/history/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ walletAddress: customer.address }) }),
      fetch(`${baseUrl()}/api/passes/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ walletAddress: customer.address }) }),
      fetch(`${baseUrl()}/api/sessions/${body.sessionId}/redeem`, { method: 'POST' }),
    ]);
    expect(responses.map((item) => item.status)).toEqual([410, 410, 410, 410]);
  });
});

describe('no customer wallet or derivative in any table or log after full flows', () => {
  it('scans every table and every captured log line', async () => {
    await prisma.sellerRewardLink.create({ data: { businessId, status: 'VERIFIED', partnerId: `0x${'cd'.repeat(32)}` } });
    // Seller-QR flow.
    const qr = await openCheckout(seller, businessId);
    const qrSignature = await customer.signMessage(await challengeFor(qr.body.sessionId, customer.address));
    expect((await postProof(qr.body.sessionId, customer.address, qrSignature)).status).toBe(200);
    // Failed attempts must not leave traces either.
    mockEligibility.mockRejectedValueOnce(new Error(`rpc failed for ${customer.address}`));
    const failed = await openCheckout(seller, businessId);
    const failedSignature = await customer.signMessage(await challengeFor(failed.body.sessionId, customer.address));
    expect((await postProof(failed.body.sessionId, customer.address, failedSignature)).status).toBe(503);
    // Customer-pass flow.
    const created = await fetch(`${baseUrl()}/api/passes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(created.status).toBe(201);
    const pass = await created.json() as { passId: string; controlToken: string };
    const bindScope = `${pass.passId}:${(await prisma.benefitRule.create({ data: { businessId, label: 'Pass rule', category: 'Coffee', productName: 'Latte', discountPercent: 5, requiredLockIFR: 100 } })).id}`;
    const ruleId = bindScope.split(':')[1];
    const bind = await fetch(`${baseUrl()}/api/passes/${pass.passId}/bind`, {
      method: 'POST',
      headers: await sellerHeaders(seller, 'passes:bind', businessId, bindScope),
      body: JSON.stringify({ businessId, benefitRuleId: ruleId }),
    });
    expect(bind.status).toBe(201);
    const control = { 'content-type': 'application/json', authorization: `Bearer ${pass.controlToken}` };
    const passChallenge = await fetch(`${baseUrl()}/api/passes/${pass.passId}/challenge`, { method: 'POST', headers: control, body: JSON.stringify({ walletAddress: customer.address }) });
    expect(passChallenge.status).toBe(200);
    const passMessage = (await passChallenge.json() as { message: string }).message;
    const passSignature = await customer.signMessage(passMessage);
    const confirm = await fetch(`${baseUrl()}/api/passes/${pass.passId}/confirm`, { method: 'POST', headers: control, body: JSON.stringify({ walletAddress: customer.address, signature: passSignature }) });
    expect(confirm.status).toBe(200);
    expect((await confirm.json() as { status: string }).status).toBe('REDEEMED');

    const address = customer.address;
    const bare = address.slice(2).toLowerCase();
    const needles = [
      bare,
      address.slice(2),
      createHash('sha256').update(address.toLowerCase()).digest('hex'),
      createHash('sha256').update(address).digest('hex'),
      ethers.keccak256(ethers.toUtf8Bytes(address.toLowerCase())).slice(2),
      ethers.keccak256(address).slice(2),
      qrSignature.slice(2, 66).toLowerCase(),
      passSignature.slice(2, 66).toLowerCase(),
      bare.slice(0, 4) + '...' + bare.slice(-4),
      `${address.slice(0, 6)}...${address.slice(-4)}`.toLowerCase(),
    ];

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    expect(tables.map((table) => table.name)).not.toEqual(expect.arrayContaining(['CustomerPassChallenge', 'CustomerHistoryChallenge', 'CustomerHistoryAccess']));
    let dump = '';
    for (const { name } of tables) {
      const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${name}"`);
      dump += JSON.stringify(rows, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
    }
    const lowerDump = dump.toLowerCase();
    expect(lowerDump.length).toBeGreaterThan(100);
    for (const needle of needles) expect(lowerDump).not.toContain(needle.toLowerCase());
    expect(lowerDump).not.toContain('wallet: 0x');

    const logs = logLines.join('\n').toLowerCase();
    for (const needle of needles) expect(logs).not.toContain(needle.toLowerCase());

    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM pragma_table_info('Session') UNION SELECT name FROM pragma_table_info('RewardEvent') UNION SELECT name FROM pragma_table_info('CustomerPass')"
    );
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining(['recoveredAddress', 'customerWallet', 'walletAddress', 'lockAmountRaw', 'walletBalanceRaw', 'verificationBlock']));
  });
});
