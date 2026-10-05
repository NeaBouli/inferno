// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockPairFactory
/// @notice Test-only Uniswap V2 factory surface: getPair for registered token pairs (both orders).
contract MockPairFactory {
    mapping(address => mapping(address => address)) public getPair;

    function setPair(address tokenA, address tokenB, address pair) external {
        getPair[tokenA][tokenB] = pair;
        getPair[tokenB][tokenA] = pair;
    }
}
