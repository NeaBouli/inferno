import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { checkLock, recoverSigner } from './ifrLockService';
import { toIFRBaseUnits } from './rewardService';

const prisma = new PrismaClient();

export { prisma };

// ── Session State Machine ──────────────────────────────────

type SessionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED';
export const CUSTOMER_CHALLENGE_DOMAIN = 'shop.ifrunit.tech';

function auditLog(sessionId: string, type: string, payload: Record<string, unknown>) {
  return prisma.auditLog.create({
    data: { sessionId, type, payload: JSON.stringify(payload) },
  });
}

function benefitFromSession(session: {
  benefitRuleId: string | null;
  benefitSnapshotVersion: number | null;
  benefitLabel: string | null;
  benefitCategory: string | null;
  benefitProductName: string | null;
  benefitDiscountPercent: number | null;
  benefitRequiredLockIFR: number | null;
  benefitTtlSeconds: number | null;
  benefitDailyRedemptionLimit: number | null;
  benefitMonthlyRedemptionLimit: number | null;
  business: {
    discountPercent: number;
    requiredLockIFR: number;
    ttlSeconds: number;
    tierLabel: string | null;
  };
  benefitRule: {
    id: string;
    label: string;
    category: string;
    productName: string;
    discountPercent: number;
    requiredLockIFR: number;
    ttlSeconds: number;
    dailyRedemptionLimit: number;
    monthlyRedemptionLimit: number;
  } | null;
}) {
  if (
    (session.benefitSnapshotVersion ?? 0) >= 1 &&
    session.benefitDiscountPercent !== null &&
    session.benefitRequiredLockIFR !== null &&
    session.benefitTtlSeconds !== null
  ) {
    return {
      benefitRuleId: session.benefitRuleId,
      label: session.benefitLabel,
      category: session.benefitCategory,
      productName: session.benefitProductName,
      discountPercent: session.benefitDiscountPercent,
      requiredLockIFR: session.benefitRequiredLockIFR,
      ttlSeconds: session.benefitTtlSeconds,
      dailyRedemptionLimit: session.benefitDailyRedemptionLimit ?? 0,
      monthlyRedemptionLimit: session.benefitMonthlyRedemptionLimit ?? 0,
      tierLabel: session.benefitLabel,
    };
  }

  if (!session.benefitRule) {
    return {
      benefitRuleId: null,
      label: session.business.tierLabel,
      category: null,
      productName: null,
      discountPercent: session.business.discountPercent,
      requiredLockIFR: session.business.requiredLockIFR,
      ttlSeconds: session.business.ttlSeconds,
      dailyRedemptionLimit: 0,
      monthlyRedemptionLimit: 0,
      tierLabel: session.business.tierLabel,
    };
  }

  return {
    benefitRuleId: session.benefitRule.id,
    label: session.benefitRule.label,
    category: session.benefitRule.category,
    productName: session.benefitRule.productName,
    discountPercent: session.benefitRule.discountPercent,
    requiredLockIFR: session.benefitRule.requiredLockIFR,
    ttlSeconds: session.benefitRule.ttlSeconds,
    dailyRedemptionLimit: session.benefitRule.dailyRedemptionLimit,
    monthlyRedemptionLimit: session.benefitRule.monthlyRedemptionLimit,
    tierLabel: session.benefitRule.label,
  };
}

type RedemptionLimitDecision = {
  period: 'daily' | 'monthly';
  used: number;
  limit: number;
  resetsAt: Date;
  message: string;
};

function utcRedemptionPeriods(now: Date) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { dayStart, nextDay, monthStart, nextMonth };
}

async function getRedemptionLimitDecision(
  tx: Prisma.TransactionClient,
  session: {
    businessId: string;
    benefitRuleId: string | null;
    recoveredAddress: string | null;
    benefitDailyRedemptionLimit: number | null;
    benefitMonthlyRedemptionLimit: number | null;
  },
  now: Date
): Promise<RedemptionLimitDecision | null> {
  const dailyLimit = Math.max(0, session.benefitDailyRedemptionLimit ?? 0);
  const monthlyLimit = Math.max(0, session.benefitMonthlyRedemptionLimit ?? 0);
  if ((!dailyLimit && !monthlyLimit) || !session.benefitRuleId || !session.recoveredAddress) {
    return null;
  }

  const { dayStart, nextDay, monthStart, nextMonth } = utcRedemptionPeriods(now);
  const [usage] = await tx.$queryRaw<Array<{ dailyCount: bigint | number; monthlyCount: bigint | number }>>`
    SELECT
      SUM(CASE WHEN "redeemedAt" >= ${dayStart} THEN 1 ELSE 0 END) AS "dailyCount",
      COUNT(*) AS "monthlyCount"
    FROM "Session"
    WHERE "businessId" = ${session.businessId}
      AND "benefitRuleId" = ${session.benefitRuleId}
      AND "status" = 'REDEEMED'
      AND "redeemedAt" >= ${monthStart}
      AND LOWER("recoveredAddress") = LOWER(${session.recoveredAddress})
  `;
  const dailyUsed = Number(usage?.dailyCount ?? 0);
  const monthlyUsed = Number(usage?.monthlyCount ?? 0);

  if (dailyLimit > 0 && dailyUsed >= dailyLimit) {
    return {
      period: 'daily',
      used: dailyUsed,
      limit: dailyLimit,
      resetsAt: nextDay,
      message: `Daily redemption limit reached for this wallet (${dailyUsed}/${dailyLimit}); resets ${nextDay.toISOString()}`,
    };
  }
  if (monthlyLimit > 0 && monthlyUsed >= monthlyLimit) {
    return {
      period: 'monthly',
      used: monthlyUsed,
      limit: monthlyLimit,
      resetsAt: nextMonth,
      message: `Monthly redemption limit reached for this wallet (${monthlyUsed}/${monthlyLimit}); resets ${nextMonth.toISOString()}`,
    };
  }
  return null;
}

/**
 * Create a new verification session for a business.
 */
export async function createSession(businessId: string, benefitRuleId?: string) {
  const nonce = crypto.randomBytes(32).toString('hex');
  const session = await prisma.$transaction(async (tx) => {
    // Acquire SQLite's write lock before reading mutable checkout eligibility.
    // Product/rule archival therefore linearizes either before or after this session.
    if (benefitRuleId) {
      const lockedRules = await tx.$executeRaw`
        UPDATE "BenefitRule"
        SET "active" = "active"
        WHERE "id" = ${benefitRuleId}
          AND "businessId" = ${businessId}
          AND "active" = 1
          AND (
            "productId" IS NULL
            OR EXISTS (
              SELECT 1
              FROM "Product"
              WHERE "Product"."id" = "BenefitRule"."productId"
                AND "Product"."active" = 1
            )
          )
      `;
      if (lockedRules !== 1) throw new Error('Benefit rule not found or inactive');
    } else {
      const lockedBusinesses = await tx.$executeRaw`
        UPDATE "Business"
        SET "active" = "active"
        WHERE "id" = ${businessId} AND "active" = 1
      `;
      if (lockedBusinesses !== 1) throw new Error('Business not found or inactive');
    }

    const business = await tx.business.findUnique({ where: { id: businessId } });
    if (!business || !business.active) throw new Error('Business not found or inactive');

    const benefitRule = benefitRuleId
      ? await tx.benefitRule.findFirst({
          where: {
            id: benefitRuleId,
            businessId,
            active: true,
            OR: [{ productId: null }, { product: { active: true } }],
          },
        })
      : null;
    if (benefitRuleId && !benefitRule) throw new Error('Benefit rule not found or inactive');

    const ttlSeconds = benefitRule?.ttlSeconds ?? business.ttlSeconds;
    const benefitSnapshot = benefitRule
      ? {
          benefitLabel: benefitRule.label,
          benefitCategory: benefitRule.category,
          benefitProductName: benefitRule.productName,
          benefitDiscountPercent: benefitRule.discountPercent,
          benefitRequiredLockIFR: benefitRule.requiredLockIFR,
          benefitTtlSeconds: benefitRule.ttlSeconds,
          benefitDailyRedemptionLimit: benefitRule.dailyRedemptionLimit,
          benefitMonthlyRedemptionLimit: benefitRule.monthlyRedemptionLimit,
        }
      : {
          benefitLabel: business.tierLabel,
          benefitCategory: null,
          benefitProductName: null,
          benefitDiscountPercent: business.discountPercent,
          benefitRequiredLockIFR: business.requiredLockIFR,
          benefitTtlSeconds: business.ttlSeconds,
          benefitDailyRedemptionLimit: 0,
          benefitMonthlyRedemptionLimit: 0,
        };
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const created = await tx.session.create({
      data: {
        businessId,
        benefitRuleId: benefitRule?.id,
        benefitSnapshotVersion: 2,
        ...benefitSnapshot,
        nonce,
        expiresAt,
      },
      include: { business: true, benefitRule: true },
    });
    await tx.auditLog.create({
      data: {
        sessionId: created.id,
        type: 'SESSION_CREATED',
        payload: JSON.stringify({ businessId, benefitRuleId: benefitRule?.id ?? null, nonce }),
      },
    });
    return created;
  });

  const benefit = benefitFromSession(session);

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    ...benefit,
  };
}

/**
 * Build the challenge message for the customer to sign.
 */
export async function buildChallengeMessage(sessionId: string): Promise<string> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true },
  });
  if (!session) throw new Error('Session not found');
  const benefit = benefitFromSession(session);

  return [
    'IFR Benefits Network - Discount Verification',
    `Domain: ${CUSTOMER_CHALLENGE_DOMAIN}`,
    `Business: ${session.businessId}`,
    `Benefit Rule: ${benefit.benefitRuleId ?? 'business-default'}`,
    `Benefit: ${benefit.label ?? 'Standard'}`,
    `Product: ${benefit.productName ?? 'Business default benefit'}`,
    `Required Lock IFR: ${benefit.requiredLockIFR}`,
    `Discount Percent: ${benefit.discountPercent}`,
    `Session: ${session.id}`,
    `Nonce: ${session.nonce}`,
    `Expires: ${session.expiresAt.toISOString()}`,
    `Chain ID: ${config.CHAIN_ID}`,
    'Action: Verify IFR Lock Eligibility',
  ].join('\n');
}

/**
 * Attest: verify signature, check expiry, check on-chain lock.
 */
export async function attest(sessionId: string, signature: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true },
  });
  if (!session) throw new Error('Session not found');
  const benefit = benefitFromSession(session);

  // Check status
  if (session.status !== 'PENDING') {
    throw new Error(`Session is ${session.status}, cannot attest`);
  }

  // Check attest attempt limit
  if (session.attestAttempts >= 3) {
    throw new Error('Maximum attest attempts exceeded');
  }
  const nextAttempts = session.attestAttempts + 1;
  const attemptsExhausted = nextAttempts >= 3;

  // Increment attempt counter
  await prisma.session.update({
    where: { id: sessionId },
    data: { attestAttempts: nextAttempts },
  });

  // Check expiry
  if (new Date() > session.expiresAt) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'EXPIRED' },
    });
    await auditLog(sessionId, 'EXPIRED', { reason: 'TTL expired during attest' });
    throw new Error('Session expired');
  }

  // Recover signer
  const message = await buildChallengeMessage(sessionId);
  let recoveredAddress: string;
  try {
    recoveredAddress = recoverSigner(message, signature);
  } catch {
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: attemptsExhausted ? 'REJECTED' : 'PENDING',
        reason: attemptsExhausted
          ? 'Invalid signature. Verification attempts exhausted.'
          : 'Invalid signature. You can retry this QR session.',
      },
    });
    await auditLog(sessionId, 'ATTEST_FAIL', {
      reason: 'Invalid signature',
      attempts: nextAttempts,
      terminal: attemptsExhausted,
    });
    return {
      status: 'REJECTED' as SessionStatus,
      reason: attemptsExhausted
        ? 'Invalid signature. Verification attempts exhausted.'
        : 'Invalid signature. You can retry this QR session.',
      attemptsRemaining: Math.max(0, 3 - nextAttempts),
    };
  }

  // On-chain lock check
  let lockResult: { eligible: boolean; lockedAmount: string };
  try {
    lockResult = await checkLock(recoveredAddress, benefit.requiredLockIFR);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'RPC error';
    await auditLog(sessionId, 'ATTEST_FAIL', { reason: `On-chain error: ${msg}` });
    throw new Error(`On-chain verification failed: ${msg}`);
  }

  if (!lockResult.eligible) {
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: attemptsExhausted ? 'REJECTED' : 'PENDING',
        recoveredAddress,
        lockAmountRaw: lockResult.lockedAmount,
        reason: attemptsExhausted
          ? `Insufficient lock: ${lockResult.lockedAmount} IFR < ${benefit.requiredLockIFR} IFR. Verification attempts exhausted.`
          : `Insufficient lock: ${lockResult.lockedAmount} IFR < ${benefit.requiredLockIFR} IFR. Lock more IFR and retry this QR session.`,
      },
    });
    await auditLog(sessionId, 'ATTEST_FAIL', {
      wallet: recoveredAddress,
      locked: lockResult.lockedAmount,
      required: benefit.requiredLockIFR,
      benefitRuleId: benefit.benefitRuleId,
      attempts: nextAttempts,
      terminal: attemptsExhausted,
    });
    return {
      status: 'REJECTED' as SessionStatus,
      wallet: recoveredAddress,
      eligible: false,
      reason: attemptsExhausted
        ? `Insufficient lock: ${lockResult.lockedAmount} IFR locked, ${benefit.requiredLockIFR} IFR required. Verification attempts exhausted.`
        : `Insufficient lock: ${lockResult.lockedAmount} IFR locked, ${benefit.requiredLockIFR} IFR required. Lock more IFR and retry this QR session.`,
      attemptsRemaining: Math.max(0, 3 - nextAttempts),
    };
  }

  // Approved
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: 'APPROVED',
      recoveredAddress,
      lockAmountRaw: lockResult.lockedAmount,
    },
  });
  await auditLog(sessionId, 'ATTEST_OK', {
    wallet: recoveredAddress,
    locked: lockResult.lockedAmount,
    benefitRuleId: benefit.benefitRuleId,
  });

  return {
    status: 'APPROVED' as SessionStatus,
    wallet: recoveredAddress,
    eligible: true,
    benefit,
  };
}

/**
 * Redeem an approved session (one-time only).
 */
export async function redeem(
  sessionId: string,
  actor: { walletAddress: string; role: 'OWNER' | 'OPERATOR'; operatorId?: string | null }
) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('Session not found');

  if (session.status === 'REDEEMED') {
    throw new Error('Session already redeemed');
  }
  if (session.status !== 'APPROVED') {
    throw new Error(`Session is ${session.status}, cannot redeem`);
  }

  const redeemedAt = new Date();
  const update = await prisma.$transaction(async (tx) => {
    // SQLite permits only one writer. This no-op update acquires the write lock before
    // reading cap usage, so concurrent counters cannot both redeem below the same limit.
    const lockedBusiness = await tx.$executeRaw`
      UPDATE "Business"
      SET "active" = "active"
      WHERE "id" = ${session.businessId} AND "active" = 1
    `;
    if (lockedBusiness !== 1) throw new Error('Seller business is no longer active');

    const business = await tx.business.findUnique({
      where: { id: session.businessId },
      select: { ownerAddress: true, active: true, rewardLink: true },
    });
    const ownerAuthorized = actor.role === 'OWNER' && Boolean(
      business?.active && business.ownerAddress &&
      business.ownerAddress.toLowerCase() === actor.walletAddress.toLowerCase()
    );
    const operatorAuthorized = actor.role === 'OPERATOR' && Boolean(await tx.checkoutOperator.findFirst({
      where: {
        id: actor.operatorId ?? undefined,
        businessId: session.businessId,
        walletAddress: actor.walletAddress,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: redeemedAt } }],
      },
      select: { id: true },
    }));
    if (!ownerAuthorized && !operatorAuthorized) {
      throw new Error('Seller wallet is no longer authorized for checkout');
    }

    const limitDecision = await getRedemptionLimitDecision(tx, session, redeemedAt);
    if (limitDecision) {
      const denied = await tx.session.updateMany({
        where: { id: sessionId, status: 'APPROVED', expiresAt: { gt: redeemedAt } },
        data: { status: 'REJECTED', reason: limitDecision.message },
      });
      if (denied.count === 1) {
        await tx.auditLog.create({
          data: {
            sessionId,
            type: 'REDEEM_DENIED_LIMIT',
            payload: JSON.stringify({
              period: limitDecision.period,
              used: limitDecision.used,
              limit: limitDecision.limit,
              resetsAt: limitDecision.resetsAt.toISOString(),
              wallet: session.recoveredAddress,
              benefitRuleId: session.benefitRuleId,
              actorWallet: actor.walletAddress,
              actorRole: actor.role,
            }),
          },
        });
        return { count: 0, limitError: limitDecision.message };
      }
    }

    const result = await tx.session.updateMany({
      where: { id: sessionId, status: 'APPROVED', expiresAt: { gt: redeemedAt } },
      data: { status: 'REDEEMED', redeemedAt },
    });
    if (result.count === 1) {
      await tx.auditLog.create({
        data: {
          sessionId,
          type: 'REDEEMED',
          payload: JSON.stringify({
            redeemedAt: redeemedAt.toISOString(),
            actorWallet: actor.walletAddress,
            actorRole: actor.role,
            operatorId: actor.operatorId ?? null,
          }),
        },
      });

      const rewardLink = business?.rewardLink;
      if (rewardLink?.status === 'VERIFIED' && rewardLink.partnerId && session.recoveredAddress && session.lockAmountRaw) {
        const customerWallet = session.recoveredAddress;
        const ownerIsCustomer = Boolean(
          business?.ownerAddress && business.ownerAddress.toLowerCase() === customerWallet.toLowerCase()
        );
        const operatorIsCustomer = Boolean(await tx.checkoutOperator.findFirst({
          where: {
            businessId: session.businessId,
            walletAddress: customerWallet,
            active: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: redeemedAt } }],
          },
          select: { id: true },
        }));

        if (ownerIsCustomer || operatorIsCustomer) {
          await tx.auditLog.create({
            data: {
              sessionId,
              type: 'REWARD_SKIPPED_POLICY',
              payload: JSON.stringify({ reason: ownerIsCustomer ? 'seller owner wallet' : 'active checkout operator wallet' }),
            },
          });
        } else {
          let lockAmountBaseUnits: string | null = null;
          try {
            lockAmountBaseUnits = toIFRBaseUnits(session.lockAmountRaw);
          } catch {
            await tx.auditLog.create({
              data: {
                sessionId,
                type: 'REWARD_OUTBOX_SKIPPED',
                payload: JSON.stringify({ reason: 'invalid lock amount' }),
              },
            });
          }
          if (lockAmountBaseUnits) {
            const now = new Date();
            await tx.$executeRaw`
              INSERT OR IGNORE INTO "RewardEvent" (
                "id", "businessId", "sessionId", "partnerId", "customerWallet",
                "lockAmountRaw", "chainId", "status", "reason", "createdAt", "updatedAt"
              ) VALUES (
                ${crypto.randomUUID()}, ${session.businessId}, ${sessionId}, ${rewardLink.partnerId},
                ${customerWallet}, ${lockAmountBaseUnits}, ${config.CHAIN_ID},
                'PENDING', 'Awaiting live governance and caller reconciliation', ${now}, ${now}
              )
            `;
          }
        }
      }
    }
    return { count: result.count, limitError: null as string | null };
  });

  if (update.limitError) throw new Error(update.limitError);

  if (update.count !== 1) {
    const latest = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!latest) throw new Error('Session not found');
    if (latest.status === 'REDEEMED') throw new Error('Session already redeemed');
    if (latest.expiresAt <= redeemedAt) {
      await prisma.$transaction(async (tx) => {
        const result = await tx.session.updateMany({
          where: { id: sessionId, status: 'APPROVED' },
          data: { status: 'EXPIRED' },
        });
        if (result.count === 1) {
          await tx.auditLog.create({
            data: {
              sessionId,
              type: 'EXPIRED',
              payload: JSON.stringify({ reason: 'TTL expired before redeem' }),
            },
          });
        }
        return result;
      });
      throw new Error('Session expired');
    }
    throw new Error(`Session is ${latest.status}, cannot redeem`);
  }

  return { status: 'REDEEMED' as SessionStatus };
}

/**
 * Get session status (for merchant polling).
 */
export async function getSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true },
  });
  if (!session) throw new Error('Session not found');
  const benefit = benefitFromSession(session);

  // Auto-expire stale sessions
  if (
    (session.status === 'PENDING' || session.status === 'APPROVED') &&
    new Date() > session.expiresAt
  ) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'EXPIRED' },
    });
    return { ...session, status: 'EXPIRED', benefit };
  }

  return { ...session, benefit };
}
