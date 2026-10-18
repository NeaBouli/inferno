// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GovernanceV2 (release candidate)
/// @notice Replacement zero-value timelock with permissionless execution and an independent cancel guardian.
/// @dev Release candidate, ratified 2026-10-18; not deployed; not externally audited;
///      activation only via Governance + Treasury Safe. See GOVERNANCE_V2_SPEC.md.
///      Targets are trusted only for the exact queued CALL; there is no delegatecall, ETH funding API,
///      token accounting, upgrade mechanism or emergency bypass. Safe identity must be verified off-chain.
contract GovernanceV2 is Ownable2Step, ReentrancyGuard {
    /// @notice Immutable minimum delay in seconds; no role can reduce this floor.
    uint256 public constant MIN_DELAY = 48 hours;
    /// @notice Immutable maximum delay in seconds.
    uint256 public constant MAX_DELAY = 30 days;
    /// @notice Immutable execution window in seconds after a proposal's ETA (exclusive expiry).
    uint256 public constant GRACE_PERIOD = 7 days;

    /// @notice Independent cancellation authority; has no privileged execution or asset authority.
    address public guardian;
    /// @notice Delay in seconds snapshotted by new proposals only.
    uint256 public delay;
    /// @notice Number of proposals ever created; IDs start at zero within this chain/contract domain.
    uint256 public proposalCount;

    /// @notice Terminal flags take precedence over the derived Pending/Ready/Expired time states.
    enum ProposalState { Unset, Pending, Ready, Executed, Cancelled, Expired }

    /// @dev Exact authorization and immutable timing evidence, retained even after terminal transitions.
    struct Proposal {
        address target;
        bytes data;
        uint256 eta;
        uint256 expiresAt;
        bytes32 operationHash;
        bool executed;
        bool cancelled;
    }

    mapping(uint256 => Proposal) private _proposals;

    // OZ Ownable2Step exposes no internal nomination hook. Override its virtual pendingOwner()
    // and nomination entry point rather than broadening _checkOwner() to allow self as proposer.
    // Inherited acceptance still enforces the virtual pendingOwner(); _transferOwnership clears it.
    address private _timelockedPendingOwner;

    /// @notice Caller attempted a configuration change outside a queued self-call.
    error OnlySelf(address caller);
    /// @notice Caller is neither the active owner nor the cancellation guardian.
    error UnauthorizedCancellation(address caller);
    /// @notice Guardian is zero, this controller, or overlaps the active/pending owner.
    error InvalidGuardian(address candidate);
    /// @notice Delay is outside the immutable floor/ceiling, in seconds.
    error DelayOutOfBounds(uint256 candidate);
    /// @notice Target is zero or currently has no deployed code.
    error InvalidTarget(address target);
    /// @notice Queued calldata does not contain a complete four-byte selector.
    error InvalidCalldata(uint256 length);
    /// @notice ID has never been assigned by this controller.
    error ProposalNotFound(uint256 id);
    /// @notice Proposal is not in the required lifecycle state.
    error InvalidProposalState(uint256 id, ProposalState actual);
    /// @notice No nomination exists to cancel.
    error NoPendingOwnershipTransfer();
    /// @notice Ownership renunciation is disabled for all callers, including queued self-calls.
    error RenunciationDisabled();

    /// @notice Complete immutable authorization evidence for a newly queued operation.
    event ProposalCreated(
        uint256 indexed id, address indexed proposer, address indexed target,
        bytes data, uint256 eta, uint256 expiresAt, bytes32 operationHash
    );
    /// @notice Successful exact CALL, identifying its executor and raw return-data hash.
    event ProposalExecuted(uint256 indexed id, address indexed executor, bytes32 operationHash, bytes32 resultHash);
    /// @notice Irreversible cancellation by the active owner or guardian.
    event ProposalCancelled(uint256 indexed id, address indexed cancelledBy, bytes32 operationHash);
    /// @notice Old/new delay in seconds; existing proposal timestamps are unchanged.
    event DelayUpdated(uint256 oldDelay, uint256 newDelay);
    /// @notice Old/new cancellation authority after a timelocked rotation.
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    /// @notice Pending nomination cleared or replaced; cannot undo an accepted transfer.
    event OwnershipTransferCancelled(address indexed currentOwner, address indexed cancelledPendingOwner);

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf(msg.sender);
        _;
    }

    /// @notice Initialize explicit, separate owner/guardian roles and a bounded delay.
    /// @param initialOwner Approved proposer (Safe identity and signer quorum require external verification).
    /// @param initialGuardian Approved independent cancel Safe; never zero, self or owner.
    /// @param initialDelay Initial delay in seconds, inclusive range [48 hours, 30 days].
    constructor(address initialOwner, address initialGuardian, uint256 initialDelay) Ownable(initialOwner) {
        if (initialOwner == address(this)) revert OwnableInvalidOwner(initialOwner);
        _validateGuardian(initialGuardian);
        _validateDelay(initialDelay);
        guardian = initialGuardian;
        delay = initialDelay;
        emit GuardianUpdated(address(0), initialGuardian);
        emit DelayUpdated(0, initialDelay);
    }

    /// @notice Queue one exact zero-value contract call; only the active owner can propose.
    /// @param target Nonzero address with deployed code (rechecked on execution).
    /// @param data Complete calldata including at least a four-byte selector.
    /// @return id Monotonically assigned ID; combine with chain ID and this controller's address.
    function propose(address target, bytes calldata data) external onlyOwner returns (uint256 id) {
        _validateTarget(target);
        if (data.length < 4) revert InvalidCalldata(data.length);
        id = proposalCount++;
        uint256 eta = block.timestamp + delay;
        uint256 expiresAt = eta + GRACE_PERIOD;
        bytes32 operationHash = keccak256(abi.encode(
            block.chainid, address(this), id, target, keccak256(data), eta, expiresAt
        ));
        _proposals[id] = Proposal(target, data, eta, expiresAt, operationHash, false, false);
        emit ProposalCreated(id, msg.sender, target, data, eta, expiresAt, operationHash);
    }

    /// @notice Anyone may execute a Ready proposal once, with no value or executor reward.
    /// @dev CEI plus a global execution guard blocks both same-ID and cross-ID nested execution.
    ///      Target failures bubble byte-for-byte and roll back the executed marker and all target effects.
    ///      A successful CALL returning false is still a successful CALL; target semantics require review.
    /// @param id Existing proposal ID in this controller's domain.
    /// @return result Raw target return bytes (not evidence of token receipts).
    function execute(uint256 id) external nonReentrant returns (bytes memory result) {
        ProposalState current = _existingState(id);
        if (current != ProposalState.Ready) revert InvalidProposalState(id, current);
        Proposal storage p = _proposals[id];
        _validateTarget(p.target);
        p.executed = true;
        bool success;
        (success, result) = p.target.call(p.data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
        emit ProposalExecuted(id, msg.sender, p.operationHash, keccak256(result));
    }

    /// @notice Owner or guardian may immediately and permanently cancel a Pending/Ready proposal.
    /// @param id Existing unexecuted, uncancelled and unexpired proposal ID.
    function cancel(uint256 id) external {
        if (msg.sender != owner() && msg.sender != guardian) revert UnauthorizedCancellation(msg.sender);
        ProposalState current = _existingState(id);
        if (current != ProposalState.Pending && current != ProposalState.Ready) {
            revert InvalidProposalState(id, current);
        }
        Proposal storage p = _proposals[id];
        p.cancelled = true;
        emit ProposalCancelled(id, msg.sender, p.operationHash);
    }

    /// @notice Derive lifecycle state from immutable timestamps and terminal flags; unknown IDs are Unset.
    /// @param id Proposal ID to inspect.
    /// @return Current state, with Ready defined as eta <= timestamp < expiresAt.
    function state(uint256 id) public view returns (ProposalState) {
        if (id >= proposalCount) return ProposalState.Unset;
        Proposal storage p = _proposals[id];
        if (p.executed) return ProposalState.Executed;
        if (p.cancelled) return ProposalState.Cancelled;
        if (block.timestamp >= p.expiresAt) return ProposalState.Expired;
        if (block.timestamp >= p.eta) return ProposalState.Ready;
        return ProposalState.Pending;
    }

    /// @notice Read the permanent exact proposal record; unknown IDs revert.
    /// @param id Existing proposal ID.
    /// @return target Queued target.
    /// @return data Exact queued calldata.
    /// @return eta Earliest execution timestamp in seconds.
    /// @return expiresAt Exclusive execution deadline in seconds.
    /// @return operationHash Hash of abi.encode(chainId, controller, id, target, keccak256(data), eta, expiresAt).
    /// @return executed Whether execution succeeded.
    /// @return cancelled Whether cancellation succeeded.
    function getProposal(uint256 id) external view returns (
        address target, bytes memory data, uint256 eta, uint256 expiresAt,
        bytes32 operationHash, bool executed, bool cancelled
    ) {
        _existingState(id);
        Proposal storage p = _proposals[id];
        return (p.target, p.data, p.eta, p.expiresAt, p.operationHash, p.executed, p.cancelled);
    }

    /// @notice Change the delay for future proposals only, through a queued self-call.
    /// @param newDelay New delay in seconds within the immutable inclusive bounds.
    function setDelay(uint256 newDelay) external onlySelf {
        _validateDelay(newDelay);
        uint256 oldDelay = delay;
        delay = newDelay;
        emit DelayUpdated(oldDelay, newDelay);
    }

    /// @notice Rotate the cancel authority through a queued self-call; no immediate owner bypass.
    /// @param newGuardian Nonzero, non-self address distinct from the active and pending owner.
    function setGuardian(address newGuardian) external onlySelf {
        _validateGuardian(newGuardian);
        address oldGuardian = guardian;
        guardian = newGuardian;
        emit GuardianUpdated(oldGuardian, newGuardian);
    }

    /// @notice Read the pending owner nominated through this controller's timelock.
    /// @return Candidate who alone may accept; zero if no transfer is pending.
    function pendingOwner() public view override returns (address) {
        return _timelockedPendingOwner;
    }

    /// @notice Nominate/replace a pending owner only through a queued self-call; active owner stays unchanged.
    /// @param newOwner Nonzero, non-self candidate distinct from the current guardian.
    function transferOwnership(address newOwner) public override onlySelf {
        _validateOwner(newOwner);
        _cancelPendingOwnership();
        _timelockedPendingOwner = newOwner;
        emit OwnershipTransferStarted(owner(), newOwner);
    }

    /// @notice Only the current pending owner may accept; clears the nomination and changes active authority.
    function acceptOwnership() public override {
        super.acceptOwnership();
    }

    /// @notice Cancel a pending ownership nomination through a queued self-call; cannot undo acceptance.
    function cancelOwnershipTransfer() external onlySelf {
        if (pendingOwner() == address(0)) revert NoPendingOwnershipTransfer();
        _cancelPendingOwnership();
    }

    /// @notice Always revert: governance must retain an accountable proposer and cannot renounce ownership.
    function renounceOwnership() public pure override {
        revert RenunciationDisabled();
    }

    function _transferOwnership(address newOwner) internal override {
        delete _timelockedPendingOwner;
        super._transferOwnership(newOwner);
    }

    function _cancelPendingOwnership() private {
        address candidate = pendingOwner();
        if (candidate != address(0)) {
            delete _timelockedPendingOwner;
            emit OwnershipTransferCancelled(owner(), candidate);
        }
    }

    function _validateOwner(address candidate) private view {
        if (candidate == address(0) || candidate == address(this) || candidate == guardian) {
            revert OwnableInvalidOwner(candidate);
        }
    }

    function _validateGuardian(address candidate) private view {
        if (candidate == address(0) || candidate == address(this) || candidate == owner() || candidate == pendingOwner()) {
            revert InvalidGuardian(candidate);
        }
    }

    function _validateDelay(uint256 candidate) private pure {
        if (candidate < MIN_DELAY || candidate > MAX_DELAY) revert DelayOutOfBounds(candidate);
    }

    function _validateTarget(address target) private view {
        if (target == address(0) || target.code.length == 0) revert InvalidTarget(target);
    }

    function _existingState(uint256 id) private view returns (ProposalState current) {
        current = state(id);
        if (current == ProposalState.Unset) revert ProposalNotFound(id);
    }
}
