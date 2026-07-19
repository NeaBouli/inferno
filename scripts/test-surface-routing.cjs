const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const landing = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
const web3 = fs.readFileSync(path.join(root, 'docs', 'web3', 'index.html'), 'utf8');
const walletCore = fs.readFileSync(path.join(root, 'docs', 'assets', 'wallet-core.js'), 'utf8');
const benefitsWidget = fs.readFileSync(
  path.join(root, 'apps', 'benefits-network', 'frontend', 'src', 'components', 'CopilotWidget.tsx'),
  'utf8'
);
const rootLlms = fs.readFileSync(path.join(root, 'docs', 'llms.txt'), 'utf8');
const rootAi = fs.readFileSync(path.join(root, 'docs', 'ai.txt'), 'utf8');

for (const label of [
  'Buy / Invest in IFR',
  'Lock IFR',
  'Use IFR Benefits',
  'Build with IFR',
  'Develop with IFR',
  'Lend / Borrow / Market',
  'Contribute / Community',
  'Research / Press',
]) {
  assert.ok(landing.includes(label), `missing landing route: ${label}`);
}

for (const route of [
  'https://shop.ifrunit.tech/#customer-pass',
  'https://shop.ifrunit.tech/scan',
  'https://shop.ifrunit.tech/?mode=seller#seller-workspace',
  'https://shop.ifrunit.tech/?mode=seller#integrate',
  'https://shop.ifrunit.tech/?mode=seller#seller-session-history',
  'https://web3.ifrunit.tech/?action=access-lock#access',
  'https://web3.ifrunit.tech/?action=commitment-lock#access',
  'https://web3.ifrunit.tech/?action=lending-offer#access',
  'https://web3.ifrunit.tech/?action=borrow#access',
]) {
  assert.ok(landing.includes(route), `missing landing destination: ${route}`);
}

assert.ok(web3.includes('surface=web3'), 'Web3 Copilot must retain its contextual surface');
assert.ok(web3.includes('loading="lazy"'), 'Web3 Copilot must remain lazy-loaded');
assert.ok(web3.includes('referrerpolicy="no-referrer"'), 'Web3 Copilot must suppress referrer data');
assert.ok(web3.includes('https://shop.ifrunit.tech/'), 'Web3 must link to the live IFR Benefits app');
assert.ok(benefitsWidget.includes('surface=benefits'), 'Benefits Copilot must retain its contextual surface');
assert.ok(benefitsWidget.includes('loading="lazy"'), 'Benefits Copilot must remain lazy-loaded');
assert.ok(benefitsWidget.includes('referrerPolicy="no-referrer"'), 'Benefits Copilot must suppress referrer data');

for (const label of [
  'Customer',
  'Seller or checkout staff',
  'Manage seller profile and offers',
  'Manage checkout staff',
  'Review and export checks',
  'Generate a seller entry point',
]) {
  assert.ok(landing.includes(label), `missing expanded Benefits route: ${label}`);
}

assert.ok(landing.includes('lpAddIFRToken'), 'landing MetaMask action changed or missing');
assert.ok(landing.includes('assets/wallet-core.js'), 'landing wallet core integration changed or missing');
assert.ok(walletCore.includes('wallet_watchAsset'), 'MetaMask token import hook changed or missing');
assert.ok(rootLlms.includes('recommended customer-presented two-phase checkout pass'), 'llms.txt must describe the recommended Benefits flow');
assert.ok(rootLlms.includes('allowlisted surface context'), 'llms.txt must describe contextual Copilot routing');
assert.ok(rootAi.includes('https://shop.ifrunit.tech/llms.txt'), 'AI crawler context must link to IFR Benefits facts');

console.log('[surface-routing-test] PASS');
