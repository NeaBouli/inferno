import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { checkBenefitEligibility, recoverSigner } from './ifrLockService';
import { normalizeAddress } from './sellerAuth';
import { consumeSellerAuthorizationChallenge } from './sellerAuthorizationChallenge';
import { safeProductPrice } from './productPrice';
import { snapshotLockSource, type LockSource, type VerifiedLockSource } from './lockSource';

const prisma = new PrismaClient();

export { prisma };

// ── Session State Machine ──────────────────────────────────

type SessionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED';

// Owner decision B (T-231b): the customer proof is processed in-request only. The signed text binds
// version/purpose, deployment audience, chain, shop, the seller-created session, expiry and the
// immutable checkout terms; only the outcome (status, lock source, self-redemption flag) is stored.
export const CHECKOUT_PROOF_VERSION = 2;
export const CHECKOUT_PROOF_VERSION_LABEL = 'ifr-benefits/checkout-proof/2';
// Non-payable outbox status: a seller-confirmed checkout whose reward needs a policy that does not
// exist under owner decision B (no per-customer dedup). No queue transitions it.
export const REWARD_BLOCKED_POLICY = 'BLOCKED_POLICY';
export const REWARD_BLOCKED_POLICY_REASON =
  'Customer-privacy policy gap: per-customer reward dedup is not available without customer data (T-231b); not payable';

/** The signature does not recover to the wallet the customer claimed in the same request. */
export class CustomerProofMismatchError extends Error {
  constructor() {
    super('Customer signature does not match the claimed wallet address');
    this.name = 'CustomerProofMismatchError';
  }
}

export class CustomerLimitNotHostedError extends Error {
  constructor() {
    super(
      'Per-customer redemption limits are no longer enforced by IFR (customer privacy). ' +
      'Set this rule\'s daily and monthly limits to 0 and enforce limits in your own checkout.'
    );
    this.name = 'CustomerLimitNotHostedError';
  }
}

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
  if (benefitRule && (benefitRule.dailyRedemptionLimit > 0 || benefitRule.monthlyRedemptionLimit > 0)) {
    // Fail closed instead of silently dropping a limit the seller configured earlier.
    throw new CustomerLimitNotHostedError();
  }

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
      confirmedByWallet: creator?.walletAddress ?? null,
      confirmedByRole: creator?.role ?? null,
      confirmedByOperatorId: creator?.operatorId ?? null,
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

type ProofSession = Prisma.SessionGetPayload<{ include: { business: true; benefitRule: true } }>;

function checkoutTerms(session: ProofSession) {
  const benefit = benefitFromSession(session);
  return {
    benefitRuleId: benefit.benefitRuleId ?? 'business-default',
    label: benefit.label ?? 'Standard',
    productName: benefit.productName ?? 'Business default benefit',
    basePriceMinor: benefit.basePriceMinor,
    currency: benefit.currency,
    requiredLockIFR: benefit.requiredLockIFR,
    minIFRHeld: benefit.minIFRHeld,
    lockSource: benefit.lockSource,
    discountPercent: benefit.discountPercent,
  };
}

/** sha256 over the canonical (fixed key order) JSON of the immutable checkout terms. */
export function checkoutTermsDigest(session: ProofSession) {
  const terms = checkoutTerms(session);
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(terms)).digest('hex');
}

function proofAudience() {
  return config.SELLER_AUTH_DOMAIN;
}

/**
 * Exact text the customer signs (EIP-191). Derived by the server from the stored session snapshot,
 * so any substitution of shop, session, chain, audience, expiry or terms changes the signed text.
 */
export function buildCheckoutProofMessage(session: ProofSession, claimedWallet: string): string {
  const terms = checkoutTerms(session);
  return [
    'IFR Benefits Network - Checkout Proof',
    `Version: ${CHECKOUT_PROOF_VERSION_LABEL}`,
    'Purpose: Redeem this one checkout with verified IFR benefit eligibility',
    `Wallet: ${claimedWallet}`,
    `Audience: ${proofAudience()}`,
    `Chain ID: ${config.CHAIN_ID}`,
    `Shop: ${session.businessId}`,
    `Session: ${session.id}`,
    `Nonce: ${session.nonce}`,
    `Expires: ${session.expiresAt.toISOString()}`,
    `Benefit Rule: ${terms.benefitRuleId}`,
    `Benefit: ${terms.label}`,
    `Product: ${terms.productName}`,
    ...(terms.basePriceMinor !== null && terms.currency !== null
      ? [`Reference Price: ${terms.currency} ${terms.basePriceMinor} minor units`]
      : []),
    `Required Lock IFR: ${terms.requiredLockIFR}`,
    `Minimum Held IFR: ${terms.minIFRHeld}`,
    `Lock Source: ${terms.lockSource}`,
    `Discount Percent: ${terms.discountPercent}`,
    `Terms Digest: ${checkoutTermsDigest(session)}`,
    'This signature redeems this checkout only. It does not move tokens. The wallet is checked in this request and not stored.',
  ].join('\n');
}

/**
 * Build the challenge message for the customer to sign.
 */
export async function buildChallengeMessage(
  sessionId: string,
  claimedWallet: string,
  options: { allowCustomerPass?: boolean } = {}
): Promise<string> {
  const wallet = normalizeClaimedWallet(claimedWallet);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true },
  });
  if (!session) throw new Error('Session not found');
  if (session.customerPassId && !options.allowCustomerPass) {
    throw new Error('Customer pass confirmation required');
  }
  return buildCheckoutProofMessage(session, wallet);
}

/** Full checksummed address supplied by the customer in this request; never stored. */
export function normalizeClaimedWallet(walletAddress: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) throw new CustomerProofInputError();
  try {
    return normalizeAddress(walletAddress);
  } catch {
    throw new CustomerProofInputError();
  }
}

export class CustomerProofInputError extends Error {
  constructor() {
    super('A valid wallet address is required for the checkout proof');
    this.name = 'CustomerProofInputError';
  }
}

/** Owner, every checkout operator (any status), reward and builder wallet of the shop. */
async function isSellerControlledWallet(
  tx: Prisma.TransactionClient,
  businessId: string,
  wallet: string
) {
  const business = await tx.business.findUnique({
    where: { id: businessId },
    select: {
      ownerAddress: true,
      rewardLink: { select: { rewardWallet: true, builderWallet: true } },
      checkoutOperators: { select: { walletAddress: true } },
    },
  });
  const target = wallet.toLowerCase();
  return [
    business?.ownerAddress,
    business?.rewardLink?.rewardWallet,
    business?.rewardLink?.builderWallet,
    ...(business?.checkoutOperators.map((operator) => operator.walletAddress) ?? []),
  ].some((candidate) => Boolean(candidate) && (candidate as string).toLowerCase() === target);
}

/**
 * Final redemption (owner decision B, T-231b). One customer request carries the claimed wallet and
 * the signature over the server-derived checkout proof. In this request only: the signature must
 * recover exactly to the claimed wallet, on-chain eligibility is read fresh, and self-redemption is
 * decided. One DB transaction then re-validates the seller confirmation, OPEN status, server-time
 * expiry, attempts and the signed terms, and flips PENDING (OPEN) -> REDEEMED exactly once.
 * Any failure before the commit changes nothing; the checkout stays OPEN.
 */
export async function attest(
  sessionId: string,
  walletAddress: string,
  signature: string,
  options: { allowCustomerPass?: boolean } = {}
) {
  const claimedWallet = normalizeClaimedWallet(walletAddress);
  const proofSession = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true },
  });
  if (!proofSession) throw new Error('Session not found');
  if (proofSession.customerPassId && !options.allowCustomerPass) {
    throw new Error('Customer pass confirmation required');
  }
  const message = buildCheckoutProofMessage(proofSession, claimedWallet);
  const signedTermsDigest = checkoutTermsDigest(proofSession);
  let recoveredAddress: string;
  try {
    recoveredAddress = recoverSigner(message, signature);
  } catch {
    // An unrecoverable signature proves no wallet authority, so it must not
    // consume the session's attempt budget or mutate session state (CWA-37).
    const current = await assertAttestable(sessionId, options.allowCustomerPass);
    return {
      status: 'REJECTED' as SessionStatus,
      reason: 'Invalid signature. You can retry this QR session.',
      attemptsRemaining: Math.max(0, 3 - current.attestAttempts),
    };
  }
  // Explicit binding: the recovered signer must equal the claimed wallet, independent of whether
  // some other address happens to be eligible.
  if (normalizeAddress(recoveredAddress) !== claimedWallet) {
    await assertAttestable(sessionId, options.allowCustomerPass);
    throw new CustomerProofMismatchError();
  }

  // CWA-37: everything up to the commit is read-only. Invalid, mismatched, ineligible and
  // RPC-failed proofs never touch attempts, status or the audit log.
  const { benefit, attestAttempts } = await readAttestContext(sessionId, options.allowCustomerPass);

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
  } catch {
    // RPC/library errors can embed the eth_call calldata, i.e. the customer address. Never
    // propagate them to responses or logs (owner decision B).
    throw new Error('On-chain verification failed. Retry this checkout in a moment.');
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
      // Returned to the signing device only; never persisted.
      wallet: claimedWallet,
      eligible: false,
      reason: `${reasonLabel}: ${deficits.join('; ')}. ${retryAction}`,
      attemptsRemaining: Math.max(0, 3 - attestAttempts),
    };
  }

  const outcome = await commitCheckoutRedemption(sessionId, claimedWallet, {
    allowCustomerPass: options.allowCustomerPass,
    signedTermsDigest,
    verifiedLockSource: eligibilityResult.verifiedLockSource,
    audit: {
      lockSource: benefit.lockSource,
      minIFRHeld: benefit.minIFRHeld,
      benefitRuleId: benefit.benefitRuleId,
    },
  });

  return {
    status: 'REDEEMED' as SessionStatus,
    // Returned to the signing device only; never persisted.
    wallet: claimedWallet,
    eligible: true,
    redeemedAt: outcome.redeemedAt,
    benefit,
    proof: {
      version: CHECKOUT_PROOF_VERSION_LABEL,
      sessionId,
      businessId: proofSession.businessId,
      termsDigest: signedTermsDigest,
      message,
      selfRedemption: outcome.selfRedemption,
    },
  };
}

// Read-only precondition check for requests that proved no (matching) wallet authority.
async function assertAttestable(sessionId: string, allowCustomerPass?: boolean) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      attestAttempts: true,
      expiresAt: true,
      customerPassId: true,
      confirmedByWallet: true,
    },
  });
  if (!session) throw new Error('Session not found');
  if (session.customerPassId && !allowCustomerPass) {
    throw new Error('Customer pass confirmation required');
  }
  if (session.status !== 'PENDING') {
    throw new Error(`Session is ${session.status}, cannot attest`);
  }
  if (session.attestAttempts >= 3) throw new Error('Maximum attest attempts exceeded');
  if (session.expiresAt <= new Date()) throw new Error('Session expired');
  if (!session.confirmedByWallet) {
    throw new Error('Session has no seller checkout confirmation, cannot attest');
  }
  return session;
}

async function readAttestContext(sessionId: string, allowCustomerPass?: boolean) {
  await assertAttestable(sessionId, allowCustomerPass);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { business: true, benefitRule: true },
  });
  if (!session) throw new Error('Session not found');
  const benefit = benefitFromSession(session);
  if (benefit.dailyRedemptionLimit > 0 || benefit.monthlyRedemptionLimit > 0) {
    // A snapshot that still carries a per-customer limit cannot be honoured without customer data.
    throw new CustomerLimitNotHostedError();
  }
  return { benefit, attestAttempts: session.attestAttempts };
}

/** The seller who confirmed (opened) this checkout must still be the owner or an active operator. */
async function sellerConfirmationStillValid(
  tx: Prisma.TransactionClient,
  session: { businessId: string; confirmedByWallet: string | null; confirmedByRole: string | null; confirmedByOperatorId: string | null },
  now: Date
) {
  if (!session.confirmedByWallet) return false;
  if (session.confirmedByRole === 'OWNER') {
    const business = await tx.business.findUnique({
      where: { id: session.businessId },
      select: { ownerAddress: true, active: true },
    });
    return Boolean(
      business?.active && business.ownerAddress &&
      business.ownerAddress.toLowerCase() === session.confirmedByWallet.toLowerCase()
    );
  }
  if (session.confirmedByRole === 'OPERATOR' && session.confirmedByOperatorId) {
    return Boolean(await tx.checkoutOperator.findFirst({
      where: {
        id: session.confirmedByOperatorId,
        businessId: session.businessId,
        walletAddress: session.confirmedByWallet,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    }));
  }
  return false;
}

async function commitCheckoutRedemption(
  sessionId: string,
  claimedWallet: string,
  input: {
    allowCustomerPass?: boolean;
    signedTermsDigest: string;
    verifiedLockSource: VerifiedLockSource | null;
    audit: { lockSource: string; minIFRHeld: number; benefitRuleId: string | null };
  }
) {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$executeRaw`
      UPDATE "Session" SET "attestAttempts" = "attestAttempts" WHERE "id" = ${sessionId}
    `;
    if (locked !== 1) throw new Error('Session not found');
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      include: { business: true, benefitRule: true },
    });
    if (!session) throw new Error('Session not found');
    if (session.customerPassId && !input.allowCustomerPass) {
      throw new Error('Customer pass confirmation required');
    }
    if (session.status === 'REDEEMED') throw new Error('Session already redeemed');
    if (session.status !== 'PENDING') {
      throw new Error(`Session is ${session.status}, cannot attest`);
    }
    if (session.attestAttempts >= 3) throw new Error('Maximum attest attempts exceeded');
    const now = new Date();
    if (session.expiresAt <= now) {
      await tx.session.update({ where: { id: sessionId }, data: { status: 'EXPIRED' } });
      await tx.auditLog.create({
        data: {
          sessionId,
          type: 'EXPIRED',
          payload: JSON.stringify({ reason: 'TTL expired during checkout proof' }),
        },
      });
      return { expired: true as const };
    }
    if (checkoutTermsDigest(session) !== input.signedTermsDigest) {
      throw new Error('Checkout terms changed after signing, cannot attest');
    }
    if (!session.business.active) throw new Error('Seller business is no longer active');
    if (!(await sellerConfirmationStillValid(tx, session, now))) {
      throw new Error('Seller wallet is no longer authorized for checkout');
    }
    // Decided while the customer address is still in request memory; only the boolean is stored.
    const selfRedemption = await isSellerControlledWallet(tx, session.businessId, claimedWallet);

    const redeemed = await tx.session.updateMany({
      where: {
        id: sessionId,
        status: 'PENDING',
        attestAttempts: session.attestAttempts,
        expiresAt: { gt: now },
      },
      data: {
        status: 'REDEEMED',
        redeemedAt: now,
        attestAttempts: session.attestAttempts + 1,
        verifiedLockSource: input.verifiedLockSource,
        selfRedemption,
        proofVersion: CHECKOUT_PROOF_VERSION,
        reason: null,
      },
    });
    if (redeemed.count !== 1) throw new Error('Session is no longer PENDING, cannot attest');
    await tx.auditLog.create({
      data: {
        sessionId,
        type: 'ATTEST_OK',
        payload: JSON.stringify({
          proofVersion: CHECKOUT_PROOF_VERSION,
          lockSource: input.audit.lockSource,
          verifiedLockSource: input.verifiedLockSource,
          minIFRHeld: input.audit.minIFRHeld,
          benefitRuleId: input.audit.benefitRuleId,
          selfRedemption,
        }),
      },
    });
    // Seller confirmation of this checkout = the seller's authenticated session opening, re-validated above.
    await tx.auditLog.create({
      data: {
        sessionId,
        type: 'REDEEMED',
        payload: JSON.stringify({
          redeemedAt: now.toISOString(),
          actorWallet: session.confirmedByWallet,
          actorRole: session.confirmedByRole,
          operatorId: session.confirmedByOperatorId,
          confirmation: session.customerPassId ? 'passes:bind' : 'sessions:create',
        }),
      },
    });

    const rewardLink = await tx.sellerRewardLink.findUnique({ where: { businessId: session.businessId } });
    // Fail closed: only a VERIFIED link with a bound partnerId creates an outbox row, and under
    // owner decision B that row is non-payable (no accepted reward rule without customer dedup).
    if (rewardLink?.status === 'VERIFIED' && rewardLink.partnerId) {
      if (selfRedemption) {
        await tx.auditLog.create({
          data: {
            sessionId,
            type: 'REWARD_SKIPPED_POLICY',
            payload: JSON.stringify({ reason: 'seller-controlled customer wallet' }),
          },
        });
      } else {
        await tx.$executeRaw`
          INSERT OR IGNORE INTO "RewardEvent" (
            "id", "businessId", "sessionId", "partnerId", "chainId", "status", "reason",
            "createdAt", "updatedAt"
          ) VALUES (
            ${crypto.randomUUID()}, ${session.businessId}, ${sessionId}, ${rewardLink.partnerId},
            ${config.CHAIN_ID}, ${REWARD_BLOCKED_POLICY}, ${REWARD_BLOCKED_POLICY_REASON}, ${now}, ${now}
          )
        `;
      }
    }
    return { expired: false as const, selfRedemption, redeemedAt: now };
  });
  if (result.expired) throw new Error('Session expired');
  return { selfRedemption: result.selfRedemption, redeemedAt: result.redeemedAt };
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
