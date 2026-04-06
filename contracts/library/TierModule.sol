// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseAccessModule.sol";

/// @title TierModule — 3-Tier IFR Access System
/// @notice Graduated access levels based on IFR balance:
///         Tier 1: Basic   (>= 500 IFR)
///         Tier 2: Premium (>= 2,000 IFR)
///         Tier 3: Pro     (>= 10,000 IFR)
///         Security Score: MEDIUM — combine with HardLock for SAFE.
abstract contract TierModule is BaseAccessModule {
    uint256 public tier1Threshold = 500e9;    // 500 IFR (9 decimals)
    uint256 public tier2Threshold = 2000e9;   // 2,000 IFR
    uint256 public tier3Threshold = 10000e9;  // 10,000 IFR

    event TierThresholdsUpdated(uint256 t1, uint256 t2, uint256 t3);

    /// @notice Get tier for user (0 = no access, 1-3 = graduated)
    function getTier(address user) public view returns (uint8) {
        uint256 balance = _tierBalance(user);
        if (balance >= tier3Threshold) return 3;
        if (balance >= tier2Threshold) return 2;
        if (balance >= tier1Threshold) return 1;
        return 0;
    }

    /// @notice Check if user meets minimum tier
    function hasTier(address user, uint8 requiredTier) public view returns (bool) {
        return getTier(user) >= requiredTier;
    }

    /// @notice Human-readable tier name
    function getTierName(address user) public view returns (string memory) {
        uint8 tier = getTier(user);
        if (tier == 3) return "Pro";
        if (tier == 2) return "Premium";
        if (tier == 1) return "Basic";
        return "None";
    }

    /// @notice IFR needed to reach next tier (0 if already max)
    function ifrToNextTier(address user) public view returns (uint256) {
        uint256 balance = _tierBalance(user);
        if (balance < tier1Threshold) return tier1Threshold - balance;
        if (balance < tier2Threshold) return tier2Threshold - balance;
        if (balance < tier3Threshold) return tier3Threshold - balance;
        return 0;
    }

    /// @notice Balance used for tier calculation. Override to use locked balance instead.
    function _tierBalance(address user) internal view virtual returns (uint256) {
        return ifrToken.balanceOf(user);
    }

    /// @notice Update tier thresholds (internal — add access control)
    function _setTierThresholds(uint256 t1, uint256 t2, uint256 t3) internal {
        require(t1 < t2 && t2 < t3, "Thresholds must be ascending");
        tier1Threshold = t1;
        tier2Threshold = t2;
        tier3Threshold = t3;
        emit TierThresholdsUpdated(t1, t2, t3);
    }
}
