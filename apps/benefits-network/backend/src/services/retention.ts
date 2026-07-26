import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export const RETENTION_POLICY = 'phase-one-expired-auth-artifacts';
export const RETENTION_APPLY_CONFIRMATION = 'PRUNE_EXPIRED_BENEFITS_DATA';
export const DEFAULT_RETENTION_BATCH_LIMIT = 1000;
export const MAX_RETENTION_BATCH_LIMIT = 10_000;

type RetentionEligibleCounts = {
  adminAuditLogs: number;
  customerPassChallenges: number;
  sellerAuthorizationChallenges: number;
  customerHistoryChallenges: number;
  customerHistoryAccess: number;
  orphanCustomerPasses: number;
};

type RetentionProtectedCounts = {
  sessions: number;
  auditLogs: number;
  rewardEvents: number;
  linkedCustomerPasses: number;
};

export type RetentionReport = {
  policy: typeof RETENTION_POLICY;
  cutoff: string;
  generatedAt: string;
  batchLimit: number;
  eligible: RetentionEligibleCounts;
  protected: RetentionProtectedCounts;
};

function validateInputs(cutoff: Date, now: Date, batchLimit: number) {
  if (
    Number.isNaN(cutoff.getTime()) ||
    Number.isNaN(now.getTime()) ||
    cutoff >= now
  ) {
    throw new Error('Retention cutoff must be a valid date before the report time');
  }
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > MAX_RETENTION_BATCH_LIMIT) {
    throw new Error(`Retention batch limit must be between 1 and ${MAX_RETENTION_BATCH_LIMIT}`);
  }
}

function customerPassWhere(cutoff: Date): Prisma.CustomerPassWhereInput {
  return {
    expiresAt: { lt: cutoff },
    status: { in: ['OPEN', 'CANCELLED', 'EXPIRED'] },
    session: { is: null },
  };
}

export async function getRetentionReport(
  db: PrismaClient,
  cutoff: Date,
  now = new Date(),
  batchLimit = DEFAULT_RETENTION_BATCH_LIMIT,
): Promise<RetentionReport> {
  validateInputs(cutoff, now, batchLimit);
  const [
    adminAuditLogs,
    customerPassChallenges,
    sellerAuthorizationChallenges,
    customerHistoryChallenges,
    customerHistoryAccess,
    orphanCustomerPasses,
    sessions,
    auditLogs,
    rewardEvents,
    linkedCustomerPasses,
  ] = await Promise.all([
    db.adminAuditLog.count({ where: { createdAt: { lt: cutoff } } }),
    db.customerPassChallenge.count({ where: { expiresAt: { lt: cutoff } } }),
    db.sellerAuthorizationChallenge.count({ where: { expiresAt: { lt: cutoff } } }),
    db.customerHistoryChallenge.count({ where: { expiresAt: { lt: cutoff } } }),
    db.customerHistoryAccess.count({ where: { expiresAt: { lt: cutoff } } }),
    db.customerPass.count({ where: customerPassWhere(cutoff) }),
    db.session.count(),
    db.auditLog.count(),
    db.rewardEvent.count(),
    db.customerPass.count({ where: { session: { isNot: null } } }),
  ]);

  return {
    policy: RETENTION_POLICY,
    cutoff: cutoff.toISOString(),
    generatedAt: now.toISOString(),
    batchLimit,
    eligible: {
      adminAuditLogs,
      customerPassChallenges,
      sellerAuthorizationChallenges,
      customerHistoryChallenges,
      customerHistoryAccess,
      orphanCustomerPasses,
    },
    protected: {
      sessions,
      auditLogs,
      rewardEvents,
      linkedCustomerPasses,
    },
  };
}

type RetentionApplyInput = {
  cutoff: Date;
  confirmation: string;
  now?: Date;
  batchLimit?: number;
};

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function applyRetention(db: PrismaClient, input: RetentionApplyInput) {
  const now = input.now ?? new Date();
  const batchLimit = input.batchLimit ?? DEFAULT_RETENTION_BATCH_LIMIT;
  validateInputs(input.cutoff, now, batchLimit);
  if (input.confirmation !== RETENTION_APPLY_CONFIRMATION) {
    throw new Error(`Retention apply requires confirmation ${RETENTION_APPLY_CONFIRMATION}`);
  }

  const deleted = await db.$transaction(async (tx) => {
    const [
      adminAuditRows,
      customerPassChallengeRows,
      sellerAuthorizationChallengeRows,
      customerHistoryChallengeRows,
      customerHistoryAccessRows,
      customerPassRows,
    ] = await Promise.all([
      tx.adminAuditLog.findMany({
        where: { createdAt: { lt: input.cutoff } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batchLimit,
        select: { id: true },
      }),
      tx.customerPassChallenge.findMany({
        where: { expiresAt: { lt: input.cutoff } },
        orderBy: [{ expiresAt: 'asc' }, { nonce: 'asc' }],
        take: batchLimit,
        select: { nonce: true },
      }),
      tx.sellerAuthorizationChallenge.findMany({
        where: { expiresAt: { lt: input.cutoff } },
        orderBy: [{ expiresAt: 'asc' }, { nonce: 'asc' }],
        take: batchLimit,
        select: { nonce: true },
      }),
      tx.customerHistoryChallenge.findMany({
        where: { expiresAt: { lt: input.cutoff } },
        orderBy: [{ expiresAt: 'asc' }, { nonce: 'asc' }],
        take: batchLimit,
        select: { nonce: true },
      }),
      tx.customerHistoryAccess.findMany({
        where: { expiresAt: { lt: input.cutoff } },
        orderBy: [{ expiresAt: 'asc' }, { tokenHash: 'asc' }],
        take: batchLimit,
        select: { tokenHash: true },
      }),
      tx.customerPass.findMany({
        where: customerPassWhere(input.cutoff),
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: batchLimit,
        select: { id: true },
      }),
    ]);

    const [
      adminAuditLogs,
      customerPassChallenges,
      sellerAuthorizationChallenges,
      customerHistoryChallenges,
      customerHistoryAccess,
      orphanCustomerPasses,
    ] = await Promise.all([
      tx.adminAuditLog.deleteMany({ where: { id: { in: adminAuditRows.map(({ id }) => id) } } }),
      tx.customerPassChallenge.deleteMany({
        where: { nonce: { in: customerPassChallengeRows.map(({ nonce }) => nonce) } },
      }),
      tx.sellerAuthorizationChallenge.deleteMany({
        where: { nonce: { in: sellerAuthorizationChallengeRows.map(({ nonce }) => nonce) } },
      }),
      tx.customerHistoryChallenge.deleteMany({
        where: { nonce: { in: customerHistoryChallengeRows.map(({ nonce }) => nonce) } },
      }),
      tx.customerHistoryAccess.deleteMany({
        where: { tokenHash: { in: customerHistoryAccessRows.map(({ tokenHash }) => tokenHash) } },
      }),
      tx.customerPass.deleteMany({
        where: {
          ...customerPassWhere(input.cutoff),
          id: { in: customerPassRows.map(({ id }) => id) },
        },
      }),
    ]);

    await tx.adminAuditLog.create({
      data: {
        action: 'retention:prune',
        method: 'CLI',
        routeTemplate: 'cli:retention',
        targetType: 'RetentionCutoff',
        targetId: input.cutoff.toISOString(),
        actorDigest: digest('retention-actor:local-operator'),
        clientDigest: digest('retention-client:local-cli'),
        statusCode: 200,
        createdAt: now,
      },
    });

    return {
      adminAuditLogs: adminAuditLogs.count,
      customerPassChallenges: customerPassChallenges.count,
      sellerAuthorizationChallenges: sellerAuthorizationChallenges.count,
      customerHistoryChallenges: customerHistoryChallenges.count,
      customerHistoryAccess: customerHistoryAccess.count,
      orphanCustomerPasses: orphanCustomerPasses.count,
    };
  });

  return {
    policy: RETENTION_POLICY,
    cutoff: input.cutoff.toISOString(),
    appliedAt: now.toISOString(),
    batchLimit,
    deleted,
  };
}
