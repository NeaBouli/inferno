#!/usr/bin/env node

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const serverPath = path.join(__dirname, '..', 'server', 'index.ts');
const source = fs.readFileSync(serverPath, 'utf8');

for (const surface of ['landing', 'web3', 'benefits']) {
  assert.match(source, new RegExp(`${surface}: ["']`), `Missing ${surface} copilot context.`);
}

assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\('surface'\)/);
assert.match(source, /surfaceHelp\[surface\]/);
assert.match(source, /surfaceLabels\[surface\]/);
assert.match(source, /messages: histories\[currentMode\], mode: currentMode, surface: surface/);
assert.match(source, /customer-pass/);
assert.match(source, /one-time redeem/);
assert.doesNotMatch(source, /Connect Wallet \(coming soon\)/);
assert.match(source, /Bootstrap Event ended June 5, 2026\. IFR now live on Uniswap/);

console.log('[copilot-surface-ui-test] PASS');
