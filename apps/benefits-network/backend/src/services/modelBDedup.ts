import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { config } from '../config';
import { findPilot, getModelBPolicy } from './modelBPolicy';
import { MODEL_B_SETTLEMENT_PENDING } from './modelBSettlement';

export const MODEL_B_DUPLICATE = 'SKIPPED_DUPLICATE';
export const REWARD_BLOCKED_POLICY = 'BLOCKED_POLICY';
export const REWARD_BLOCKED_POLICY_REASON =
  'Customer-privacy policy gap: per-customer reward dedup is not available without customer data (T-231b); not payable';
export const MODEL_B_DEDUP_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;

/** No cross-partner/month wallet identifier: both the HMAC key and its rotation tag are scoped. */
export function modelBDedupKey(secret: string, chainId: number, vault: string, partnerId: string, period: string, wallet: string): string {
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error('Invalid Model B dedup configuration');
  const scope = JSON.stringify(['ifr-model-b-ext10-v1', chainId, vault.toLowerCase(), partnerId.toLowerCase(), period]);
  const scopedKey = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(scope).digest();
  const tag = crypto.createHmac('sha256', scopedKey).update('key-rotation-check').digest().subarray(0, 16).toString('base64url');
  const digest = crypto.createHmac('sha256', scopedKey).update(wallet.toLowerCase()).digest('base64url');
  return `${tag}.${digest}`;
}

/** Called only after exact-offer proof and seller authorization, inside the redemption write lock. */
export async function modelBRewardDecision(
  tx: Prisma.TransactionClient,
  input: { businessId: string; partnerId: string; wallet: string; now: Date; proofVersion: number | null; snapshotVersion: number | null }
): Promise<{ status: string; reason: string; rewardPeriod?: string; rewardDedupKey?: string }> {
  input = { ...input, partnerId: input.partnerId.toLowerCase() };
  const blocked = (reason = REWARD_BLOCKED_POLICY_REASON) => ({ status: REWARD_BLOCKED_POLICY, reason });
  const state = getModelBPolicy();
  const pilot = state.enabled ? findPilot(state.policy, input.businessId, input.partnerId) : null;
  if (!pilot) return blocked();
  if (input.now < new Date(pilot.startsAt)) return blocked('Not a verified post-activation Model B pilot redemption');
  if (!state.enabled || state.policy.pilots.length !== 1 || pilot.eurMinorPerRedemption !== '50') {
    return blocked('Owner policy requires one pilot and EUR 0.50 per eligible redemption');
  }
  if (input.proofVersion !== 2 || input.snapshotVersion !== 5) return blocked('Exact-offer checkout proof is missing');
  if (!config.PARTNER_VAULT_ADDRESS || !config.MODEL_B_DEDUP_SECRET || !/^[a-fA-F0-9]{64}$/.test(config.MODEL_B_DEDUP_SECRET)) {
    return blocked('Model B period dedup is not configured; not payable');
  }
  const rewardPeriod = input.now.toISOString().slice(0, 7);
  const rewardDedupKey = modelBDedupKey(config.MODEL_B_DEDUP_SECRET, config.CHAIN_ID,
    config.PARTNER_VAULT_ADDRESS, input.partnerId, rewardPeriod, input.wallet);
  const previous = await tx.rewardEvent.findFirst({
    where: { partnerId: input.partnerId, rewardPeriod, rewardDedupKey: { not: null } },
    select: { rewardDedupKey: true },
  });
  if (previous?.rewardDedupKey?.split('.')[0] !== undefined &&
      previous.rewardDedupKey.split('.')[0] !== rewardDedupKey.split('.')[0]) {
    return blocked('Model B dedup key changed within the period; not payable');
  }
  const duplicate = await tx.rewardEvent.findFirst({ where: { partnerId: input.partnerId, rewardPeriod, rewardDedupKey }, select: { id: true } });
  if (duplicate) return { status: MODEL_B_DUPLICATE, reason: 'Wallet already has a reward-eligible redemption for this partner and period', rewardPeriod };
  return { status: MODEL_B_SETTLEMENT_PENDING, reason: 'Verified Model B redemption awaiting period settlement; not settled or paid', rewardPeriod, rewardDedupKey };
}
