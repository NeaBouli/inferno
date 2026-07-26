const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = {
  architecture: 'docs/SHOP_BENEFITS_APP_ARCHITECTURE.md',
  master: 'docs/ifrp-commerce-app/MASTER_ARCHITECTURE.md',
  onboarding: 'docs/BUSINESS_ONBOARDING.md',
  wikiOnboarding: 'docs/wiki/business-onboarding.html',
  wikiFaq: 'docs/wiki/faq.html',
  whitepaper: 'docs/WHITEPAPER.md',
  testGuide: 'docs/BENEFITS_NETWORK_TEST.md',
  copilotKnowledge: 'apps/ai-copilot/src/context/ifr-knowledge.ts',
  frontendReadme: 'apps/benefits-network/frontend/README.md',
  frontendHome: 'apps/benefits-network/frontend/src/app/page.tsx',
  frontendGuide: 'apps/benefits-network/frontend/src/app/guide/page.tsx',
  frontendSitemap: 'apps/benefits-network/frontend/src/app/sitemap.ts',
};

const content = Object.fromEntries(Object.entries(files).map(([key, file]) => [
  key,
  fs.readFileSync(path.join(root, file), 'utf8'),
]));

for (const [key, value] of Object.entries(content)) {
  for (const stale of [
    /QR Flow \(3 Steps\)/i,
    /APPROVED \(green\) or DENIED/i,
    /QR code links? to a wallet address/i,
    /last known lock status is used/i,
    /scan QR -> connect wallet -> sign -> done/i,
  ]) {
    assert.ok(!stale.test(value), `${files[key]} contains stale Benefits claim: ${stale}`);
  }
}

for (const [label, required] of [
  ['customer-presented', /customer-presented/i],
  ['APPROVED', /APPROVED/],
  ['REJECTED', /REJECTED/],
  ['IFRLock', /IFRLock/],
  ['authorized checkout operator', /authorized checkout[- ]operator/i],
  ['fail closed', /fails? closed/i],
]) {
  assert.ok(
    required.test(content.onboarding),
    `canonical onboarding is missing: ${label}`
  );
}

assert.ok(content.architecture.includes('Implemented and live'), 'architecture must mark customer pass live');
assert.ok(content.wikiOnboarding.includes('opaque short-lived'), 'Wiki must explain opaque customer pass privacy');
assert.ok(content.wikiFaq.includes('APPROVED or REJECTED'), 'FAQ must use backend status terms');
assert.ok(content.master.includes('minimum IFR locked in IFRLock'), 'master architecture must use the deployed eligibility source');
assert.ok(content.copilotKnowledge.includes('approved or rejected'), 'Copilot knowledge must use backend status terms');
assert.ok(content.testGuide.includes('| Silver | 2,500 IFR |'), 'test guide must use the current Silver example');
assert.ok(content.testGuide.includes('| Platinum | 10,000 IFR |'), 'test guide must use the current Platinum example');
assert.ok(!content.testGuide.includes('| Gold | 25,000 IFR |'), 'test guide contains the retired 25,000 IFR example');
assert.ok(!content.testGuide.includes('| Diamond | 100,000 IFR |'), 'test guide contains the retired 100,000 IFR example');

for (const staleWalletClaim of [
  'create or connect an IFR wallet',
  'Create or connect an Ethereum wallet.',
  '-> create embedded wallet or connect external wallet',
]) {
  assert.ok(
    !content.master.includes(staleWalletClaim),
    `master architecture implies production creates wallet keys: ${staleWalletClaim}`
  );
}
assert.ok(
  /The Benefits app does not create,\s+import or store wallet keys\./.test(content.master),
  'master architecture must state the production external-wallet boundary'
);
assert.ok(
  /the production Benefits app does not create,\s+import, custody or store wallet keys/.test(content.architecture),
  'shop architecture must state the production external-wallet boundary'
);
assert.ok(
  content.frontendHome.includes('The shop app never creates, stores or asks for seed phrases.'),
  'Shop home must direct wallet creation away from the production app'
);
assert.ok(
  content.frontendGuide.includes('create or import their wallet inside a trusted wallet app first'),
  'Shop guide must explain trusted external wallet creation'
);

assert.ok(
  content.master.includes('offline launcher shell'),
  'master architecture must scope offline support to the launcher shell'
);
assert.ok(
  /API, wallet,\s+chain, signature, checkout and redemption actions remain network-only/.test(content.architecture),
  'shop architecture must preserve network-only sensitive actions'
);
assert.ok(
  /API, wallet, checkout and redemption requests stay network-only/.test(content.frontendReadme),
  'frontend README must preserve the network-only PWA boundary'
);

for (const variable of [
  'BENEFITS_API_INTERNAL_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_CHAIN_ID',
  'NEXT_PUBLIC_IFR_TOKEN_ADDRESS',
  'NEXT_PUBLIC_IFRLOCK_ADDRESS',
  'NEXT_PUBLIC_COMMITMENT_VAULT_ADDRESS',
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
  'CHAIN_ID',
  'RPC_URL',
  'RATE_LIMIT_STORE',
  'BACKEND_REPLICA_COUNT',
]) {
  assert.ok(
    content.master.includes(`\`${variable}\``),
    `master architecture is missing the deployed configuration name: ${variable}`
  );
}
assert.ok(
  content.frontendReadme.includes('Every `NEXT_PUBLIC_*` value is') &&
    content.frontendReadme.includes('embedded into the browser bundle at build time'),
  'frontend README must explain the Next.js public build-time configuration boundary'
);
assert.ok(
  content.frontendReadme.includes('docker compose --env-file .env.benefits') &&
    content.frontendReadme.includes('does not') &&
    content.frontendReadme.includes('supply `${...}` interpolation for `build.args`'),
  'frontend README must explain the Compose interpolation source'
);
assert.ok(
  content.master.includes('browser-visible build-time configuration'),
  'master architecture must preserve the production frontend build-time boundary'
);
for (const staleVariable of ['SHOP_API_URL', 'MAINNET_RPC_URL']) {
  assert.ok(
    !content.master.includes(staleVariable),
    `master architecture contains stale configuration name: ${staleVariable}`
  );
}
assert.ok(
  content.master.includes('The scoped external-wallet MVP on `shop.ifrunit.tech` is implemented.'),
  'master architecture must not describe the deployed MVP as future work'
);
assert.ok(
  content.master.includes('first real wallet-owned seller profile') &&
    content.master.includes('physical iPhone/iPad/Android wallet matrix'),
  'master architecture must document the current real-world release gates'
);
assert.ok(
  content.frontendGuide.includes('https://ifrunit.tech/wiki/business-onboarding.html'),
  'Shop guide must link to the canonical seller onboarding page'
);
assert.ok(
  !content.frontendSitemap.includes("new Date('2026-07-19T00:00:00Z')") &&
    !content.frontendSitemap.includes('lastModified,'),
  'static Shop routes must not publish a frozen last-modified timestamp'
);

console.log('[benefits-doc-consistency] PASS');
