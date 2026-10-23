// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title FeeRouterV2 (local draft, not deployed)
/// @notice Protocol fee router with bounded EIP-712 discount vouchers and two-step governance.
/// @dev CWA-18: all configured addresses must be nonzero and maxUses must be positive.
///      Usage is counted per (user, nonce), not per signature. The first successful redemption
///      binds that pair to the complete EIP-712 voucher digest; different signed terms cannot
///      reset or extend its allowance. A new voucher must use a fresh nonce. usedNonces retains
///      V1's getter ABI and reports exhaustion, while voucherUses exposes the committed count.
///      Every successful voucher swap consumes one use, including zero-value swaps. Reverts
///      roll back usage and transfers; useVoucher=false ignores all voucher fields/signatures.
///      Domain (InfernoFeeRouter, 2) binds signatures to this contract and the current chain.
///      V1's native-ETH fee arithmetic, 25-bps cap, adapter forwarding and swap-only pause remain.
///      Governance handover follows CWA-16: propose/replace, accept by the nominee, or cancel
///      by current governance. A proposal grants no authority and there is no renunciation path.
contract FeeRouterV2 is EIP712 {
    /// @notice Active address authorized to administer the router.
    address public governance;
    /// @notice Governance nominee; zero when no transfer is pending.
    address public pendingGovernance;
    /// @notice Address receiving protocol fees.
    address public feeCollector;
    /// @notice Authorized EIP-712 voucher signer.
    address public voucherSigner;
    /// @notice Protocol fee in basis points (default 5 = 0.05%).
    uint16 public protocolFeeBps = 5;
    /// @notice Maximum protocol fee (25 bps = 0.25%).
    uint16 public constant FEE_CAP_BPS = 25;
    /// @notice Whether swaps are paused; administration and direct ETH receipt remain available.
    bool public paused;
    /// @notice Whether the bound voucher's allowance is exhausted for a user nonce.
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    /// @notice Successful voucher redemptions per user nonce.
    mapping(address => mapping(uint256 => uint32)) public voucherUses;
    /// @notice Adapters approved by governance.
    mapping(address => bool) public whitelistedAdapters;

    mapping(address => mapping(uint256 => bytes32)) private _voucherDigests;

    /// @notice EIP-712 type hash, retaining V1's signed voucher fields and widths.
    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "DiscountVoucher(address user,uint16 discountBps,uint32 maxUses,uint64 expiry,uint256 nonce)"
    );

    /// @notice Signed discount terms; a user nonce is bound to these terms on first redemption.
    struct DiscountVoucher {
        address user;
        uint16 discountBps;
        uint32 maxUses;
        uint64 expiry;
        uint256 nonce;
    }

    event VoucherUsed(address indexed user, uint256 indexed nonce, uint16 discountBps);
    event FeeCharged(address indexed user, uint256 feeAmount);
    event FeeBpsUpdated(uint16 oldBps, uint16 newBps);
    event AdapterWhitelisted(address indexed adapter, bool status);
    event Paused(bool status);
    event VoucherSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event GovernanceTransferProposed(address indexed currentGovernance, address indexed proposedGovernance);
    event GovernanceTransferCancelled(address indexed currentGovernance, address indexed cancelledNominee);
    event GovernanceTransferred(address indexed oldGovernance, address indexed newGovernance);

    /// @notice Initialize the draft router with nonzero administrative addresses and domain version 2.
    /// @param _governance Initial governance authority.
    /// @param _feeCollector Initial recipient of protocol fees.
    /// @param _voucherSigner Initial signer of discount vouchers.
    constructor(address _governance, address _feeCollector, address _voucherSigner)
        EIP712("InfernoFeeRouter", "2")
    {
        require(_governance != address(0), "Zero governance");
        require(_feeCollector != address(0), "Zero fee collector");
        require(_voucherSigner != address(0), "Zero voucher signer");
        governance = _governance;
        feeCollector = _feeCollector;
        voucherSigner = _voucherSigner;
        emit GovernanceTransferred(address(0), _governance);
        emit FeeCollectorUpdated(address(0), _feeCollector);
        emit VoucherSignerUpdated(address(0), _voucherSigner);
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    modifier notPaused() {
        require(!paused, "FeeRouter paused");
        _;
    }

    /// @notice Forward a swap to an approved adapter, charging the native-ETH fee with an optional discount.
    /// @dev Voucher state is updated before external calls; any failure reverts the entire swap.
    /// @param adapter Whitelisted adapter receiving calldata and post-fee ETH.
    /// @param swapData Calldata forwarded unchanged to the adapter.
    /// @param voucher Signed voucher terms; ignored if useVoucher is false.
    /// @param voucherSig EIP-712 signature; ignored if useVoucher is false.
    /// @param useVoucher Whether to validate and consume one voucher use.
    function swapWithFee(
        address adapter,
        bytes calldata swapData,
        DiscountVoucher calldata voucher,
        bytes calldata voucherSig,
        bool useVoucher
    ) external payable notPaused {
        require(whitelistedAdapters[adapter], "Adapter not whitelisted");
        uint16 effectiveFeeBps = useVoucher ? _applyVoucher(voucher, voucherSig) : protocolFeeBps;
        uint256 feeAmount = 0;
        if (msg.value > 0 && effectiveFeeBps > 0) {
            feeAmount = (msg.value * effectiveFeeBps) / 10000;
            (bool sent,) = feeCollector.call{value: feeAmount}("");
            require(sent, "Fee transfer failed");
            emit FeeCharged(msg.sender, feeAmount);
        }
        (bool success,) = adapter.call{value: msg.value - feeAmount}(swapData);
        require(success, "Swap failed");
    }

    /// @notice Check voucher eligibility without consuming a use; does not check pause or adapter state.
    /// @dev Preserves V1's ECDSA.recover behavior: malformed signatures may revert.
    /// @param voucher Discount terms to check for msg.sender.
    /// @param sig EIP-712 signature over the voucher.
    /// @return valid Whether a use remains and the terms/signature are valid.
    /// @return reason Human-readable result.
    function isVoucherValid(DiscountVoucher calldata voucher, bytes calldata sig)
        external view returns (bool valid, string memory reason)
    {
        if (voucher.user != msg.sender) return (false, "Wrong user");
        if (block.timestamp > voucher.expiry) return (false, "Expired");
        if (voucher.maxUses == 0) return (false, "Invalid max uses");
        if (usedNonces[voucher.user][voucher.nonce]) return (false, "Used");
        if (voucher.discountBps > protocolFeeBps) return (false, "Discount too high");
        bytes32 digest = _voucherDigest(voucher);
        if (voucherUses[voucher.user][voucher.nonce] != 0 && _voucherDigests[voucher.user][voucher.nonce] != digest) {
            return (false, "Nonce bound to another voucher");
        }
        if (ECDSA.recover(digest, sig) != voucherSigner) return (false, "Invalid signature");
        return (true, "Valid");
    }

    /// @notice Set the protocol fee within the immutable cap.
    /// @param newBps New fee rate, from zero through FEE_CAP_BPS inclusive.
    function setFeeBps(uint16 newBps) external onlyGovernance {
        require(newBps <= FEE_CAP_BPS, "Exceeds fee cap");
        emit FeeBpsUpdated(protocolFeeBps, newBps);
        protocolFeeBps = newBps;
    }

    /// @notice Approve or remove a nonzero adapter.
    /// @param adapter Nonzero adapter address.
    /// @param status True to approve, false to remove.
    function setAdapter(address adapter, bool status) external onlyGovernance {
        require(adapter != address(0), "Zero adapter");
        whitelistedAdapters[adapter] = status;
        emit AdapterWhitelisted(adapter, status);
    }

    /// @notice Rotate the voucher signer; old signatures stop validating immediately.
    /// @param newSigner Nonzero new signer; existing usage counters remain intact.
    function setVoucherSigner(address newSigner) external onlyGovernance {
        require(newSigner != address(0), "Zero voucher signer");
        emit VoucherSignerUpdated(voucherSigner, newSigner);
        voucherSigner = newSigner;
    }

    /// @notice Pause or resume swaps.
    /// @param _paused True to pause, false to resume.
    function setPaused(bool _paused) external onlyGovernance {
        paused = _paused;
        emit Paused(_paused);
    }

    /// @notice Change the recipient of subsequent protocol fees.
    /// @param newCollector Nonzero new collector.
    function setFeeCollector(address newCollector) external onlyGovernance {
        require(newCollector != address(0), "Zero fee collector");
        emit FeeCollectorUpdated(feeCollector, newCollector);
        feeCollector = newCollector;
    }

    /// @notice Propose or replace a governance nominee; active authority remains unchanged.
    /// @param newGovernance Nonzero candidate that must accept the transfer itself.
    function proposeGovernance(address newGovernance) external onlyGovernance {
        require(newGovernance != address(0), "Zero governance");
        _cancelGovernanceTransfer();
        pendingGovernance = newGovernance;
        emit GovernanceTransferProposed(governance, newGovernance);
    }

    /// @notice Accept governance as the current nominee and clear the pending transfer.
    function acceptGovernance() external {
        require(msg.sender == pendingGovernance, "Not pending governance");
        address oldGovernance = governance;
        governance = msg.sender;
        delete pendingGovernance;
        emit GovernanceTransferred(oldGovernance, msg.sender);
    }

    /// @notice Cancel the current nomination; the former nominee can no longer accept.
    function cancelGovernanceTransfer() external onlyGovernance {
        require(pendingGovernance != address(0), "No pending governance transfer");
        _cancelGovernanceTransfer();
    }

    /// @notice Accept direct ETH deposits, including while swaps are paused (same as V1).
    receive() external payable {}

    function _applyVoucher(DiscountVoucher calldata voucher, bytes calldata sig) internal returns (uint16) {
        require(voucher.user == msg.sender, "Voucher not for sender");
        require(block.timestamp <= voucher.expiry, "Voucher expired");
        require(voucher.maxUses > 0, "Invalid max uses");
        require(!usedNonces[msg.sender][voucher.nonce], "Nonce already used");
        require(voucher.discountBps <= protocolFeeBps, "Discount exceeds fee");
        bytes32 digest = _voucherDigest(voucher);
        uint32 uses = voucherUses[msg.sender][voucher.nonce];
        if (uses != 0) {
            require(_voucherDigests[msg.sender][voucher.nonce] == digest, "Nonce bound to another voucher");
        }
        require(uses < voucher.maxUses, "Nonce already used");
        require(ECDSA.recover(digest, sig) == voucherSigner, "Invalid voucher signature");

        _voucherDigests[msg.sender][voucher.nonce] = digest;
        voucherUses[msg.sender][voucher.nonce] = uses + 1;
        usedNonces[msg.sender][voucher.nonce] = uses + 1 == voucher.maxUses;
        emit VoucherUsed(msg.sender, voucher.nonce, voucher.discountBps);
        return protocolFeeBps - voucher.discountBps;
    }

    function _voucherDigest(DiscountVoucher calldata voucher) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            voucher.user,
            voucher.discountBps,
            voucher.maxUses,
            voucher.expiry,
            voucher.nonce
        )));
    }

    function _cancelGovernanceTransfer() private {
        address nominee = pendingGovernance;
        if (nominee != address(0)) {
            delete pendingGovernance;
            emit GovernanceTransferCancelled(governance, nominee);
        }
    }
}
