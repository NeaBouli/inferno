/**
 * IFR Web3 Wallet Core v1.0 — Mobile + WalletConnect v2 via self-hosted artifact
 * Usage: await IFRWallet.connect(); IFRWallet.getAddress();
 *
 * v4.3.2 — Read-only getProvider() uses an ethers v6 FallbackProvider over
 *   CORS-capable public endpoints (publicnode primary), same list and chainId
 *   pin as docs/assets/wallet-core.js v4.2.3. Each endpoint must answer
 *   eth_chainId 0x1 before it may serve data; a visible notice and the
 *   "rpcError" event fire when no endpoint is usable.
 *
 * v4.3.1 — WalletConnect provider loads from the pinned same-origin artifact
 *   /assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js instead of
 *   a third-party CDN (CWA-47). No third-party code executes at runtime.
 *
 * v4.3 — Mobile/tablet wallet connect restored.
 *   Supports injected EIP-1193 wallets in wallet browsers first, then
 *   WalletConnect v2 for MetaMask, Rainbow, Trust Wallet, Coinbase Wallet,
 *   OKX, Rabby, Zerion and other WalletConnect-compatible wallets.
 *
 * v4.2 — Historical release with desktop-only mobile policy.
 *
 * v4.1 — dynamic import() from a CDN (superseded by v4.3.1).
 * v4.0 — Fixes v3.0 broken UMD bundles
 *
 * FLOW:
 *   - Mobile/tablet WITH wallet browser: injected EIP-1193 provider
 *   - Mobile/tablet WITHOUT injected wallet: WalletConnect mobile selector
 *   - Desktop WITH extension: injected EIP-1193 provider
 *   - Desktop WITHOUT extension: WalletConnect QR modal (self-hosted)
 *   - Auto-reconnect from localStorage + WC session persistence
 *
 * Web3-only connector. Main ifrunit.tech and wiki keep the shared
 * minimalist docs/assets/wallet-core.js implementation.
 *
 * API: 100% backward-compatible (v1.3 → v4.3 drop-in).
 *      IFRWallet.connect/disconnect/autoReconnect
 *      IFRWallet.getAddress/getSigner/getProvider/isConnected
 *      IFRWallet.on/off/getDeepLink/isMobile/isMobileOrTablet/getShortAddress
 *
 * WalletConnect ProjectID: cloud.walletconnect.com (Reown)
 */
window.IFRWallet = (function() {

  var CHAIN_ID = 1;
  var CHAIN_ID_HEX = "0x1";
  // Public Mainnet endpoints that answer browser CORS preflights (verified
  // 2026-10-03, same list as docs/assets/wallet-core.js). Order =
  // FallbackProvider priority; the first is the primary.
  var RPC_URLS = [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.drpc.org",
    "https://1rpc.io/eth"
  ];
  var RPC_URL = RPC_URLS[0];
  var RPC_TIMEOUT_MS = 8000;
  var SESSION_KEY = "ifr_web3_wallet_connected";
  var WC_PROJECT_ID = "32f56abaa4b1d7f59fb1571c0c0a551f";
  var IFR_TOKEN_ADDRESS = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
  var IFR_TOKEN_SYMBOL = "IFR";
  var IFR_TOKEN_DECIMALS = 9;
  var IFR_TOKEN_IMAGE = "https://ifrunit.tech/assets/ifr_icon_256.png";

  // Self-hosted pinned artifact (built reproducibly from
  // infra/web3/walletconnect-provider; SHA-256 gated in CI). Same-origin ESM,
  // no runtime third-party code fetch (CWA-47).
  var WC_PROVIDER_URL = "/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js";

  var _provider = null;        // ethers Web3Provider (for ifr-state.js compat)
  var _signer = null;
  var _address = null;
  var _listeners = [];
  var _ethereumProvider = null; // raw EIP-1193 provider
  var _listenersAttached = false;
  var _wcProvider = null;       // WalletConnect provider instance
  var _wcLoading = null;        // promise guard
  var _readProvider = null;     // ethers FallbackProvider for read-only calls
  var _wcUri = null;
  var _wcAttempt = 0;           // bumped per WalletConnect attempt and on cancel
  var _connectionLabel = null;
  var _announcedProviders = [];
  var _lastWalletList = [];

  function _rememberAnnouncedProvider(event) {
    var detail = event && event.detail;
    if (!detail || !detail.provider || !detail.info) return;
    var uuid = String(detail.info.uuid || "").trim();
    var existingIndex = _announcedProviders.findIndex(function(entry) {
      return (uuid && entry.info.uuid === uuid) || entry.provider === detail.provider;
    });
    var entry = {
      provider: detail.provider,
      info: {
        uuid: uuid,
        name: String(detail.info.name || "").trim().slice(0, 64),
        icon: typeof detail.info.icon === "string" && detail.info.icon.indexOf("data:image/") === 0
          ? detail.info.icon
          : null,
        rdns: String(detail.info.rdns || "").trim().slice(0, 128)
      }
    };
    if (existingIndex >= 0) _announcedProviders[existingIndex] = entry;
    else _announcedProviders.push(entry);
  }

  window.addEventListener("eip6963:announceProvider", _rememberAnnouncedProvider);

  // ── Mobile / Tablet Detection ─────────────────────
  function _isMobile() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  function _isMobileOrTablet() {
    if (/Mobi|Android|iPhone|iPad|iPod|tablet/i.test(navigator.userAgent)) return true;
    // iPad with desktop UA (iPadOS 13+)
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
    // Touch-only device with small/medium screen
    if ("ontouchstart" in window && window.innerWidth < 1024) return true;
    return false;
  }

  function _isMainnetChainId(chainId) {
    if (typeof chainId === "number") {
      return Number.isSafeInteger(chainId) && chainId === CHAIN_ID;
    }
    var normalized = String(chainId == null ? "" : chainId).trim().toLowerCase();
    if (!normalized) return false;
    var parsed;
    if (/^0x[0-9a-f]+$/.test(normalized)) {
      parsed = Number.parseInt(normalized.slice(2), 16);
    } else if (/^[0-9]+$/.test(normalized)) {
      parsed = Number(normalized);
    } else {
      return false;
    }
    return Number.isSafeInteger(parsed) && parsed === CHAIN_ID;
  }

  async function _ensureMainnetProvider(eth) {
    if (!eth || typeof eth.request !== "function") {
      throw new Error("Wallet provider is unavailable.");
    }

    var chainId = await eth.request({ method: "eth_chainId" });
    if (!_isMainnetChainId(chainId)) {
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CHAIN_ID_HEX }]
        });
      } catch (switchError) {
        var rejected = new Error("Switch your wallet to Ethereum Mainnet (chain 1) before continuing.");
        rejected.code = "WRONG_NETWORK";
        rejected.cause = switchError;
        throw rejected;
      }

      chainId = await eth.request({ method: "eth_chainId" });
      if (!_isMainnetChainId(chainId)) {
        var unchanged = new Error("Wallet network did not change. Select Ethereum Mainnet (chain 1) and try again.");
        unchanged.code = "WRONG_NETWORK";
        throw unchanged;
      }
    }

    return true;
  }

  // ── Wallet Help Modal ───────────────────────────────
  var _walletHelpModalShown = false;

  function _showWalletHelpModal(message) {
    if (_walletHelpModalShown) return;
    _walletHelpModalShown = true;
    var overlay = document.createElement("div");
    overlay.id = "ifr-wallet-help-modal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);";

    var card = document.createElement("div");
    card.style.cssText = "background:#111827;border:1px solid #374151;border-radius:12px;padding:28px;max-width:430px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.6);";

    card.innerHTML =
      '<h3 style="color:#f97316;font-family:system-ui,-apple-system,sans-serif;font-size:1.1rem;margin:0 0 12px;">Wallet connection</h3>' +
      '<p style="color:#d1d5db;font-size:0.94rem;line-height:1.6;margin:0 0 22px;">' + (message || "Use an injected wallet browser or WalletConnect-compatible wallet.") + '</p>' +
      '<button id="ifr-wallet-help-close" style="background:#f97316;color:white;border:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:0.95rem;cursor:pointer;">Got it</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var closeBtn = document.getElementById("ifr-wallet-help-close");
    function closeModal() {
      var el = document.getElementById("ifr-wallet-help-modal");
      if (el) el.remove();
      _walletHelpModalShown = false;
    }
    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function(e) { if (e.target === overlay) closeModal(); });
  }

  // ── Injected Wallet Detection (EIP-1193 / EIP-5749) ─
  function _isMetaMaskProvider(provider) {
    return Boolean(
      provider &&
      provider.isMetaMask &&
      !provider.isExodus &&
      !provider.isBraveWallet &&
      !provider.isPhantom &&
      !provider.isRabby &&
      !provider.isOkxWallet &&
      !provider.isOKExWallet
    );
  }

  function _getConnectionLabel(provider) {
    if (!provider) return null;
    if (provider === _wcProvider) return "WalletConnect";
    var announced = _announcedProviders.find(function(entry) { return entry.provider === provider; });
    if (announced && announced.info.name) return announced.info.name;
    if (_isMetaMaskProvider(provider)) return "MetaMask";
    if (provider.isCoinbaseWallet) return "Coinbase Wallet";
    if (provider.isTrust || provider.isTrustWallet) return "Trust Wallet";
    if (provider.isOkxWallet || provider.isOKExWallet) return "OKX Wallet";
    if (provider.isPhantom) return "Phantom";
    if (provider.isRabby) return "Rabby Wallet";
    if (provider.isBraveWallet) return "Brave Wallet";
    return "Browser wallet";
  }

  function _getMetaMaskProvider() {
    if (_ethereumProvider) return _ethereumProvider;

    if (window.ethereum && window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
      _ethereumProvider = window.ethereum.providers.find(function(p) {
        return _isMetaMaskProvider(p);
      }) || window.ethereum.providers[0] || window.ethereum;
    } else if (window.ethereum && window.ethereum.isMetaMask) {
      _ethereumProvider = window.ethereum;
    } else if (window.ethereum) {
      _ethereumProvider = window.ethereum;
    }

    return _ethereumProvider || null;
  }

  function _buildWalletList() {
    var wallets = [];
    var seenProviders = [];

    _announcedProviders.forEach(function(entry, index) {
      if (!entry.provider || seenProviders.indexOf(entry.provider) !== -1) return;
      seenProviders.push(entry.provider);
      wallets.push({
        id: "eip6963:" + (entry.info.uuid || index),
        type: "injected",
        name: entry.info.name || _getConnectionLabel(entry.provider),
        icon: entry.info.icon,
        rdns: entry.info.rdns || null,
        provider: entry.provider
      });
    });

    var legacyProviders = [];
    if (window.ethereum && Array.isArray(window.ethereum.providers) && window.ethereum.providers.length > 0) {
      legacyProviders = window.ethereum.providers.slice();
    } else if (window.ethereum) {
      legacyProviders.push(window.ethereum);
    }
    legacyProviders.forEach(function(provider, index) {
      if (!provider || seenProviders.indexOf(provider) !== -1) return;
      seenProviders.push(provider);
      wallets.push({
        id: "legacy:" + index,
        type: "injected",
        name: _getConnectionLabel(provider),
        icon: null,
        rdns: null,
        provider: provider
      });
    });

    wallets.push({
      id: "walletconnect",
      type: "walletconnect",
      name: "WalletConnect",
      icon: null,
      rdns: null,
      provider: null
    });
    _lastWalletList = wallets;
    return wallets;
  }

  function listWallets() {
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (e) {}
    return new Promise(function(resolve) {
      window.setTimeout(function() { resolve(_buildWalletList()); }, 80);
    });
  }

  // ── WalletConnect v2 Provider (dynamic ESM import) ─
  async function _loadWalletConnect() {
    if (_wcProvider) return _wcProvider;
    if (_wcLoading) return _wcLoading;

    var loading = _wcLoading = (async function() {
      try {
        // dynamic import() of the self-hosted pinned artifact — same origin,
        // works in all modern browsers.
        // Internally imports @walletconnect/modal for QR display.
        var mod = await import(WC_PROVIDER_URL);
        var EthereumProvider = mod.EthereumProvider || mod.default;

        if (!EthereumProvider) {
          console.warn("[IFR Web3 Wallet] EthereumProvider not found in ESM module");
          if (_wcLoading === loading) _wcLoading = null;
          return null;
        }

        var wcInstance = await EthereumProvider.init({
          projectId: WC_PROJECT_ID,
          chains: [CHAIN_ID],
          optionalChains: [CHAIN_ID],
          methods: ["eth_sendTransaction", "personal_sign"],
          events: ["chainChanged", "accountsChanged", "disconnect"],
          showQrModal: !_isMobileOrTablet(),
          rpcMap: { 1: RPC_URL },
          metadata: {
            name: "Inferno Protocol",
            description: "IFR Protocol Web3 access layer",
            url: "https://web3.ifrunit.tech",
            icons: ["https://ifrunit.tech/assets/ifr_icon_256.png"]
          },
          qrModalOptions: {
            themeMode: "dark",
            themeVariables: {
              "--wcm-accent-color": "#ff4500"
            }
          }
        });
        // cancelWalletConnect() superseded this init while it was pending:
        // drop the late instance so no retry reuses its pairing state.
        if (_wcLoading !== loading) {
          _dropWalletConnect(wcInstance);
          return null;
        }
        _wcProvider = wcInstance;

        // Listen for WC session events (fires when user approves in wallet app).
        // Events from a provider dropped by cancelWalletConnect() are ignored.
        _wcProvider.on("connect", function() {
          if (wcInstance !== _wcProvider) return;
          if (_wcProvider.accounts && _wcProvider.accounts.length > 0 && !_address) {
            _finishConnectSafely(_wcProvider, _wcProvider.accounts);
          }
        });
        _wcProvider.on("session_event", function() {
          if (wcInstance !== _wcProvider) return;
          if (_wcProvider.accounts && _wcProvider.accounts.length > 0 && !_address) {
            _finishConnectSafely(_wcProvider, _wcProvider.accounts);
          }
        });
        _wcProvider.on("display_uri", function(uri) {
          if (wcInstance !== _wcProvider) return;
          _wcUri = uri;
          _emit("walletconnectUri", uri);
        });

        console.log("[IFR Web3 Wallet] WalletConnect v2 ready (self-hosted)");
        return _wcProvider;
      } catch (e) {
        console.warn("[IFR Web3 Wallet] WalletConnect init failed:", e);
        if (_wcLoading === loading) {
          _wcProvider = null;
          _wcLoading = null;
        }
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

  // ── Finish Connect (shared by connect + WC session events) ─
  async function _finishConnect(eth, accounts) {
    if (!accounts || accounts.length === 0) return null;
    if (_address) return _address; // already connected

    await _ensureMainnetProvider(eth);
    _ethereumProvider = eth;
    _provider = new ethers.BrowserProvider(eth, "any");
    _signer = await _provider.getSigner();
    _address = accounts[0];
    _connectionLabel = _getConnectionLabel(eth);

    localStorage.setItem(SESSION_KEY, _address);
    _attachListeners(eth);
    _emit("connected", _address);
    return _address;
  }

  function _finishConnectSafely(eth, accounts) {
    return _finishConnect(eth, accounts).catch(function(error) {
      if (_wcReconnectTimer) {
        clearInterval(_wcReconnectTimer);
        _wcReconnectTimer = null;
      }
      try {
        _emit("error", error);
      } catch (listenerError) {
        console.warn("[IFR Web3 Wallet] error listener failed:", listenerError);
      }
      return null;
    });
  }

  // ── Connect ───────────────────────────────────────
  async function connect() {
    var accounts;
    var eth = _getMetaMaskProvider();

    if (eth) {
      // ── Path A: Injected wallet browser or desktop extension ──
      try {
        accounts = await eth.request({ method: "eth_requestAccounts" });
      } catch (e) {
        if (e.code === 4001 || e.code === "ACTION_REJECTED") throw e;
        if (e.code === -32002) throw e;
        throw e;
      }
      return await _finishConnect(eth, accounts);
    } else {
      // ── Path B: No injected wallet → WalletConnect v2 modal ──
      var wc = await _loadWalletConnect();

      if (wc) {
        try {
          accounts = await wc.enable();
        } catch (e) {
          if (e.message && e.message.indexOf("User") !== -1) throw e;
          throw e;
        }
        return await _finishConnect(wc, accounts);
      } else {
        _showWalletHelpModal("No injected wallet was found and WalletConnect could not load. Install a wallet app or try another browser.");
        throw new Error("NO_WALLET");
      }
    }
  }

  async function connectInjected(walletId) {
    var wallet = _lastWalletList.find(function(entry) {
      return entry.id === walletId && entry.type === "injected";
    });
    if (!wallet || !wallet.provider) {
      await listWallets();
      wallet = _lastWalletList.find(function(entry) {
        return entry.id === walletId && entry.type === "injected";
      });
    }
    if (!wallet || !wallet.provider) throw new Error("WALLET_NOT_FOUND");
    var accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
    return _finishConnect(wallet.provider, accounts);
  }

  function _cancelledError() {
    var error = new Error("WalletConnect attempt cancelled.");
    error.code = "WC_CANCELLED";
    return error;
  }

  function _dropWalletConnect(wc) {
    if (_wcProvider === wc) {
      _wcProvider = null;
      _wcLoading = null;
      _wcUri = null;
    }
    try { Promise.resolve(wc && wc.disconnect()).catch(function() {}); } catch (e) {}
  }

  async function connectWalletConnect() {
    var attempt = ++_wcAttempt;
    var wc = await _loadWalletConnect();
    if (attempt !== _wcAttempt) throw _cancelledError();
    if (!wc) {
      _showWalletHelpModal("WalletConnect could not load. Check your connection and try again, or choose a browser wallet.");
      throw new Error("NO_WALLETCONNECT");
    }
    var accounts = await wc.enable();
    if (attempt !== _wcAttempt) {
      _dropWalletConnect(wc);
      throw _cancelledError();
    }
    return _finishConnect(wc, accounts);
  }

  // Abandons a pending WalletConnect pairing: its late approval or rejection
  // can no longer connect, and the next attempt pairs with a fresh URI.
  function cancelWalletConnect() {
    if (_address) return false;
    _wcAttempt += 1;
    if (_wcProvider) _dropWalletConnect(_wcProvider);
    else _wcLoading = null;  // a pending init is superseded; see _loadWalletConnect
    return true;
  }

  // ── Add IFR Token To Wallet (EIP-747) ─────────────
  async function addIFRToken() {
    var eth = _ethereumProvider || _getMetaMaskProvider();
    if (!eth || typeof eth.request !== "function") {
      throw new Error("NO_WALLET_PROVIDER");
    }

    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }]
      });
    } catch (switchErr) {
      // Non-fatal: wallet_watchAsset can still show the token import prompt.
      console.warn("IFRWallet: chain switch before token import rejected:", switchErr.message);
    }

    return await eth.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address: IFR_TOKEN_ADDRESS,
          symbol: IFR_TOKEN_SYMBOL,
          decimals: IFR_TOKEN_DECIMALS,
          image: IFR_TOKEN_IMAGE
        }
      }
    });
  }

  // ── Disconnect ────────────────────────────────────
  function disconnect() {
    _detachListeners();

    // Terminate WalletConnect session if active
    if (_wcProvider) {
      try { _wcProvider.disconnect(); } catch (e) {}
      _wcProvider = null;
      _wcLoading = null;
      _wcUri = null;
    }

    _provider = null;
    _signer = null;
    _address = null;
    _ethereumProvider = null;
    _connectionLabel = null;
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    _emit("disconnected", null);
  }

  // ── Auto-Reconnect ───────────────────────────────
  async function autoReconnect() {
    if (_address) return true; // already connected

    var saved = localStorage.getItem(SESSION_KEY);
    // Migrate from legacy sessionStorage
    if (!saved) {
      saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        localStorage.setItem(SESSION_KEY, saved);
        sessionStorage.removeItem(SESSION_KEY);
      }
    }

    // Path A: Try injected wallet reconnect
    var eth = _getMetaMaskProvider();
    if (eth && saved) {
      try {
        var accounts = await eth.request({ method: "eth_accounts" });
        if (accounts && accounts.length > 0) {
          var match = accounts.find(function(a) {
            return a.toLowerCase() === saved.toLowerCase();
          });
          if (match) {
            await _finishConnect(eth, [match]);
            return true;
          }
        }
      } catch (e) {}
    }

    // Path B: Try WalletConnect session recovery
    // WC persists sessions — if user previously connected via QR,
    // the session may still be alive after page reload or return from wallet app.
    if (_wcProvider && _wcProvider.session && _wcProvider.accounts && _wcProvider.accounts.length > 0) {
      try {
        await _finishConnect(_wcProvider, _wcProvider.accounts);
        return true;
      } catch (e) {}
    }

    // Path C: Try loading WC to check for persisted session (lazy)
    if (saved) {
      try {
        var wc = await _loadWalletConnect();
        if (wc && wc.session && wc.accounts && wc.accounts.length > 0) {
          await _finishConnect(wc, wc.accounts);
          return true;
        }
      } catch (e) {}
    }

    if (saved && !_address) localStorage.removeItem(SESSION_KEY);
    return false;
  }

  // ── Mobile Return-from-Wallet Detection ─────────
  // After QR scan, user switches to MetaMask app, approves,
  // then returns to Chrome. These handlers detect the return
  // and check if the WC session completed while in background.
  var _wcReconnectTimer = null;

  function _tryWcSessionRecover() {
    if (_address) return; // already connected
    if (!_wcProvider) return;
    if (_wcProvider.session && _wcProvider.accounts && _wcProvider.accounts.length > 0) {
      _finishConnectSafely(_wcProvider, _wcProvider.accounts);
    }
  }

  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "visible" && !_address) {
      // Immediate check
      setTimeout(_tryWcSessionRecover, 300);
      // Poll for 30s in case session takes a moment to sync
      if (_wcReconnectTimer) clearInterval(_wcReconnectTimer);
      _wcReconnectTimer = setInterval(function() {
        if (_address) { clearInterval(_wcReconnectTimer); _wcReconnectTimer = null; return; }
        _tryWcSessionRecover();
      }, 2000);
      setTimeout(function() {
        if (_wcReconnectTimer) { clearInterval(_wcReconnectTimer); _wcReconnectTimer = null; }
      }, 30000);
    }
  });

  window.addEventListener("focus", function() {
    if (!_address) setTimeout(_tryWcSessionRecover, 300);
  });

  // iOS Safari back-forward cache
  window.addEventListener("pageshow", function(e) {
    if (e.persisted && !_address) setTimeout(_tryWcSessionRecover, 500);
  });

  // ── Getters ───────────────────────────────────────
  function isConnected() { return _address !== null; }
  function getAddress() { return _address; }
  function getConnectionLabel() { return _connectionLabel; }
  function getSigner() { return _signer; }
  function getShortAddress(addr) {
    var a = addr || _address;
    return a ? ("\u2B24 " + a.slice(0, 6)) : "";
  }
  function getProvider() {
    return _provider || _getReadProvider();
  }

  // Chain-pinned read-only provider, independent of any connected wallet (parity with assets/wallet-core.js).
  function getReadProvider() {
    return _getReadProvider();
  }

  // ── Read-only RPC (FallbackProvider) ──────────────
  function _getReadProvider() {
    if (_readProvider) return _readProvider;
    var network = ethers.Network.from(CHAIN_ID);
    var configs = RPC_URLS.map(function(url, i) {
      var request = new ethers.FetchRequest(url);
      request.timeout = RPC_TIMEOUT_MS;
      return {
        provider: _pinChainId(new ethers.JsonRpcProvider(request, network, {
          staticNetwork: network,
          batchMaxCount: 1
        })),
        priority: i + 1,
        stallTimeout: 2000,
        weight: 1
      };
    });
    var fallback = new ethers.FallbackProvider(configs, network, { quorum: 1 });
    _readProvider = fallback;
    // The first read runs FallbackProvider's initial sync: every endpoint that
    // fails it (down, or wrong chain via _pinChainId) is excluded for the
    // lifetime of this provider. If none is left, the read rejects and this
    // provider is dropped (only if still cached) so a later call retries.
    fallback.getBlockNumber().then(function() {
      _hideRpcErrorNotice();
    }, function(err) {
      if (_readProvider === fallback) _readProvider = null;
      console.warn("[IFR Wallet] No usable public RPC endpoint:", err && err.message);
      _showRpcErrorNotice();
      _emit("rpcError", err);
    });
    return fallback;
  }

  // staticNetwork makes ethers v6 skip eth_chainId entirely, so the chain is
  // verified here, once per endpoint, before any other request is sent. A
  // wrong or unparsable chainId stays rejected for this provider (fail closed); a
  // transport failure is not cached and is re-checked on the next request.
  function _pinChainId(provider) {
    var send = provider.send.bind(provider);
    var check = null;
    provider.send = function(method, params) {
      if (!check) {
        check = send("eth_chainId", []).then(function(id) {
          var ok = false;
          try { ok = ethers.getBigInt(id) === BigInt(CHAIN_ID); } catch (e) { ok = false; }
          if (!ok) {
            var err = new Error("RPC endpoint reports chainId " + String(id) + ", expected " + CHAIN_ID_HEX);
            err.code = "NETWORK_ERROR";
            err.wrongChain = true;
            throw err;
          }
        }, function(err) {
          check = null;
          throw err;
        });
      }
      return check.then(function() { return send(method, params); });
    };
    return provider;
  }

  function _showRpcErrorNotice() {
    if (typeof document === "undefined" || document.getElementById("ifr-rpc-error")) return;
    var bar = document.createElement("div");
    bar.id = "ifr-rpc-error";
    bar.setAttribute("role", "alert");
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:96px;margin:0 auto;width:max-content;z-index:99998;max-width:min(560px,calc(100vw - 32px));box-sizing:border-box;display:flex;align-items:center;gap:12px;background:#0f172a;border:1px solid rgba(248,113,113,0.6);border-radius:12px;padding:10px 10px 10px 16px;color:#fecaca;font:500 0.9rem/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 12px 32px rgba(0,0,0,0.5);";
    var text = document.createElement("span");
    text.textContent = "Ethereum network data is unavailable right now (no public RPC endpoint answered for Mainnet). On-chain values may be missing \u2014 please retry later.";
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss network notice");
    close.textContent = "\u00D7";
    close.style.cssText = "flex:0 0 auto;min-width:44px;min-height:44px;background:transparent;border:1px solid rgba(248,113,113,0.45);border-radius:8px;color:#fecaca;font-size:1.25rem;cursor:pointer;";
    close.addEventListener("click", function() { bar.remove(); });
    bar.appendChild(text);
    bar.appendChild(close);
    (document.body || document.documentElement).appendChild(bar);
  }

  function _hideRpcErrorNotice() {
    var bar = typeof document !== "undefined" && document.getElementById("ifr-rpc-error");
    if (bar) bar.remove();
  }
  function getWalletConnectUri() { return _wcUri; }
  async function ensureMainnet() {
    var eth = _ethereumProvider || _getMetaMaskProvider();
    return _ensureMainnetProvider(eth);
  }

  // ── Events ────────────────────────────────────────
  function on(event, cb) { _listeners.push({ event: event, cb: cb }); }
  function off(event, cb) { _listeners = _listeners.filter(function(l) { return l.cb !== cb; }); }
  function _emit(event, data) {
    _listeners.forEach(function(l) { if (l.event === event) l.cb(data); });
  }

  // ── Internal Handlers ─────────────────────────────
  async function _onAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) { disconnect(); return; }
    var eth = _ethereumProvider || _getMetaMaskProvider();
    try {
      if (eth) {
        _provider = new ethers.BrowserProvider(eth, "any");
        _signer = await _provider.getSigner();
      }
    } catch (error) {
      console.warn("[IFR Web3 Wallet] account refresh failed:", error.message);
      disconnect();
      return;
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
    listWallets: listWallets, connectInjected: connectInjected,
    connectWalletConnect: connectWalletConnect, cancelWalletConnect: cancelWalletConnect,
    isConnected: isConnected, getAddress: getAddress, getShortAddress: getShortAddress,
    getSigner: getSigner, getProvider: getProvider, getReadProvider: getReadProvider, getConnectionLabel: getConnectionLabel,
    ensureMainnet: ensureMainnet,
    addToken: addIFRToken,
    on: on, off: off, getDeepLink: getDeepLink, isMobile: isMobile,
    isMobileOrTablet: _isMobileOrTablet,
    getWalletConnectUri: getWalletConnectUri
  };
})();
