/**
 * IFR Wallet Core — v1.0
 * Central wallet session manager for all IFR pages.
 * Usage: await IFRWallet.connect(); IFRWallet.getAddress();
 */
window.IFRWallet = (() => {

  // ── Konstanten ──────────────────────────────────────
  const CHAIN_ID = 1; // Ethereum Mainnet
  const CHAIN_NAME = "Ethereum Mainnet";
  const RPC_URL = "https://eth.llamarpc.com";

  // ── Interner State ──────────────────────────────────
  let _provider = null;
  let _signer = null;
  let _address = null;
  let _listeners = [];  // Callbacks für UI-Updates
  let _ethereumProvider = null; // Resolved MetaMask provider (multi-wallet safe)

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

  // ── Connect ─────────────────────────────────────────
  async function connect() {
    const eth = _getMetaMaskProvider();
    if (!eth) {
      throw new Error("NO_METAMASK");
    }
    const accounts = await eth.request({ method: "eth_requestAccounts" });
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

    // Account-Change Listener
    eth.on("accountsChanged", _onAccountsChanged);
    eth.on("chainChanged", _onChainChanged);

    _emit("connected", _address);
    return _address;
  }

  // ── Disconnect ───────────────────────────────────────
  function disconnect() {
    // Remove event listeners before clearing provider ref
    if (_ethereumProvider) {
      try {
        _ethereumProvider.removeListener("accountsChanged", _onAccountsChanged);
        _ethereumProvider.removeListener("chainChanged", _onChainChanged);
      } catch(e) {}
    }

    // Full state reset
    _provider = null;
    _signer = null;
    _address = null;
    _ethereumProvider = null;

    // Clear session
    sessionStorage.removeItem(SESSION_KEY);

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

      // Re-attach event listeners
      eth.on("accountsChanged", _onAccountsChanged);
      eth.on("chainChanged", _onChainChanged);

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
      _address = accounts[0];
      sessionStorage.setItem(SESSION_KEY, _address);
      _emit("accountChanged", _address);
    }
  }
  function _onChainChanged() { window.location.reload(); }

  // ── Public API ───────────────────────────────────────
  return { connect, disconnect, autoReconnect, isConnected,
           getAddress, getShortAddress, getSigner, getProvider, on, off };
})();
