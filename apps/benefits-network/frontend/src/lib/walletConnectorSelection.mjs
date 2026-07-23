/**
 * @template {{ id: string, name: string, type?: string, getProvider?: () => Promise<unknown> }} T
 * @param {readonly T[]} connectors
 * @returns {Promise<T | undefined>}
 */
export async function selectPreferredWalletConnector(connectors) {
  const injected = connectors.filter((connector) => (
    connector.type === 'injected' ||
    /injected|metamask|browser wallet/i.test(`${connector.id} ${connector.name}`)
  ));

  for (const connector of injected) {
    if (!connector.getProvider) continue;
    try {
      if (await connector.getProvider()) return connector;
    } catch {
      // Try the next announced provider or a universal connector.
    }
  }

  return connectors.find((connector) => connector.id === 'coinbaseWalletSDK') ||
    connectors.find((connector) => connector.id === 'walletConnect') ||
    connectors.find((connector) => !injected.includes(connector)) ||
    connectors[0];
}

/**
 * @param {{ id: string, name: string }} connector
 */
export function walletConnectorLabel(connector) {
  if (connector.id === 'injected') return 'Browser wallet';
  if (connector.id === 'coinbaseWalletSDK') return 'Coinbase Wallet';
  if (connector.id === 'walletConnect') return 'WalletConnect';
  return connector.name;
}

/**
 * @param {unknown} error
 */
export function walletConnectionErrorMessage(error) {
  const message = error instanceof Error ? error.message : '';
  if (/rejected|denied|cancel/i.test(message)) return 'Connection cancelled in the wallet.';
  if (/provider|not found|unavailable|unsupported/i.test(message)) {
    return 'No compatible wallet provider was found. Open this page in your wallet app browser or choose another wallet connection.';
  }
  return message || 'Wallet connection failed. Open this page in your wallet app browser and try again.';
}
