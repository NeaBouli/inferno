import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';

const mockEligibility = jest.fn();
jest.mock('../src/services/ifrLockService', () => ({
  checkBenefitEligibility: (...args: unknown[]) => mockEligibility(...args),
  recoverSigner: (message: string, signature: string) => require('ethers').verifyMessage(message, signature),
}));
jest.mock('../src/config', () => ({ config: {
  CHAIN_ID: 11155111, SELLER_AUTH_DOMAIN: 'shop.example.test',
  PARTNER_VAULT_ADDRESS: `0x${'11'.repeat(20)}`, MODEL_B_SETTLEMENT_ENABLED: 'true',
  MODEL_B_PILOT_POLICY_JSON: '', MODEL_B_DEDUP_SECRET: 'ab'.repeat(32), REWARD_CALLER_ADDRESS: undefined,
} }));

import { config } from '../src/config';
import { prisma, attest, buildChallengeMessage, createSessionSnapshot } from '../src/services/sessionService';
import { modelBDedupKey, modelBRewardDecision } from '../src/services/modelBDedup';
import { getModelBPolicy } from '../src/services/modelBPolicy';
import {
  bindCustomerPass, confirmCustomerPass, createCustomerPass,
  getControlledCustomerPass, getCustomerPassChallenge,
} from '../src/services/customerPassService';
import { issueSellerAuthorizationChallenge } from '../src/services/sellerAuthorizationChallenge';
import { buildSettlementExport, parseSettlementPeriod, CUSTOMER_DEDUP_POLICY_GAP } from '../src/services/modelBSettlement';
import { loadSettlementRecords } from '../src/services/modelBSettlementData';

const mutable = config as unknown as Record<string, unknown>;
const owner = ethers.Wallet.createRandom();
const customer = ethers.Wallet.createRandom();
const outsider = ethers.Wallet.createRandom();
const partnerId = `0x${'ab'.repeat(32)}`;
let businessId: string;
let ruleId: string;

async function open() {
  return prisma.$transaction((tx) => createSessionSnapshot(tx, { businessId, benefitRuleId: ruleId,
    creator: { walletAddress: owner.address, role: 'OWNER', operatorId: null, label: 'Owner', expiresAt: null } }));
}
async function redeem(sessionId: string, wallet = customer) {
  const message = await buildChallengeMessage(sessionId, wallet.address);
  return attest(sessionId, wallet.address, await wallet.signMessage(message));
}

beforeEach(async () => {
  await prisma.rewardEvent.deleteMany(); await prisma.auditLog.deleteMany(); await prisma.session.deleteMany();
  await prisma.customerPass.deleteMany(); await prisma.sellerRewardLink.deleteMany();
  await prisma.benefitRule.deleteMany(); await prisma.product.deleteMany(); await prisma.checkoutOperator.deleteMany();
  await prisma.business.deleteMany();
  businessId = (await prisma.business.create({ data: { name: 'Synthetic pilot', ownerAddress: owner.address,
    discountPercent: 10, requiredLockIFR: 1000 } })).id;
  ruleId = (await prisma.benefitRule.create({ data: { businessId, label: 'Exact offer', category: 'retail', productName: 'Synthetic product', discountPercent: 15,
    requiredLockIFR: 1000, ttlSeconds: 300 } })).id;
  await prisma.sellerRewardLink.create({ data: { businessId, status: 'VERIFIED', partnerId } });
  mutable.MODEL_B_SETTLEMENT_ENABLED = 'true'; mutable.REWARD_CALLER_ADDRESS = undefined;
  mutable.MODEL_B_DEDUP_SECRET = 'ab'.repeat(32);
  mutable.MODEL_B_PILOT_POLICY_JSON = JSON.stringify({ policyVersion: 'owner-2026-10-17',
    globalPilotBudgetBaseUnits: '10000000000000', twapPair: `0x${'44'.repeat(20)}`, pilots: [{
      partnerId, businessId, eurMinorPerRedemption: '50', partnerBudgetBaseUnits: '10000000000000',
      startsAt: '2026-01-01T00:00:00Z', governanceReference: 'synthetic-only',
    }] });
  mockEligibility.mockResolvedValue({ eligible: true, lockEligible: true, heldEligible: true,
    lockedAmount: '1000.0', walletAmount: null, walletBalanceRaw: null, ifrLockAmount: '1000.0',
    commitmentAmount: null, verifiedLockSource: 'ifrlock', verificationBlock: 123 });
});
afterAll(() => prisma.$disconnect());

test.each(['PENDING', 'APPROVED'])('an expired %s bound pass that is only polled never holds a wallet/partner reward or blocks a replacement checkout', async (status) => {
  const openPass = async () => {
    const pass = await createCustomerPass();
    const scope = `${pass.passId}:${ruleId}`;
    const nonce = await issueSellerAuthorizationChallenge(prisma, { action: 'passes:bind', businessId,
      scope, expiresAt: new Date(Date.now() + 60_000) });
    const session = await bindCustomerPass({ passId: pass.passId, businessId, benefitRuleId: ruleId,
      sellerWallet: owner.address, nonce, scope });
    return { ...pass, sessionId: session.sessionId };
  };
  const old = await openPass();
  const authorization = `Bearer ${old.controlToken}`;
  await getCustomerPassChallenge(old.passId, customer.address, authorization);
  const expiresAt = new Date(Date.now() - 1000);
  await prisma.session.update({ where: { id: old.sessionId }, data: { status, expiresAt } });
  await prisma.customerPass.update({ where: { id: old.passId }, data: { expiresAt } });
  const passBefore = await prisma.customerPass.findUniqueOrThrow({ where: { id: old.passId } });
  const sessionBefore = await prisma.session.findUniqueOrThrow({ where: { id: old.sessionId } });
  const auditBefore = await prisma.auditLog.findMany({ where: { sessionId: old.sessionId }, orderBy: { id: 'asc' } });
  expect(passBefore.status).toBe('BOUND');

  // After expiry the old pass is only read; no POST or cleanup persists its EXPIRED transition.
  for (let poll = 0; poll < 2; poll += 1) {
    expect(await getControlledCustomerPass(old.passId, authorization))
      .toMatchObject({ status: 'EXPIRED', checkout: { status: 'EXPIRED' } });
  }
  expect(await prisma.rewardEvent.count({ where: { partnerId } })).toBe(0);

  const next = await openPass();
  expect(next.passId).not.toBe(old.passId);
  const nextAuthorization = `Bearer ${next.controlToken}`;
  const message = await getCustomerPassChallenge(next.passId, customer.address, nextAuthorization);
  expect(await confirmCustomerPass(next.passId, customer.address, await customer.signMessage(message), nextAuthorization))
    .toMatchObject({ status: 'REDEEMED', wallet: customer.address });
  expect(await prisma.rewardEvent.findMany({ where: { partnerId } })).toEqual([
    expect.objectContaining({ sessionId: next.sessionId, businessId, status: 'SETTLEMENT_PENDING',
      rewardDedupKey: expect.stringMatching(/^[\w-]{22}\.[\w-]{43}$/) }),
  ]);
  expect(await prisma.customerPass.findUniqueOrThrow({ where: { id: old.passId } })).toEqual(passBefore);
  expect(await prisma.session.findUniqueOrThrow({ where: { id: old.sessionId } })).toEqual(sessionBefore);
  expect(await prisma.auditLog.findMany({ where: { sessionId: old.sessionId }, orderBy: { id: 'asc' } })).toEqual(auditBefore);
});

test('verified exact-offer checkout creates one eligible event; a repeat wallet still redeems without another reward', async () => {
  const first = await open(); const second = await open();
  expect((await redeem(first.id)).status).toBe('REDEEMED');
  expect((await redeem(second.id)).status).toBe('REDEEMED');
  await expect(redeem(first.id)).rejects.toThrow();
  const events = await prisma.rewardEvent.findMany({ orderBy: { createdAt: 'asc' } });
  expect(events.map((event) => event.status)).toEqual(['SETTLEMENT_PENDING', 'SKIPPED_DUPLICATE']);
  expect(events[0].rewardDedupKey).toMatch(/^[\w-]{22}\.[\w-]{43}$/);
  expect(events[1].rewardDedupKey).toBeNull();
  const data = JSON.stringify({ events, sessions: await prisma.session.findMany(), audits: await prisma.auditLog.findMany() }).toLowerCase();
  expect(data).not.toContain(customer.address.slice(2).toLowerCase());
  const state = getModelBPolicy(); if (!state.enabled) throw new Error(state.reason);
  const period = parseSettlementPeriod(events[0].rewardPeriod!);
  const records = await loadSettlementRecords(prisma, state.policy.pilots[0], period);
  const report = buildSettlementExport({ policy: state.policy, pilot: state.policy.pilots[0], period,
    now: new Date(period.end.getTime() + 1), expectedChainId: 11155111, partnerVaultAddress: config.PARTNER_VAULT_ADDRESS!,
    ifrTokenAddress: `0x${'55'.repeat(20)}`, records: records!, sellerConfirmedRedemptions: 2, chain: null });
  expect(report.blockers).not.toContain(CUSTOMER_DEDUP_POLICY_GAP);
  expect(report.blockers).toContain('OPERATOR_LEDGER_REQUIRED');
  expect(report.template).toBeNull();
  expect(report.reconciliation.status).toBe('RECONCILED');
  expect(report.totals.eligibleCount).toBe(1);
  expect(report.events.excluded).toContainEqual({ id: events[1].id, reason: 'DUPLICATE_WALLET_PERIOD' });
  const altered = buildSettlementExport({ policy: state.policy, pilot: state.policy.pilots[0], period,
    now: new Date(period.end.getTime() + 1), expectedChainId: 11155111, partnerVaultAddress: config.PARTNER_VAULT_ADDRESS!,
    ifrTokenAddress: `0x${'55'.repeat(20)}`, records: { ...records!, events: records!.events.map((event) =>
      event.rewardDedupKey ? { ...event, rewardDedupKey: `${'z'.repeat(22)}.${'y'.repeat(43)}` } : event) },
    sellerConfirmedRedemptions: 2, chain: null });
  expect(altered.batchDigest).not.toBe(report.batchDigest);
  expect(JSON.stringify(report)).not.toContain(events[0].rewardDedupKey!);
});

test('concurrent different checkouts of the same wallet earn one reward, protected by SQLite transaction and unique index', async () => {
  const a = await open(); const b = await open();
  const results = await Promise.all([redeem(a.id), redeem(b.id)]);
  expect(results.map((r) => r.status)).toEqual(['REDEEMED', 'REDEEMED']);
  expect(await prisma.rewardEvent.count({ where: { status: 'SETTLEMENT_PENDING' } })).toBe(1);
  expect(await prisma.rewardEvent.count({ where: { status: 'SKIPPED_DUPLICATE' } })).toBe(1);
  const event = await prisma.rewardEvent.findFirstOrThrow({ where: { rewardDedupKey: { not: null } } });
  const another = await open();
  await expect(prisma.rewardEvent.create({ data: { businessId, sessionId: another.id, partnerId, chainId: 11155111,
    rewardPeriod: event.rewardPeriod, rewardDedupKey: event.rewardDedupKey } })).rejects.toMatchObject({ code: 'P2002' });
});

test('dedup survives a new database client, scopes to partner/month and rejects mid-period key rotation', async () => {
  await redeem((await open()).id);
  const otherDb = new PrismaClient();
  try {
    const decision = await otherDb.$transaction((tx) => modelBRewardDecision(tx, { businessId, partnerId,
      wallet: customer.address, now: new Date(), proofVersion: 2, snapshotVersion: 5 }));
    expect(decision.status).toBe('SKIPPED_DUPLICATE');
    const nextMonth = new Date(); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const next = await otherDb.$transaction((tx) => modelBRewardDecision(tx, { businessId, partnerId,
      wallet: customer.address, now: nextMonth, proofVersion: 2, snapshotVersion: 5 }));
    expect(next.status).toBe('SETTLEMENT_PENDING');
  } finally { await otherDb.$disconnect(); }
  const key = (partner: string, period: string, wallet = customer.address) => modelBDedupKey('ab'.repeat(32),
    11155111, config.PARTNER_VAULT_ADDRESS!, partner, period, wallet);
  expect(key(partnerId, '2026-08')).toBe(key(partnerId, '2026-08', customer.address.toLowerCase()));
  expect(key(partnerId, '2026-08')).not.toBe(key(partnerId, '2026-09'));
  expect(key(partnerId, '2026-08')).not.toBe(key(`0x${'cd'.repeat(32)}`, '2026-08'));
  mutable.MODEL_B_DEDUP_SECRET = 'cd'.repeat(32);
  await redeem((await open()).id, outsider);
  expect(await prisma.rewardEvent.count({ where: { status: 'SETTLEMENT_PENDING' } })).toBe(1);
  expect(await prisma.rewardEvent.findFirst({ where: { status: 'BLOCKED_POLICY' } })).toMatchObject({ rewardDedupKey: null });
});

test('mismatched offer/signature, unconfirmed seller and failed verification never reserve a customer key', async () => {
  const session = await open();
  const message = await buildChallengeMessage(session.id, customer.address);
  await prisma.session.update({ where: { id: session.id }, data: { benefitDiscountPercent: 20 } });
  await expect(attest(session.id, customer.address, await customer.signMessage(message))).rejects.toThrow();
  const unconfirmed = await open();
  await prisma.session.update({ where: { id: unconfirmed.id }, data: { confirmedByWallet: null } });
  await expect(redeem(unconfirmed.id)).rejects.toThrow('seller checkout confirmation');
  mockEligibility.mockResolvedValueOnce({ eligible: false });
  await redeem((await open()).id);
  expect(await prisma.rewardEvent.count()).toBe(0);
});

test.each(['missing-secret', 'invalid-secret', 'non-pilot', 'caller', 'pre-pilot'])('fails closed for %s without storing customer keys', async (condition) => {
  if (condition === 'missing-secret') mutable.MODEL_B_DEDUP_SECRET = undefined;
  if (condition === 'invalid-secret') mutable.MODEL_B_DEDUP_SECRET = 'short';
  if (condition === 'non-pilot') mutable.MODEL_B_PILOT_POLICY_JSON = undefined;
  if (condition === 'caller') mutable.REWARD_CALLER_ADDRESS = owner.address;
  if (condition === 'pre-pilot') {
    const policy = JSON.parse(String(mutable.MODEL_B_PILOT_POLICY_JSON));
    policy.pilots[0].startsAt = '2100-01-01T00:00:00Z'; mutable.MODEL_B_PILOT_POLICY_JSON = JSON.stringify(policy);
  }
  expect((await redeem((await open()).id)).status).toBe('REDEEMED');
  expect(await prisma.rewardEvent.findFirst()).toMatchObject({ status: 'BLOCKED_POLICY', rewardDedupKey: null, rewardPeriod: null });
});

test('self-redemptions create no reward or dedup key', async () => {
  await redeem((await open()).id, owner);
  expect(await prisma.rewardEvent.count()).toBe(0);
});
