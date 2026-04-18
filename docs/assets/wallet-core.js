/**
 * IFR Wallet Core v4.2 — WalletConnect v2 via esm.sh
 * Usage: await IFRWallet.connect(); IFRWallet.getAddress();
 *
 * v4.2 — Mobile/Tablet connect disabled (desktop browser only).
 *   On smartphone/tablet, connect() shows a styled "Desktop Only" modal
 *   and throws MOBILE_NOT_SUPPORTED. autoReconnect() returns false on mobile.
 *   All mobile deep-link fallbacks removed.
 *
 * v4.1 — dynamic import() from esm.sh CDN.
 * v4.0 — Fixes v3.0 broken UMD bundles
 *
 * FLOW:
 *   - Mobile/Tablet: blocked — shows "Desktop Only" modal
 *   - Desktop WITH extension: MetaMask extension (instant, no modal)
 *   - Desktop WITHOUT extension: WalletConnect QR modal (esm.sh)
 *   - Auto-reconnect from localStorage + WC session persistence (desktop only)
 *
 * API: 100% backward-compatible (v1.3 → v4.2 drop-in).
 *      IFRWallet.connect/disconnect/autoReconnect
 *      IFRWallet.getAddress/getSigner/getProvider/isConnected
 *      IFRWallet.on/off/getDeepLink/isMobile/isMobileOrTablet/getShortAddress
 *
 * WalletConnect ProjectID: cloud.walletconnect.com (Reown)
 */
window.IFRWallet = (function() {

  var CHAIN_ID = 1;
  var CHAIN_ID_HEX = "0x1";
  var RPC_URL = "https://eth.llamarpc.com";
  var SESSION_KEY = "ifr_wallet_connected";
  var WC_PROJECT_ID = "32f56abaa4b1d7f59fb1571c0c0a551f";

  // esm.sh resolves WC dependency tree at runtime (verified on Samsung S10 Chrome).
  // jsdelivr +esm FAILS: elliptic@6.6.1 named export 'ec' missing after Rollup bundling.
  // esm.sh (default, without ?bundle-deps) works — internal deps resolve individually.
  var WC_ESM_URL = "https://esm.sh/@walletconnect/ethereum-provider@2.17.3";

  var _provider = null;        // ethers Web3Provider (for ifr-state.js compat)
  var _signer = null;
  var _address = null;
  var _listeners = [];
  var _ethereumProvider = null; // raw EIP-1193 provider
  var _listenersAttached = false;
  var _wcProvider = null;       // WalletConnect provider instance
  var _wcLoading = null;        // promise guard

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

  // ── Desktop-Only Modal ──────────────────────────────
  var _desktopModalShown = false;

  function _showDesktopOnlyModal() {
    if (_desktopModalShown) return;
    _desktopModalShown = true;

    var overlay = document.createElement("div");
    overlay.id = "ifr-desktop-only-modal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px);";

    var card = document.createElement("div");
    card.style.cssText = "background:#111827;border:1px solid #374151;border-radius:16px;padding:32px;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.6);";

    card.innerHTML =
      '<div style="font-size:2.5rem;margin-bottom:16px;">\uD83D\uDDA5\uFE0F</div>' +
      '<h3 style="color:#f97316;font-family:\'Orbitron\',sans-serif;font-size:1.2rem;margin:0 0 12px;letter-spacing:1px;">Desktop Browser Only</h3>' +
      '<p style="color:#9ca3af;font-size:0.92rem;line-height:1.6;margin:0 0 24px;">Wallet connection is only available on a <strong style="color:#e5e7eb;">desktop or laptop computer</strong> using a web browser with MetaMask extension.</p>' +
      '<p style="color:#6b7280;font-size:0.82rem;line-height:1.5;margin:0 0 24px;">Open <strong style="color:#f97316;">ifrunit.tech</strong> on your PC or Mac to connect your wallet and participate in the Bootstrap event.</p>' +
      '<button id="ifr-desktop-modal-close" style="background:#f97316;color:white;border:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:0.95rem;cursor:pointer;transition:background 0.2s;">Got it</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var closeBtn = document.getElementById("ifr-desktop-modal-close");
    function closeModal() {
      var el = document.getElementById("ifr-desktop-only-modal");
      if (el) el.remove();
      _desktopModalShown = false;
    }
    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function(e) { if (e.target === overlay) closeModal(); });
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

  // ── WalletConnect v2 Provider (dynamic ESM import) ─
  async function _loadWalletConnect() {
    if (_wcLoading) return _wcLoading;
    if (_wcProvider) return _wcProvider;

    _wcLoading = (async function() {
      try {
        // dynamic import() from esm.sh — works in all modern browsers.
        // esm.sh resolves WC dependency tree at runtime.
        // Internally imports @walletconnect/modal for QR display.
        var mod = await import(WC_ESM_URL);
        var EthereumProvider = mod.EthereumProvider || mod.default;

        if (!EthereumProvider) {
          console.warn("[IFR Wallet] EthereumProvider not found in ESM module");
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
            }
          }
        });

        // Listen for WC session events (fires when user approves in wallet app)
        _wcProvider.on("connect", function() {
          if (_wcProvider.accounts && _wcProvider.accounts.length > 0 && !_address) {
            _finishConnect(_wcProvider, _wcProvider.accounts);
          }
        });
        _wcProvider.on("session_event", function() {
          if (_wcProvider.accounts && _wcProvider.accounts.length > 0 && !_address) {
            _finishConnect(_wcProvider, _wcProvider.accounts);
          }
        });

        console.log("[IFR Wallet] WalletConnect v2 ready (esm.sh)");
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

  // ── Finish Connect (shared by connect + WC session events) ─
  async function _finishConnect(eth, accounts) {
    if (!accounts || accounts.length === 0) return null;
    if (_address) return _address; // already connected

    _ethereumProvider = eth;
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

  // ── Connect ───────────────────────────────────────
  async function connect() {
    // ── Mobile/Tablet Block: wallet connect is desktop-only ──
    if (_isMobileOrTablet()) {
      _showDesktopOnlyModal();
      var err = new Error("MOBILE_NOT_SUPPORTED");
      err.code = "MOBILE_NOT_SUPPORTED";
      throw err;
    }

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
      return await _finishConnect(eth, accounts);
    } else {
      // ── Path B: No extension → WalletConnect v2 QR modal ──
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
        throw new Error("NO_METAMASK");
      }
    }
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
    if (_isMobileOrTablet()) return false; // desktop only
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

    // Path A: Try extension reconnect
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
      await _finishConnect(_wcProvider, _wcProvider.accounts);
      return true;
    }

    // Path C: Try loading WC to check for persisted session (lazy)
    if (!eth && saved) {
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
      _finishConnect(_wcProvider, _wcProvider.accounts);
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
    on: on, off: off, getDeepLink: getDeepLink, isMobile: isMobile,
    isMobileOrTablet: _isMobileOrTablet
  };
})();
