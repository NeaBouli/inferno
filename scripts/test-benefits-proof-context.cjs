#!/usr/bin/env node
// Unit test for scripts/check-benefits-proof-context.cjs (fail-closed receipt context release check).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseEnv, checkProofContext } = require('./check-benefits-proof-context.cjs');

const host = 'shop.ifrunit.tech';
const ok = { SELLER_AUTH_DOMAIN: host, CHAIN_ID: '1', NEXT_PUBLIC_CHAIN_ID: '1' };
assert.deepEqual(checkProofContext(ok, host), []);
assert.deepEqual(checkProofContext({ SELLER_AUTH_DOMAIN: host, CHAIN_ID: '1' }, host), [], 'compose default NEXT_PUBLIC_CHAIN_ID=1');
assert.ok(checkProofContext({ ...ok, SELLER_AUTH_DOMAIN: 'staging.ifrunit.tech' }, host).length > 0, 'host mismatch fails');
assert.ok(checkProofContext({ ...ok, CHAIN_ID: '11155111' }, host).length > 0, 'chain mismatch fails');
assert.ok(checkProofContext({ SELLER_AUTH_DOMAIN: host, CHAIN_ID: '11155111' }, host).length > 0, 'backend Sepolia vs frontend default 1 fails');
assert.ok(checkProofContext({ CHAIN_ID: '1' }, host).length > 0, 'missing domain fails');
assert.ok(checkProofContext({ SELLER_AUTH_DOMAIN: host }, host).length > 0, 'missing chain fails');
assert.ok(checkProofContext({ ...ok, NEXT_PUBLIC_CHAIN_ID: 'one' }, host).length > 0, 'invalid frontend chain fails');
assert.ok(checkProofContext(ok, '').length > 0, 'missing public host fails');
assert.deepEqual(parseEnv('# c\nSELLER_AUTH_DOMAIN="shop.ifrunit.tech"\n CHAIN_ID = 1 \n'), { SELLER_AUTH_DOMAIN: host, CHAIN_ID: '1' });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benefits-proof-context-'));
try {
  const run = (text, extra = []) => {
    const file = path.join(dir, 'env');
    fs.writeFileSync(file, text);
    return spawnSync(process.execPath, [path.join(__dirname, 'check-benefits-proof-context.cjs'), '--env', file, ...extra], { encoding: 'utf8' });
  };
  assert.equal(run('SELLER_AUTH_DOMAIN=shop.ifrunit.tech\nCHAIN_ID=1\n').status, 0);
  const bad = run('SELLER_AUTH_DOMAIN=evil.example\nCHAIN_ID=1\nADMIN_SECRET=do-not-print-me\n');
  assert.equal(bad.status, 1);
  assert.ok(!`${bad.stdout}${bad.stderr}`.includes('evil.example') && !`${bad.stdout}${bad.stderr}`.includes('do-not-print-me'), 'values are never printed');
  assert.equal(spawnSync(process.execPath, [path.join(__dirname, 'check-benefits-proof-context.cjs'), '--env', path.join(dir, 'missing')]).status, 1, 'missing env file fails');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('[benefits-proof-context-test] PASS');
