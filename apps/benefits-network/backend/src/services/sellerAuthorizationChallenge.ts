import crypto from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { SellerAuthError } from './sellerAuth';
export {
  MUTATING_SELLER_ACTIONS,
  READ_ONLY_SELLER_ACTIONS,
  isKnownSellerAction,
  isSafeSellerAuthorizationField,
  requiresSingleUseSellerChallenge,
} from './sellerAuthorizationActions';

type ChallengeConsumer = {
  sellerAuthorizationChallenge: {
    updateMany(
      args: Prisma.SellerAuthorizationChallengeUpdateManyArgs
    ): Promise<Prisma.BatchPayload>;
  };
};

export async function issueSellerAuthorizationChallenge(
  db: PrismaClient,
  input: {
    walletAddress: string;
    action: string;
    businessId: string;
    scope: string;
    expiresAt: Date;
  }
) {
  const nonce = crypto.randomBytes(32).toString('hex');
  await db.$transaction([
    db.sellerAuthorizationChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }),
    db.sellerAuthorizationChallenge.create({
      data: { nonce, ...input },
    }),
  ]);
  return nonce;
}

export async function consumeSellerAuthorizationChallenge(
  db: ChallengeConsumer,
  input: {
    nonce: string;
    walletAddress: string;
    action: string;
    businessId: string;
    scope: string;
  }
) {
  const now = new Date();
  const consumed = await db.sellerAuthorizationChallenge.updateMany({
    where: {
      ...input,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    throw new SellerAuthError('Seller authorization challenge is invalid, expired, or already used');
  }
}
