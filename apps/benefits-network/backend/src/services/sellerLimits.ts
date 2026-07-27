import type { Prisma } from '@prisma/client';
import { prisma } from './sessionService';
import { config } from '../config';
import {
  buildSellerBusinessLimitError,
  buildSellerBusinessTotalLimitError,
} from './sellerLimitPolicy';

// Acquire SQLite's writer lock before counting so a concurrent create or
// reactivate cannot pass the same cap check before this transaction commits.
async function lockOwnerBusinessRows(
  ownerAddress: string,
  tx: Prisma.TransactionClient
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Business"
    SET "active" = "active"
    WHERE "ownerAddress" = ${ownerAddress}
  `;
}

async function assertSellerBusinessActiveLimit(
  ownerAddress: string,
  tx: Prisma.TransactionClient
): Promise<void> {
  const activeBusinessCount = await tx.business.count({
    where: { ownerAddress, active: true },
  });

  const limitError = buildSellerBusinessLimitError(
    activeBusinessCount,
    config.MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET
  );
  if (limitError) throw limitError;
}

// Active-profile cap only. Reactivation uses this so legacy owners above the
// lifetime cap keep their existing profiles manageable.
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

  await lockOwnerBusinessRows(ownerAddress, tx);
  await assertSellerBusinessActiveLimit(ownerAddress, tx);
}

// Creation enforces the lifetime cap of persisted profiles (including
// deactivated ones) in addition to the active-profile cap.
export async function assertSellerBusinessCreationLimit(
  ownerAddress: string,
  tx: Prisma.TransactionClient
): Promise<void> {
  await lockOwnerBusinessRows(ownerAddress, tx);

  const totalBusinessCount = await tx.business.count({
    where: { ownerAddress },
  });
  const totalLimitError = buildSellerBusinessTotalLimitError(
    totalBusinessCount,
    config.MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET
  );
  if (totalLimitError) throw totalLimitError;

  await assertSellerBusinessActiveLimit(ownerAddress, tx);
}
