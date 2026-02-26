// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title LiquidityReserve
/// @notice Holds IFR tokens as strategic liquidity reserve with time-lock
///         and staged withdrawal (max per period) to prevent supply shock.
contract LiquidityReserve {
    address public immutable owner;
    address public guardian;
    IERC20 public immutable token;

    uint256 public immutable lockEnd;
    uint256 public immutable periodDuration;
    uint256 public maxWithdrawPerPeriod;

    uint256 public lastWithdrawPeriod;
    uint256 public withdrawnThisPeriod;
    uint256 public totalWithdrawn;

    bool public paused;

    event Withdrawn(address indexed to, uint256 amount);
    event MaxWithdrawPerPeriodUpdated(uint256 newMax);
    event GuardianUpdated(address indexed newGuardian);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == guardian, "not guardian");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    /// @notice Deploy LiquidityReserve with time-lock and staged withdrawal
    /// @param _token IFR token address
    /// @param _lockDuration Lock period in seconds (e.g. 180 days)
    /// @param _maxWithdrawPerPeriod Max tokens withdrawable per period
    /// @param _periodDuration Period length in seconds (e.g. 90 days)
    /// @param _guardian Address that can pause/unpause withdrawals
    constructor(
        address _token,
        uint256 _lockDuration,
        uint256 _maxWithdrawPerPeriod,
        uint256 _periodDuration,
        address _guardian
    ) {
        require(_token != address(0), "token=0");
        require(_guardian != address(0), "guardian=0");
        require(_lockDuration > 0, "lockDuration=0");
        require(_periodDuration > 0, "periodDuration=0");
        require(_maxWithdrawPerPeriod > 0, "maxWithdraw=0");

        owner = msg.sender;
        token = IERC20(_token);
        lockEnd = block.timestamp + _lockDuration;
        periodDuration = _periodDuration;
        maxWithdrawPerPeriod = _maxWithdrawPerPeriod;
        guardian = _guardian;
    }

    /// @notice Withdraw tokens after lock period, respecting per-period limit
    /// @param to Recipient address
    /// @param amount Amount of IFR tokens to withdraw
    function withdraw(address to, uint256 amount) external onlyOwner whenNotPaused {
        require(block.timestamp >= lockEnd, "locked");
        require(amount > 0, "amount=0");
        require(to != address(0), "to=0");
        require(amount <= token.balanceOf(address(this)), "exceeds balance");

        uint256 period = currentPeriod();
        if (period != lastWithdrawPeriod) {
            lastWithdrawPeriod = period;
            withdrawnThisPeriod = 0;
        }

        require(withdrawnThisPeriod + amount <= maxWithdrawPerPeriod, "exceeds period limit");

        withdrawnThisPeriod += amount;
        totalWithdrawn += amount;

        require(token.transfer(to, amount), "transfer failed");
        emit Withdrawn(to, amount);
    }

    /// @notice Current period number (0-indexed from lockEnd)
    function currentPeriod() public view returns (uint256) {
        if (block.timestamp < lockEnd) return 0;
        return (block.timestamp - lockEnd) / periodDuration;
    }

    /// @notice Amount available to withdraw in current period
    function availableToWithdraw() external view returns (uint256) {
        if (block.timestamp < lockEnd || paused) return 0;

        uint256 period = currentPeriod();
        uint256 usedThisPeriod = (period == lastWithdrawPeriod) ? withdrawnThisPeriod : 0;
        uint256 periodRemaining = maxWithdrawPerPeriod - usedThisPeriod;

        uint256 balance = token.balanceOf(address(this));
        return balance < periodRemaining ? balance : periodRemaining;
    }

    /// @notice Token balance held by this contract
    function pendingBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Update max withdraw per period
    /// @param _max New maximum per-period withdrawal amount
    function setMaxWithdrawPerPeriod(uint256 _max) external onlyOwner {
        require(_max > 0, "maxWithdraw=0");
        maxWithdrawPerPeriod = _max;
        emit MaxWithdrawPerPeriodUpdated(_max);
    }

    /// @notice Update guardian address
    /// @param _guardian New guardian address
    function setGuardian(address _guardian) external onlyOwner {
        require(_guardian != address(0), "guardian=0");
        guardian = _guardian;
        emit GuardianUpdated(_guardian);
    }

    /// @notice Pause withdrawals (guardian only)
    function pause() external onlyGuardian {
        require(!paused, "already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause withdrawals (guardian only)
    function unpause() external onlyGuardian {
        require(paused, "not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }
}
