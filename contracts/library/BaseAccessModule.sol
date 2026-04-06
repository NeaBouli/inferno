// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title BaseAccessModule — Minimal IFR Access Check
/// @notice Simplest integration: checks if wallet holds enough IFR.
///         No lock, no cooldown, no tier. Use for low-value features.
///         Security Score: RISKY (soft lock — user can sell immediately after check)
abstract contract BaseAccessModule {
    IERC20 public immutable ifrToken;
    uint256 public minRequired;

    event MinRequiredUpdated(uint256 newMin);

    constructor(address _token, uint256 _minRequired) {
        require(_token != address(0), "token=0");
        ifrToken = IERC20(_token);
        minRequired = _minRequired;
    }

    /// @notice Check if user holds at least minRequired IFR
    function hasAccess(address user) public view virtual returns (bool) {
        return ifrToken.balanceOf(user) >= minRequired;
    }

    /// @notice Check if user holds at least a custom amount
    function hasAccessAmount(address user, uint256 amount) public view returns (bool) {
        return ifrToken.balanceOf(user) >= amount;
    }

    /// @notice Get user's IFR balance
    function userBalance(address user) public view returns (uint256) {
        return ifrToken.balanceOf(user);
    }

    /// @notice Update minimum required (must be overridden with access control)
    function _setMinRequired(uint256 _min) internal {
        minRequired = _min;
        emit MinRequiredUpdated(_min);
    }
}
