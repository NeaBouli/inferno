#!/usr/bin/env node

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'customerProofLink.ts');
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

const {
  CANONICAL_SHOP_ORIGIN,
  parseCustomerProofManualInput,
  parseCustomerProofQrPayload,
} = moduleUnderTest.exports;

const sessionId = 'cm1234567890abcdefghijkl';
const expected = { ok: true, sessionId, path: `/r/${sessionId}` };

assert.strictEqual(CANONICAL_SHOP_ORIGIN, 'https://shop.ifrunit.tech');
assert.deepStrictEqual(
  parseCustomerProofQrPayload(`https://shop.ifrunit.tech/r/${sessionId}`),
  expected
);
assert.deepStrictEqual(parseCustomerProofQrPayload(`/r/${sessionId}`), expected);
assert.deepStrictEqual(
  parseCustomerProofQrPayload(`http://localhost:3000/r/${sessionId}`, 'http://localhost:3000'),
  expected
);
assert.deepStrictEqual(parseCustomerProofManualInput(sessionId), expected);
assert.deepStrictEqual(parseCustomerProofManualInput(`Session: ${sessionId}`), expected);
assert.deepStrictEqual(
  parseCustomerProofManualInput(`https://shop.ifrunit.tech/r/${sessionId}`),
  expected
);

const rejectedQrValues = [
  '',
  sessionId,
  `https://evil.example/r/${sessionId}`,
  `http://shop.ifrunit.tech/r/${sessionId}`,
  `https://shop.ifrunit.tech:444/r/${sessionId}`,
  `https://user:pass@shop.ifrunit.tech/r/${sessionId}`,
  `https://shop.ifrunit.tech/r/${sessionId}?next=https://evil.example`,
  `https://shop.ifrunit.tech/r/${sessionId}#proof`,
  `https://shop.ifrunit.tech/r/${sessionId}/extra`,
  `//shop.ifrunit.tech/r/${sessionId}`,
  `https://shop.ifrunit.tech.evil.example/r/${sessionId}`,
  `https://shop.ifrunit.tech@evil.example/r/${sessionId}`,
  `https://shop.ifrunit.tech/r/%63m1234567890abcdefghijkl`,
  `https://shop.ifrunit.tech//r/${sessionId}`,
  'https://shop.ifrunit.tech/r/short',
  `https://shop.ifrunit.tech/b/${sessionId}`,
  `https://preview.example/r/${sessionId}`,
  `https://shop.ifrunit.tech/r/${'a'.repeat(40)}`,
  'x'.repeat(2049),
];

for (const value of rejectedQrValues) {
  assert.strictEqual(
    parseCustomerProofQrPayload(value, 'https://preview.example').ok,
    false,
    `Expected QR payload to be rejected: ${value.slice(0, 90)}`
  );
}

const rejectedManualValues = [
  '',
  'short',
  'Session: short',
  `https://evil.example/r/${sessionId}`,
  `http://shop.ifrunit.tech/r/${sessionId}`,
  `https://shop.ifrunit.tech/r/${sessionId}?tracking=1`,
  `https://shop.ifrunit.tech/r/${sessionId}#tracking`,
  `//shop.ifrunit.tech/r/${sessionId}`,
  `https://shop.ifrunit.tech.evil.example/r/${sessionId}`,
  `https://shop.ifrunit.tech@evil.example/r/${sessionId}`,
  `https://shop.ifrunit.tech//r/${sessionId}`,
  'x'.repeat(2049),
];

for (const value of rejectedManualValues) {
  assert.strictEqual(
    parseCustomerProofManualInput(value).ok,
    false,
    `Expected manual value to be rejected: ${value.slice(0, 90)}`
  );
}

console.log('[customer-proof-link-test] PASS');
