// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Actor {
    /// @notice Approve token spending for a test fixture.
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ILendingVaultActor {
    /// @notice Create a test lending offer.
    function createOffer(uint256 amount) external;
    /// @notice Borrow from a test lending offer.
    function borrow(uint256 offerId, uint256 amount, uint256 durationDays) external payable;
    /// @notice Repay a test loan.
    function repay(uint256 loanId) external;
}

/// @dev Test actor whose receive hook needs more gas than Solidity `transfer` provides.
contract LendingVaultActor {
    uint256 public received;
    bool public rejectETH;

    receive() external payable {
        require(!rejectETH, "ETH rejected");
        received += msg.value;
    }

    /// @notice Configure the test actor to accept or reject ETH settlements.
    function setRejectETH(bool reject_) external {
        rejectETH = reject_;
    }

    /// @notice Approve a token allowance from this test actor.
    function approveToken(address token, address spender, uint256 amount) external {
        require(IERC20Actor(token).approve(spender, amount), "approve failed");
    }

    /// @notice Create a lending offer from this test actor.
    function createOffer(address vault, uint256 amount) external {
        ILendingVaultActor(vault).createOffer(amount);
    }

    /// @notice Borrow through a vault while forwarding this call's ETH.
    function borrow(address vault, uint256 offerId, uint256 amount, uint256 durationDays) external payable {
        ILendingVaultActor(vault).borrow{value: msg.value}(offerId, amount, durationDays);
    }

    /// @notice Repay a vault loan from this test actor.
    function repay(address vault, uint256 loanId) external {
        ILendingVaultActor(vault).repay(loanId);
    }
}
