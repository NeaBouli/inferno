// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice IFR's existing public exemption getter; no token administration is exposed.
interface ICommitmentFeeExemption {
    /// @notice Whether an account is exempt from IFR transfer fees.
    /// @param account Account to inspect.
    /// @return exempt Whether the token reports an exemption.
    function feeExempt(address account) external view returns (bool exempt);
}

/// @title CommitmentVaultV2 (release candidate, time-only)
/// @notice New opt-in time custody only; never repairs or accesses V1/deployed V2 custody.
/// @dev Release candidate, ratified 2026-10-18; not deployed; not externally audited;
///      activation only via Governance + Treasury Safe. Entry bounds and receipt policy are ratified.
///      The specification reserves prices for a separate PriceLockVault.
///      Governance must own this contract through its own public timelock. No proxy,
///      oracle, guardian, rescue, sweep, fee, or arbitrary-call authority exists.
contract CommitmentVaultV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Source generation emitted with every lock/release; not a deployed address identity.
    uint256 public constant VERSION = 2;
    /// @notice IFR base units per full token; all accounting is integer-only.
    uint256 public constant IFR_UNIT = 1e9;
    /// @notice Ratified minimum time commitment, in seconds (PL-C05).
    uint256 public constant MIN_LOCK_DURATION = 1 days;
    /// @notice Maximum time commitment, in seconds; no administrator can extend it.
    uint256 public constant MAX_LOCK_DURATION = 1461 days;
    /// @notice Ratified concurrent wallet limit; terminal release frees capacity.
    uint256 public constant MAX_ACTIVE_LOCKS = 50;
    /// @notice Maximum page/maintenance work per call, bounding loops independently of history.
    uint256 public constant MAX_BATCH = 50;
    /// @notice Minimum public delay on every entry configuration/resumption, in seconds.
    uint256 public constant CONFIGURATION_DELAY = 48 hours;
    /// @notice Exact rolling gross-entry interval, in seconds; releases never refund it.
    uint256 public constant ENTRY_WINDOW = 24 hours;
    /// @notice Ratified maximum credited/requested IFR per lock, in base units (PL-C05).
    uint256 public constant MAX_PER_LOCK = 100_000 * IFR_UNIT;
    /// @notice Ratified maximum outstanding IFR per wallet, in base units (PL-C05).
    uint256 public constant MAX_PER_WALLET = 250_000 * IFR_UNIT;
    /// @notice Ratified maximum outstanding IFR globally, in base units (PL-C05).
    uint256 public constant MAX_TOTAL = 1_000_000 * IFR_UNIT;
    /// @notice Ratified maximum gross entries in any rolling day, in base units (PL-C05).
    uint256 public constant MAX_DAILY = 100_000 * IFR_UNIT;

    /// @notice Legacy numeric condition identifiers are accepted only to reject price requests explicitly.
    enum ConditionType { TIME_ONLY, PRICE_ONLY, TIME_OR_PRICE, TIME_AND_PRICE }

    /// @notice Immutable time terms with a consumable remaining claim, denominated in IFR base units.
    struct Tranche {
        address depositor;
        uint256 amount;
        uint256 lockedAt;
        uint256 unlockTime;
        bool unlocked;
    }

    /// @notice Prospective entry ceilings, all in IFR base units; they never change existing claims.
    struct EntryLimits {
        uint256 perLock;
        uint256 perWallet;
        uint256 total;
        uint256 daily;
    }

    struct Entry { uint256 timestamp; uint256 amount; }

    /// @notice Immutable nine-decimal token. Its transfer/exemption implementation is trusted.
    IERC20 public immutable ifrToken;
    /// @notice False initially and after an immediate owner pause; never gates an exit.
    bool public depositsEnabled;
    /// @notice Sum of all unreleased credited claims, excluding donations, in IFR base units.
    uint256 public totalLocked;
    /// @notice Current entry ceilings; all start at zero.
    EntryLimits public entryLimits;
    /// @notice Exact prospective ceilings in the queued configuration.
    EntryLimits public pendingEntryLimits;
    /// @notice Earliest execution timestamp; zero means no queued entry configuration.
    uint256 public configurationEta;
    /// @notice Monotonic queue identifier; replaced/cancelled queues cannot be replayed.
    uint256 public configurationNonce;
    /// @notice Outstanding credited IFR per wallet; O(1), independent of lifetime lock count.
    mapping(address => uint256) public lockedBalance;
    /// @notice Unreleased locks per wallet; O(1), independent of lifetime lock count.
    mapping(address => uint256) public activeLockCount;
    /// @notice Unpruned gross entries, in IFR base units; may include expired entries until pruning.
    uint256 public unprunedEntryAmount;
    /// @notice First unpruned historical entry index; entries expire at timestamp + ENTRY_WINDOW.
    uint256 public entryHead;

    mapping(address => Tranche[]) private _tranches;
    Entry[] private _entries;

    error InvalidToken();
    error UnsupportedDecimals(uint8 actual);
    error PriceConditionsDisabled();
    error UnexpectedPriceParameter();
    error DepositsDisabled();
    error FeeExemptionRequired();
    error InvalidAmount();
    error InvalidUnlockTime();
    error TooManyActiveLocks();
    error InvalidEntryLimits();
    error EntryLimitExceeded();
    error EntryHistoryNeedsPruning();
    error InvalidBatchSize();
    error NoPendingConfiguration();
    error ConfigurationNotReady(uint256 eta);
    error InvalidConfigurationNonce();
    error InvalidTranche();
    error AlreadyUnlocked();
    error ConditionNotMet();
    error ReceiptMismatch(uint256 requested, uint256 received);
    error InvalidOwnerNominee();
    error NoPendingOwnershipTransfer();
    error OwnershipRenunciationDisabled();

    /// @notice Exact entry terms and public execution timestamp for a new queue.
    event EntryConfigurationQueued(uint256 indexed nonce, uint256 perLock, uint256 perWallet, uint256 total, uint256 daily, uint256 eta);
    /// @notice A queued configuration was explicitly cancelled, replaced, paused, or invalidated on handover.
    event EntryConfigurationCancelled(uint256 indexed nonce);
    /// @notice Prospective entry limits changed after the delay; nonce links all old/new values to queue history.
    event EntryConfigurationExecuted(uint256 indexed nonce, uint256 perLock, uint256 perWallet, uint256 total, uint256 daily);
    /// @notice Entry status changed; exits are always independent of this flag.
    event DepositsEnabledChanged(bool previous, bool current);
    /// @notice Expired gross entry accounting was pruned; no claim or outstanding cap changes.
    event EntryHistoryPruned(uint256 previousHead, uint256 currentHead, uint256 expiredAmount);
    /// @notice A new versioned claim was credited by measured receipt, with immutable time terms.
    event Locked(address indexed wallet, uint256 indexed trancheId, uint256 version, uint256 requested, uint256 credited, uint256 lockedAt, uint256 unlockTime);
    /// @notice Deadline release: amount is the retired gross claim, recipientReceived is measured net wallet credit.
    event Unlocked(address indexed wallet, uint256 indexed trancheId, address indexed caller, uint256 version, uint256 amount, uint256 recipientReceived);
    /// @notice Explicit nomination cancellation; inherited events record nominations and accepted ownership.
    event OwnershipTransferCancelled(address indexed owner, address indexed previousNominee);

    /// @notice Construct a disabled, zero-cap draft; no deployment operator privileges are retained.
    /// @param token Nine-decimal IFR contract, including its feeExempt getter.
    /// @param governance Initial nonzero owner; intended to be the approved governance timelock.
    constructor(address token, address governance) Ownable(governance) {
        if (token.code.length == 0) revert InvalidToken();
        uint8 decimals;
        try IERC20Metadata(token).decimals() returns (uint8 value) { decimals = value; }
        catch { revert InvalidToken(); }
        if (decimals != 9) revert UnsupportedDecimals(decimals);
        ifrToken = IERC20(token);
    }

    /// @notice Owner queues exact prospective entry ceilings and resumption; replacing a queue restarts 48 hours.
    /// @param limits Nonzero IFR-base-unit ceilings, at most the draft hard maxima.
    function queueEntryConfiguration(EntryLimits calldata limits) external onlyOwner {
        if (limits.perLock == 0 || limits.perLock > MAX_PER_LOCK ||
            limits.perWallet == 0 || limits.perWallet > MAX_PER_WALLET ||
            limits.total == 0 || limits.total > MAX_TOTAL ||
            limits.daily == 0 || limits.daily > MAX_DAILY) revert InvalidEntryLimits();
        _cancelConfiguration();
        pendingEntryLimits = limits;
        configurationEta = block.timestamp + CONFIGURATION_DELAY;
        configurationNonce++;
        emit EntryConfigurationQueued(configurationNonce, limits.perLock, limits.perWallet, limits.total, limits.daily, configurationEta);
    }

    /// @notice Owner executes only the current queue after 48 hours, rechecking IFR exemption; enables deposits.
    /// @param nonce Current queue identifier, protecting against replacement/replay.
    function executeEntryConfiguration(uint256 nonce) external onlyOwner {
        if (configurationEta == 0) revert NoPendingConfiguration();
        if (nonce != configurationNonce) revert InvalidConfigurationNonce();
        if (block.timestamp < configurationEta) revert ConfigurationNotReady(configurationEta);
        _requireFeeExemption();
        EntryLimits memory limits = pendingEntryLimits;
        entryLimits = limits;
        delete pendingEntryLimits;
        configurationEta = 0;
        emit EntryConfigurationExecuted(nonce, limits.perLock, limits.perWallet, limits.total, limits.daily);
        bool previous = depositsEnabled;
        depositsEnabled = true;
        emit DepositsEnabledChanged(previous, true);
    }

    /// @notice Owner cancels a pending entry configuration without changing claims or active limits.
    function cancelEntryConfiguration() external onlyOwner {
        if (configurationEta == 0) revert NoPendingConfiguration();
        _cancelConfiguration();
    }

    /// @notice Owner immediately stops entry and cancels pending resumption; cannot stop deadline exits.
    function pauseDeposits() external onlyOwner {
        _cancelConfiguration();
        bool previous = depositsEnabled;
        depositsEnabled = false;
        emit DepositsEnabledChanged(previous, false);
    }

    /// @notice Create a time-only claim; receipt must equal the requested amount or the entire transaction reverts.
    /// @dev Reserves claim/cap state before transfer. Reentrancy is blocked; measured receipt verifies that reservation.
    ///      After more than MAX_BATCH expired entries, call pruneEntryHistory before retrying.
    /// @param amount Requested and required credited IFR in nine-decimal base units.
    /// @param cType Only TIME_ONLY (0); every price enum is rejected before custody.
    /// @param unlockTime Immutable Unix deadline, from one day to 1461 days after this deposit.
    /// @param p0Multiplier Must be zero; no P0, multiplier arithmetic or oracle path exists.
    /// @return trancheId Stable append-only identifier; released slots free active count, never reuse identifiers.
    function lock(uint256 amount, ConditionType cType, uint256 unlockTime, uint256 p0Multiplier)
        external nonReentrant returns (uint256 trancheId)
    {
        if (cType != ConditionType.TIME_ONLY) revert PriceConditionsDisabled();
        if (p0Multiplier != 0) revert UnexpectedPriceParameter();
        if (!depositsEnabled) revert DepositsDisabled();
        if (amount == 0) revert InvalidAmount();
        if (unlockTime < block.timestamp + MIN_LOCK_DURATION ||
            unlockTime > block.timestamp + MAX_LOCK_DURATION) revert InvalidUnlockTime();
        if (activeLockCount[msg.sender] >= MAX_ACTIVE_LOCKS) revert TooManyActiveLocks();
        _requireFeeExemption();
        _pruneEntryHistory(MAX_BATCH);
        if (entryHead < _entries.length && _entries[entryHead].timestamp + ENTRY_WINDOW <= block.timestamp)
            revert EntryHistoryNeedsPruning();
        EntryLimits memory limits = entryLimits;
        if (amount > limits.perLock || lockedBalance[msg.sender] + amount > limits.perWallet ||
            totalLocked + amount > limits.total || unprunedEntryAmount + amount > limits.daily)
            revert EntryLimitExceeded();

        uint256 beforeBalance = ifrToken.balanceOf(address(this));
        trancheId = _tranches[msg.sender].length;
        _tranches[msg.sender].push(Tranche(msg.sender, amount, block.timestamp, unlockTime, false));
        activeLockCount[msg.sender]++;
        lockedBalance[msg.sender] += amount;
        totalLocked += amount;
        _entries.push(Entry(block.timestamp, amount));
        unprunedEntryAmount += amount;

        ifrToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBalance = ifrToken.balanceOf(address(this));
        uint256 received = afterBalance >= beforeBalance ? afterBalance - beforeBalance : 0;
        if (received != amount) revert ReceiptMismatch(amount, received);
        emit Locked(msg.sender, trancheId, VERSION, amount, received, block.timestamp, unlockTime);
    }

    /// @notice Anyone may return a mature claim, once, exclusively to its original depositor.
    /// @dev No oracle, exemption, governance, entry flag or budget is consulted. Transfer failure restores the claim.
    ///      Revoked fee exemption can reduce the depositor's measured receipt; there is no gross-up.
    /// @param wallet Original depositor, never an executor-chosen alternative recipient.
    /// @param trancheId Stable identifier within that wallet's history.
    function unlock(address wallet, uint256 trancheId) external nonReentrant {
        Tranche storage tranche = _getTranche(wallet, trancheId);
        if (tranche.unlocked) revert AlreadyUnlocked();
        if (block.timestamp < tranche.unlockTime) revert ConditionNotMet();
        uint256 amount = tranche.amount;
        tranche.unlocked = true;
        tranche.amount = 0;
        totalLocked -= amount;
        lockedBalance[wallet] -= amount;
        activeLockCount[wallet]--;
        uint256 recipientBefore = ifrToken.balanceOf(wallet);
        ifrToken.safeTransfer(wallet, amount);
        uint256 recipientReceived = ifrToken.balanceOf(wallet) - recipientBefore;
        emit Unlocked(wallet, trancheId, msg.sender, VERSION, amount, recipientReceived);
    }

    /// @notice Permissionless bounded maintenance for exact rolling accounting; never changes custody.
    /// @param maxEntries Work bound from 1 through MAX_BATCH; repeat if more expired history remains.
    function pruneEntryHistory(uint256 maxEntries) external nonReentrant {
        if (maxEntries == 0 || maxEntries > MAX_BATCH) revert InvalidBatchSize();
        _pruneEntryHistory(maxEntries);
    }

    /// @notice Whether the immutable time has arrived, including already consumed claims; no external calls.
    /// @param wallet Original depositor.
    /// @param trancheId Stable historical identifier.
    /// @return met Whether the tranche's deadline has arrived.
    function isConditionMet(address wallet, uint256 trancheId) external view returns (bool met) {
        return block.timestamp >= _getTranche(wallet, trancheId).unlockTime;
    }

    /// @notice Return a single current/historical claim, without unbounded iteration.
    /// @param wallet Original depositor.
    /// @param trancheId Stable historical identifier.
    /// @return tranche Immutable terms and remaining claim/state.
    function getTranche(address wallet, uint256 trancheId) external view returns (Tranche memory tranche) {
        return _getTranche(wallet, trancheId);
    }

    /// @notice Return lifetime count, including released claims; this is not the active-count cap.
    /// @param wallet Depositor to inspect.
    /// @return count Number of stable tranche identifiers.
    function getTrancheCount(address wallet) external view returns (uint256 count) { return _tranches[wallet].length; }

    /// @notice Return a bounded history page; offsets at/beyond the end yield an empty page.
    /// @param wallet Depositor to inspect.
    /// @param offset First historical identifier.
    /// @param limit Requested page size from 1 through MAX_BATCH.
    /// @return page At most limit tranches, including consumed claims.
    function getTranches(address wallet, uint256 offset, uint256 limit) external view returns (Tranche[] memory page) {
        if (limit == 0 || limit > MAX_BATCH) revert InvalidBatchSize();
        uint256 length = _tranches[wallet].length;
        uint256 count = offset < length ? length - offset : 0;
        if (count > limit) count = limit;
        page = new Tranche[](count);
        for (uint256 i; i < count; i++) page[i] = _tranches[wallet][offset + i];
    }

    /// @notice Constant-work outstanding custody lookup.
    /// @param wallet Depositor to inspect.
    /// @return active Whether the wallet has an unreleased claim.
    function hasActiveLock(address wallet) external view returns (bool active) { return activeLockCount[wallet] != 0; }

    /// @notice Owner nominates/replaces a nonzero pending owner; nomination grants no powers.
    /// @param newOwner Candidate that must accept itself, possibly through its own governance execution.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert InvalidOwnerNominee();
        super.transferOwnership(newOwner);
    }

    /// @notice Owner explicitly cancels its current nomination; the stale nominee cannot accept.
    function cancelOwnershipTransfer() external onlyOwner {
        address nominee = pendingOwner();
        if (nominee == address(0)) revert NoPendingOwnershipTransfer();
        super.transferOwnership(address(0));
        emit OwnershipTransferCancelled(owner(), nominee);
    }

    /// @notice Only the pending owner accepts; handover also invalidates the previous owner's queued entry configuration.
    function acceptOwnership() public override {
        super.acceptOwnership();
        _cancelConfiguration();
    }

    /// @notice Renunciation is permanently disabled, including with zero custody, because entry responsibilities continue.
    function renounceOwnership() public view override onlyOwner { revert OwnershipRenunciationDisabled(); }

    function _requireFeeExemption() private view {
        try ICommitmentFeeExemption(address(ifrToken)).feeExempt(address(this)) returns (bool exempt) {
            if (!exempt) revert FeeExemptionRequired();
        } catch { revert FeeExemptionRequired(); }
    }

    function _cancelConfiguration() private {
        if (configurationEta != 0) {
            configurationEta = 0;
            delete pendingEntryLimits;
            emit EntryConfigurationCancelled(configurationNonce);
        }
    }

    function _getTranche(address wallet, uint256 trancheId) private view returns (Tranche storage tranche) {
        if (trancheId >= _tranches[wallet].length) revert InvalidTranche();
        return _tranches[wallet][trancheId];
    }

    function _pruneEntryHistory(uint256 maxEntries) private {
        uint256 previous = entryHead;
        uint256 head = previous;
        uint256 expired;
        for (uint256 i; i < maxEntries && head < _entries.length; i++) {
            Entry storage entry = _entries[head];
            if (entry.timestamp + ENTRY_WINDOW > block.timestamp) break;
            expired += entry.amount;
            head++;
        }
        if (head != previous) {
            entryHead = head;
            unprunedEntryAmount -= expired;
            emit EntryHistoryPruned(previous, head, expired);
        }
    }
}
