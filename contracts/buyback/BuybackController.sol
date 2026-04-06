// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IRouter {
    function WETH() external view returns (address);
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory);
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory);
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

/// @title BuybackController
/// @notice Automatic fee distribution: collects ETH from FeeRouterV1,
///         50% → buy IFR and send to BurnReserve (deflationary),
///         50% → add Uniswap V2 liquidity (deepen pool).
///         Permissionless execution after cooldown. Governance-only config.
/// @dev Phase 3+ feature — activated after Bootstrap finalise() + LP launch.
contract BuybackController {
    address public owner;
    address public immutable guardian;

    IERC20 public immutable token;
    address public immutable burnReserve;
    IRouter public router;
    address public lpReceiver;

    uint256 public constant BURN_SHARE_BPS = 5000;  // 50%
    uint256 public constant LP_SHARE_BPS = 5000;    // 50%

    uint256 public cooldown = 24 hours;
    uint256 public lastExecution;
    uint256 public minTriggerAmount = 0.01 ether;
    uint256 public slippageBps = 500;  // 5%

    bool public paused;

    // Cumulative stats
    uint256 public totalETHProcessed;
    uint256 public totalIFRBurned;
    uint256 public totalLiquidityAdded;
    uint256 public executionCount;

    event BuybackExecuted(uint256 ethSpent, uint256 ifrBought, uint256 ifrToBurn);
    event LiquidityAdded(uint256 ethUsed, uint256 ifrUsed, uint256 liquidity);
    event LiquidityFallback(uint256 ethRedirected);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownUpdated(uint256 newCooldown);
    event MinTriggerUpdated(uint256 newMin);
    event SlippageUpdated(uint256 newSlippageBps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == guardian, "not guardian");
        _;
    }

    /// @param _token IFR token address
    /// @param _burnReserve BurnReserve contract (receives bought IFR for burn)
    /// @param _router Uniswap V2 Router address
    /// @param _lpReceiver Address that holds LP tokens (e.g. TreasurySafe)
    /// @param _guardian Address that can pause/unpause
    /// @param _governance Initial owner (Governance timelock)
    constructor(
        address _token,
        address _burnReserve,
        address _router,
        address _lpReceiver,
        address _guardian,
        address _governance
    ) {
        require(_token != address(0), "token=0");
        require(_burnReserve != address(0), "burnReserve=0");
        require(_router != address(0), "router=0");
        require(_lpReceiver != address(0), "lpReceiver=0");
        require(_guardian != address(0), "guardian=0");
        require(_governance != address(0), "governance=0");

        owner = _governance;
        token = IERC20(_token);
        burnReserve = _burnReserve;
        router = IRouter(_router);
        lpReceiver = _lpReceiver;
        guardian = _guardian;
    }

    /// @notice Receive ETH from FeeRouterV1 or direct transfers
    receive() external payable {}

    // ── Guardian ────────────────────────────────────────────────

    function pause() external onlyGuardian {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyGuardian {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ── Permissionless Execution ────────────────────────────────

    /// @notice Execute buyback + LP cycle. Anyone can call after cooldown.
    function execute() external {
        require(!paused, "Pausable: paused");
        require(block.timestamp >= lastExecution + cooldown, "cooldown");
        require(address(this).balance >= minTriggerAmount, "insufficient ETH");

        lastExecution = block.timestamp;
        executionCount++;

        uint256 totalETH = address(this).balance;
        totalETHProcessed += totalETH;

        uint256 burnETH = (totalETH * BURN_SHARE_BPS) / 10_000;
        uint256 lpETH = totalETH - burnETH;

        // Phase 1: Buy IFR → BurnReserve
        _buybackAndBurn(burnETH);

        // Phase 2: Add liquidity with remaining ETH + any IFR in contract
        _addLiquidity(lpETH);
    }

    function _buybackAndBurn(uint256 ethAmount) internal {
        if (ethAmount == 0) return;

        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = address(token);

        uint256[] memory expected = router.getAmountsOut(ethAmount, path);
        uint256 minOut = (expected[1] * (10_000 - slippageBps)) / 10_000;

        uint256[] memory amounts = router.swapExactETHForTokens{value: ethAmount}(
            minOut, path, burnReserve, block.timestamp
        );

        totalIFRBurned += amounts[1];
        emit BuybackExecuted(ethAmount, amounts[1], amounts[1]);
    }

    function _addLiquidity(uint256 ethAmount) internal {
        if (ethAmount == 0) return;

        uint256 ifrBalance = token.balanceOf(address(this));
        if (ifrBalance == 0) {
            // No IFR available for LP — redirect to buyback+burn
            _buybackAndBurn(ethAmount);
            emit LiquidityFallback(ethAmount);
            return;
        }

        token.approve(address(router), ifrBalance);

        try router.addLiquidityETH{value: ethAmount}(
            address(token),
            ifrBalance,
            0,       // accept any amount of IFR
            0,       // accept any amount of ETH
            lpReceiver,
            block.timestamp
        ) returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
            totalLiquidityAdded += liquidity;
            emit LiquidityAdded(amountETH, amountToken, liquidity);

            // Refund unused ETH/IFR stays in contract for next cycle
        } catch {
            // LP failed → redirect ETH to buyback
            _buybackAndBurn(ethAmount);
            emit LiquidityFallback(ethAmount);
        }
    }

    // ── Owner-only Config ───────────────────────────────────────

    function setCooldown(uint256 _cooldown) external onlyOwner {
        require(_cooldown >= 1 hours, "min 1h");
        require(_cooldown <= 7 days, "max 7d");
        cooldown = _cooldown;
        emit CooldownUpdated(_cooldown);
    }

    function setMinTrigger(uint256 _min) external onlyOwner {
        require(_min > 0, "min=0");
        minTriggerAmount = _min;
        emit MinTriggerUpdated(_min);
    }

    function setSlippage(uint256 _bps) external onlyOwner {
        require(_bps <= 1000, "max 10%");
        slippageBps = _bps;
        emit SlippageUpdated(_bps);
    }

    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "router=0");
        router = IRouter(_router);
    }

    function setLpReceiver(address _lpReceiver) external onlyOwner {
        require(_lpReceiver != address(0), "lpReceiver=0");
        lpReceiver = _lpReceiver;
    }

    /// @notice Emergency withdraw ETH (Governance only)
    function withdrawETH(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        require(amount <= address(this).balance, "insufficient");
        payable(to).transfer(amount);
    }

    /// @notice Emergency withdraw IFR (Governance only)
    function withdrawIFR(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "to=0");
        token.transfer(to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "newOwner=0");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    // ── View Functions ──────────────────────────────────────────

    function pendingETH() external view returns (uint256) {
        return address(this).balance;
    }

    function canExecute() external view returns (bool) {
        return !paused
            && block.timestamp >= lastExecution + cooldown
            && address(this).balance >= minTriggerAmount;
    }

    function stats() external view returns (
        uint256 _totalETHProcessed,
        uint256 _totalIFRBurned,
        uint256 _totalLiquidityAdded,
        uint256 _executionCount
    ) {
        return (totalETHProcessed, totalIFRBurned, totalLiquidityAdded, executionCount);
    }
}
