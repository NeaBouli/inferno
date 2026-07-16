export function buildSellerBusinessLimitError(activeBusinessCount: number, maxActiveBusinesses: number): Error | null {
  if (activeBusinessCount < maxActiveBusinesses) return null;
  return new Error(
    `Seller profile limit reached: ${activeBusinessCount}/${maxActiveBusinesses} active profiles`
  );
}
