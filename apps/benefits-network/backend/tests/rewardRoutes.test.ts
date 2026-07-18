import { ethers } from 'ethers';

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

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
  recoverSigner: jest.fn(),
  initProvider: jest.fn(),
}));

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 1,
    RPC_URL: 'https://mock-rpc.example.com',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    PARTNER_VAULT_ADDRESS: '0x0000000000000000000000000000000000000002',
    BUILDER_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000003',
    REWARD_CALLER_ADDRESS: '0x0000000000000000000000000000000000000004',
    ADMIN_SECRET: 'test-secret-12345',
    DATABASE_URL: 'file:./test.db',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    PORT: 0,
  },
}));

import { prisma } from '../src/services/sessionService';
import { server } from '../src/index';

const partnerId = `0x${'ab'.repeat(32)}`;
const owner = ethers.Wallet.createRandom();
const outsider = ethers.Wallet.createRandom();
const rewardCustomer = ethers.Wallet.createRandom().address;

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function sellerHeaders(wallet: ethers.Wallet, action: string, businessId: string, scope = businessId) {
  const query = new URLSearchParams({ action, businessId });
  if (['rewards:apply', 'sessions:redeem'].includes(action)) {
    query.set('walletAddress', wallet.address);
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
    beneficiaryMatchesOwner: true,
    maxAllocationRaw: ethers.utils.parseUnits('1000000', 9).toString(),
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

  it('creates the reward outbox atomically on redeem and reconciles each wallet/partner once', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const customer = ethers.Wallet.createRandom().address;
    const first = await prisma.session.create({
      data: {
        businessId,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'APPROVED',
        recoveredAddress: customer,
        lockAmountRaw: '2500.125',
      },
    });
    await prisma.session.create({
      data: {
        businessId,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'APPROVED',
        recoveredAddress: customer,
        lockAmountRaw: '2500.125',
      },
    });

    const firstRedeem = await fetch(`${baseUrl()}/api/sessions/${first.id}/redeem`, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'sessions:redeem', first.id),
    });
    expect(firstRedeem.status).toBe(200);
    const second = await prisma.session.findFirstOrThrow({
      where: { businessId, id: { not: first.id } },
      orderBy: { createdAt: 'desc' },
    });
    const secondRedeem = await fetch(`${baseUrl()}/api/sessions/${second.id}/redeem`, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'sessions:redeem', second.id),
    });
    expect(secondRedeem.status).toBe(200);
    expect(await prisma.rewardEvent.findMany()).toEqual([
      expect.objectContaining({
        sessionId: first.id,
        customerWallet: customer,
        partnerId,
        chainId: 1,
        lockAmountRaw: ethers.utils.parseUnits('2500.125', 9).toString(),
        status: 'PENDING',
      }),
    ]);

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: 1, scanned: 1, submissionReady: true });
    expect(await prisma.rewardEvent.findMany()).toEqual([
      expect.objectContaining({
        sessionId: first.id,
        customerWallet: customer,
        partnerId,
        lockAmountRaw: ethers.utils.parseUnits('2500.125', 9).toString(),
        status: 'READY',
      }),
    ]);

    const retry = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    });
    expect(retry.status).toBe(200);
    expect(await prisma.rewardEvent.count()).toBe(1);
  });

  it('redeems the benefit but creates no reward event for the seller owner wallet', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: {
        businessId,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'APPROVED',
        recoveredAddress: owner.address,
        lockAmountRaw: '1000',
      },
    });
    const response = await fetch(`${baseUrl()}/api/sessions/${session.id}/redeem`, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'sessions:redeem', session.id),
    });
    expect(response.status).toBe(200);
    expect(await prisma.rewardEvent.count()).toBe(0);
    expect(await prisma.auditLog.findFirst({ where: { sessionId: session.id, type: 'REWARD_SKIPPED_POLICY' } }))
      .not.toBeNull();
  });

  it('fails closed and marks the local link stale when governance eligibility changes', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: {
        businessId,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'REDEEMED',
        recoveredAddress: rewardCustomer,
        lockAmountRaw: '1000',
      },
    });
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: session.id,
        partnerId,
        customerWallet: rewardCustomer,
        lockAmountRaw: ethers.utils.parseUnits('1000', 9).toString(),
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

  it('rechecks previously blocked events after governance and caller authorization recover', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: {
        businessId,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'REDEEMED',
        recoveredAddress: rewardCustomer,
        lockAmountRaw: '1000',
      },
    });
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: session.id,
        partnerId,
        customerWallet: rewardCustomer,
        lockAmountRaw: ethers.utils.parseUnits('1000', 9).toString(),
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
    expect(await response.json()).toMatchObject({ ready: 1, scanned: 1, submissionReady: true });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: session.id } }))
      .toMatchObject({ status: 'READY' });
  });

  it('reconciles a ready event to confirmed after the external on-chain submission', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const session = await prisma.session.create({
      data: {
        businessId,
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'REDEEMED',
        recoveredAddress: rewardCustomer,
        lockAmountRaw: '1000',
      },
    });
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: session.id,
        partnerId,
        customerWallet: rewardCustomer,
        lockAmountRaw: ethers.utils.parseUnits('1000', 9).toString(),
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
    expect(await response.json()).toMatchObject({ confirmed: 1, scanned: 1, submissionReady: true });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: session.id } }))
      .toMatchObject({
        status: 'CONFIRMED',
        reason: 'Confirmed from PartnerVault anti-double-count state',
      });
  });

  it('processes actionable rewards even when the ready reconciliation window is full', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const readySessions = Array.from({ length: 50 }, (_, index) => ({
      id: `ready-backlog-${index}`,
      businessId,
      nonce: (index + 1).toString(16).padStart(64, '0'),
      expiresAt: new Date(Date.now() + 60_000),
      status: 'REDEEMED',
      recoveredAddress: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      lockAmountRaw: '1000',
    }));
    await prisma.session.createMany({ data: readySessions });
    await prisma.rewardEvent.createMany({
      data: readySessions.map((session, index) => ({
        id: `ready-event-${index}`,
        businessId,
        sessionId: session.id,
        partnerId,
        customerWallet: session.recoveredAddress,
        lockAmountRaw: ethers.utils.parseUnits('1000', 9).toString(),
        chainId: 1,
        status: 'READY',
      })),
    });
    await prisma.session.create({
      data: {
        id: 'pending-after-ready-backlog',
        businessId,
        nonce: 'ff'.repeat(32),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'REDEEMED',
        recoveredAddress: `0x${'ff'.repeat(20)}`,
        lockAmountRaw: '1000',
      },
    });
    await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: 'pending-after-ready-backlog',
        partnerId,
        customerWallet: `0x${'ff'.repeat(20)}`,
        lockAmountRaw: ethers.utils.parseUnits('1000', 9).toString(),
        chainId: 1,
        status: 'PENDING',
      },
    });

    const response = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret-12345' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: 51, scanned: 51, submissionReady: true });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { sessionId: 'pending-after-ready-backlog' } }))
      .toMatchObject({ status: 'READY' });
  });

  it('shows reward status only to the seller owner and never exposes signatures', async () => {
    await prisma.sellerRewardLink.create({
      data: { businessId, status: 'VERIFIED', partnerId, builderWallet: owner.address, verifiedAt: new Date() },
    });
    const url = `${baseUrl()}/api/seller/businesses/${businessId}/rewards`;
    expect((await fetch(url, { headers: await sellerHeaders(outsider, 'rewards:read', businessId) })).status).toBe(403);
    const response = await fetch(url, { headers: await sellerHeaders(owner, 'rewards:read', businessId) });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('signature');
    expect(body).toMatchObject({ link: { status: 'VERIFIED', partnerId }, onChain: { verified: true } });
  });
});
