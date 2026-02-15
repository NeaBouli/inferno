// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @title Presale
/// @notice Presale contract for IFR token (9 decimals).
///         Users send ETH, receive IFR based on TOKEN_PRICE.
///
///         TOKEN_PRICE is denominated in wei per 1 whole token.
///         Example: TOKEN_PRICE = 1e14  →  1 IFR = 0.0001 ETH  →  1 ETH buys 10,000 IFR
///         Formula: tokensOut = (msg.value * 10^decimals) / TOKEN_PRICE
contract Presale is Ownable {
    IERC20 public immutable token;
    uint256 public immutable TOKEN_PRICE;  // wei per 1 whole IFR
    uint8   public immutable TOKEN_DECIMALS;

    uint256 public hardCap;        // max total ETH the presale accepts
    uint256 public perWalletCap;   // max ETH per address
    uint256 public startTime;
    uint256 public endTime;

    uint256 public totalRaised;
    mapping(address => uint256) public contributions;

    bool public finalized;

    event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount);
    event Finalized(uint256 totalRaised);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event UnsoldTokensWithdrawn(address indexed to, uint256 amount);

    error PresaleNotActive();
    error HardCapExceeded();
    error WalletCapExceeded();
    error ZeroPurchase();
    error AlreadyFinalized();
    error NotFinalized();
    error NothingToWithdraw();

    constructor(
        address _token,
        uint256 _tokenPrice,
        uint256 _hardCap,
        uint256 _perWalletCap,
        uint256 _startTime,
        uint256 _endTime
    ) Ownable(msg.sender) {
        require(_token != address(0), "token=0");
        require(_tokenPrice > 0, "price=0");
        require(_hardCap > 0, "hardCap=0");
        require(_perWalletCap > 0, "walletCap=0");
        require(_endTime > _startTime, "end<=start");

        token = IERC20(_token);
        TOKEN_PRICE = _tokenPrice;
        TOKEN_DECIMALS = IERC20(_token).decimals();
        hardCap = _hardCap;
        perWalletCap = _perWalletCap;
        startTime = _startTime;
        endTime = _endTime;
    }

    /// @notice Buy IFR tokens with ETH
    function buyTokens() external payable {
        if (block.timestamp < startTime || block.timestamp >= endTime || finalized)
            revert PresaleNotActive();
        if (msg.value == 0) revert ZeroPurchase();
        if (totalRaised + msg.value > hardCap) revert HardCapExceeded();
        if (contributions[msg.sender] + msg.value > perWalletCap) revert WalletCapExceeded();

        uint256 tokensOut = (msg.value * (10 ** TOKEN_DECIMALS)) / TOKEN_PRICE;
        require(tokensOut > 0, "amount too small");

        totalRaised += msg.value;
        contributions[msg.sender] += msg.value;

        require(token.transfer(msg.sender, tokensOut), "transfer failed");
        emit TokensPurchased(msg.sender, msg.value, tokensOut);
    }

    /// @notice Calculate how many tokens a given ETH amount would buy
    function getTokenAmount(uint256 ethAmount) external view returns (uint256) {
        return (ethAmount * (10 ** TOKEN_DECIMALS)) / TOKEN_PRICE;
    }

    /// @notice Finalize the presale (no more purchases)
    function finalize() external onlyOwner {
        if (finalized) revert AlreadyFinalized();
        finalized = true;
        emit Finalized(totalRaised);
    }

    /// @notice Withdraw raised ETH (only after finalized)
    function withdrawETH(address to) external onlyOwner {
        if (!finalized) revert NotFinalized();
        uint256 bal = address(this).balance;
        if (bal == 0) revert NothingToWithdraw();

        (bool ok, ) = to.call{value: bal}("");
        require(ok, "ETH transfer failed");
        emit ETHWithdrawn(to, bal);
    }

    /// @notice Withdraw unsold tokens (only after finalized)
    function withdrawUnsoldTokens(address to) external onlyOwner {
        if (!finalized) revert NotFinalized();
        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) revert NothingToWithdraw();

        require(token.transfer(to, bal), "transfer failed");
        emit UnsoldTokensWithdrawn(to, bal);
    }

    /// @notice Check if presale is currently active
    function isActive() external view returns (bool) {
        return block.timestamp >= startTime
            && block.timestamp < endTime
            && !finalized;
    }
}
