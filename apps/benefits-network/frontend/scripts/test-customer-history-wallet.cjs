#!/usr/bin/env node

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'customerHistory.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    strict: true,
  },
  fileName: sourcePath,
});
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', transpiled.outputText)(moduleUnderTest, moduleUnderTest.exports);

const { readCustomerProofHistory, redactVerifiedAddress, saveCustomerProofHistoryItem } = moduleUnderTest.exports;
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
    label: 'Access',
    productName: 'Service',
  },
};

saveCustomerProofHistoryItem({
  sessionId: 'session-1',
  status,
  verifiedWalletAddress: walletA,
});
assert.strictEqual(readCustomerProofHistory()[0].walletLabel, redactVerifiedAddress(walletA));

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

console.log('[customer-history-wallet-test] PASS');
