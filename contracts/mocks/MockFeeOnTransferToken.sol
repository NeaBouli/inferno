// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFeeOnTransferToken
/// @notice Test-only 9-decimal ERC20 that burns `feeBps` of every transfer, mirroring
///         IFR's fee-on-transfer behaviour for non-exempt senders and recipients.
/// @dev State lives only in storage set after deployment, so the runtime code can also be
///      placed at a fixed address with hardhat_setCode (constructor state is not needed).
contract MockFeeOnTransferToken is ERC20 {
    /// @notice Fee in basis points burned from every transfer (10000 = 100 %)
    uint256 public feeBps;

    constructor() ERC20("Mock Fee Token", "MFEE") {}

    /// @notice IFR uses 9 decimals
    function decimals() public pure override returns (uint8) {
        return 9;
    }

    /// @notice Test helper: mint tokens to `to`
    /// @param to Recipient
    /// @param amount Amount in base units
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Test helper: set the transfer fee
    /// @param bps Fee in basis points (max 10000)
    function setFeeBps(uint256 bps) external {
        require(bps <= 10_000, "fee>100%");
        feeBps = bps;
    }

    /// @dev Burns the fee from every non-mint, non-burn transfer.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps > 0) {
            uint256 fee = (value * feeBps) / 10_000;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
