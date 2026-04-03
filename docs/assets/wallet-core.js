/**
 * IFR Wallet Core — v1.3
 * Usage: await IFRWallet.connect(); IFRWallet.getAddress();
 *
 * v1.3 — Bulletproof connect: every async step wrapped in try/catch
 */
window.IFRWallet = (function() {

  var CHAIN_ID = 1;
  var RPC_URL = "https://eth.llamarpc.com";
  var SESSION_KEY = "ifr_wallet_connected";
  var PENDING_KEY = "ifr_pending_connect";

  var _provider = null;
  var _signer = null;
  var _address = null;
  var _listeners = [];
  var _ethereumProvider = null;
  var _listenersAttached = false;

  // ── MetaMask Detection (EIP-5749) ──────────────────
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

  // ── Listener Guard ─────────────────────────────────
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
    } catch (e) {}
    _listenersAttached = false;
  }

  // ── Connect ────────────────────────────────────────
  async function connect() {
    var eth = _getMetaMaskProvider();
    if (!eth) throw new Error("NO_METAMASK");

    // Step 1: Request accounts from MetaMask
    var accounts;
    try {
      accounts = await eth.request({ method: "eth_requestAccounts" });
    } catch (e) {
      // MetaMask user rejection or "already processing"
      if (e.code === 4001 || e.code === "ACTION_REJECTED") throw e;
      if (e.code === -32002) throw e; // already processing — let page handle
      throw e;
    }

    if (!accounts || accounts.length === 0) throw new Error("NO_ACCOUNTS");

    // Step 2: Create ethers provider
    _provider = new ethers.providers.Web3Provider(eth, "any");
    _signer = _provider.getSigner();
    _address = accounts[0];

    // Step 3: Network check — non-fatal
    try {
      var network = await _provider.getNetwork();
      if (network.chainId !== CHAIN_ID) {
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x1" }]
          });
          // Re-create provider after chain switch
          _provider = new ethers.providers.Web3Provider(eth, "any");
          _signer = _provider.getSigner();
        } catch (switchErr) {
          // User rejected chain switch — proceed anyway, they stay on wrong chain
          console.warn("IFRWallet: chain switch rejected, continuing on current chain");
        }
      }
    } catch (netErr) {
      // getNetwork() failed — proceed anyway with what we have
      console.warn("IFRWallet: getNetwork() failed, continuing:", netErr.message);
    }

    // Step 4: Save + emit
    sessionStorage.setItem(SESSION_KEY, _address);
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
    if (!eth) { sessionStorage.removeItem(SESSION_KEY); return false; }

    try {
      var accounts = await eth.request({ method: "eth_accounts" });
      if (!accounts || accounts.length === 0) {
        sessionStorage.removeItem(SESSION_KEY);
        return false;
      }
      var match = accounts.find(function(a) {
        return a.toLowerCase() === saved.toLowerCase();
      });
      if (!match) { sessionStorage.removeItem(SESSION_KEY); return false; }

      _provider = new ethers.providers.Web3Provider(eth, "any");
      _signer = _provider.getSigner();
      _address = match;
      _ethereumProvider = eth;
      _attachListeners(eth);
      _emit("connected", _address);
      return true;
    } catch (e) {
      sessionStorage.removeItem(SESSION_KEY);
      return false;
    }
  }

  // ── Getters ────────────────────────────────────────
  function isConnected() { return _address !== null; }
  function getAddress() { return _address; }
  function getSigner() { return _signer; }
  function getShortAddress(addr) {
    var a = addr || _address;
    return a ? ("\u2B24 " + a.slice(0, 6)) : "";
  }
  function getProvider() {
    return _provider || new ethers.providers.JsonRpcProvider(RPC_URL);
  }

  // ── Events ─────────────────────────────────────────
  function on(event, cb) { _listeners.push({ event: event, cb: cb }); }
  function off(event, cb) { _listeners = _listeners.filter(function(l) { return l.cb !== cb; }); }
  function _emit(event, data) {
    _listeners.forEach(function(l) { if (l.event === event) l.cb(data); });
  }

  // ── Internal Handlers ──────────────────────────────
  function _onAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) { disconnect(); return; }
    var eth = _getMetaMaskProvider();
    if (eth) {
      _provider = new ethers.providers.Web3Provider(eth, "any");
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

  // ── Mobile ─────────────────────────────────────────
  function getDeepLink() {
    return "https://metamask.app.link/dapp/" + window.location.href.replace(/^https?:\/\//, "");
  }
  function isMobile() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  // Deep-link return auto-connect
  if (sessionStorage.getItem(PENDING_KEY) === "1") {
    sessionStorage.removeItem(PENDING_KEY);
    setTimeout(function() {
      if (_getMetaMaskProvider()) connect().catch(function() {});
    }, 2000);
  }

  return {
    connect: connect, disconnect: disconnect, autoReconnect: autoReconnect,
    isConnected: isConnected, getAddress: getAddress, getShortAddress: getShortAddress,
    getSigner: getSigner, getProvider: getProvider,
    on: on, off: off, getDeepLink: getDeepLink, isMobile: isMobile
  };
})();
