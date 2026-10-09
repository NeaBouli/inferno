#!/usr/bin/env node
/**
 * Release check (PR #238 F1): device receipts verify only when the proof's Audience equals the frontend
 * host and its Chain ID equals the frontend chain. The backend signs Audience = SELLER_AUTH_DOMAIN and
 * Chain ID = CHAIN_ID (service env_file); the frontend uses its page host and the NEXT_PUBLIC_CHAIN_ID
 * build arg that Docker Compose interpolates.
 *
 * Effective values are resolved like Compose does, fail closed:
 * - Compose interpolation gives the invoking shell precedence over the --env-file values, so any of
 *   SELLER_AUTH_DOMAIN, CHAIN_ID or NEXT_PUBLIC_CHAIN_ID set in this process environment fails the check
 *   (run it from a clean shell; an override cannot be verified here).
 * - NEXT_PUBLIC_CHAIN_ID: a literal build arg in the compose file wins; for `${NEXT_PUBLIC_CHAIN_ID:-d}`
 *   the env file value, else the literal compose default d; no value and no literal default fails.
 * - A compose `environment:` entry for CHAIN_ID / SELLER_AUTH_DOMAIN (overriding the env_file) fails.
 * - The public host is required explicitly (--public-host); there is no default.
 * Values are never printed.
 *
 * Usage: node scripts/check-benefits-proof-context.cjs --env <compose env file> --public-host <host>
 *        [--compose apps/benefits-network/docker-compose.production.example.yml]
 */
const fs = require('node:fs');
const path = require('node:path');

const OVERRIDE_VARS = ['SELLER_AUTH_DOMAIN', 'CHAIN_ID', 'NEXT_PUBLIC_CHAIN_ID'];
const POSITIVE_INT = /^[1-9][0-9]*$/;

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/**
 * Reads the frontend NEXT_PUBLIC_CHAIN_ID build arg and any backend environment overrides from the
 * compose file text. Returns { chainArg: { literal } | { variable, default } | null, backendOverrides }.
 */
function parseCompose(text) {
  const argLine = text.split(/\r?\n/).find((line) => /^\s+NEXT_PUBLIC_CHAIN_ID\s*:/.test(line));
  let chainArg = null;
  if (argLine) {
    const value = argLine.replace(/^\s+NEXT_PUBLIC_CHAIN_ID\s*:\s*/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    const interpolated = value.match(/^\$\{NEXT_PUBLIC_CHAIN_ID(?:(:?-)([^}]*))?\}$/);
    if (interpolated) chainArg = { variable: true, default: interpolated[1] ? interpolated[2] : undefined };
    else if (!value.includes('$')) chainArg = { literal: value };
    else chainArg = { unsupported: true };
  }
  const backendOverrides = text.split(/\r?\n/).some((line) => /^\s+-?\s*(CHAIN_ID|SELLER_AUTH_DOMAIN)\s*[:=]/.test(line));
  return { chainArg, backendOverrides };
}

/** Returns a list of problems (empty = consistent). Never includes values. */
function checkProofContext({ envFile, compose, processEnv, publicHost }) {
  const problems = [];
  for (const name of OVERRIDE_VARS) {
    if (processEnv[name] !== undefined) problems.push(`${name} is set in the invoking environment (overrides the env file; unset it)`);
  }
  if (!publicHost) problems.push('public host is not set (--public-host)');
  if (!compose.chainArg) problems.push('compose file has no NEXT_PUBLIC_CHAIN_ID build arg');
  if (compose.chainArg?.unsupported) problems.push('compose NEXT_PUBLIC_CHAIN_ID uses an unsupported expression');
  if (compose.backendOverrides) problems.push('compose environment overrides CHAIN_ID or SELLER_AUTH_DOMAIN');

  const domain = envFile.SELLER_AUTH_DOMAIN;
  if (!domain) problems.push('SELLER_AUTH_DOMAIN is missing');
  else if (publicHost && domain.toLowerCase() !== publicHost.toLowerCase()) problems.push('SELLER_AUTH_DOMAIN differs from the frontend public host');

  const backendChain = envFile.CHAIN_ID;
  if (!POSITIVE_INT.test(backendChain || '')) problems.push('CHAIN_ID is missing or not a positive integer');

  let frontendChain;
  if (compose.chainArg?.literal !== undefined) frontendChain = compose.chainArg.literal;
  else if (compose.chainArg?.variable) {
    const fromFile = envFile.NEXT_PUBLIC_CHAIN_ID;
    frontendChain = fromFile !== undefined && fromFile !== '' ? fromFile : compose.chainArg.default;
  }
  if (frontendChain === undefined || frontendChain === '') problems.push('NEXT_PUBLIC_CHAIN_ID has no value and no literal compose default');
  else if (!POSITIVE_INT.test(frontendChain)) problems.push('NEXT_PUBLIC_CHAIN_ID is not a positive integer');
  else if (POSITIVE_INT.test(backendChain || '') && Number(backendChain) !== Number(frontendChain)) {
    problems.push('CHAIN_ID (backend) differs from NEXT_PUBLIC_CHAIN_ID (frontend)');
  }
  return problems;
}

module.exports = { parseEnv, parseCompose, checkProofContext };

if (require.main === module) {
  const args = process.argv.slice(2);
  const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
  const envPath = option('--env');
  const composePath = option('--compose') || path.join(__dirname, '..', 'apps', 'benefits-network', 'docker-compose.production.example.yml');
  const publicHost = option('--public-host');
  let envText;
  let composeText;
  try {
    if (!envPath) throw new Error('missing --env');
    envText = fs.readFileSync(envPath, 'utf8');
    composeText = fs.readFileSync(composePath, 'utf8');
  } catch {
    console.error('[benefits-proof-context] FAIL - env file (--env) or compose file not readable');
    process.exit(1);
  }
  const problems = checkProofContext({
    envFile: parseEnv(envText),
    compose: parseCompose(composeText),
    processEnv: process.env,
    publicHost,
  });
  if (problems.length) {
    console.error(`[benefits-proof-context] FAIL - ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log('[benefits-proof-context] PASS - backend audience/chain match the frontend host/chain');
}
