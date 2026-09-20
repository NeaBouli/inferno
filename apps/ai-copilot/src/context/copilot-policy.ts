export const IFR_DECIMALS = 9;
export const IFR_BASE_UNITS_PER_TOKEN = 10n ** BigInt(IFR_DECIMALS);

export const COPILOT_MESSAGE_LIMIT = 20;

export const ACCESS_TIERS = [
  { id: 1, name: "Basic", minIFR: 500 },
  { id: 2, name: "Premium", minIFR: 2_000 },
  { id: 3, name: "Pro", minIFR: 10_000 },
] as const;

export interface ResolvedAccessTier {
  readonly id: number;
  readonly name: "None" | (typeof ACCESS_TIERS)[number]["name"];
  readonly minIFR: number;
}

export const ACCESS_TIER_SUMMARY = ACCESS_TIERS
  .map((tier) => `${tier.name} >=${tier.minIFR.toLocaleString("en-US")} IFR`)
  .join(", ");

export function getAccessTier(totalBaseUnits: bigint): ResolvedAccessTier {
  if (totalBaseUnits < 0n) {
    throw new RangeError("IFR base-unit amount cannot be negative");
  }

  for (let index = ACCESS_TIERS.length - 1; index >= 0; index -= 1) {
    const tier = ACCESS_TIERS[index];
    const threshold = BigInt(tier.minIFR) * IFR_BASE_UNITS_PER_TOKEN;
    if (totalBaseUnits >= threshold) {
      return tier;
    }
  }

  return { id: 0, name: "None", minIFR: 0 };
}
