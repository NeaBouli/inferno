// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockGovernanceV2Target
/// @notice Test-only CALL/delegatecall discriminator with retry, revert and large-return probes; no admin role.
contract MockGovernanceV2Target {
    /// @notice Last successful call argument.
    uint256 public value;
    /// @notice Last successful caller.
    address public lastCaller;
    /// @notice Last successful msg.value.
    uint256 public lastValue;
    /// @notice Whether the target should revert after writing state.
    bool public failing;

    /// @notice Deliberate target custom error used to assert byte-exact propagation.
    error TargetFailure(uint256 attemptedValue, address caller);
    /// @notice Successful target state update.
    event Called(address indexed caller, uint256 value, uint256 ethValue);
    /// @notice Test failure switch update.
    event FailureConfigured(bool failing);

    /// @notice Change the unprivileged test failure switch.
    /// @param enabled Whether subsequent calls should revert.
    function setFailing(bool enabled) external {
        failing = enabled;
        emit FailureConfigured(enabled);
    }

    /// @notice Write target storage and return an argument; optionally revert after the writes.
    /// @param newValue Test value.
    /// @return The supplied value.
    function callMe(uint256 newValue) external payable returns (uint256) {
        value = newValue;
        lastCaller = msg.sender;
        lastValue = msg.value;
        if (failing) revert TargetFailure(newValue, msg.sender);
        emit Called(msg.sender, newValue, msg.value);
        return newValue;
    }

    /// @notice Revert with a standard ABI string reason.
    function failWithReason() external pure {
        revert("target reason");
    }

    /// @notice Revert with zero-length raw data.
    function failWithoutData() external pure {
        assembly ("memory-safe") { revert(0, 0) }
    }

    /// @notice Return an allocated payload without an artificial protocol limit.
    /// @param size Number of zero bytes to return (bounded only by transaction gas).
    /// @return Allocated payload.
    function largeResult(uint256 size) external pure returns (bytes memory) {
        return new bytes(size);
    }

    /// @notice Accept a governed child call with the standard two-step ownership implementation.
    /// @param controller New GovernanceV2 controller to accept ownership of.
    function acceptControllerOwnership(address controller) external {
        // This mock has no owner/admin role; this is a test candidate contract's acceptance entry point.
        (bool success, bytes memory result) = controller.call(abi.encodeWithSignature("acceptOwnership()"));
        if (!success) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }
}
