// Wagmi's mount snapshot does not revisit a late injected/EIP-6963 provider.
// Consent markers only select a connector; restoration always reads live data.
const controllers = new WeakMap();
const STARTUP_WINDOW_MS = 10_000;
const MAX_ATTEMPTS = 8;
const RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000, 6000];

export function cancelInjectedSessionRestoration(config) {
  controllers.get(config)?.cancel();
}

export function startInjectedSessionRestoration(config, { reconnect, watchConnectors, browser }) {
  cancelInjectedSessionRestoration(config);
  let startup = true;
  let cancelled = false;
  let generation = 0;
  let intendedId;
  let busy = false;
  let queued = false;
  let attempts = 0;
  let ownedState;
  let unwatchState = () => {};
  let unwatchConnectors = () => {};
  let removeProviderListeners = () => {};
  const timers = new Set();

  function stopStartup() {
    startup = false;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    browser.removeEventListener('ethereum#initialized', kick);
    unwatchConnectors();
  }

  function cancel() {
    if (cancelled) return;
    cancelled = true;
    generation += 1;
    stopStartup();
    removeProviderListeners();
    unwatchState();
    // Never overwrite an intervening user mutation or an active connection.
    if (config.state === ownedState && !config.state.current && config.state.status === 'connecting') {
      config.setState((state) => ({ ...state, status: 'disconnected' }));
    }
    if (controllers.get(config) === controller) controllers.delete(config);
  }

  const controller = { cancel };
  controllers.set(config, controller);
  const live = (epoch) => startup && !cancelled && epoch === generation;
  async function assertIntent(epoch) {
    if (!live(epoch)) throw new Error('Injected startup restoration ended');
    const recent = await config.storage?.getItem('recentConnectorId');
    if (!live(epoch) || recent !== intendedId) throw new Error('Injected connection intent changed');
    const disconnected = await config.storage?.getItem(`${intendedId}.disconnected`);
    if (!live(epoch) || disconnected) throw new Error('Injected connector is explicitly disconnected');
  }

  function attachProviderListeners(provider, connector, epoch) {
    removeProviderListeners();
    const connectionIsCurrent = () => !cancelled && epoch === generation &&
      config.state.status === 'connected' && config.state.current === connector.uid;
    const invalidatePending = () => {
      if (startup && !cancelled) {
        // An account change invalidates an in-flight startup response. Retry
        // with the new generation instead of committing its old account.
        generation += 1;
        if (config.state === ownedState && !config.state.current) {
          config.setState((state) => ({ ...state, status: 'disconnected' }));
        }
        queued = true;
        kick();
        return true;
      }
      return false;
    };
    const accountsChanged = async () => {
      if (invalidatePending()) return;
      if (!connectionIsCurrent()) return;
      try {
        const accounts = await connector.getAccounts();
        if (!connectionIsCurrent()) return;
        if (!accounts.length) connector.emitter.emit('disconnect');
        else connector.emitter.emit('change', { accounts });
      } catch {
        if (connectionIsCurrent()) connector.emitter.emit('disconnect');
      }
    };
    const chainChanged = (chain) => {
      if (invalidatePending()) return;
      if (connectionIsCurrent()) connector.emitter.emit('change', { chainId: Number(chain) });
    };
    const disconnected = () => {
      // Cancel a passive response even if the connection has not committed yet.
      cancel();
      connector.emitter.emit('disconnect');
    };
    const entries = [['accountsChanged', accountsChanged], ['chainChanged', chainChanged], ['disconnect', disconnected]];
    for (const [event, listener] of entries) provider.on(event, listener);
    removeProviderListeners = () => {
      for (const [event, listener] of entries) provider.removeListener(event, listener);
      removeProviderListeners = () => {};
    };
  }

  async function attempt() {
    const epoch = generation;
    try {
      if (!live(epoch) || config.state.status !== 'disconnected') return;
      const recent = await config.storage?.getItem('recentConnectorId');
      if (!live(epoch)) return;
      if (intendedId === undefined) {
        if (typeof recent !== 'string' || !recent) return cancel();
        intendedId = recent;
      }
      await assertIntent(epoch);
      const connector = config.connectors.find((entry) => entry.id === intendedId && entry.type === 'injected');
      if (!connector || attempts >= MAX_ATTEMPTS) return;
      const provider = await connector.getProvider();
      await assertIntent(epoch);
      if (!provider || typeof provider.on !== 'function' || typeof provider.removeListener !== 'function') return;
      attempts += 1;
      attachProviderListeners(provider, connector, epoch);
      const assertProvider = async () => {
        await assertIntent(epoch);
        try {
          if (await connector.getProvider() !== provider) throw new Error('Injected provider identity changed');
        } catch (error) {
          cancel();
          throw error;
        }
        await assertIntent(epoch);
      };
      // Keep the original UID/emitter and explicit actions. The native injected
      // connect writes consent shims after async RPCs; this passive adapter must
      // never erase a new Disconnect decision while a response is pending.
      const restoringConnector = {
        ...connector,
        async isAuthorized() {
          try {
            await assertProvider();
            const authorized = await connector.isAuthorized();
            await assertProvider();
            return authorized;
          } catch { return false; }
        },
        async connect(parameters) {
          if (!parameters?.isReconnecting) throw new Error('Startup restoration must remain passive');
          await assertProvider();
          const accounts = await connector.getAccounts();
          await assertProvider();
          if (!accounts.length) throw new Error('No live authorized account');
          const chainId = await connector.getChainId();
          await assertProvider();
          return { accounts, chainId };
        },
      };
      const restoringConfig = Object.create(config);
      restoringConfig.setState = (value) => {
        // Suppress Core's late state commit after a new explicit user action.
        if (!live(epoch)) return;
        config.setState(value);
        ownedState = config.state;
      };
      await reconnect(restoringConfig, { connectors: [restoringConnector] });
      if (config.state.status !== 'connected' || config.state.current !== connector.uid) {
        removeProviderListeners();
      }
    } catch {
      // Storage denial or changed consent fails closed. A merely unavailable or
      // empty provider can still use the finite startup readiness retries.
      if (startup && !cancelled && epoch !== generation) return;
      try { await assertIntent(epoch); } catch { cancel(); }
    }
  }

  function kick() {
    if (!startup || cancelled) return;
    if (busy) { queued = true; return; }
    busy = true;
    attempt().finally(() => {
      busy = false;
      if (queued && startup) {
        queued = false;
        schedule(100);
      }
    });
  }

  function schedule(delay) {
    const timer = setTimeout(() => { timers.delete(timer); kick(); }, delay);
    timers.add(timer);
  }

  unwatchState = config.subscribe((state) => state.status, (status) => {
    if (status === 'connected') stopStartup();
    else if (!startup) cancel();
    else if (status === 'disconnected' && !busy) kick();
  });
  unwatchConnectors = watchConnectors(config, { onChange: kick });
  browser.addEventListener('ethereum#initialized', kick);
  for (const delay of RETRY_DELAYS_MS) schedule(delay);
  const deadline = setTimeout(cancel, STARTUP_WINDOW_MS);
  timers.add(deadline);
  return cancel;
}
