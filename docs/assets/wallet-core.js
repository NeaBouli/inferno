/**
 * IFR Wallet Core v3.0 — WalletConnect v2 + Web3Modal
 * Usage: await IFRWallet.connect(); IFRWallet.getAddress();
 *
 * v3.0 — WalletConnect v2 replaces MetaMask SDK
 *
 * WHY: MetaMask SDK deep-links break on Android Chrome
 *      (known bug since 2022, 5-6 manual steps).
 *
 * HOW:
 *   - Desktop WITH extension: MetaMask extension (instant, no modal)
 *   - Desktop WITHOUT extension: WalletConnect QR modal
 *   - Mobile: WalletConnect QR/deep-link → works with ANY wallet
 *   - Auto-reconnect from localStorage
 *   - Network auto-switch to Ethereum Mainnet
 *
 * API: 100% backward-compatible with v1.3 + v2.0 (drop-in).
 *      IFRWallet.connect/disconnect/autoReconnect
 *      IFRWallet.getAddress/getSigner/getProvider/isConnected
 *      IFRWallet.on/off/getDeepLink/isMobile/getShortAddress
 *
 * WalletConnect ProjectID registered at cloud.walletconnect.com
 */
window.IFRWallet = (function() {

  var CHAIN_ID = 1;
  var CHAIN_ID_HEX = "0x1";
  var RPC_URL = "https://eth.llamarpc.com";
  var SESSION_KEY = "ifr_wallet_connected";
  var WC_PROJECT_ID = "32f56abaa4b1d7f59fb1571c0c0a551f";

  // CDN URLs for WalletConnect v2 (lazy-loaded only when needed)
  var WC_PROVIDER_CDN = "https://unpkg.com/@walletconnect/ethereum-provider@2.17.3/dist/index.umd.js";
  var WC_MODAL_CDN = "https://unpkg.com/@walletconnect/modal@2.7.0/dist/index.umd.js";

  var _provider = null;        // ethers Web3Provider (for ifr-state.js compat)
  var _signer = null;
  var _address = null;
  var _listeners = [];
  var _ethereumProvider = null; // raw EIP-1193 provider
  var _listenersAttached = false;
  var _wcProvider = null;       // WalletConnect provider instance
  var _wcLoading = null;        // promise guard

  // ── Mobile Detection ──────────────────────────────
  function _isMobile() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  // ── Script Loader ─────────────────────────────────
  function _loadScript(src) {
    return new Promise(function(resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function() { reject(new Error("Failed to load: " + src)); };
      document.head.appendChild(s);
    });
  }

  // ── MetaMask Extension Detection (EIP-5749) ──────
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

  // ── WalletConnect v2 Provider ─────────────────────
  async function _loadWalletConnect() {
    if (_wcLoading) return _wcLoading;
    if (_wcProvider) return _wcProvider;

    _wcLoading = (async function() {
      try {
        // Load WC packages from CDN
        await Promise.all([
          _loadScript(WC_PROVIDER_CDN),
          _loadScript(WC_MODAL_CDN)
        ]);

        // Create EthereumProvider with WalletConnect v2
        var EthereumProvider = window.EthereumProvider || (window.WalletConnectEthereumProvider && window.WalletConnectEthereumProvider.EthereumProvider);

        if (!EthereumProvider) {
          // Try alternate global names
          if (window.walletconnectEthereumProvider) {
            EthereumProvider = window.walletconnectEthereumProvider.EthereumProvider;
          }
        }

        if (!EthereumProvider) {
          console.warn("[IFR Wallet] WalletConnect provider not found after CDN load");
          return null;
        }

        _wcProvider = await EthereumProvider.init({
          projectId: WC_PROJECT_ID,
          chains: [CHAIN_ID],
          showQrModal: true,
          rpcMap: { 1: RPC_URL },
          metadata: {
            name: "Inferno Protocol ($IFR)",
            description: "Deflationary ERC-20 Token — Fair Launch",
            url: "https://ifrunit.tech",
            icons: ["https://ifrunit.tech/assets/ifr_icon_256.png"]
          },
          qrModalOptions: {
            themeMode: "dark",
            themeVariables: {
              "--wcm-accent-color": "#ff4500"
            },
            explorerRecommendedWalletIds: [
              "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
              "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust
              "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369", // Rainbow
              "ef333840daf915aafdc4a004525502d6d49c8b07e0884e895a33c40355d9a2a0", // Ledger
            ]
          }
        });

        return _wcProvider;
      } catch (e) {
        console.warn("[IFR Wallet] WalletConnect init failed:", e);
        return null;
      }
    })();

    return _wcLoading;
  }

  // ── Listener Guard ────────────────────────────────
  function _attachListeners(eth) {
    if (_listenersAttached || !eth) return;
    try {
      eth.on("accountsChanged", _onAccountsChanged);
      eth.on("chainChanged", _onChainChanged);
      eth.on("disconnect", _onDisconnect);
      _listenersAttached = true;
    } catch (e) {}
  }

  function _detachListeners() {
    if (!_listenersAttached) { _listenersAttached = false; return; }
    var eth = _ethereumProvider || _wcProvider;
    if (!eth) { _listenersAttached = false; return; }
    try {
      eth.removeListener("accountsChanged", _onAccountsChanged);
      eth.removeListener("chainChanged", _onChainChanged);
      eth.removeListener("disconnect", _onDisconnect);
    } catch (e) {}
    _listenersAttached = false;
  }

  // ── Connect ───────────────────────────────────────
  async function connect() {
    var accounts;
    var eth = _getMetaMaskProvider();

    if (eth) {
      // ── Path A: Browser extension available (desktop) ──
      try {
        accounts = await eth.request({ method: "eth_requestAccounts" });
      } catch (e) {
        if (e.code === 4001 || e.code === "ACTION_REJECTED") throw e;
        if (e.code === -32002) throw e;
        throw e;
      }
    } else {
      // ── Path B: No extension → WalletConnect v2 QR modal ──
      var wc = await _loadWalletConnect();

      if (wc) {
        try {
          // This shows the QR modal automatically
          await wc.connect();
          accounts = wc.accounts;
          _ethereumProvider = wc;
        } catch (e) {
          if (e.message && e.message.indexOf("User") !== -1) throw e;
          // WC failed — try deep-link as last resort on mobile
          if (_isMobile()) {
            window.location.href = getDeepLink();
            return;
          }
          throw e;
        }
      } else {
        // WC didn't load — deep-link on mobile, error on desktop
        if (_isMobile()) {
          window.location.href = getDeepLink();
          return;
        }
        throw new Error("NO_WALLET");
      }
    }

    if (!accounts || accounts.length === 0) throw new Error("NO_ACCOUNTS");

    eth = _ethereumProvider || _getMetaMaskProvider();

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

    localStorage.setItem(SESSION_KEY, _address);
    _attachListeners(eth);
    _emit("connected", _address);
    return _address;
  }

  // ── Disconnect ────────────────────────────────────
  function disconnect() {
    _detachListeners();

    // Terminate WalletConnect session if active
    if (_wcProvider) {
      try { _wcProvider.disconnect(); } catch (e) {}
      _wcProvider = null;
      _wcLoading = null;
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
    // Migrate from legacy sessionStorage
    if (!saved) {
      saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        localStorage.setItem(SESSION_KEY, saved);
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
    if (!saved) return false;

    // Only auto-reconnect via extension (not WC — requires user action)
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
    var eth = _ethereumProvider || _getMetaMaskProvider();
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

  function _onDisconnect() {
    disconnect();
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
