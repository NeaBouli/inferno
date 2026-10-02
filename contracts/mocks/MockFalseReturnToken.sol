// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockFalseReturnToken
/// @notice ERC-20-shaped mock whose transfer returns false instead of reverting (unchecked-return tests).
contract MockFalseReturnToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 1_000_000e9;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }
}
