// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title InfernoToken
/// @notice Deflationary ERC-20 with fee-on-transfer. Every transfer burns 2.5% and routes 1% to
///         the pool fee receiver. 9 decimals. No mint function — supply only decreases.
contract InfernoToken is ERC20, ERC20Burnable, Ownable {
    uint256 public senderBurnBps = 200;    // 2.0 %
    uint256 public recipientBurnBps = 50;  // 0.5 %
    uint256 public poolFeeBps = 100;       // 1.0 %

    address public poolFeeReceiver;

    mapping(address => bool) public feeExempt;

    event FeeExemptUpdated(address indexed account, bool exempt);
    event PoolFeeReceiverUpdated(address indexed receiver);
    event FeesUpdated(uint256 senderBurnBps, uint256 recipientBurnBps, uint256 poolFeeBps);

    /// @notice Deploy InfernoToken with 1B initial supply (9 decimals)
    /// @param _poolFeeReceiver Address that receives the 1% pool fee on each transfer
    constructor(address _poolFeeReceiver)
        ERC20("Inferno", "IFR")
        Ownable(msg.sender)
    {
        require(_poolFeeReceiver != address(0), "poolFeeReceiver=0");
        poolFeeReceiver = _poolFeeReceiver;
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals());
    }

    /// @notice Returns 9 (IFR uses 9 decimals, not the ERC-20 default of 18)
    function decimals() public pure override returns (uint8) {
        return 9;
    }

    /// @notice Exempt or un-exempt an address from transfer fees
    /// @param account Address to update
    /// @param exempt True to exempt, false to remove exemption
    function setFeeExempt(address account, bool exempt) external onlyOwner {
        feeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    /// @notice Update the address that receives the 1% pool fee
    /// @param receiver New pool fee receiver address
    function setPoolFeeReceiver(address receiver) external onlyOwner {
        require(receiver != address(0), "poolFeeReceiver=0");
        poolFeeReceiver = receiver;
        emit PoolFeeReceiverUpdated(receiver);
    }

    /// @notice Update fee rates (sender burn, recipient burn, pool fee). Hard cap: 5% total.
    /// @param _senderBurnBps Sender burn in basis points (default 200 = 2%)
    /// @param _recipientBurnBps Recipient burn in basis points (default 50 = 0.5%)
    /// @param _poolFeeBps Pool fee in basis points (default 100 = 1%)
    function setFeeRates(
        uint256 _senderBurnBps,
        uint256 _recipientBurnBps,
        uint256 _poolFeeBps
    ) external onlyOwner {
        require(_senderBurnBps + _recipientBurnBps + _poolFeeBps <= 500, "fees>5%");
        senderBurnBps = _senderBurnBps;
        recipientBurnBps = _recipientBurnBps;
        poolFeeBps = _poolFeeBps;
        emit FeesUpdated(_senderBurnBps, _recipientBurnBps, _poolFeeBps);
    }

    /// @dev Internal transfer hook. Applies fee-on-transfer for non-exempt, non-mint/burn transfers.
    ///      Burns senderBurnBps + recipientBurnBps, routes poolFeeBps to poolFeeReceiver.
    function _update(address from, address to, uint256 value) internal override {
        // Only apply fees on normal transfers (not mint/burn) and when neither party is exempt
        if (from != address(0) && to != address(0) && !feeExempt[from] && !feeExempt[to]) {
            uint256 burnSender = (value * senderBurnBps) / 10_000;
            uint256 burnRecipient = (value * recipientBurnBps) / 10_000;
            uint256 poolFee = (value * poolFeeBps) / 10_000;
            uint256 totalBurn = burnSender + burnRecipient;
            uint256 netAmount = value - totalBurn - poolFee;

            // Net amount to recipient
            super._update(from, to, netAmount);
            // Pool fee to receiver
            super._update(from, poolFeeReceiver, poolFee);
            // Burn (sender pays, tokens go to address(0) → totalSupply decreases)
            super._update(from, address(0), totalBurn);
        } else {
            super._update(from, to, value);
        }
    }
}
