// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Simple mock adapter that accepts ETH (simulates a swap)
contract MockAdapter {
    uint256 public lastReceived;

    fallback() external payable {
        lastReceived = msg.value;
    }

    receive() external payable {
        lastReceived = msg.value;
    }
}
