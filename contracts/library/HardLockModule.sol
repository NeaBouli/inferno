// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BaseAccessModule.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HardLockModule — Time-Bound Token Lock
/// @notice Tokens must be locked for a minimum duration. Cannot unlock early.
///         Builder heuristic: strongest commitment option (configuration score, not an audit verdict).
///         IFR is a fee-on-transfer token: lock() credits the balance delta this
///         contract actually received, never the requested amount.
abstract contract HardLockModule is BaseAccessModule, ReentrancyGuard {
    using SafeERC20 for IERC20;

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
    /// @dev Credits the measured balance delta (fee-on-transfer safe). The received
    ///      amount, not `amount`, is stored, emitted and later transferred out by unlock().
    /// @param amount Requested amount pulled via transferFrom (must be >= minRequired)
    /// @param duration Lock duration in seconds (minLockDuration..maxLockDuration)
    function lock(uint256 amount, uint256 duration) external nonReentrant {
        require(amount >= minRequired, "Below minimum");
        require(duration >= minLockDuration, "Duration too short");
        require(duration <= maxLockDuration, "Duration too long");
        require(locks[msg.sender].amount == 0, "Already locked");

        uint256 balanceBefore = ifrToken.balanceOf(address(this));
        ifrToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = ifrToken.balanceOf(address(this)) - balanceBefore;
        require(received > 0, "Nothing received");
        require(received >= minRequired, "Below minimum after fee");

        locks[msg.sender] = LockData({
            amount: received,
            lockedAt: block.timestamp,
            duration: duration
        });

        emit Locked(msg.sender, received, duration);
    }

    /// @notice Unlock after duration expires; transfers the credited (received) amount.
    /// @dev IFR's transfer fee may apply to this outgoing transfer, so the wallet can receive
    ///      less than the credited amount unless this contract is fee-exempt.
    function unlock() external nonReentrant {
        LockData storage l = locks[msg.sender];
        require(l.amount > 0, "Nothing locked");
        require(block.timestamp >= l.lockedAt + l.duration, "Still locked");

        uint256 amount = l.amount;
        delete locks[msg.sender];

        ifrToken.safeTransfer(msg.sender, amount);
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
