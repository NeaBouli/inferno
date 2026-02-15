// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract Vesting {
    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable start;
    uint256 public immutable cliffDuration;
    uint256 public immutable duration;
    uint256 public immutable totalAllocation;
    uint256 public released;
    address public immutable guardian;
    bool public paused;

    event Released(address indexed beneficiary, uint256 amount);
    event Paused(address indexed guardian);
    event Unpaused(address indexed guardian);

    error NotBeneficiary();
    error NothingToRelease();
    error OnlyGuardian();
    error IsPaused();

    constructor(
        address _token,
        address _beneficiary,
        uint256 _cliffDuration,
        uint256 _duration,
        uint256 _totalAllocation,
        address _guardian
    ) {
        require(_token != address(0), "token=0");
        require(_beneficiary != address(0), "beneficiary=0");
        require(_guardian != address(0), "guardian=0");
        require(_duration >= _cliffDuration, "duration<cliff");
        require(_totalAllocation > 0, "allocation=0");

        token = IERC20(_token);
        beneficiary = _beneficiary;
        start = block.timestamp;
        cliffDuration = _cliffDuration;
        duration = _duration;
        totalAllocation = _totalAllocation;
        guardian = _guardian;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert OnlyGuardian();
        _;
    }

    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        _;
    }

    function pause() external onlyGuardian {
        if (!paused) {
            paused = true;
            emit Paused(msg.sender);
        }
    }

    function unpause() external onlyGuardian {
        if (paused) {
            paused = false;
            emit Unpaused(msg.sender);
        }
    }

    function release() external onlyBeneficiary {
        if (paused) revert IsPaused();
        uint256 amt = releasableAmount();
        if (amt == 0) revert NothingToRelease();
        released += amt;
        require(token.transfer(beneficiary, amt), "transfer failed");
        emit Released(beneficiary, amt);
    }

    function releasableAmount() public view returns (uint256) {
        uint256 vested = vestedAmount();
        if (vested <= released) return 0;
        return vested - released;
    }

    function vestedAmount() public view returns (uint256) {
        uint256 elapsed = block.timestamp - start;
        if (elapsed < cliffDuration) {
            return 0;
        }
        if (elapsed >= duration) {
            return totalAllocation;
        }
        uint256 vestingElapsed = elapsed - cliffDuration;
        uint256 vestingDuration = duration - cliffDuration;
        return (totalAllocation * vestingElapsed) / vestingDuration;
    }

    function vestingSchedule()
        external
        view
        returns (uint256 _start, uint256 _cliff, uint256 _duration)
    {
        return (start, cliffDuration, duration);
    }
}
