'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPrivilegedLinkNotice } = require('../src/services/privilegedLinkNotice');

const wallet = '0x1234567890abcdef1234567890abcdef1234abcd';

for (const tier of ['signer', 'council']) {
  test(`${tier} notice includes the shortened wallet and Telegram account id`, () => {
    assert.equal(buildPrivilegedLinkNotice({ tier, wallet, userId: '123456789', username: 'teammate' }), [
      '🔐 Privileged access linked',
      `Tier: ${tier === 'signer' ? 'Signer' : 'Council'}`,
      'Wallet: 0x1234...abcd',
      'Telegram: teammate (id 123456789)',
      'If this was not you or a teammate you expect, reply here and run /unverify on that account.',
    ].join('\n'));
  });
}

test('notice preserves Markdown characters and the stored first-name fallback verbatim', () => {
  for (const username of ['team_[member]*`name`', 'First [Name]']) {
    const text = buildPrivilegedLinkNotice({ tier: 'signer', wallet, userId: '123456789', username });
    assert.ok(text.includes(`Telegram: ${username} (id 123456789)`));
    assert.ok(!text.includes(wallet), 'full wallet must not appear');
  }
});
