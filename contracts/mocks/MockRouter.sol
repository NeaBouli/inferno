// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal interface für einen mintbaren ERC20 (unser MockToken)
interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

/// UniswapV2-ähnlicher Mock-Router für Tests.
/// - Quotiert mit `getAmountsOut`
/// - Führt Swap mit `swapExactETHForTokens` aus und mintet IFR an den Empfänger
contract MockRouter {
    address public immutable WETH_ADDR;
    address public immutable IFR_ADDR;

    // IFR pro 1 ETH, skaliert mit 1e18 (z.B. 1000e18 = 1000 IFR / ETH)
    uint256 public rateIfrPerEth;

    // Optional: künstliche Slippage nur für den NÄCHSTEN Swap (in BPS, 10000 = 100%)
    uint256 public slippageBpsNextSwap;

    constructor(address _weth, address _ifr, uint256 _rateIfrPerEth) {
        WETH_ADDR = _weth;
        IFR_ADDR = _ifr;
        rateIfrPerEth = _rateIfrPerEth;
    }

    // Uniswap-kompatibler Getter-Name
    function WETH() external view returns (address) {
        return WETH_ADDR;
    }

    // Quote-Funktion
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts) {
        require(path.length == 2, "path");
        require(path[0] == WETH_ADDR && path[1] == IFR_ADDR, "unsupported path");
        amounts = new uint;
        amounts[0] = amountIn;
        amounts[1] = amountIn * rateIfrPerEth / 1e18;
    }

    // Rate anpassen (für Tests)
    function setRate(uint256 _rate) external {
        rateIfrPerEth = _rate;
    }

    // Künstliche Slippage nur für den nächsten Swap (BPS)
    function setSlippageBpsNextSwap(uint256 bps) external {
        require(bps <= 10_000, "bps>100%");
        slippageBpsNextSwap = bps;
    }

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint /*deadline*/
    ) external payable returns (uint[] memory amounts) {
        require(path.length == 2, "path");
        require(path[0] == WETH_ADDR && path[1] == IFR_ADDR, "unsupported path");
        require(msg.value > 0, "no ETH");

        // Ausgangsmenge IFR nach Quote
        uint out = msg.value * rateIfrPerEth / 1e18;

        // Optional künstliche Slippage für genau diesen Swap
        if (slippageBpsNextSwap > 0) {
            out = out * (10_000 - slippageBpsNextSwap) / 10_000;
            slippageBpsNextSwap = 0; // reset
        }

        require(out >= amountOutMin, "slippage");

        // Mint IFR direkt an den Empfänger (unser MockToken erlaubt das)
        IMintableERC20(IFR_ADDR).mint(to, out);

        amounts = new uint;
        amounts[0] = msg.value;
        amounts[1] = out;
    }
}
