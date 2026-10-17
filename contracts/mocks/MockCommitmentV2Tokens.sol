// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockFeeOnTransferToken} from "./MockFeeOnTransferToken.sol";
import {MockReentrantToken} from "./MockReentrantToken.sol";

/// @notice Test-only fault switches layered over the existing nine-decimal taxed mock.
/// @dev Unrestricted helpers are deliberate test fixtures, never production admin roles.
contract MockCommitmentV2Token is MockFeeOnTransferToken {
    bool private _exempt = true;
    bool private _exemptionReverts;
    uint256 private _transferFault;
    uint256 private _transferFromFault;

    error MockExemptionUnavailable();
    error MockTransferRejected();

    /// @notice Configure reported exemption and whether the getter reverts, independently of tax.
    /// @param exempt Reported exemption.
    /// @param reverts Whether the getter reverts.
    function setExemption(bool exempt, bool reverts) external {
        _exempt = exempt;
        _exemptionReverts = reverts;
    }

    /// @notice Query the simulated IFR exemption; tax is independently controlled to test dishonest metadata.
    /// @param account Ignored test account.
    /// @return exempt Simulated exemption.
    function feeExempt(address account) external view returns (bool exempt) {
        account;
        if (_exemptionReverts) revert MockExemptionUnavailable();
        return _exempt;
    }

    /// @notice Configure false-return (1), revert (2), or normal (0) transfer behavior.
    /// @param outgoing Fault for transfer.
    /// @param incoming Fault for transferFrom.
    function setTransferFaults(uint256 outgoing, uint256 incoming) external {
        _transferFault = outgoing;
        _transferFromFault = incoming;
    }

    /// @notice ERC20 transfer with test-only failure injection.
    /// @param to Recipient.
    /// @param amount Gross base-unit transfer.
    /// @return success Whether transfer succeeded.
    function transfer(address to, uint256 amount) public override returns (bool success) {
        if (_transferFault == 1) return false;
        if (_transferFault == 2) revert MockTransferRejected();
        return super.transfer(to, amount);
    }

    /// @notice ERC20 transferFrom with test-only failure injection.
    /// @param from Sender.
    /// @param to Recipient.
    /// @param amount Gross base-unit transfer.
    /// @return success Whether transfer succeeded.
    function transferFrom(address from, address to, uint256 amount) public override returns (bool success) {
        if (_transferFromFault == 1) return false;
        if (_transferFromFault == 2) revert MockTransferRejected();
        return super.transferFrom(from, to, amount);
    }
}

/// @notice Reuse the existing malicious transfer callback mock with the required IFR metadata.
contract MockCommitmentV2ReentrantToken is MockReentrantToken {
    /// @notice Always report exemption so malicious callbacks reach the vault's asset flows.
    /// @param account Ignored test account.
    /// @return exempt Always true.
    function feeExempt(address account) external pure returns (bool exempt) { account; return true; }
}
