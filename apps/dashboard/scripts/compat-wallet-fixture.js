// Local preview fixture only. Never imported by the application or build.
(() => {
  const nativeFetch = window.fetch.bind(window);
  const listeners = new Map();
  const events = [];
  const allowedStates = new Set([
    'disconnected', 'connected', 'unsupported', 'owner', 'loading', 'error', 'long',
  ]);
  const requested = new URL(window.location.href).searchParams.get('fixture');
  let state = allowedStates.has(requested) ? requested : 'disconnected';
  let connected = state !== 'disconnected';
  let chainId = state === 'unsupported' ? '0x7a69' : '0xaa36a7';
  const account = () => state === 'owner'
    ? '0x2222222222222222222222222222222222222222'
    : '0x1111111111111111111111111111111111111111';
  const record = (kind, method) => events.push({ kind, method });
  const denied = (method, code = 4200) => {
    record('denied', method);
    return Object.assign(new Error('Synthetic fixture denies ' + method), { code });
  };
  const emit = (name, value) => {
    for (const callback of listeners.get(name) || []) callback(value);
  };
  const provider = {
    isMetaMask: true,
    isConnected: () => connected,
    get selectedAddress() { return connected ? account() : null; },
    get chainId() { return chainId; },
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
      return provider;
    },
    removeListener(name, callback) {
      listeners.get(name)?.delete(callback);
      return provider;
    },
    removeAllListeners(name) {
      if (name) listeners.delete(name);
      else listeners.clear();
      return provider;
    },
    async request({ method, params }) {
      record('wallet', method);
      if (/sign|send|submit|broadcast/i.test(method)) throw denied(method, 4001);
      if (method === 'eth_chainId') return chainId;
      if (method === 'net_version') return String(parseInt(chainId, 16));
      if (method === 'eth_accounts') return connected ? [account()] : [];
      if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
        connected = true;
        emit('accountsChanged', [account()]);
        return method === 'eth_requestAccounts' ? [account()] : [{ parentCapability: 'eth_accounts' }];
      }
      if (method === 'wallet_getPermissions') {
        return connected ? [{ parentCapability: 'eth_accounts' }] : [];
      }
      if (method === 'wallet_revokePermissions') {
        connected = false;
        emit('accountsChanged', []);
        emit('disconnect', { code: 4900, message: 'Synthetic disconnect' });
        return null;
      }
      if (method === 'wallet_switchEthereumChain') {
        if (params?.[0]?.chainId !== '0xaa36a7') throw denied(method, 4902);
        chainId = '0xaa36a7';
        emit('chainChanged', chainId);
        return null;
      }
      if (method === 'eth_call' || method === 'eth_getBalance' || method === 'eth_blockNumber') {
        const response = await nativeFetch('/__compat__/rpc?fixture=' + state, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        const result = await response.json();
        if (result.error) throw Object.assign(new Error(result.error.message), result.error);
        return result.result;
      }
      throw denied(method);
    },
  };
  Object.defineProperty(window, 'ethereum', { value: provider, writable: false, configurable: false });
  const icon = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#f6851b"/><text x="10" y="40" font-size="20">TEST</text></svg>',
  );
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: Object.freeze({
      info: Object.freeze({
        uuid: '711bbde6-78c9-4b3a-aa0e-0589951e6098',
        name: 'MetaMask (Synthetic fixture)', icon, rdns: 'io.metamask',
      }), provider,
    }),
  }));
  window.addEventListener('eip6963:announceProvider', (event) => {
    if (event.detail?.provider !== provider) event.stopImmediatePropagation();
  }, true);
  window.addEventListener('eip6963:requestProvider', announce);
  announce();

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url,
      window.location.href);
    if (url.origin === window.location.origin) return nativeFetch(input, init);
    let body = init.body;
    if (body === undefined && input instanceof Request) body = await input.clone().text();
    else if (body !== undefined && typeof body !== 'string') body = await new Response(body).text();
    let parsed;
    try { parsed = JSON.parse(body); } catch { /* Non-RPC traffic is denied below. */ }
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    if (calls.length && calls.every((call) => call?.jsonrpc === '2.0' && typeof call.method === 'string')) {
      calls.forEach((call) => record('redirected-rpc', call.method));
      return nativeFetch('/__compat__/rpc?fixture=' + state, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
        signal: init.signal,
      });
    }
    throw denied('external-fetch');
  };
  const blockedTransport = class {
    constructor() { throw denied('external-stream'); }
  };
  window.WebSocket = blockedTransport;
  window.EventSource = blockedTransport;
  Object.defineProperty(navigator, 'sendBeacon', { value: () => {
    record('denied', 'sendBeacon');
    return false;
  } });
  window.__IFR_DASHBOARD_FIXTURE__ = Object.freeze({
    syntheticOnly: true,
    states: Object.freeze([...allowedStates]),
    snapshot: () => ({ state, connected, chainId, account: account(), events: [...events] }),
    setState(next) {
      if (!allowedStates.has(next)) throw new Error('Unknown synthetic state');
      state = next;
      connected = state !== 'disconnected';
      chainId = state === 'unsupported' ? '0x7a69' : '0xaa36a7';
      emit('chainChanged', chainId);
      emit('accountsChanged', connected ? [account()] : []);
    },
  });
})();
