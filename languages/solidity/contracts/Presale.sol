// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Presale is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant TOKEN_UNIT = 1e9;

    error ZeroAddress();
    error InvalidTimeRange();
    error TokenPriceZero();
    error SaleNotStarted();
    error SaleEnded();
    error SaleFinalized();
    error RefundsActive();
    error RefundsNotActive();
    error HardCapExceeded();
    error WalletCapExceeded();
    error NoTokenOutput();
    error InsufficientTokenBalance();
    error NothingToWithdraw();
    error NothingToSweep();
    error FinalizationNotAllowed();
    error AlreadyFinalized();
    error AlreadyRefunding();
    error NotFinalized();
    error NoContribution();
    error InsufficientRefundLiquidity();
    error EthTransferFailed();

    IERC20 public immutable token;
    address payable public immutable treasury;
    uint256 public immutable tokenPriceWei;
    uint64 public immutable startTime;
    uint64 public immutable endTime;
    uint256 public immutable hardCapWei;
    uint256 public immutable walletCapWei;

    uint256 public raisedWei;
    uint256 public soldTokens;
    bool public isFinalized;
    bool public isRefunding;

    mapping(address => uint256) public contributedWei;

    event TokensPurchased(address indexed purchaser, address indexed recipient, uint256 paidWei, uint256 tokensOut);
    event EthWithdrawn(address indexed treasury, uint256 amount);
    event UnsoldTokensSwept(address indexed treasury, uint256 amount);
    event Finalized(uint256 timestamp);
    event RefundsEnabled(uint256 timestamp);
    event RefundClaimed(address indexed buyer, uint256 refundedWei, uint256 tokensReturned);

    constructor(
        IERC20 token_,
        address payable treasury_,
        uint256 tokenPriceWei_,
        uint64 startTime_,
        uint64 endTime_,
        uint256 hardCapWei_,
        uint256 walletCapWei_
    ) Ownable(msg.sender) {
        if (address(token_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (tokenPriceWei_ == 0) revert TokenPriceZero();
        if (startTime_ >= endTime_) revert InvalidTimeRange();

        token = token_;
        treasury = treasury_;
        tokenPriceWei = tokenPriceWei_;
        startTime = startTime_;
        endTime = endTime_;
        hardCapWei = hardCapWei_;
        walletCapWei = walletCapWei_;
    }

    function tokenPrice() external view returns (uint256) {
        return tokenPriceWei;
    }

    /// @notice Purchase tokens for a recipient. (Only this version remains.)
    function buy(address recipient) external payable nonReentrant whenNotPaused {
        _buyTo(recipient);
    }

    function _buyTo(address recipient) internal {
        if (isFinalized) revert SaleFinalized();
        if (isRefunding) revert RefundsActive();
        if (block.timestamp < startTime) revert SaleNotStarted();
        if (block.timestamp > endTime) revert SaleEnded();

        uint256 weiAmount = msg.value;
        uint256 tokensOut = (weiAmount * TOKEN_UNIT) / tokenPriceWei;
        if (tokensOut == 0) revert NoTokenOutput();

        uint256 newContribution = contributedWei[msg.sender] + weiAmount;
        if (walletCapWei != 0 && newContribution > walletCapWei) revert WalletCapExceeded();

        uint256 newRaised = raisedWei + weiAmount;
        if (hardCapWei != 0 && newRaised > hardCapWei) revert HardCapExceeded();

        uint256 availableTokens = token.balanceOf(address(this));
        if (availableTokens < tokensOut) revert InsufficientTokenBalance();

        contributedWei[msg.sender] = newContribution;
        raisedWei = newRaised;
        soldTokens += tokensOut;

        token.safeTransfer(recipient, tokensOut);

        emit TokensPurchased(msg.sender, recipient, weiAmount, tokensOut);
    }

    function withdrawETH() external onlyOwner nonReentrant {
        if (!isFinalized) revert NotFinalized();
        if (isRefunding) revert RefundsActive();

        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToWithdraw();

        (bool success,) = treasury.call{value: balance}("");
        if (!success) revert EthTransferFailed();

        emit EthWithdrawn(treasury, balance);
    }

    function sweepUnsoldTokens() external onlyOwner nonReentrant {
        if (!isFinalized) revert NotFinalized();
        if (block.timestamp <= endTime) revert FinalizationNotAllowed();

        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) revert NothingToSweep();

        token.safeTransfer(treasury, balance);

        emit UnsoldTokensSwept(treasury, balance);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        if (isRefunding) revert RefundsActive();
        _unpause();
    }

    function finalize() external onlyOwner nonReentrant {
        if (isFinalized) revert AlreadyFinalized();
        if (isRefunding) revert RefundsActive();
        if (block.timestamp < endTime && (hardCapWei == 0 || raisedWei < hardCapWei)) {
            revert FinalizationNotAllowed();
        }

        isFinalized = true;
        emit Finalized(block.timestamp);
    }

    function enableRefunds() external onlyOwner nonReentrant {
        if (isFinalized) revert SaleFinalized();
        if (isRefunding) revert AlreadyRefunding();

        isRefunding = true;
        _pause();
        emit RefundsEnabled(block.timestamp);
    }

    function claimRefund() external nonReentrant {
        if (!isRefunding) revert RefundsNotActive();

        uint256 contribution = contributedWei[msg.sender];
        if (contribution == 0) revert NoContribution();

        uint256 tokensToReturn = (contribution * TOKEN_UNIT) / tokenPriceWei;
        contributedWei[msg.sender] = 0;
        raisedWei -= contribution;
        soldTokens -= tokensToReturn;

        token.safeTransferFrom(msg.sender, address(this), tokensToReturn);

        if (address(this).balance < contribution) revert InsufficientRefundLiquidity();

        (bool success,) = msg.sender.call{value: contribution}("");
        if (!success) revert EthTransferFailed();

        emit RefundClaimed(msg.sender, contribution, tokensToReturn);
    }
}
