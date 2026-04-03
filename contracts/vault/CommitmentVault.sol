// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CommitmentVault
/// @notice Irrevocable token lock with 4 condition types.
///         Users lock IFR tokens with conditions that must be met before unlock.
///         Auto-unlock: 30 days after condition met, anyone can trigger unlock.
///         Tokens ALWAYS return to the original depositor — never the caller.
///
///         IMPORTANT: This contract MUST be set as feeExempt on InfernoToken
///         to prevent fee deductions on lock/unlock transfers.
contract CommitmentVault is Ownable, ReentrancyGuard {

    IERC20 public immutable ifrToken;

    enum ConditionType {
        TIME_ONLY,      // A: unlock after timestamp
        PRICE_ONLY,     // B: unlock when price >= P0 * multiplier
        TIME_OR_PRICE,  // C: whichever comes first
        TIME_AND_PRICE  // D: both must be met
    }

    struct Tranche {
        uint256 amount;         // IFR locked (9 decimals)
        ConditionType cType;    // Condition type
        uint256 unlockTime;     // Timestamp condition (0 if N/A)
        uint256 p0Multiplier;   // Price multiplier in bps (200 = P0*2, 10000 = P0*100)
        bool unlocked;          // Already unlocked?
        uint256 conditionMetAt; // Timestamp when condition first marked as met
    }

    /// @notice P0 — initial IFR price in wei per 1 IFR (9 decimals).
    ///         Set once after Bootstrap finalise(). IMMUTABLE after set.
    uint256 public p0;
    bool public p0Set;

    /// @notice Total IFR currently locked across all wallets
    uint256 public totalLocked;

    /// @notice wallet => tranches
    mapping(address => Tranche[]) private _tranches;

    /// @notice Price oracle address (Governance-controlled)
    address public priceOracle;

    /// @notice Auto-unlock delay after condition is met
    uint256 public constant AUTO_UNLOCK_DELAY = 30 days;

    /// @notice Maximum tranches per wallet (gas safety)
    uint256 public constant MAX_TRANCHES = 50;

    event Locked(address indexed wallet, uint256 indexed trancheId, uint256 amount, ConditionType cType);
    event Unlocked(address indexed wallet, uint256 indexed trancheId, uint256 amount, address unlockedBy);
    event P0Set(uint256 p0);
    event ConditionMet(address indexed wallet, uint256 indexed trancheId, uint256 timestamp);
    event PriceOracleUpdated(address indexed oracle);

    constructor(address _ifrToken, address _governance) Ownable(_governance) {
        require(_ifrToken != address(0), "token=0");
        ifrToken = IERC20(_ifrToken);
    }

    // ── P0 Management ─────────────────────────────────────────

    /// @notice Set P0 — ONCE only, after Bootstrap finalise().
    ///         P0 = totalETHRaised / 100,000,000 (in wei per 1 IFR).
    ///         Called via Governance Proposal.
    function setP0(uint256 _p0) external onlyOwner {
        require(!p0Set, "P0 already set");
        require(_p0 > 0, "P0 must be > 0");
        p0 = _p0;
        p0Set = true;
        emit P0Set(_p0);
    }

    // ── Lock ──────────────────────────────────────────────────

    /// @notice Lock IFR tokens in a new tranche with conditions
    /// @param amount Amount of IFR to lock (requires prior approval)
    /// @param cType Condition type (TIME_ONLY, PRICE_ONLY, TIME_OR_PRICE, TIME_AND_PRICE)
    /// @param unlockTime Timestamp for time-based conditions (0 if not applicable)
    /// @param p0Multiplier Price multiplier in bps (200 = 2x P0, 0 if not applicable)
    function lock(
        uint256 amount,
        ConditionType cType,
        uint256 unlockTime,
        uint256 p0Multiplier
    ) external nonReentrant {
        require(amount > 0, "amount=0");
        require(_tranches[msg.sender].length < MAX_TRANCHES, "max tranches reached");

        // Validate condition parameters
        if (cType == ConditionType.TIME_ONLY || cType == ConditionType.TIME_OR_PRICE || cType == ConditionType.TIME_AND_PRICE) {
            require(unlockTime > block.timestamp, "unlockTime must be future");
        }
        if (cType == ConditionType.PRICE_ONLY || cType == ConditionType.TIME_OR_PRICE || cType == ConditionType.TIME_AND_PRICE) {
            require(p0Multiplier > 0, "multiplier=0");
        }

        require(ifrToken.transferFrom(msg.sender, address(this), amount), "transfer failed");

        uint256 trancheId = _tranches[msg.sender].length;
        _tranches[msg.sender].push(Tranche({
            amount: amount,
            cType: cType,
            unlockTime: unlockTime,
            p0Multiplier: p0Multiplier,
            unlocked: false,
            conditionMetAt: 0
        }));

        totalLocked += amount;

        emit Locked(msg.sender, trancheId, amount, cType);
    }

    // ── Condition Check ───────────────────────────────────────

    /// @notice Check if a tranche's unlock condition is met
    function isConditionMet(address wallet, uint256 trancheId) public view returns (bool) {
        require(trancheId < _tranches[wallet].length, "invalid trancheId");
        Tranche storage t = _tranches[wallet][trancheId];
        if (t.unlocked) return true;

        bool timeMet = t.unlockTime > 0 && block.timestamp >= t.unlockTime;

        bool priceMet = false;
        if (t.p0Multiplier > 0 && p0Set && priceOracle != address(0)) {
            uint256 targetPrice = (p0 * t.p0Multiplier) / 100;
            uint256 currentPrice = _getCurrentPrice();
            priceMet = currentPrice >= targetPrice;
        }

        if (t.cType == ConditionType.TIME_ONLY) return timeMet;
        if (t.cType == ConditionType.PRICE_ONLY) return priceMet;
        if (t.cType == ConditionType.TIME_OR_PRICE) return timeMet || priceMet;
        return timeMet && priceMet; // TIME_AND_PRICE
    }

    // ── Mark Condition Met (for auto-unlock timer) ────────────

    /// @notice Mark a tranche's condition as met, starting the 30-day auto-unlock timer.
    ///         Anyone can call this — it's a public good.
    function markConditionMet(address wallet, uint256 trancheId) external {
        require(trancheId < _tranches[wallet].length, "invalid trancheId");
        Tranche storage t = _tranches[wallet][trancheId];
        require(!t.unlocked, "already unlocked");
        require(t.conditionMetAt == 0, "already marked");
        require(isConditionMet(wallet, trancheId), "condition not met");

        t.conditionMetAt = block.timestamp;
        emit ConditionMet(wallet, trancheId, block.timestamp);
    }

    // ── Unlock ────────────────────────────────────────────────

    /// @notice Unlock a tranche. Owner can unlock immediately when condition is met.
    ///         Anyone else can unlock after 30-day auto-unlock delay.
    ///         Tokens ALWAYS go to the original wallet — never the caller.
    function unlock(address wallet, uint256 trancheId) external nonReentrant {
        require(trancheId < _tranches[wallet].length, "invalid trancheId");
        Tranche storage t = _tranches[wallet][trancheId];
        require(!t.unlocked, "already unlocked");
        require(isConditionMet(wallet, trancheId), "condition not met");

        // Auto-unlock: anyone can unlock after 30 days
        if (msg.sender != wallet) {
            require(
                t.conditionMetAt > 0 && block.timestamp >= t.conditionMetAt + AUTO_UNLOCK_DELAY,
                "auto-unlock: 30d delay"
            );
        }

        t.unlocked = true;
        uint256 amount = t.amount;
        t.amount = 0;
        totalLocked -= amount;

        require(ifrToken.transfer(wallet, amount), "transfer failed");

        emit Unlocked(wallet, trancheId, amount, msg.sender);
    }

    // ── View Functions ────────────────────────────────────────

    /// @notice Get number of tranches for a wallet
    function getTrancheCount(address wallet) external view returns (uint256) {
        return _tranches[wallet].length;
    }

    /// @notice Get all tranches for a wallet
    function getTranches(address wallet) external view returns (Tranche[] memory) {
        return _tranches[wallet];
    }

    /// @notice Get a single tranche
    function getTranche(address wallet, uint256 trancheId) external view returns (Tranche memory) {
        require(trancheId < _tranches[wallet].length, "invalid trancheId");
        return _tranches[wallet][trancheId];
    }

    /// @notice Check if a wallet has any active (non-unlocked) tranches
    function hasActiveLock(address wallet) external view returns (bool) {
        Tranche[] storage ts = _tranches[wallet];
        for (uint256 i = 0; i < ts.length; i++) {
            if (!ts[i].unlocked) return true;
        }
        return false;
    }

    /// @notice Get total locked amount for a wallet (across all active tranches)
    function lockedBalance(address wallet) external view returns (uint256) {
        uint256 total = 0;
        Tranche[] storage ts = _tranches[wallet];
        for (uint256 i = 0; i < ts.length; i++) {
            if (!ts[i].unlocked) total += ts[i].amount;
        }
        return total;
    }

    // ── Oracle Management (Governance) ────────────────────────

    /// @notice Set the price oracle address. Governance only.
    function setPriceOracle(address _oracle) external onlyOwner {
        priceOracle = _oracle;
        emit PriceOracleUpdated(_oracle);
    }

    // ── Internal ──────────────────────────────────────────────

    /// @dev Get current IFR price from oracle.
    ///      Phase 1: returns 0 (no oracle).
    ///      Phase 2: Uniswap TWAP oracle.
    function _getCurrentPrice() internal view returns (uint256) {
        if (priceOracle == address(0)) return 0;
        // Phase 2: call oracle interface
        // return IUniswapTWAP(priceOracle).consult(address(ifrToken), 1e9);
        return 0;
    }
}
