/**
 * IFR Wallet Core — v1.1
 * Central wallet session manager for all IFR pages.
 * Usage: await IFRWallet.connect(); IFRWallet.getAddress();
 *
 * v1.1 fixes (based on StealthX WalletConnectManager patterns):
 *  - accountsChanged re-creates provider/signer (was only updating address)
 *  - connect() has 30s timeout (was infinite)
 *  - Event listener guard prevents accumulation on autoReconnect
 *  - Disconnect clears all wallet-related storage keys
 *  - Mobile deep-link retry with 2s timeout (was 500ms)
 */
window.IFRWallet = (() => {

  // ── Konstanten ──────────────────────────────────────
  const CHAIN_ID = 1; // Ethereum Mainnet
  const CHAIN_NAME = "Ethereum Mainnet";
  const RPC_URL = "https://eth.llamarpc.com";
  const CONNECT_TIMEOUT_MS = 30000; // 30s like StealthX

  // ── Interner State ──────────────────────────────────
  let _provider = null;
  let _signer = null;
  let _address = null;
  let _listeners = [];  // Callbacks für UI-Updates
  let _ethereumProvider = null; // Resolved MetaMask provider (multi-wallet safe)
  let _listenersAttached = false; // Guard against duplicate event listeners

  // ── Session Storage Key ─────────────────────────────
  const SESSION_KEY = "ifr_wallet_connected";

  // ── Multi-Wallet MetaMask Detection (EIP-5749) ─────
  function _getMetaMaskProvider() {
    if (_ethereumProvider) return _ethereumProvider;
    // EIP-5749: multiple wallets inject into providers array
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

  // ── Attach/Detach Provider Listeners ───────────────
  function _attachProviderListeners(eth) {
    if (_listenersAttached) return;
    eth.on("accountsChanged", _onAccountsChanged);
    eth.on("chainChanged", _onChainChanged);
    _listenersAttached = true;
  }

  function _detachProviderListeners() {
    if (!_listenersAttached || !_ethereumProvider) return;
    try {
      _ethereumProvider.removeListener("accountsChanged", _onAccountsChanged);
      _ethereumProvider.removeListener("chainChanged", _onChainChanged);
    } catch(e) {}
    _listenersAttached = false;
  }

  // ── Connect (with timeout) ────────────────────────
  async function connect() {
    const eth = _getMetaMaskProvider();
    if (!eth) {
      throw new Error("NO_METAMASK");
    }

    // 30s timeout — prevents hanging if MetaMask doesn't respond
    const accountsPromise = eth.request({ method: "eth_requestAccounts" });
    const timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error("CONNECT_TIMEOUT")); }, CONNECT_TIMEOUT_MS);
    });
    const accounts = await Promise.race([accountsPromise, timeoutPromise]);
    if (!accounts || accounts.length === 0) throw new Error("NO_ACCOUNTS");

    _provider = new ethers.providers.Web3Provider(eth);
    _signer = _provider.getSigner();
    _address = accounts[0];

    // Netzwerk prüfen
    const network = await _provider.getNetwork();
    if (network.chainId !== CHAIN_ID) {
      await switchToMainnet();
    }

    // Session merken
    sessionStorage.setItem(SESSION_KEY, _address);

    // Attach listeners (guarded — no duplicates)
    _attachProviderListeners(eth);

    _emit("connected", _address);
    return _address;
  }

  // ── Disconnect ───────────────────────────────────────
  function disconnect() {
    // Remove event listeners before clearing provider ref
    _detachProviderListeners();

    // Full state reset
    _provider = null;
    _signer = null;
    _address = null;
    _ethereumProvider = null;

    // Clear all wallet-related storage
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("ifr_pending_connect");
    // Clear WalletConnect v2 session data if present
    try {
      var keys = Object.keys(localStorage);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf("wc@2:") === 0 || keys[i].indexOf("wagmi.") === 0) {
          localStorage.removeItem(keys[i]);
        }
      }
    } catch(e) {}

    // Fire UI event
    _emit("disconnected", null);
  }

  // ── Auto-Reconnect (bei Seitenlade) ─────────────────
  async function autoReconnect() {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return false;

    const eth = _getMetaMaskProvider();
    if (!eth) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }

    try {
      // eth_accounts: no popup, returns only already-authorized accounts
      const accounts = await eth.request({ method: "eth_accounts" });
      if (!accounts || accounts.length === 0) {
        sessionStorage.removeItem(SESSION_KEY);
        return false;
      }

      // Check if saved account is still active
      const match = accounts.find(function(a) {
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

      // Attach listeners (guarded — no duplicates)
      _attachProviderListeners(eth);

      _emit("connected", _address);
      return true;
    } catch(e) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }
  }

  // ── Netzwerk-Switch ──────────────────────────────────
  async function switchToMainnet() {
    const eth = _getMetaMaskProvider();
    if (!eth) return;
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }]
    });
  }

  // ── Getter ───────────────────────────────────────────
  function isConnected() { return _address !== null; }
  function getAddress() { return _address; }
  function getShortAddress(addr) {
    const a = addr || _address;
    if (!a) return "";
    return "\u2B24 " + a.slice(0, 6);
  }
  function getSigner() { return _signer; }
  function getProvider() {
    if (_provider) return _provider;
    return new ethers.providers.JsonRpcProvider(RPC_URL);
  }

  // ── Event System ────────────────────────────────────
  function on(event, cb) { _listeners.push({ event, cb }); }
  function off(event, cb) { _listeners = _listeners.filter(l => l.cb !== cb); }
  function _emit(event, data) { _listeners.filter(l => l.event === event).forEach(l => l.cb(data)); }

  // ── Internal Handlers ────────────────────────────────
  function _onAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) {
      disconnect();
    } else {
      var newAddr = accounts[0];
      // Re-create provider/signer for new account (StealthX pattern)
      var eth = _getMetaMaskProvider();
      if (eth) {
        _provider = new ethers.providers.Web3Provider(eth);
        _signer = _provider.getSigner();
      }
      _address = newAddr;
      sessionStorage.setItem(SESSION_KEY, _address);
      _emit("accountChanged", _address);
    }
  }

  function _onChainChanged() {
    // Clean up before reload to prevent stale listeners
    _detachProviderListeners();
    window.location.reload();
  }

  // ── Mobile Deep-Link ──────────────────────────────────
  const PENDING_KEY = "ifr_pending_connect";

  function getDeepLink() {
    const clean = window.location.href.replace(/^https?:\/\//, "");
    return "https://metamask.app.link/dapp/" + clean;
  }

  function isMobile() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  // Auto-connect after MetaMask deep-link return (2s delay for mobile)
  if (sessionStorage.getItem(PENDING_KEY) === "1") {
    sessionStorage.removeItem(PENDING_KEY);
    setTimeout(function() {
      const eth = _getMetaMaskProvider();
      if (eth) connect().catch(function() {});
    }, 2000);
  }

  // ── Public API ───────────────────────────────────────
  return { connect, disconnect, autoReconnect, isConnected,
           getAddress, getShortAddress, getSigner, getProvider,
           on, off, getDeepLink, isMobile };
})();
