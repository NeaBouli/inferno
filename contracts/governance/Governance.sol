// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Governance
/// @notice Timelock-based governor for Inferno protocol.
///         Owner proposes parameter changes with a mandatory delay.
///         Guardian can cancel proposals and is intended for emergency response.
///
///         Designed to become the owner of all protocol contracts so that
///         parameter changes (fee rates, treasury, etc.) go through the timelock.
contract Governance {
    address public owner;
    address public guardian;

    uint256 public delay;
    uint256 public constant MIN_DELAY = 1 hours;
    uint256 public constant MAX_DELAY = 30 days;

    uint256 public proposalCount;

    struct Proposal {
        address target;
        bytes data;
        uint256 eta;       // earliest execution time
        bool executed;
        bool cancelled;
    }

    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(uint256 indexed id, address target, bytes data, uint256 eta);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);
    event DelayUpdated(uint256 oldDelay, uint256 newDelay);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyOwnerOrGuardian() {
        require(msg.sender == owner || msg.sender == guardian, "not authorized");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "not self");
        _;
    }

    constructor(uint256 _delay, address _guardian) {
        require(_delay >= MIN_DELAY && _delay <= MAX_DELAY, "delay out of range");
        require(_guardian != address(0), "guardian=0");

        owner = msg.sender;
        guardian = _guardian;
        delay = _delay;
    }

    /// @notice Create a new proposal (queued for execution after delay)
    /// @param target Contract to call
    /// @param data Encoded function call (e.g. abi.encodeWithSignature("setFeeRates(uint256,uint256,uint256)", ...))
    /// @return proposalId The ID of the created proposal
    function propose(address target, bytes calldata data) external onlyOwner returns (uint256 proposalId) {
        require(target != address(0), "target=0");

        proposalId = proposalCount++;
        uint256 eta = block.timestamp + delay;

        proposals[proposalId] = Proposal({
            target: target,
            data: data,
            eta: eta,
            executed: false,
            cancelled: false
        });

        emit ProposalCreated(proposalId, target, data, eta);
    }

    /// @notice Execute a proposal after its delay has passed
    function execute(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.eta != 0, "proposal not found");
        require(!p.executed, "already executed");
        require(!p.cancelled, "cancelled");
        require(block.timestamp >= p.eta, "too early");

        p.executed = true;

        (bool success, bytes memory returnData) = p.target.call(p.data);
        require(success, string(returnData));

        emit ProposalExecuted(proposalId);
    }

    /// @notice Cancel a pending proposal (owner or guardian)
    function cancel(uint256 proposalId) external onlyOwnerOrGuardian {
        Proposal storage p = proposals[proposalId];
        require(p.eta != 0, "proposal not found");
        require(!p.executed, "already executed");
        require(!p.cancelled, "already cancelled");

        p.cancelled = true;

        emit ProposalCancelled(proposalId);
    }

    /// @notice Update the timelock delay (must go through own timelock)
    function setDelay(uint256 _delay) external onlySelf {
        require(_delay >= MIN_DELAY && _delay <= MAX_DELAY, "delay out of range");
        uint256 oldDelay = delay;
        delay = _delay;
        emit DelayUpdated(oldDelay, _delay);
    }

    /// @notice Update guardian address
    function setGuardian(address _guardian) external onlyOwner {
        require(_guardian != address(0), "guardian=0");
        address old = guardian;
        guardian = _guardian;
        emit GuardianUpdated(old, _guardian);
    }

    /// @notice Transfer ownership
    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "owner=0");
        address old = owner;
        owner = _owner;
        emit OwnerUpdated(old, _owner);
    }

    /// @notice Get full proposal details (struct getter doesn't return bytes)
    function getProposal(uint256 proposalId)
        external
        view
        returns (
            address target,
            bytes memory data,
            uint256 eta,
            bool executed,
            bool cancelled
        )
    {
        Proposal storage p = proposals[proposalId];
        return (p.target, p.data, p.eta, p.executed, p.cancelled);
    }
}
