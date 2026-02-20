// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title IFRLock
/// @notice Lock IFR tokens without rewards or vesting.
///         Designed as a generic, multi-app-capable lock contract.
///         External resolvers can query isLocked() to gate access.
///
///         IMPORTANT: This contract MUST be set as feeExempt on InfernoToken
///         to prevent fee deductions on lock/unlock transfers.
contract IFRLock is ReentrancyGuard, Pausable {
    IERC20 public immutable token;
    address public guardian;

    struct LockData {
        uint256 amount;
        uint256 lockedAt;
    }

    mapping(address => LockData) private _locks;

    uint256 public totalLocked;

    event Locked(address indexed user, uint256 amount, bytes32 indexed lockType);
    event Unlocked(address indexed user, uint256 amount);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    modifier onlyGuardian() {
        require(msg.sender == guardian, "not guardian");
        _;
    }

    constructor(address _token, address _guardian) {
        require(_token != address(0), "token=0");
        require(_guardian != address(0), "guardian=0");
        token = IERC20(_token);
        guardian = _guardian;
    }

    /// @notice Lock IFR tokens (default lockType = 0x0)
    /// @param amount Amount of IFR to lock (requires prior approval)
    function lock(uint256 amount) external {
        _lock(msg.sender, amount, bytes32(0));
    }

    /// @notice Lock IFR tokens with a lock type tag for multi-app use
    /// @param amount Amount of IFR to lock (requires prior approval)
    /// @param lockType Application-defined lock reason (e.g. keccak256("premium"))
    function lockWithType(uint256 amount, bytes32 lockType) external {
        _lock(msg.sender, amount, lockType);
    }

    /// @notice Unlock all locked IFR tokens and return them to the caller
    function unlock() external nonReentrant {
        LockData storage ld = _locks[msg.sender];
        uint256 amount = ld.amount;
        require(amount > 0, "nothing locked");

        totalLocked -= amount;
        delete _locks[msg.sender];

        require(token.transfer(msg.sender, amount), "transfer failed");

        emit Unlocked(msg.sender, amount);
    }

    /// @notice Get locked balance for a user
    function lockedBalance(address user) external view returns (uint256) {
        return _locks[user].amount;
    }

    /// @notice Check if a user has at least minAmount locked
    /// @param user Address to check
    /// @param minAmount Minimum required lock amount
    /// @return True if user's locked amount >= minAmount
    function isLocked(address user, uint256 minAmount) external view returns (bool) {
        return _locks[user].amount >= minAmount;
    }

    /// @notice Get full lock info for a user
    /// @return amount Locked IFR amount
    /// @return lockedAt Timestamp when the lock was created/last increased
    function lockInfo(address user) external view returns (uint256 amount, uint256 lockedAt) {
        LockData storage ld = _locks[user];
        return (ld.amount, ld.lockedAt);
    }

    /// @notice Pause lock() — unlock() remains available
    function pause() external onlyGuardian {
        _pause();
    }

    /// @notice Unpause lock()
    function unpause() external onlyGuardian {
        _unpause();
    }

    /// @notice Update guardian address
    function setGuardian(address _guardian) external onlyGuardian {
        require(_guardian != address(0), "guardian=0");
        address old = guardian;
        guardian = _guardian;
        emit GuardianUpdated(old, _guardian);
    }

    function _lock(address user, uint256 amount, bytes32 lockType) internal whenNotPaused nonReentrant {
        require(amount > 0, "amount=0");
        require(token.transferFrom(user, address(this), amount), "transfer failed");

        LockData storage ld = _locks[user];
        ld.amount += amount;
        ld.lockedAt = block.timestamp;

        totalLocked += amount;

        emit Locked(user, amount, lockType);
    }
}
