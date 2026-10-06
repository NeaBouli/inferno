import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { checkBenefitEligibility, recoverSigner } from './ifrLockService';
import { toIFRBaseUnits } from './rewardService';
import { normalizeAddress } from './sellerAuth';
import { consumeSellerAuthorizationChallenge } from './sellerAuthorizationChallenge';
import { safeProductPrice } from './productPrice';
import { snapshotLockSource, type LockSource, type VerifiedLockSource } from './lockSource';
import {
  WalletFingerprintUnavailableError,
  fingerprintWallet,
  fingerprintWallets,
  isWalletFingerprint,
  isWalletFingerprintConfigured,
} from './walletFingerprint';

const prisma = new PrismaClient();

export { prisma };

// ── Session State Machine ──────────────────────────────────

type SessionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED';
export const CUSTOMER_CHALLENGE_DOMAIN = 'shop.ifrunit.tech';

function benefitFromSession(session: {
  benefitRuleId: string | null;
  benefitSnapshotVersion: number | null;
  benefitLabel: string | null;
  benefitCategory: string | null;
  benefitProductName: string | null;
  benefitBasePriceMinor: string | null;
  benefitCurrency: string | null;
  benefitDiscountPercent: number | null;
  benefitRequiredLockIFR: number | null;
  benefitMinIFRHeld: number | null;
  benefitLockSource: string | null;
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
    minIFRHeld: number;
    lockSource: string;
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
    const price = (session.benefitSnapshotVersion ?? 0) >= 3
      ? safeProductPrice({
          basePriceMinor: session.benefitBasePriceMinor,
          currency: session.benefitCurrency,
        })
      : { basePriceMinor: null, currency: null };
    return {
      benefitRuleId: session.benefitRuleId,
      label: session.benefitLabel,
      category: session.benefitCategory,
      productName: session.benefitProductName,
      ...price,
      discountPercent: session.benefitDiscountPercent,
      requiredLockIFR: session.benefitRequiredLockIFR,
      minIFRHeld: (session.benefitSnapshotVersion ?? 0) >= 4
        ? session.benefitMinIFRHeld ?? 0
        : 0,
      lockSource: snapshotLockSource(
        session.benefitSnapshotVersion,
        session.benefitLockSource
      ),
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
      basePriceMinor: null,
      currency: null,
      discountPercent: session.business.discountPercent,
      requiredLockIFR: session.business.requiredLockIFR,
      minIFRHeld: 0,
      lockSource: 'ifrlock' as LockSource,
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
    basePriceMinor: null,
    currency: null,
    discountPercent: session.benefitRule.discountPercent,
    requiredLockIFR: session.benefitRule.requiredLockIFR,
    minIFRHeld: 0,
    lockSource: 'ifrlock' as LockSource,
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
    customerFingerprint: string | null;
    benefitDailyRedemptionLimit: number | null;
    benefitMonthlyRedemptionLimit: number | null;
  },
  now: Date
): Promise<RedemptionLimitDecision | null> {
  const dailyLimit = Math.max(0, session.benefitDailyRedemptionLimit ?? 0);
  const monthlyLimit = Math.max(0, session.benefitMonthlyRedemptionLimit ?? 0);
  if ((!dailyLimit && !monthlyLimit) || !session.benefitRuleId || !session.customerFingerprint) {
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
      AND "recoveredAddress" = ${session.customerFingerprint}
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
type SessionCreatorAuthorization = {
  walletAddress: string;
  nonce: string;
  scope: string;
};

type SessionCreator = {
  walletAddress: string;
  role: 'OWNER' | 'OPERATOR';
  operatorId: string | null;
  label: string | null;
  expiresAt: Date | null;
};

export async function resolveSessionCreator(
  tx: Prisma.TransactionClient,
  businessId: string,
  walletAddress: string
): Promise<SessionCreator | null> {
  const normalizedWallet = normalizeAddress(walletAddress);
  const business = await tx.business.findUnique({
    where: { id: businessId },
    select: { ownerAddress: true, active: true },
  });
  if (!business?.active || !business.ownerAddress) return null;
  if (normalizeAddress(business.ownerAddress) === normalizedWallet) {
    return {
      walletAddress: normalizedWallet,
      role: 'OWNER',
      operatorId: null,
      label: 'Business owner',
      expiresAt: null,
    };
  }

  const operator = await tx.checkoutOperator.findFirst({
    where: {
      businessId,
      walletAddress: normalizedWallet,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true, label: true, expiresAt: true },
  });
  if (!operator) return null;
  return {
    walletAddress: normalizedWallet,
    role: 'OPERATOR',
    operatorId: operator.id,
    label: operator.label,
    expiresAt: operator.expiresAt,
  };
}

export async function createSessionSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    benefitRuleId?: string;
    creator: SessionCreator | null;
    customerPassId?: string;
  }
) {
  const { businessId, benefitRuleId, creator, customerPassId } = input;
  const nonce = crypto.randomBytes(32).toString('hex');

  // The no-op write takes SQLite's write lock before mutable rule state is read.
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
            SELECT 1 FROM "Product"
            WHERE "Product"."id" = "BenefitRule"."productId"
              AND "Product"."active" = 1
          )
        )
    `;
    if (lockedRules !== 1) throw new Error('Benefit rule not found or inactive');
  } else {
    const lockedBusinesses = await tx.$executeRaw`
      UPDATE "Business" SET "active" = "active"
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
        include: {
          product: {
            select: {
              basePriceMinor: true,
              currency: true,
            },
          },
        },
      })
    : null;
  if (benefitRuleId && !benefitRule) throw new Error('Benefit rule not found or inactive');

  const ttlSeconds = benefitRule?.ttlSeconds ?? business.ttlSeconds;
  const productPrice = safeProductPrice({
    basePriceMinor: benefitRule?.product?.basePriceMinor,
    currency: benefitRule?.product?.currency,
  });
  const benefitSnapshot = benefitRule
    ? {
        benefitLabel: benefitRule.label,
        benefitCategory: benefitRule.category,
        benefitProductName: benefitRule.productName,
        benefitBasePriceMinor: productPrice.basePriceMinor,
        benefitCurrency: productPrice.currency,
        benefitDiscountPercent: benefitRule.discountPercent,
        benefitRequiredLockIFR: benefitRule.requiredLockIFR,
        benefitMinIFRHeld: benefitRule.minIFRHeld,
        benefitLockSource: benefitRule.lockSource,
        benefitTtlSeconds: benefitRule.ttlSeconds,
        benefitDailyRedemptionLimit: benefitRule.dailyRedemptionLimit,
        benefitMonthlyRedemptionLimit: benefitRule.monthlyRedemptionLimit,
      }
    : {
        benefitLabel: business.tierLabel,
        benefitCategory: null,
        benefitProductName: null,
        benefitBasePriceMinor: null,
        benefitCurrency: null,
        benefitDiscountPercent: business.discountPercent,
        benefitRequiredLockIFR: business.requiredLockIFR,
        benefitMinIFRHeld: 0,
        benefitLockSource: 'ifrlock',
        benefitTtlSeconds: business.ttlSeconds,
        benefitDailyRedemptionLimit: 0,
        benefitMonthlyRedemptionLimit: 0,
      };
  const created = await tx.session.create({
    data: {
      businessId,
      benefitRuleId: benefitRule?.id,
      customerPassId,
      benefitSnapshotVersion: 5,
      ...benefitSnapshot,
      nonce,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    },
    include: { business: true, benefitRule: true },
  });
  await tx.auditLog.create({
    data: {
      sessionId: created.id,
      type: customerPassId ? 'CUSTOMER_PASS_BOUND' : 'SESSION_CREATED',
      payload: JSON.stringify({
        businessId,
        benefitRuleId: benefitRule?.id ?? null,
        customerPassId: customerPassId ?? null,
        createdBy: creator ? {
          walletAddress: creator.walletAddress,
          role: creator.role,
          operatorId: creator.operatorId,
        } : null,
      }),
    },
  });
  return created;
}

async function createSessionInternal(
  businessId: string,
  benefitRuleId?: string,
  creatorAuthorization?: SessionCreatorAuthorization
) {
  const session = await prisma.$transaction(async (tx) => {
    let creator: SessionCreator | null = null;
    if (creatorAuthorization) {
      await consumeSellerAuthorizationChallenge(tx, {
        nonce: creatorAuthorization.nonce,
        walletAddress: creatorAuthorization.walletAddress,
        action: 'sessions:create',
        businessId,
        scope: creatorAuthorization.scope,
      });
      creator = await resolveSessionCreator(tx, businessId, creatorAuthorization.walletAddress);
      if (!creator) throw new Error('Seller wallet is not authorized for checkout');
    }

    const created = await createSessionSnapshot(tx, { businessId, benefitRuleId, creator });
    return { created, creator };
  });

  const benefit = benefitFromSession(session.created);

  return {
    sessionId: session.created.id,
    expiresAt: session.created.expiresAt,
    createdBy: session.creator,
    ...benefit,
  };
}

export function createSession(businessId: string, benefitRuleId?: string) {
  return createSessionInternal(businessId, benefitRuleId);
}

export function createAuthorizedSession(
  businessId: string,
  benefitRuleId: string | undefined,
  creatorAuthorization: SessionCreatorAuthorization
) {
  return createSessionInternal(businessId, benefitRuleId, creatorAuthorization);
}

/**
 * Build the challenge message for the customer to sign.
 */
export async function buildChallengeMessage(
  sessionId: string,
  options: { allowCustomerPass?: boolean } = {}
): Promise<string> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true },
  });
  if (!session) throw new Error('Session not found');
  if (session.customerPassId && !options.allowCustomerPass) {
    throw new Error('Customer pass confirmation required');
  }
  const benefit = benefitFromSession(session);

  return [
    'IFR Benefits Network - Discount Verification',
    `Domain: ${CUSTOMER_CHALLENGE_DOMAIN}`,
    `Business: ${session.businessId}`,
    `Benefit Rule: ${benefit.benefitRuleId ?? 'business-default'}`,
    `Benefit: ${benefit.label ?? 'Standard'}`,
    `Product: ${benefit.productName ?? 'Business default benefit'}`,
    ...(benefit.basePriceMinor !== null && benefit.currency !== null
      ? [`Reference Price: ${benefit.currency} ${benefit.basePriceMinor} minor units`]
      : []),
    `Required Lock IFR: ${benefit.requiredLockIFR}`,
    `Minimum Held IFR: ${benefit.minIFRHeld}`,
    ...((session.benefitSnapshotVersion ?? 0) >= 5
      ? [`Lock Source: ${benefit.lockSource}`]
      : []),
    `Discount Percent: ${benefit.discountPercent}`,
    `Session: ${session.id}`,
    `Nonce: ${session.nonce}`,
    `Expires: ${session.expiresAt.toISOString()}`,
    `Chain ID: ${config.CHAIN_ID}`,
    (session.benefitSnapshotVersion ?? 0) >= 5
      ? 'Action: Verify IFR Benefit Eligibility'
      : 'Action: Verify IFR Lock Eligibility',
  ].join('\n');
}

/**
 * Attest: verify signature, check expiry, check on-chain lock.
 */
export async function attest(
  sessionId: string,
  signature: string,
  options: { expectedWalletFingerprint?: string } = {}
) {
  // T-231a fail closed: without the server key no customer identity can be stored or compared.
  if (!isWalletFingerprintConfigured()) throw new WalletFingerprintUnavailableError();
  const expectedWallet = options.expectedWalletFingerprint;
  const message = await buildChallengeMessage(sessionId, {
    allowCustomerPass: Boolean(expectedWallet),
  });
  let recoveredAddress: string;
  try {
    recoveredAddress = recoverSigner(message, signature);
  } catch {
    // An unrecoverable signature proves no wallet authority, so it must not
    // consume the session's attempt budget or mutate session state (CWA-37).
    const current = await assertAttestable(sessionId, expectedWallet);
    return {
      status: 'REJECTED' as SessionStatus,
      reason: 'Invalid signature. You can retry this QR session.',
      attemptsRemaining: Math.max(0, 3 - current.attestAttempts),
    };
  }

  // CWA-37: everything up to the approval commit is read-only. Invalid,
  // valid-but-ineligible and RPC-failed attestations never touch attempts,
  // the wallet binding, status or the audit log, so a session-ID holder cannot
  // bind a foreign wallet or burn the budget.
  // The raw address stays in memory for the on-chain read; only its keyed fingerprint is compared
  // and persisted.
  const customerFingerprint = fingerprintWallet(recoveredAddress);
  const { benefit, attestAttempts } = await readAttestContext(
    sessionId,
    customerFingerprint,
    expectedWallet
  );

  let eligibilityResult: {
    eligible: boolean;
    lockEligible: boolean;
    heldEligible: boolean;
    lockedAmount: string;
    walletAmount: string | null;
    walletBalanceRaw: string | null;
    ifrLockAmount: string | null;
    commitmentAmount: string | null;
    verifiedLockSource: VerifiedLockSource | null;
    verificationBlock: number;
  };
  try {
    eligibilityResult = await checkBenefitEligibility(
      recoveredAddress,
      benefit.requiredLockIFR,
      benefit.minIFRHeld,
      benefit.lockSource
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'RPC error';
    throw new Error(`On-chain verification failed: ${msg}`);
  }

  if (!eligibilityResult.eligible) {
    const lockDeficit = benefit.lockSource === 'ifrlock'
      ? `${eligibilityResult.ifrLockAmount ?? '0'} IFR in IFRLock < ${benefit.requiredLockIFR} IFR required`
      : benefit.lockSource === 'commitment_time_only'
        ? `${eligibilityResult.commitmentAmount ?? '0'} IFR in active TIME_ONLY CommitmentVault tranches < ${benefit.requiredLockIFR} IFR required`
        : `Neither source independently reaches ${benefit.requiredLockIFR} IFR (IFRLock ${eligibilityResult.ifrLockAmount ?? '0'} IFR; active TIME_ONLY CommitmentVault ${eligibilityResult.commitmentAmount ?? '0'} IFR; partial amounts are not combined)`;
    const deficits = [
      ...(!eligibilityResult.lockEligible
        ? [lockDeficit]
        : []),
      ...(!eligibilityResult.heldEligible
        ? [`${eligibilityResult.walletAmount ?? '0'} IFR held < ${benefit.minIFRHeld} IFR required`]
        : []),
    ];
    const retryAction = !eligibilityResult.lockEligible && !eligibilityResult.heldEligible
      ? 'Increase both balances and retry this QR session.'
      : !eligibilityResult.lockEligible
        ? benefit.lockSource === 'ifrlock'
          ? 'Lock more IFR in IFRLock and retry this QR session.'
          : benefit.lockSource === 'commitment_time_only'
            ? 'Lock more IFR in TIME_ONLY CommitmentVault tranches and retry this QR session.'
            : 'Reach the full threshold in IFRLock or TIME_ONLY CommitmentVault tranches and retry this QR session.'
        : 'Keep more IFR in this wallet and retry this QR session.';
    const reasonLabel = !eligibilityResult.lockEligible && !eligibilityResult.heldEligible
      ? 'Insufficient eligibility'
      : !eligibilityResult.lockEligible
        ? 'Insufficient lock'
        : 'Insufficient wallet balance';
    return {
      status: 'REJECTED' as SessionStatus,
      wallet: recoveredAddress,
      eligible: false,
      reason: `${reasonLabel}: ${deficits.join('; ')}. ${retryAction}`,
      attemptsRemaining: Math.max(0, 3 - attestAttempts),
    };
  }

  await commitApprovedAttest(sessionId, customerFingerprint, expectedWallet, eligibilityResult, {
    lockSource: benefit.lockSource,
    minIFRHeld: benefit.minIFRHeld,
    benefitRuleId: benefit.benefitRuleId,
  });

  return {
    status: 'APPROVED' as SessionStatus,
    wallet: recoveredAddress,
    eligible: true,
    benefit,
  };
}

// Read-only precondition check for requests that proved no wallet authority.
async function assertAttestable(sessionId: string, expectedWallet?: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, attestAttempts: true, expiresAt: true, customerPassId: true },
  });
  if (!session) throw new Error('Session not found');
  if (session.customerPassId && !expectedWallet) {
    throw new Error('Customer pass confirmation required');
  }
  if (session.status !== 'PENDING') {
    throw new Error(`Session is ${session.status}, cannot attest`);
  }
  if (session.attestAttempts >= 3) throw new Error('Maximum attest attempts exceeded');
  if (session.expiresAt <= new Date()) throw new Error('Session expired');
  return session;
}

type AttestSession = Prisma.SessionGetPayload<{
  include: { business: true; benefitRule: true; customerPass: true };
}>;

// Wallet/pass/binding checks shared by the read-only precheck and the commit. All inputs are keyed
// fingerprints (T-231a); a legacy raw value never equals a fingerprint, so it fails closed.
function assertWalletMayAttest(
  session: AttestSession,
  customerFingerprint: string,
  expectedWalletFingerprint?: string
) {
  if (!isWalletFingerprint(customerFingerprint)) throw new WalletFingerprintUnavailableError();
  if (expectedWalletFingerprint && session.customerPass?.walletFingerprint !== expectedWalletFingerprint) {
    throw new Error('Customer pass wallet mismatch');
  }
  if (expectedWalletFingerprint && customerFingerprint !== expectedWalletFingerprint) {
    throw new Error('Customer signature does not match this checkout pass');
  }
  if (session.customerFingerprint && session.customerFingerprint !== customerFingerprint) {
    throw new Error('Session is already bound to another customer wallet');
  }
  return customerFingerprint;
}

async function readAttestContext(
  sessionId: string,
  customerFingerprint: string,
  expectedWallet?: string
) {
  await assertAttestable(sessionId, expectedWallet);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true, customerPass: true },
  });
  if (!session) throw new Error('Session not found');
  assertWalletMayAttest(session, customerFingerprint, expectedWallet);
  return { benefit: benefitFromSession(session), attestAttempts: session.attestAttempts };
}

// Single atomic transition for an eligible wallet: lock the row, revalidate
// every precondition, then bind, count the attempt, approve and audit together.
async function commitApprovedAttest(
  sessionId: string,
  customerFingerprint: string,
  expectedWallet: string | undefined,
  eligibility: {
    lockedAmount: string;
    walletAmount: string | null;
    walletBalanceRaw: string | null;
    verifiedLockSource: VerifiedLockSource | null;
    verificationBlock: number;
  },
  audit: { lockSource: string; minIFRHeld: number; benefitRuleId: string | null }
) {
  const expired = await prisma.$transaction(async (tx) => {
    const locked = await tx.$executeRaw`
      UPDATE "Session" SET "attestAttempts" = "attestAttempts" WHERE "id" = ${sessionId}
    `;
    if (locked !== 1) throw new Error('Session not found');
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      include: { business: true, benefitRule: true, customerPass: true },
    });
    if (!session) throw new Error('Session not found');
    if (session.customerPassId && !expectedWallet) {
      throw new Error('Customer pass confirmation required');
    }
    if (session.status !== 'PENDING') {
      throw new Error(`Session is ${session.status}, cannot attest`);
    }
    if (session.attestAttempts >= 3) throw new Error('Maximum attest attempts exceeded');
    if (session.expiresAt <= new Date()) {
      await tx.session.update({ where: { id: sessionId }, data: { status: 'EXPIRED' } });
      await tx.auditLog.create({
        data: {
          sessionId,
          type: 'EXPIRED',
          payload: JSON.stringify({ reason: 'TTL expired during attest' }),
        },
      });
      return true;
    }
    const boundFingerprint = assertWalletMayAttest(session, customerFingerprint, expectedWallet);

    const approved = await tx.session.updateMany({
      where: {
        id: sessionId,
        status: 'PENDING',
        attestAttempts: session.attestAttempts,
        OR: [{ customerFingerprint: null }, { customerFingerprint: session.customerFingerprint }],
      },
      data: {
        status: 'APPROVED',
        attestAttempts: session.attestAttempts + 1,
        customerFingerprint: boundFingerprint,
        lockAmountRaw: eligibility.lockedAmount,
        walletBalanceRaw: eligibility.walletBalanceRaw,
        verifiedLockSource: eligibility.verifiedLockSource,
        verificationBlock: eligibility.verificationBlock,
        reason: null,
      },
    });
    if (approved.count !== 1) throw new Error('Session is no longer PENDING, cannot attest');
    await tx.auditLog.create({
      data: {
        sessionId,
        type: 'ATTEST_OK',
        // No customer wallet or fingerprint in audit payloads (T-231a).
        payload: JSON.stringify({
          locked: eligibility.lockedAmount,
          lockSource: audit.lockSource,
          verifiedLockSource: eligibility.verifiedLockSource,
          held: eligibility.walletAmount,
          minIFRHeld: audit.minIFRHeld,
          verificationBlock: eligibility.verificationBlock,
          benefitRuleId: audit.benefitRuleId,
        }),
      },
    });
    return false;
  });
  if (expired) throw new Error('Session expired');
}

/**
 * Redeem an approved session (one-time only).
 */
export async function redeem(
  sessionId: string,
  actor: { walletAddress: string; role: 'OWNER' | 'OPERATOR'; operatorId?: string | null }
) {
  // T-231a fail closed: limits and self-redemption checks compare keyed fingerprints.
  if (!isWalletFingerprintConfigured()) throw new WalletFingerprintUnavailableError();
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
      // Fail closed: only a VERIFIED link with a bound partnerId creates an
      // outbox row. APPLIED, STALE, REVOKED and DISABLED (seller opt-out)
      // links never create reward events, and a missing link keeps the
      // default rewards-OFF behavior.
      // A legacy raw value (pre-migration row) never creates an outbox row.
      const customerFingerprint = isWalletFingerprint(session.customerFingerprint) ? session.customerFingerprint : null;
      if (rewardLink?.status === 'VERIFIED' && rewardLink.partnerId && customerFingerprint && session.lockAmountRaw) {
        // Self-redemption: the seller's own (business) wallets are fingerprinted in memory and
        // compared with the stored customer fingerprint.
        const ownerIsCustomer = fingerprintWallets([business?.ownerAddress]).has(customerFingerprint);
        const activeOperators = await tx.checkoutOperator.findMany({
          where: {
            businessId: session.businessId,
            active: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: redeemedAt } }],
          },
          select: { walletAddress: true },
        });
        const operatorIsCustomer = fingerprintWallets(
          activeOperators.map((operator) => operator.walletAddress)
        ).has(customerFingerprint);

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
                ${customerFingerprint}, ${lockAmountBaseUnits}, ${config.CHAIN_ID},
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
 * Get session status (for merchant polling). Read-only: a stale open session is
 * reported as EXPIRED here, while the persisted transition happens only in the
 * conditional attest/redeem state transitions (CWA-43).
 */
export async function getSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true },
  });
  if (!session) throw new Error('Session not found');
  const benefit = benefitFromSession(session);

  if (
    (session.status === 'PENDING' || session.status === 'APPROVED') &&
    new Date() > session.expiresAt
  ) {
    return { ...session, status: 'EXPIRED', benefit };
  }

  return { ...session, benefit };
}
