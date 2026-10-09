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
 * - NEXT_PUBLIC_CHAIN_ID is read only at services.benefits-frontend.build.args (block-structure walk;
 *   any other placement, duplicates or unsupported YAML fail). A literal build arg wins; for `${NEXT_PUBLIC_CHAIN_ID:-d}`
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

const FRONTEND_ARG_PATH = 'services.benefits-frontend.build.args.NEXT_PUBLIC_CHAIN_ID';

/**
 * Walks the compose YAML block structure (indentation keys) and returns every mapping key with its full
 * dotted path. Only plain block mappings are supported: anchors, aliases, merge keys, flow collections,
 * tabs and multi-document files are refused (fail closed), so a value can never be attributed to the
 * wrong service.
 */
function composeEntries(text) {
  const entries = [];
  const stack = [];
  let unsupported = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(raw)) continue;
    if (/\t/.test(raw.match(/^\s*/)[0]) || /^---|^\.\.\./.test(raw)) { unsupported = true; continue; }
    const line = raw.replace(/\s+#.*$/, '');
    const indent = line.match(/^ */)[0].length;
    const body = line.slice(indent);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const item = body.startsWith('- ') ? body.slice(2) : null;
    const keyed = (item ?? body).match(/^(["']?)([A-Za-z0-9_.-]+)\1\s*:(?:\s+(.*))?$/);
    if (/(^|[\s:\[{,])[&*][A-Za-z0-9_-]/.test(body) || /^<<\s*:/.test(item ?? body)) { unsupported = true; continue; }
    // Interpolated names (`${VAR}` in a key or before `=`/`:` in a list item) resolve to keys this
    // walk cannot see, e.g. `- "${K:-CHAIN_ID}=5"`; refuse them instead of guessing.
    const name = (item ?? body).replace(/^(['"])/, '').split(/[=:]/)[0];
    if (name.includes('$')) { unsupported = true; continue; }
    if (!keyed) {
      if (item === null && !/^[^:]+$/.test(body)) unsupported = true;
      if (item !== null) entries.push({ path: stack.map((frame) => frame.key).join('.'), key: null, item: item.replace(/^(['"])(.*)\1$/, '$2'), value: item });
      continue;
    }
    const value = (keyed[3] || '').trim();
    const key = keyed[2];
    // Flow collections are refused where they could hide a build arg or an environment entry.
    if (/^[\[{]/.test(value) && (stack.length < 2 || ['build', 'args', 'environment'].includes(key))) unsupported = true;
    const pathKey = [...stack.map((frame) => frame.key), key].join('.');
    entries.push({ path: pathKey, key, value });
    if (item === null) stack.push({ indent, key });
  }
  return { entries, unsupported };
}

/**
 * Reads the frontend NEXT_PUBLIC_CHAIN_ID build arg only at services.benefits-frontend.build.args and
 * any backend environment overrides from the compose file. Returns
 * { chainArg: { literal } | { variable, default } | { unsupported } | null, backendOverrides, problems }.
 */
function parseCompose(text) {
  const { entries, unsupported } = composeEntries(text);
  const problems = [];
  if (unsupported) problems.push('compose file uses unsupported YAML (anchors, aliases, merge keys, flow collections or tabs)');
  const chainKeys = entries.filter((entry) => entry.key === 'NEXT_PUBLIC_CHAIN_ID' || /^NEXT_PUBLIC_CHAIN_ID\s*(=|:|$)/.test(entry.item || ''));
  const placed = chainKeys.filter((entry) => entry.path === FRONTEND_ARG_PATH);
  if (chainKeys.length !== placed.length) problems.push('compose defines NEXT_PUBLIC_CHAIN_ID outside services.benefits-frontend.build.args');
  if (placed.length > 1) problems.push('compose defines the frontend NEXT_PUBLIC_CHAIN_ID build arg more than once');
  let chainArg = null;
  if (placed.length === 1) {
    const value = placed[0].value.replace(/^(['"])(.*)\1$/, '$2');
    const interpolated = value.match(/^\$\{NEXT_PUBLIC_CHAIN_ID(?:(:?-)([^}]*))?\}$/);
    if (interpolated) chainArg = { variable: true, operator: interpolated[1], default: interpolated[1] ? interpolated[2] : undefined };
    else if (!value.includes('$') && value !== '') chainArg = { literal: value };
    else chainArg = { unsupported: true };
  }
  const backendOverrides = entries.some((entry) => entry.key === 'CHAIN_ID' || entry.key === 'SELLER_AUTH_DOMAIN'
    || /^(CHAIN_ID|SELLER_AUTH_DOMAIN)\s*(=|:|$)/.test(entry.item || ''));
  return { chainArg, backendOverrides, problems };
}

/** Returns a list of problems (empty = consistent). Never includes values. */
function checkProofContext({ envFile, compose, processEnv, publicHost }) {
  const problems = [...(compose.problems || [])];
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
    // Compose semantics: `:-` uses the default when the variable is unset or empty, `-` only when it is
    // unset (an explicitly empty value stays empty), no operator has no default.
    const fromFile = envFile.NEXT_PUBLIC_CHAIN_ID;
    const { operator } = compose.chainArg;
    if (fromFile === undefined) frontendChain = compose.chainArg.default;
    else if (fromFile === '' && operator === ':-') frontendChain = compose.chainArg.default;
    else frontendChain = fromFile;
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
