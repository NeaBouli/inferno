export const LOCK_SOURCES = ['ifrlock', 'commitment_time_only', 'either'] as const;

export type LockSource = (typeof LOCK_SOURCES)[number];
export type VerifiedLockSource = Exclude<LockSource, 'either'>;

export function isLockSource(value: unknown): value is LockSource {
  return typeof value === 'string' && LOCK_SOURCES.includes(value as LockSource);
}

export function snapshotLockSource(
  snapshotVersion: number | null | undefined,
  value: unknown
): LockSource {
  if ((snapshotVersion ?? 0) < 5) return 'ifrlock';
  if (!isLockSource(value)) throw new Error('Invalid snapshotted lock source');
  return value;
}
