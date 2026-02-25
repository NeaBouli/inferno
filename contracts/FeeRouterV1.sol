// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FeeRouterV1 is EIP712 {

    // === STATE ===
    address public governance;
    address public feeCollector;
    address public voucherSigner;

    uint16 public protocolFeeBps = 5;        // 0.05% default
    uint16 public constant FEE_CAP_BPS = 25; // 0.25% hard cap

    bool public paused;

    // Replay protection
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // Whitelisted swap adapters
    mapping(address => bool) public whitelistedAdapters;

    // === EIP-712 ===
    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "DiscountVoucher(address user,uint16 discountBps,uint32 maxUses,uint64 expiry,uint256 nonce)"
    );

    struct DiscountVoucher {
        address user;
        uint16 discountBps;
        uint32 maxUses;
        uint64 expiry;
        uint256 nonce;
    }

    // === EVENTS ===
    event VoucherUsed(address indexed user, uint256 indexed nonce, uint16 discountBps);
    event FeeCharged(address indexed user, uint256 feeAmount);
    event FeeBpsUpdated(uint16 oldBps, uint16 newBps);
    event AdapterWhitelisted(address indexed adapter, bool status);
    event Paused(bool status);

    // === CONSTRUCTOR ===
    constructor(
        address _governance,
        address _feeCollector,
        address _voucherSigner
    ) EIP712("InfernoFeeRouter", "1") {
        governance = _governance;
        feeCollector = _feeCollector;
        voucherSigner = _voucherSigner;
    }

    // === MODIFIERS ===
    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    modifier notPaused() {
        require(!paused, "FeeRouter paused");
        _;
    }

    // === CORE: swap mit optionalem Voucher ===
    function swapWithFee(
        address adapter,
        bytes calldata swapData,
        DiscountVoucher calldata voucher,
        bytes calldata voucherSig,
        bool useVoucher
    ) external payable notPaused {
        require(whitelistedAdapters[adapter], "Adapter not whitelisted");

        uint16 effectiveFeeBps = protocolFeeBps;

        if (useVoucher) {
            effectiveFeeBps = _applyVoucher(voucher, voucherSig);
        }

        // Fee berechnen und einbehalten
        uint256 feeAmount = 0;
        if (msg.value > 0 && effectiveFeeBps > 0) {
            feeAmount = (msg.value * effectiveFeeBps) / 10000;
            (bool sent,) = feeCollector.call{value: feeAmount}("");
            require(sent, "Fee transfer failed");
            emit FeeCharged(msg.sender, feeAmount);
        }

        // Swap ausfuehren ueber whitelisted Adapter
        uint256 swapValue = msg.value - feeAmount;
        (bool success,) = adapter.call{value: swapValue}(swapData);
        require(success, "Swap failed");
    }

    // === VOUCHER LOGIC ===
    function _applyVoucher(
        DiscountVoucher calldata voucher,
        bytes calldata sig
    ) internal returns (uint16 effectiveFeeBps) {
        require(voucher.user == msg.sender, "Voucher not for sender");
        require(block.timestamp <= voucher.expiry, "Voucher expired");
        require(!usedNonces[msg.sender][voucher.nonce], "Nonce already used");
        require(voucher.discountBps <= protocolFeeBps, "Discount exceeds fee");

        // EIP-712 Signatur pruefen
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            voucher.user,
            voucher.discountBps,
            voucher.maxUses,
            voucher.expiry,
            voucher.nonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, sig);
        require(recovered == voucherSigner, "Invalid voucher signature");

        // Nonce verbrauchen
        usedNonces[msg.sender][voucher.nonce] = true;

        emit VoucherUsed(msg.sender, voucher.nonce, voucher.discountBps);

        // Effektive Fee = max(protocolFee - discount, 0)
        if (voucher.discountBps >= protocolFeeBps) {
            return 0;
        }
        return protocolFeeBps - voucher.discountBps;
    }

    // === VIEW: Voucher validieren (off-chain check) ===
    function isVoucherValid(
        DiscountVoucher calldata voucher,
        bytes calldata sig
    ) external view returns (bool valid, string memory reason) {
        if (voucher.user != msg.sender) return (false, "Wrong user");
        if (block.timestamp > voucher.expiry) return (false, "Expired");
        if (usedNonces[voucher.user][voucher.nonce]) return (false, "Used");
        if (voucher.discountBps > protocolFeeBps) return (false, "Discount too high");

        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            voucher.user,
            voucher.discountBps,
            voucher.maxUses,
            voucher.expiry,
            voucher.nonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, sig);
        if (recovered != voucherSigner) return (false, "Invalid signature");

        return (true, "Valid");
    }

    // === GOVERNANCE ===
    function setFeeBps(uint16 newBps) external onlyGovernance {
        require(newBps <= FEE_CAP_BPS, "Exceeds fee cap");
        emit FeeBpsUpdated(protocolFeeBps, newBps);
        protocolFeeBps = newBps;
    }

    function setAdapter(address adapter, bool status) external onlyGovernance {
        whitelistedAdapters[adapter] = status;
        emit AdapterWhitelisted(adapter, status);
    }

    function setVoucherSigner(address newSigner) external onlyGovernance {
        voucherSigner = newSigner;
    }

    function setPaused(bool _paused) external onlyGovernance {
        paused = _paused;
        emit Paused(_paused);
    }

    function setFeeCollector(address newCollector) external onlyGovernance {
        feeCollector = newCollector;
    }

    // === RECEIVE ETH ===
    receive() external payable {}
}
