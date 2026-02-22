// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title PartnerVault
/// @notice Manages the 40M IFR Partner Ecosystem Pool.
///         Two mechanisms: milestone-based unlocking + lock-triggered creator rewards.
///         Admin = Governance Timelock. Guardian = emergency pause.
///
///         IMPORTANT: This contract MUST be set as feeExempt on InfernoToken
///         to prevent fee deductions on claim transfers.
contract PartnerVault is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable ifrToken;
    address public admin;
    address public guardian;

    uint256 public constant PARTNER_POOL = 40_000_000 * 10 ** 9;

    // Governance-controlled parameters with bounds
    uint256 public rewardBps;
    uint256 public constant MIN_REWARD_BPS = 500;
    uint256 public constant MAX_REWARD_BPS = 2500;

    uint256 public annualEmissionCap;
    uint256 public constant MIN_ANNUAL_CAP = 1_000_000 * 10 ** 9;
    uint256 public constant MAX_ANNUAL_CAP = 10_000_000 * 10 ** 9;

    // Global accounting
    uint256 public totalAllocated;
    uint256 public totalRewarded;
    uint256 public totalClaimed;
    uint256 public yearStart;
    uint256 public yearlyEmitted;

    struct Partner {
        address beneficiary;
        uint256 maxAllocation;
        uint256 unlockedTotal;
        uint256 rewardAccrued;
        uint256 claimedTotal;
        uint32 vestingStart;
        uint32 vestingDuration;
        uint32 cliff;
        bool active;
        bool milestonesFinal;
        uint8 tier;
    }

    mapping(bytes32 => Partner) private _partners;
    mapping(bytes32 => mapping(bytes32 => bool)) public milestoneDone;

    // ── Events ──────────────────────────────────────────────

    event PartnerCreated(
        bytes32 indexed partnerId,
        address beneficiary,
        uint256 maxAllocation,
        uint32 vestingDuration,
        uint32 cliff,
        uint8 tier
    );
    event PartnerActivated(bytes32 indexed partnerId);
    event MilestoneRecorded(
        bytes32 indexed partnerId,
        bytes32 indexed milestoneId,
        uint256 unlockAmount
    );
    event LockRewardRecorded(
        bytes32 indexed partnerId,
        uint256 lockAmount,
        uint256 reward
    );
    event Claimed(
        bytes32 indexed partnerId,
        address indexed beneficiary,
        uint256 amount
    );
    event BeneficiaryUpdated(
        bytes32 indexed partnerId,
        address oldBeneficiary,
        address newBeneficiary
    );
    event AllocationUpdated(
        bytes32 indexed partnerId,
        uint256 oldMax,
        uint256 newMax
    );
    event RewardBpsUpdated(uint256 oldBps, uint256 newBps);
    event AnnualCapUpdated(uint256 oldCap, uint256 newCap);
    event MilestonesFinalized(bytes32 indexed partnerId);
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    // ── Modifiers ───────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == guardian, "not guardian");
        _;
    }

    // ── Constructor ─────────────────────────────────────────

    constructor(
        address _ifrToken,
        address _admin,
        address _guardian,
        uint256 _rewardBps,
        uint256 _annualEmissionCap
    ) {
        require(_ifrToken != address(0), "token=0");
        require(_admin != address(0), "admin=0");
        require(_guardian != address(0), "guardian=0");
        require(
            _rewardBps >= MIN_REWARD_BPS && _rewardBps <= MAX_REWARD_BPS,
            "bps out of range"
        );
        require(
            _annualEmissionCap >= MIN_ANNUAL_CAP &&
                _annualEmissionCap <= MAX_ANNUAL_CAP,
            "cap out of range"
        );

        ifrToken = IERC20(_ifrToken);
        admin = _admin;
        guardian = _guardian;
        rewardBps = _rewardBps;
        annualEmissionCap = _annualEmissionCap;
        yearStart = block.timestamp;
    }

    // ── Admin Functions (Governance) ────────────────────────

    function createPartner(
        bytes32 partnerId,
        address beneficiary,
        uint256 maxAllocation,
        uint32 vestingDuration,
        uint32 cliff,
        uint8 tier
    ) external onlyAdmin {
        Partner storage p = _partners[partnerId];
        require(p.beneficiary == address(0), "already exists");
        require(beneficiary != address(0), "beneficiary=0");
        require(maxAllocation > 0, "allocation=0");
        require(
            totalAllocated + maxAllocation <= PARTNER_POOL,
            "exceeds pool"
        );
        require(
            vestingDuration >= 180 days && vestingDuration <= 365 days,
            "vesting out of range"
        );
        require(cliff <= vestingDuration, "cliff>vesting");

        p.beneficiary = beneficiary;
        p.maxAllocation = maxAllocation;
        p.vestingDuration = vestingDuration;
        p.cliff = cliff;
        p.tier = tier;

        totalAllocated += maxAllocation;

        emit PartnerCreated(
            partnerId,
            beneficiary,
            maxAllocation,
            vestingDuration,
            cliff,
            tier
        );
    }

    function activatePartner(bytes32 partnerId) external onlyAdmin {
        Partner storage p = _partners[partnerId];
        require(p.beneficiary != address(0), "not found");
        require(!p.active, "already active");
        p.active = true;
        emit PartnerActivated(partnerId);
    }

    function recordMilestone(
        bytes32 partnerId,
        bytes32 milestoneId,
        uint256 unlockAmount
    ) external onlyAdmin {
        Partner storage p = _partners[partnerId];
        require(p.active, "not active");
        require(!p.milestonesFinal, "milestones final");
        require(!milestoneDone[partnerId][milestoneId], "milestone done");
        require(unlockAmount > 0, "amount=0");
        require(
            p.unlockedTotal + unlockAmount + p.rewardAccrued <= p.maxAllocation,
            "exceeds allocation"
        );

        milestoneDone[partnerId][milestoneId] = true;
        if (p.vestingStart == 0) {
            p.vestingStart = uint32(block.timestamp);
        }
        p.unlockedTotal += unlockAmount;

        emit MilestoneRecorded(partnerId, milestoneId, unlockAmount);
    }

    function recordLockReward(
        bytes32 partnerId,
        uint256 lockAmount
    ) external onlyAdmin {
        Partner storage p = _partners[partnerId];
        require(p.active, "not active");
        require(lockAmount > 0, "amount=0");

        uint256 reward = (lockAmount * rewardBps) / 10_000;
        require(reward > 0, "reward=0");
        require(
            p.unlockedTotal + p.rewardAccrued + reward <= p.maxAllocation,
            "exceeds allocation"
        );
        require(_checkAnnualCap(reward), "exceeds annual cap");

        if (p.vestingStart == 0) {
            p.vestingStart = uint32(block.timestamp);
        }
        p.rewardAccrued += reward;
        totalRewarded += reward;
        yearlyEmitted += reward;

        emit LockRewardRecorded(partnerId, lockAmount, reward);
    }

    function setRewardBps(uint256 newBps) external onlyAdmin {
        require(
            newBps >= MIN_REWARD_BPS && newBps <= MAX_REWARD_BPS,
            "bps out of range"
        );
        uint256 old = rewardBps;
        rewardBps = newBps;
        emit RewardBpsUpdated(old, newBps);
    }

    function setAnnualEmissionCap(uint256 newCap) external onlyAdmin {
        require(
            newCap >= MIN_ANNUAL_CAP && newCap <= MAX_ANNUAL_CAP,
            "cap out of range"
        );
        uint256 old = annualEmissionCap;
        annualEmissionCap = newCap;
        emit AnnualCapUpdated(old, newCap);
    }

    function setPartnerBeneficiary(
        bytes32 partnerId,
        address newBeneficiary
    ) external onlyAdmin {
        Partner storage p = _partners[partnerId];
        require(p.beneficiary != address(0), "not found");
        require(newBeneficiary != address(0), "beneficiary=0");
        address old = p.beneficiary;
        p.beneficiary = newBeneficiary;
        emit BeneficiaryUpdated(partnerId, old, newBeneficiary);
    }

    function setPartnerAllocation(
        bytes32 partnerId,
        uint256 newMax
    ) external onlyAdmin {
        Partner storage p = _partners[partnerId];
        require(p.beneficiary != address(0), "not found");
        uint256 earned = p.unlockedTotal + p.rewardAccrued;
        require(newMax >= earned, "below earned");

        uint256 oldMax = p.maxAllocation;
        totalAllocated = totalAllocated - oldMax + newMax;
        require(totalAllocated <= PARTNER_POOL, "exceeds pool");

        p.maxAllocation = newMax;
        emit AllocationUpdated(partnerId, oldMax, newMax);
    }

    function finalizeMilestones(bytes32 partnerId) external onlyAdmin {
        Partner storage p = _partners[partnerId];
        require(p.beneficiary != address(0), "not found");
        require(!p.milestonesFinal, "already final");
        p.milestonesFinal = true;
        emit MilestonesFinalized(partnerId);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "admin=0");
        address old = admin;
        admin = newAdmin;
        emit AdminUpdated(old, newAdmin);
    }

    function setGuardian(address newGuardian) external onlyGuardian {
        require(newGuardian != address(0), "guardian=0");
        address old = guardian;
        guardian = newGuardian;
        emit GuardianUpdated(old, newGuardian);
    }

    function pause() external onlyGuardian {
        _pause();
    }

    function unpause() external onlyGuardian {
        _unpause();
    }

    // ── Permissionless Functions ─────────────────────────────

    function claim(bytes32 partnerId) external nonReentrant whenNotPaused {
        Partner storage p = _partners[partnerId];
        require(p.active, "not active");

        uint256 totalEarned = p.unlockedTotal + p.rewardAccrued;
        uint256 vested = _vestedAmount(p, totalEarned);
        uint256 amt = vested - p.claimedTotal;
        require(amt > 0, "nothing claimable");

        p.claimedTotal += amt;
        totalClaimed += amt;

        ifrToken.safeTransfer(p.beneficiary, amt);

        emit Claimed(partnerId, p.beneficiary, amt);
    }

    // ── View Functions ──────────────────────────────────────

    function claimable(bytes32 partnerId) external view returns (uint256) {
        Partner storage p = _partners[partnerId];
        if (!p.active) return 0;
        uint256 totalEarned = p.unlockedTotal + p.rewardAccrued;
        uint256 vested = _vestedAmount(p, totalEarned);
        if (vested <= p.claimedTotal) return 0;
        return vested - p.claimedTotal;
    }

    function vestedAmount(bytes32 partnerId) external view returns (uint256) {
        Partner storage p = _partners[partnerId];
        uint256 totalEarned = p.unlockedTotal + p.rewardAccrued;
        return _vestedAmount(p, totalEarned);
    }

    function partners(
        bytes32 partnerId
    )
        external
        view
        returns (
            address beneficiary,
            uint256 maxAllocation,
            uint256 unlockedTotal,
            uint256 rewardAccrued,
            uint256 claimedTotal,
            uint32 vestingStart,
            uint32 vestingDuration,
            uint32 cliff,
            bool active,
            bool milestonesFinal,
            uint8 tier
        )
    {
        Partner storage p = _partners[partnerId];
        return (
            p.beneficiary,
            p.maxAllocation,
            p.unlockedTotal,
            p.rewardAccrued,
            p.claimedTotal,
            p.vestingStart,
            p.vestingDuration,
            p.cliff,
            p.active,
            p.milestonesFinal,
            p.tier
        );
    }

    function pendingBalance() external view returns (uint256) {
        return ifrToken.balanceOf(address(this));
    }

    // ── Internal ────────────────────────────────────────────

    function _vestedAmount(
        Partner storage p,
        uint256 totalEarned
    ) internal view returns (uint256) {
        if (p.vestingStart == 0) return 0;
        if (block.timestamp < uint256(p.vestingStart) + uint256(p.cliff))
            return 0;

        uint256 effectiveStart = uint256(p.vestingStart) + uint256(p.cliff);
        uint256 effectiveDuration = uint256(p.vestingDuration) -
            uint256(p.cliff);
        uint256 elapsed = block.timestamp - effectiveStart;

        if (elapsed >= effectiveDuration) return totalEarned;
        return (totalEarned * elapsed) / effectiveDuration;
    }

    function _checkAnnualCap(uint256 amount) internal returns (bool) {
        if (block.timestamp >= yearStart + 365 days) {
            yearStart = block.timestamp;
            yearlyEmitted = 0;
        }
        return (yearlyEmitted + amount) <= annualEmissionCap;
    }
}
