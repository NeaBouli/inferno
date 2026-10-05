// T-280: keep third-party wallet SDKs dormant until the visitor picks them.
//
// Wagmi's reconnect-on-mount calls getProvider() on every configured
// connector, and the WalletConnect connector also does so from setup(). For
// SDK connectors (Coinbase Wallet, WalletConnect/AppKit) that call creates the
// SDK, which immediately contacts third-party hosts — including analytics
// events that cannot be switched off through connector options (AppKit sends a
// mandatory INITIALIZE event to pulse.walletconnect.org). This wrapper makes
// such a connector report "no provider / not authorized" until either
//   - the visitor explicitly starts connect() with it, or
//   - it is wagmi's recent connector (the visitor chose it before), so an
//     existing session is still restored on page load.
// Connect, signing and session behaviour after that point are unchanged.

export const RECENT_CONNECTOR_STORAGE_KEY = 'recentConnectorId';

/**
 * @template {(config: any) => any} T
 * @param {T} connectorFn wagmi CreateConnectorFn (e.g. coinbaseWallet(...))
 * @returns {T}
 */
export function deferUntilChosen(connectorFn) {
  const deferred = (config) => {
    const base = connectorFn(config);
    let chosen = false;

    async function activated() {
      if (chosen) return true;
      try {
        return (await config.storage?.getItem(RECENT_CONNECTOR_STORAGE_KEY)) === base.id;
      } catch {
        return false;
      }
    }

    return {
      ...base,
      async connect(parameters) {
        chosen = true;
        return base.connect.call(this, parameters);
      },
      async disconnect() {
        if (!(await activated())) return;
        return base.disconnect.call(this);
      },
      async getProvider(parameters) {
        if (!(await activated())) return undefined;
        return base.getProvider.call(this, parameters);
      },
      async isAuthorized() {
        if (!(await activated())) return false;
        return base.isAuthorized.call(this);
      },
    };
  };
  return /** @type {T} */ (/** @type {unknown} */ (deferred));
}
