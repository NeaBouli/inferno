#!/usr/bin/env node
/**
 * Release check (PR #238 F1): device receipts verify only when the proof's Audience equals the frontend
 * host and its Chain ID equals the frontend chain. The backend signs Audience = SELLER_AUTH_DOMAIN and
 * Chain ID = CHAIN_ID, the frontend uses its page host and NEXT_PUBLIC_CHAIN_ID (build arg, compose
 * default 1). This static check reads the compose env file that feeds both services and fails closed
 * if a value is missing or the pair differs. Values are never printed.
 *
 * Usage: node scripts/check-benefits-proof-context.cjs [--env <file>] [--public-host <host>]
 *        defaults: apps/benefits-network/.env.benefits, BENEFITS_PUBLIC_HOST or shop.ifrunit.tech
 */
const fs = require('node:fs');
const path = require('node:path');

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/** Returns a list of problems (empty = consistent). Never includes values. */
function checkProofContext(env, publicHost) {
  const problems = [];
  const domain = env.SELLER_AUTH_DOMAIN;
  const backendChain = env.CHAIN_ID;
  const frontendChain = env.NEXT_PUBLIC_CHAIN_ID === undefined || env.NEXT_PUBLIC_CHAIN_ID === '' ? '1' : env.NEXT_PUBLIC_CHAIN_ID;
  if (!publicHost) problems.push('public host is not set');
  if (!domain) problems.push('SELLER_AUTH_DOMAIN is missing');
  else if (publicHost && domain.toLowerCase() !== publicHost.toLowerCase()) {
    problems.push('SELLER_AUTH_DOMAIN differs from the frontend public host');
  }
  if (!/^[1-9][0-9]*$/.test(backendChain || '')) problems.push('CHAIN_ID is missing or not a positive integer');
  if (!/^[1-9][0-9]*$/.test(frontendChain)) problems.push('NEXT_PUBLIC_CHAIN_ID is not a positive integer');
  if (/^[1-9][0-9]*$/.test(backendChain || '') && /^[1-9][0-9]*$/.test(frontendChain) && Number(backendChain) !== Number(frontendChain)) {
    problems.push('CHAIN_ID (backend) differs from NEXT_PUBLIC_CHAIN_ID (frontend)');
  }
  return problems;
}

module.exports = { parseEnv, checkProofContext };

if (require.main === module) {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
  const envFile = option('--env') || path.join(__dirname, '..', 'apps', 'benefits-network', '.env.benefits');
  const publicHost = option('--public-host') || process.env.BENEFITS_PUBLIC_HOST || 'shop.ifrunit.tech';
  let text;
  try {
    text = fs.readFileSync(envFile, 'utf8');
  } catch {
    console.error(`[benefits-proof-context] FAIL - env file not readable: ${envFile}`);
    process.exit(1);
  }
  const problems = checkProofContext(parseEnv(text), publicHost);
  if (problems.length) {
    console.error(`[benefits-proof-context] FAIL - ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log('[benefits-proof-context] PASS - backend audience/chain match the frontend host/chain');
}
