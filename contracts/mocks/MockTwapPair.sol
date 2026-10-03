// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockTwapPair
/// @notice Test-only Uniswap V2 pair surface: reserves plus price cumulatives that accrue like UniswapV2Pair._update.
contract MockTwapPair {
    address public immutable token0;
    address public immutable token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    /// @notice Accrue cumulatives with the old reserves, then set new reserves (same order as UniswapV2Pair).
    function setReserves(uint112 r0, uint112 r1) external {
        uint32 nowTs = uint32(block.timestamp);
        unchecked {
            uint32 elapsed = nowTs - blockTimestampLast;
            if (elapsed > 0 && reserve0 != 0 && reserve1 != 0) {
                price0CumulativeLast += ((uint256(reserve1) << 112) / reserve0) * elapsed;
                price1CumulativeLast += ((uint256(reserve0) << 112) / reserve1) * elapsed;
            }
        }
        reserve0 = r0;
        reserve1 = r1;
        blockTimestampLast = nowTs;
    }
}
