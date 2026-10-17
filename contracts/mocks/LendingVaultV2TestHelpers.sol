// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ILendingV2Oracle} from "../vault/LendingVaultV2.sol";
import {MockFeeOnTransferToken} from "./MockFeeOnTransferToken.sol";
import {MockReentrantToken} from "./MockReentrantToken.sol";
import {MockToken} from "./MockToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice TEST ONLY: fabricated adapter responses; never evidence of a working TWAP or attack budget.
contract LendingVaultV2OracleMock is ILendingV2Oracle {
    /// @notice Test asset identity.
    address public immutable ifrToken;
    /// @notice Test asset identity.
    address public immutable weth;
    /// @notice Test factory identity.
    address public immutable factory;
    /// @notice Test pair identity.
    address public immutable pair;
    mapping(uint256 => Evidence) private _evidence;
    bool private _broken;
    /// @notice Test fixture constructor.
    constructor(address token, address wrapped, address factory_, address pair_) {
        ifrToken = token; weth = wrapped; factory = factory_; pair = pair_;
    }
    /// @notice Inject test evidence for a version.
    function setEvidence(uint256 version, Evidence calldata evidence) external { _evidence[version] = evidence; }
    /// @notice Simulate a reverting adapter.
    function setBroken(bool value) external { _broken = value; }
    /// @notice Return fabricated immutable-timestamp evidence without refreshing it.
    function read(uint256 version) external view returns (Evidence memory) {
        require(!_broken, "oracle broken");
        return _evidence[version];
    }
}

/// @notice TEST ONLY: reuses the existing taxed token; exemption flag can deliberately lie.
contract LendingVaultV2TokenMock is MockFeeOnTransferToken {
    /// @notice Test exemption declaration, independent from configured fee to test exact receipts.
    mapping(address => bool) public feeExempt;
    bool private _falseReturn;
    bool private _broken;
    /// @notice Declare test fee exemption.
    function setFeeExempt(address account, bool value) external { feeExempt[account] = value; }
    /// @notice Configure false-return or reverting transfers.
    function setFailure(bool falseReturn_, bool broken_) external { _falseReturn = falseReturn_; _broken = broken_; }
    /// @notice Test transfer with optional failures.
    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!_broken, "token broken");
        return !_falseReturn && super.transfer(to, amount);
    }
    /// @notice Test transferFrom with optional failures.
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(!_broken, "token broken");
        return !_falseReturn && super.transferFrom(from, to, amount);
    }
}

/// @notice TEST ONLY: existing callback token with the IFR exemption surface.
contract LendingVaultV2ReentrantTokenMock is MockReentrantToken {
    /// @notice Exemption declaration; exact receipts are still measured by the vault.
    function feeExempt(address) external pure returns (bool) { return true; }
}

/// @notice TEST ONLY: WETH-shaped asset based on the existing 18-decimal token mock.
contract LendingVaultV2WETHMock is MockToken {
    bool private _shortMint;
    /// @notice Initialize the test token.
    constructor() MockToken("Wrapped test ETH", "WETH") {}
    /// @notice Simulate incompatible wrapping.
    function setShortMint(bool value) external { _shortMint = value; }
    /// @notice Mint against ETH for local claim tests only.
    function deposit() external payable { _mint(msg.sender, _shortMint ? msg.value - 1 : msg.value); }
}

/// @notice TEST ONLY: two-step controller and hostile ETH claimant; arbitrary calls exist only in this mock.
contract LendingVaultV2Actor is Ownable2Step {
    bool private _reject;
    address private _reentryTarget;
    bytes private _reentryData;
    /// @notice Last caught reentry failure, for explicit guard assertions.
    bytes public reentryFailure;
    /// @notice Received ETH, including callbacks that consume more gas than transfer's stipend.
    uint256 public received;
    /// @notice Test actor configuration or callback changed state.
    event ActorChanged();
    /// @notice Initialize an explicit two-step test controller owner.
    constructor(address owner_) Ownable(owner_) {}
    /// @notice Configure rejection or an attempted (caught) callback.
    function configure(bool reject_, address target, bytes calldata data) external onlyOwner {
        _reject = reject_; _reentryTarget = target; _reentryData = data;
        emit ActorChanged();
    }
    /// @notice Owner routes test calls from this contract, including guardian and ownership acceptance.
    function execute(address target, bytes calldata data) external payable onlyOwner returns (bytes memory) {
        (bool ok, bytes memory result) = target.call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
        emit ActorChanged();
        return result;
    }
    /// @notice Hostile test receiver; failed reentry is caught so outer claims can succeed.
    receive() external payable {
        require(!_reject, "ETH rejected");
        received += msg.value;
        if (_reentryTarget != address(0)) {
            (bool ok, bytes memory failure) = _reentryTarget.call(_reentryData);
            require(!ok, "reentry unexpectedly succeeded");
            reentryFailure = failure;
        }
        emit ActorChanged();
    }
}

/// @notice TEST ONLY: force ETH without executing a vault receive hook.
contract LendingVaultV2ForceETH {
    /// @notice Create and destroy in the same transaction, transferring value to a test vault.
    constructor(address payable destination) payable { selfdestruct(destination); }
}
