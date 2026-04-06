// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CooldownModule — Anti-Gaming Cooldown
/// @notice Prevents flash access exploitation by enforcing minimum time between actions.
///         Default: 24h cooldown. Security Score: +20 points.
abstract contract CooldownModule {
    mapping(address => uint256) public lastAction;

    uint256 public cooldownDuration = 24 hours;
    uint256 public constant MIN_COOLDOWN = 1 hours;
    uint256 public constant MAX_COOLDOWN = 30 days;

    event ActionRecorded(address indexed user, uint256 timestamp);
    event CooldownDurationUpdated(uint256 newDuration);

    /// @notice Check if user is currently in cooldown
    function isInCooldown(address user) public view returns (bool) {
        if (lastAction[user] == 0) return false;
        return block.timestamp < lastAction[user] + cooldownDuration;
    }

    /// @notice Seconds remaining in cooldown (0 if not in cooldown)
    function cooldownRemaining(address user) public view returns (uint256) {
        if (lastAction[user] == 0) return 0;
        uint256 cooldownEnd = lastAction[user] + cooldownDuration;
        if (block.timestamp >= cooldownEnd) return 0;
        return cooldownEnd - block.timestamp;
    }

    /// @notice Record an action for cooldown tracking
    function _recordAction(address user) internal {
        lastAction[user] = block.timestamp;
        emit ActionRecorded(user, block.timestamp);
    }

    /// @notice Modifier: require cooldown has passed, then record action
    modifier cooldownPassed() {
        require(!isInCooldown(msg.sender), "Cooldown active");
        _;
        _recordAction(msg.sender);
    }

    /// @notice Update cooldown duration (internal — add access control)
    function _setCooldownDuration(uint256 _duration) internal {
        require(_duration >= MIN_COOLDOWN, "Below min cooldown");
        require(_duration <= MAX_COOLDOWN, "Above max cooldown");
        cooldownDuration = _duration;
        emit CooldownDurationUpdated(_duration);
    }
}
