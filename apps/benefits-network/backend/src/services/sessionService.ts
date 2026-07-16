import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { checkLock, recoverSigner } from './ifrLockService';

const prisma = new PrismaClient();

export { prisma };

// ── Session State Machine ──────────────────────────────────

type SessionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED';

function auditLog(sessionId: string, type: string, payload: Record<string, unknown>) {
  return prisma.auditLog.create({
    data: { sessionId, type, payload: JSON.stringify(payload) },
  });
}

function benefitFromSession(session: {
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
  } | null;
}) {
  if (!session.benefitRule) {
    return {
      benefitRuleId: null,
      label: session.business.tierLabel,
      category: null,
      productName: null,
      discountPercent: session.business.discountPercent,
      requiredLockIFR: session.business.requiredLockIFR,
      ttlSeconds: session.business.ttlSeconds,
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
    tierLabel: session.benefitRule.label,
  };
}

/**
 * Create a new verification session for a business.
 */
export async function createSession(businessId: string, benefitRuleId?: string) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business || !business.active) {
    throw new Error('Business not found or inactive');
  }

  const benefitRule = benefitRuleId
    ? await prisma.benefitRule.findFirst({
        where: { id: benefitRuleId, businessId, active: true },
      })
    : null;
  if (benefitRuleId && !benefitRule) {
    throw new Error('Benefit rule not found or inactive');
  }

  const ttlSeconds = benefitRule?.ttlSeconds ?? business.ttlSeconds;
  const nonce = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const session = await prisma.session.create({
    data: { businessId, benefitRuleId: benefitRule?.id, nonce, expiresAt },
    include: { business: true, benefitRule: true },
  });

  const benefit = benefitFromSession(session);

  await auditLog(session.id, 'SESSION_CREATED', { businessId, benefitRuleId: benefit.benefitRuleId, nonce });

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
    const business = await tx.business.findUnique({
      where: { id: session.businessId },
      select: { ownerAddress: true, active: true },
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
    }
    return result;
  });

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
