// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IUniswapV2Router {
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity);
    function factory() external view returns (address);
    function WETH() external view returns (address);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface ITeamFinanceLocker {
    function lockTokens(
        address token,
        address withdrawer,
        uint256 amount,
        uint256 unlockTime
    ) external payable returns (uint256 lockId);
}

/// @title BootstrapVaultV2
/// @notice Trustless, permissionless community bootstrap for IFR initial liquidity.
///         Contributors deposit ETH during a fixed window. After the window closes,
///         anyone can call finalise() to create the Uniswap V2 IFR/ETH LP and lock it.
///         Contributors then claim their pro-rata IFR share via claim().
///
///         V2 change: IFR must be sent to this contract BEFORE finalise() is called
///         (e.g. via LiquidityReserve.withdraw(thisAddress, 200M IFR)).
///         finalise() checks balanceOf instead of calling transferFrom.
contract BootstrapVaultV2 is ReentrancyGuard {
    IERC20 public immutable ifrToken;
    IUniswapV2Router public immutable uniswapRouter;
    ITeamFinanceLocker public immutable teamFinanceLocker;

    uint256 public immutable startTime;
    uint256 public immutable endTime;
    uint256 public immutable ifrAllocation;
    uint256 public immutable minContribution;
    uint256 public immutable maxContribution;
    uint256 public immutable lpLockDuration;

    mapping(address => uint256) public contributions;
    mapping(address => bool) public claimed;
    address[] public contributors;
    uint256 public totalETHRaised;
    bool public finalised;
    address public lpTokenAddress;
    uint256 public lpLockId;

    event Contributed(address indexed contributor, uint256 ethAmount, uint256 totalETH);
    event Finalised(uint256 totalETHRaised, uint256 ifrPerETH, address lpToken, uint256 lockId);
    event Claimed(address indexed contributor, uint256 ifrAmount);

    /// @notice Deploy BootstrapVaultV2 with immutable parameters
    /// @param _ifrToken IFR token address
    /// @param _uniswapRouter Uniswap V2 Router address
    /// @param _teamFinanceLocker Team.Finance locker (address(0) to skip external lock)
    /// @param _startTime Bootstrap start timestamp
    /// @param _duration Bootstrap duration in seconds
    /// @param _ifrAllocation IFR allocation for claims (equal amount used for LP)
    /// @param _minContribution Minimum ETH per contribution
    /// @param _maxContribution Maximum total ETH per wallet
    /// @param _lpLockDuration LP token lock duration in seconds
    constructor(
        address _ifrToken,
        address _uniswapRouter,
        address _teamFinanceLocker,
        uint256 _startTime,
        uint256 _duration,
        uint256 _ifrAllocation,
        uint256 _minContribution,
        uint256 _maxContribution,
        uint256 _lpLockDuration
    ) {
        require(_ifrToken != address(0), "ifrToken=0");
        require(_uniswapRouter != address(0), "router=0");
        require(_duration > 0, "duration=0");
        require(_ifrAllocation > 0, "allocation=0");
        require(_minContribution > 0, "minContrib=0");
        require(_maxContribution >= _minContribution, "max<min");

        ifrToken = IERC20(_ifrToken);
        uniswapRouter = IUniswapV2Router(_uniswapRouter);
        teamFinanceLocker = ITeamFinanceLocker(_teamFinanceLocker);
        startTime = _startTime;
        endTime = _startTime + _duration;
        ifrAllocation = _ifrAllocation;
        minContribution = _minContribution;
        maxContribution = _maxContribution;
        lpLockDuration = _lpLockDuration;
    }

    /// @notice Contribute ETH to the bootstrap pool
    function contribute() external payable nonReentrant {
        require(block.timestamp >= startTime, "not started");
        require(block.timestamp < endTime, "ended");
        require(!finalised, "finalised");
        require(msg.value >= minContribution, "below min");
        require(contributions[msg.sender] + msg.value <= maxContribution, "exceeds max");

        if (contributions[msg.sender] == 0) {
            contributors.push(msg.sender);
        }
        contributions[msg.sender] += msg.value;
        totalETHRaised += msg.value;

        emit Contributed(msg.sender, msg.value, totalETHRaised);
    }

    /// @notice Finalise the bootstrap: create LP, lock LP tokens.
    ///         Callable by anyone after endTime. Permissionless.
    ///         Requires 2 * ifrAllocation IFR already in this contract.
    function finalise() external nonReentrant {
        require(block.timestamp >= endTime, "bootstrap active");
        require(!finalised, "already finalised");
        finalised = true;

        if (totalETHRaised == 0) {
            emit Finalised(0, 0, address(0), 0);
            return;
        }

        // Verify IFR balance: ifrAllocation for LP + ifrAllocation for claims
        require(
            ifrToken.balanceOf(address(this)) >= ifrAllocation * 2,
            "BootstrapVault: insufficient IFR balance"
        );

        // Create Uniswap V2 LP: ifrAllocation IFR + all ETH
        ifrToken.approve(address(uniswapRouter), ifrAllocation);
        (,, uint256 liquidity) = uniswapRouter.addLiquidityETH{value: totalETHRaised}(
            address(ifrToken),
            ifrAllocation,
            0,
            0,
            address(this),
            block.timestamp
        );

        // Resolve LP token address
        address factory = uniswapRouter.factory();
        address weth = uniswapRouter.WETH();
        lpTokenAddress = IUniswapV2Factory(factory).getPair(address(ifrToken), weth);

        // Lock LP tokens via Team.Finance (if configured)
        if (address(teamFinanceLocker) != address(0) && liquidity > 0) {
            IERC20(lpTokenAddress).approve(address(teamFinanceLocker), liquidity);
            lpLockId = teamFinanceLocker.lockTokens(
                lpTokenAddress,
                address(this),
                liquidity,
                block.timestamp + lpLockDuration
            );
        }

        uint256 ifrPerETH = (ifrAllocation * 1e18) / totalETHRaised;
        emit Finalised(totalETHRaised, ifrPerETH, lpTokenAddress, lpLockId);
    }

    /// @notice Claim IFR tokens proportional to ETH contribution
    function claim() external nonReentrant {
        require(finalised, "not finalised");
        require(contributions[msg.sender] > 0, "no contribution");
        require(!claimed[msg.sender], "already claimed");

        claimed[msg.sender] = true;
        uint256 userIFR = (contributions[msg.sender] * ifrAllocation) / totalETHRaised;
        require(ifrToken.transfer(msg.sender, userIFR), "transfer failed");

        emit Claimed(msg.sender, userIFR);
    }

    /// @notice Get ETH contribution for a user
    function getContribution(address user) external view returns (uint256) {
        return contributions[user];
    }

    /// @notice Get estimated IFR claim for a user (before finalisation)
    function getEstimatedIFR(address user) external view returns (uint256) {
        if (totalETHRaised == 0) return 0;
        return (contributions[user] * ifrAllocation) / totalETHRaised;
    }

    /// @notice Get current bootstrap status
    function getBootstrapStatus() external view returns (
        bool active,
        bool _finalised,
        uint256 totalETH,
        uint256 timeRemaining,
        uint256 contributorCount
    ) {
        active = block.timestamp >= startTime && block.timestamp < endTime && !finalised;
        _finalised = finalised;
        totalETH = totalETHRaised;
        timeRemaining = block.timestamp < endTime ? endTime - block.timestamp : 0;
        contributorCount = contributors.length;
    }

    /// @notice Get the IFR start price (ETH per IFR, scaled by 1e18)
    function getStartPrice() external view returns (uint256 ethPerIFR) {
        if (totalETHRaised == 0 || ifrAllocation == 0) return 0;
        return (totalETHRaised * 1e18) / ifrAllocation;
    }
}
