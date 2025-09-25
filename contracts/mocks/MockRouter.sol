// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

/// @title MockRouter
/// @notice Deterministic UniswapV2-like router used for unit tests.
contract MockRouter {
    address public immutable WETH_ADDR;
    address public immutable IFR_ADDR;

    uint256 public rateIfrPerEth;       // IFR per 1 ETH (scaled with 1e18)
    uint256 public slippageBpsNextSwap; // Optional: artificial slippage for the NEXT swap only

    constructor(address _weth, address _ifr, uint256 _rateIfrPerEth) {
        WETH_ADDR = _weth;
        IFR_ADDR = _ifr;
        rateIfrPerEth = _rateIfrPerEth;
    }

    function WETH() external view returns (address) {
        return WETH_ADDR;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        require(path.length == 2, "path");
        require(path[0] == WETH_ADDR && path[1] == IFR_ADDR, "unsupported path");
        amounts = new uint256 ;
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
        if (slippageBpsNextSwap > 0) {
            out = (out * (10_000 - slippageBpsNextSwap)) / 10_000;
            slippageBpsNextSwap = 0;
        }

        require(out >= amountOutMin, "slippage");

        IMintableERC20(IFR_ADDR).mint(to, out);

        amounts = new uint256 ;
        amounts[0] = msg.value;
        amounts[1] = out;
    }
}
