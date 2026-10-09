import { ethers } from 'ethers';
import { z } from 'zod';
import type { ModelBPilot, ModelBPolicy } from './modelBPolicy';

/**
 * Lane 4 Model B per-period settlement export (T-275).
 *
 * Boundary: seller-confirmed verified redemption -> existing RewardEvent outbox -> reconciled
 * period export -> unsigned Governance.propose(PartnerVault.recordMilestone) template.
 *
 * Everything in this module is a pure computation over already persisted data and read-only chain
 * state. It never writes reward state, never signs and never submits; an export or template is not
 * a settlement and not a payment.
 */

export const SETTLEMENT_DOMAIN = 'IFR-PARTNER-REWARDS-MODEL-B-V1';
export const TWAP_WINDOW_SECONDS = 7 * 24 * 60 * 60;
// Block timestamps never land exactly on the 7-day mark; allow at most one hour of overshoot.
export const TWAP_WINDOW_TOLERANCE_SECONDS = 60 * 60;
export const ETH_EUR_MAX_SKEW_SECONDS = 24 * 60 * 60;
// The 7-day TWAP window must end (settlement block) no later than 72 hours after the period end, and
// the ETH/EUR reference must be published inside [period end - 24h, period end + 72h]. Without this
// bound the operator could pick any later week (e.g. the lowest IFR price) and every candidate window
// would still reproduce. The pilot policy has no field for it, so it is a reviewed constant.
export const SETTLEMENT_MAX_LAG_SECONDS = 72 * 60 * 60;
const Q112 = 2n ** 112n;
const UINT256_MOD = 2n ** 256n;

export const PARTNER_VAULT_RECORD_MILESTONE_ABI = [
  'function recordMilestone(bytes32 partnerId, bytes32 milestoneId, uint256 unlockAmount)',
];
export const GOVERNANCE_PROPOSE_ABI = ['function propose(address target, bytes data) returns (uint256)'];
const partnerVaultInterface = new ethers.Interface(PARTNER_VAULT_RECORD_MILESTONE_ABI);
const governanceInterface = new ethers.Interface(GOVERNANCE_PROPOSE_ABI);

// Reward event statuses that are still on their way through reconciliation.
const UNRECONCILED_STATUSES = new Set(['PENDING', 'READY', 'BLOCKED_CALLER', 'BLOCKED_GOVERNANCE']);
export const MODEL_B_SETTLEMENT_PENDING = 'SETTLEMENT_PENDING';
export const CUSTOMER_DEDUP_POLICY_GAP = 'CUSTOMER_DEDUP_UNAVAILABLE_OWNER_B';

// ── Period ──────────────────────────────────────────────────────────────────

export interface SettlementPeriod {
  label: string;
  start: Date;
  end: Date;
}

/** Settlement periods are whole UTC calendar months, half-open [start, end). */
export function parseSettlementPeriod(label: string): SettlementPeriod {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(label);
  if (!match) throw new Error('Settlement period must be a UTC calendar month (YYYY-MM)');
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (year < 2026 || year > 2100) throw new Error('Settlement period year is out of range');
  return {
    label,
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
  };
}

export function isInPeriod(instant: Date, period: SettlementPeriod): boolean {
  const time = instant.getTime();
  return time >= period.start.getTime() && time < period.end.getTime();
}

// ── Identity and digests ────────────────────────────────────────────────────

/**
 * Deterministic milestone identity. It depends only on the chain, vault, partner and period, never
 * on content or policy version, so re-exporting a month can never mint a second identity and the
 * contract's milestoneDone mapping rejects a second recordMilestone for the same month.
 */
export function computeMilestoneId(chainId: number, partnerVault: string, partnerId: string, period: SettlementPeriod): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['string', 'uint256', 'address', 'bytes32', 'uint64', 'uint64'],
    [
      SETTLEMENT_DOMAIN,
      BigInt(chainId),
      ethers.getAddress(partnerVault),
      partnerId,
      BigInt(Math.floor(period.start.getTime() / 1000)),
      BigInt(Math.floor(period.end.getTime() / 1000)),
    ]
  ));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function canonicalDigest(value: unknown): string {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(canonicalize(value))));
}

// ── Price evidence ──────────────────────────────────────────────────────────

const uintString = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => value.toLowerCase());
const observationSchema = z.object({
  blockNumber: z.number().int().positive(),
  blockHash: bytes32,
  timestamp: z.number().int().positive(),
  // Uniswap V2 currentCumulativePrices price0 (UQ112x112 seconds) at that block.
  price0Cumulative: uintString,
}).strict();

export const priceEvidenceSchema = z.object({
  reviewedSourceId: z.string().min(1).max(80),
  pair: address,
  token0: address,
  start: observationSchema,
  end: observationSchema,
  ethEur: z.object({
    source: z.string().min(1).max(120),
    publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/),
    rate: uintString,
    decimals: z.number().int().min(0).max(18),
  }).strict(),
  rounding: z.literal('floor'),
}).strict();

export type PriceEvidence = z.infer<typeof priceEvidenceSchema>;

export type PriceEvidenceResult =
  | { status: 'MISSING'; reason: string }
  | { status: 'INVALID'; reason: string }
  | {
    status: 'VALID';
    evidence: PriceEvidence;
    digest: string;
    windowSeconds: number;
    cumulativeDelta: bigint;
    settlementBlock: { number: number; hash: string; timestamp: number };
  };

export function validatePriceEvidence(
  raw: unknown,
  context: { policy: ModelBPolicy; ifrTokenAddress: string; period: SettlementPeriod }
): PriceEvidenceResult {
  if (raw === undefined || raw === null) {
    return { status: 'MISSING', reason: 'No reviewed 7-day TWAP and ETH/EUR evidence supplied' };
  }
  const parsed = priceEvidenceSchema.safeParse(raw);
  if (!parsed.success) return { status: 'INVALID', reason: 'Price evidence does not match the cumulative-TWAP schema' };
  const evidence = parsed.data;
  if (!context.policy.reviewedPriceSourceIds.includes(evidence.reviewedSourceId)) {
    return { status: 'INVALID', reason: 'Price evidence source is not a reviewed source in the pilot policy' };
  }
  if (evidence.pair !== context.policy.twapPair) {
    return { status: 'INVALID', reason: 'Price evidence pair is not the policy IFR/WETH pair' };
  }
  if (evidence.token0 !== context.ifrTokenAddress.toLowerCase()) {
    return { status: 'INVALID', reason: 'Price evidence token0 is not IFR' };
  }
  if (evidence.end.blockNumber <= evidence.start.blockNumber) {
    return { status: 'INVALID', reason: 'Price evidence end block must follow the start block' };
  }
  const windowSeconds = evidence.end.timestamp - evidence.start.timestamp;
  if (windowSeconds < TWAP_WINDOW_SECONDS || windowSeconds > TWAP_WINDOW_SECONDS + TWAP_WINDOW_TOLERANCE_SECONDS) {
    return { status: 'INVALID', reason: 'Price evidence window is not a 7-day TWAP' };
  }
  if (evidence.end.timestamp * 1000 < context.period.end.getTime()) {
    return { status: 'INVALID', reason: 'Settlement block precedes the end of the settlement period' };
  }
  const latestSettlementMs = context.period.end.getTime() + SETTLEMENT_MAX_LAG_SECONDS * 1000;
  if (evidence.end.timestamp * 1000 > latestSettlementMs) {
    return { status: 'INVALID', reason: 'Settlement block is more than 72 hours after the end of the settlement period' };
  }
  const cumulativeDelta = (BigInt(evidence.end.price0Cumulative) - BigInt(evidence.start.price0Cumulative) + UINT256_MOD) % UINT256_MOD;
  if (cumulativeDelta === 0n) {
    return { status: 'INVALID', reason: 'Price evidence cumulative price did not advance' };
  }
  const rate = BigInt(evidence.ethEur.rate);
  if (rate === 0n) return { status: 'INVALID', reason: 'ETH/EUR reference rate must be positive' };
  const publishedAt = Date.parse(evidence.ethEur.publishedAt);
  if (Number.isNaN(publishedAt) || Math.abs(publishedAt / 1000 - evidence.end.timestamp) > ETH_EUR_MAX_SKEW_SECONDS) {
    return { status: 'INVALID', reason: 'ETH/EUR reference is not bound to the settlement block time' };
  }
  if (publishedAt < context.period.end.getTime() - ETH_EUR_MAX_SKEW_SECONDS * 1000 || publishedAt > latestSettlementMs) {
    return { status: 'INVALID', reason: 'ETH/EUR reference is not bound to the settlement period' };
  }
  return {
    status: 'VALID',
    evidence,
    digest: canonicalDigest(evidence),
    windowSeconds,
    cumulativeDelta,
    settlementBlock: { number: evidence.end.blockNumber, hash: evidence.end.blockHash, timestamp: evidence.end.timestamp },
  };
}

/**
 * Exact EUR minor units -> IFR base units (9 decimals), rounded down.
 *
 * price0 of the IFR(token0)/WETH(token1) pair is wei per IFR base unit; the 7-day TWAP is
 * cumulativeDelta / (window * 2^112). EUR per ETH is rate / 10^decimals. Therefore
 * ifrBase = eurMinor * 10^decimals * 10^18 * window * 2^112 / (100 * rate * cumulativeDelta).
 */
export function convertEurMinorToIfrBase(
  eurMinor: bigint,
  price: { windowSeconds: number; cumulativeDelta: bigint; rate: bigint; decimals: number }
): bigint {
  if (eurMinor < 0n) throw new Error('EUR amount must not be negative');
  if (price.cumulativeDelta <= 0n || price.rate <= 0n || price.windowSeconds <= 0) {
    throw new Error('Invalid price inputs');
  }
  const numerator = eurMinor * 10n ** BigInt(price.decimals) * 10n ** 18n * BigInt(price.windowSeconds) * Q112;
  const denominator = 100n * price.rate * price.cumulativeDelta;
  return numerator / denominator;
}

// ── Inputs loaded from the existing persistence ─────────────────────────────

export interface RedemptionConfirmation {
  actorWallet: string | null;
  actorRole: string | null;
  operatorId: string | null;
}

export interface RedemptionRecord {
  sessionId: string;
  redeemedAt: Date;
  // In-request self-redemption outcome (owner decision B: no customer wallet is stored).
  selfRedemption: boolean | null;
  confirmations: RedemptionConfirmation[];
}

export interface RewardEventRecord {
  id: string;
  businessId: string;
  partnerId: string;
  status: string;
  session: { id: string; businessId: string; status: string; redeemedAt: Date | null; selfRedemption: boolean | null };
}

export interface OwnershipRecord {
  businessActive: boolean;
  ownerAddress: string | null;
  operators: { id: string; walletAddress: string }[];
  link: {
    status: string;
    partnerId: string | null;
    rewardWallet: string | null;
    builderWallet: string | null;
  } | null;
}

export interface SettlementRecords {
  ownership: OwnershipRecord;
  redemptions: RedemptionRecord[];
  events: RewardEventRecord[];
  orphanEventIds: string[];
}

export interface ModelBChainState {
  chainId: number;
  blockNumber: number;
  blockHash: string;
  partnerVault: string;
  governance: string;
  paused: boolean;
  sellerVerified: boolean;
  sellerReason: string | null;
  partner: {
    active: boolean;
    milestonesFinal: boolean;
    maxAllocation: bigint;
    unlockedTotal: bigint;
    rewardAccrued: bigint;
  };
  // unlockedTotal + rewardAccrued for every pilot partner in the policy, keyed by partnerId.
  pilotUsage: Record<string, bigint>;
  milestoneDone: boolean;
}

export interface ExportInput {
  policy: ModelBPolicy;
  pilot: ModelBPilot;
  period: SettlementPeriod;
  now: Date;
  expectedChainId: number;
  partnerVaultAddress: string;
  ifrTokenAddress: string;
  records: SettlementRecords;
  sellerConfirmedRedemptions?: number;
  priceEvidence?: unknown;
  chain: ModelBChainState | null;
}

export type ExclusionReason =
  | 'BUSINESS_MISMATCH'
  | 'SESSION_NOT_REDEEMED'
  | 'PRE_PILOT'
  | 'UNCONFIRMED_REDEMPTION'
  | 'UNAUTHORIZED_CONFIRMER'
  | 'REPLAYED_CONFIRMATION'
  | 'SELF_REDEMPTION'
  | 'LOCK_REWARD_ALREADY_RECORDED'
  | 'NOT_RECONCILED'
  | 'STATUS_INELIGIBLE'
  | 'BUDGET_EXHAUSTED';

// Exclusions that indicate an integrity problem and block proposal generation.
const DISCREPANCY_REASONS = new Set<ExclusionReason>([
  'BUSINESS_MISMATCH',
  'SESSION_NOT_REDEEMED',
  'UNCONFIRMED_REDEMPTION',
  'UNAUTHORIZED_CONFIRMER',
  'REPLAYED_CONFIRMATION',
  'LOCK_REWARD_ALREADY_RECORDED',
  'NOT_RECONCILED',
]);

const lower = (value: string | null | undefined) => (value ? value.toLowerCase() : null);

type ConfirmationCheck = 'OK' | 'UNCONFIRMED_REDEMPTION' | 'UNAUTHORIZED_CONFIRMER' | 'REPLAYED_CONFIRMATION';

function checkConfirmation(redemption: RedemptionRecord | undefined, ownership: OwnershipRecord): ConfirmationCheck {
  if (!redemption || redemption.confirmations.length === 0) return 'UNCONFIRMED_REDEMPTION';
  if (redemption.confirmations.length > 1) return 'REPLAYED_CONFIRMATION';
  const [confirmation] = redemption.confirmations;
  const actor = lower(confirmation.actorWallet);
  if (!actor) return 'UNCONFIRMED_REDEMPTION';
  if (confirmation.actorRole === 'OWNER') {
    return actor === lower(ownership.ownerAddress) ? 'OK' : 'UNAUTHORIZED_CONFIRMER';
  }
  if (confirmation.actorRole === 'OPERATOR') {
    const operator = ownership.operators.find((item) => item.id === confirmation.operatorId);
    return operator && lower(operator.walletAddress) === actor ? 'OK' : 'UNAUTHORIZED_CONFIRMER';
  }
  return 'UNCONFIRMED_REDEMPTION';
}

// ── Template ────────────────────────────────────────────────────────────────

export interface RecordMilestoneTemplate {
  kind: 'ifr-model-b-recordMilestone-proposal-template';
  unsigned: true;
  submitted: false;
  chainId: string;
  meta: {
    purpose: string;
    partnerId: string;
    milestoneId: string;
    unlockAmount: string;
    batchDigest: string;
    evidenceDigest: string;
    policyVersion: string;
    period: string;
    partnerVault: string;
    governance: string;
  };
  inner: { to: string; data: string };
  transactions: [{ to: string; value: '0'; data: string }];
}

export interface TemplateExpectation {
  chainId: number;
  governance: string;
  partnerVault: string;
  partnerId: string;
  milestoneId: string;
  unlockAmount: bigint;
  remainingAllocation: bigint;
}

/** Decodes the template bytes against the PartnerVault/Governance ABI and checks every bound value. */
export function validateRecordMilestoneTemplate(template: RecordMilestoneTemplate, expected: TemplateExpectation): void {
  if (template.unsigned !== true || template.submitted !== false) throw new Error('Template must be unsigned and unsubmitted');
  if (template.chainId !== String(expected.chainId)) throw new Error('Template chain mismatch');
  if (template.transactions.length !== 1) throw new Error('Template must contain exactly one transaction');
  const [tx] = template.transactions;
  if (tx.value !== '0') throw new Error('Template transaction must not carry value');
  if (lower(tx.to) !== lower(expected.governance)) throw new Error('Template must target Governance');
  const [target, innerData] = governanceInterface.decodeFunctionData('propose', tx.data);
  if (lower(target as string) !== lower(expected.partnerVault)) throw new Error('Proposal must target PartnerVault');
  if ((innerData as string).toLowerCase() !== template.inner.data.toLowerCase()) throw new Error('Inner calldata mismatch');
  const decoded = partnerVaultInterface.decodeFunctionData('recordMilestone', innerData as string);
  if ((decoded[0] as string).toLowerCase() !== expected.partnerId.toLowerCase()) throw new Error('partnerId mismatch');
  if ((decoded[1] as string).toLowerCase() !== expected.milestoneId.toLowerCase()) throw new Error('milestoneId mismatch');
  const amount = decoded[2] as bigint;
  if (amount !== expected.unlockAmount) throw new Error('unlockAmount mismatch');
  if (amount <= 0n) throw new Error('unlockAmount must be positive');
  if (amount > expected.remainingAllocation) throw new Error('unlockAmount exceeds the remaining allocation');
}

function buildTemplate(args: {
  chainId: number;
  governance: string;
  partnerVault: string;
  partnerId: string;
  milestoneId: string;
  unlockAmount: bigint;
  batchDigest: string;
  evidenceDigest: string;
  policyVersion: string;
  period: string;
}): RecordMilestoneTemplate {
  const partnerVault = ethers.getAddress(args.partnerVault);
  const governance = ethers.getAddress(args.governance);
  const inner = partnerVaultInterface.encodeFunctionData('recordMilestone', [args.partnerId, args.milestoneId, args.unlockAmount]);
  const outer = governanceInterface.encodeFunctionData('propose', [partnerVault, inner]);
  return {
    kind: 'ifr-model-b-recordMilestone-proposal-template',
    unsigned: true,
    submitted: false,
    chainId: String(args.chainId),
    meta: {
      purpose: 'Model B settlement proposal template for review by the Treasury Safe; not signed, not submitted, not a payment',
      partnerId: args.partnerId,
      milestoneId: args.milestoneId,
      unlockAmount: args.unlockAmount.toString(),
      batchDigest: args.batchDigest,
      evidenceDigest: args.evidenceDigest,
      policyVersion: args.policyVersion,
      period: args.period,
      partnerVault,
      governance,
    },
    inner: { to: partnerVault, data: inner },
    transactions: [{ to: governance, value: '0', data: outer }],
  };
}

// ── Export ──────────────────────────────────────────────────────────────────

export interface SettlementExport {
  kind: 'ifr-model-b-settlement-export';
  schemaVersion: 1;
  mode: 'proposal-template' | 'diagnostic';
  settlement: { status: 'NOT_SUBMITTED'; settled: false; paid: false; note: string };
  policyVersion: string;
  partnerId: string;
  period: { label: string; startUtc: string; endExclusiveUtc: string; boundary: 'half-open [start, end)' };
  milestoneId: string;
  reconciliation: {
    status: 'RECONCILED' | 'MISMATCH' | 'INCOMPLETE';
    sellerConfirmedRedemptions: number | null;
    backendRedemptions: number;
    rewardEventsInPeriod: number;
    redemptionsWithoutRewardEvent: number;
    redemptionsWithoutRewardEventReasons: { SELF_REDEMPTION: number; PRE_PILOT: number; MISSING_REWARD_EVENT: number };
    discrepancies: { code: string; count: number }[];
  };
  events: { eligible: string[]; excluded: { id: string; reason: ExclusionReason }[] };
  totals: {
    eligibleCount: number;
    settleableCount: number;
    eurMinorPerRedemption: string;
    eurMinorTotal: string;
    ifrBaseUnits: string | null;
  };
  priceEvidence: {
    status: 'MISSING' | 'INVALID' | 'VALID';
    reason: string | null;
    digest: string | null;
    windowSeconds: number | null;
    settlementBlock: { number: number; hash: string } | null;
    ethEur: { source: string; publishedAt: string; rate: string; decimals: number } | null;
    rounding: 'floor';
  };
  budgets: {
    status: 'NOT_EVALUATED' | 'WITHIN_BUDGET' | 'CAPPED' | 'EXHAUSTED';
    partnerRemainingBaseUnits: string | null;
    globalRemainingBaseUnits: string | null;
    annualEmissionCapApplies: false;
  };
  chain: { blockNumber: number; blockHash: string; governance: string } | null;
  blockers: string[];
  batchDigest: string;
  publicSummary: Record<string, string | number | null>;
  template: RecordMilestoneTemplate | null;
}

function minBigInt(...values: bigint[]): bigint {
  return values.reduce((low, value) => (value < low ? value : low));
}

export function buildSettlementExport(input: ExportInput): SettlementExport {
  const { policy, pilot, period, records } = input;
  const blockers: string[] = [];
  const partnerId = pilot.partnerId;
  const pilotStart = new Date(pilot.startsAt);
  const milestoneId = computeMilestoneId(input.expectedChainId, input.partnerVaultAddress, partnerId, period);

  // ── Seller registration and pilot binding (local state) ──
  const { ownership } = records;
  if (!ownership.businessActive) blockers.push('SELLER_INACTIVE');
  if (ownership.link?.status !== 'VERIFIED' || lower(ownership.link.partnerId) !== partnerId) {
    blockers.push('SELLER_LINK_NOT_VERIFIED');
  }
  // Owner decision B (T-231b): without stored customer identity the "one reward per wallet and
  // partner" rule cannot be enforced, and no replacement policy is accepted. The export therefore
  // stays diagnostic and never yields a template (policy gap, see T-231b report).
  blockers.push(CUSTOMER_DEDUP_POLICY_GAP);
  if (period.end.getTime() > input.now.getTime()) blockers.push('PERIOD_NOT_CLOSED');
  if (period.end.getTime() <= pilotStart.getTime()) blockers.push('PERIOD_BEFORE_PILOT');

  // ── Reconciliation against seller-confirmed redemptions ──
  const redemptionsBySession = new Map(records.redemptions.map((item) => [item.sessionId, item]));
  const discrepancyCounts = new Map<string, number>();
  const addDiscrepancy = (code: string, count = 1) => discrepancyCounts.set(code, (discrepancyCounts.get(code) ?? 0) + count);

  for (const redemption of records.redemptions) {
    const check = checkConfirmation(redemption, ownership);
    if (check !== 'OK') addDiscrepancy(`REDEMPTION_${check}`);
  }
  if (records.orphanEventIds.length > 0) addDiscrepancy('EVENT_WITHOUT_REDEMPTION', records.orphanEventIds.length);

  const eligible: RewardEventRecord[] = [];
  const excluded: { id: string; reason: ExclusionReason }[] = [];
  const seenSessions = new Set<string>();
  const eventsInPeriod = [...new Map(records.events.map((event) => [event.id, event])).values()];

  for (const event of eventsInPeriod) {
    const exclude = (reason: ExclusionReason) => {
      excluded.push({ id: event.id, reason });
      if (DISCREPANCY_REASONS.has(reason)) addDiscrepancy(`EVENT_${reason}`);
    };
    const redeemedAt = event.session.redeemedAt;
    if (
      lower(event.partnerId) !== partnerId ||
      event.businessId !== pilot.businessId ||
      event.session.businessId !== event.businessId
    ) { exclude('BUSINESS_MISMATCH'); continue; }
    if (event.session.status !== 'REDEEMED' || !redeemedAt || !isInPeriod(redeemedAt, period)) {
      exclude('SESSION_NOT_REDEEMED'); continue;
    }
    if (seenSessions.has(event.session.id)) { exclude('REPLAYED_CONFIRMATION'); continue; }
    seenSessions.add(event.session.id);
    // Old lock-path events and redemptions before pilot activation are never reclassified.
    if (redeemedAt.getTime() < pilotStart.getTime()) { exclude('PRE_PILOT'); continue; }
    const confirmation = checkConfirmation(redemptionsBySession.get(event.session.id), ownership);
    if (confirmation !== 'OK') { exclude(confirmation); continue; }
    // NULL (no proof-v2 outcome) is treated as self-redemption: fail closed.
    if (event.session.selfRedemption !== false) { exclude('SELF_REDEMPTION'); continue; }
    if (event.status === 'CONFIRMED') { exclude('LOCK_REWARD_ALREADY_RECORDED'); continue; }
    if (UNRECONCILED_STATUSES.has(event.status)) { exclude('NOT_RECONCILED'); continue; }
    if (event.status !== MODEL_B_SETTLEMENT_PENDING) { exclude('STATUS_INELIGIBLE'); continue; }
    eligible.push(event);
  }
  eligible.sort((a, b) =>
    (a.session.redeemedAt as Date).getTime() - (b.session.redeemedAt as Date).getTime() || a.id.localeCompare(b.id));

  const backendRedemptions = records.redemptions.length;
  const redemptionsWithEvent = records.redemptions.filter((item) => seenSessions.has(item.sessionId)).length;
  // F1 (T-275 review): a seller-confirmed redemption without a reward event is expected only for a
  // self-redemption (skipped by policy at redeem time) or before pilot start. Anything else (e.g. a
  // repeat customer dropped by the one-per-wallet outbox constraint, gap G1) would be under-settled
  // irreversibly once the month's milestoneId is consumed, so it blocks the template until the G1
  // policy decision.
  const withoutEventReasons = { SELF_REDEMPTION: 0, PRE_PILOT: 0, MISSING_REWARD_EVENT: 0 };
  for (const redemption of records.redemptions) {
    if (seenSessions.has(redemption.sessionId)) continue;
    if (redemption.selfRedemption !== false) {
      withoutEventReasons.SELF_REDEMPTION += 1;
    } else if (redemption.redeemedAt.getTime() < pilotStart.getTime()) {
      withoutEventReasons.PRE_PILOT += 1;
    } else {
      withoutEventReasons.MISSING_REWARD_EVENT += 1;
    }
  }
  if (withoutEventReasons.MISSING_REWARD_EVENT > 0) {
    addDiscrepancy('REDEMPTION_WITHOUT_REWARD_EVENT', withoutEventReasons.MISSING_REWARD_EVENT);
  }
  let reconciliationStatus: 'RECONCILED' | 'MISMATCH' | 'INCOMPLETE' = 'RECONCILED';
  if (input.sellerConfirmedRedemptions === undefined) {
    reconciliationStatus = 'INCOMPLETE';
    blockers.push('RECONCILIATION_INCOMPLETE');
  } else if (input.sellerConfirmedRedemptions !== backendRedemptions) {
    addDiscrepancy('SELLER_TOTAL_MISMATCH');
  }
  if (discrepancyCounts.size > 0) {
    reconciliationStatus = 'MISMATCH';
    blockers.push('RECONCILIATION_DISCREPANCY');
  }

  // ── Price evidence ──
  const price = validatePriceEvidence(input.priceEvidence, { policy, ifrTokenAddress: input.ifrTokenAddress, period });
  if (price.status === 'MISSING') blockers.push('PRICE_EVIDENCE_MISSING');
  if (price.status === 'INVALID') blockers.push('PRICE_EVIDENCE_INVALID');

  // ── Chain state ──
  const chain = input.chain;
  if (!chain) {
    blockers.push('CHAIN_STATE_UNAVAILABLE');
  } else {
    if (chain.chainId !== input.expectedChainId) blockers.push('CHAIN_MISMATCH');
    if (lower(chain.partnerVault) !== lower(input.partnerVaultAddress)) blockers.push('PARTNER_VAULT_MISMATCH');
    if (!chain.sellerVerified) blockers.push('SELLER_NOT_GOVERNANCE_VERIFIED');
    if (chain.paused) blockers.push('PARTNER_VAULT_PAUSED');
    if (!chain.partner.active) blockers.push('PARTNER_INACTIVE');
    if (chain.partner.milestonesFinal) blockers.push('PARTNER_MILESTONES_FINAL');
    if (chain.partner.rewardAccrued > 0n) blockers.push('LOCK_REWARD_PATH_USED');
    if (chain.milestoneDone) blockers.push('MILESTONE_ALREADY_RECORDED');
  }

  // ── Amount and budgets (recordMilestone is not bounded by annualEmissionCap) ──
  const eurPerRedemption = BigInt(pilot.eurMinorPerRedemption);
  let settleableCount = eligible.length;
  let ifrBaseUnits: bigint | null = null;
  let budgetStatus: SettlementExport['budgets']['status'] = 'NOT_EVALUATED';
  let partnerRemaining: bigint | null = null;
  let globalRemaining: bigint | null = null;
  if (chain) {
    const partnerUsed = chain.partner.unlockedTotal + chain.partner.rewardAccrued;
    const onChainRemaining = chain.partner.maxAllocation > partnerUsed ? chain.partner.maxAllocation - partnerUsed : 0n;
    const policyBudget = BigInt(pilot.partnerBudgetBaseUnits);
    const policyRemaining = policyBudget > partnerUsed ? policyBudget - partnerUsed : 0n;
    partnerRemaining = minBigInt(onChainRemaining, policyRemaining);
    const usage = policy.pilots.map((item) => chain.pilotUsage[item.partnerId]);
    if (usage.some((value) => value === undefined)) {
      blockers.push('GLOBAL_BUDGET_UNVERIFIED');
    } else {
      const globalUsed = (usage as bigint[]).reduce((sum, value) => sum + value, 0n);
      const globalBudget = BigInt(policy.globalPilotBudgetBaseUnits);
      globalRemaining = globalBudget > globalUsed ? globalBudget - globalUsed : 0n;
    }
  }
  if (price.status === 'VALID' && partnerRemaining !== null && globalRemaining !== null) {
    const priceInputs = {
      windowSeconds: price.windowSeconds,
      cumulativeDelta: price.cumulativeDelta,
      rate: BigInt(price.evidence.ethEur.rate),
      decimals: price.evidence.ethEur.decimals,
    };
    const cap = minBigInt(partnerRemaining, globalRemaining);
    const amountFor = (count: number) => convertEurMinorToIfrBase(eurPerRedemption * BigInt(count), priceInputs);
    // Largest count whose converted amount fits both budgets (conversion is monotonic).
    let low = 0;
    let high = eligible.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (amountFor(mid) <= cap) low = mid; else high = mid - 1;
    }
    settleableCount = low;
    ifrBaseUnits = amountFor(settleableCount);
    budgetStatus = settleableCount === eligible.length ? 'WITHIN_BUDGET' : settleableCount === 0 ? 'EXHAUSTED' : 'CAPPED';
    for (const event of eligible.slice(settleableCount)) excluded.push({ id: event.id, reason: 'BUDGET_EXHAUSTED' });
    if (eligible.length > 0 && settleableCount === 0) blockers.push('BUDGET_EXHAUSTED');
    // F2 (T-275 review): a partially covered month would consume its milestoneId and strand the
    // BUDGET_EXHAUSTED events forever; until a final-capped-period policy is approved it stays diagnostic.
    else if (budgetStatus === 'CAPPED') blockers.push('BUDGET_CAPPED');
    else if (settleableCount > 0 && ifrBaseUnits === 0n) blockers.push('AMOUNT_ZERO');
  }
  if (eligible.length === 0) blockers.push('NO_ELIGIBLE_EVENTS');

  const settledEvents = eligible.slice(0, settleableCount);
  const eligibleIds = settledEvents.map((event) => event.id).sort();
  excluded.sort((a, b) => a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason));
  const eurMinorTotal = eurPerRedemption * BigInt(settledEvents.length);
  const discrepancies = [...discrepancyCounts.entries()].map(([code, count]) => ({ code, count }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const evidenceDigest = price.status === 'VALID' ? price.digest : null;
  // The digest covers content only (no wall clock or allocation-read block), so repeated exports
  // over unchanged inputs are byte-identical.
  const batchDigest = canonicalDigest({
    domain: SETTLEMENT_DOMAIN,
    chainId: input.expectedChainId,
    partnerVault: lower(input.partnerVaultAddress),
    partnerId,
    milestoneId,
    policyVersion: policy.policyVersion,
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    eligible: eligibleIds,
    excluded,
    reconciliation: {
      sellerConfirmedRedemptions: input.sellerConfirmedRedemptions ?? null,
      backendRedemptions,
      discrepancies,
    },
    eurMinorPerRedemption: eurPerRedemption.toString(),
    eurMinorTotal: eurMinorTotal.toString(),
    ifrBaseUnits: ifrBaseUnits?.toString() ?? null,
    evidenceDigest,
  });

  const uniqueBlockers = [...new Set(blockers)];
  let template: RecordMilestoneTemplate | null = null;
  if (uniqueBlockers.length === 0 && chain && price.status === 'VALID' && ifrBaseUnits !== null && partnerRemaining !== null && globalRemaining !== null) {
    template = buildTemplate({
      chainId: input.expectedChainId,
      governance: chain.governance,
      partnerVault: input.partnerVaultAddress,
      partnerId,
      milestoneId,
      unlockAmount: ifrBaseUnits,
      batchDigest,
      evidenceDigest: price.digest,
      policyVersion: policy.policyVersion,
      period: period.label,
    });
    validateRecordMilestoneTemplate(template, {
      chainId: input.expectedChainId,
      governance: chain.governance,
      partnerVault: input.partnerVaultAddress,
      partnerId,
      milestoneId,
      unlockAmount: ifrBaseUnits,
      remainingAllocation: minBigInt(partnerRemaining, globalRemaining),
    });
  }

  const reconciliation = {
    status: reconciliationStatus,
    sellerConfirmedRedemptions: input.sellerConfirmedRedemptions ?? null,
    backendRedemptions,
    rewardEventsInPeriod: eventsInPeriod.length,
    redemptionsWithoutRewardEvent: backendRedemptions - redemptionsWithEvent,
    redemptionsWithoutRewardEventReasons: withoutEventReasons,
    discrepancies,
  };

  return {
    kind: 'ifr-model-b-settlement-export',
    schemaVersion: 1,
    mode: template ? 'proposal-template' : 'diagnostic',
    settlement: {
      status: 'NOT_SUBMITTED',
      settled: false,
      paid: false,
      note: 'An export or template is neither a settlement nor a payment. Settled status requires verified matching on-chain execution evidence.',
    },
    policyVersion: policy.policyVersion,
    partnerId,
    period: {
      label: period.label,
      startUtc: period.start.toISOString(),
      endExclusiveUtc: period.end.toISOString(),
      boundary: 'half-open [start, end)',
    },
    milestoneId,
    reconciliation,
    events: { eligible: eligibleIds, excluded },
    totals: {
      eligibleCount: eligible.length,
      settleableCount: settledEvents.length,
      eurMinorPerRedemption: eurPerRedemption.toString(),
      eurMinorTotal: eurMinorTotal.toString(),
      ifrBaseUnits: ifrBaseUnits?.toString() ?? null,
    },
    priceEvidence: price.status === 'VALID'
      ? {
        status: 'VALID',
        reason: null,
        digest: price.digest,
        windowSeconds: price.windowSeconds,
        settlementBlock: { number: price.settlementBlock.number, hash: price.settlementBlock.hash },
        ethEur: price.evidence.ethEur,
        rounding: 'floor',
      }
      : { status: price.status, reason: price.reason, digest: null, windowSeconds: null, settlementBlock: null, ethEur: null, rounding: 'floor' },
    budgets: {
      status: budgetStatus,
      partnerRemainingBaseUnits: partnerRemaining?.toString() ?? null,
      globalRemainingBaseUnits: globalRemaining?.toString() ?? null,
      annualEmissionCapApplies: false,
    },
    chain: chain ? { blockNumber: chain.blockNumber, blockHash: chain.blockHash, governance: chain.governance } : null,
    blockers: uniqueBlockers,
    batchDigest,
    // Safe to publish: aggregate counts and digests only, no event IDs or wallets.
    publicSummary: {
      policyVersion: policy.policyVersion,
      partnerId,
      period: period.label,
      milestoneId,
      backendRedemptions,
      settleableCount: settledEvents.length,
      excludedCount: excluded.length,
      eurMinorTotal: eurMinorTotal.toString(),
      ifrBaseUnits: ifrBaseUnits?.toString() ?? null,
      batchDigest,
      evidenceDigest,
    },
    template,
  };
}
