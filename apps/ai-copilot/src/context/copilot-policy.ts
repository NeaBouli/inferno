export const IFR_DECIMALS = 9;
export const IFR_BASE_UNITS_PER_TOKEN = 10n ** BigInt(IFR_DECIMALS);

export const COPILOT_MESSAGE_LIMIT = 20;

// Project default tier preset (owner decision 2026-10-03): IFR locked in IFRLock only, identical to the
// Benefits network preset and ifr-sdk DEFAULT_TIERS. A default and label set, not a rule: partners set
// their own thresholds and discounts per benefit. Replaces the former Basic/Premium/Pro 500/2,000/10,000.
export const ACCESS_TIERS = [
  { id: 1, name: "Bronze", minIFR: 1_000 },
  { id: 2, name: "Silver", minIFR: 2_500 },
  { id: 3, name: "Gold", minIFR: 5_000 },
  { id: 4, name: "Platinum", minIFR: 10_000 },
] as const;

export interface ResolvedAccessTier {
  readonly id: number;
  readonly name: "None" | (typeof ACCESS_TIERS)[number]["name"];
  readonly minIFR: number;
}

export const ACCESS_TIER_SUMMARY = ACCESS_TIERS
  .map((tier) => `${tier.name} >=${tier.minIFR.toLocaleString("en-US")} IFR locked`)
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
