import crypto from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { SellerAuthError } from './sellerAuth';
export {
  MUTATING_SELLER_ACTIONS,
  READ_ONLY_SELLER_ACTIONS,
  READ_ONLY_SELLER_SCOPE,
  isKnownSellerAction,
  isReadOnlySellerAction,
  isSafeSellerAuthorizationField,
  requiresSingleUseSellerChallenge,
} from './sellerAuthorizationActions';

// Opportunistic cleanup on issuance is bounded; bulk pruning stays in the retention CLI.
export const SELLER_CHALLENGE_PRUNE_BATCH = 100;

type ChallengeConsumer = {
  sellerAuthorizationChallenge: {
    updateMany(
      args: Prisma.SellerAuthorizationChallengeUpdateManyArgs
    ): Promise<Prisma.BatchPayload>;
  };
};

/**
 * Issues a nonce-only seller challenge (owner decision B). Stored: a random 32-byte nonce, action,
 * business, scope and expiry - never a wallet address, hash or other wallet-derived value. The signer
 * is bound later only by the signature over the server-built message.
 */
export async function issueSellerAuthorizationChallenge(
  db: PrismaClient,
  input: {
    action: string;
    businessId: string;
    scope: string;
    expiresAt: Date;
  }
) {
  const nonce = crypto.randomBytes(32).toString('hex');
  await db.$transaction(async (tx) => {
    const now = new Date();
    const expired = await tx.sellerAuthorizationChallenge.findMany({
      where: { expiresAt: { lt: now } },
      orderBy: [{ expiresAt: 'asc' }, { nonce: 'asc' }],
      take: SELLER_CHALLENGE_PRUNE_BATCH,
      select: { nonce: true },
    });
    if (expired.length > 0) {
      await tx.sellerAuthorizationChallenge.deleteMany({
        where: { nonce: { in: expired.map((row) => row.nonce) }, expiresAt: { lt: now } },
      });
    }
    await tx.sellerAuthorizationChallenge.create({
      data: {
        nonce,
        action: input.action,
        businessId: input.businessId,
        scope: input.scope,
        expiresAt: input.expiresAt,
      },
    });
  });
  return nonce;
}

/**
 * Atomically consumes a challenge matching {nonce, action, business, scope, unconsumed, unexpired}.
 * There is no wallet predicate: the caller must already have recovered the signer from a signature
 * over the message for exactly this nonce/action/business/scope and authorizes that signer itself.
 */
export async function consumeSellerAuthorizationChallenge(
  db: ChallengeConsumer,
  input: {
    nonce: string;
    action: string;
    businessId: string;
    scope: string;
  }
) {
  const now = new Date();
  const consumed = await db.sellerAuthorizationChallenge.updateMany({
    where: {
      nonce: input.nonce,
      action: input.action,
      businessId: input.businessId,
      scope: input.scope,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    throw new SellerAuthError('Seller authorization challenge is invalid, expired, or already used');
  }
}
