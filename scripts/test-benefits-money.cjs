#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../apps/benefits-network/frontend/node_modules/typescript');

function loadTypeScriptModule(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourcePath,
  }).outputText;
  const compiled = { exports: {} };
  new Function('exports', 'module', output)(compiled.exports, compiled);
  return compiled.exports;
}

const frontendMoney = loadTypeScriptModule(path.join(
  __dirname,
  '..',
  'apps',
  'benefits-network',
  'frontend',
  'src',
  'lib',
  'money.ts'
));
const backendMoney = loadTypeScriptModule(path.join(
  __dirname,
  '..',
  'apps',
  'benefits-network',
  'backend',
  'src',
  'services',
  'productPrice.ts'
));

const {
  formatProductPrice,
  majorPriceToMinor,
  minorPriceToMajor,
  productCurrencies,
} = frontendMoney;

assert.deepEqual(
  productCurrencies,
  backendMoney.SUPPORTED_PRODUCT_CURRENCIES,
  'frontend and backend product currency allowlists must remain identical'
);

assert.equal(majorPriceToMinor('19.99', 'EUR'), '1999');
assert.equal(majorPriceToMinor('0.5', 'USD'), '50');
assert.equal(majorPriceToMinor('0', 'EUR'), '0');
assert.equal(majorPriceToMinor('2500', 'JPY'), '2500');
assert.equal(majorPriceToMinor('2500.00', 'JPY'), null);
assert.equal(majorPriceToMinor('01.00', 'EUR'), null);
assert.equal(majorPriceToMinor('9999999999999999.99', 'USD'), '999999999999999999');
assert.equal(majorPriceToMinor('99999999999999999.99', 'USD'), null);

assert.equal(minorPriceToMajor('0', 'EUR'), '0.00');
assert.equal(minorPriceToMajor('50', 'USD'), '0.50');
assert.equal(minorPriceToMajor('2500', 'JPY'), '2500');
assert.equal(formatProductPrice('999999999999999999', 'USD'), 'USD 9,999,999,999,999,999.99');
assert.equal(formatProductPrice('0', 'EUR'), 'EUR 0.00');
assert.equal(formatProductPrice('01999', 'EUR'), null);
assert.equal(formatProductPrice('1999', null), null);

console.log('[benefits-money] PASS - exact minor-unit conversion and formatting');
