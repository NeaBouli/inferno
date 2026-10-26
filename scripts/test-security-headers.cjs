#!/usr/bin/env node

// Offline serving-policy contract for JUL-09 / CWA-10. This deliberately reads
// the shipping nginx, Next and data API configurations, rather than a test copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Frozen origin/main (5e7d7154) baselines; keep offline CI independent of Git refs.
const enforcedCspBaselines = {
  web3: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://explorer-api.walletconnect.com https://*.walletconnect.com; connect-src 'self' https://ethereum-rpc.publicnode.com https://eth.drpc.org https://1rpc.io https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.web3modal.org https://*.web3modal.com; frame-src https://verify.walletconnect.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  benefits: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
};

function parseCsp(value) {
  assert.ok(value, 'missing CSP');
  const result = new Map();
  for (const part of value.split(';').filter((part) => part.trim())) {
    const [name, ...tokens] = part.trim().split(/\s+/);
    assert.ok(!result.has(name), `duplicate CSP directive: ${name}`);
    result.set(name, tokens);
  }
  return result;
}

function includesSources(csp, directive, sources) {
  for (const source of sources) {
    assert.ok(csp.get(directive)?.includes(source), `${directive} must allow ${source}`);
  }
}

function checkHeaders(headers, embedded = false, enforcedBaseline) {
  for (const name of ['Content-Security-Policy', 'Strict-Transport-Security',
    'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(headers.has(name), `missing ${name}`);
  }
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
  const hsts = headers.get('Strict-Transport-Security');
  assert.ok(Number(hsts.match(/(?:^|;)\s*max-age=(\d+)/)?.[1]) >= 15552000);
  assert.doesNotMatch(hsts, /preload/i, 'HSTS preload requires separate review');
  if (enforcedBaseline !== undefined) {
    assert.equal(headers.get('Content-Security-Policy'), enforcedBaseline,
      'enforced CSP must retain the origin/main baseline until JUL-11 passes');
    assert.match(hsts, /(?:^|;)\s*includeSubDomains(?:;|$)/i, 'HSTS must include subdomains');
    assert.ok(headers.has('Content-Security-Policy-Report-Only'), 'missing Content-Security-Policy-Report-Only');
    assert.notEqual(headers.get('Content-Security-Policy-Report-Only'), enforcedBaseline,
      'the strict policy must be staged separately from enforcement');
  } else {
    assert.doesNotMatch(hsts, /includeSubDomains/i, 'Data API HSTS remains host-scoped');
  }
  // Wallet surfaces stage the stricter policy; the data API enforces its own.
  const policy = headers.get(enforcedBaseline === undefined
    ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only');
  assert.doesNotMatch(policy, /unsafe-eval|\*/,
    'no eval, wildcard hosts or scheme-wide connections');
  const csp = parseCsp(policy);
  // HTTPS images are necessary for arbitrary seller logos, and are the only
  // allowed scheme-wide source. No such exception exists for connections/scripts.
  for (const [directive, tokens] of csp) {
    assert.ok(!tokens.some((token) => /^(?:https?|wss?):$/.test(token)
      && !(directive === 'img-src' && token === 'https:')), `${directive}: broad scheme source`);
  }
  includesSources(csp, 'object-src', ["'none'"]);
  assert.ok(csp.has('default-src') && csp.has('base-uri') && csp.has('form-action'));
  includesSources(csp, 'script-src', ["'self'"]);
  assert.ok(csp.get('script-src').every((source) => ["'self'", "'unsafe-inline'"].includes(source)),
    'production scripts must stay bundled or inline, with no external script hosts');
  includesSources(csp, 'connect-src', ["'self'"]);
  for (const feature of ['microphone', 'geolocation', 'payment', 'usb']) {
    assert.ok(headers.get('Permissions-Policy').includes(`${feature}=()`));
  }
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.deepEqual(csp.get('frame-ancestors'), ["'none'"]);
  return csp;
}

function checkConnections(csp, urls) {
  for (const url of urls) includesSources(csp, 'connect-src', [new URL(url).origin]);
}

function urls(source) {
  return [...new Set(source.match(/(?:https?|wss?):\/\/[a-zA-Z0-9._-]+(?::\d+)?(?:\/[a-zA-Z0-9/_-]*)?/g))];
}

function sourceFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:[cm]?js|tsx?)$/.test(file) ? [file] : [];
  });
}

const telemetryGuardFile = 'apps/benefits-network/frontend/src/lib/wallet-telemetry-guard.mjs';
function walletAndRpcUrls(source, file) {
  if (file === telemetryGuardFile) {
    // Omit only the reviewed deny comparison from static URL extraction.
    // An actual Pulse transport literal elsewhere in this same file still fails.
    const denyComparison = 'new scope.URL(url, scope.document.baseURI).origin === "https://pulse.walletconnect.org"';
    assert.equal(source.split(denyComparison).length, 2, 'review the exact Pulse deny comparison after guard changes');
    source = source.replace(denyComparison, 'false');
  }
  return urls(source).filter((url) => /(?:walletconnect|web3modal|reown|publicnode|drpc|1rpc|alchemy|infura|ankr|(?:^|[.-])rpc[.-])/i
    .test(new URL(url).hostname));
}

async function nextHeaders(env = {}) {
  // Evaluate the actual CommonJS config with deterministic public build inputs.
  const context = { module: { exports: {} }, process: { env }, URL,
    __dirname: path.join(root, 'apps/benefits-network/frontend') };
  vm.runInNewContext(read('apps/benefits-network/frontend/next.config.js'), context);
  const rules = await context.module.exports.headers();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/:path*', 'include API, assets, nested routes and errors');
  return new Map(rules[0].headers.map(({ key, value }) => [key, value]));
}

async function main() {
  const nginx = new Map([...read('infra/web3/web3-security-headers.conf').matchAll(
    /^add_header\s+([\w-]+)\s+"([^"]+)"\s+always;/gm,
  )].map((m) => [m[1], m[2]]));
  const web3 = checkHeaders(nginx, false, enforcedCspBaselines.web3);
  checkConnections(web3, walletAndRpcUrls(read('docs/web3/index.html')));
  for (const file of ['docs/web3-wallet-core.js', 'docs/assets/wallet-core.js']) {
    const rpcArray = read(file).match(/var RPC_URLS\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(rpcArray, `${file}: RPC_URLS moved; update the source extractor`);
    checkConnections(web3, urls(rpcArray[1]));
  }

  // Extract operational wallet origins from the shipped provider, including
  // both verify hosts and the explorer API. Telemetry (pulse), notifications
  // (echo), and optional email/social-login (secure) are not enabled app flows.
  const vendor = read('docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js');
  const walletUrls = urls(vendor).filter((url) => {
    const host = new URL(url).hostname;
    return /^(?:relay|rpc|verify|explorer(?:-api)?|api)\.(?:walletconnect\.(?:org|com)|web3modal\.(?:org|com))$/.test(host);
  });
  assert.ok(walletUrls.length >= 5, 'provider origins extraction must not silently become empty');
  checkConnections(web3, walletUrls);
  includesSources(web3, 'frame-src', ['https://verify.walletconnect.com', 'https://verify.walletconnect.org']);
  includesSources(web3, 'font-src', ['https://fonts.reown.com']);

  const benefitsHeaders = await nextHeaders();
  const benefits = checkHeaders(benefitsHeaders, false, enforcedCspBaselines.benefits);
  for (const directive of ['default-src', 'base-uri', 'form-action']) {
    includesSources(benefits, directive, ["'self'"]);
  }
  const wagmi = read('apps/benefits-network/frontend/src/lib/wagmi.ts');
  assert.ok(wagmi.includes('NEXT_PUBLIC_ETHEREUM_RPC_URL'));
  // The only literal HTTPS transports in wagmi.ts are the two public RPCs;
  // metadata.url/icons are same-origin shop resources and allowed by self.
  checkConnections(benefits, urls(wagmi).filter((url) => new URL(url).hostname !== 'shop.ifrunit.tech'));
  checkConnections(benefits, walletUrls);
  for (const file of sourceFiles('apps/benefits-network/frontend/src')) {
    checkConnections(benefits, walletAndRpcUrls(read(file), file));
  }
  // Keep operational Pulse calls forbidden, even inside the deny-rule module.
  const pulseCall = 'fetch("https://pulse.walletconnect.org/e")';
  assert.throws(() => checkConnections(benefits, walletAndRpcUrls(pulseCall,
    'apps/benefits-network/frontend/src/other.ts')),
  /connect-src must allow https:\/\/pulse\.walletconnect\.org/);
  assert.throws(() => checkConnections(benefits, walletAndRpcUrls(
    read(telemetryGuardFile) + '\n' + pulseCall, telemetryGuardFile)),
  /connect-src must allow https:\/\/pulse\.walletconnect\.org/);
  assert.throws(() => checkConnections(benefits, walletAndRpcUrls(
    read(telemetryGuardFile) + '\nfetch("https://unreviewed.walletconnect.org")', telemetryGuardFile)),
  /connect-src must allow https:\/\/unreviewed\.walletconnect\.org/);
  // Coinbase 4.3.6 core/constants.js and WalletLinkWebSocket.js: HTTPS API
  // becomes WSS for its relay. keys.coinbase.com is a popup, not an iframe.
  checkConnections(benefits, ['https://www.walletlink.org', 'wss://www.walletlink.org',
    'https://rpc.wallet.coinbase.com']);
  const expectedConnections = new Set(["'self'", 'https://ethereum-rpc.publicnode.com',
    'https://ethereum-sepolia-rpc.publicnode.com', 'https://relay.walletconnect.org',
    ...walletUrls.map((url) => new URL(url).origin), 'https://www.walletlink.org',
    'wss://www.walletlink.org', 'https://rpc.wallet.coinbase.com']);
  assert.deepEqual([...benefits.get('connect-src')].sort(), [...expectedConnections].sort(),
    'Benefits connection permissions must match reviewed runtime destinations exactly');
  const lock = JSON.parse(read('apps/benefits-network/frontend/package-lock.json')).packages;
  for (const [pkg, version] of [['@coinbase/wallet-sdk', '4.3.6'],
    ['@walletconnect/ethereum-provider', '2.23.10'], ['@reown/appkit-common', '1.8.19']]) {
    assert.equal(lock[`node_modules/${pkg}`].version, version, `${pkg}: re-review SDK origin contract after upgrade`);
  }
  assert.ok(wagmi.includes('telemetry: false') && wagmi.includes('telemetryEnabled: false'));
  assert.equal(benefitsHeaders.get('Permissions-Policy').match(/camera=\(([^)]*)\)/)?.[1], 'self',
    'QR scanner camera access must survive');
  includesSources(benefits, 'worker-src', ["'self'", 'blob:']);
  includesSources(benefits, 'style-src', ["'self'", "'unsafe-inline'"]);
  includesSources(benefits, 'font-src', ["'self'", 'data:', 'https://fonts.reown.com']);
  includesSources(benefits, 'media-src', ["'self'", 'blob:']);
  includesSources(benefits, 'manifest-src', ["'self'"]);
  includesSources(benefits, 'img-src', ['https:']);
  includesSources(benefits, 'frame-src', ['https://verify.walletconnect.com', 'https://verify.walletconnect.org']);

  // A custom build-time RPC/API must add only its origin, never a secret path,
  // query string, or a blanket https: permission.
  const custom = checkHeaders(await nextHeaders({
    NEXT_PUBLIC_ETHEREUM_RPC_URL: 'https://rpc.example.test/private-key?token=test',
    NEXT_PUBLIC_API_URL: 'https://api.example.test/v1',
  }), false, enforcedCspBaselines.benefits);
  checkConnections(custom, ['https://rpc.example.test', 'https://api.example.test']);
  assert.ok(!JSON.stringify([...custom]).includes('private-key'));
  const production = checkHeaders(await nextHeaders({ NODE_ENV: 'production' }), false, enforcedCspBaselines.benefits);
  assert.ok(!production.get('script-src').includes("'unsafe-eval'"));
  const developmentHeaders = await nextHeaders({ NODE_ENV: 'development' });
  assert.equal(developmentHeaders.get('Content-Security-Policy'), enforcedCspBaselines.benefits);
  const development = parseCsp(developmentHeaders.get('Content-Security-Policy-Report-Only'));
  includesSources(development, 'script-src', ["'unsafe-eval'"]);

  const context = {};
  vm.runInNewContext(read('apps/data-api/server/security-headers.ts')
    .replace('export const securityHeaders =', 'globalThis.securityHeaders ='), context);
  const apiHeaders = new Map(Object.entries(context.securityHeaders));
  const apiPolicy = parseCsp(apiHeaders.get('Content-Security-Policy'));
  for (const name of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) assert.ok(apiHeaders.has(name));
  assert.deepEqual(apiPolicy.get('default-src'), ["'none'"]);
  assert.deepEqual(apiPolicy.get('frame-ancestors'), ["'none'"]);
  assert.equal(apiHeaders.get('X-Frame-Options'), 'DENY');
  assert.equal(apiHeaders.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(apiHeaders.get('Referrer-Policy'), 'no-referrer');
  assert.match(apiHeaders.get('Strict-Transport-Security'), /^max-age=63072000$/);
  for (const directive of ['base-uri', 'object-src', 'form-action']) assert.deepEqual(apiPolicy.get(directive), ["'none'"]);
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) assert.ok(apiHeaders.get('Permissions-Policy').includes(`${feature}=()`));
  const api = read('apps/data-api/server/index.ts');
  assert.ok(api.indexOf('res.set(securityHeaders)') < api.indexOf('app.use(cors('));
  const finalNotFound = api.indexOf('app.use((_req, res) => {\n  res.status(404).json(');
  assert.ok(finalNotFound > api.lastIndexOf('app.get('));
  assert.ok(api.indexOf('app.use(handleUnhandledError)') > finalNotFound);

  const pages = ['docs/index.html', 'docs/web3/index.html', ...fs.readdirSync(path.join(root, 'docs/wiki'))
    .filter((file) => file.endsWith('.html')).map((file) => `docs/wiki/${file}`)];
  for (const file of pages) {
    const source = read(file);
    const meta = source.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*>/);
    assert.ok(meta, `${file}: missing meta CSP`);
    assert.equal(meta[1], "base-uri 'self'; object-src 'none'; form-action 'self'");
    assert.ok(source.includes('<meta name="referrer" content="no-referrer">'));
    const firstResource = source.search(/<(?:script|style|link)\b/i);
    assert.ok(firstResource < 0 || meta.index < firstResource, `${file}: policy must precede resources`);
    assert.doesNotMatch(source, /<(?:base|object|embed)\b/i, `${file}: re-review additive meta policy`);
    for (const form of source.matchAll(/<form\b[^>]*\baction=["']([^"']+)/gi)) {
      assert.equal(new URL(form[1], 'https://ifrunit.tech').origin, 'https://ifrunit.tech');
    }
  }

  // Mutation checks: the gate must reject missing headers and newly referenced
  // RPC/WC endpoints instead of accepting a stale hardcoded endpoint list.
  const missingHeader = new Map(nginx);
  missingHeader.delete('Permissions-Policy');
  assert.throws(() => checkHeaders(missingHeader, false, enforcedCspBaselines.web3), /missing Permissions-Policy/);
  assert.throws(() => checkConnections(web3, ['https://new-rpc.example.test']), /connect-src/);
  for (const bad of ["'unsafe-eval'", 'https:', 'https://*.walletconnect.org']) {
    const widened = new Map(nginx);
    widened.set('Content-Security-Policy-Report-Only', nginx.get('Content-Security-Policy-Report-Only') + `; child-src ${bad}`);
    assert.throws(() => checkHeaders(widened, false, enforcedCspBaselines.web3));
  }
  for (const [headers, baseline] of [[nginx, enforcedCspBaselines.web3],
    [benefitsHeaders, enforcedCspBaselines.benefits]]) {
    const enforcedEarly = new Map(headers);
    enforcedEarly.set('Content-Security-Policy', headers.get('Content-Security-Policy-Report-Only'));
    assert.throws(() => checkHeaders(enforcedEarly, false, baseline), /origin\/main baseline/);
    const missingReportOnly = new Map(headers);
    missingReportOnly.delete('Content-Security-Policy-Report-Only');
    assert.throws(() => checkHeaders(missingReportOnly, false, baseline), /missing Content-Security-Policy-Report-Only/);
    const weakenedHsts = new Map(headers);
    weakenedHsts.set('Strict-Transport-Security', 'max-age=63072000');
    assert.throws(() => checkHeaders(weakenedHsts, false, baseline), /HSTS must include subdomains/);
  }
  console.log(`[security-headers] PASS (nginx, Next, Express, ${pages.length} Pages documents; ${walletUrls.length} wallet origins)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
