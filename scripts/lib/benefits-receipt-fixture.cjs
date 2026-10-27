// T-231b test fixture: builds a complete checkout-proof v2 text (dummy data) for a device-local
// receipt, matching the server derivation (canonical terms JSON + sha256 digest), so the device-side
// verifier accepts it. Shared by browser test scripts; never used by the app.
const { createHash } = require('node:crypto');

function receiptProof(item, { wallet, ruleId = 'rule-fixture', audience, chainId = 1 }) {
  if (!audience) throw new Error('receiptProof needs the expected deployment audience (page host)');
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
    `Nonce: ${createHash('sha256').update(`nonce:${item.sessionId}`).digest('hex')}`,
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

// Shared by the original live smoke and the offline verifier regression.
async function customerHistoryReceiptFixtures({ wallet: receiptWallet, audience, chainId, signMessage }) {
  const validItem = {
    sessionId: 'customer-benefit-redeemed',
    businessId: 'smoke-seller-coffee',
    sellerName: 'IFR Coffee House',
    status: 'REDEEMED',
    discountPercent: 15,
    requiredLockIFR: 1000,
    minIFRHeld: 250,
    lockSource: 'commitment_time_only',
    ruleLabel: 'Premium coffee',
    productName: 'Reserve espresso',
    basePriceMinor: null,
    currency: null,
    expiresAt: '2026-07-19T09:10:00.000Z',
    redeemedAt: '2026-07-19T09:05:00.000Z',
    walletLabel: `${receiptWallet.slice(0, 6)}...${receiptWallet.slice(-4)}`,
    savedAt: '2026-07-19T09:05:30.000Z',
  };
  const tamperedItem = {
    ...validItem,
    sessionId: 'customer-benefit-older',
    businessId: 'smoke-seller-older',
    sellerName: 'Older IFR Studio',
    discountPercent: 10,
    requiredLockIFR: 2500,
    minIFRHeld: 0,
    lockSource: 'ifrlock',
    ruleLabel: 'Studio access',
    productName: 'Member session',
    expiresAt: '2026-07-18T09:10:00.000Z',
    redeemedAt: '2026-07-18T09:05:00.000Z',
    savedAt: '2026-07-18T09:05:30.000Z',
  };
  const validProof = receiptProof(validItem, { wallet: receiptWallet, audience, chainId });
  const tamperedProof = receiptProof(tamperedItem, { wallet: receiptWallet, audience, chainId });
  return [
    { ...validItem, proof: { ...validProof, signature: await signMessage(validProof.message) } },
    // Sign this distinct checkout, then edit only its stored nonce. The signature
    // must mismatch without replaying the valid receipt's signature or nonce.
    {
      ...tamperedItem,
      proof: {
        ...tamperedProof,
        message: tamperedProof.message.replace(
          /^Nonce: [0-9a-f]{64}$/m,
          `Nonce: ${createHash('sha256').update(`tampered:${tamperedItem.sessionId}`).digest('hex')}`
        ),
        signature: await signMessage(tamperedProof.message),
      },
    },
  ];
}

module.exports = { receiptProof, customerHistoryReceiptFixtures };
