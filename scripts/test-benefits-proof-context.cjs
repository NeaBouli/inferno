#!/usr/bin/env node
// Unit test for scripts/check-benefits-proof-context.cjs (fail-closed receipt context release check).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseEnv, parseCompose, checkProofContext } = require('./check-benefits-proof-context.cjs');

const host = 'shop.ifrunit.tech';
const repoCompose = fs.readFileSync(path.join(__dirname, '..', 'apps', 'benefits-network', 'docker-compose.production.example.yml'), 'utf8');
const compose = parseCompose(repoCompose);
assert.deepEqual(compose.chainArg, { variable: true, operator: ':-', default: '1' }, 'repo compose: ${NEXT_PUBLIC_CHAIN_ID:-1}');
assert.deepEqual(compose.problems, [], 'repo compose is structurally supported');
assert.equal(compose.backendOverrides, false);

const check = (envFile, extra = {}) => checkProofContext({ envFile, compose, processEnv: {}, publicHost: host, ...extra });
const ok = { SELLER_AUTH_DOMAIN: host, CHAIN_ID: '1', NEXT_PUBLIC_CHAIN_ID: '1' };
assert.deepEqual(check(ok), []);
assert.deepEqual(check({ SELLER_AUTH_DOMAIN: host, CHAIN_ID: '1' }), [], 'literal compose default 1 applies');
assert.ok(check({ SELLER_AUTH_DOMAIN: host, CHAIN_ID: '11155111' }).length > 0, 'backend Sepolia vs compose default 1 fails');
assert.ok(check({ ...ok, SELLER_AUTH_DOMAIN: 'staging.ifrunit.tech' }).length > 0, 'host mismatch fails');
assert.ok(check({ ...ok, CHAIN_ID: '11155111' }).length > 0, 'chain mismatch fails');
assert.ok(check({ CHAIN_ID: '1' }).length > 0, 'missing domain fails');
assert.ok(check({ SELLER_AUTH_DOMAIN: host }).length > 0, 'missing backend chain fails');
assert.ok(check({ ...ok, NEXT_PUBLIC_CHAIN_ID: 'one' }).length > 0, 'invalid frontend chain fails');
assert.ok(check(ok, { publicHost: undefined }).length > 0, 'missing public host fails (no default)');
// Higher-precedence shell overrides fail closed, whatever their value.
for (const name of ['NEXT_PUBLIC_CHAIN_ID', 'CHAIN_ID', 'SELLER_AUTH_DOMAIN']) {
  assert.ok(check(ok, { processEnv: { [name]: name === 'SELLER_AUTH_DOMAIN' ? host : '1' } }).length > 0, `${name} in the shell fails`);
}
// Compose variants: no default and no value fails; a literal arg wins; backend environment overrides fail.
const frontendArg = (value) => `services:\n  benefits-frontend:\n    build:\n      args:\n        NEXT_PUBLIC_CHAIN_ID: ${value}\n`;
const noDefault = parseCompose(frontendArg('"${NEXT_PUBLIC_CHAIN_ID}"'));
assert.deepEqual(noDefault.problems, []);
assert.ok(checkProofContext({ envFile: { SELLER_AUTH_DOMAIN: host, CHAIN_ID: '1' }, compose: noDefault, processEnv: {}, publicHost: host }).length > 0);
const literal = parseCompose(frontendArg('"11155111"'));
assert.deepEqual(literal, { chainArg: { literal: '11155111' }, backendOverrides: false, problems: [] });
assert.ok(checkProofContext({ envFile: ok, compose: literal, processEnv: {}, publicHost: host }).length > 0, 'literal arg wins over env file');
// Review regression (9b896521): the arg is read only from the benefits-frontend service. An earlier
// service with NEXT_PUBLIC_CHAIN_ID "1" and the frontend on Sepolia must not PASS against backend chain 1.
const twoServices = parseCompose(`services:\n  other:\n    build:\n      args:\n        NEXT_PUBLIC_CHAIN_ID: "1"\n  benefits-frontend:\n    build:\n      args:\n        NEXT_PUBLIC_CHAIN_ID: "11155111"\n`);
assert.ok(checkProofContext({ envFile: ok, compose: twoServices, processEnv: {}, publicHost: host }).length > 0, 'two-service false PASS');
assert.equal(twoServices.chainArg.literal, '11155111', 'frontend value comes from benefits-frontend only');
const wrongNesting = parseCompose(`services:\n  benefits-frontend:\n    environment:\n      NEXT_PUBLIC_CHAIN_ID: "1"\n`);
assert.ok(checkProofContext({ envFile: ok, compose: wrongNesting, processEnv: {}, publicHost: host }).length > 0, 'wrong nesting fails');
const duplicated = parseCompose(`${frontendArg('"1"')}        NEXT_PUBLIC_CHAIN_ID: "11155111"\n`);
assert.ok(checkProofContext({ envFile: ok, compose: duplicated, processEnv: {}, publicHost: host }).length > 0, 'duplicate arg fails');
const aliased = parseCompose(`x-args: &args\n  NEXT_PUBLIC_CHAIN_ID: "1"\nservices:\n  benefits-frontend:\n    build:\n      args: *args\n`);
assert.ok(checkProofContext({ envFile: ok, compose: aliased, processEnv: {}, publicHost: host }).length > 0, 'anchors/aliases fail');
const flowArgs = parseCompose(`services:\n  benefits-frontend:\n    build:\n      args: { NEXT_PUBLIC_CHAIN_ID: "1" }\n`);
assert.ok(checkProofContext({ envFile: ok, compose: flowArgs, processEnv: {}, publicHost: host }).length > 0, 'flow args fail');
// Review regression (c162134d): interpolated key names in environment/args lists cannot be resolved
// statically and must fail closed rather than hide a CHAIN_ID / NEXT_PUBLIC_CHAIN_ID override.
for (const snippet of [
  'services:\n  benefits-backend:\n    environment:\n      - "${K:-CHAIN_ID}=5"\n',
  'services:\n  benefits-backend:\n    environment:\n      - ${K}=5\n',
  'services:\n  benefits-backend:\n    environment:\n      ${K:-SELLER_AUTH_DOMAIN}: "x"\n',
  'services:\n  benefits-frontend:\n    build:\n      args:\n        - "${K:-NEXT_PUBLIC_CHAIN_ID}=1"\n',
]) {
  const parsed = parseCompose(snippet);
  assert.ok(parsed.problems.some((problem) => problem.includes('unsupported YAML')), `interpolated key is refused: ${snippet}`);
}
// Review regression (c162134d): default-operator semantics. `:-` defaults when unset or empty, `-` only
// when unset; an explicitly empty value under `-` stays empty and fails.
for (const [expression, value, expected] of [
  ['"${NEXT_PUBLIC_CHAIN_ID:-1}"', undefined, 'pass'],
  ['"${NEXT_PUBLIC_CHAIN_ID:-1}"', '', 'pass'],
  ['"${NEXT_PUBLIC_CHAIN_ID:-1}"', '11155111', 'fail'],
  ['"${NEXT_PUBLIC_CHAIN_ID-1}"', undefined, 'pass'],
  ['"${NEXT_PUBLIC_CHAIN_ID-1}"', '', 'fail'],
  ['"${NEXT_PUBLIC_CHAIN_ID-1}"', '11155111', 'fail'],
  ['"${NEXT_PUBLIC_CHAIN_ID-1}"', '1', 'pass'],
]) {
  const envFile = { SELLER_AUTH_DOMAIN: host, CHAIN_ID: '1', ...(value === undefined ? {} : { NEXT_PUBLIC_CHAIN_ID: value }) };
  const problems = checkProofContext({ envFile, compose: parseCompose(frontendArg(expression)), processEnv: {}, publicHost: host });
  assert.equal(problems.length === 0 ? 'pass' : 'fail', expected, `${expression} with ${value === undefined ? 'unset' : JSON.stringify(value)}`);
}
const listOverride = parseCompose(`${repoCompose}\n  extra:\n    environment:\n      - "CHAIN_ID=5"\n`);
assert.equal(listOverride.backendOverrides, true, 'list-form environment override detected');
const overridden = parseCompose(`${repoCompose}\n    environment:\n      CHAIN_ID: "5"\n`);
assert.ok(checkProofContext({ envFile: ok, compose: overridden, processEnv: {}, publicHost: host }).length > 0);
assert.ok(checkProofContext({ envFile: ok, compose: parseCompose('services: {}\n'), processEnv: {}, publicHost: host }).length > 0, 'missing build arg fails');
assert.deepEqual(parseEnv('# c\nSELLER_AUTH_DOMAIN="shop.ifrunit.tech"\n CHAIN_ID = 1 \nexport X=2\n'), { SELLER_AUTH_DOMAIN: host, CHAIN_ID: '1', X: '2' });

// CLI, including the review regression: env file CHAIN_ID=1 without NEXT_PUBLIC_CHAIN_ID and an exported
// NEXT_PUBLIC_CHAIN_ID=11155111 in the invoking shell -> FAIL.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benefits-proof-context-'));
try {
  const cleanEnv = { ...process.env };
  for (const name of ['SELLER_AUTH_DOMAIN', 'CHAIN_ID', 'NEXT_PUBLIC_CHAIN_ID']) delete cleanEnv[name];
  const run = (text, { env = cleanEnv, args = ['--public-host', host] } = {}) => {
    const file = path.join(dir, 'env');
    fs.writeFileSync(file, text);
    return spawnSync(process.execPath, [path.join(__dirname, 'check-benefits-proof-context.cjs'), '--env', file, ...args], { encoding: 'utf8', env });
  };
  assert.equal(run('SELLER_AUTH_DOMAIN=shop.ifrunit.tech\nCHAIN_ID=1\n').status, 0);
  const exported = run('SELLER_AUTH_DOMAIN=shop.ifrunit.tech\nCHAIN_ID=1\n', { env: { ...cleanEnv, NEXT_PUBLIC_CHAIN_ID: '11155111' } });
  assert.equal(exported.status, 1, 'an exported NEXT_PUBLIC_CHAIN_ID override must fail');
  assert.ok(!`${exported.stdout}${exported.stderr}`.includes('11155111'), 'values are never printed');
  assert.equal(run('SELLER_AUTH_DOMAIN=shop.ifrunit.tech\nCHAIN_ID=1\n', { args: [] }).status, 1, 'missing --public-host fails');
  const bad = run('SELLER_AUTH_DOMAIN=evil.example\nCHAIN_ID=1\nADMIN_SECRET=do-not-print-me\n');
  assert.equal(bad.status, 1);
  assert.ok(!`${bad.stdout}${bad.stderr}`.includes('evil.example') && !`${bad.stdout}${bad.stderr}`.includes('do-not-print-me'), 'values are never printed');
  assert.equal(spawnSync(process.execPath, [path.join(__dirname, 'check-benefits-proof-context.cjs'), '--env', path.join(dir, 'missing'), '--public-host', host], { env: cleanEnv }).status, 1, 'missing env file fails');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('[benefits-proof-context-test] PASS');
