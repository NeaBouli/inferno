import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export const RETENTION_POLICY = 'phase-two-bounded-customer-data';
export const RETENTION_APPLY_CONFIRMATION = 'PRUNE_BENEFITS_DATA_WINDOW';
/**
 * T-231a: customer-linked rows (sessions with their audit rows and passes, reward events) are kept
 * for at least this many days and pruned afterwards. 35 days covers the longest monthly
 * redemption-limit look-back (31 days) and the Model B rule that a period is settled within 72 h
 * after it ends; no live check can need an older row.
 */
export const CUSTOMER_DATA_MIN_RETENTION_DAYS = 35;
const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RETENTION_BATCH_LIMIT = 1000;
export const MAX_RETENTION_BATCH_LIMIT = 10_000;

type RetentionEligibleCounts = {
  adminAuditLogs: number;
  customerPassChallenges: number;
  sellerAuthorizationChallenges: number;
  customerHistoryChallenges: number;
  customerHistoryAccess: number;
  orphanCustomerPasses: number;
  rewardEvents: number;
  sessions: number;
  sessionAuditLogs: number;
  linkedCustomerPasses: number;
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
  customerDataCutoff: string;
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

/** The requested cutoff, but never younger than the customer-data floor. */
export function customerDataCutoff(cutoff: Date, now: Date): Date {
  const floor = new Date(now.getTime() - CUSTOMER_DATA_MIN_RETENTION_DAYS * DAY_MS);
  return cutoff < floor ? cutoff : floor;
}

function rewardEventWhere(customerCutoff: Date): Prisma.RewardEventWhereInput {
  // Every status: after the window no reward event can enter a valid settlement (see above).
  return { createdAt: { lt: customerCutoff } };
}

function sessionWhere(customerCutoff: Date): Prisma.SessionWhereInput {
  // Session TTLs are seconds to minutes, so every session this old is terminal. A session whose
  // reward event is still inside the window stays until that event is pruned.
  return { createdAt: { lt: customerCutoff }, expiresAt: { lt: customerCutoff }, rewardEvent: { is: null } };
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
  const customerCutoff = customerDataCutoff(cutoff, now);
  // A session becomes prunable together with its reward event, so the report counts both.
  const sessionsAfterEvents: Prisma.SessionWhereInput = {
    createdAt: { lt: customerCutoff },
    expiresAt: { lt: customerCutoff },
    OR: [{ rewardEvent: { is: null } }, { rewardEvent: { is: rewardEventWhere(customerCutoff) } }],
  };
  const [
    rewardEventsEligible,
    sessionsEligible,
    sessionAuditLogs,
    linkedCustomerPassesEligible,
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
    db.rewardEvent.count({ where: rewardEventWhere(customerCutoff) }),
    db.session.count({ where: sessionsAfterEvents }),
    db.auditLog.count({ where: { session: sessionsAfterEvents } }),
    db.customerPass.count({ where: { session: { is: sessionsAfterEvents } } }),
    db.adminAuditLog.count({ where: { createdAt: { lt: cutoff } } }),
    db.customerPassChallenge.count({ where: { expiresAt: { lt: cutoff } } }),
    db.sellerAuthorizationChallenge.count({ where: { expiresAt: { lt: cutoff } } }),
    db.customerHistoryChallenge.count({ where: { expiresAt: { lt: cutoff } } }),
    db.customerHistoryAccess.count({ where: { expiresAt: { lt: cutoff } } }),
    db.customerPass.count({ where: customerPassWhere(cutoff) }),
    db.session.count({ where: { NOT: sessionsAfterEvents } }),
    db.auditLog.count({ where: { session: { NOT: sessionsAfterEvents } } }),
    db.rewardEvent.count({ where: { NOT: rewardEventWhere(customerCutoff) } }),
    db.customerPass.count({ where: { session: { is: { NOT: sessionsAfterEvents } } } }),
  ]);

  return {
    policy: RETENTION_POLICY,
    cutoff: cutoff.toISOString(),
    customerDataCutoff: customerCutoff.toISOString(),
    generatedAt: now.toISOString(),
    batchLimit,
    eligible: {
      adminAuditLogs,
      customerPassChallenges,
      sellerAuthorizationChallenges,
      customerHistoryChallenges,
      customerHistoryAccess,
      orphanCustomerPasses,
      rewardEvents: rewardEventsEligible,
      sessions: sessionsEligible,
      sessionAuditLogs,
      linkedCustomerPasses: linkedCustomerPassesEligible,
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

  const customerCutoff = customerDataCutoff(input.cutoff, now);
  const deleted = await db.$transaction(async (tx) => {
    // Customer-linked data first: reward events, then sessions without a remaining event, their
    // audit rows and the passes they were bound to.
    const rewardEventRows = await tx.rewardEvent.findMany({
      where: rewardEventWhere(customerCutoff),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchLimit,
      select: { id: true },
    });
    const rewardEvents = await tx.rewardEvent.deleteMany({
      where: { ...rewardEventWhere(customerCutoff), id: { in: rewardEventRows.map(({ id }) => id) } },
    });
    const sessionRows = await tx.session.findMany({
      where: sessionWhere(customerCutoff),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchLimit,
      select: { id: true, customerPassId: true },
    });
    const sessionIds = sessionRows.map(({ id }) => id);
    const linkedPassIds = sessionRows.flatMap(({ customerPassId }) => customerPassId ? [customerPassId] : []);
    const sessionAuditLogs = await tx.auditLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
    const sessions = await tx.session.deleteMany({
      where: { ...sessionWhere(customerCutoff), id: { in: sessionIds } },
    });
    const linkedCustomerPasses = await tx.customerPass.deleteMany({
      where: { id: { in: linkedPassIds }, session: { is: null } },
    });

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
      rewardEvents: rewardEvents.count,
      sessions: sessions.count,
      sessionAuditLogs: sessionAuditLogs.count,
      linkedCustomerPasses: linkedCustomerPasses.count,
    };
  });

  return {
    policy: RETENTION_POLICY,
    cutoff: input.cutoff.toISOString(),
    customerDataCutoff: customerCutoff.toISOString(),
    appliedAt: now.toISOString(),
    batchLimit,
    deleted,
  };
}
