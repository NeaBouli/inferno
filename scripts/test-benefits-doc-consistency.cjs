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
  copilotKnowledge: 'apps/ai-copilot/src/context/ifr-knowledge.ts',
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

console.log('[benefits-doc-consistency] PASS');
