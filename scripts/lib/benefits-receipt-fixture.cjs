// T-231b test fixture: builds a complete checkout-proof v2 text (dummy data) for a device-local
// receipt, matching the server derivation (canonical terms JSON + sha256 digest), so the device-side
// verifier accepts it. Shared by browser test scripts; never used by the app.
const { createHash } = require('node:crypto');

function receiptProof(item, { wallet, ruleId = 'rule-fixture', audience = 'shop.example.test', chainId = 11155111 }) {
  const terms = {
    benefitRuleId: ruleId,
    label: item.ruleLabel,
    productName: item.productName,
    basePriceMinor: item.basePriceMinor ?? null,
    currency: item.currency ?? null,
    requiredLockIFR: item.requiredLockIFR,
    minIFRHeld: item.minIFRHeld,
    lockSource: item.lockSource,
    discountPercent: item.discountPercent,
  };
  const termsDigest = `sha256:${createHash('sha256').update(JSON.stringify(terms)).digest('hex')}`;
  const message = [
    'IFR Benefits Network - Checkout Proof',
    'Version: ifr-benefits/checkout-proof/2',
    'Purpose: Redeem this one checkout with verified IFR benefit eligibility',
    `Wallet: ${wallet}`,
    `Audience: ${audience}`,
    `Chain ID: ${chainId}`,
    `Shop: ${item.businessId}`,
    `Session: ${item.sessionId}`,
    `Nonce: ${'ab'.repeat(32)}`,
    `Expires: ${new Date(item.expiresAt).toISOString()}`,
    `Benefit Rule: ${terms.benefitRuleId}`,
    `Benefit: ${terms.label}`,
    `Product: ${terms.productName}`,
    ...(terms.basePriceMinor !== null && terms.currency !== null
      ? [`Reference Price: ${terms.currency} ${terms.basePriceMinor} minor units`]
      : []),
    `Required Lock IFR: ${terms.requiredLockIFR}`,
    `Minimum Held IFR: ${terms.minIFRHeld}`,
    `Lock Source: ${terms.lockSource}`,
    `Discount Percent: ${terms.discountPercent}`,
    `Terms Digest: ${termsDigest}`,
    'This signature redeems this checkout only. It does not move tokens. The wallet is checked in this request and not stored.',
  ].join('\n');
  return { version: 'ifr-benefits/checkout-proof/2', termsDigest, message };
}

module.exports = { receiptProof };
