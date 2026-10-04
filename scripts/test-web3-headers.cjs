#!/usr/bin/env node

// CWA-10 contract gate: infra/web3/web3-security-headers.conf is the repository
// source of truth for the web3.ifrunit.tech nginx hardening headers. This test
// fails if a required header disappears or if the CSP stops covering the
// external resources the actual Web3 app and wallet connector flow need.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const confPath = path.join(root, 'infra', 'web3', 'web3-security-headers.conf');
const conf = fs.readFileSync(confPath, 'utf8');

// ── Parse add_header directives ──────────────────────────────────────
const headers = new Map();
for (const match of conf.matchAll(/^\s*add_header\s+([A-Za-z-]+)\s+"([^"]+)"\s+always\s*;/gm)) {
  assert.ok(!headers.has(match[1]), `duplicate add_header for ${match[1]}`);
  headers.set(match[1], match[2]);
}

function requireHeader(name) {
  assert.ok(headers.has(name), `web3 headers config must set ${name}`);
  return headers.get(name);
}

function cspDirectives(value) {
  const directives = new Map();
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives.set(tokens[0], tokens.slice(1));
  }
  return directives;
}

function requireCspTokens(directives, directive, tokens) {
  assert.ok(directives.has(directive), `CSP must declare ${directive}`);
  for (const token of tokens) {
    assert.ok(
      directives.get(directive).includes(token),
      `CSP ${directive} must include ${token} (have: ${directives.get(directive).join(' ')})`,
    );
  }
}

// ── Required header set ──────────────────────────────────────────────
const csp = cspDirectives(requireHeader('Content-Security-Policy'));

const expectedCsp = new Map([
  ['default-src', ["'self'"]],
  ['script-src', ["'self'", "'unsafe-inline'"]],
  ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
  ['font-src', ["'self'", 'https://fonts.gstatic.com']],
  ['img-src', ["'self'", 'data:', 'blob:', 'https://explorer-api.walletconnect.com', 'https://*.walletconnect.com']],
  ['connect-src', [
    "'self'",
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
    'https://1rpc.io',
    'https://*.walletconnect.com',
    'https://*.walletconnect.org',
    'wss://*.walletconnect.com',
    'wss://*.walletconnect.org',
    'https://*.web3modal.org',
    'https://*.web3modal.com',
  ]],
  ['frame-src', ['https://copilot-api.ifrunit.tech', 'https://verify.walletconnect.com']],
  ['worker-src', ["'self'"]],
  ['manifest-src', ["'self'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
]);

assert.deepEqual(
  [...csp.keys()].sort(),
  [...expectedCsp.keys()].sort(),
  'CSP directive set must match the reviewed Web3 policy exactly',
);
for (const [directive, tokens] of expectedCsp) {
  assert.deepEqual(
    csp.get(directive),
    tokens,
    `CSP ${directive} must match the reviewed Web3 policy exactly`,
  );
}

assert.equal(requireHeader('X-Frame-Options'), 'DENY', 'X-Frame-Options must be DENY');
assert.equal(requireHeader('X-Content-Type-Options'), 'nosniff', 'X-Content-Type-Options must be nosniff');
assert.equal(requireHeader('Referrer-Policy'), 'no-referrer', 'Referrer-Policy must be no-referrer');

const permissionsPolicy = requireHeader('Permissions-Policy');
assert.equal(
  permissionsPolicy,
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
  'Permissions-Policy must match the reviewed Web3 policy exactly',
);

const hsts = requireHeader('Strict-Transport-Security');
const maxAge = Number((hsts.match(/max-age=(\d+)/) || [])[1]);
assert.ok(maxAge >= 31536000, 'HSTS max-age must be at least one year');
assert.ok(hsts.includes('includeSubDomains'), 'HSTS must include subdomains');

// ── CSP baseline hardening ───────────────────────────────────────────
requireCspTokens(csp, 'frame-ancestors', ["'none'"]);
requireCspTokens(csp, 'object-src', ["'none'"]);
requireCspTokens(csp, 'default-src', ["'self'"]);
requireCspTokens(csp, 'base-uri', ["'self'"]);
requireCspTokens(csp, 'form-action', ["'self'"]);

// ── Contract with the actual Web3 app resources ──────────────────────
const web3App = fs.readFileSync(path.join(root, 'docs', 'web3', 'index.html'), 'utf8');
const walletCore = fs.readFileSync(path.join(root, 'docs', 'web3-wallet-core.js'), 'utf8');
const sharedWalletCore = fs.readFileSync(path.join(root, 'docs', 'assets', 'wallet-core.js'), 'utf8');

// Inline script/style blocks in docs/web3/index.html require 'unsafe-inline'.
assert.ok(web3App.includes('<script>'), 'Web3 app must keep its inline bootstrap script (CSP allows it)');
requireCspTokens(csp, 'script-src', ["'self'", "'unsafe-inline'"]);
requireCspTokens(csp, 'style-src', ["'self'", "'unsafe-inline'"]);

// CWA-47: the WalletConnect provider is a pinned same-origin artifact; no
// third-party script host may remain in the runtime or in CSP script-src.
const WC_VENDOR_SRC = '/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js';
for (const [name, source] of [['docs/web3-wallet-core.js', walletCore], ['docs/assets/wallet-core.js', sharedWalletCore]]) {
  assert.ok(!source.includes('https://esm.sh'), `${name} must not import from esm.sh (CWA-47)`);
  assert.ok(!/import\(\s*["']https?:\/\//.test(source), `${name} must not import remote code at runtime (CWA-47)`);
  assert.ok(source.includes(WC_VENDOR_SRC), `${name} must load the pinned same-origin WalletConnect artifact`);
}
const scriptSrcHosts = csp.get('script-src').filter((token) => token.startsWith('https:') || token.startsWith('http:'));
assert.deepEqual(scriptSrcHosts, [], 'CSP script-src must not allow any third-party host (CWA-47)');

// WalletConnect relay/modal/verify endpoints required by the connector flow.
requireCspTokens(csp, 'connect-src', ['wss://*.walletconnect.com', 'https://*.walletconnect.com']);
requireCspTokens(csp, 'frame-src', ['https://verify.walletconnect.com']);
requireCspTokens(csp, 'img-src', ['data:', 'blob:']);

// Mainnet RPC fallback endpoints used by ethers in the dApp (same list as
// docs/assets/wallet-core.js); every one must be allowed by connect-src.
for (const url of ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth']) {
  assert.ok(walletCore.includes(`"${url}"`), `Web3 RPC endpoint ${url} missing — re-check CSP connect-src`);
}
assert.ok(!walletCore.includes('llamarpc'), 'Web3 wallet core must not use eth.llamarpc.com (HTTP 525, no fallback)');
requireCspTokens(csp, 'connect-src', ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io']);

// Embedded copilot iframe.
assert.ok(web3App.includes('https://copilot-api.ifrunit.tech?embedded=1'),
  'Web3 copilot iframe changed — re-check CSP frame-src');
requireCspTokens(csp, 'frame-src', ['https://copilot-api.ifrunit.tech']);

// Google Fonts stylesheet + font files.
assert.ok(web3App.includes('https://fonts.googleapis.com'), 'Web3 Google Fonts stylesheet changed');
requireCspTokens(csp, 'style-src', ['https://fonts.googleapis.com']);
requireCspTokens(csp, 'font-src', ['https://fonts.gstatic.com']);

// Service worker and manifest stay same-origin.
assert.ok(web3App.includes('navigator.serviceWorker.register'), 'Web3 service worker registration changed');
requireCspTokens(csp, 'worker-src', ["'self'"]);
requireCspTokens(csp, 'manifest-src', ["'self'"]);

console.log('[web3-headers-test] PASS');
