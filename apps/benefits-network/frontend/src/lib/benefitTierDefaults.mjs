import tierFile from './ifr-tiers.v1.json' with { type: 'json' };

// Whole-token form defaults only. Eligibility/base-unit arithmetic stays in bigint.
// Reject values the existing numeric form/API cannot represent exactly rather than rounding.
export const benefitTierDefaults = tierFile.tiers.map((tier) => {
  const wholeIFR = BigInt(tier.minIFR);
  if (wholeIFR <= 0n || wholeIFR > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Tier ${tier.key} cannot be represented as an exact whole-IFR form default`);
  }
  return { label: tier.label, minLocked: Number(wholeIFR) };
});
