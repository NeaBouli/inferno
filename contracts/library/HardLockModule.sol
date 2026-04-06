// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseAccessModule.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HardLockModule — Time-Bound Token Lock
/// @notice Tokens must be locked for a minimum duration. Cannot unlock early.
///         Security Score: SAFE — strongest commitment mechanism.
abstract contract HardLockModule is BaseAccessModule, ReentrancyGuard {
    struct LockData {
        uint256 amount;
        uint256 lockedAt;
        uint256 duration;
    }

    mapping(address => LockData) public locks;

    uint256 public minLockDuration = 7 days;
    uint256 public maxLockDuration = 365 days;

    event Locked(address indexed user, uint256 amount, uint256 duration);
    event Unlocked(address indexed user, uint256 amount);
    event MinLockDurationUpdated(uint256 newDuration);

    /// @notice Lock IFR tokens for a minimum duration
    function lock(uint256 amount, uint256 duration) external nonReentrant {
        require(amount >= minRequired, "Below minimum");
        require(duration >= minLockDuration, "Duration too short");
        require(duration <= maxLockDuration, "Duration too long");
        require(locks[msg.sender].amount == 0, "Already locked");

        require(ifrToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        locks[msg.sender] = LockData({
            amount: amount,
            lockedAt: block.timestamp,
            duration: duration
        });

        emit Locked(msg.sender, amount, duration);
    }

    /// @notice Unlock after duration expires
    function unlock() external nonReentrant {
        LockData storage l = locks[msg.sender];
        require(l.amount > 0, "Nothing locked");
        require(block.timestamp >= l.lockedAt + l.duration, "Still locked");

        uint256 amount = l.amount;
        delete locks[msg.sender];

        require(ifrToken.transfer(msg.sender, amount), "Transfer failed");
        emit Unlocked(msg.sender, amount);
    }

    /// @notice Override: check lock instead of balance
    function hasAccess(address user) public view virtual override returns (bool) {
        return locks[user].amount >= minRequired;
    }

    /// @notice Check if lock period is still active
    function isLockActive(address user) public view returns (bool) {
        LockData memory l = locks[user];
        if (l.amount == 0) return false;
        return block.timestamp < l.lockedAt + l.duration;
    }

    /// @notice Seconds remaining until unlock possible
    function timeUntilUnlock(address user) public view returns (uint256) {
        LockData memory l = locks[user];
        if (l.amount == 0) return 0;
        uint256 unlockAt = l.lockedAt + l.duration;
        if (block.timestamp >= unlockAt) return 0;
        return unlockAt - block.timestamp;
    }

    /// @notice Locked amount for user
    function lockedAmount(address user) public view returns (uint256) {
        return locks[user].amount;
    }

    /// @notice Update minimum lock duration (internal — add access control)
    function _setMinLockDuration(uint256 _duration) internal {
        require(_duration >= 1 days, "Min 1 day");
        require(_duration <= 365 days, "Max 365 days");
        minLockDuration = _duration;
        emit MinLockDurationUpdated(_duration);
    }
}
