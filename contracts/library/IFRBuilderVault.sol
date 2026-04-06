// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./HardLockModule.sol";
import "./TierModule.sol";
import "./CooldownModule.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title IFRBuilderVault — Complete Builder Integration
/// @notice Combines HardLock + Tier + Cooldown into a single deployable contract.
///         This is the RECOMMENDED integration for partners.
///         Security Score: SAFE (85-95/100 depending on config).
///
/// Usage:
///   1. Deploy with IFR token address + your product info
///   2. Governance Proposal: setFeeExempt(IFRBuilderVault, true)
///   3. Users call lock(amount, duration) to gain access
///   4. Your product calls hasAccess(user) or getTier(user)
contract IFRBuilderVault is HardLockModule, TierModule, CooldownModule, Ownable {
    string public productName;
    string public productUrl;

    event ProductRegistered(string name, string url);

    constructor(
        address _ifrToken,
        uint256 _minRequired,
        uint256 _minLockDuration,
        string memory _productName,
        string memory _productUrl,
        address _governance
    ) BaseAccessModule(_ifrToken, _minRequired) Ownable(_governance) {
        require(bytes(_productName).length > 0, "name empty");
        minLockDuration = _minLockDuration;
        productName = _productName;
        productUrl = _productUrl;
        emit ProductRegistered(_productName, _productUrl);
    }

    /// @notice Full access check: must have tokens locked >= minRequired
    function hasAccess(address user) public view override(BaseAccessModule, HardLockModule) returns (bool) {
        return HardLockModule.hasAccess(user);
    }

    /// @notice Override tier balance to use locked amount instead of wallet balance
    function _tierBalance(address user) internal view override returns (uint256) {
        return locks[user].amount;
    }

    /// @notice Check Premium access (Tier 2+ AND locked)
    function hasPremium(address user) public view returns (bool) {
        return hasAccess(user) && getTier(user) >= 2;
    }

    /// @notice Check Pro access (Tier 3 AND locked)
    function hasPro(address user) public view returns (bool) {
        return hasAccess(user) && getTier(user) >= 3;
    }

    /// @notice Full user status in one call (gas-efficient for frontends)
    function getStatus(address user) external view returns (
        bool access,
        uint8 tier,
        string memory tierName,
        uint256 locked,
        uint256 unlockIn,
        uint256 toNextTier,
        bool inCooldown
    ) {
        access = hasAccess(user);
        tier = getTier(user);
        tierName = getTierName(user);
        locked = lockedAmount(user);
        unlockIn = timeUntilUnlock(user);
        toNextTier = ifrToNextTier(user);
        inCooldown = isInCooldown(user);
    }

    // ── Owner-only config ────────────────────────────────

    function setMinRequired(uint256 _min) external onlyOwner {
        _setMinRequired(_min);
    }

    function setMinLockDuration(uint256 _duration) external onlyOwner {
        _setMinLockDuration(_duration);
    }

    function setTierThresholds(uint256 t1, uint256 t2, uint256 t3) external onlyOwner {
        _setTierThresholds(t1, t2, t3);
    }

    function setCooldownDuration(uint256 _duration) external onlyOwner {
        _setCooldownDuration(_duration);
    }

    function updateProduct(string memory _name, string memory _url) external onlyOwner {
        require(bytes(_name).length > 0, "name empty");
        productName = _name;
        productUrl = _url;
        emit ProductRegistered(_name, _url);
    }
}
