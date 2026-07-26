/**
 * @typedef {{
 *   isMetaMask?: boolean,
 *   isCoinbaseWallet?: boolean,
 *   isTrust?: boolean,
 *   isTrustWallet?: boolean,
 *   isOkxWallet?: boolean,
 *   isOKExWallet?: boolean,
 *   isPhantom?: boolean,
 *   isRainbow?: boolean,
 *   providers?: unknown[],
 * }} InjectedProvider
 */

/**
 * @param {unknown} value
 * @returns {value is InjectedProvider}
 */
function isProvider(value) {
  return Boolean(value && (typeof value === 'object' || typeof value === 'function'));
}

/**
 * @param {InjectedProvider} provider
 */
function providerName(provider) {
  if (provider.isCoinbaseWallet) return 'Coinbase';
  if (provider.isTrust || provider.isTrustWallet) return 'Trust';
  if (provider.isOkxWallet || provider.isOKExWallet) return 'OKX';
  if (provider.isPhantom) return 'Phantom';
  if (provider.isRainbow) return 'Rainbow';
  if (provider.isMetaMask) return 'MetaMask';
  return 'Injected';
}

/**
 * @param {string[]} names
 */
function formatProviderNames(names) {
  if (names.length === 1) {
    return names[0] === 'Injected' ? 'Injected Ethereum provider' : `${names[0]} provider`;
  }
  if (names.every((name) => name === 'Injected')) return 'Multiple injected providers';
  const visibleNames = [...new Set(names)];
  if (visibleNames.length === 1) return `${visibleNames[0]} providers`;
  if (visibleNames.length === 2) return `${visibleNames[0]} and ${visibleNames[1]} providers`;
  return `${visibleNames.slice(0, -1).join(', ')} and ${visibleNames[visibleNames.length - 1]} providers`;
}

/**
 * Detect only public wallet-provider capabilities. No account or RPC request is made.
 *
 * @param {{
 *   userAgent?: string,
 *   platform?: string,
 *   maxTouchPoints?: number,
 *   ethereum?: unknown,
 *   phantomEthereum?: unknown,
 * }} environment
 */
export function detectWalletEnvironment(environment = {}) {
  const userAgent = (environment.userAgent || '').toLowerCase();
  const isIos =
    /iphone|ipad|ipod/.test(userAgent) ||
    (environment.platform === 'MacIntel' && Number(environment.maxTouchPoints) > 1);
  const surface = isIos ? 'iPad/iPhone' : userAgent.includes('android') ? 'Android' : 'Desktop';

  const ethereum = isProvider(environment.ethereum) ? environment.ethereum : undefined;
  const announcedProviders =
    ethereum && Array.isArray(ethereum.providers)
      ? ethereum.providers.filter(isProvider)
      : [];
  const candidates = announcedProviders.length > 0 ? announcedProviders : ethereum ? [ethereum] : [];
  if (isProvider(environment.phantomEthereum)) candidates.push(environment.phantomEthereum);

  const providers = [...new Set(candidates)];
  const providerNames = providers.map(providerName);
  const providerCount = providers.length;

  return {
    surface,
    provider: providerCount > 0 ? formatProviderNames(providerNames) : 'No injected provider',
    detail:
      providerCount > 0
        ? `${providerCount} provider${providerCount === 1 ? '' : 's'} available in this browser.`
        : 'Open this page inside MetaMask, Coinbase, Trust, OKX or another EVM wallet browser.',
    providerCount,
    providerNames: [...new Set(providerNames)],
  };
}
