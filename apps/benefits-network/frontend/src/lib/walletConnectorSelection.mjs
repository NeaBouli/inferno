/**
 * @template {{ id: string, name: string, type?: string, getProvider?: () => Promise<unknown> }} T
 * @param {readonly T[]} connectors
 * @returns {Promise<T | undefined>}
 */
function isInjectedWalletConnector(connector) {
  return (
    connector.type === 'injected' ||
    /injected|metamask|browser wallet/i.test(`${connector.id} ${connector.name}`)
  );
}

/**
 * Hide injected connectors that cannot provide a wallet in the current browser.
 * Universal connectors remain available because they can open their own handoff UI.
 * @template {{ id: string, name: string, type?: string, getProvider?: () => Promise<unknown> }} T
 * @param {readonly T[]} connectors
 * @returns {Promise<T[]>}
 */
export async function listAvailableWalletConnectors(connectors) {
  const availability = await Promise.all(connectors.map(async (connector) => {
    if (!isInjectedWalletConnector(connector)) return true;
    if (!connector.getProvider) return false;
    try {
      return Boolean(await connector.getProvider());
    } catch {
      return false;
    }
  }));

  return connectors.filter((_, index) => availability[index]);
}

export async function selectPreferredWalletConnector(connectors) {
  const available = await listAvailableWalletConnectors(connectors);
  const injected = available.filter(isInjectedWalletConnector);

  return injected[0] ||
    available.find((connector) => connector.id === 'coinbaseWalletSDK') ||
    available.find((connector) => connector.id === 'walletConnect') ||
    available[0];
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
