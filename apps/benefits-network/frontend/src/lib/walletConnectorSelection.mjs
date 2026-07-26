/**
 * @template {{ id: string, name: string, type?: string, getProvider?: () => Promise<unknown> }} T
 * @param {readonly T[]} connectors
 * @returns {Promise<T | undefined>}
 */
function isInjectedWalletConnector(connector) {
  if (connector.type) return connector.type === 'injected';
  return (
    /injected|metamask|browser wallet/i.test(`${connector.id} ${connector.name}`)
  );
}

function injectedConnectorSpecificity(connector) {
  if (connector.id === 'injected') return 0;
  return connector.id.includes('.') ? 2 : 1;
}

/**
 * Hide injected connectors that cannot provide a wallet in the current browser.
 * Prefer an EIP-6963 connector when multiple connectors resolve to the same provider.
 * Universal connectors remain available because they can open their own handoff UI.
 * @template {{ id: string, name: string, type?: string, getProvider?: () => Promise<unknown> }} T
 * @param {readonly T[]} connectors
 * @returns {Promise<T[]>}
 */
export async function listAvailableWalletConnectors(connectors) {
  const resolved = await Promise.all(connectors.map(async (connector) => {
    if (!isInjectedWalletConnector(connector)) return { connector, provider: undefined };
    if (!connector.getProvider) return { connector, unavailable: true };
    try {
      const provider = await connector.getProvider();
      return provider ? { connector, provider } : { connector, unavailable: true };
    } catch {
      return { connector, unavailable: true };
    }
  }));

  const available = [];
  const providerIndexes = new Map();
  for (const result of resolved) {
    if (result.unavailable) continue;
    if (!isInjectedWalletConnector(result.connector)) {
      available.push(result.connector);
      continue;
    }

    const existingIndex = providerIndexes.get(result.provider);
    if (existingIndex === undefined) {
      providerIndexes.set(result.provider, available.length);
      available.push(result.connector);
      continue;
    }
    if (
      injectedConnectorSpecificity(result.connector) >
      injectedConnectorSpecificity(available[existingIndex])
    ) {
      available[existingIndex] = result.connector;
    }
  }
  return available;
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
