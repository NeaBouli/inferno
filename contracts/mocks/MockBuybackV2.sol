// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockFeeOnTransferToken} from "./MockFeeOnTransferToken.sol";

interface IBuybackV2TestRouter {
    /// @notice Reused mock's wrapped-native address marker.
    function WETH() external view returns (address);
    /// @notice Test-only spot/output rate mutation.
    function setRate(uint256 rate) external;
    /// @notice Reused mock's net-receipt swap path.
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 minimum, address[] calldata path, address to, uint256 deadline
    ) external payable;
}

interface IBuybackV2TestPair {
    /// @notice Accrue historical prices before replacing the mock's reserves.
    function setReserves(uint112 reserve0, uint112 reserve1) external;
}

/// @notice Test-only canonical-router identity adapter, expiry recorder and arbitrary callback probe.
contract MockBuybackV2Router {
    IBuybackV2TestRouter public immutable inner;
    address public immutable factory;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackSucceeded;
    bytes public callbackResult;
    bool public ignoreMinimum;
    uint256 public swapCalls;
    uint256 public observedDeadline;
    uint256 public observedMinimum;

    /// @notice Bind the existing deterministic router and mock factory.
    constructor(address inner_, address factory_) {
        inner = IBuybackV2TestRouter(inner_);
        factory = factory_;
    }

    /// @notice Forward the reused router's asset marker for constructor identity checks.
    function WETH() external view returns (address) { return inner.WETH(); }

    /// @notice V2 must never consult this spot quote to establish its security floor.
    function getAmountsOut(uint256, address[] calldata) external pure returns (uint256[] memory) {
        revert("spot quote forbidden");
    }

    /// @notice Test-only fault switch disabling the inner router's output check.
    function setIgnoreMinimum(bool value) external { ignoreMinimum = value; }

    /// @notice Arm an unrestricted one-shot callback before the next swap.
    function arm(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        callbackSucceeded = false;
        delete callbackResult;
    }

    /// @notice Ignore the router minimum only when requested, testing the vault's own balance check.
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 minimum, address[] calldata path, address to, uint256 deadline
    ) external payable {
        require(deadline > block.timestamp, "expired");
        swapCalls++;
        observedDeadline = deadline;
        observedMinimum = minimum;
        address target = callbackTarget;
        if (target != address(0)) {
            callbackTarget = address(0);
            (callbackSucceeded, callbackResult) = target.call(callbackData);
        }
        inner.swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(
            ignoreMinimum ? 0 : minimum, path, to, deadline
        );
    }

    /// @notice Unrestricted test-only owner actor and transaction-local manipulation driver.
    function forward(address target, bytes calldata data) external returns (bytes memory result) {
        return _forward(target, data);
    }

    /// @notice Move spot reserves and execution rate before the buyback inside the same transaction.
    function manipulateAndExecute(address pair, uint112 reserve0, uint112 reserve1, uint256 rate,
        address vault, bytes calldata data) external
    {
        IBuybackV2TestPair(pair).setReserves(reserve0, reserve1);
        inner.setRate(rate);
        _forward(vault, data);
    }

    /// @notice Publish and consume an observation in one transaction to test the publication-block barrier.
    function updateAndExecute(address vault, bytes calldata data) external {
        _forward(vault, abi.encodeWithSignature("updateOracle()"));
        _forward(vault, data);
    }

    /// @notice Attempt to exploit any retained spender approval against a funded vault.
    function pull(address token, address from, address to, uint256 amount) external {
        require(IERC20(token).transferFrom(from, to, amount), "pull failed");
    }

    function _forward(address target, bytes memory data) private returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }
}

/// @notice Test-only malformed ERC20 returns after a real ledger change, exercising complete rollback.
contract MockBuybackV2MalformedToken is MockFeeOnTransferToken {
    /// @notice Mutate the ledger, then return an invalid boolean word instead of true.
    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        assembly ("memory-safe") { mstore(0, 2) return(0, 32) }
    }
}
