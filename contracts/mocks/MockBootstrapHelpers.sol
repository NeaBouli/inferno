// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockLPToken — Simple ERC20 for LP token simulation in tests
contract MockLPToken is ERC20 {
    constructor() ERC20("Mock LP Token", "LP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title MockBootstrapRouter — Simulates Uniswap V2 Router for bootstrap tests.
///        Also acts as its own factory (getPair returns the LP token address).
contract MockBootstrapRouter {
    address public immutable wethAddr;
    MockLPToken public lpToken;

    constructor(address _weth) {
        wethAddr = _weth;
        lpToken = new MockLPToken();
    }

    function factory() external view returns (address) {
        return address(this);
    }

    function WETH() external view returns (address) {
        return wethAddr;
    }

    function getPair(address, address) external view returns (address) {
        return address(lpToken);
    }

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint /*amountTokenMin*/,
        uint /*amountETHMin*/,
        address to,
        uint /*deadline*/
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity) {
        IERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);
        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = msg.value; // 1:1 LP tokens per ETH
        lpToken.mint(to, liquidity);
    }
}

/// @title MockTeamFinanceLocker — Simulates Team.Finance LP locker for tests
contract MockTeamFinanceLocker {
    uint256 public nextLockId = 1;

    struct Lock {
        address token;
        address withdrawer;
        uint256 amount;
        uint256 unlockTime;
    }

    mapping(uint256 => Lock) public locks;

    function lockTokens(
        address token,
        address withdrawer,
        uint256 amount,
        uint256 unlockTime
    ) external payable returns (uint256 lockId) {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        lockId = nextLockId++;
        locks[lockId] = Lock(token, withdrawer, amount, unlockTime);
    }
}
