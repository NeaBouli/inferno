// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
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
}

/// @title BuybackVault
/// @notice Receives ETH (from pool fees), swaps to IFR via Uniswap V2, splits 50/50 between
///         burn reserve and treasury. 60-day activation delay. Owner-only execution with cooldown.
contract BuybackVault {
    address public owner;
    address public immutable guardian;

    IERC20 public immutable token;
    address public immutable burnReserve;
    address public treasury;
    IRouter public router;

    uint256 public burnShareBps = 5000;   // 50 %
    uint256 public cooldown = 3600;       // 1 hour
    uint256 public slippageBps = 500;     // 5 %
    uint256 public lastBuybackAt;
    uint256 public immutable activationTime;

    bool public paused;

    // Accumulated expected output from deposits (quote at deposit time)
    uint256 public pendingExpectedOut;

    event Deposited(address indexed sender, uint256 amount);
    event BuybackExecuted(uint256 ethSpent, uint256 burnAmount, uint256 treasuryAmount);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event ParamsUpdated(uint256 burnShareBps, uint256 cooldown, uint256 slippageBps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == guardian, "not guardian");
        _;
    }

    /// @notice Deploy BuybackVault with activation delay
    /// @param _token IFR token address
    /// @param _burnReserve BurnReserve contract address (receives burn share)
    /// @param _treasury Treasury address (receives remaining share)
    /// @param _router Uniswap V2 router address
    /// @param _guardian Address that can pause/unpause
    /// @param _activationDelay Seconds until buyback execution is allowed
    constructor(
        address _token,
        address _burnReserve,
        address _treasury,
        address _router,
        address _guardian,
        uint256 _activationDelay
    ) {
        require(_burnReserve != address(0), "burnReserve=0");
        require(_treasury != address(0), "treasury=0");
        require(_guardian != address(0), "guardian=0");

        owner = msg.sender;
        token = IERC20(_token);
        burnReserve = _burnReserve;
        treasury = _treasury;
        router = IRouter(_router);
        guardian = _guardian;
        activationTime = block.timestamp + _activationDelay;
    }

    /// @notice Pause buyback execution (guardian only)
    function pause() external onlyGuardian {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause buyback execution (guardian only)
    function unpause() external onlyGuardian {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Deposit ETH for future buyback. Records expected output at current price.
    function depositETH() external payable {
        require(msg.value > 0, "no ETH");

        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = address(token);

        uint256[] memory amounts = router.getAmountsOut(msg.value, path);
        pendingExpectedOut += amounts[1];

        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Execute buyback: swap all ETH to IFR, split between burn reserve and treasury
    function executeBuyback() external onlyOwner {
        require(!paused, "Pausable: paused");
        require(block.timestamp >= activationTime, "not active yet");
        require(block.timestamp >= lastBuybackAt + cooldown, "cooldown");

        lastBuybackAt = block.timestamp;

        uint256 ethBal = address(this).balance;
        if (ethBal == 0) {
            pendingExpectedOut = 0;
            emit BuybackExecuted(0, 0, 0);
            return;
        }

        uint256 minOut = (pendingExpectedOut * (10_000 - slippageBps)) / 10_000;
        pendingExpectedOut = 0;

        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = address(token);

        uint256[] memory amounts = router.swapExactETHForTokens{value: ethBal}(
            minOut, path, address(this), block.timestamp
        );

        uint256 totalOut = amounts[1];
        uint256 burnAmount = (totalOut * burnShareBps) / 10_000;
        uint256 treasuryAmount = totalOut - burnAmount;

        require(token.transfer(burnReserve, burnAmount), "burn transfer failed");
        require(token.transfer(treasury, treasuryAmount), "treasury transfer failed");

        emit BuybackExecuted(ethBal, burnAmount, treasuryAmount);
    }

    /// @notice Update vault parameters (owner only)
    /// @param _burnShareBps Percentage sent to burn reserve (in bps, default 5000 = 50%)
    /// @param _cooldown Minimum seconds between buybacks (default 3600)
    /// @param _slippageBps Maximum slippage tolerance (in bps, default 500 = 5%)
    /// @param _router Uniswap V2 router address
    /// @param _treasury Treasury address
    function setParams(
        uint256 _burnShareBps,
        uint256 _cooldown,
        uint256 _slippageBps,
        address _router,
        address _treasury
    ) external onlyOwner {
        require(_treasury != address(0), "treasury=0");

        burnShareBps = _burnShareBps;
        cooldown = _cooldown;
        slippageBps = _slippageBps;
        router = IRouter(_router);
        treasury = _treasury;
        emit ParamsUpdated(_burnShareBps, _cooldown, _slippageBps);
    }

    /// @notice Transfer ownership to a new address
    /// @param newOwner Address of the new owner
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "newOwner=0");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    /// @notice Allows the contract to receive ETH directly
    receive() external payable {}
}
