// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Presale
 * @notice Public token presale with purchase, pause, finalize and refund flow.
 * @dev Price is defined in WEI PER BASE UNIT (decimals of the token).
 *      Example: ERC20 has 9 decimals → 1 full token = 1e9 base units.
 *      tokenPriceWei = wei per base unit.
 */
contract Presale is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Custom errors
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

    // Immutable config
    IERC20 public immutable token;
    address payable public immutable treasury;
    uint256 public immutable tokenPriceWei; // wei per base unit (token decimals)
    uint64  public immutable startTime;
    uint64  public immutable endTime;
    uint256 public immutable hardCapWei;    // 0 = no cap
    uint256 public immutable walletCapWei;  // 0 = no per-wallet cap

    // State
    uint256 public raisedWei;
    uint256 public soldTokens;  // counted in base units (i.e., with decimals)
    bool public isFinalized;
    bool public isRefunding;

    mapping(address => uint256) public contributedWei;

    // Events
    event TokensPurchased(address indexed buyer, address indexed recipient, uint256 weiUsed, uint256 tokensOut);
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

    /// @notice Backwards-compat accessors for tests/UI
    function tokenPrice() external view returns (uint256) { return tokenPriceWei; }
    function refundsEnabled() external view returns (bool) { return isRefunding; }

    /// @notice Public buy (all checks & accounting inside)
    function buy(address recipient) external payable nonReentrant whenNotPaused {
        _buyTo(recipient);
    }

    function _buyTo(address recipient) internal {
        if (isFinalized) revert SaleFinalized();
        if (isRefunding) revert RefundsActive();
        if (block.timestamp < startTime) revert SaleNotStarted();
        if (block.timestamp > endTime) revert SaleEnded();

        uint256 weiAmount = msg.value;
        // Price is wei/baseUnit, so tokensOut is in base units
        uint256 tokensOut = weiAmount / tokenPriceWei;
        if (tokensOut == 0) revert NoTokenOutput();

        uint256 weiUsed = tokensOut * tokenPriceWei;
        uint256 refund = weiAmount - weiUsed;

        // Per-wallet and hard cap accounting use wei USED (not the dust refunded)
        uint256 newContribution = contributedWei[msg.sender] + weiUsed;
        if (walletCapWei != 0 && newContribution > walletCapWei) revert WalletCapExceeded();

        uint256 newRaised = raisedWei + weiUsed;
        if (hardCapWei != 0 && newRaised > hardCapWei) revert HardCapExceeded();

        // Token inventory must be sufficient
        uint256 availableTokens = token.balanceOf(address(this));
        if (availableTokens < tokensOut) revert InsufficientTokenBalance();

        // Effects
        contributedWei[msg.sender] = newContribution;
        raisedWei = newRaised;
        soldTokens += tokensOut;

        // Interactions
        token.safeTransfer(recipient, tokensOut);

        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert EthTransferFailed();
        }

        emit TokensPurchased(msg.sender, recipient, weiUsed, tokensOut);
    }

    /// @notice Withdraw raised ETH to treasury (requires finalize & not refunding)
    function withdrawETH() external onlyOwner nonReentrant {
        if (!isFinalized) revert NotFinalized();
        if (isRefunding) revert RefundsActive();

        uint256 bal = address(this).balance;
        if (bal == 0) revert NothingToWithdraw();

        (bool ok,) = treasury.call{value: bal}("");
        if (!ok) revert EthTransferFailed();

        emit EthWithdrawn(treasury, bal);
    }

    /// @notice Sweep unsold tokens to treasury after sale end (requires finalize)
    function sweepUnsoldTokens() external onlyOwner nonReentrant {
        if (!isFinalized) revert NotFinalized();
        if (block.timestamp <= endTime) revert FinalizationNotAllowed();

        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) revert NothingToSweep();

        token.safeTransfer(treasury, bal);
        emit UnsoldTokensSwept(treasury, bal);
    }

    /// @notice Admin pause/unpause
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner {
        if (isRefunding) revert RefundsActive();
        _unpause();
    }

    /// @notice Finalize sale (after end or hardcap reached)
    function finalize() external onlyOwner nonReentrant {
        if (isFinalized) revert AlreadyFinalized();
        if (isRefunding) revert RefundsActive();
        if (block.timestamp < endTime && (hardCapWei == 0 || raisedWei < hardCapWei)) {
            revert FinalizationNotAllowed();
        }
        isFinalized = true;
        emit Finalized(block.timestamp);
    }

    /// @notice Enable refunds (pauses the sale)
    function enableRefunds() external onlyOwner nonReentrant {
        if (isFinalized) revert SaleFinalized();
        if (isRefunding) revert AlreadyRefunding();

        isRefunding = true;
        _pause();
        emit RefundsEnabled(block.timestamp);
    }

    /// @notice Claim ETH refund by returning purchased tokens
    function claimRefund() external nonReentrant {
        if (!isRefunding) revert RefundsNotActive();

        uint256 contribution = contributedWei[msg.sender];
        if (contribution == 0) revert NoContribution();

        uint256 tokensToReturn = contribution / tokenPriceWei;

        // Effects
        contributedWei[msg.sender] = 0;
        raisedWei -= contribution;
        soldTokens -= tokensToReturn;

        // Interactions: take tokens back, then send ETH
        token.safeTransferFrom(msg.sender, address(this), tokensToReturn);

        if (address(this).balance < contribution) revert InsufficientRefundLiquidity();

        (bool ok,) = msg.sender.call{value: contribution}("");
        if (!ok) revert EthTransferFailed();

        emit RefundClaimed(msg.sender, contribution, tokensToReturn);
    }
}
