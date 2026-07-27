import type { Prisma } from '@prisma/client';

// Pauses every dependent that carries live benefit authority so a deactivated
// seller profile cannot leave catalog items, benefit rules or checkout
// operators active. The operator timestamp bump keeps stale owner
// authorizations failing closed against the operator upsert recency guard.
export async function pauseSellerBusinessDependents(
  tx: Prisma.TransactionClient,
  businessId: string,
  pausedAt: Date = new Date()
): Promise<void> {
  await tx.sellerAuthorizationChallenge.updateMany({
    where: {
      businessId,
      action: 'operators:create',
      consumedAt: null,
    },
    data: { consumedAt: pausedAt },
  });
  await tx.benefitRule.updateMany({
    where: { businessId, active: true },
    data: { active: false },
  });
  await tx.product.updateMany({
    where: { businessId, active: true },
    data: { active: false },
  });
  await tx.checkoutOperator.updateMany({
    where: { businessId, active: true },
    data: { active: false, updatedAt: pausedAt },
  });
}
