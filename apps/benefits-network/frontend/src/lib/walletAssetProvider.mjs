/**
 * @typedef {{ request(args: { method: string, params?: unknown }): Promise<unknown> }} WalletRequestProvider
 */

/**
 * @param {unknown} value
 * @returns {value is WalletRequestProvider}
 */
export function isWalletRequestProvider(value) {
  return Boolean(value && typeof value === 'object' && typeof value.request === 'function');
}

/**
 * Never cross from an active Wagmi connector to an unrelated injected provider.
 * @param {{ connectorActive: boolean, connectorProvider: unknown, injectedProvider: unknown }} input
 * @returns {WalletRequestProvider | undefined}
 */
export function selectWalletAssetProvider({ connectorActive, connectorProvider, injectedProvider }) {
  if (connectorActive) {
    return isWalletRequestProvider(connectorProvider) ? connectorProvider : undefined;
  }
  return isWalletRequestProvider(injectedProvider) ? injectedProvider : undefined;
}

/**
 * @param {{
 *   provider: WalletRequestProvider,
 *   chainId: number,
 *   address: string,
 *   symbol: string,
 *   decimals: number,
 *   image: string,
 * }} input
 */
export async function requestWalletAsset({ provider, chainId, address, symbol, decimals, image }) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Invalid wallet asset chain ID.');
  const expectedChain = `0x${chainId.toString(16)}`;
  const currentChain = await provider.request({ method: 'eth_chainId' }).catch(() => undefined);
  if (currentChain !== expectedChain) {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: expectedChain }],
    });
  }
  const result = await provider.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: { address, symbol, decimals, image },
    },
  });
  return result !== false;
}
