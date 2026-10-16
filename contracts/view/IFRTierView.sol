// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFRLock} from "../lock/IFRLock.sol";
import {CommitmentVault} from "../vault/CommitmentVault.sol";

/// @title IFRTierView
/// @notice Optional read-only tier calculation for ifr-benefits-verify/1.
/// @dev Uses EITHER semantics when a vault is configured, otherwise IFRLOCK only.
///      This helper does not replace the verifier's identity, block or ownership checks.
contract IFRTierView {
    /// @notice IFRLock source, fixed at construction.
    IFRLock public immutable ifrLock;

    /// @notice Optional CommitmentVault source; address(0) disables it.
    CommitmentVault public immutable commitmentVault;

    /// @notice Bronze threshold in IFR base units (9 decimals).
    uint256 public immutable bronzeThreshold;

    /// @notice Silver threshold in IFR base units (9 decimals).
    uint256 public immutable silverThreshold;

    /// @notice Gold threshold in IFR base units (9 decimals).
    uint256 public immutable goldThreshold;

    /// @notice Platinum threshold in IFR base units (9 decimals).
    uint256 public immutable platinumThreshold;

    /// @dev Version of docs/specs/ifr-benefits-tiers.v1.json, returned by tierOf.
    uint256 private immutable _configVersion;

    /// @notice Fix the source addresses and the published version 1 tier configuration.
    /// @param ifrLock_ Address of the IFRLock contract; must have code.
    /// @param commitmentVault_ Address of the CommitmentVault contract, or zero to disable it.
    constructor(address ifrLock_, address commitmentVault_) {
        require(ifrLock_ != address(0), "lock=0");
        require(ifrLock_.code.length > 0, "lock has no code");
        require(commitmentVault_ == address(0) || commitmentVault_.code.length > 0, "vault has no code");

        ifrLock = IFRLock(ifrLock_);
        commitmentVault = CommitmentVault(commitmentVault_);
        bronzeThreshold = 1_000 * 1e9;
        silverThreshold = 2_500 * 1e9;
        goldThreshold = 5_000 * 1e9;
        platinumThreshold = 10_000 * 1e9;
        _configVersion = 1;
    }

    /// @notice Return the highest tier met by either configured source independently.
    /// @dev Sums only positive, not-unlocked TIME_ONLY tranches within the vault, even if due.
    ///      Never adds vault amounts to IFRLock. Failed source reads revert, even if the other
    ///      source qualifies. All reads execute in the calling block; no result is cached.
    /// @param wallet Wallet whose current locks are evaluated.
    /// @return tier 0 for none, 1 Bronze, 2 Silver, 3 Gold, or 4 Platinum.
    /// @return configVersion Immutable tier configuration version.
    function tierOf(address wallet) external view returns (uint8 tier, uint256 configVersion) {
        tier = _lockTierOf(wallet);
        if (address(commitmentVault) != address(0)) {
            CommitmentVault.Tranche[] memory tranches = commitmentVault.getTranches(wallet);
            uint256 amount;
            for (uint256 i = 0; i < tranches.length; i++) {
                CommitmentVault.Tranche memory tranche = tranches[i];
                if (tranche.cType == CommitmentVault.ConditionType.TIME_ONLY && !tranche.unlocked && tranche.amount > 0) {
                    amount += tranche.amount;
                }
            }
            uint8 vaultTier = _tierForAmount(amount);
            if (vaultTier > tier) tier = vaultTier;
        }
        return (tier, _configVersion);
    }

    function _lockTierOf(address wallet) private view returns (uint8) {
        if (ifrLock.isLocked(wallet, platinumThreshold)) return 4;
        if (ifrLock.isLocked(wallet, goldThreshold)) return 3;
        if (ifrLock.isLocked(wallet, silverThreshold)) return 2;
        if (ifrLock.isLocked(wallet, bronzeThreshold)) return 1;
        return 0;
    }

    function _tierForAmount(uint256 amount) private view returns (uint8) {
        if (amount >= platinumThreshold) return 4;
        if (amount >= goldThreshold) return 3;
        if (amount >= silverThreshold) return 2;
        if (amount >= bronzeThreshold) return 1;
        return 0;
    }
}
