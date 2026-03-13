/**
 * IFR State — v1.0
 * On-chain state reader for all IFR pages.
 * Reads: IFR balance, lock status, bootstrap contribution.
 * Auto-refresh every 60s when wallet connected.
 */
window.IFRState = (() => {

  // ── Contract Adressen ────────────────────────────────
  const CONTRACTS = {
    token:     "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
    lock:      "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
    bootstrap: "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141",
  };

  // ── Minimale ABIs (nur was gebraucht wird) ───────────
  const ABI_TOKEN = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
  ];

  const ABI_LOCK = [
    "function lockedBalance(address) view returns (uint256)",
    "function isLocked(address, uint256) view returns (bool)"
  ];

  // Actual BootstrapVaultV3 ABI — matches deployed contract
  const ABI_BOOTSTRAP = [
    "function contributions(address) view returns (uint256)",
    "function getBootstrapStatus() view returns (bool active, bool _finalised, uint256 totalETH, uint256 timeRemaining, uint256 contributorCount)",
    "function totalETHRaised() view returns (uint256)",
    "function ifrAllocation() view returns (uint256)",
    "function startTime() view returns (uint256)",
    "function endTime() view returns (uint256)",
    "function finalised() view returns (bool)",
    "function hasRefundOccurred() view returns (bool)",
    "function claim() external",
    "function contribute() external payable",
    "function refund() external",
    "function finalise() external"
  ];

  // ── State Cache ──────────────────────────────────────
  let _cache = null;
  let _refreshTimer = null;

  // ── Haupt-Ladefunktion ───────────────────────────────
  async function load(address) {
    const provider = IFRWallet.getProvider();
    const result = {
      address: address || null,
      ethBalance: null,
      ifrBalance: null,
      ifrBalanceFormatted: null,
      lockedAmount: null,
      lockedFormatted: null,
      isLocked1000: false,
      bootstrapContribution: null,
      bootstrapContributionETH: null,
      bootstrapStatus: null,

      // Abgeleitete Berechtigungen
      access: {
        copilotFree: true,               // immer
        copilotPremium: false,           // lockedBalance >= 1000 IFR (Phase 2)
        builderTools: false,             // Builder Registry (Phase 3)
        governanceTools: false,          // Core Team Whitelist (Phase 3)
      }
    };

    try {
      // Bootstrap Status (immer, auch ohne Wallet)
      const bootstrap = new ethers.Contract(CONTRACTS.bootstrap, ABI_BOOTSTRAP, provider);
      const status = await bootstrap.getBootstrapStatus();
      const totalETHRaised = await bootstrap.totalETHRaised();
      const ifrAllocation = await bootstrap.ifrAllocation();
      const startTime = await bootstrap.startTime();
      const endTime = await bootstrap.endTime();
      result.bootstrapStatus = {
        active: status.active,
        finalized: status._finalised,
        totalETHRaised: ethers.utils.formatEther(totalETHRaised),
        contributorCount: status.contributorCount.toNumber(),
        timeRemaining: status.timeRemaining.toNumber(),
        startTime: startTime.toNumber() * 1000,
        endTime: endTime.toNumber() * 1000,
        ifrAllocation: ethers.utils.formatUnits(ifrAllocation, 9),
      };
    } catch(e) { console.warn("Bootstrap status load failed:", e.message); }

    // Ab hier nur wenn Wallet verbunden
    if (!address) { _cache = result; _emit("stateLoaded", result); return result; }

    try {
      // ETH Balance
      const ethBal = await provider.getBalance(address);
      result.ethBalance = ethers.utils.formatEther(ethBal);

      // IFR Token Balance
      const token = new ethers.Contract(CONTRACTS.token, ABI_TOKEN, provider);
      const ifrBal = await token.balanceOf(address);
      result.ifrBalance = ifrBal;
      result.ifrBalanceFormatted = parseFloat(ethers.utils.formatUnits(ifrBal, 9)).toLocaleString();

      // Bootstrap Contribution
      const bootstrap = new ethers.Contract(CONTRACTS.bootstrap, ABI_BOOTSTRAP, provider);
      const contrib = await bootstrap.contributions(address);
      result.bootstrapContribution = contrib;
      result.bootstrapContributionETH = ethers.utils.formatEther(contrib);

      // IFRLock
      if (CONTRACTS.lock) {
        const lock = new ethers.Contract(CONTRACTS.lock, ABI_LOCK, provider);
        const locked = await lock.lockedBalance(address);
        result.lockedAmount = locked;
        result.lockedFormatted = parseFloat(ethers.utils.formatUnits(locked, 9)).toLocaleString();
        result.isLocked1000 = locked.gte(ethers.utils.parseUnits("1000", 9));
        result.access.copilotPremium = result.isLocked1000;
      }

    } catch(e) { console.warn("Wallet state load error:", e.message); }

    _cache = result;
    _emit("stateLoaded", result);
    return result;
  }

  // ── Auto-Refresh ─────────────────────────────────────
  function startAutoRefresh(intervalMs) {
    intervalMs = intervalMs || 60000;
    stopAutoRefresh();
    _refreshTimer = setInterval(function() {
      if (IFRWallet.isConnected()) load(IFRWallet.getAddress());
      else load(null); // Bootstrap-Status immer refreshen
    }, intervalMs);
  }
  function stopAutoRefresh() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  }

  // ── Event System ────────────────────────────────────
  let _listeners = [];
  function on(event, cb) { _listeners.push({ event, cb }); }
  function _emit(event, data) { _listeners.filter(function(l) { return l.event === event; }).forEach(function(l) { l.cb(data); }); }

  // ── Cache Getter ────────────────────────────────────
  function getCache() { return _cache; }
  function hasAccess(feature) { return _cache && _cache.access && _cache.access[feature] === true; }

  // ── Wallet-Events abonnieren ─────────────────────────
  IFRWallet.on("connected", function(addr) { load(addr); startAutoRefresh(); });
  IFRWallet.on("disconnected", function() { load(null); stopAutoRefresh(); });
  IFRWallet.on("accountChanged", function(addr) { load(addr); });

  return { load: load, getCache: getCache, hasAccess: hasAccess, startAutoRefresh: startAutoRefresh, stopAutoRefresh: stopAutoRefresh, on: on, CONTRACTS: CONTRACTS };
})();
