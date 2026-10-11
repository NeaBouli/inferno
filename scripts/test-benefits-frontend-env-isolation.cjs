#!/usr/bin/env node
'use strict';

// External audit IFRUNIT 2026-10-11 (IFR-DEV-04): the Benefits frontend must not inherit the
// backend env file. `.env.benefits` holds backend-only settings (admin secret, RPC and signer
// configuration); the frontend needs only its build args (NEXT_PUBLIC_*, inlined at build time)
// and the internal API URL at runtime. Reads committed files only, never an env file.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const COMPOSE = 'apps/benefits-network/docker-compose.production.example.yml';
const FRONTEND = 'apps/benefits-network/frontend';
const RUNTIME_KEYS = new Set(['BENEFITS_API_INTERNAL_URL', 'HOSTNAME', 'PORT']);
const SOURCE_KEYS = /^(?:BENEFITS_API_INTERNAL_URL|NODE_ENV|NEXT_PUBLIC_[A-Z0-9_]+)$/;

function serviceBlock(compose, name) {
  const lines = compose.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.ok(start >= 0 && lines.indexOf(`  ${name}:`, start + 1) === -1, `${name}: exactly one service block`);
  const end = lines.findIndex((line, index) => index > start && /^ {0,2}\S/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function mapKeys(block, key) {
  const start = block.findIndex((line) => line === `    ${key}:`);
  if (start === -1) return null;
  const keys = [];
  for (const line of block.slice(start + 1)) {
    if (!/^ {6}/.test(line)) break;
    const match = line.match(/^ {6}([A-Za-z_][A-Za-z0-9_]*):/);
    assert.ok(match, `${key}: only a key: value map is supported`);
    keys.push(match[1]);
  }
  return keys;
}

function checkCompose(compose) {
  const frontend = serviceBlock(compose, 'benefits-frontend');
  const backend = serviceBlock(compose, 'benefits-backend');
  assert.ok(!frontend.some((line) => /^\s+env_file\s*:/.test(line)), 'benefits-frontend must not use env_file');
  assert.ok(backend.some((line) => line === '    env_file:'), 'benefits-backend keeps its env_file');
  const runtime = mapKeys(frontend, 'environment');
  assert.ok(runtime, 'benefits-frontend needs an explicit environment map');
  for (const key of runtime) assert.ok(RUNTIME_KEYS.has(key), `benefits-frontend runtime key not allowed: ${key}`);
  assert.ok(runtime.includes('BENEFITS_API_INTERNAL_URL'), 'benefits-frontend needs BENEFITS_API_INTERNAL_URL');
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'out', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function checkSource(text, label) {
  assert.ok(!/process\.env\s*\[/.test(text), `${label}: dynamic process.env access`);
  assert.ok(!/\{[^}]*\}\s*=\s*process\.env\b/.test(text), `${label}: destructured process.env access`);
  for (const match of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    assert.ok(SOURCE_KEYS.test(match[1]), `${label}: frontend reads non-public env ${match[1]}`);
  }
}

const compose = fs.readFileSync(path.join(root, COMPOSE), 'utf8');
checkCompose(compose);
const files = sourceFiles(path.join(root, FRONTEND)).filter((file) => !file.includes(`${path.sep}scripts${path.sep}`));
for (const file of files) checkSource(fs.readFileSync(file, 'utf8'), path.relative(root, file));

// Negative cases: each regression must be refused.
const withEnvFile = compose.replace(
  '    container_name: inferno-benefits-frontend\n',
  '    container_name: inferno-benefits-frontend\n    env_file:\n      - ./.env.benefits\n'
);
assert.notEqual(withEnvFile, compose);
assert.throws(() => checkCompose(withEnvFile), /must not use env_file/);
const extraRuntime = compose.replace('      HOSTNAME: 0.0.0.0\n', '      HOSTNAME: 0.0.0.0\n      ADMIN_SECRET: x\n');
assert.notEqual(extraRuntime, compose);
assert.throws(() => checkCompose(extraRuntime), /runtime key not allowed: ADMIN_SECRET/);
assert.throws(() => checkSource('const s = process.env.ADMIN_SECRET;', 'fixture'), /non-public env ADMIN_SECRET/);
assert.throws(() => checkSource('const s = process.env[name];', 'fixture'), /dynamic/);
assert.throws(() => checkSource('const { RPC_URL } = process.env;', 'fixture'), /destructured/);
assert.doesNotThrow(() => checkSource('const u = process.env.NEXT_PUBLIC_CHAIN_ID;', 'fixture'));

console.log(`[benefits-frontend-env-isolation] PASS - frontend has no env_file, ${files.length} source files read public env only`);
