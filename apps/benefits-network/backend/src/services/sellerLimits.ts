import { prisma } from './sessionService';
import { config } from '../config';
import { buildSellerBusinessLimitError } from './sellerLimitPolicy';

export async function assertSellerBusinessLimit(ownerAddress: string): Promise<void> {
  const activeBusinessCount = await prisma.business.count({
    where: { ownerAddress, active: true },
  });

  const limitError = buildSellerBusinessLimitError(
    activeBusinessCount,
    config.MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET
  );
  if (limitError) throw limitError;
}
