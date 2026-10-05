import { z } from 'zod';
import { config } from '../config';

/**
 * Lane 4 Model B pilot policy (docs/PARTNER_REWARDS_MODEL_B.md).
 *
 * Default-off: the policy is only active when MODEL_B_SETTLEMENT_ENABLED is exactly "true" and
 * MODEL_B_PILOT_POLICY_JSON parses into a valid policy. Any missing or invalid input disables the
 * Model B path entirely (no eligible reward), it never falls back to the lock-reward path.
 */

// Canonical IFR/WETH Uniswap V2 pair named in the Model B policy (Ethereum Mainnet).
export const MAINNET_IFR_WETH_PAIR = '0xbe495e9c0d8cc2dcf95570cf95b63c4844df31a0';
// PartnerVault.PARTNER_POOL (40M IFR, 9 decimals); no budget may exceed it.
export const PARTNER_POOL_BASE_UNITS = 40_000_000n * 10n ** 9n;

const UINT_PATTERN = /^(0|[1-9][0-9]{0,77})$/;
const uintString = z.string().regex(UINT_PATTERN, 'must be a non-negative integer string');
// Guard the BigInt conversion: zod still runs refinements after a failed regex check.
const positiveUintString = uintString.refine((value) => UINT_PATTERN.test(value) && BigInt(value) > 0n, 'must be positive');
const bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase());
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => value.toLowerCase());
const utcInstant = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/, 'must be an ISO-8601 UTC instant')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid instant');

const pilotSchema = z.object({
  partnerId: bytes32,
  businessId: z.string().min(1).max(64),
  eurMinorPerRedemption: positiveUintString,
  partnerBudgetBaseUnits: positiveUintString,
  startsAt: utcInstant,
  governanceReference: z.string().min(1).max(200),
}).strict();

const policySchema = z.object({
  policyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  globalPilotBudgetBaseUnits: positiveUintString,
  twapPair: address,
  reviewedPriceSourceIds: z.array(z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/)).max(20).default([]),
  pilots: z.array(pilotSchema).min(1).max(20),
}).strict().superRefine((policy, context) => {
  // Runs even when field checks failed; bail out before any BigInt conversion of invalid values.
  if (!UINT_PATTERN.test(String(policy.globalPilotBudgetBaseUnits)) ||
    !Array.isArray(policy.pilots) ||
    policy.pilots.some((pilot) => !UINT_PATTERN.test(String(pilot?.partnerBudgetBaseUnits)))) return;
  const global = BigInt(policy.globalPilotBudgetBaseUnits);
  if (global > PARTNER_POOL_BASE_UNITS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'global pilot budget exceeds the PartnerVault pool' });
  }
  const partnerIds = new Set<string>();
  const businessIds = new Set<string>();
  for (const pilot of policy.pilots) {
    if (partnerIds.has(pilot.partnerId) || businessIds.has(pilot.businessId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'pilot partnerId and businessId must be unique' });
    }
    partnerIds.add(pilot.partnerId);
    businessIds.add(pilot.businessId);
    if (BigInt(pilot.partnerBudgetBaseUnits) > global) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'partner budget exceeds the global pilot budget' });
    }
  }
});

export type ModelBPolicy = z.infer<typeof policySchema>;
export type ModelBPilot = ModelBPolicy['pilots'][number];

export type ModelBPolicyState =
  | { enabled: false; reason: string }
  | { enabled: true; policy: ModelBPolicy };

interface ModelBEnv {
  MODEL_B_SETTLEMENT_ENABLED?: string;
  MODEL_B_PILOT_POLICY_JSON?: string;
  REWARD_CALLER_ADDRESS?: string;
  CHAIN_ID: number;
}

export function parseModelBPolicy(env: ModelBEnv): ModelBPolicyState {
  if (env.MODEL_B_SETTLEMENT_ENABLED !== 'true') {
    return { enabled: false, reason: 'Model B settlement is disabled' };
  }
  if (env.REWARD_CALLER_ADDRESS) {
    // Model B never configures an authorized lock-reward caller; both paths together are a policy conflict.
    return { enabled: false, reason: 'Model B forbids a configured lock-reward caller' };
  }
  if (!env.MODEL_B_PILOT_POLICY_JSON) {
    return { enabled: false, reason: 'Model B pilot policy is missing' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(env.MODEL_B_PILOT_POLICY_JSON);
  } catch {
    return { enabled: false, reason: 'Model B pilot policy is not valid JSON' };
  }
  const parsed = policySchema.safeParse(raw);
  if (!parsed.success) {
    return { enabled: false, reason: 'Model B pilot policy is invalid' };
  }
  if (env.CHAIN_ID === 1 && parsed.data.twapPair !== MAINNET_IFR_WETH_PAIR) {
    return { enabled: false, reason: 'Model B pilot policy names a non-canonical TWAP pair' };
  }
  return { enabled: true, policy: parsed.data };
}

export function getModelBPolicy(): ModelBPolicyState {
  return parseModelBPolicy(config);
}

export function findPilot(policy: ModelBPolicy, businessId: string, partnerId: string | null | undefined) {
  if (!partnerId) return null;
  const normalized = partnerId.toLowerCase();
  return policy.pilots.find((pilot) => pilot.businessId === businessId && pilot.partnerId === normalized) ?? null;
}
