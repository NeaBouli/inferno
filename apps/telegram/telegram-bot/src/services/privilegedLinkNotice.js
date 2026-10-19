'use strict';

// nonceStore.username also holds /verify's first-name fallback.
function buildPrivilegedLinkNotice({ tier, wallet, userId, username }) {
  return [
    '🔐 Privileged access linked',
    `Tier: ${tier === 'signer' ? 'Signer' : 'Council'}`,
    `Wallet: ${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
    `Telegram: ${username} (id ${userId})`,
    'If this was not you or a teammate you expect, reply here and run /unverify on that account.',
  ].join('\n');
}

module.exports = { buildPrivilegedLinkNotice };
