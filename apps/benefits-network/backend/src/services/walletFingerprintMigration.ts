import type { PrismaClient } from '@prisma/client';
import {
  CUSTOMER_WALLET_HMAC_KEY_MIN_LENGTH,
  computeWalletFingerprint,
  isRawWalletAddress,
} from './walletFingerprint';

/**
 * T-231a data migration: replaces every stored raw customer wallet address with its keyed
 * fingerprint and removes customer wallets from session audit payloads. Schema is unchanged
 * (the Prisma fields are @map-ped onto the existing columns), so this is a pure data migration.
 *
 * - Refuses without CUSTOMER_WALLET_HMAC_KEY (the same key the service uses).
 * - Idempotent: only values matching ^0x[0-9a-fA-F]{40}$ are rewritten.
 * - One transaction; any failure leaves the database untouched.
 * - Output contains counts only, never addresses or fingerprints.
 * - One-way: rollback is the pre-migration backup (see the T-231a runbook section).
 */

export const WALLET_MIGRATION_CONFIRMATION = 'HASH_CUSTOMER_WALLETS';
const RAW_PREFIX = '0x';

export type WalletMigrationCounts = {
  sessions: number;
  customerPasses: number;
  customerPassChallenges: number;
  customerHistoryChallenges: number;
  customerHistoryAccess: number;
  rewardEvents: number;
  auditLogPayloads: number;
};

export type WalletMigrationResult = {
  mode: 'report' | 'apply';
  rawRows: WalletMigrationCounts;
  rewardEventConflicts: number;
  remainingRawRows?: WalletMigrationCounts;
};

export function requireMigrationKey(key: string | undefined): string {
  if (!key || key.length < CUSTOMER_WALLET_HMAC_KEY_MIN_LENGTH) {
    throw new Error(
      `CUSTOMER_WALLET_HMAC_KEY (at least ${CUSTOMER_WALLET_HMAC_KEY_MIN_LENGTH} characters) is required; refusing to run`
    );
  }
  return key;
}

type Db = Pick<PrismaClient,
  'session' | 'customerPass' | 'customerPassChallenge' | 'customerHistoryChallenge' |
  'customerHistoryAccess' | 'rewardEvent' | 'auditLog'>;

function auditPayloadHasCustomerWallet(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      Object.prototype.hasOwnProperty.call(parsed, 'wallet'));
  } catch {
    return false;
  }
}

async function loadRawRows(db: Db) {
  const raw = { startsWith: RAW_PREFIX };
  const [sessions, passes, passChallenges, historyChallenges, historyAccess, rewardEvents, auditLogs] = await Promise.all([
    db.session.findMany({ where: { customerFingerprint: raw }, select: { id: true, customerFingerprint: true } }),
    db.customerPass.findMany({ where: { walletFingerprint: raw }, select: { id: true, walletFingerprint: true } }),
    db.customerPassChallenge.findMany({ where: { walletFingerprint: raw }, select: { nonce: true, walletFingerprint: true } }),
    db.customerHistoryChallenge.findMany({ where: { walletFingerprint: raw }, select: { nonce: true, walletFingerprint: true } }),
    db.customerHistoryAccess.findMany({ where: { walletFingerprint: raw }, select: { tokenHash: true, walletFingerprint: true } }),
    db.rewardEvent.findMany({ select: { id: true, partnerId: true, customerFingerprint: true } }),
    db.auditLog.findMany({ where: { payload: { contains: '"wallet"' } }, select: { id: true, payload: true } }),
  ]);
  const rawOnly = <T>(rows: T[], value: (row: T) => string | null) =>
    rows.filter((row) => isRawWalletAddress(value(row)));
  return {
    sessions: rawOnly(sessions, (row) => row.customerFingerprint),
    passes: rawOnly(passes, (row) => row.walletFingerprint),
    passChallenges: rawOnly(passChallenges, (row) => row.walletFingerprint),
    historyChallenges: rawOnly(historyChallenges, (row) => row.walletFingerprint),
    historyAccess: rawOnly(historyAccess, (row) => row.walletFingerprint),
    allRewardEvents: rewardEvents,
    rewardEvents: rawOnly(rewardEvents, (row) => row.customerFingerprint),
    auditLogs: auditLogs.filter((row) => auditPayloadHasCustomerWallet(row.payload)),
  };
}

function counts(rows: Awaited<ReturnType<typeof loadRawRows>>): WalletMigrationCounts {
  return {
    sessions: rows.sessions.length,
    customerPasses: rows.passes.length,
    customerPassChallenges: rows.passChallenges.length,
    customerHistoryChallenges: rows.historyChallenges.length,
    customerHistoryAccess: rows.historyAccess.length,
    rewardEvents: rows.rewardEvents.length,
    auditLogPayloads: rows.auditLogs.length,
  };
}

/** Number of reward events that would collide on (fingerprint, partnerId) after hashing. */
function rewardEventConflicts(key: string, rows: Awaited<ReturnType<typeof loadRawRows>>): number {
  const seen = new Set<string>();
  let conflicts = 0;
  for (const event of rows.allRewardEvents) {
    const fingerprint = isRawWalletAddress(event.customerFingerprint)
      ? computeWalletFingerprint(key, event.customerFingerprint)
      : event.customerFingerprint;
    const identity = `${fingerprint}|${event.partnerId.toLowerCase()}`;
    if (seen.has(identity)) conflicts += 1;
    seen.add(identity);
  }
  return conflicts;
}

function scrubAuditPayload(payload: string): string {
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  delete parsed.wallet;
  return JSON.stringify(parsed);
}

export async function migrateCustomerWallets(
  db: PrismaClient,
  input: { key: string | undefined; mode: 'report' | 'apply'; confirmation?: string }
): Promise<WalletMigrationResult> {
  const key = requireMigrationKey(input.key);
  if (input.mode === 'apply' && input.confirmation !== WALLET_MIGRATION_CONFIRMATION) {
    throw new Error(`Wallet migration apply requires --confirm=${WALLET_MIGRATION_CONFIRMATION}`);
  }

  const before = await loadRawRows(db);
  const conflicts = rewardEventConflicts(key, before);
  const result: WalletMigrationResult = {
    mode: input.mode,
    rawRows: counts(before),
    rewardEventConflicts: conflicts,
  };
  if (input.mode === 'report') return result;
  if (conflicts > 0) {
    throw new Error(
      `Refusing: ${conflicts} reward event(s) would collide on (fingerprint, partner); resolve them manually first`
    );
  }

  const fp = (address: string | null) => computeWalletFingerprint(key, address as string);
  await db.$transaction(async (tx) => {
    const rows = await loadRawRows(tx);
    for (const row of rows.sessions) {
      await tx.session.update({ where: { id: row.id }, data: { customerFingerprint: fp(row.customerFingerprint) } });
    }
    for (const row of rows.passes) {
      await tx.customerPass.update({ where: { id: row.id }, data: { walletFingerprint: fp(row.walletFingerprint) } });
    }
    for (const row of rows.passChallenges) {
      await tx.customerPassChallenge.update({
        where: { nonce: row.nonce },
        data: { walletFingerprint: fp(row.walletFingerprint) },
      });
    }
    for (const row of rows.historyChallenges) {
      await tx.customerHistoryChallenge.update({
        where: { nonce: row.nonce },
        data: { walletFingerprint: fp(row.walletFingerprint) },
      });
    }
    for (const row of rows.historyAccess) {
      await tx.customerHistoryAccess.update({
        where: { tokenHash: row.tokenHash },
        data: { walletFingerprint: fp(row.walletFingerprint) },
      });
    }
    for (const row of rows.rewardEvents) {
      await tx.rewardEvent.update({ where: { id: row.id }, data: { customerFingerprint: fp(row.customerFingerprint) } });
    }
    for (const row of rows.auditLogs) {
      await tx.auditLog.update({ where: { id: row.id }, data: { payload: scrubAuditPayload(row.payload) } });
    }
  });

  result.remainingRawRows = counts(await loadRawRows(db));
  return result;
}
