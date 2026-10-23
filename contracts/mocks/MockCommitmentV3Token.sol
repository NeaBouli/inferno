// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockCommitmentV2Token} from "./MockCommitmentV2Tokens.sol";

/// @notice Test-only accounting reads at the transferFrom interaction boundary.
interface ICommitmentV3EntryState {
    /// @notice Current global claims.
    function totalLocked() external view returns (uint256);
    /// @notice Current wallet claims.
    function lockedBalance(address wallet) external view returns (uint256);
    /// @notice Current wallet active lock count.
    function activeLockCount(address wallet) external view returns (uint256);
    /// @notice Current wallet history length.
    function getTrancheCount(address wallet) external view returns (uint256);
    /// @notice Unpruned gross entry accounting.
    function unprunedEntryAmount() external view returns (uint256);
}

/// @notice Test-only counter and CEI observer, reusing V2's transfer-fault and tax switches.
contract MockCommitmentV3Token is MockCommitmentV2Token {
    /// @notice Successful transferFrom calls; reverted calls roll back this counter too.
    uint256 public transferFromCalls;
    /// @notice Global claims observed before transferFrom delivers any tokens.
    uint256 public observedTotal;
    /// @notice Wallet claims observed before transferFrom delivers any tokens.
    uint256 public observedWallet;
    /// @notice Active locks observed before transferFrom delivers any tokens.
    uint256 public observedActive;
    /// @notice History length observed before transferFrom delivers any tokens.
    uint256 public observedHistory;
    /// @notice Gross entry amount observed before transferFrom delivers any tokens.
    uint256 public observedEntries;
    /// @notice Extra mint during transferFrom to test rejection of excess receipts.
    uint256 public receiptBonus;

    /// @notice Configure an adversarial receipt larger than requested.
    /// @param bonus Extra base units minted during transferFrom; zero disables it.
    function setReceiptBonus(uint256 bonus) external { receiptBonus = bonus; }

    /// @notice Observe all reserved state and count the incoming token interaction.
    /// @param from Original depositor.
    /// @param to Vault under test.
    /// @param amount Aggregate requested amount in base units.
    /// @return success Result from the V2 fault-injection mock.
    function transferFrom(address from, address to, uint256 amount) public override returns (bool success) {
        ICommitmentV3EntryState vault = ICommitmentV3EntryState(to);
        transferFromCalls++;
        observedTotal = vault.totalLocked();
        observedWallet = vault.lockedBalance(from);
        observedActive = vault.activeLockCount(from);
        observedHistory = vault.getTrancheCount(from);
        observedEntries = vault.unprunedEntryAmount();
        success = super.transferFrom(from, to, amount);
        if (receiptBonus != 0) _mint(to, receiptBonus);
    }
}
