import { prisma } from './sessionService';
import { normalizeAddress } from './sellerAuth';

export type CheckoutActorRole = 'OWNER' | 'OPERATOR';

export interface CheckoutActor {
  walletAddress: string;
  role: CheckoutActorRole;
  operatorId: string | null;
  label: string | null;
  expiresAt: Date | null;
}

export async function resolveCheckoutActor(
  businessId: string,
  walletAddress: string
): Promise<CheckoutActor | null> {
  const normalizedWallet = normalizeAddress(walletAddress);
  const business = await prisma.business.findUnique({
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

  const operator = await prisma.checkoutOperator.findFirst({
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
