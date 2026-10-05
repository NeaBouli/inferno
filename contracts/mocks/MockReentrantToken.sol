// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockReentrantToken
/// @notice Test-only 9-decimal ERC20 that calls back into a target during transfers (reentrancy tests).
contract MockReentrantToken is ERC20 {
    address public target;
    bytes public payload;

    constructor() ERC20("Reentrant", "REN") {
        _mint(msg.sender, 1_000_000_000 * 1e9);
    }

    function decimals() public pure override returns (uint8) {
        return 9;
    }

    function arm(address _target, bytes calldata _payload) external {
        target = _target;
        payload = _payload;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        address t = target;
        if (t != address(0)) {
            target = address(0);
            (bool ok, bytes memory ret) = t.call(payload);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}
