const SOFT_WAIT_MS = 12_000;
const NATIVE_IDS = new Set(['injected', 'metaMask', 'io.metamask']);

export const PROBE_METHODS = Object.freeze([
  { method: 'eth_accounts', label: 'Check accounts already shared', interactive: false },
  { method: 'eth_chainId', label: 'Check active network', interactive: false },
  { method: 'wallet_getPermissions', label: 'Check site permissions', interactive: false },
  { method: 'wallet_requestPermissions', label: 'Ask for account permission', interactive: true },
  { method: 'eth_requestAccounts', label: 'Request accounts from MetaMask', interactive: true },
].map(Object.freeze));

export function isEligibleNativeConnector(connector) {
  return Boolean(connector && connector.type === 'injected' &&
    NATIVE_IDS.has(connector.id) && typeof connector.getProvider === 'function');
}

export function isOrdinaryWalletBusy(queryClient, config) {
  return queryClient.isMutating({ mutationKey: ['connect'], exact: true }) > 0 ||
    config.state.status === 'connecting' || config.state.status === 'reconnecting';
}

function requestArguments(method) {
  switch (method) {
    case 'eth_accounts': return { method: 'eth_accounts' };
    case 'eth_chainId': return { method: 'eth_chainId' };
    case 'wallet_getPermissions': return { method: 'wallet_getPermissions' };
    case 'wallet_requestPermissions':
      return { method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] };
    case 'eth_requestAccounts': return { method: 'eth_requestAccounts' };
    default: return undefined;
  }
}

function resultSummary(value) {
  try {
    if (value === null) return { shape: 'null', count: null };
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, 'length');
      return length && Number.isSafeInteger(length.value) && length.value >= 0
        ? { shape: 'array', count: length.value }
        : { shape: 'unreadable', count: null };
    }
    const kind = typeof value;
    return { shape: ['string', 'object', 'number', 'boolean', 'undefined'].includes(kind)
      ? kind : 'unreadable', count: null };
  } catch {
    return { shape: 'unreadable', count: null };
  }
}

function ownNumericCode(value) {
  try {
    if (value === null || !['object', 'function'].includes(typeof value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'code');
    return descriptor && Number.isSafeInteger(descriptor.value) ? descriptor.value : null;
  } catch {
    return null;
  }
}

// One instance is shared by this document's route mounts. There is deliberately
// no reset/cancel API: a soft wait or unmount cannot unlock a native request.
export function createNativeWalletProbe({
  now = () => performance.now(),
  schedule = (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancelScheduled = (handle) => clearTimeout(handle),
} = {}) {
  const listeners = new Set();
  let active = null;
  let snapshot = Object.freeze({ pending: false, current: null, records: Object.freeze([]) });

  function publish(record, pending) {
    const current = Object.freeze(record);
    const records = pending ? snapshot.records : Object.freeze(PROBE_METHODS.flatMap(({ method }) => {
      const previous = snapshot.records.find((item) => item.method === method);
      return method === current.method ? [current] : previous ? [previous] : [];
    }));
    snapshot = Object.freeze({ pending, current, records });
    for (const listener of listeners) {
      try { listener(); } catch { /* UI observers cannot change wallet outcomes. */ }
    }
  }

  async function start({ method, connector, isCurrent, isOrdinaryPending }) {
    const definition = PROBE_METHODS.find((item) => item.method === method);
    if (active || !definition) return;
    const token = {};
    active = token;
    const startedMs = now();
    let timer;
    let longWait = false;
    let stage = 'provider';
    const record = (state, summary = { shape: null, count: null }, errorCode = null) => ({
      method: definition.method, state, startedMs, elapsedMs: Math.max(0, Math.round(now() - startedMs)),
      shape: summary.shape, count: summary.count, errorCode,
    });
    const waiting = () => publish(record(`${stage}_waiting${longWait ? '_long' : ''}`), true);
    const finish = (state, summary, errorCode) => {
      if (active !== token) return;
      if (timer !== undefined) cancelScheduled(timer);
      active = null;
      publish(record(state, summary, errorCode), false);
    };

    try {
      if (!isEligibleNativeConnector(connector)) { finish('provider_unavailable'); return; }
      if (!isCurrent()) { finish('not_sent'); return; }
      if (definition.interactive && isOrdinaryPending()) { finish('ordinary_busy'); return; }
      waiting();
      timer = schedule(() => {
        if (active !== token) return;
        longWait = true;
        waiting();
      }, SOFT_WAIT_MS);
      const provider = await connector.getProvider();
      if (!isCurrent()) { finish('not_sent'); return; }
      if (!provider || provider.isMetaMask !== true || typeof provider.request !== 'function') {
        finish('provider_unavailable'); return;
      }
      stage = 'request';
      waiting();
      // Fresh checks follow the await and UI notification, immediately before
      // dispatch. A stale owner/selection must never send a late native RPC.
      if (!isCurrent()) { finish('not_sent'); return; }
      if (definition.interactive && isOrdinaryPending()) { finish('ordinary_busy'); return; }
      const value = await provider.request(requestArguments(definition.method));
      finish('answered', resultSummary(value));
    } catch (error) {
      finish('error', undefined, ownNumericCode(error));
    }
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
  });
}

export const nativeWalletProbe = createNativeWalletProbe();
