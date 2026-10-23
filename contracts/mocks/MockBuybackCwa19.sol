// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockFeeOnTransferToken} from "./MockFeeOnTransferToken.sol";
import {MockRouter} from "./MockRouter.sol";

/// @notice Test-only return-value faults over the existing nine-decimal token ledger.
contract MockBuybackReturnToken is MockFeeOnTransferToken {
    uint256 public transferMode;
    address public faultRecipient;
    uint256 public approveMode;
    uint256 public approvalCalls;

    /// @notice Select normal (0), false (1), or empty (2) transfer returns for a recipient (zero means all).
    function setTransferMode(uint256 mode, address recipient) external {
        transferMode = mode;
        faultRecipient = recipient;
    }

    /// @notice Select normal (0), false (1), empty (2), or false-on-reset-only (3) approval returns.
    function setApproveMode(uint256 mode) external { approveMode = mode; }

    /// @notice Execute a transfer with a configurable ABI return fault.
    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 mode = faultRecipient == address(0) || to == faultRecipient ? transferMode : 0;
        if (mode == 1) return false;
        super.transfer(to, amount);
        if (mode == 2) {
            assembly { return(0, 0) }
        }
        return true;
    }

    /// @notice Execute an approval with a configurable ABI return fault.
    function approve(address spender, uint256 amount) public override returns (bool) {
        approvalCalls++;
        if (approveMode == 1 || (approveMode == 3 && amount == 0)) return false;
        super.approve(spender, amount);
        if (approveMode == 2) {
            assembly { return(0, 0) }
        }
        return true;
    }
}

/// @notice Test-only router probe: reuse MockRouter swaps, observe arguments, and inject arbitrary callbacks.
/// @dev The existing MockRouter only calls execute(), ignores deadlines/LP minima and never pulls LP tokens.
///      This probe adds the missing observations and a real allowance-consuming LP transfer.
contract MockBuybackRouterProbe {
    MockRouter public immutable inner;
    address public callbackTarget;
    bytes public callbackData;
    uint256 public callbackHook;
    bool public callbackSucceeded;
    bytes public callbackResult;
    uint256 public swapCalls;
    uint256 public lpUseBps = 10_000;

    event SwapObserved(uint256 minOut, uint256 deadline, uint256 ethIn);
    event LiquidityObserved(uint256 minToken, uint256 minETH, uint256 deadline);

    constructor(address router_) { inner = MockRouter(router_); }

    /// @notice Attempt an owner-only withdrawal from inside an ETH withdrawal's receiver callback.
    receive() external payable {
        (bool ok,) = msg.sender.call(abi.encodeWithSignature("withdrawETH(address,uint256)", address(this), 1));
        require(ok, "withdraw callback failed");
    }

    /// @notice Reuse the existing mock's WETH marker.
    function WETH() external view returns (address) { return inner.WETH(); }

    /// @notice Reuse the existing mock's deterministic quote.
    function getAmountsOut(uint256 amount, address[] calldata path) external view returns (uint256[] memory) {
        return inner.getAmountsOut(amount, path);
    }

    /// @notice Arm one callback before the next swap (1) or LP transfer (2).
    function arm(address target, bytes calldata data, uint256 hook) external {
        callbackTarget = target;
        callbackData = data;
        callbackHook = hook;
        callbackSucceeded = false;
        delete callbackResult;
    }

    /// @notice Set the LP fraction actually consumed, to exercise remaining allowance.
    function setLpUseBps(uint256 bps) external {
        require(bps <= 10_000, "bps>100%");
        lpUseBps = bps;
    }

    /// @notice Initiate a call when the probe deliberately owns a target in a privileged-callback test.
    function forward(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly { revert(add(result, 32), mload(result)) }
        }
        return result;
    }

    /// @notice Exercise a spender's retained allowance, including after router replacement.
    function pull(address token, address from, address to, uint256 amount) external {
        require(IERC20(token).transferFrom(from, to, amount), "pull failed");
    }

    /// @notice Observe/enforce the supplied bounds, attempt a callback, then delegate the swap.
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 minOut, address[] calldata path, address to, uint256 deadline
    ) external payable {
        require(deadline >= block.timestamp, "expired");
        swapCalls++;
        emit SwapObserved(minOut, deadline, msg.value);
        _callback(1);
        inner.swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(minOut, path, to, deadline);
    }

    /// @notice Model a real token pull and reject amounts below the controller's supplied LP bounds.
    function addLiquidityETH(
        address token, uint256 desired, uint256 minToken, uint256 minETH, address to, uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(deadline >= block.timestamp, "expired");
        amountToken = desired * lpUseBps / 10_000;
        require(amountToken >= minToken && msg.value >= minETH, "LP minimum");
        emit LiquidityObserved(minToken, minETH, deadline);
        _callback(2);
        require(IERC20(token).transferFrom(msg.sender, address(inner), amountToken), "LP transfer failed");
        return inner.addLiquidityETH{value: msg.value}(token, amountToken, minToken, minETH, to, deadline);
    }

    function _callback(uint256 hook) internal {
        if (callbackHook != hook) return;
        callbackHook = 0;
        (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
    }
}
