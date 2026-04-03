/**
 * IFR Wallet Core — v1.2
 * Central wallet session manager for all IFR pages.
 * Usage: await IFRWallet.connect(); IFRWallet.getAddress();
 *
 * v1.2 — Stable MetaMask integration with all bug fixes
 *  - 30s connect timeout (prevents hanging)
 *  - accountsChanged re-creates provider/signer
 *  - Event listener guard (no accumulation)
 *  - Clean disconnect with full storage cleanup
 *  - Mobile deep-link with 2s delay
 *  - async/await throughout (matches all page callers)
 *
 * WalletConnect v2: requires bundler (webpack/vite) — planned for Phase 2 build setup
 */
window.IFRWallet = (function() {

  // ── Constants ──────────────────────────────────────
  var CHAIN_ID = 1;
  var RPC_URL  = "https://eth.llamarpc.com";
  var CONNECT_TIMEOUT_MS = 30000;
  var SESSION_KEY = "ifr_wallet_connected";
  var PENDING_KEY = "ifr_pending_connect";

  // ── Internal State ─────────────────────────────────
  var _provider = null;
  var _signer = null;
  var _address = null;
  var _listeners = [];
  var _ethereumProvider = null;
  var _listenersAttached = false;

  // ── Injected Provider Detection (EIP-5749) ─────────
  function _getMetaMaskProvider() {
    if (_ethereumProvider) return _ethereumProvider;
    if (window.ethereum && window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
      _ethereumProvider = window.ethereum.providers.find(function(p) {
        return p.isMetaMask && !p.isExodus && !p.isBraveWallet;
      }) || window.ethereum.providers[0] || window.ethereum;
    } else if (window.ethereum && window.ethereum.isMetaMask) {
      _ethereumProvider = window.ethereum;
    } else if (window.ethereum) {
      _ethereumProvider = window.ethereum;
    }
    return _ethereumProvider || null;
  }

  // ── Listener Management (guarded) ──────────────────
  function _attachListeners(eth) {
    if (_listenersAttached || !eth) return;
    eth.on("accountsChanged", _onAccountsChanged);
    eth.on("chainChanged", _onChainChanged);
    _listenersAttached = true;
  }

  function _detachListeners() {
    if (!_listenersAttached || !_ethereumProvider) {
      _listenersAttached = false;
      return;
    }
    try {
      _ethereumProvider.removeListener("accountsChanged", _onAccountsChanged);
      _ethereumProvider.removeListener("chainChanged", _onChainChanged);
    } catch(e) {}
    _listenersAttached = false;
  }

  // ── Connect (with 30s timeout) ─────────────────────
  async function connect() {
    var eth = _getMetaMaskProvider();
    if (!eth) {
      throw new Error("NO_METAMASK");
    }

    // Race: MetaMask approval vs 30s timeout
    var accounts = await Promise.race([
      eth.request({ method: "eth_requestAccounts" }),
      new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error("CONNECT_TIMEOUT")); }, CONNECT_TIMEOUT_MS);
      })
    ]);

    if (!accounts || accounts.length === 0) throw new Error("NO_ACCOUNTS");

    _provider = new ethers.providers.Web3Provider(eth);
    _signer = _provider.getSigner();
    _address = accounts[0];

    // Check network
    var network = await _provider.getNetwork();
    if (network.chainId !== CHAIN_ID) {
      await switchToMainnet();
    }

    // Save session
    sessionStorage.setItem(SESSION_KEY, _address);

    // Attach listeners (guarded)
    _attachListeners(eth);

    _emit("connected", _address);
    return _address;
  }

  // ── Disconnect ─────────────────────────────────────
  function disconnect() {
    _detachListeners();

    _provider = null;
    _signer = null;
    _address = null;
    _ethereumProvider = null;

    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(PENDING_KEY);

    _emit("disconnected", null);
  }

  // ── Auto-Reconnect ─────────────────────────────────
  async function autoReconnect() {
    var saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return false;

    var eth = _getMetaMaskProvider();
    if (!eth) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }

    try {
      var accounts = await eth.request({ method: "eth_accounts" });
      if (!accounts || accounts.length === 0) {
        sessionStorage.removeItem(SESSION_KEY);
        return false;
      }

      var match = accounts.find(function(a) {
        return a.toLowerCase() === saved.toLowerCase();
      });
      if (!match) {
        sessionStorage.removeItem(SESSION_KEY);
        return false;
      }

      _provider = new ethers.providers.Web3Provider(eth);
      _signer = _provider.getSigner();
      _address = match;
      _ethereumProvider = eth;

      _attachListeners(eth);
      _emit("connected", _address);
      return true;
    } catch(e) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }
  }

  // ── Network Switch ─────────────────────────────────
  async function switchToMainnet() {
    var eth = _getMetaMaskProvider();
    if (!eth) return;
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }]
    });
  }

  // ── Getters ────────────────────────────────────────
  function isConnected() { return _address !== null; }
  function getAddress()  { return _address; }
  function getSigner()   { return _signer; }

  function getShortAddress(addr) {
    var a = addr || _address;
    if (!a) return "";
    return "\u2B24 " + a.slice(0, 6);
  }

  function getProvider() {
    if (_provider) return _provider;
    return new ethers.providers.JsonRpcProvider(RPC_URL);
  }

  // ── Event System ───────────────────────────────────
  function on(event, cb)  { _listeners.push({ event: event, cb: cb }); }
  function off(event, cb) { _listeners = _listeners.filter(function(l) { return l.cb !== cb; }); }

  function _emit(event, data) {
    _listeners.forEach(function(l) {
      if (l.event === event) l.cb(data);
    });
  }

  // ── Internal Event Handlers ────────────────────────
  function _onAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) {
      disconnect();
      return;
    }
    // Re-create provider + signer for new account
    var eth = _getMetaMaskProvider();
    if (eth) {
      _provider = new ethers.providers.Web3Provider(eth);
      _signer = _provider.getSigner();
    }
    _address = accounts[0];
    sessionStorage.setItem(SESSION_KEY, _address);
    _emit("accountChanged", _address);
  }

  function _onChainChanged() {
    _detachListeners();
    window.location.reload();
  }

  // ── Mobile Helpers ─────────────────────────────────
  function getDeepLink() {
    var clean = window.location.href.replace(/^https?:\/\//, "");
    return "https://metamask.app.link/dapp/" + clean;
  }

  function isMobile() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  // Auto-connect after MetaMask deep-link return
  if (sessionStorage.getItem(PENDING_KEY) === "1") {
    sessionStorage.removeItem(PENDING_KEY);
    setTimeout(function() {
      var eth = _getMetaMaskProvider();
      if (eth) connect().catch(function() {});
    }, 2000);
  }

  // ── Public API ─────────────────────────────────────
  return {
    connect:         connect,
    disconnect:      disconnect,
    autoReconnect:   autoReconnect,
    isConnected:     isConnected,
    getAddress:      getAddress,
    getShortAddress: getShortAddress,
    getSigner:       getSigner,
    getProvider:     getProvider,
    on:              on,
    off:             off,
    getDeepLink:     getDeepLink,
    isMobile:        isMobile
  };
})();
