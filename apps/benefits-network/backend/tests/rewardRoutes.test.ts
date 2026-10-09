import { ethers } from 'ethers';

type TestWallet = ReturnType<typeof ethers.Wallet.createRandom>;

const mockGetRewardOnChainStatus = jest.fn();
const mockIsWalletAlreadyRewarded = jest.fn();

jest.mock('../src/services/rewardService', () => {
  const actual = jest.requireActual('../src/services/rewardService');
  return {
    ...actual,
    getRewardOnChainStatus: (...args: unknown[]) => mockGetRewardOnChainStatus(...args),
    isWalletAlreadyRewarded: (...args: unknown[]) => mockIsWalletAlreadyRewarded(...args),
  };
});

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
    CHAIN_ID: 1,
    SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://mock-rpc.example.com',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    PARTNER_VAULT_ADDRESS: '0x0000000000000000000000000000000000000002',
    BUILDER_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000003',
    REWARD_CALLER_ADDRESS: '0x0000000000000000000000000000000000000004',
    ADMIN_SECRET: 'test-secret-12345',
    DATABASE_URL: 'file:./test.db',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: 25,
    PORT: 0,
  },
}));

import { prisma, REWARD_BLOCKED_POLICY, REWARD_BLOCKED_POLICY_REASON } from '../src/services/sessionService';
import { server } from '../src/index';

const partnerId = `0x${'ab'.repeat(32)}`;
const owner = ethers.Wallet.createRandom();
const outsider = ethers.Wallet.createRandom();
const ADMIN = { authorization: 'Bearer test-secret-12345' };

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function sellerHeaders(wallet: TestWallet, action: string, businessId: string, scope = businessId) {
  const query = new URLSearchParams({ action, businessId });
  if (['rewards:apply', 'rewards:disable', 'rewards:reward-wallet', 'sessions:redeem', 'sessions:create', 'business:create'].includes(action)) {
    query.set('scope', scope);
  }
  const challengeResponse = await fetch(`${baseUrl()}/api/seller/auth-message?${query}`);
  expect(challengeResponse.status).toBe(200);
  const challenge = await challengeResponse.json() as {
    message: string;
    timestamp: string;
    nonce?: string;
  };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-ifr-wallet': wallet.address,
    'x-ifr-signature': await wallet.signMessage(challenge.message),
    'x-ifr-timestamp': challenge.timestamp,
  };
  if (challenge.nonce) headers['x-ifr-nonce'] = challenge.nonce;
  return headers;
}

// Owner decision B (T-231b): the seller opens the checkout (seller confirmation) and the customer's
// signed proof is the final redemption; there is no separate seller redeem step.
async function openCheckout(seller: TestWallet, businessId: string) {
  const response = await fetch(`${baseUrl()}/api/sessions`, {
    method: 'POST',
    headers: await sellerHeaders(seller, 'sessions:create', businessId, 'default'),
    body: JSON.stringify({ businessId }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { sessionId: string }).sessionId;
}

async function proveCheckout(sessionId: string, customer: TestWallet) {
  const challenge = await fetch(`${baseUrl()}/api/sessions/${sessionId}/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: customer.address }),
  });
  expect(challenge.status).toBe(200);
  const { message } = await challenge.json() as { message: string };
  const response = await fetch(`${baseUrl()}/api/attest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, walletAddress: customer.address, signature: await customer.signMessage(message) }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function redeemedSession(businessId: string, data: Record<string, unknown> = {}) {
  return prisma.session.create({
    data: {
      businessId,
      nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
      expiresAt: new Date(Date.now() + 60_000),
      status: 'REDEEMED',
      redeemedAt: new Date(),
      selfRedemption: false,
      ...data,
    },
  });
}

async function rewardWalletProof(signer: TestWallet, businessId: string, rewardWallet: string) {
  const query = new URLSearchParams({
    action: 'rewards:reward-wallet',
    businessId,
    scope: rewardWallet.toLowerCase(),
  });
  const challengeResponse = await fetch(`${baseUrl()}/api/seller/auth-message?${query}`);
  expect(challengeResponse.status).toBe(200);
  const challenge = await challengeResponse.json() as { message: string; timestamp: string; nonce: string };
  return {
    rewardWalletSignature: await signer.signMessage(challenge.message),
    rewardWalletTimestamp: challenge.timestamp,
    rewardWalletNonce: challenge.nonce,
  };
}

function chainStatus(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: new Date().toISOString(),
    blockNumber: 25_545_631,
    chainId: 1,
    contractCodeVerified: true,
    governanceAligned: true,
    partnerId,
    builderRegistered: true,
    builderActive: true,
    builderName: 'Verified shop',
    partnerExists: true,
    partnerActive: true,
    beneficiary: owner.address,
    expectedBeneficiary: owner.address,
    beneficiaryMatchesOwner: true,
    beneficiaryMatchesRewardWallet: true,
    maxAllocationRaw: ethers.parseUnits('1000000', 9).toString(),
    rewardAccruedRaw: '0',
    claimedTotalRaw: '0',
    vestedRaw: '0',
    claimableRaw: '0',
    rewardCallerConfigured: true,
    rewardCallerAuthorized: true,
    verified: true,
    submissionReady: true,
    reason: null,
    ...overrides,
  };
}

describe('Verified seller reward foundation', () => {
  let businessId: string;

  beforeEach(async () => {
    jest.clearAllMocks();
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
        name: 'Reward Test Shop',
        ownerAddress: owner.address,
        discountPercent: 10,
        requiredLockIFR: 1000,
      },
    });
    businessId = business.id;
    mockGetRewardOnChainStatus.mockResolvedValue(chainStatus());
    mockIsWalletAlreadyRewarded.mockResolvedValue(false);
    mockEligibility.mockResolvedValue({
      eligible: true,
      lockEligible: true,
      heldEligible: true,
      lockedAmount: '2500.0',
      walletAmount: '10.0',
      walletBalanceRaw: '10000000000000000000',
      ifrLockAmount: '2500.0',
      commitmentAmount: null,
      verifiedLockSource: 'ifrlock',
      verificationBlock: 123456,
    });
  });

  afterAll(async () => {
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

  it('keeps reward applications owner-only and does not self-verify sellers', async () => {
    const url = `${baseUrl()}/api/seller/businesses/${businessId}/rewards/apply`;
    expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    expect((await fetch(url, {
      method: 'POST',
      headers: await sellerHeaders(outsider, 'rewards:apply', businessId),
    })).status).toBe(403);

    const response = await fetch(url, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:apply', businessId),
    });
    expect(response.status).toBe(201);
    expect((await response.json() as { link: { status: string; partnerId: string | null } }).link)
      .toMatchObject({ status: 'APPLIED', partnerId: null });
    expect(mockGetRewardOnChainStatus).not.toHaveBeenCalled();
  });

  it('only verifies links when both governance contracts match the seller owner', async () => {
    await prisma.sellerRewardLink.create({ data: { businessId, builderWallet: owner.address } });
    const url = `${baseUrl()}/api/admin/businesses/${businessId}/rewards/verify`;
    expect((await fetch(url, { method: 'POST', body: JSON.stringify({ partnerId }) })).status).toBe(401);

    mockGetRewardOnChainStatus.mockResolvedValueOnce(chainStatus({
      verified: false,
      partnerActive: false,
      submissionReady: false,
      reason: 'PartnerVault partner is not active',
    }));
    const rejected = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(rejected.status).toBe(409);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } }))
      .toMatchObject({ status: 'APPLIED', partnerId: null });

    const verified = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(verified.status).toBe(200);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } }))
      .toMatchObject({ status: 'VERIFIED', partnerId: partnerId.toLowerCase(), builderWallet: owner.address });
  });

  it('creates one non-payable outbox row per customer proof and never makes it READY', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const customer = ethers.Wallet.createRandom();
    const first = await openCheckout(owner, businessId);
    const second = await openCheckout(owner, businessId);

    // The removed seller redeem step creates nothing.
    const legacyRedeem = await fetch(`${baseUrl()}/api/sessions/${first}/redeem`, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'sessions:redeem', businessId, first),
    });
    expect(legacyRedeem.status).toBe(410);
    expect(await prisma.rewardEvent.count()).toBe(0);

    for (const sessionId of [first, second]) {
      const proved = await proveCheckout(sessionId, customer);
      expect(proved.status).toBe(200);
      expect(proved.body).toMatchObject({ status: 'REDEEMED' });
    }
    // No per-wallet dedup any more: one row per session, created atomically with the redemption.
    const events = await prisma.rewardEvent.findMany({ orderBy: { sessionId: 'asc' } });
    expect(events.map((event) => event.sessionId).sort()).toEqual([first, second].sort());
    for (const event of events) {
      expect(event).toMatchObject({ businessId, partnerId, chainId: 1, status: REWARD_BLOCKED_POLICY, reason: REWARD_BLOCKED_POLICY_REASON });
      expect(event).not.toHaveProperty('customerWallet');
      expect(event).not.toHaveProperty('lockAmountRaw');
      expect(JSON.stringify(event).toLowerCase()).not.toContain(customer.address.toLowerCase().slice(2));
    }
    // A replayed proof of a redeemed session creates nothing.
    expect((await proveCheckout(first, customer)).status).not.toBe(200);
    expect(await prisma.rewardEvent.count()).toBe(2);

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: ADMIN,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ready: 0, confirmed: 0, blocked: 0, scanned: 0, submissionReady: false, reason: REWARD_BLOCKED_POLICY_REASON,
    });
    expect(mockIsWalletAlreadyRewarded).not.toHaveBeenCalled();
    expect(await prisma.rewardEvent.count({ where: { status: REWARD_BLOCKED_POLICY } })).toBe(2);

    const retry = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: ADMIN,
    });
    expect(retry.status).toBe(200);
    expect(await prisma.rewardEvent.count()).toBe(2);
    expect(await prisma.rewardEvent.count({ where: { status: REWARD_BLOCKED_POLICY } })).toBe(2);
  });

  it('redeems the benefit but creates no reward event for any seller-controlled customer wallet', async () => {
    const builder = ethers.Wallet.createRandom();
    const rewardWallet = ethers.Wallet.createRandom();
    const inactiveOperator = ethers.Wallet.createRandom();
    await prisma.sellerRewardLink.create({
      data: {
        businessId,
        status: 'VERIFIED',
        partnerId,
        builderWallet: builder.address,
        rewardWallet: rewardWallet.address,
        rewardWalletConfirmedAt: new Date(),
        verifiedAt: new Date(),
      },
    });
    // Self-redemption covers every checkout operator regardless of status.
    await prisma.checkoutOperator.create({ data: { businessId, walletAddress: inactiveOperator.address, active: false } });

    for (const selfWallet of [owner, inactiveOperator, rewardWallet, builder]) {
      const sessionId = await openCheckout(owner, businessId);
      const proved = await proveCheckout(sessionId, selfWallet);
      expect(proved.status).toBe(200);
      expect(proved.body).toMatchObject({ status: 'REDEEMED' });
      expect(await prisma.session.findUniqueOrThrow({ where: { id: sessionId } }))
        .toMatchObject({ status: 'REDEEMED', selfRedemption: true });
      expect(await prisma.rewardEvent.count({ where: { sessionId } })).toBe(0);
      expect(await prisma.auditLog.findFirst({ where: { sessionId, type: 'REWARD_SKIPPED_POLICY' } }))
        .not.toBeNull();
    }
    expect(await prisma.rewardEvent.count()).toBe(0);

    // A non-seller customer at the same shop still gets the (non-payable) outbox row.
    const customerSession = await openCheckout(owner, businessId);
    expect((await proveCheckout(customerSession, ethers.Wallet.createRandom())).status).toBe(200);
    expect(await prisma.session.findUniqueOrThrow({ where: { id: customerSession } })).toMatchObject({ selfRedemption: false });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: customerSession } }))
      .toMatchObject({ status: REWARD_BLOCKED_POLICY });
    expect(await prisma.auditLog.count({ where: { sessionId: customerSession, type: 'REWARD_SKIPPED_POLICY' } })).toBe(0);
  });

  it('fails closed and marks the local link stale when governance eligibility changes', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const session = await redeemedSession(businessId);
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: session.id,
        partnerId,
        chainId: 1,
        status: 'READY',
      },
    });
    mockGetRewardOnChainStatus.mockResolvedValueOnce(chainStatus({
      verified: false,
      builderActive: false,
      submissionReady: false,
      reason: 'Seller owner is not active in BuilderRegistry',
    }));
    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    });
    expect(response.status).toBe(409);
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: session.id } }))
      .toMatchObject({ status: 'BLOCKED_GOVERNANCE', reason: 'Seller owner is not active in BuilderRegistry' });
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } }))
      .toMatchObject({ status: 'STALE', reason: 'Seller owner is not active in BuilderRegistry' });
  });

  // Owner decision B: without a stored customer wallet the lock path cannot reconcile, so a
  // recovered governance/caller state no longer revives blocked events into READY.
  it('turns previously blocked lock-path events into BLOCKED_POLICY after governance and caller authorization recover', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const session = await redeemedSession(businessId);
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: session.id,
        partnerId,
        chainId: 1,
        status: 'BLOCKED_CALLER',
      },
    });
    mockGetRewardOnChainStatus.mockResolvedValueOnce(chainStatus({ submissionReady: true }));

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ready: 0, confirmed: 0, blocked: 1, scanned: 1, submissionReady: false, reason: REWARD_BLOCKED_POLICY_REASON,
    });
    expect(mockIsWalletAlreadyRewarded).not.toHaveBeenCalled();
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: session.id } }))
      .toMatchObject({ status: REWARD_BLOCKED_POLICY, reason: REWARD_BLOCKED_POLICY_REASON });
  });

  // Owner decision B: the walletRewardClaimed lookup needs the customer wallet, so a READY row is
  // never confirmed from chain state any more; it becomes non-payable BLOCKED_POLICY.
  it('never confirms a ready event from PartnerVault state and blocks it by policy instead', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const session = await redeemedSession(businessId);
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: session.id,
        partnerId,
        chainId: 1,
        status: 'READY',
      },
    });
    mockIsWalletAlreadyRewarded.mockResolvedValueOnce(true);

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ confirmed: 0, ready: 0, blocked: 1, scanned: 1, submissionReady: false });
    expect(mockIsWalletAlreadyRewarded).not.toHaveBeenCalled();
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: session.id } }))
      .toMatchObject({ status: REWARD_BLOCKED_POLICY, reason: REWARD_BLOCKED_POLICY_REASON });
  });

  it('blocks every open lock-path event, not only a reconciliation window', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const readySessions = Array.from({ length: 50 }, (_, index) => ({
      id: `ready-backlog-${index}`,
      businessId,
      nonce: (index + 1).toString(16).padStart(64, '0'),
      expiresAt: new Date(Date.now() + 60_000),
      status: 'REDEEMED',
      redeemedAt: new Date(),
      selfRedemption: false,
    }));
    await prisma.session.createMany({ data: readySessions });
    await prisma.rewardEvent.createMany({
      data: readySessions.map((session, index) => ({
        id: `ready-event-${index}`,
        businessId,
        sessionId: session.id,
        partnerId,
        chainId: 1,
        status: 'READY',
      })),
    });
    await redeemedSession(businessId, { id: 'pending-after-ready-backlog', nonce: 'ff'.repeat(32) });
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: 'pending-after-ready-backlog',
        partnerId,
        chainId: 1,
        status: 'PENDING',
      },
    });

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: 0, blocked: 51, scanned: 51, submissionReady: false });
    expect(mockIsWalletAlreadyRewarded).not.toHaveBeenCalled();
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: 'pending-after-ready-backlog' } }))
      .toMatchObject({ status: REWARD_BLOCKED_POLICY });
    expect(await prisma.rewardEvent.count({ where: { status: REWARD_BLOCKED_POLICY } })).toBe(51);
  }, 15_000);

  it('shows reward status only to the seller owner and never exposes signatures', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const session = await redeemedSession(businessId);
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: session.id,
        partnerId,
        chainId: 1,
        status: 'READY',
      },
    });
    const url = `${baseUrl()}/api/seller/businesses/${businessId}/rewards`;
    expect((await fetch(url, { headers: await sellerHeaders(outsider, 'rewards:read', businessId) })).status).toBe(403);
    const response = await fetch(url, { headers: await sellerHeaders(owner, 'rewards:read', businessId) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    const body = await response.json() as {
      link: { status: string; partnerId: string };
      onChain: { verified: boolean };
      eventCount: number;
    };
    expect(JSON.stringify(body)).not.toContain('signature');
    expect(JSON.stringify(body)).not.toMatch(/customerWallet|recoveredAddress|lockAmountRaw/);
    expect(body).not.toHaveProperty('events');
    expect(body.eventCount).toBe(1);
    expect(body).toMatchObject({ link: { status: 'VERIFIED', partnerId }, onChain: { verified: true } });
  });

  it('never auto-enrolls a freshly registered seller profile into rewards', async () => {
    const headers = await sellerHeaders(owner, 'business:create', 'new', 'new');
    const response = await fetch(`${baseUrl()}/api/seller/businesses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'No Auto Reward Shop',
        discountPercent: 5,
        requiredLockIFR: 100,
        ownerAddress: owner.address,
        signature: headers['x-ifr-signature'],
        timestamp: headers['x-ifr-timestamp'],
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string };
    expect(await prisma.sellerRewardLink.count({ where: { businessId: created.id } })).toBe(0);
    expect(await prisma.rewardEvent.count({ where: { businessId: created.id } })).toBe(0);
  });

  it('never lets governance verification create a reward application', async () => {
    mockGetRewardOnChainStatus.mockClear();
    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'Seller must submit a reward application before governance verification',
    });
    expect(mockGetRewardOnChainStatus).not.toHaveBeenCalled();
    expect(await prisma.sellerRewardLink.count({ where: { businessId } })).toBe(0);
  });

  it('does not overwrite a seller change that races an admin verification', async () => {
    const rewardWallet = ethers.Wallet.createRandom().address;
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'APPLIED', builderWallet: owner.address },
    });
    mockGetRewardOnChainStatus.mockImplementationOnce(async () => {
      await prisma.sellerRewardLink.update({
        where: { businessId },
        data: {
          status: 'APPLIED',
          rewardWallet,
          rewardWalletConfirmedAt: new Date(),
          reason: 'Seller changed payout wallet',
        },
      });
      return chainStatus();
    });

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'Seller reward configuration changed during verification; retry with the current state',
    });
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } })).toMatchObject({
      status: 'APPLIED',
      partnerId: null,
      rewardWallet,
      reason: 'Seller changed payout wallet',
    });
  });

  it('does not overwrite a revocation that races an admin verification', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'APPLIED', builderWallet: owner.address },
    });
    mockGetRewardOnChainStatus.mockImplementationOnce(async () => {
      await prisma.sellerRewardLink.update({
        where: { businessId },
        data: { status: 'REVOKED', reason: 'Revoked during verification' },
      });
      return chainStatus();
    });

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(response.status).toBe(409);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } })).toMatchObject({
      status: 'REVOKED',
      reason: 'Revoked during verification',
    });
  });

  it('keeps disable owner-only, stops outbox creation and queue, and allows a clean re-apply', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const disableUrl = `${baseUrl()}/api/seller/businesses/${businessId}/rewards/disable`;
    expect((await fetch(disableUrl, { method: 'POST' })).status).toBe(401);
    expect((await fetch(disableUrl, {
      method: 'POST',
      headers: await sellerHeaders(outsider, 'rewards:disable', businessId),
    })).status).toBe(403);

    const disabled = await fetch(disableUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:disable', businessId),
    });
    expect(disabled.status).toBe(200);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } }))
      .toMatchObject({ status: 'DISABLED', partnerId: null, verifiedAt: null });

    // A DISABLED link creates no new reward outbox rows on the final (customer-proof) redemption.
    const sessionId = await openCheckout(owner, businessId);
    const proved = await proveCheckout(sessionId, ethers.Wallet.createRandom());
    expect(proved.status).toBe(200);
    expect(proved.body).toMatchObject({ status: 'REDEEMED' });
    expect(await prisma.rewardEvent.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { sessionId, type: 'REWARD_SKIPPED_POLICY' } })).toBe(0);

    // The queue cannot progress and governance cannot verify a disabled link.
    expect((await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    })).status).toBe(409);
    mockGetRewardOnChainStatus.mockClear();
    const verifyWhileDisabled = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(verifyWhileDisabled.status).toBe(409);
    expect(await verifyWhileDisabled.json()).toMatchObject({ error: 'Seller rewards are disabled by the seller owner' });
    expect(mockGetRewardOnChainStatus).not.toHaveBeenCalled();

    // Re-applying returns to APPLIED with verification state cleared.
    const reapply = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rewards/apply`, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:apply', businessId),
    });
    expect(reapply.status).toBe(200);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } }))
      .toMatchObject({ status: 'APPLIED', partnerId: null, verifiedAt: null, verificationBlock: null });
  });

  it('keeps an admin-revoked reward link fail-closed until the owner reapplies', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'REVOKED', builderWallet: owner.address, reason: 'Revoked by test admin' },
    });
    mockGetRewardOnChainStatus.mockClear();
    const blocked = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: 'Seller reward link is revoked; a fresh seller application is required',
    });
    expect(mockGetRewardOnChainStatus).not.toHaveBeenCalled();
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } }))
      .toMatchObject({ status: 'REVOKED' });

    const reapplied = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rewards/apply`, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:apply', businessId),
    });
    expect(reapplied.status).toBe(200);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } }))
      .toMatchObject({ status: 'APPLIED' });
  });

  it('requires owner authorization plus a fresh business-bound reward wallet proof', async () => {
    const rewardWallet = ethers.Wallet.createRandom();
    const confirmUrl = `${baseUrl()}/api/seller/businesses/${businessId}/rewards/reward-wallet`;
    const proofWithoutLink = await rewardWalletProof(rewardWallet, businessId, rewardWallet.address);

    // A reward wallet cannot be set before the owner applied.
    const withoutLink = await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:reward-wallet', businessId, rewardWallet.address.toLowerCase()),
      body: JSON.stringify({
        rewardWallet: rewardWallet.address,
        ...proofWithoutLink,
      }),
    });
    expect(withoutLink.status).toBe(404);
    expect((await prisma.sellerAuthorizationChallenge.findUniqueOrThrow({
      where: { nonce: proofWithoutLink.rewardWalletNonce },
    })).consumedAt).toBeNull();

    await prisma.sellerRewardLink.create({ data: { businessId, builderWallet: owner.address } });

    // Missing proof fields are rejected by validation.
    expect((await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:reward-wallet', businessId, rewardWallet.address.toLowerCase()),
      body: JSON.stringify({ rewardWallet: rewardWallet.address }),
    })).status).toBe(400);

    // Mixed-case addresses with an invalid checksum fail validation, not the server.
    const invalidChecksum = '0x52908400098527886e0F7030069857D2E4169EE7';
    expect((await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:reward-wallet', businessId, invalidChecksum.toLowerCase()),
      body: JSON.stringify({ rewardWallet: invalidChecksum }),
    })).status).toBe(400);

    // Only the owner may confirm a reward wallet.
    expect((await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(outsider, 'rewards:reward-wallet', businessId, rewardWallet.address.toLowerCase()),
      body: JSON.stringify({
        rewardWallet: rewardWallet.address,
        ...(await rewardWalletProof(rewardWallet, businessId, rewardWallet.address)),
      }),
    })).status).toBe(403);

    // A proof signed by any other wallet than the proposed reward wallet fails.
    expect((await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:reward-wallet', businessId, rewardWallet.address.toLowerCase()),
      body: JSON.stringify({
        rewardWallet: rewardWallet.address,
        ...(await rewardWalletProof(outsider, businessId, rewardWallet.address)),
      }),
    })).status).toBe(401);

    // A proof challenge issued for another business is not accepted here.
    const otherBusiness = await prisma.business.create({
      data: { name: 'Other Shop', ownerAddress: owner.address, discountPercent: 5, requiredLockIFR: 100 },
    });
    expect((await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:reward-wallet', businessId, rewardWallet.address.toLowerCase()),
      body: JSON.stringify({
        rewardWallet: rewardWallet.address,
        ...(await rewardWalletProof(rewardWallet, otherBusiness.id, rewardWallet.address)),
      }),
    })).status).toBe(401);

    // The owner wallet itself is never a separate reward wallet.
    expect((await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:reward-wallet', businessId, owner.address.toLowerCase()),
      body: JSON.stringify({
        rewardWallet: owner.address,
        ...(await rewardWalletProof(owner, businessId, owner.address)),
      }),
    })).status).toBe(400);

    // Successful dual authorization stores the wallet and never touches the chain.
    mockGetRewardOnChainStatus.mockClear();
    const proof = await rewardWalletProof(rewardWallet, businessId, rewardWallet.address);
    const ownerHeaders = await sellerHeaders(owner, 'rewards:reward-wallet', businessId, rewardWallet.address.toLowerCase());
    const confirmed = await fetch(confirmUrl, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ rewardWallet: rewardWallet.address, ...proof }),
    });
    expect(confirmed.status).toBe(200);
    const link = await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } });
    expect(link).toMatchObject({ status: 'APPLIED', rewardWallet: rewardWallet.address });
    expect(link.rewardWalletConfirmedAt).not.toBeNull();
    expect(JSON.stringify(await confirmed.json())).not.toContain(proof.rewardWalletSignature);
    expect(mockGetRewardOnChainStatus).not.toHaveBeenCalled();

    // The identical request cannot be replayed: both single-use challenges are consumed.
    const replay = await fetch(confirmUrl, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ rewardWallet: rewardWallet.address, ...proof }),
    });
    expect(replay.status).toBe(401);
    const replayedLink = await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } });
    expect(replayedLink.rewardWallet).toBe(rewardWallet.address);

    // The owner can explicitly return payouts to the owner wallet without a second-wallet proof.
    const cleared = await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:reward-wallet', businessId, 'owner-wallet'),
      body: JSON.stringify({ rewardWallet: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } })).toMatchObject({
      status: 'APPLIED',
      partnerId: null,
      rewardWallet: null,
      rewardWalletConfirmedAt: null,
    });
  });

  it('verifies the PartnerVault beneficiary against the confirmed reward wallet', async () => {
    const rewardWallet = ethers.Wallet.createRandom();
    await prisma.sellerRewardLink.create({
      data: { businessId, builderWallet: owner.address, rewardWallet: rewardWallet.address, rewardWalletConfirmedAt: new Date() },
    });
    const url = `${baseUrl()}/api/admin/businesses/${businessId}/rewards/verify`;

    // A beneficiary that only matches the owner no longer verifies.
    mockGetRewardOnChainStatus.mockResolvedValueOnce(chainStatus({
      verified: false,
      beneficiary: owner.address,
      beneficiaryMatchesRewardWallet: false,
      submissionReady: false,
      reason: 'PartnerVault beneficiary does not match the confirmed seller reward wallet',
    }));
    const mismatched = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(mismatched.status).toBe(409);
    expect(mockGetRewardOnChainStatus).toHaveBeenCalledWith(owner.address, partnerId, rewardWallet.address);

    // The beneficiary matching the confirmed reward wallet verifies.
    mockGetRewardOnChainStatus.mockResolvedValueOnce(chainStatus({
      beneficiary: rewardWallet.address,
      expectedBeneficiary: rewardWallet.address,
      beneficiaryMatchesOwner: false,
    }));
    const verified = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(verified.status).toBe(200);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } }))
      .toMatchObject({ status: 'VERIFIED', partnerId: partnerId.toLowerCase(), rewardWallet: rewardWallet.address });
  });

  it('keeps existing links without a reward wallet owner-compatible', async () => {
    await prisma.sellerRewardLink.create({ data: { businessId, builderWallet: owner.address } });
    const verified = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret-12345' },
      body: JSON.stringify({ partnerId }),
    });
    expect(verified.status).toBe(200);
    expect(mockGetRewardOnChainStatus).toHaveBeenCalledWith(owner.address, partnerId, null);
    const link = await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } });
    expect(link).toMatchObject({ status: 'VERIFIED', rewardWallet: null, rewardWalletConfirmedAt: null });
  });

  it('invalidates verification and blocks actionable events when the reward wallet changes', async () => {
    const firstWallet = ethers.Wallet.createRandom();
    const nextWallet = ethers.Wallet.createRandom();
    await prisma.sellerRewardLink.create({
      data: {
        businessId,
        status: 'VERIFIED',
        partnerId,
        builderWallet: owner.address,
        verifiedAt: new Date(),
        rewardWallet: firstWallet.address,
        rewardWalletConfirmedAt: new Date(),
      },
    });
    const readySession = await redeemedSession(businessId);
    const confirmedSession = await redeemedSession(businessId);
    const policySession = await redeemedSession(businessId);
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: readySession.id,
        partnerId,
        chainId: 1,
        status: 'READY',
      },
    });
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: confirmedSession.id,
        partnerId: `0x${'cd'.repeat(32)}`,
        chainId: 1,
        status: 'CONFIRMED',
      },
    });
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: policySession.id,
        partnerId,
        chainId: 1,
        status: REWARD_BLOCKED_POLICY,
        reason: REWARD_BLOCKED_POLICY_REASON,
      },
    });

    const confirmUrl = `${baseUrl()}/api/seller/businesses/${businessId}/rewards/reward-wallet`;
    const changed = await fetch(confirmUrl, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:reward-wallet', businessId, nextWallet.address.toLowerCase()),
      body: JSON.stringify({
        rewardWallet: nextWallet.address,
        ...(await rewardWalletProof(nextWallet, businessId, nextWallet.address)),
      }),
    });
    expect(changed.status).toBe(200);
    expect(await prisma.sellerRewardLink.findUniqueOrThrow({ where: { businessId } })).toMatchObject({
      status: 'APPLIED',
      partnerId: null,
      verifiedAt: null,
      rewardWallet: nextWallet.address,
    });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: readySession.id } }))
      .toMatchObject({ status: 'BLOCKED_GOVERNANCE' });
    // Already confirmed events remain historical; non-payable policy rows stay non-payable.
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: confirmedSession.id } }))
      .toMatchObject({ status: 'CONFIRMED' });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: policySession.id } }))
      .toMatchObject({ status: REWARD_BLOCKED_POLICY });
  });

  it('never advances blocked events from a previous partner link', async () => {
    const previousPartnerId = `0x${'ef'.repeat(32)}`;
    await prisma.sellerRewardLink.create({
      data: {
        businessId,
        status: 'VERIFIED',
        partnerId,
        builderWallet: owner.address,
        verifiedAt: new Date(),
      },
    });
    const previousSession = await redeemedSession(businessId);
    const currentSession = await redeemedSession(businessId);
    await prisma.rewardEvent.createMany({
      data: [
        {
          businessId,
          sessionId: previousSession.id,
          partnerId: previousPartnerId,
          chainId: 1,
          status: 'BLOCKED_GOVERNANCE',
          reason: 'Previous partner link invalidated',
        },
        {
          businessId,
          sessionId: currentSession.id,
          partnerId,
          chainId: 1,
          status: 'PENDING',
        },
      ],
    });

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scanned: 1, blocked: 1, ready: 0 });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: previousSession.id } }))
      .toMatchObject({ status: 'BLOCKED_GOVERNANCE', reason: 'Previous partner link invalidated' });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: currentSession.id } }))
      .toMatchObject({ status: REWARD_BLOCKED_POLICY });
  });
});
