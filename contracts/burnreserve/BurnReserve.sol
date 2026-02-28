// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC20Burnable {
    function burn(uint256 amount) external;
}

/// @title BurnReserve
/// @notice Holds IFR tokens and permanently burns them on demand.
///         Tokens sent here via transfer (from BuybackVault etc.) accumulate
///         until guardian or owner triggers burn(), reducing totalSupply.
contract BurnReserve {
    address public owner;
    address public guardian;
    IERC20 public immutable token;

    uint256 public totalBurned;

    event Deposited(address indexed from, uint256 amount);
    event Burned(uint256 amount, uint256 newTotalBurned);
    event GuardianUpdated(address indexed newGuardian);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwnerOrGuardian() {
        require(msg.sender == owner || msg.sender == guardian, "not authorized");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @notice Deploy BurnReserve
    /// @param _token IFR token address (must support burn via ERC20Burnable)
    /// @param _guardian Address that can trigger burns alongside owner
    constructor(address _token, address _guardian) {
        require(_token != address(0), "token=0");
        require(_guardian != address(0), "guardian=0");
        owner = msg.sender;
        token = IERC20(_token);
        guardian = _guardian;
    }

    /// @notice Deposit tokens via transferFrom (requires prior approval)
    /// @param amount Amount of IFR tokens to deposit
    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(token.transferFrom(msg.sender, address(this), amount), "transfer failed");
        emit Deposited(msg.sender, amount);
    }

    /// @notice Burn tokens held by this contract (reduces totalSupply)
    /// @param amount Amount of IFR tokens to burn
    function burn(uint256 amount) external onlyOwnerOrGuardian {
        require(amount > 0, "amount=0");
        require(amount <= token.balanceOf(address(this)), "exceeds balance");

        totalBurned += amount;
        IERC20Burnable(address(token)).burn(amount);

        emit Burned(amount, totalBurned);
    }

    /// @notice Burn all tokens held by this contract
    function burnAll() external onlyOwnerOrGuardian {
        uint256 bal = token.balanceOf(address(this));
        require(bal > 0, "nothing to burn");

        totalBurned += bal;
        IERC20Burnable(address(token)).burn(bal);

        emit Burned(bal, totalBurned);
    }

    /// @notice Tokens currently held (awaiting burn)
    function pendingBurn() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Update guardian address
    /// @param _guardian New guardian address
    function setGuardian(address _guardian) external onlyOwner {
        require(_guardian != address(0), "guardian=0");
        guardian = _guardian;
        emit GuardianUpdated(_guardian);
    }

    /// @notice Transfer ownership to a new address
    /// @param newOwner Address of the new owner
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "newOwner=0");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }
}
