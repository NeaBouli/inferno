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

/**
 * Create a new verification session for a business.
 */
export async function createSession(businessId: string) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business || !business.active) {
    throw new Error('Business not found or inactive');
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + business.ttlSeconds * 1000);

  const session = await prisma.session.create({
    data: { businessId, nonce, expiresAt },
  });

  await auditLog(session.id, 'SESSION_CREATED', { businessId, nonce });

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    discountPercent: business.discountPercent,
    requiredLockIFR: business.requiredLockIFR,
    tierLabel: business.tierLabel,
  };
}

/**
 * Build the challenge message for the customer to sign.
 */
export async function buildChallengeMessage(sessionId: string): Promise<string> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true },
  });
  if (!session) throw new Error('Session not found');

  return [
    'IFR Benefits Network - Discount Verification',
    `Business: ${session.businessId}`,
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
    include: { business: true },
  });
  if (!session) throw new Error('Session not found');

  // Check status
  if (session.status !== 'PENDING') {
    throw new Error(`Session is ${session.status}, cannot attest`);
  }

  // Check attest attempt limit
  if (session.attestAttempts >= 3) {
    throw new Error('Maximum attest attempts exceeded');
  }

  // Increment attempt counter
  await prisma.session.update({
    where: { id: sessionId },
    data: { attestAttempts: session.attestAttempts + 1 },
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
      data: { status: 'REJECTED', reason: 'Invalid signature' },
    });
    await auditLog(sessionId, 'ATTEST_FAIL', { reason: 'Invalid signature' });
    return { status: 'REJECTED' as SessionStatus, reason: 'Invalid signature' };
  }

  // On-chain lock check
  let lockResult: { eligible: boolean; lockedAmount: string };
  try {
    lockResult = await checkLock(recoveredAddress, session.business.requiredLockIFR);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'RPC error';
    await auditLog(sessionId, 'ATTEST_FAIL', { reason: `On-chain error: ${msg}` });
    throw new Error(`On-chain verification failed: ${msg}`);
  }

  if (!lockResult.eligible) {
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'REJECTED',
        recoveredAddress,
        lockAmountRaw: lockResult.lockedAmount,
        reason: `Insufficient lock: ${lockResult.lockedAmount} IFR < ${session.business.requiredLockIFR} IFR`,
      },
    });
    await auditLog(sessionId, 'ATTEST_FAIL', {
      wallet: recoveredAddress,
      locked: lockResult.lockedAmount,
      required: session.business.requiredLockIFR,
    });
    return {
      status: 'REJECTED' as SessionStatus,
      wallet: recoveredAddress,
      eligible: false,
      reason: `Insufficient lock: ${lockResult.lockedAmount} IFR locked, ${session.business.requiredLockIFR} IFR required`,
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
  });

  return {
    status: 'APPROVED' as SessionStatus,
    wallet: recoveredAddress,
    eligible: true,
  };
}

/**
 * Redeem an approved session (one-time only).
 */
export async function redeem(sessionId: string) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('Session not found');

  if (session.status === 'REDEEMED') {
    throw new Error('Session already redeemed');
  }
  if (session.status !== 'APPROVED') {
    throw new Error(`Session is ${session.status}, cannot redeem`);
  }

  // Check expiry before redeem
  if (new Date() > session.expiresAt) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'EXPIRED' },
    });
    await auditLog(sessionId, 'EXPIRED', { reason: 'TTL expired before redeem' });
    throw new Error('Session expired');
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: 'REDEEMED', redeemedAt: new Date() },
  });
  await auditLog(sessionId, 'REDEEMED', { redeemedAt: new Date().toISOString() });

  return { status: 'REDEEMED' as SessionStatus };
}

/**
 * Get session status (for merchant polling).
 */
export async function getSession(sessionId: string) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('Session not found');

  // Auto-expire stale sessions
  if (
    (session.status === 'PENDING' || session.status === 'APPROVED') &&
    new Date() > session.expiresAt
  ) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'EXPIRED' },
    });
    return { ...session, status: 'EXPIRED' };
  }

  return session;
}
