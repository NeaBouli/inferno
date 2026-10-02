// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

interface IBalanceOf {
    function balanceOf(address account) external view returns (uint256);
}

/// @title MockRouter
/// @notice Deterministic UniswapV2-like router used for unit tests.
contract MockRouter {
    address public immutable WETH_ADDR;
    address public immutable IFR_ADDR;

    // IFR pro 1 ETH, skaliert mit 1e18 (z.B. 1000e18 = 1000 IFR / ETH)
    uint256 public rateIfrPerEth;

    // Optional: künstliche Slippage nur für den nächsten Swap (in BPS, 10000 = 100%)
    uint256 public slippageBpsNextSwap;

    constructor(address _weth, address _ifr, uint256 _rateIfrPerEth) {
        WETH_ADDR = _weth;
        IFR_ADDR = _ifr;
        rateIfrPerEth = _rateIfrPerEth;
    }

    function WETH() external view returns (address) {
        return WETH_ADDR;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        require(path.length == 2, "path");
        require(path[0] == WETH_ADDR && path[1] == IFR_ADDR, "unsupported path");

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = (amountIn * rateIfrPerEth) / 1e18;
    }

    function setRate(uint256 _rate) external {
        rateIfrPerEth = _rate;
    }

    function setSlippageBpsNextSwap(uint256 bps) external {
        require(bps <= 10_000, "bps>100%");
        slippageBpsNextSwap = bps;
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external payable returns (uint256[] memory amounts) {
        require(path.length == 2, "path");
        require(path[0] == WETH_ADDR && path[path.length - 1] == IFR_ADDR, "unsupported path");
        require(msg.value > 0, "no ETH");

        uint256 out = (msg.value * rateIfrPerEth) / 1e18;

        // Optional künstliche Slippage für genau diesen Swap
        if (slippageBpsNextSwap > 0) {
            out = (out * (10_000 - slippageBpsNextSwap)) / 10_000;
            slippageBpsNextSwap = 0; // reset
        }

        require(out >= amountOutMin, "slippage");

        // Mint IFR direkt an den Empfänger (unser MockToken erlaubt das)
        IMintableERC20(IFR_ADDR).mint(to, out);

        amounts = new uint256[](2);
        amounts[0] = msg.value;
        amounts[1] = out;
    }

    // ── Fee-on-transfer swap (UniswapV2Router02 semantics) ─────

    /// @notice Transfer tax applied to the swap output, in bps (simulates a taxed token).
    uint256 public transferFeeBpsOnOutput;

    /// @notice Optional contract to call back into during the next fee-on-transfer swap (reentrancy tests).
    address public reenterTarget;
    bytes4 public lastReentryRevertSelector;

    function setReenterTarget(address target) external {
        reenterTarget = target;
    }

    function setTransferFeeBpsOnOutput(uint256 bps) external {
        require(bps <= 10_000, "bps>100%");
        transferFeeBpsOnOutput = bps;
    }

    /// @notice Like Uniswap V2: no amounts returned; the minimum is checked against the
    ///         recipient's actual balance increase after the (taxed) token transfer.
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external payable {
        require(path.length == 2, "path");
        require(path[0] == WETH_ADDR && path[path.length - 1] == IFR_ADDR, "unsupported path");
        require(msg.value > 0, "no ETH");

        uint256 quoted = (msg.value * rateIfrPerEth) / 1e18;
        if (slippageBpsNextSwap > 0) {
            quoted = (quoted * (10_000 - slippageBpsNextSwap)) / 10_000;
            slippageBpsNextSwap = 0;
        }
        uint256 delivered = quoted - (quoted * transferFeeBpsOnOutput) / 10_000;

        if (reenterTarget != address(0)) {
            address target = reenterTarget;
            reenterTarget = address(0);
            (bool ok, bytes memory reason) = target.call(abi.encodeWithSignature("execute()"));
            require(!ok, "MockRouter: reentry succeeded");
            lastReentryRevertSelector = reason.length >= 4 ? bytes4(reason) : bytes4(0);
        }

        uint256 balanceBefore = IBalanceOf(IFR_ADDR).balanceOf(to);
        IMintableERC20(IFR_ADDR).mint(to, delivered);
        require(IBalanceOf(IFR_ADDR).balanceOf(to) - balanceBefore >= amountOutMin, "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
    }

    // ── addLiquidityETH (for BuybackController tests) ──────────

    bool public addLiquidityReverts;
    uint256 public liquidityMinted;

    function setAddLiquidityReverts(bool _reverts) external {
        addLiquidityReverts = _reverts;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 /*amountTokenMin*/,
        uint256 /*amountETHMin*/,
        address to,
        uint256 /*deadline*/
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(!addLiquidityReverts, "MockRouter: addLiquidity reverts");
        require(token == IFR_ADDR, "unsupported token");
        require(msg.value > 0, "no ETH");

        // Transfer IFR from sender to this contract (simulates LP deposit)
        // In real Uniswap the router pulls tokens via transferFrom
        // For testing we just accept whatever is offered
        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = msg.value; // 1:1 mock LP tokens

        liquidityMinted += liquidity;

        // Emit nothing — the BuybackController emits its own event
    }
}
