// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockToken
/// @notice Ein einfacher ERC20-Token nur für Tests
contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 1_000_000 ether); // 1 Mio. Token für den Deploy-Account
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
