import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

type TestWallet = ReturnType<typeof ethers.Wallet.createRandom>;

const mockGetRewardOnChainStatus = jest.fn();
const mockIsWalletAlreadyRewarded = jest.fn();
const mockGetModelBVaultState = jest.fn();

jest.mock('../src/services/rewardService', () => {
  const actual = jest.requireActual('../src/services/rewardService');
  return {
    ...actual,
    getRewardOnChainStatus: (...args: unknown[]) => mockGetRewardOnChainStatus(...args),
    isWalletAlreadyRewarded: (...args: unknown[]) => mockIsWalletAlreadyRewarded(...args),
    getModelBVaultState: (...args: unknown[]) => mockGetModelBVaultState(...args),
  };
});

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
  recoverSigner: jest.fn(),
  initProvider: jest.fn(),
}));

const IFR_TOKEN = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const PARTNER_VAULT = '0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D';
const GOVERNANCE = '0xc43d48E7FDA576C5022d0670B652A622E8caD041';
const PAIR = '0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0';

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 1,
    SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://mock-rpc.example.com',
    IFR_TOKEN_ADDRESS: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    PARTNER_VAULT_ADDRESS: '0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D',
    BUILDER_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000003',
    REWARD_CALLER_ADDRESS: undefined,
    MODEL_B_SETTLEMENT_ENABLED: 'true',
    MODEL_B_PILOT_POLICY_JSON: undefined,
    ADMIN_SECRET: 'test-secret-12345',
    CUSTOMER_WALLET_HMAC_KEY: 'test-customer-wallet-hmac-key-0123456789abcdef',
    DATABASE_URL: 'file:./test.db',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: 25,
    PORT: 0,
  },
}));

import { fingerprintWallet } from '../src/services/walletFingerprint';
import { config } from '../src/config';
import { prisma } from '../src/services/sessionService';
import { server } from '../src/index';
import { parseModelBPolicy, type ModelBPolicy } from '../src/services/modelBPolicy';
import {
  buildSettlementExport,
  computeMilestoneId,
  convertEurMinorToIfrBase,
  isInPeriod,
  parseSettlementPeriod,
  validatePriceEvidence,
  validateRecordMilestoneTemplate,
  type ModelBChainState,
  type RecordMilestoneTemplate,
} from '../src/services/modelBSettlement';
import { loadSettlementRecords } from '../src/services/modelBSettlementData';

const mutableConfig = config as unknown as Record<string, unknown>;
const partnerId = `0x${'cd'.repeat(32)}`;
const otherPilotId = `0x${'ef'.repeat(32)}`;
const owner = ethers.Wallet.createRandom();
const outsider = ethers.Wallet.createRandom();
const operatorWallet = ethers.Wallet.createRandom().address;
const rewardWallet = ethers.Wallet.createRandom().address;
const Q112 = 2n ** 112n;
const IFR = 10n ** 9n;
const AUTH = { authorization: 'Bearer test-secret-12345', 'content-type': 'application/json' };
const PERIOD = '2026-08';
const periodEndSeconds = Date.UTC(2026, 8, 1) / 1000;

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function sellerHeaders(wallet: TestWallet, action: string, businessId: string, scope = businessId) {
  const query = new URLSearchParams({ action, businessId, walletAddress: wallet.address });
  if (['rewards:disable', 'sessions:redeem'].includes(action)) query.set('scope', scope);
  const challengeResponse = await fetch(`${baseUrl()}/api/seller/auth-message?${query}`);
  expect(challengeResponse.status).toBe(200);
  const challenge = await challengeResponse.json() as { message: string; timestamp: string; nonce?: string };
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-ifr-wallet': wallet.address,
    'x-ifr-signature': await wallet.signMessage(challenge.message),
    'x-ifr-timestamp': challenge.timestamp,
  };
  if (challenge.nonce) headers['x-ifr-nonce'] = challenge.nonce;
  return headers;
}

function policy(businessId: string, overrides: Partial<ModelBPolicy> = {}, pilotOverrides: Record<string, unknown> = {}) {
  return {
    policyVersion: 'lane4-model-b-test-1',
    globalPilotBudgetBaseUnits: (1_000_000n * IFR).toString(),
    twapPair: PAIR,
    reviewedPriceSourceIds: ['test-reviewed-source'],
    pilots: [
      {
        partnerId,
        businessId,
        eurMinorPerRedemption: '200',
        partnerBudgetBaseUnits: (500_000n * IFR).toString(),
        startsAt: '2026-07-01T00:00:00Z',
        governanceReference: 'test-governance-reference',
        ...pilotOverrides,
      },
      {
        partnerId: otherPilotId,
        businessId: 'other-pilot-business',
        eurMinorPerRedemption: '100',
        partnerBudgetBaseUnits: (100_000n * IFR).toString(),
        startsAt: '2026-07-01T00:00:00Z',
        governanceReference: 'test-governance-reference-2',
      },
    ],
    ...overrides,
  };
}

// IFR/WETH TWAP of exactly 1000 wei per IFR base unit (0.000001 ETH per IFR); ETH/EUR 3000.00.
// 2.00 EUR per redemption therefore converts to floor(k * 2e12 / 3) IFR base units.
function evidence(overrides: Record<string, unknown> = {}) {
  const endTs = periodEndSeconds + 3600;
  const startTs = endTs - 604_800;
  const startCumulative = 123_456_789n * Q112;
  return {
    reviewedSourceId: 'test-reviewed-source',
    pair: PAIR,
    token0: IFR_TOKEN,
    start: { blockNumber: 26_000_000, blockHash: `0x${'11'.repeat(32)}`, timestamp: startTs, price0Cumulative: startCumulative.toString() },
    end: {
      blockNumber: 26_050_000,
      blockHash: `0x${'22'.repeat(32)}`,
      timestamp: endTs,
      price0Cumulative: (startCumulative + 1000n * Q112 * 604_800n).toString(),
    },
    ethEur: { source: 'test-published-reference', publishedAt: new Date(endTs * 1000).toISOString(), rate: '300000', decimals: 2 },
    rounding: 'floor',
    ...overrides,
  };
}

function vaultState(overrides: Partial<ModelBChainState> = {}) {
  return {
    chainId: 1,
    blockNumber: 26_100_000,
    blockHash: `0x${'33'.repeat(32)}`,
    partnerVault: PARTNER_VAULT,
    governance: GOVERNANCE,
    paused: false,
    partner: { active: true, milestonesFinal: false, maxAllocation: 1_000_000n * IFR, unlockedTotal: 0n, rewardAccrued: 0n },
    pilotUsage: { [partnerId]: 0n, [otherPilotId]: 0n },
    milestoneDone: false,
    ...overrides,
  };
}

function sellerStatus(overrides: Record<string, unknown> = {}) {
  return {
    checkedAt: new Date().toISOString(),
    blockNumber: 26_100_000,
    chainId: 1,
    contractCodeVerified: true,
    governanceAligned: true,
    partnerId,
    builderRegistered: true,
    builderActive: true,
    builderName: 'Pilot shop',
    partnerExists: true,
    partnerActive: true,
    beneficiary: rewardWallet,
    expectedBeneficiary: rewardWallet,
    beneficiaryMatchesOwner: false,
    beneficiaryMatchesRewardWallet: true,
    maxAllocationRaw: (1_000_000n * IFR).toString(),
    rewardAccruedRaw: '0',
    claimedTotalRaw: '0',
    vestedRaw: '0',
    claimableRaw: '0',
    rewardCallerConfigured: false,
    rewardCallerAuthorized: false,
    verified: true,
    submissionReady: false,
    reason: 'Reward caller is not configured',
    ...overrides,
  };
}

describe('Model B verified-redemption settlement (T-275)', () => {
  let businessId: string;
  let operatorId: string;

  async function redemption(options: {
    redeemedAt: string;
    customer?: string;
    status?: string;
    confirmations?: Array<Record<string, unknown>>;
    eventPartnerId?: string | null;
    sessionStatus?: string;
  }) {
    const customer = options.customer ?? ethers.Wallet.createRandom().address;
    const session = await prisma.session.create({
      data: {
        businessId,
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date(options.redeemedAt),
        status: options.sessionStatus ?? 'REDEEMED',
        redeemedAt: new Date(options.redeemedAt),
        customerFingerprint: fingerprintWallet(customer),
        lockAmountRaw: '1000',
      },
    });
    for (const payload of options.confirmations ?? [{ actorWallet: owner.address, actorRole: 'OWNER', operatorId: null }]) {
      await prisma.auditLog.create({ data: { sessionId: session.id, type: 'REDEEMED', payload: JSON.stringify(payload) } });
    }
    if (options.eventPartnerId === null) return { session, event: null };
    const event = await prisma.rewardEvent.create({
      data: {
        businessId,
        sessionId: session.id,
        partnerId: options.eventPartnerId ?? partnerId,
        customerFingerprint: fingerprintWallet(customer),
        lockAmountRaw: (1000n * IFR).toString(),
        chainId: 1,
        status: options.status ?? 'SETTLEMENT_PENDING',
        createdAt: new Date(options.redeemedAt),
      },
    });
    return { session, event };
  }

  function currentPolicy() {
    const state = parseModelBPolicy(config as never);
    if (!state.enabled) throw new Error(state.reason);
    return state.policy;
  }

  async function exportDirect(options: {
    sellerConfirmedRedemptions?: number;
    priceEvidence?: unknown;
    chain?: Partial<ModelBChainState> | null;
    period?: string;
    now?: Date;
  } = {}) {
    const activePolicy = currentPolicy();
    const pilot = activePolicy.pilots[0];
    const period = parseSettlementPeriod(options.period ?? PERIOD);
    const records = await loadSettlementRecords(prisma, pilot, period);
    if (!records) throw new Error('missing records');
    const chain = options.chain === null
      ? null
      : { ...vaultState(options.chain ?? {}), sellerVerified: true, sellerReason: null };
    return buildSettlementExport({
      policy: activePolicy,
      pilot,
      period,
      now: options.now ?? new Date('2026-10-05T00:00:00Z'),
      expectedChainId: 1,
      partnerVaultAddress: PARTNER_VAULT,
      ifrTokenAddress: IFR_TOKEN,
      records,
      sellerConfirmedRedemptions: 'sellerConfirmedRedemptions' in options ? options.sellerConfirmedRedemptions : records.redemptions.length,
      priceEvidence: 'priceEvidence' in options ? options.priceEvidence : evidence(),
      chain,
    });
  }

  async function postExport(body: Record<string, unknown>, headers: Record<string, string> = AUTH) {
    return fetch(`${baseUrl()}/api/admin/model-b/settlements/export`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

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
      data: { name: 'Pilot Shop', ownerAddress: owner.address, discountPercent: 10, requiredLockIFR: 1000 },
    });
    businessId = business.id;
    const operator = await prisma.checkoutOperator.create({
      data: { businessId, walletAddress: operatorWallet, active: false },
    });
    operatorId = operator.id;
    await prisma.sellerRewardLink.create({
      data: {
        businessId,
        status: 'VERIFIED',
        partnerId,
        builderWallet: owner.address,
        rewardWallet,
        rewardWalletConfirmedAt: new Date(),
        verifiedAt: new Date(),
      },
    });
    mutableConfig.MODEL_B_SETTLEMENT_ENABLED = 'true';
    mutableConfig.REWARD_CALLER_ADDRESS = undefined;
    mutableConfig.MODEL_B_PILOT_POLICY_JSON = JSON.stringify(policy(businessId));
    mockGetRewardOnChainStatus.mockResolvedValue(sellerStatus());
    mockIsWalletAlreadyRewarded.mockResolvedValue(false);
    mockGetModelBVaultState.mockResolvedValue(vaultState());
  });

  afterAll(async () => {
    await prisma.rewardEvent.deleteMany();
    await prisma.sellerRewardLink.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.checkoutOperator.deleteMany();
    await prisma.business.deleteMany();
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  // ── Default-off, authorization and privacy ─────────────────────────────────

  it('is default-off: no flag, missing/invalid policy or a configured lock caller disable the export', async () => {
    expect(parseModelBPolicy({ CHAIN_ID: 1 })).toEqual({ enabled: false, reason: 'Model B settlement is disabled' });
    expect(parseModelBPolicy({ CHAIN_ID: 1, MODEL_B_SETTLEMENT_ENABLED: '1', MODEL_B_PILOT_POLICY_JSON: '{}' }).enabled).toBe(false);
    expect(parseModelBPolicy({ CHAIN_ID: 1, MODEL_B_SETTLEMENT_ENABLED: 'true' }).enabled).toBe(false);
    expect(parseModelBPolicy({ CHAIN_ID: 1, MODEL_B_SETTLEMENT_ENABLED: 'true', MODEL_B_PILOT_POLICY_JSON: 'nope' }).enabled).toBe(false);
    expect(parseModelBPolicy({
      CHAIN_ID: 1,
      MODEL_B_SETTLEMENT_ENABLED: 'true',
      MODEL_B_PILOT_POLICY_JSON: JSON.stringify(policy(businessId, { twapPair: `0x${'99'.repeat(20)}` })),
    })).toEqual({ enabled: false, reason: 'Model B pilot policy names a non-canonical TWAP pair' });
    expect(parseModelBPolicy({
      CHAIN_ID: 1,
      MODEL_B_SETTLEMENT_ENABLED: 'true',
      MODEL_B_PILOT_POLICY_JSON: JSON.stringify(policy(businessId, { globalPilotBudgetBaseUnits: (40_000_001n * IFR).toString() })),
    }).enabled).toBe(false);
    expect(parseModelBPolicy({
      CHAIN_ID: 1,
      MODEL_B_SETTLEMENT_ENABLED: 'true',
      MODEL_B_PILOT_POLICY_JSON: JSON.stringify(policy(businessId, {}, { eurMinorPerRedemption: '2.5' })),
    }).enabled).toBe(false);

    mutableConfig.MODEL_B_SETTLEMENT_ENABLED = undefined;
    expect((await postExport({ partnerId, period: PERIOD, sellerConfirmedRedemptions: 0 })).status).toBe(404);
    mutableConfig.MODEL_B_SETTLEMENT_ENABLED = 'true';
    mutableConfig.REWARD_CALLER_ADDRESS = '0x0000000000000000000000000000000000000004';
    const conflict = await postExport({ partnerId, period: PERIOD, sellerConfirmedRedemptions: 0 });
    expect(conflict.status).toBe(404);
    expect(await conflict.json()).toEqual({ error: 'Model B forbids a configured lock-reward caller' });
    expect(mockGetModelBVaultState).not.toHaveBeenCalled();
  });

  it('keeps the export behind the existing operator auth and rejects unknown or premature-settlement fields', async () => {
    expect((await postExport({ partnerId, period: PERIOD }, { 'content-type': 'application/json' })).status).toBe(401);
    expect((await postExport({ partnerId, period: PERIOD }, { 'content-type': 'application/json', authorization: 'Bearer wrong-secret-xxxxx' })).status).toBe(401);
    for (const extra of [{ settled: true }, { paid: true }, { txHash: `0x${'aa'.repeat(32)}` }, { status: 'SETTLED' }]) {
      expect((await postExport({ partnerId, period: PERIOD, sellerConfirmedRedemptions: 0, ...extra })).status).toBe(400);
    }
    expect((await postExport({ partnerId: otherPilotId.slice(0, 20), period: PERIOD })).status).toBe(400);
    const nonPilot = await postExport({ partnerId: `0x${'12'.repeat(32)}`, period: PERIOD, sellerConfirmedRedemptions: 0 });
    expect(nonPilot.status).toBe(404);
    expect((await postExport({ partnerId, period: '2026-13' })).status).toBe(400);
    expect(mockGetModelBVaultState).not.toHaveBeenCalled();
  });

  it('exports an unsigned template over HTTP without wallets, signatures or a settled transition', async () => {
    const customers = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
    for (const [index, customer] of customers.entries()) {
      await redemption({ redeemedAt: `2026-08-1${index}T10:00:00.000Z`, customer });
    }
    const before = await prisma.rewardEvent.findMany({ orderBy: { id: 'asc' } });
    const body = { partnerId, period: PERIOD, sellerConfirmedRedemptions: 2, priceEvidence: evidence() };
    const first = await postExport(body);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const firstText = await first.text();
    const exported = JSON.parse(firstText);
    expect(exported.mode).toBe('proposal-template');
    expect(exported.settlement).toMatchObject({ status: 'NOT_SUBMITTED', settled: false, paid: false });
    expect(exported.template).toMatchObject({ unsigned: true, submitted: false });
    expect(exported.totals).toMatchObject({ settleableCount: 2, eurMinorTotal: '400', ifrBaseUnits: (4_000_000_000_000n / 3n).toString() });

    // Privacy: no customer, owner, operator or reward wallet, and no signature material.
    for (const wallet of [...customers, owner.address, operatorWallet, rewardWallet]) {
      expect(firstText.toLowerCase()).not.toContain(wallet.toLowerCase().slice(2));
    }
    expect(firstText).not.toMatch(/signature|recoveredAddress|customerWallet/i);
    expect(Object.keys(exported.publicSummary)).not.toContain('eligible');
    expect(JSON.stringify(exported.publicSummary)).not.toContain(before[0].id);

    // Repeating the export is idempotent: identical bytes, identity and no reward-state change.
    const second = await postExport(body);
    expect(await second.text()).toBe(firstText);
    expect(await prisma.rewardEvent.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.rewardEvent.count({ where: { status: { in: ['SETTLED', 'PAID', 'CONFIRMED'] } } })).toBe(0);
    expect(await prisma.adminAuditLog.count({ where: { action: 'rewards:model-b-export' } })).toBeGreaterThanOrEqual(2);
  });

  // ── Hop 1 -> 2 -> 3: real redeem, pilot reconcile and export ───────────────

  it('routes verified pilot redemptions through the outbox into SETTLEMENT_PENDING without the caller gate', async () => {
    const customer = ethers.Wallet.createRandom();
    const makeSession = () => prisma.session.create({
      data: {
        businessId,
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date(Date.now() + 60_000),
        status: 'APPROVED',
        customerFingerprint: fingerprintWallet(customer.address),
        lockAmountRaw: '1000',
      },
    });
    const first = await makeSession();
    const second = await makeSession();
    for (const session of [first, second]) {
      const redeemed = await fetch(`${baseUrl()}/api/sessions/${session.id}/redeem`, {
        method: 'POST',
        headers: await sellerHeaders(owner, 'sessions:redeem', session.id),
      });
      expect(redeemed.status).toBe(200);
    }
    // A replayed redeem of the same session is rejected and creates nothing.
    const replay = await fetch(`${baseUrl()}/api/sessions/${first.id}/redeem`, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'sessions:redeem', first.id),
    });
    expect(replay.status).not.toBe(200);
    // Existing outbox: one event per customer wallet and partner (documented gap G1).
    expect(await prisma.rewardEvent.count()).toBe(1);

    const queue = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, { method: 'POST', headers: AUTH });
    expect(queue.status).toBe(200);
    expect(await queue.json()).toEqual({ mode: 'model-b', settlementPending: 1, scanned: 1, submissionReady: false });
    expect(mockIsWalletAlreadyRewarded).not.toHaveBeenCalled();
    expect(await prisma.rewardEvent.findFirstOrThrow()).toMatchObject({ status: 'SETTLEMENT_PENDING' });

    // The current month is still open, so only a diagnostic export is possible.
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const response = await postExport({ partnerId, period, sellerConfirmedRedemptions: 2, priceEvidence: evidence() });
    expect(response.status).toBe(200);
    const exported = await response.json() as {
      mode: string; template: unknown; blockers: string[];
      reconciliation: Record<string, unknown> & { discrepancies: { code: string; count: number }[] };
    };
    expect(exported.mode).toBe('diagnostic');
    expect(exported.template).toBeNull();
    expect(exported.blockers).toContain('PERIOD_NOT_CLOSED');
    expect(exported.reconciliation).toMatchObject({ backendRedemptions: 2, rewardEventsInPeriod: 1, redemptionsWithoutRewardEvent: 1 });
    expect(exported.reconciliation.discrepancies).toContainEqual({ code: 'REDEMPTION_WITHOUT_REWARD_EVENT', count: 1 });

    // A seller opt-out blocks settlement-pending events again.
    const disabled = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}/rewards/disable`, {
      method: 'POST',
      headers: await sellerHeaders(owner, 'rewards:disable', businessId),
    });
    expect(disabled.status).toBe(200);
    expect(await prisma.rewardEvent.findFirstOrThrow()).toMatchObject({ status: 'BLOCKED_GOVERNANCE' });
  });

  it('never reclassifies pre-pilot events and keeps non-pilot sellers on the existing caller gate', async () => {
    mutableConfig.MODEL_B_PILOT_POLICY_JSON = JSON.stringify(policy(businessId, {}, { startsAt: '2026-08-15T00:00:00Z' }));
    const old = await redemption({ redeemedAt: '2026-08-10T12:00:00.000Z', status: 'PENDING' });
    const fresh = await redemption({ redeemedAt: '2026-08-20T12:00:00.000Z', status: 'BLOCKED_CALLER' });
    const queue = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, { method: 'POST', headers: AUTH });
    expect(await queue.json()).toMatchObject({ mode: 'model-b', settlementPending: 1, scanned: 1 });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { id: old.event!.id } })).toMatchObject({ status: 'PENDING' });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { id: fresh.event!.id } })).toMatchObject({ status: 'SETTLEMENT_PENDING' });

    const exported = await exportDirect();
    expect(exported.events.excluded).toContainEqual({ id: old.event!.id, reason: 'PRE_PILOT' });
    expect(exported.events.eligible).toEqual([fresh.event!.id]);
    expect(exported.mode).toBe('proposal-template');

    // Disabled Model B: the old lock-path reconciliation stays exactly as before.
    mutableConfig.MODEL_B_SETTLEMENT_ENABLED = undefined;
    const legacy = await fetch(`${baseUrl()}/api/admin/businesses/${businessId}/rewards/queue`, { method: 'POST', headers: AUTH });
    expect(await legacy.json()).toMatchObject({ blocked: 1, ready: 0, submissionReady: false });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { id: old.event!.id } })).toMatchObject({ status: 'BLOCKED_CALLER' });
    expect(await prisma.rewardEvent.findUniqueOrThrow({ where: { id: fresh.event!.id } })).toMatchObject({ status: 'SETTLEMENT_PENDING' });
  });

  // ── Eligibility negatives ──────────────────────────────────────────────────

  it('excludes self-redemptions by every seller-controlled wallet, including inactive operators', async () => {
    const ok = await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z' });
    const viaReward = await redemption({ redeemedAt: '2026-08-03T00:00:00.000Z', customer: rewardWallet });
    const viaOperator = await redemption({ redeemedAt: '2026-08-04T00:00:00.000Z', customer: operatorWallet.toLowerCase() });
    const viaOwner = await redemption({ redeemedAt: '2026-08-05T00:00:00.000Z', customer: owner.address });
    const exported = await exportDirect();
    expect(exported.events.eligible).toEqual([ok.event!.id]);
    for (const item of [viaReward, viaOperator, viaOwner]) {
      expect(exported.events.excluded).toContainEqual({ id: item.event!.id, reason: 'SELF_REDEMPTION' });
    }
    expect(exported.reconciliation.discrepancies).toEqual([]);
    expect(exported.mode).toBe('proposal-template');
  });

  it('blocks proposals for unconfirmed, unauthorized and replayed seller confirmations', async () => {
    await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z' });
    const unconfirmed = await redemption({ redeemedAt: '2026-08-03T00:00:00.000Z', confirmations: [] });
    const unauthorized = await redemption({
      redeemedAt: '2026-08-04T00:00:00.000Z',
      confirmations: [{ actorWallet: outsider.address, actorRole: 'OWNER', operatorId: null }],
    });
    const forgedOperator = await redemption({
      redeemedAt: '2026-08-05T00:00:00.000Z',
      confirmations: [{ actorWallet: outsider.address, actorRole: 'OPERATOR', operatorId }],
    });
    const replayed = await redemption({
      redeemedAt: '2026-08-06T00:00:00.000Z',
      confirmations: [
        { actorWallet: owner.address, actorRole: 'OWNER', operatorId: null },
        { actorWallet: owner.address, actorRole: 'OWNER', operatorId: null },
      ],
    });
    const validOperator = await redemption({
      redeemedAt: '2026-08-07T00:00:00.000Z',
      confirmations: [{ actorWallet: operatorWallet, actorRole: 'OPERATOR', operatorId }],
    });
    const exported = await exportDirect();
    expect(exported.events.excluded).toEqual(expect.arrayContaining([
      { id: unconfirmed.event!.id, reason: 'UNCONFIRMED_REDEMPTION' },
      { id: unauthorized.event!.id, reason: 'UNAUTHORIZED_CONFIRMER' },
      { id: forgedOperator.event!.id, reason: 'UNAUTHORIZED_CONFIRMER' },
      { id: replayed.event!.id, reason: 'REPLAYED_CONFIRMATION' },
    ]));
    expect(exported.events.eligible).toContain(validOperator.event!.id);
    expect(exported.reconciliation.status).toBe('MISMATCH');
    expect(exported.blockers).toContain('RECONCILIATION_DISCREPANCY');
    expect(exported.template).toBeNull();
  });

  it('blocks proposals on unreconciled, lock-path, orphan and foreign-business events', async () => {
    const pending = await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z', status: 'PENDING' });
    const exported = await exportDirect();
    expect(exported.events.excluded).toContainEqual({ id: pending.event!.id, reason: 'NOT_RECONCILED' });
    expect(exported.template).toBeNull();

    await prisma.rewardEvent.update({ where: { id: pending.event!.id }, data: { status: 'CONFIRMED' } });
    const confirmed = await exportDirect();
    expect(confirmed.events.excluded).toContainEqual({ id: pending.event!.id, reason: 'LOCK_REWARD_ALREADY_RECORDED' });
    expect(confirmed.template).toBeNull();

    await prisma.rewardEvent.update({ where: { id: pending.event!.id }, data: { status: 'SKIPPED' } });
    await redemption({ redeemedAt: '2026-08-03T00:00:00.000Z' });
    const skipped = await exportDirect();
    expect(skipped.events.excluded).toContainEqual({ id: pending.event!.id, reason: 'STATUS_INELIGIBLE' });
    expect(skipped.template).not.toBeNull();

    // An outbox row for the pilot partner that belongs to another business is a discrepancy.
    const foreign = await prisma.business.create({
      data: { name: 'Foreign Shop', ownerAddress: outsider.address, discountPercent: 5, requiredLockIFR: 1000 },
    });
    const foreignSession = await prisma.session.create({
      data: {
        businessId: foreign.id,
        nonce: ethers.hexlify(ethers.randomBytes(32)).slice(2),
        expiresAt: new Date('2026-08-05T00:00:00.000Z'),
        status: 'REDEEMED',
        redeemedAt: new Date('2026-08-05T00:00:00.000Z'),
        customerFingerprint: fingerprintWallet(ethers.Wallet.createRandom().address),
      },
    });
    const foreignEvent = await prisma.rewardEvent.create({
      data: {
        businessId: foreign.id,
        sessionId: foreignSession.id,
        partnerId,
        customerFingerprint: fingerprintWallet(ethers.Wallet.createRandom().address),
        lockAmountRaw: '1',
        chainId: 1,
        status: 'SETTLEMENT_PENDING',
      },
    });
    const crossBusiness = await exportDirect();
    expect(crossBusiness.events.excluded).toContainEqual({ id: foreignEvent.id, reason: 'BUSINESS_MISMATCH' });
    expect(crossBusiness.template).toBeNull();
    await prisma.rewardEvent.delete({ where: { id: foreignEvent.id } });

    // An outbox row whose session never reached REDEEMED is an integrity discrepancy.
    await redemption({ redeemedAt: '2026-08-04T00:00:00.000Z', sessionStatus: 'APPROVED', confirmations: [] });
    const orphan = await exportDirect();
    expect(orphan.reconciliation.discrepancies).toContainEqual({ code: 'EVENT_WITHOUT_REDEMPTION', count: 1 });
    expect(orphan.template).toBeNull();
  });

  it('applies UTC half-open month boundaries and refuses malformed or open periods', async () => {
    const atStart = await redemption({ redeemedAt: '2026-08-01T00:00:00.000Z' });
    const beforeStart = await redemption({ redeemedAt: '2026-07-31T23:59:59.999Z' });
    const atEnd = await redemption({ redeemedAt: '2026-09-01T00:00:00.000Z' });
    const lastMs = await redemption({ redeemedAt: '2026-08-31T23:59:59.999Z' });
    const exported = await exportDirect();
    expect(exported.period).toEqual({
      label: PERIOD,
      startUtc: '2026-08-01T00:00:00.000Z',
      endExclusiveUtc: '2026-09-01T00:00:00.000Z',
      boundary: 'half-open [start, end)',
    });
    expect(exported.events.eligible.sort()).toEqual([atStart.event!.id, lastMs.event!.id].sort());
    expect(JSON.stringify(exported.events)).not.toContain(beforeStart.event!.id);
    expect(JSON.stringify(exported.events)).not.toContain(atEnd.event!.id);
    expect(exported.reconciliation.backendRedemptions).toBe(2);

    const august = parseSettlementPeriod(PERIOD);
    expect(isInPeriod(new Date('2026-08-01T00:00:00.000Z'), august)).toBe(true);
    expect(isInPeriod(new Date('2026-08-31T23:59:59.999Z'), august)).toBe(true);
    expect(isInPeriod(new Date('2026-09-01T00:00:00.000Z'), august)).toBe(false);
    expect(isInPeriod(new Date('2026-07-31T23:59:59.999Z'), august)).toBe(false);
    expect(parseSettlementPeriod('2026-12').end.toISOString()).toBe('2027-01-01T00:00:00.000Z');

    for (const label of ['2026-8', '2026-13', '2026-00', '2026-08-01', '2025-12', 'August']) {
      expect(() => parseSettlementPeriod(label)).toThrow();
    }
    const open = await exportDirect({ now: new Date('2026-08-31T23:59:59.999Z') });
    expect(open.blockers).toContain('PERIOD_NOT_CLOSED');
    expect(open.template).toBeNull();
  });

  // ── Reconciliation ────────────────────────────────────────────────────────

  it('blocks proposal generation on seller-total mismatch or missing seller confirmation', async () => {
    await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z' });
    await redemption({ redeemedAt: '2026-08-03T00:00:00.000Z' });
    const mismatch = await exportDirect({ sellerConfirmedRedemptions: 3 });
    expect(mismatch.reconciliation).toMatchObject({ status: 'MISMATCH', sellerConfirmedRedemptions: 3, backendRedemptions: 2 });
    expect(mismatch.reconciliation.discrepancies).toContainEqual({ code: 'SELLER_TOTAL_MISMATCH', count: 1 });
    expect(mismatch.template).toBeNull();
    const missing = await exportDirect({ sellerConfirmedRedemptions: undefined });
    expect(missing.reconciliation.status).toBe('INCOMPLETE');
    expect(missing.blockers).toContain('RECONCILIATION_INCOMPLETE');
    expect(missing.template).toBeNull();
    expect((await exportDirect()).mode).toBe('proposal-template');
  });

  // ── Price evidence ────────────────────────────────────────────────────────

  it('permits only a diagnostic export for missing, unreviewed or invalid price evidence', async () => {
    await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z' });
    const base = evidence();
    const cases: Array<[unknown, string]> = [
      [undefined, 'MISSING'],
      [{ ...base, reviewedSourceId: 'unreviewed' }, 'INVALID'],
      [{ ...base, pair: `0x${'98'.repeat(20)}` }, 'INVALID'],
      [{ ...base, token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }, 'INVALID'],
      [{ ...base, start: { ...base.start, timestamp: base.end.timestamp - 6 * 86_400 } }, 'INVALID'],
      [{ ...base, start: { ...base.start, timestamp: base.end.timestamp - 9 * 86_400 } }, 'INVALID'],
      [{ ...base, start: { ...base.start, blockNumber: base.end.blockNumber } }, 'INVALID'],
      [{ ...base, end: { ...base.end, price0Cumulative: base.start.price0Cumulative } }, 'INVALID'],
      [{ ...base, end: { ...base.end, timestamp: periodEndSeconds - 1 }, start: { ...base.start, timestamp: periodEndSeconds - 1 - 604_800 } }, 'INVALID'],
      [{ ...base, ethEur: { ...base.ethEur, publishedAt: new Date((base.end.timestamp + 2 * 86_400) * 1000).toISOString() } }, 'INVALID'],
      [{ ...base, ethEur: { ...base.ethEur, rate: '0' } }, 'INVALID'],
      [{ ...base, ethEur: { ...base.ethEur, rate: '3000.5' } }, 'INVALID'],
      [{ ...base, rounding: 'nearest' }, 'INVALID'],
      // A spot quote or reserves snapshot is never accepted in place of cumulative TWAP evidence.
      [{ ...base, spotPrice: '0.000001' }, 'INVALID'],
      [{ ...base, end: { ...base.end, reserve0: '1', reserve1: '1' } }, 'INVALID'],
    ];
    for (const [priceEvidence, status] of cases) {
      const exported = await exportDirect({ priceEvidence });
      expect(exported.priceEvidence.status).toBe(status);
      expect(exported.mode).toBe('diagnostic');
      expect(exported.template).toBeNull();
      expect(exported.totals.ifrBaseUnits).toBeNull();
      expect(JSON.stringify(exported)).not.toMatch(/"data":"0x/);
    }
    const policyState = currentPolicy();
    const period = parseSettlementPeriod(PERIOD);
    expect(validatePriceEvidence(base, { policy: { ...policyState, reviewedPriceSourceIds: [] }, ifrTokenAddress: IFR_TOKEN, period }).status)
      .toBe('INVALID');
  });

  it('binds the TWAP window end and ETH/EUR reference time to the settlement period (max 72h lag)', async () => {
    await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z' });
    const LAG = 72 * 3600;
    const at = (endTs: number, publishedTs = endTs) => {
      const base = evidence();
      const startCumulative = BigInt(base.start.price0Cumulative);
      return {
        ...base,
        start: { ...base.start, timestamp: endTs - 604_800 },
        end: { ...base.end, timestamp: endTs, price0Cumulative: (startCumulative + 1000n * Q112 * 604_800n).toString() },
        ethEur: { ...base.ethEur, publishedAt: new Date(publishedTs * 1000).toISOString() },
      };
    };
    const cases: Array<[string, unknown, 'VALID' | 'INVALID', string | null]> = [
      ['window ends exactly at the period end', at(periodEndSeconds), 'VALID', null],
      ['window ends exactly at the 72h tolerance', at(periodEndSeconds + LAG), 'VALID', null],
      ['window ends one second past the tolerance', at(periodEndSeconds + LAG + 1), 'INVALID', 'Settlement block is more than 72 hours after the end of the settlement period'],
      ['window ends a month after the period', at(periodEndSeconds + 30 * 86_400), 'INVALID', 'Settlement block is more than 72 hours after the end of the settlement period'],
      ['window lies inside the period', at(periodEndSeconds - 1), 'INVALID', 'Settlement block precedes the end of the settlement period'],
      ['window lies before the period', at(periodEndSeconds - 40 * 86_400), 'INVALID', 'Settlement block precedes the end of the settlement period'],
      ['ETH/EUR published after the tolerance', at(periodEndSeconds + LAG, periodEndSeconds + LAG + 1), 'INVALID', 'ETH/EUR reference is not bound to the settlement period'],
      ['ETH/EUR published 24h before the period end', at(periodEndSeconds, periodEndSeconds - 86_400), 'VALID', null],
    ];
    for (const [label, priceEvidence, status, reason] of cases) {
      const exported = await exportDirect({ priceEvidence });
      expect({ label, status: exported.priceEvidence.status, reason: exported.priceEvidence.reason })
        .toEqual({ label, status, reason });
      expect({ label, mode: exported.mode }).toEqual({ label, mode: status === 'VALID' ? 'proposal-template' : 'diagnostic' });
      if (status === 'INVALID') {
        expect(exported.template).toBeNull();
        expect(exported.blockers).toContain('PRICE_EVIDENCE_INVALID');
      }
    }
  });

  it('converts exact integer EUR minor units to IFR base units with floor rounding', () => {
    const price = { windowSeconds: 604_800, cumulativeDelta: 1000n * Q112 * 604_800n, rate: 300_000n, decimals: 2 };
    expect(convertEurMinorToIfrBase(0n, price)).toBe(0n);
    expect(convertEurMinorToIfrBase(200n, price)).toBe(666_666_666_666n);
    expect(convertEurMinorToIfrBase(600n, price)).toBe(2_000_000_000_000n);
    expect(convertEurMinorToIfrBase(1n, price)).toBe(3_333_333_333n);
    // Large totals stay exact (no float rounding): 10^7 redemptions of 2.00 EUR.
    expect(convertEurMinorToIfrBase(2_000_000_000n, price)).toBe(6_666_666_666_666_666_666n);
    // Non-integer TWAP: 1000.5 wei per base unit over a non-round window.
    const odd = { windowSeconds: 605_000, cumulativeDelta: 2001n * Q112 * 605_000n / 2n, rate: 287_654_321n, decimals: 5 };
    expect(convertEurMinorToIfrBase(12_345n, odd))
      .toBe((12_345n * 10n ** 5n * 10n ** 18n * 605_000n * Q112) / (100n * 287_654_321n * (2001n * Q112 * 605_000n / 2n)));
    expect(() => convertEurMinorToIfrBase(-1n, price)).toThrow();
    expect(() => convertEurMinorToIfrBase(1n, { ...price, rate: 0n })).toThrow();
    // Cumulative price wrap-around across 2^256 is handled modulo 2^256.
    const policyState = currentPolicy();
    const base = evidence();
    const wrappedStart = 2n ** 256n - 500n * Q112 * 604_800n;
    const wrapped = validatePriceEvidence({
      ...base,
      start: { ...base.start, price0Cumulative: wrappedStart.toString() },
      end: { ...base.end, price0Cumulative: (500n * Q112 * 604_800n).toString() },
    }, { policy: policyState, ifrTokenAddress: IFR_TOKEN, period: parseSettlementPeriod(PERIOD) });
    expect(wrapped.status).toBe('VALID');
    if (wrapped.status === 'VALID') expect(wrapped.cumulativeDelta).toBe(1000n * Q112 * 604_800n);
  });

  // ── Budgets and chain gates ───────────────────────────────────────────────

  it('stops at the partner and global budgets, not at annualEmissionCap', async () => {
    const events = [];
    for (const day of ['02', '03', '04']) events.push((await redemption({ redeemedAt: `2026-08-${day}T00:00:00.000Z` })).event!);
    // On-chain allocation leaves 1,500 IFR: two redemptions (1,333.33 IFR) fit, the third does not.
    const capped = await exportDirect({
      chain: { partner: { active: true, milestonesFinal: false, maxAllocation: 2_500n * IFR, unlockedTotal: 1_000n * IFR, rewardAccrued: 0n }, pilotUsage: { [partnerId]: 1_000n * IFR, [otherPilotId]: 0n } },
    });
    expect(capped.budgets).toMatchObject({ status: 'CAPPED', partnerRemainingBaseUnits: (1_500n * IFR).toString(), annualEmissionCapApplies: false });
    expect(capped.totals).toMatchObject({ eligibleCount: 3, settleableCount: 2, ifrBaseUnits: (4_000_000_000_000n / 3n).toString() });
    expect(capped.events.excluded).toContainEqual({ id: events[2].id, reason: 'BUDGET_EXHAUSTED' });
    expect(capped.events.eligible.sort()).toEqual([events[0].id, events[1].id].sort());
    // Stricter since the T-275 review (F2): a partially covered month would consume its milestoneId
    // and strand the BUDGET_EXHAUSTED event, so it stays diagnostic. Amounts and exclusions remain
    // visible for diagnosis; only the executable template is withheld.
    expect(capped.blockers).toContain('BUDGET_CAPPED');
    expect(capped.mode).toBe('diagnostic');
    expect(capped.template).toBeNull();

    // A month that exactly fits the remaining allocation still yields a template (stops exactly at budget).
    const exactFit = await exportDirect({
      chain: { partner: { active: true, milestonesFinal: false, maxAllocation: 3_000n * IFR, unlockedTotal: 1_000n * IFR, rewardAccrued: 0n }, pilotUsage: { [partnerId]: 1_000n * IFR, [otherPilotId]: 0n } },
    });
    expect(exactFit.budgets.status).toBe('WITHIN_BUDGET');
    expect(exactFit.totals).toMatchObject({ settleableCount: 3, ifrBaseUnits: '2000000000000' });
    expect(exactFit.mode).toBe('proposal-template');

    // The global pilot budget is exhausted by another pilot partner.
    const globalExhausted = await exportDirect({ chain: { pilotUsage: { [partnerId]: 0n, [otherPilotId]: 1_000_000n * IFR } } });
    expect(globalExhausted.budgets.status).toBe('EXHAUSTED');
    expect(globalExhausted.blockers).toContain('BUDGET_EXHAUSTED');
    expect(globalExhausted.template).toBeNull();

    // The policy partner budget binds even when the on-chain allocation is larger.
    mutableConfig.MODEL_B_PILOT_POLICY_JSON = JSON.stringify(policy(businessId, {}, { partnerBudgetBaseUnits: (700n * IFR).toString() }));
    const policyCapped = await exportDirect();
    expect(policyCapped.totals.settleableCount).toBe(1);
    expect(policyCapped.totals.ifrBaseUnits).toBe('666666666666');
    expect(policyCapped.budgets.status).toBe('CAPPED');
    expect(policyCapped.template).toBeNull();

    // A settlement above the 4M annualEmissionCap is still allowed when both budgets cover it.
    mutableConfig.MODEL_B_PILOT_POLICY_JSON = JSON.stringify(policy(businessId,
      { globalPilotBudgetBaseUnits: (10_000_000n * IFR).toString() },
      { eurMinorPerRedemption: '600000', partnerBudgetBaseUnits: (10_000_000n * IFR).toString() }));
    const large = await exportDirect({ chain: { partner: { active: true, milestonesFinal: false, maxAllocation: 10_000_000n * IFR, unlockedTotal: 0n, rewardAccrued: 0n } } });
    expect(BigInt(large.totals.ifrBaseUnits as string)).toBe(6_000_000n * IFR);
    expect(large.mode).toBe('proposal-template');
  });

  it('blocks the template while a post-pilot, non-self redemption has no reward event (F1, gap G1)', async () => {
    mutableConfig.MODEL_B_PILOT_POLICY_JSON = JSON.stringify(policy(businessId, {}, { startsAt: '2026-08-15T00:00:00Z' }));
    const repeatCustomer = ethers.Wallet.createRandom().address;
    const first = await redemption({ redeemedAt: '2026-08-16T00:00:00.000Z', customer: repeatCustomer });
    // Expected missing events: owner self-test (skipped at redeem time) and a pre-pilot redemption.
    await redemption({ redeemedAt: '2026-08-17T00:00:00.000Z', customer: owner.address, eventPartnerId: null });
    await redemption({ redeemedAt: '2026-08-10T00:00:00.000Z', eventPartnerId: null });
    const clean = await exportDirect();
    expect(clean.reconciliation).toMatchObject({
      status: 'RECONCILED',
      redemptionsWithoutRewardEvent: 2,
      redemptionsWithoutRewardEventReasons: { SELF_REDEMPTION: 1, PRE_PILOT: 1, MISSING_REWARD_EVENT: 0 },
    });
    expect(clean.mode).toBe('proposal-template');

    // A repeat redemption by the same customer was dropped by the one-per-wallet outbox constraint.
    await redemption({ redeemedAt: '2026-08-20T00:00:00.000Z', customer: repeatCustomer, eventPartnerId: null });
    const blocked = await exportDirect();
    expect(blocked.reconciliation).toMatchObject({
      status: 'MISMATCH',
      redemptionsWithoutRewardEvent: 3,
      redemptionsWithoutRewardEventReasons: { SELF_REDEMPTION: 1, PRE_PILOT: 1, MISSING_REWARD_EVENT: 1 },
    });
    expect(blocked.reconciliation.discrepancies).toContainEqual({ code: 'REDEMPTION_WITHOUT_REWARD_EVENT', count: 1 });
    expect(blocked.blockers).toContain('RECONCILIATION_DISCREPANCY');
    expect(blocked.mode).toBe('diagnostic');
    expect(blocked.template).toBeNull();
    // Diagnosis keeps amounts and the eligible event; price, chain and authorization are otherwise valid.
    expect(blocked.events.eligible).toEqual([first.event!.id]);
    expect(blocked.totals.ifrBaseUnits).toBe('666666666666');
    expect(blocked.priceEvidence.status).toBe('VALID');
    expect(blocked.blockers).toEqual(['RECONCILIATION_DISCREPANCY']);
    // The customer wallet used to explain the gap never leaves the service.
    expect(JSON.stringify(blocked).toLowerCase()).not.toContain(repeatCustomer.toLowerCase().slice(2));
  });

  it('refuses a template for replayed milestones, paused vaults, lock-path use, inactive partners or missing chain state', async () => {
    await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z' });
    const cases: Array<[Partial<ModelBChainState> | null, string]> = [
      [{ milestoneDone: true }, 'MILESTONE_ALREADY_RECORDED'],
      [{ paused: true }, 'PARTNER_VAULT_PAUSED'],
      [{ partner: { active: true, milestonesFinal: false, maxAllocation: 1_000_000n * IFR, unlockedTotal: 0n, rewardAccrued: 1n } }, 'LOCK_REWARD_PATH_USED'],
      [{ partner: { active: false, milestonesFinal: false, maxAllocation: 1_000_000n * IFR, unlockedTotal: 0n, rewardAccrued: 0n } }, 'PARTNER_INACTIVE'],
      [{ partner: { active: true, milestonesFinal: true, maxAllocation: 1_000_000n * IFR, unlockedTotal: 0n, rewardAccrued: 0n } }, 'PARTNER_MILESTONES_FINAL'],
      [{ chainId: 11155111 }, 'CHAIN_MISMATCH'],
      [{ pilotUsage: { [partnerId]: 0n } }, 'GLOBAL_BUDGET_UNVERIFIED'],
      [null, 'CHAIN_STATE_UNAVAILABLE'],
    ];
    for (const [chain, blocker] of cases) {
      const exported = await exportDirect({ chain });
      expect(exported.blockers).toContain(blocker);
      expect(exported.template).toBeNull();
    }
    await prisma.sellerRewardLink.update({ where: { businessId }, data: { status: 'STALE' } });
    expect((await exportDirect()).blockers).toContain('SELLER_LINK_NOT_VERIFIED');
  });

  it('keeps the milestone identity per partner and month regardless of content or policy version', async () => {
    await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z' });
    const first = await exportDirect();
    await redemption({ redeemedAt: '2026-08-03T00:00:00.000Z' });
    mutableConfig.MODEL_B_PILOT_POLICY_JSON = JSON.stringify(policy(businessId, { policyVersion: 'lane4-model-b-test-2' }));
    const second = await exportDirect();
    expect(second.milestoneId).toBe(first.milestoneId);
    expect(second.batchDigest).not.toBe(first.batchDigest);
    const period = parseSettlementPeriod(PERIOD);
    expect(computeMilestoneId(1, PARTNER_VAULT, partnerId, parseSettlementPeriod('2026-09'))).not.toBe(first.milestoneId);
    expect(computeMilestoneId(1, PARTNER_VAULT, otherPilotId, period)).not.toBe(first.milestoneId);
    expect(computeMilestoneId(11155111, PARTNER_VAULT, partnerId, period)).not.toBe(first.milestoneId);
    expect(computeMilestoneId(1, PARTNER_VAULT, partnerId, period)).toBe(first.milestoneId);
  });

  // ── Template bytes ─────────────────────────────────────────────────────────

  it('decodes the template against the recordMilestone/propose ABI and rejects tampering', async () => {
    await redemption({ redeemedAt: '2026-08-02T00:00:00.000Z' });
    await redemption({ redeemedAt: '2026-08-03T00:00:00.000Z' });
    await redemption({ redeemedAt: '2026-08-04T00:00:00.000Z' });
    const exported = await exportDirect();
    const template = exported.template as RecordMilestoneTemplate;
    const vaultAbi = new ethers.Interface(['function recordMilestone(bytes32 partnerId, bytes32 milestoneId, uint256 unlockAmount)']);
    const govAbi = new ethers.Interface(['function propose(address target, bytes data) returns (uint256)']);
    expect(template.transactions[0].to).toBe(GOVERNANCE);
    expect(template.transactions[0].value).toBe('0');
    const [target, inner] = govAbi.decodeFunctionData('propose', template.transactions[0].data);
    expect(target).toBe(PARTNER_VAULT);
    expect(inner.slice(0, 10)).toBe(ethers.id('recordMilestone(bytes32,bytes32,uint256)').slice(0, 10));
    const [decodedPartner, decodedMilestone, amount] = vaultAbi.decodeFunctionData('recordMilestone', inner);
    expect(decodedPartner).toBe(partnerId);
    expect(decodedMilestone).toBe(exported.milestoneId);
    expect(amount).toBe(2_000_000_000_000n);
    expect(template.meta).toMatchObject({ batchDigest: exported.batchDigest, evidenceDigest: exported.priceEvidence.digest, period: PERIOD });

    const expected = {
      chainId: 1, governance: GOVERNANCE, partnerVault: PARTNER_VAULT, partnerId,
      milestoneId: exported.milestoneId, unlockAmount: 2_000_000_000_000n, remainingAllocation: 1_000_000n * IFR,
    };
    expect(() => validateRecordMilestoneTemplate(template, expected)).not.toThrow();
    expect(() => validateRecordMilestoneTemplate(template, { ...expected, remainingAllocation: 1_999_999_999_999n })).toThrow(/remaining allocation/);
    expect(() => validateRecordMilestoneTemplate(template, { ...expected, unlockAmount: 1n })).toThrow(/unlockAmount/);
    expect(() => validateRecordMilestoneTemplate(template, { ...expected, partnerId: otherPilotId })).toThrow(/partnerId/);
    expect(() => validateRecordMilestoneTemplate({ ...template, submitted: true as never }, expected)).toThrow(/unsigned/);
    const wrongTarget = govAbi.encodeFunctionData('propose', [GOVERNANCE, inner]);
    expect(() => validateRecordMilestoneTemplate({ ...template, transactions: [{ ...template.transactions[0], data: wrongTarget }] }, expected))
      .toThrow(/PartnerVault/);

    // Golden fixture consumed by the isolated Hardhat allocation test (test/PartnerVaultModelB.test.js).
    const fixturePath = path.join(__dirname, 'fixtures', 'model-b-recordMilestone-template.json');
    const fixture = {
      note: 'Deterministic Model B template fixture (T-275). Unsigned test data only; never submit.',
      partnerId,
      milestoneId: exported.milestoneId,
      unlockAmount: amount.toString(),
      template: { ...template, meta: { ...template.meta, batchDigest: '<varies with test event ids>' } },
    };
    if (process.env.UPDATE_MODEL_B_FIXTURE === '1') fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
    const golden = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    expect(golden.template.transactions).toEqual(template.transactions);
    expect(golden.template.inner).toEqual(template.inner);
    expect(golden.milestoneId).toBe(exported.milestoneId);
  });
});
