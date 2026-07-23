import type { LockSource, VerifiedLockSource } from '@/lib/api';

export const lockSources: LockSource[] = ['ifrlock', 'commitment_time_only', 'either'];
const MAX_COMMITMENT_TRANCHES = 50;

type CommitmentTranche = {
  amount: bigint;
  cType: number;
  unlocked: boolean;
};

export function isLockSource(value: unknown): value is LockSource {
  return typeof value === 'string' && lockSources.includes(value as LockSource);
}

export function normalizeLockSource(value: unknown): LockSource {
  return isLockSource(value) ? value : 'ifrlock';
}

export function lockSourceLabel(value: unknown): string {
  const source = normalizeLockSource(value);
  if (source === 'ifrlock') return 'IFRLock access lock';
  if (source === 'commitment_time_only') return 'CommitmentVault TIME_ONLY lock';
  return 'IFRLock or TIME_ONLY commitment';
}

export function verifiedLockSourceLabel(source: VerifiedLockSource | null): string {
  return source ? lockSourceLabel(source) : 'Not verified yet';
}

export function lockSourceRequirement(value: unknown): string {
  const source = normalizeLockSource(value);
  if (source === 'ifrlock') return 'in IFRLock';
  if (source === 'commitment_time_only') return 'in active TIME_ONLY commitments';
  return 'in IFRLock or active TIME_ONLY commitments';
}

export function sumPreviewTimeOnlyTranches(value: unknown): bigint | null {
  if (!Array.isArray(value) || value.length > MAX_COMMITMENT_TRANCHES) return null;
  let total = BigInt(0);
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const tranche = raw as Partial<CommitmentTranche>;
    if (
      typeof tranche.amount !== 'bigint' ||
      tranche.amount < BigInt(0) ||
      typeof tranche.cType !== 'number' ||
      !Number.isInteger(tranche.cType) ||
      tranche.cType < 0 ||
      tranche.cType > 3 ||
      typeof tranche.unlocked !== 'boolean'
    ) return null;
    if (!tranche.unlocked && tranche.cType === 0 && tranche.amount > BigInt(0)) {
      total += tranche.amount;
    }
  }
  return total;
}
