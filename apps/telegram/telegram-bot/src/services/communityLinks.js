'use strict';

// Match parsed origins and path boundaries, never substrings in arbitrary URLs.
function isAllowedCommunityLink(value) {
  try {
    const url = new URL(/^t\.me\//i.test(value) ? `https://${value}` : value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (['ifrunit.tech', 'www.ifrunit.tech', 'web3.ifrunit.tech', 'shop.ifrunit.tech', 'etherscan.io'].includes(host)) return true;
    if (host === 'github.com') return /^\/NeaBouli(?:\/|$)/i.test(url.pathname);
    if (host === 't.me') return /^\/(IFRtoken|IFR_token)(?:\/|$)/i.test(url.pathname);
    return false;
  } catch {
    return false;
  }
}

module.exports = { isAllowedCommunityLink };
