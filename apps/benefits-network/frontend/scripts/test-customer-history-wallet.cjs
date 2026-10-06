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

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'customerHistory.ts');
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', 'require', transpile(sourcePath))(
  moduleUnderTest,
  moduleUnderTest.exports,
  (specifier) => {
    if (specifier === '@/lib/money') return moneyModule.exports;
    if (specifier === '@/lib/lockSource') return lockSourceModule.exports;
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
  const customer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
  const stranger = privateKeyToAccount(`0x${'22'.repeat(32)}`);
  const termsDigest = `sha256:${'ab'.repeat(32)}`;
  const message = [
    'IFR Benefits Network - Checkout Proof',
    `Version: ${CHECKOUT_PROOF_VERSION_LABEL}`,
    'Purpose: Redeem this one checkout with verified IFR benefit eligibility',
    `Wallet: ${customer.address}`,
    'Audience: shop.example.test',
    'Chain ID: 11155111',
    'Shop: business-1',
    'Session: session-3',
    `Terms Digest: ${termsDigest}`,
  ].join('\n');
  const recover = (text, signature) => recoverMessageAddress({ message: text, signature });
  const signature = await customer.signMessage({ message });
  saveCustomerProofHistoryItem({
    sessionId: 'session-3',
    status: { ...status, status: 'REDEEMED', redeemedAt: '2026-07-20T00:00:00.000Z' },
    verifiedWalletAddress: customer.address,
    proof: { version: CHECKOUT_PROOF_VERSION_LABEL, termsDigest, message, signature },
  });
  const stored = readCustomerProofHistory().find((item) => item.sessionId === 'session-3');
  assert.ok(stored.proof, 'A redeemed proof must keep its device-local receipt.');
  const verified = await verifyCustomerProofReceipt(stored, recover);
  assert.deepStrictEqual(verified, { ok: true, wallet: customer.address });

  const wrongSigner = await verifyCustomerProofReceipt(
    { ...stored, proof: { ...stored.proof, signature: await stranger.signMessage({ message }) } },
    recover
  );
  assert.strictEqual(wrongSigner.ok, false, 'A signature by another wallet must not verify.');

  const otherCheckout = await verifyCustomerProofReceipt({ ...stored, sessionId: 'session-9' }, recover);
  assert.strictEqual(otherCheckout.ok, false, 'A receipt must not verify for another checkout.');

  const tampered = await verifyCustomerProofReceipt(
    { ...stored, proof: { ...stored.proof, message: message.replace('Shop: business-1', 'Shop: business-2') } },
    recover
  );
  assert.strictEqual(tampered.ok, false, 'Edited signed text must not verify.');

  const labelOnly = await verifyCustomerProofReceipt({ ...stored, proof: null }, recover);
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
