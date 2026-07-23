#!/usr/bin/env node

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'customerProofGuidance.ts');
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

const { formatRetryGuidance } = moduleUnderTest.exports;
const heldOnlyReason = 'Insufficient wallet balance: 499.999999999 IFR held < 500 IFR required. Keep more IFR in this wallet and retry this QR session.';

assert.strictEqual(
  formatRetryGuidance(heldOnlyReason, 2),
  `${heldOnlyReason} 2 verification attempts left.`
);
assert.ok(!formatRetryGuidance(heldOnlyReason, 2).includes('locking more IFR'));
assert.strictEqual(
  formatRetryGuidance('Insufficient lock. Lock more IFR and retry this QR session.', 1),
  'Insufficient lock. Lock more IFR and retry this QR session. 1 verification attempt left.'
);
assert.strictEqual(
  formatRetryGuidance(null, 0),
  'This wallet does not meet the current IFR requirements.'
);

console.log('[customer-proof-guidance-test] PASS');
