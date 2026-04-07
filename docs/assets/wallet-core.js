/**
 * IFR Wallet Core — v2.0 (MetaMask SDK)
 * Usage: await IFRWallet.connect(); IFRWallet.getAddress();
 *
 * v2.0 — MetaMask SDK integration
 *   - Desktop: MetaMask extension via EIP-5749 + SDK fallback
 *   - Mobile: Automatic deep-link to MetaMask app via SDK
 *   - Persistent sessions via localStorage
 *   - Auto-reconnect on page reload
 *   - Network auto-switch to Ethereum Mainnet
 *   - 100% backward-compatible API (drop-in replacement for v1.3)
 */
window.IFRWallet = (function() {

  var CHAIN_ID = 1;
  var CHAIN_ID_HEX = "0x1";
  var RPC_URL = "https://eth.llamarpc.com";
  var SESSION_KEY = "ifr_wallet_connected";
  var SDK_CDN = "https://unpkg.com/@metamask/sdk@0.31.2/dist/browser/umd/metamask-sdk.js";

  var _provider = null;   // ethers Web3Provider
  var _signer = null;
  var _address = null;
  var _listeners = [];
  var _ethereumProvider = null;  // raw EIP-1193 provider
  var _listenersAttached = false;
  var _sdk = null;
  var _sdkLoading = null;  // promise guard

  // ── Mobile Detection ──────────────────────────────
  function _isMobile() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  // ── MetaMask SDK Loader ───────────────────────────
  function _loadSDK() {
    if (_sdkLoading) return _sdkLoading;
    if (_sdk) return Promise.resolve(_sdk);

    _sdkLoading = new Promise(function(resolve, reject) {
      // Already loaded globally?
      if (typeof MetaMaskSDK !== "undefined") {
        _sdk = new MetaMaskSDK.MetaMaskSDK({
          dappMetadata: {
            name: "Inferno Protocol ($IFR)",
            url: "https://ifrunit.tech",
            iconUrl: "https://ifrunit.tech/assets/ifr_icon_256.png"
          },
          useDeeplink: true,
          enableAnalytics: false,
          defaultReadOnlyChainId: CHAIN_ID_HEX
        });
        resolve(_sdk);
        return;
      }

      var script = document.createElement("script");
      script.src = SDK_CDN;
      script.onload = function() {
        try {
          _sdk = new MetaMaskSDK.MetaMaskSDK({
            dappMetadata: {
              name: "Inferno Protocol ($IFR)",
              url: "https://ifrunit.tech",
              iconUrl: "https://ifrunit.tech/assets/ifr_icon_256.png"
            },
            useDeeplink: true,
            enableAnalytics: false,
            defaultReadOnlyChainId: CHAIN_ID_HEX
          });
          resolve(_sdk);
        } catch (e) {
          console.warn("[IFR Wallet] SDK init failed:", e);
          resolve(null);
        }
      };
      script.onerror = function() {
        console.warn("[IFR Wallet] SDK CDN unavailable, using extension-only mode");
        resolve(null);
      };
      document.head.appendChild(script);
    });

    return _sdkLoading;
  }

  // ── Provider Detection (EIP-5749 + SDK) ───────────
  function _getMetaMaskProvider() {
    if (_ethereumProvider) return _ethereumProvider;

    // Multi-provider environment (EIP-5749)
    if (window.ethereum && window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
      _ethereumProvider = window.ethereum.providers.find(function(p) {
        return p.isMetaMask && !p.isExodus && !p.isBraveWallet;
      }) || window.ethereum.providers[0] || window.ethereum;
    } else if (window.ethereum && window.ethereum.isMetaMask) {
      _ethereumProvider = window.ethereum;
    } else if (window.ethereum) {
      _ethereumProvider = window.ethereum;
    }

    // SDK provider as fallback
    if (!_ethereumProvider && _sdk) {
      try {
        _ethereumProvider = _sdk.getProvider();
      } catch (e) {}
    }

    return _ethereumProvider || null;
  }

  // ── Listener Guard ────────────────────────────────
  function _attachListeners(eth) {
    if (_listenersAttached || !eth) return;
    try {
      eth.on("accountsChanged", _onAccountsChanged);
      eth.on("chainChanged", _onChainChanged);
      _listenersAttached = true;
    } catch (e) {}
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

  // ── Connect ───────────────────────────────────────
  async function connect() {
    var accounts;

    // Mobile without extension → use SDK for deep-link
    if (_isMobile() && !window.ethereum) {
      await _loadSDK();
      if (_sdk) {
        try {
          accounts = await _sdk.connect();
          _ethereumProvider = _sdk.getProvider();
        } catch (e) {
          if (e.code === 4001 || e.code === "ACTION_REJECTED") throw e;
          // SDK connect failed — try deep-link as last resort
          window.location.href = getDeepLink();
          return;
        }
      } else {
        // SDK didn't load — direct deep-link
        window.location.href = getDeepLink();
        return;
      }
    } else {
      // Desktop or mobile with extension
      var eth = _getMetaMaskProvider();

      // No extension found — try loading SDK
      if (!eth) {
        await _loadSDK();
        eth = _getMetaMaskProvider();
      }

      if (!eth) throw new Error("NO_METAMASK");

      try {
        accounts = await eth.request({ method: "eth_requestAccounts" });
      } catch (e) {
        if (e.code === 4001 || e.code === "ACTION_REJECTED") throw e;
        if (e.code === -32002) throw e;  // already processing
        throw e;
      }
    }

    if (!accounts || accounts.length === 0) throw new Error("NO_ACCOUNTS");

    var eth = _getMetaMaskProvider();

    // Create ethers provider (backward compat with ifr-state.js)
    _provider = new ethers.providers.Web3Provider(eth, "any");
    _signer = _provider.getSigner();
    _address = accounts[0];

    // Network check — non-fatal
    try {
      var network = await _provider.getNetwork();
      if (network.chainId !== CHAIN_ID) {
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN_ID_HEX }]
          });
          _provider = new ethers.providers.Web3Provider(eth, "any");
          _signer = _provider.getSigner();
        } catch (switchErr) {
          console.warn("IFRWallet: chain switch rejected, continuing on current chain");
        }
      }
    } catch (netErr) {
      console.warn("IFRWallet: getNetwork() failed, continuing:", netErr.message);
    }

    // Persist to localStorage (survives tab close, unlike sessionStorage)
    localStorage.setItem(SESSION_KEY, _address);
    _attachListeners(eth);
    _emit("connected", _address);
    return _address;
  }

  // ── Disconnect ────────────────────────────────────
  function disconnect() {
    _detachListeners();

    // Terminate SDK session if active
    if (_sdk) {
      try { _sdk.terminate(); } catch (e) {}
    }

    _provider = null;
    _signer = null;
    _address = null;
    _ethereumProvider = null;
    localStorage.removeItem(SESSION_KEY);
    _emit("disconnected", null);
  }

  // ── Auto-Reconnect ───────────────────────────────
  async function autoReconnect() {
    var saved = localStorage.getItem(SESSION_KEY);
    // Also check legacy sessionStorage
    if (!saved) {
      saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        localStorage.setItem(SESSION_KEY, saved);
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
    if (!saved) return false;

    var eth = _getMetaMaskProvider();
    if (!eth) { localStorage.removeItem(SESSION_KEY); return false; }

    try {
      var accounts = await eth.request({ method: "eth_accounts" });
      if (!accounts || accounts.length === 0) {
        localStorage.removeItem(SESSION_KEY); return false;
      }
      var match = accounts.find(function(a) {
        return a.toLowerCase() === saved.toLowerCase();
      });
      if (!match) { localStorage.removeItem(SESSION_KEY); return false; }

      _provider = new ethers.providers.Web3Provider(eth, "any");
      _signer = _provider.getSigner();
      _address = match;
      _ethereumProvider = eth;
      _attachListeners(eth);
      _emit("connected", _address);
      return true;
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
  }

  // ── Getters ───────────────────────────────────────
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

  // ── Events ────────────────────────────────────────
  function on(event, cb) { _listeners.push({ event: event, cb: cb }); }
  function off(event, cb) { _listeners = _listeners.filter(function(l) { return l.cb !== cb; }); }
  function _emit(event, data) {
    _listeners.forEach(function(l) { if (l.event === event) l.cb(data); });
  }

  // ── Internal Handlers ─────────────────────────────
  function _onAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) { disconnect(); return; }
    var eth = _getMetaMaskProvider();
    if (eth) {
      _provider = new ethers.providers.Web3Provider(eth, "any");
      _signer = _provider.getSigner();
    }
    _address = accounts[0];
    localStorage.setItem(SESSION_KEY, _address);
    _emit("accountChanged", _address);
  }

  function _onChainChanged() {
    _detachListeners();
    window.location.reload();
  }

  // ── Mobile Helpers ────────────────────────────────
  function getDeepLink() {
    return "https://metamask.app.link/dapp/" + window.location.href.replace(/^https?:\/\//, "");
  }
  function isMobile() { return _isMobile(); }

  return {
    connect: connect, disconnect: disconnect, autoReconnect: autoReconnect,
    isConnected: isConnected, getAddress: getAddress, getShortAddress: getShortAddress,
    getSigner: getSigner, getProvider: getProvider,
    on: on, off: off, getDeepLink: getDeepLink, isMobile: isMobile
  };
})();
