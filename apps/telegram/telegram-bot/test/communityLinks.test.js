'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedCommunityLink } = require('../src/services/communityLinks');

test('allows only exact project origins and scoped account paths', () => {
  for (const url of ['https://ifrunit.tech/wiki/liquidity.html', 'https://web3.ifrunit.tech/', 'https://shop.ifrunit.tech/', 'https://etherscan.io/token/0x1', 'https://github.com/NeaBouli/inferno', 'https://github.com/NeaBouli', 't.me/IFR_token/436', 'https://T.ME/IFRtoken']) {
    assert.equal(isAllowedCommunityLink(url), true, url);
  }
});

test('rejects spoof hosts, credentials, prefixes, redirects and other origins', () => {
  for (const url of ['https://ifrunit.tech.evil.example/', 'https://evil.example/ifrunit.tech', 'https://evil.example/?next=https://ifrunit.tech', 'https://ifrunit.tech@evil.example', 'https://user@ifrunit.tech/', 'https://github.com/NeaBouliFake', 'https://t.me/IFRtokenScam', 'https://notifrunit.tech', 'http://ifrunit.tech', 'https://ifrunit.tech:8443', 'javascript:alert(1)', 'not a url', 'https://github.com/Other', 'https://t.me/Other', 'https://github.com/NeaBouli/../Other']) {
    assert.equal(isAllowedCommunityLink(url), false, url);
  }
});
