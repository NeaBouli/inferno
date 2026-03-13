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

  // ── Session Storage Key ─────────────────────────────
  const SESSION_KEY = "ifr_wallet_connected";

  // ── Connect ─────────────────────────────────────────
  async function connect() {
    if (!window.ethereum) {
      throw new Error("NO_METAMASK");
    }
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) throw new Error("NO_ACCOUNTS");

    _provider = new ethers.providers.Web3Provider(window.ethereum);
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
    window.ethereum.on("accountsChanged", _onAccountsChanged);
    window.ethereum.on("chainChanged", _onChainChanged);

    _emit("connected", _address);
    return _address;
  }

  // ── Disconnect ───────────────────────────────────────
  function disconnect() {
    _provider = null;
    _signer = null;
    _address = null;
    sessionStorage.removeItem(SESSION_KEY);
    if (window.ethereum?.removeListener) {
      window.ethereum.removeListener("accountsChanged", _onAccountsChanged);
      window.ethereum.removeListener("chainChanged", _onChainChanged);
    }
    _emit("disconnected", null);
  }

  // ── Auto-Reconnect (bei Seitenlade) ─────────────────
  async function autoReconnect() {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved || !window.ethereum) return false;
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts && accounts[0] && accounts[0].toLowerCase() === saved.toLowerCase()) {
        _provider = new ethers.providers.Web3Provider(window.ethereum);
        _signer = _provider.getSigner();
        _address = accounts[0];
        _emit("connected", _address);
        return true;
      }
    } catch(e) {}
    sessionStorage.removeItem(SESSION_KEY);
    return false;
  }

  // ── Netzwerk-Switch ──────────────────────────────────
  async function switchToMainnet() {
    await window.ethereum.request({
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
    return a.slice(0, 6) + "..." + a.slice(-4);
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
