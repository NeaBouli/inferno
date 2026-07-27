import type { Prisma } from '@prisma/client';
import { prisma } from './sessionService';
import { config } from '../config';
import { buildSellerBusinessLimitError } from './sellerLimitPolicy';

export async function assertSellerBusinessLimit(
  ownerAddress: string,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (!tx) {
    await prisma.$transaction(async (innerTx) => {
      await assertSellerBusinessLimit(ownerAddress, innerTx);
    });
    return;
  }

  // Acquire SQLite's writer lock before counting so a concurrent create or
  // reactivate cannot pass the same cap check before this transaction commits.
  await tx.$executeRaw`
    UPDATE "Business"
    SET "active" = "active"
    WHERE "ownerAddress" = ${ownerAddress}
  `;
  const activeBusinessCount = await tx.business.count({
    where: { ownerAddress, active: true },
  });

  const limitError = buildSellerBusinessLimitError(
    activeBusinessCount,
    config.MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET
  );
  if (limitError) throw limitError;
}
