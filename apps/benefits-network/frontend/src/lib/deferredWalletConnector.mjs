// T-280: keep third-party wallet SDKs dormant until the visitor picks them.
//
// Wagmi's reconnect-on-mount calls getProvider() on every configured
// connector, and the WalletConnect connector also does so from setup(). For
// SDK connectors (Coinbase Wallet, WalletConnect/AppKit) that call creates the
// SDK, which immediately contacts third-party hosts — including analytics
// events that cannot be switched off through connector options (AppKit sends a
// mandatory INITIALIZE event to pulse.walletconnect.org). This wrapper makes
// such a connector report "no provider / not authorized" until either
//   - the visitor explicitly starts connect() with it in this page, or
//   - the visitor is still connected with it: a successful connect() stores a
//     session marker in Wagmi's storage, so the session restores on reload.
// The marker (and Wagmi's recentConnectorId for this connector) is cleared on
// disconnect from the app, on a wallet-side disconnect and when a restore
// finds the session gone, so a returning visitor who disconnected loads no
// wallet SDK until they choose one again.
// Wagmi's own persisted `store` is not usable as that signal: with `ssr: true`
// it is overwritten with the empty pre-hydration state before reconnect runs.
// Connect, signing and session behaviour are otherwise unchanged.

export const RECENT_CONNECTOR_STORAGE_KEY = 'recentConnectorId';
export const SDK_SESSION_STORAGE_KEY = 'deferredSdkConnectorId';

/**
 * @template {(config: any) => any} T
 * @param {T} connectorFn wagmi CreateConnectorFn (e.g. coinbaseWallet(...))
 * @returns {T}
 */
export function deferUntilChosen(connectorFn) {
  const deferred = (config) => {
    const base = connectorFn(config);
    let chosen = false;
    // Once the SDK exists in this page there is nothing left to defer; this
    // keeps the SDK's own event handlers (disconnect, account changes) working.
    let initialized = false;

    async function hasSessionMarker() {
      try {
        return (await config.storage?.getItem(SDK_SESSION_STORAGE_KEY)) === base.id;
      } catch {
        return false;
      }
    }

    async function activated() {
      return chosen || initialized || hasSessionMarker();
    }

    async function forgetChoice() {
      chosen = false;
      try {
        for (const key of [SDK_SESSION_STORAGE_KEY, RECENT_CONNECTOR_STORAGE_KEY]) {
          if ((await config.storage?.getItem(key)) === base.id) await config.storage?.removeItem(key);
        }
      } catch {
        // Storage unavailable: nothing persisted to clear.
      }
    }

    return {
      ...base,
      async connect(parameters) {
        chosen = true;
        const result = await base.connect.call(this, parameters);
        try {
          await config.storage?.setItem(SDK_SESSION_STORAGE_KEY, base.id);
        } catch {
          // Without storage the session simply is not restored on reload.
        }
        return result;
      },
      async disconnect() {
        try {
          if (await activated()) await base.disconnect.call(this);
        } finally {
          await forgetChoice();
        }
      },
      async onDisconnect(error) {
        // Wallet-side disconnect (session deleted in the wallet app).
        try {
          return await base.onDisconnect.call(this, error);
        } finally {
          await forgetChoice();
        }
      },
      async getProvider(parameters) {
        if (!(await activated())) return undefined;
        const provider = await base.getProvider.call(this, parameters);
        if (provider) initialized = true;
        return provider;
      },
      async isAuthorized() {
        if (!(await activated())) return false;
        const authorized = await base.isAuthorized.call(this);
        // Restore found no live session: stay dormant on the next visit.
        if (!authorized && !chosen) await forgetChoice();
        return authorized;
      },
    };
  };
  return /** @type {T} */ (/** @type {unknown} */ (deferred));
}
