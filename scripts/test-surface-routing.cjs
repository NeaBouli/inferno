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
  'https://shop.ifrunit.tech/#seller-workspace',
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
assert.ok(benefitsWidget.includes('surface=benefits'), 'Benefits Copilot must retain its contextual surface');
assert.ok(benefitsWidget.includes('loading="lazy"'), 'Benefits Copilot must remain lazy-loaded');
assert.ok(benefitsWidget.includes('referrerPolicy="no-referrer"'), 'Benefits Copilot must suppress referrer data');

assert.ok(landing.includes('lpAddIFRToken'), 'landing MetaMask action changed or missing');
assert.ok(landing.includes('assets/wallet-core.js'), 'landing wallet core integration changed or missing');
assert.ok(walletCore.includes('wallet_watchAsset'), 'MetaMask token import hook changed or missing');

console.log('[surface-routing-test] PASS');
