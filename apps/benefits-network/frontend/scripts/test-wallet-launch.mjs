#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  getMobileWalletLaunches,
  getSafeShopTarget,
} from '../src/lib/walletLaunch.ts';

const canonicalOrigin = 'https://shop.ifrunit.tech';
const safePath = `${canonicalOrigin}/p/test-pass`;

assert.equal(getSafeShopTarget(`${safePath}?secret=discarded#fragment`), safePath);
assert.equal(getSafeShopTarget('/guide?source=test'), `${canonicalOrigin}/guide`);
assert.equal(getSafeShopTarget('https://evil.example/p/test-pass'), canonicalOrigin);
assert.equal(getSafeShopTarget('javascript:alert(1)'), canonicalOrigin);
assert.equal(getSafeShopTarget('http://['), canonicalOrigin);

const launches = getMobileWalletLaunches(`${safePath}?secret=discarded#fragment`);
assert.deepEqual(launches.map(({ id }) => id), ['metamask', 'trust', 'okx', 'phantom']);

const expectedHosts = {
  metamask: 'metamask.app.link',
  trust: 'link.trustwallet.com',
  okx: 'web3.okx.com',
  phantom: 'phantom.app',
};

for (const launch of launches) {
  const url = new URL(launch.href);
  const decodedHref = decodeURIComponent(decodeURIComponent(launch.href));
  assert.equal(url.protocol, 'https:', `${launch.id} must use HTTPS`);
  assert.equal(url.hostname, expectedHosts[launch.id], `${launch.id} host mismatch`);
  assert.match(decodedHref, /shop\.ifrunit\.tech\/p\/test-pass/);
  assert.doesNotMatch(launch.href, /secret|discarded|fragment/);
}

assert.match(launches.find(({ id }) => id === 'metamask').href, /\/dapp\/shop\.ifrunit\.tech\/p\/test-pass$/);
assert.equal(new URL(launches.find(({ id }) => id === 'trust').href).searchParams.get('coin_id'), '60');
assert.match(
  decodeURIComponent(new URL(launches.find(({ id }) => id === 'okx').href).searchParams.get('deeplink')),
  /^okx:\/\/wallet\/dapp\/url\?dappUrl=https:\/\/shop\.ifrunit\.tech\/p\/test-pass$/,
);
assert.equal(
  new URL(launches.find(({ id }) => id === 'phantom').href).searchParams.get('ref'),
  canonicalOrigin,
);

console.log('[wallet-launch] PASS');
