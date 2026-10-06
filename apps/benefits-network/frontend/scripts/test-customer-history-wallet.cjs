#!/usr/bin/env node

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function transpile(sourcePath) {
  return ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText;
}

const moneyModule = { exports: {} };
const moneyPath = path.join(__dirname, '..', 'src', 'lib', 'money.ts');
new Function('module', 'exports', 'require', transpile(moneyPath))(
  moneyModule,
  moneyModule.exports,
  require
);

const lockSourceModule = { exports: {} };
const lockSourcePath = path.join(__dirname, '..', 'src', 'lib', 'lockSource.ts');
new Function('module', 'exports', 'require', transpile(lockSourcePath))(
  lockSourceModule,
  lockSourceModule.exports,
  require
);

const checkoutProofModule = { exports: {} };
const checkoutProofPath = path.join(__dirname, '..', 'src', 'lib', 'checkoutProof.ts');
new Function('module', 'exports', 'require', transpile(checkoutProofPath))(
  checkoutProofModule,
  checkoutProofModule.exports,
  require
);

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'customerHistory.ts');
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', 'require', transpile(sourcePath))(
  moduleUnderTest,
  moduleUnderTest.exports,
  (specifier) => {
    if (specifier === '@/lib/money') return moneyModule.exports;
    if (specifier === '@/lib/lockSource') return lockSourceModule.exports;
    if (specifier === '@/lib/checkoutProof') return checkoutProofModule.exports;
    throw new Error(`Unexpected test import: ${specifier}`);
  }
);

const { readCustomerProofHistory, redactVerifiedAddress, saveCustomerProofHistoryItem } = moduleUnderTest.exports;
const { sumPreviewTimeOnlyTranches } = lockSourceModule.exports;
const values = new Map();
global.window = {
  localStorage: {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  },
};

const walletA = '0x1111111111111111111111111111111111111111';
const walletB = '0x2222222222222222222222222222222222222222';
const status = {
  businessId: 'business-1',
  status: 'APPROVED',
  expiresAt: '2026-07-20T00:00:00.000Z',
  redeemedAt: null,
  benefit: {
    discountPercent: 10,
    requiredLockIFR: 1000,
    minIFRHeld: 0,
    lockSource: 'commitment_time_only',
    label: 'Access',
    productName: 'Service',
    basePriceMinor: '1999',
    currency: 'EUR',
  },
};

assert.strictEqual(
  sumPreviewTimeOnlyTranches([
    { amount: 600n, cType: 0, unlocked: false },
    { amount: 400n, cType: 0, unlocked: false },
    { amount: 9000n, cType: 1, unlocked: false },
    { amount: 500n, cType: 0, unlocked: true },
  ]),
  1000n,
  'Only active TIME_ONLY commitments may count in the wallet preview.'
);
assert.strictEqual(sumPreviewTimeOnlyTranches([{ amount: 1n, cType: 4, unlocked: false }]), null);
assert.strictEqual(
  sumPreviewTimeOnlyTranches(Array.from({ length: 51 }, () => ({ amount: 1n, cType: 0, unlocked: false }))),
  null
);

saveCustomerProofHistoryItem({
  sessionId: 'session-1',
  status,
  verifiedWalletAddress: walletA,
});
assert.strictEqual(readCustomerProofHistory()[0].walletLabel, redactVerifiedAddress(walletA));
assert.strictEqual(readCustomerProofHistory()[0].basePriceMinor, '1999');
assert.strictEqual(readCustomerProofHistory()[0].currency, 'EUR');
assert.strictEqual(readCustomerProofHistory()[0].lockSource, 'commitment_time_only');

saveCustomerProofHistoryItem({
  sessionId: 'session-1',
  status,
});
assert.strictEqual(
  readCustomerProofHistory()[0].walletLabel,
  redactVerifiedAddress(walletA),
  'Reloading without a direct attest result must preserve the previously verified wallet label.'
);
assert.notStrictEqual(
  readCustomerProofHistory()[0].walletLabel,
  redactVerifiedAddress(walletB),
  'A newly connected wallet must not be attributed to an existing proof.'
);

saveCustomerProofHistoryItem({
  sessionId: 'session-2',
  status,
});
assert.strictEqual(
  readCustomerProofHistory().find((item) => item.sessionId === 'session-2').walletLabel,
  'not verified',
  'A public proof loaded without its direct attest response must remain private.'
);

// ── T-231b: device-local receipts verify offline against the full address in the signed text ──
const { verifyCustomerProofReceipt, CHECKOUT_PROOF_VERSION_LABEL } = moduleUnderTest.exports;
const { recoverMessageAddress } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

(async () => {
  const crypto = require('node:crypto');
  const { canonicalTermsJson } = checkoutProofModule.exports;
  const customer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const stranger = privateKeyToAccount(`0x${'22'.repeat(32)}`);
  const terms = {
    benefitRuleId: 'rule-1', label: 'Espresso deal', productName: 'Espresso', basePriceMinor: '350', currency: 'EUR',
    requiredLockIFR: 1000, minIFRHeld: 0, lockSource: 'ifrlock', discountPercent: 10,
  };
  const sha256Hex = async (text) => crypto.createHash('sha256').update(text).digest('hex');
  const termsDigest = `sha256:${await sha256Hex(canonicalTermsJson(terms))}`;
  const buildMessage = (overrides = {}) => {
    const t = { ...terms, ...overrides };
    return [
      'IFR Benefits Network - Checkout Proof',
      `Version: ${CHECKOUT_PROOF_VERSION_LABEL}`,
      'Purpose: Redeem this one checkout with verified IFR benefit eligibility',
      `Wallet: ${customer.address}`,
      'Audience: shop.example.test',
      'Chain ID: 11155111',
      'Shop: business-1',
      'Session: session-3',
      'Nonce: ' + 'ab'.repeat(32),
      'Expires: 2026-10-06T10:00:00.000Z',
      `Benefit Rule: ${t.benefitRuleId}`,
      `Benefit: ${t.label}`,
      `Product: ${t.productName}`,
      `Reference Price: ${t.currency} ${t.basePriceMinor} minor units`,
      `Required Lock IFR: ${t.requiredLockIFR}`,
      `Minimum Held IFR: ${t.minIFRHeld}`,
      `Lock Source: ${t.lockSource}`,
      `Discount Percent: ${t.discountPercent}`,
      `Terms Digest: ${termsDigest}`,
      'This signature redeems this checkout only. It does not move tokens. The wallet is checked in this request and not stored.',
    ].join('\n');
  };
  const message = buildMessage();
  const recover = (text, signature) => recoverMessageAddress({ message: text, signature });
  const verifier = { recover, sha256Hex };
  const signature = await customer.signMessage({ message });
  saveCustomerProofHistoryItem({
    sessionId: 'session-3',
    // The server status object carries different (unsigned) display values; the signed text wins.
    status: { ...status, status: 'REDEEMED', redeemedAt: '2026-10-06T09:58:00.000Z' },
    verifiedWalletAddress: customer.address,
    proof: { version: CHECKOUT_PROOF_VERSION_LABEL, termsDigest, message, signature },
  });
  const stored = readCustomerProofHistory().find((item) => item.sessionId === 'session-3');
  assert.ok(stored.proof, 'A redeemed proof must keep its device-local receipt.');
  assert.strictEqual(stored.discountPercent, 10, 'Displayed terms are derived from the signed text.');
  assert.strictEqual(stored.ruleLabel, 'Espresso deal');
  assert.strictEqual(stored.businessId, 'business-1');
  assert.strictEqual(stored.expiresAt, '2026-10-06T10:00:00.000Z');
  const verified = await verifyCustomerProofReceipt(stored, verifier);
  assert.strictEqual(verified.ok, true, verified.reason);
  assert.strictEqual(verified.wallet, customer.address);

  // Unsigned local notes may change without making the signed terms invalid; they are never
  // reported as verified (the result carries only the signed payload).
  const statusEdited = await verifyCustomerProofReceipt({ ...stored, status: 'EXPIRED', redeemedAt: null, sellerName: 'x' }, verifier);
  assert.strictEqual(statusEdited.ok, true);
  assert.ok(!('status' in statusEdited) && !('redeemedAt' in statusEdited), 'Status/time are not part of a verified result.');

  for (const [field, value] of [
    ['discountPercent', 50], ['requiredLockIFR', 1], ['minIFRHeld', 5], ['lockSource', 'either'],
    ['ruleLabel', 'Other'], ['productName', 'Latte'], ['basePriceMinor', '1'], ['currency', 'USD'],
    ['expiresAt', '2099-01-01T00:00:00.000Z'], ['businessId', 'business-2'], ['sessionId', 'session-9'],
    ['walletLabel', '0x2222...2222'],
  ]) {
    const result = await verifyCustomerProofReceipt({ ...stored, [field]: value }, verifier);
    assert.strictEqual(result.ok, false, `A tampered displayed ${field} must make the receipt invalid.`);
  }

  const wrongSigner = await verifyCustomerProofReceipt(
    { ...stored, proof: { ...stored.proof, signature: await stranger.signMessage({ message }) } },
    verifier
  );
  assert.strictEqual(wrongSigner.ok, false, 'A signature by another wallet must not verify.');

  const tamperedText = await verifyCustomerProofReceipt(
    { ...stored, proof: { ...stored.proof, message: message.replace('Discount Percent: 10', 'Discount Percent: 90') } },
    verifier
  );
  assert.strictEqual(tamperedText.ok, false, 'Edited signed text must not verify (digest).');

  const selfConsistentForgery = buildMessage({ discountPercent: 90 });
  const forged = await verifyCustomerProofReceipt(
    { ...stored, discountPercent: 90, proof: { ...stored.proof, message: selfConsistentForgery } },
    verifier
  );
  assert.strictEqual(forged.ok, false, 'Changed terms with the old digest must not verify.');

  const labelOnly = await verifyCustomerProofReceipt({ ...stored, proof: null }, verifier);
  assert.strictEqual(labelOnly.ok, false, 'A redacted wallet label alone is never a verification input.');

  window.localStorage.setItem('ifr.shop.customerProofHistory.v1', JSON.stringify([
    { ...stored, proof: { ...stored.proof, signature: 'not-a-signature' } },
  ]));
  assert.strictEqual(readCustomerProofHistory()[0].proof, null, 'Malformed stored proofs are dropped.');

  console.log('[customer-history-wallet-test] PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
