const SHOP_ORIGIN = 'https://shop.ifrunit.tech';

export type MobileWalletLaunch = {
  id: 'metamask' | 'trust' | 'okx' | 'phantom';
  label: string;
  href: string;
};

export function getSafeShopTarget(rawUrl: string) {
  try {
    const url = new URL(rawUrl, SHOP_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== SHOP_ORIGIN) return SHOP_ORIGIN;
    return `${SHOP_ORIGIN}${url.pathname}`;
  } catch {
    return SHOP_ORIGIN;
  }
}

export function getMobileWalletLaunches(rawUrl: string): MobileWalletLaunch[] {
  const target = getSafeShopTarget(rawUrl);
  const encodedTarget = encodeURIComponent(target);
  const metamaskTarget = target.slice('https://'.length);
  const okxDeepLink = `okx://wallet/dapp/url?dappUrl=${encodedTarget}`;

  return [
    {
      id: 'metamask',
      label: 'Open in MetaMask',
      href: `https://metamask.app.link/dapp/${metamaskTarget}`,
    },
    {
      id: 'trust',
      label: 'Open in Trust Wallet',
      href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodedTarget}`,
    },
    {
      id: 'okx',
      label: 'Open in OKX',
      href: `https://web3.okx.com/download?deeplink=${encodeURIComponent(okxDeepLink)}`,
    },
    {
      id: 'phantom',
      label: 'Open in Phantom',
      href: `https://phantom.app/ul/browse/${encodedTarget}?ref=${encodeURIComponent(SHOP_ORIGIN)}`,
    },
  ];
}
