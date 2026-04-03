/**
 * IFR Wallet Core — v2.0
 * Central wallet session manager for all IFR pages.
 *
 * v2.0 — Real WalletConnect v2 integration
 *  - Desktop with MetaMask: modal choice (MetaMask / WalletConnect)
 *  - Desktop without MetaMask: WalletConnect QR code automatically
 *  - Mobile in wallet browser: injected provider directly
 *  - Mobile in regular browser: WalletConnect deep links to wallet apps
 *  - Lazy-loads WC SDK from CDN only when needed
 *  - Backwards-compatible API (drop-in replacement for v1.x)
 */
window.IFRWallet = (function() {
  "use strict";

  // ── Constants ──────────────────────────────────────
  var CHAIN_ID = 1;
  var RPC_URL  = "https://eth.llamarpc.com";
  var CONNECT_TIMEOUT_MS = 30000;
  var SESSION_KEY = "ifr_wallet_connected";
  var TYPE_KEY    = "ifr_wallet_type";
  var PENDING_KEY = "ifr_pending_connect";

  // WalletConnect Cloud Project ID
  // Register your own at https://cloud.walletconnect.com
  var WC_PROJECT_ID = "32f56abaa4b1d7f59fb1571c0c0a551f";

  // ── Internal State ─────────────────────────────────
  var _provider = null;        // ethers Web3Provider
  var _signer = null;
  var _address = null;
  var _listeners = [];
  var _injectedProvider = null; // MetaMask / injected EIP-1193
  var _wcProvider = null;       // WalletConnect EIP-1193
  var _wcModule = null;         // Cached dynamic import
  var _connectType = null;      // "injected" | "walletconnect"
  var _listenersAttached = false;

  // ── Injected Provider Detection (EIP-5749) ─────────
  function _getInjectedProvider() {
    if (_injectedProvider) return _injectedProvider;
    if (window.ethereum && window.ethereum.providers && Array.isArray(window.ethereum.providers)) {
      _injectedProvider = window.ethereum.providers.find(function(p) {
        return p.isMetaMask && !p.isExodus && !p.isBraveWallet;
      }) || window.ethereum.providers[0] || window.ethereum;
    } else if (window.ethereum) {
      _injectedProvider = window.ethereum;
    }
    return _injectedProvider || null;
  }

  // ── Provider Listener Management ───────────────────
  function _getActiveRawProvider() {
    return _connectType === "walletconnect" ? _wcProvider : _injectedProvider;
  }

  function _attachListeners(rawProvider) {
    if (_listenersAttached || !rawProvider) return;
    rawProvider.on("accountsChanged", _onAccountsChanged);
    rawProvider.on("chainChanged", _onChainChanged);
    _listenersAttached = true;
  }

  function _detachListeners() {
    var p = _getActiveRawProvider();
    if (!_listenersAttached || !p) { _listenersAttached = false; return; }
    try {
      p.removeListener("accountsChanged", _onAccountsChanged);
      p.removeListener("chainChanged", _onChainChanged);
    } catch(e) { /* ignore */ }
    _listenersAttached = false;
  }

  // ══════════════════════════════════════════════════
  //  CONNECT — Smart routing
  // ══════════════════════════════════════════════════
  function connect(preferredType) {
    // Explicit type from modal callback
    if (preferredType === "injected") return _connectInjected();
    if (preferredType === "walletconnect") return _connectWC();

    var hasInjected = !!_getInjectedProvider();

    // Mobile in wallet's in-app browser → use injected directly
    if (isMobile() && hasInjected) return _connectInjected();

    // Mobile in regular browser → WalletConnect (shows wallet deep links)
    if (isMobile() && !hasInjected) return _connectWC();

    // Desktop with MetaMask → let user choose
    if (hasInjected) return _showConnectModal();

    // Desktop without MetaMask → WalletConnect QR
    return _connectWC();
  }

  // ── Connect via Injected Provider (MetaMask) ──────
  function _connectInjected() {
    var eth = _getInjectedProvider();
    if (!eth) return Promise.reject(new Error("NO_METAMASK"));

    var accountsP = eth.request({ method: "eth_requestAccounts" });
    var timeoutP  = new Promise(function(_, rej) {
      setTimeout(function() { rej(new Error("CONNECT_TIMEOUT")); }, CONNECT_TIMEOUT_MS);
    });

    return Promise.race([accountsP, timeoutP]).then(function(accounts) {
      if (!accounts || accounts.length === 0) throw new Error("NO_ACCOUNTS");

      _provider = new ethers.providers.Web3Provider(eth);
      _signer = _provider.getSigner();
      _address = accounts[0];
      _connectType = "injected";

      return _provider.getNetwork();
    }).then(function(network) {
      if (network.chainId !== CHAIN_ID) return _switchChain(_getInjectedProvider());
    }).then(function() {
      sessionStorage.setItem(SESSION_KEY, _address);
      sessionStorage.setItem(TYPE_KEY, "injected");
      _attachListeners(_getInjectedProvider());
      _emit("connected", _address);
      return _address;
    });
  }

  // ── Load WalletConnect SDK (lazy, cached) ──────────
  function _loadWC() {
    if (_wcModule) return Promise.resolve(_wcModule);

    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        reject(new Error("WC_LOAD_TIMEOUT"));
      }, 15000);

      import("https://esm.sh/@walletconnect/ethereum-provider@2.17.0")
        .then(function(mod) {
          clearTimeout(timeout);
          _wcModule = mod;
          resolve(mod);
        })
        .catch(function(err) {
          clearTimeout(timeout);
          reject(new Error("WC_LOAD_FAILED"));
        });
    });
  }

  // ── Connect via WalletConnect v2 ──────────────────
  function _connectWC() {
    return _loadWC().then(function(mod) {
      return mod.EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [CHAIN_ID],
        showQrModal: true,
        methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
        events: ["chainChanged", "accountsChanged"],
        metadata: {
          name: "Inferno Protocol",
          description: "IFR — Deflationary Utility Token on Ethereum",
          url: "https://ifrunit.tech",
          icons: ["https://ifrunit.tech/assets/ifr_icon_256.png"]
        }
      });
    }).then(function(wcProv) {
      _wcProvider = wcProv;
      return wcProv.connect().then(function() { return wcProv; });
    }).then(function(wcProv) {
      _provider = new ethers.providers.Web3Provider(wcProv);
      _signer = _provider.getSigner();
      _address = wcProv.accounts[0];
      _connectType = "walletconnect";

      sessionStorage.setItem(SESSION_KEY, _address);
      sessionStorage.setItem(TYPE_KEY, "walletconnect");

      _attachListeners(wcProv);
      wcProv.on("disconnect", function() { disconnect(); });

      _emit("connected", _address);
      return _address;
    }).catch(function(err) {
      // If WC SDK failed to load, try MetaMask as fallback
      if (err.message === "WC_LOAD_FAILED" || err.message === "WC_LOAD_TIMEOUT") {
        if (_getInjectedProvider()) return _connectInjected();
        throw new Error("NO_METAMASK");
      }
      // User closed WC modal → match MetaMask rejection format
      if (err && err.message && err.message.indexOf("User") !== -1) {
        var rejection = new Error("User rejected");
        rejection.code = 4001;
        throw rejection;
      }
      throw err;
    });
  }

  // ══════════════════════════════════════════════════
  //  CONNECT MODAL — wallet choice on desktop
  // ══════════════════════════════════════════════════
  function _showConnectModal() {
    return new Promise(function(resolve, reject) {
      _removeConnectModal();

      // Overlay
      var overlay = document.createElement("div");
      overlay.id = "ifr-connect-modal";
      overlay.setAttribute("style",
        "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.82);" +
        "display:flex;align-items:center;justify-content:center;padding:20px;" +
        "animation:ifrFadeIn .15s ease;"
      );

      // Modal card
      var card = document.createElement("div");
      card.setAttribute("style",
        "background:#111113;border:1px solid #222225;border-radius:16px;" +
        "padding:28px 24px;max-width:360px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);"
      );

      // Title
      var title = document.createElement("div");
      title.setAttribute("style",
        "color:#e8e8ed;font-size:1rem;font-weight:600;text-align:center;" +
        "margin-bottom:20px;letter-spacing:0.3px;"
      );
      title.textContent = "Connect Wallet";
      card.appendChild(title);

      // --- MetaMask Button ---
      card.appendChild(_createWalletBtn(
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 35 33'%3E%3Cpath d='M32.96 1l-13.14 9.72 2.45-5.73z' fill='%23E2761B' stroke='%23E2761B' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M2.66 1l13.02 9.81L13.35 5 2.66 1zm25.57 22.53l-3.5 5.34 7.49 2.06 2.14-7.28-6.13-.12zm-25.2.12l2.13 7.28 7.47-2.06-3.48-5.34-6.12.12z' fill='%23E4761B' stroke='%23E4761B' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M12.09 14.57l-2.08 3.14 7.4.34-.24-7.97-5.08 4.49zm11.44 0l-5.16-4.58-.17 8.06 7.4-.34-2.07-3.14zM12.63 28.87l4.49-2.16-3.86-3.01-.63 5.17zm5.89-2.16l4.49 2.16-.64-5.17-3.85 3.01z' fill='%23E4761B' stroke='%23E4761B' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
        "MetaMask",
        "Browser Extension",
        "#f97316",
        function() {
          _removeConnectModal();
          resolve(_connectInjected());
        }
      ));

      // --- WalletConnect Button ---
      card.appendChild(_createWalletBtn(
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4.914 7.993C8.73 4.24 14.935 4.24 18.75 7.993l.461.45a.48.48 0 010 .687l-1.578 1.541a.251.251 0 01-.351 0l-.635-.62c-2.625-2.565-6.885-2.565-9.51 0l-.68.664a.251.251 0 01-.351 0L4.528 9.174a.48.48 0 010-.687l.386-.494zm14.73 2.733 1.404 1.372a.48.48 0 010 .687l-6.328 6.181a.503.503 0 01-.703 0L9.642 14.6a.126.126 0 00-.176 0l-4.375 4.274a.503.503 0 01-.703 0L1.04 17.502a.48.48 0 010-.687l6.328-6.181a.503.503 0 01.703 0l4.375 4.274c.049.047.127.047.176 0l4.375-4.274a.503.503 0 01.703 0l1.944 1.092z' fill='%233B99FC'/%3E%3C/svg%3E",
        "WalletConnect",
        "QR Code / Mobile Wallet",
        "#3b99fc",
        function() {
          _removeConnectModal();
          resolve(_connectWC());
        }
      ));

      // Hint text
      var hint = document.createElement("div");
      hint.setAttribute("style",
        "color:#555;font-size:0.75rem;text-align:center;margin-top:16px;line-height:1.5;"
      );
      hint.textContent = "WalletConnect supports MetaMask, Trust, Rainbow, Coinbase and 300+ wallets";
      card.appendChild(hint);

      overlay.appendChild(card);

      // Close on overlay click or Escape
      overlay.addEventListener("click", function(e) {
        if (e.target === overlay) {
          _removeConnectModal();
          reject({ code: 4001, message: "User closed modal" });
        }
      });
      document.addEventListener("keydown", _onEscape);

      function _onEscape(e) {
        if (e.key === "Escape") {
          document.removeEventListener("keydown", _onEscape);
          _removeConnectModal();
          reject({ code: 4001, message: "User closed modal" });
        }
      }

      document.body.appendChild(overlay);

      // Inject animation keyframes if not yet present
      if (!document.getElementById("ifr-modal-anim")) {
        var style = document.createElement("style");
        style.id = "ifr-modal-anim";
        style.textContent = "@keyframes ifrFadeIn{from{opacity:0}to{opacity:1}}";
        document.head.appendChild(style);
      }
    });
  }

  function _createWalletBtn(iconSrc, name, subtitle, hoverColor, onclick) {
    var btn = document.createElement("button");
    btn.setAttribute("style",
      "width:100%;padding:14px 16px;background:#1a1a2e;border:1.5px solid #2a2a3e;" +
      "border-radius:12px;color:#e8e8ed;font-size:0.92rem;cursor:pointer;" +
      "display:flex;align-items:center;gap:12px;margin-bottom:10px;" +
      "transition:border-color 0.2s,background 0.2s;text-align:left;"
    );
    btn.onmouseenter = function() { this.style.borderColor = hoverColor; this.style.background = "#1e1e34"; };
    btn.onmouseleave = function() { this.style.borderColor = "#2a2a3e"; this.style.background = "#1a1a2e"; };

    var icon = document.createElement("img");
    icon.src = iconSrc;
    icon.width = 28;
    icon.height = 28;
    icon.setAttribute("style", "flex-shrink:0;");

    var textWrap = document.createElement("div");
    var nameEl = document.createElement("div");
    nameEl.setAttribute("style", "font-weight:600;font-size:0.92rem;");
    nameEl.textContent = name;
    var subEl = document.createElement("div");
    subEl.setAttribute("style", "color:#666;font-size:0.78rem;margin-top:2px;");
    subEl.textContent = subtitle;
    textWrap.appendChild(nameEl);
    textWrap.appendChild(subEl);

    btn.appendChild(icon);
    btn.appendChild(textWrap);
    btn.onclick = onclick;
    return btn;
  }

  function _removeConnectModal() {
    var m = document.getElementById("ifr-connect-modal");
    if (m) m.parentNode.removeChild(m);
  }

  // ══════════════════════════════════════════════════
  //  DISCONNECT
  // ══════════════════════════════════════════════════
  function disconnect() {
    _detachListeners();

    // WalletConnect session cleanup
    if (_wcProvider) {
      try { _wcProvider.disconnect(); } catch(e) { /* ignore */ }
      _wcProvider = null;
    }

    // Full state reset
    _provider = null;
    _signer = null;
    _address = null;
    _injectedProvider = null;
    _connectType = null;

    // Clear all session storage
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(TYPE_KEY);
    sessionStorage.removeItem(PENDING_KEY);

    // Clear WalletConnect v2 localStorage
    try {
      var keys = Object.keys(localStorage);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf("wc@2:") === 0 || keys[i].indexOf("wagmi.") === 0) {
          localStorage.removeItem(keys[i]);
        }
      }
    } catch(e) { /* ignore */ }

    _removeConnectModal();
    _emit("disconnected", null);
  }

  // ══════════════════════════════════════════════════
  //  AUTO-RECONNECT
  // ══════════════════════════════════════════════════
  function autoReconnect() {
    var saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return Promise.resolve(false);
    var type = sessionStorage.getItem(TYPE_KEY) || "injected";

    if (type === "walletconnect") return _autoReconnectWC(saved);
    return _autoReconnectInjected(saved);
  }

  function _autoReconnectInjected(saved) {
    var eth = _getInjectedProvider();
    if (!eth) {
      _clearSession();
      return Promise.resolve(false);
    }
    return eth.request({ method: "eth_accounts" }).then(function(accounts) {
      if (!accounts || accounts.length === 0) { _clearSession(); return false; }
      var match = accounts.find(function(a) { return a.toLowerCase() === saved.toLowerCase(); });
      if (!match) { _clearSession(); return false; }

      _provider = new ethers.providers.Web3Provider(eth);
      _signer = _provider.getSigner();
      _address = match;
      _injectedProvider = eth;
      _connectType = "injected";
      _attachListeners(eth);
      _emit("connected", _address);
      return true;
    }).catch(function() { _clearSession(); return false; });
  }

  function _autoReconnectWC(saved) {
    return _loadWC().then(function(mod) {
      return mod.EthereumProvider.init({
        projectId: WC_PROJECT_ID,
        chains: [CHAIN_ID],
        showQrModal: false,
        methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
        events: ["chainChanged", "accountsChanged"],
        metadata: {
          name: "Inferno Protocol",
          description: "IFR — Deflationary Utility Token on Ethereum",
          url: "https://ifrunit.tech",
          icons: ["https://ifrunit.tech/assets/ifr_icon_256.png"]
        }
      });
    }).then(function(wcProv) {
      if (!wcProv.session) { _clearSession(); return false; }

      _wcProvider = wcProv;
      _provider = new ethers.providers.Web3Provider(wcProv);
      _signer = _provider.getSigner();
      _address = wcProv.accounts[0];
      _connectType = "walletconnect";
      _attachListeners(wcProv);
      wcProv.on("disconnect", function() { disconnect(); });
      _emit("connected", _address);
      return true;
    }).catch(function() { _clearSession(); return false; });
  }

  function _clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(TYPE_KEY);
  }

  // ── Network Switch ─────────────────────────────────
  function switchToMainnet() {
    var p = _getActiveRawProvider();
    if (!p) return Promise.resolve();
    return p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }]
    });
  }

  function _switchChain(p) {
    if (!p) return Promise.resolve();
    return p.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1" }]
    });
  }

  // ── Getters ────────────────────────────────────────
  function isConnected()  { return _address !== null; }
  function getAddress()   { return _address; }
  function getSigner()    { return _signer; }
  function getConnectionType() { return _connectType; }

  function getShortAddress(addr) {
    var a = addr || _address;
    return a ? ("\u2B24 " + a.slice(0, 6)) : "";
  }

  function getProvider() {
    return _provider || new ethers.providers.JsonRpcProvider(RPC_URL);
  }

  // ── Event System ───────────────────────────────────
  function on(event, cb)  { _listeners.push({ event: event, cb: cb }); }
  function off(event, cb) { _listeners = _listeners.filter(function(l) { return l.cb !== cb; }); }

  function _emit(event, data) {
    _listeners.forEach(function(l) { if (l.event === event) l.cb(data); });
  }

  // ── Internal Event Handlers ────────────────────────
  function _onAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) {
      disconnect();
      return;
    }
    // Re-create provider/signer for new account
    var raw = _getActiveRawProvider();
    if (raw) {
      _provider = new ethers.providers.Web3Provider(raw);
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

  // ── Mobile Helpers (kept for backwards compat) ─────
  function getDeepLink() {
    return "https://metamask.app.link/dapp/" + window.location.href.replace(/^https?:\/\//, "");
  }

  function isMobile() {
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }

  // Pending deep-link connect (legacy — still works)
  if (sessionStorage.getItem(PENDING_KEY) === "1") {
    sessionStorage.removeItem(PENDING_KEY);
    setTimeout(function() {
      if (_getInjectedProvider()) _connectInjected().catch(function() {});
    }, 2000);
  }

  // ── Public API ─────────────────────────────────────
  return {
    connect:           connect,
    disconnect:        disconnect,
    autoReconnect:     autoReconnect,
    isConnected:       isConnected,
    getAddress:        getAddress,
    getShortAddress:   getShortAddress,
    getSigner:         getSigner,
    getProvider:       getProvider,
    getConnectionType: getConnectionType,
    on:                on,
    off:               off,
    getDeepLink:       getDeepLink,
    isMobile:          isMobile
  };
})();
