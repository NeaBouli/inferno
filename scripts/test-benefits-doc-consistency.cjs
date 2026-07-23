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

console.log('[benefits-doc-consistency] PASS');
