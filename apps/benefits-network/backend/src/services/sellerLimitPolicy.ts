export function buildSellerBusinessLimitError(activeBusinessCount: number, maxActiveBusinesses: number): Error | null {
  if (activeBusinessCount < maxActiveBusinesses) return null;
  return new Error(
    `Seller profile limit reached: ${activeBusinessCount}/${maxActiveBusinesses} active profiles`
  );
}

export function buildSellerBusinessTotalLimitError(totalBusinessCount: number, maxTotalBusinesses: number): Error | null {
  if (totalBusinessCount < maxTotalBusinesses) return null;
  return new Error(
    `Seller profile limit reached: ${totalBusinessCount}/${maxTotalBusinesses} total profiles (including deactivated)`
  );
}

export function getSellerBusinessLimitConfigIssue(maxActiveBusinesses: number, maxTotalBusinesses: number): string | null {
  if (maxTotalBusinesses >= maxActiveBusinesses) return null;
  return `MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET (${maxTotalBusinesses}) must be greater than or equal to MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET (${maxActiveBusinesses})`;
}
