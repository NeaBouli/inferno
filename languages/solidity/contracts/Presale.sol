// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Inferno Presale
 * @notice Handles the public token presale lifecycle with purchase, treasury, and refund flows.
 * @dev Ensure the presale contract _and_ treasury are marked fee-exempt on InfernoToken before use.
 */
contract Presale is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev All token math is performed with the InfernoToken base unit (9 decimals).
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

    event TokensPurchased(address indexed purchaser, uint256 paidWei, uint256 tokensOut);
    event EthWithdrawn(address indexed treasury, uint256 amount);
    event UnsoldTokensSwept(address indexed treasury, uint256 amount);
    event Finalized(uint256 timestamp);
    event RefundsEnabled(uint256 timestamp);
    event RefundClaimed(address indexed buyer, uint256 refundedWei, uint256 tokensReturned);

    /**
     * @param token_ Presale token address.
     * @param treasury_ Treasury receiving raised ETH and unsold tokens.
     * @param tokenPriceWei_ Token price denominated in wei per Inferno base unit.
     * @param startTime_ Timestamp when purchases become available.
     * @param endTime_ Timestamp when purchases stop being accepted.
     * @param hardCapWei_ Maximum total wei to raise. Set to zero to disable the cap.
     * @param walletCapWei_ Maximum wei per wallet. Set to zero to disable the cap.
     */
    constructor(
        IERC20 token_,
        address payable treasury_,
        uint256 tokenPriceWei_,
        uint64 startTime_,
        uint64 endTime_,
        uint256 hardCapWei_,
        uint256 walletCapWei_
    ) Ownable(msg.sender) {
        if (address(token_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (tokenPriceWei_ == 0) {
            revert TokenPriceZero();
        }
        if (startTime_ >= endTime_) {
            revert InvalidTimeRange();
        }

        token = token_;
        treasury = treasury_;
        tokenPriceWei = tokenPriceWei_;
        startTime = startTime_;
        endTime = endTime_;
        hardCapWei = hardCapWei_;
        walletCapWei = walletCapWei_;
    }

    /**
     * @notice Compatibility getter — returns token price in wei per base unit.
     *         Tests may call tokenPrice() or tokenPriceWei().
     */
    function tokenPrice() external view returns (uint256) {
        return tokenPriceWei;
    }

    /**
     * @notice Purchase presale tokens for the caller (convenience).
     */
    function buy() external payable nonReentrant whenNotPaused {
        _buyTo(msg.sender);
    }

    /**
     * @notice Purchase presale tokens to a given recipient (API expected by tests).
     */
    function buy(address recipient) external payable nonReentrant whenNotPaused {
        _buyTo(recipient);
    }

    /**
     * @dev Internal unified buy implementation (recipient-specified).
     */
    function _buyTo(address recipient) internal {
        if (isFinalized) {
            revert SaleFinalized();
        }
        if (isRefunding) {
            revert RefundsActive();
        }
        if (block.timestamp < startTime) {
            revert SaleNotStarted();
        }
        if (block.timestamp > endTime) {
            revert SaleEnded();
        }

        uint256 weiAmount = msg.value;
        uint256 tokensOut = (weiAmount * TOKEN_UNIT) / tokenPriceWei;
        if (tokensOut == 0) {
            revert NoTokenOutput();
        }

        uint256 newContribution = contributedWei[msg.sender] + weiAmount;
        if (walletCapWei != 0 && newContribution > walletCapWei) {
            revert WalletCapExceeded();
        }

        uint256 newRaised = raisedWei + weiAmount;
        if (hardCapWei != 0 && newRaised > hardCapWei) {
            revert HardCapExceeded();
        }

        uint256 availableTokens = token.balanceOf(address(this));
        if (availableTokens < tokensOut) {
            revert InsufficientTokenBalance();
        }

        contributedWei[msg.sender] = newContribution;
        raisedWei = newRaised;
        soldTokens += tokensOut;

        token.safeTransfer(recipient, tokensOut);

        emit TokensPurchased(recipient, weiAmount, tokensOut);
    }

    /**
     * @notice Withdraw accumulated ETH to the treasury.
     * @dev Only callable after finalization and while refunds are disabled.
     */
    function withdrawETH() external onlyOwner nonReentrant {
        if (!isFinalized) {
            revert NotFinalized();
        }
        if (isRefunding) {
            revert RefundsActive();
        }

        uint256 balance = address(this).balance;
        if (balance == 0) {
            revert NothingToWithdraw();
        }

        (bool success, ) = treasury.call{value: balance}("");
        if (!success) {
            revert EthTransferFailed();
        }

        emit EthWithdrawn(treasury, balance);
    }

    /**
     * @notice Transfer remaining tokens back to the treasury after the sale concludes.
     */
    function sweepUnsoldTokens() external onlyOwner nonReentrant {
        if (!isFinalized) {
            revert NotFinalized();
        }
        if (block.timestamp <= endTime) {
            revert FinalizationNotAllowed();
        }

        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) {
            revert NothingToSweep();
        }

        token.safeTransfer(treasury, balance);

        emit UnsoldTokensSwept(treasury, balance);
    }

    /**
     * @notice Pause new purchases.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resume new purchases.
     */
    function unpause() external onlyOwner {
        if (isRefunding) {
            revert RefundsActive();
        }
        _unpause();
    }

    /**
     * @notice Mark the sale as finalized.
     */
    function finalize() external onlyOwner nonReentrant {
        if (isFinalized) {
            revert AlreadyFinalized();
        }
        if (isRefunding) {
            revert RefundsActive();
        }
        if (block.timestamp < endTime && (hardCapWei == 0 || raisedWei < hardCapWei)) {
            revert FinalizationNotAllowed();
        }

        isFinalized = true;

        emit Finalized(block.timestamp);
    }

    /**
     * @notice Enable refunds for buyers.
     */
    function enableRefunds() external onlyOwner nonReentrant {
        if (isFinalized) {
            revert SaleFinalized();
        }
        if (isRefunding) {
            revert AlreadyRefunding();
        }

        isRefunding = true;
        _pause();

        emit RefundsEnabled(block.timestamp);
    }

    /**
     * @notice Claim an ETH refund by returning purchased tokens.
     * @dev Buyers must approve the contract to pull the required token amount beforehand.
     */
    function claimRefund() external nonReentrant {
        if (!isRefunding) {
            revert RefundsNotActive();
        }

        uint256 contribution = contributedWei[msg.sender];
        if (contribution == 0) {
            revert NoContribution();
        }

        uint256 tokensToReturn = (contribution * TOKEN_UNIT) / tokenPriceWei;

        contributedWei[msg.sender] = 0;
        raisedWei -= contribution;
        soldTokens -= tokensToReturn;

        token.safeTransferFrom(msg.sender, address(this), tokensToReturn);

        if (address(this).balance < contribution) {
            revert InsufficientRefundLiquidity();
        }

        (bool success, ) = msg.sender.call{value: contribution}("");
        if (!success) {
            revert EthTransferFailed();
        }

        emit RefundClaimed(msg.sender, contribution, tokensToReturn);
    }
}
