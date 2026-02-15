// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract InfernoToken is ERC20, ERC20Burnable, Ownable {
    uint256 public senderBurnBps = 200;    // 2.0 %
    uint256 public recipientBurnBps = 50;  // 0.5 %
    uint256 public poolFeeBps = 100;       // 1.0 %

    address public poolFeeReceiver;

    mapping(address => bool) public feeExempt;

    event FeeExemptUpdated(address indexed account, bool exempt);
    event PoolFeeReceiverUpdated(address indexed receiver);
    event FeesUpdated(uint256 senderBurnBps, uint256 recipientBurnBps, uint256 poolFeeBps);

    constructor(address _poolFeeReceiver)
        ERC20("Inferno", "IFR")
        Ownable(msg.sender)
    {
        require(_poolFeeReceiver != address(0), "poolFeeReceiver=0");
        poolFeeReceiver = _poolFeeReceiver;
        _mint(msg.sender, 1_000_000_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 9;
    }

    function setFeeExempt(address account, bool exempt) external onlyOwner {
        feeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    function setPoolFeeReceiver(address receiver) external onlyOwner {
        require(receiver != address(0), "poolFeeReceiver=0");
        poolFeeReceiver = receiver;
        emit PoolFeeReceiverUpdated(receiver);
    }

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
