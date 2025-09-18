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

    uint256 private constant TOKEN_UNIT = 1e9;

    // Errors aligned with test expectations
    error Presale__ZeroAddress();
    error Presale__InvalidTimeRange();
    error Presale__TokenPriceZero();
    error Presale__NotStarted();
    error Presale__SaleEnded();
    error Presale__SaleFinalized();
    error Presale__RefundsActive();
    error Presale__RefundsNotActive();
    error Presale__HardCapExceeded();
    error Presale__WalletCapExceeded();
    error Presale__ZeroPurchase();
    error Presale__InsufficientTokenInventory();
    error Presale__NothingToWithdraw();
    error Presale__NothingToSweep();
    error Presale__FinalizationNotAllowed();
    error Presale__AlreadyFinalized();
    error Presale__AlreadyRefunding();
    error Presale__NotFinalized();
    error Presale__NoContribution();
    error Presale__InsufficientRefundLiquidity();
    error Presale__EthTransferFailed();
    error Presale__Unauthorized();

    IERC20 public immutable token;
    address payable public immutable treasury;
    uint256 public immutable tokenPrice;
    uint64 public immutable startTime;
    uint64 public immutable endTime;
    uint256 public immutable hardCap;
    uint256 public immutable walletCap;

    uint256 private _totalRaised;
    uint256 private _tokensSold;
    bool public isFinalized;
    bool private _refundsEnabled;

    mapping(address => uint256) private _contributions;

    event TokensPurchased(address indexed purchaser, address indexed beneficiary, uint256 paidWei, uint256 tokensOut);
    event EthWithdrawn(address indexed treasury, uint256 amount);
    event UnsoldTokensSwept(address indexed treasury, uint256 amount);
    event Finalized(uint256 timestamp);
    event RefundsEnabled(uint256 timestamp);
    event RefundClaimed(address indexed buyer, uint256 refundedWei, uint256 tokensReturned);

    constructor(
        IERC20 token_,
        address payable treasury_,
        uint256 tokenPrice_,
        uint64 startTime_,
        uint64 endTime_,
        uint256 hardCap_,
        uint256 walletCap_
    ) Ownable(msg.sender) {
        if (address(token_) == address(0) || treasury_ == address(0)) revert Presale__ZeroAddress();
        if (tokenPrice_ == 0) revert Presale__TokenPriceZero();
        if (startTime_ >= endTime_) revert Presale__InvalidTimeRange();

        token = token_;
        treasury = treasury_;
        tokenPrice = tokenPrice_;
        startTime = startTime_;
        endTime = endTime_;
        hardCap = hardCap_;
        walletCap = walletCap_;
    }

    function purchase(address beneficiary) external payable nonReentrant whenNotPaused {
        if (isFinalized) revert Presale__SaleFinalized();
        if (_refundsEnabled) revert Presale__RefundsActive();
        if (block.timestamp < startTime) revert Presale__NotStarted();
        if (block.timestamp > endTime) revert Presale__SaleEnded();

        uint256 weiAmount = msg.value;
        uint256 tokensOut = (weiAmount * TOKEN_UNIT) / tokenPrice;
        if (tokensOut == 0) revert Presale__ZeroPurchase();

        uint256 newContribution = _contributions[msg.sender] + weiAmount;
        if (walletCap != 0 && newContribution > walletCap) revert Presale__WalletCapExceeded();

        uint256 newRaised = _totalRaised + weiAmount;
        if (hardCap != 0 && newRaised > hardCap) revert Presale__HardCapExceeded();

        uint256 availableTokens = token.balanceOf(address(this));
        if (availableTokens < tokensOut) revert Presale__InsufficientTokenInventory();

        _contributions[msg.sender] = newContribution;
        _totalRaised = newRaised;
        _tokensSold += tokensOut;

        token.safeTransfer(beneficiary, tokensOut);

        emit TokensPurchased(msg.sender, beneficiary, weiAmount, tokensOut);
    }

    // Views for tests
    function totalRaised() external view returns (uint256) { return _totalRaised; }
    function tokensSold() external view returns (uint256) { return _tokensSold; }
    function contributionOf(address account) external view returns (uint256) { return _contributions[account]; }
    function refundsEnabled() external view returns (bool) { return _refundsEnabled; }
    function isPaused() external view returns (bool) { return paused(); }

    function withdrawETH() external onlyOwner nonReentrant {
        if (!isFinalized) revert Presale__NotFinalized();
        if (_refundsEnabled) revert Presale__RefundsActive();

        uint256 balance = address(this).balance;
        if (balance == 0) revert Presale__NothingToWithdraw();

        (bool success, ) = treasury.call{value: balance}("");
        if (!success) revert Presale__EthTransferFailed();

        emit EthWithdrawn(treasury, balance);
    }

    function sweepUnsoldTokens() external onlyOwner nonReentrant {
        if (!isFinalized) revert Presale__NotFinalized();
        if (block.timestamp <= endTime) revert Presale__FinalizationNotAllowed();

        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) revert Presale__NothingToSweep();

        token.safeTransfer(treasury, balance);

        emit UnsoldTokensSwept(treasury, balance);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner {
        if (_refundsEnabled) revert Presale__RefundsActive();
        _unpause();
    }

    function finalize() external onlyOwner nonReentrant {
        if (isFinalized) revert Presale__AlreadyFinalized();
        if (_refundsEnabled) revert Presale__RefundsActive();
        if (block.timestamp < endTime && (hardCap == 0 || _totalRaised < hardCap))
            revert Presale__FinalizationNotAllowed();

        isFinalized = true;
        emit Finalized(block.timestamp);
    }

    function enableRefunds() external onlyOwner nonReentrant {
        if (isFinalized) revert Presale__SaleFinalized();
        if (_refundsEnabled) revert Presale__AlreadyRefunding();

        _refundsEnabled = true;
        _pause();
        emit RefundsEnabled(block.timestamp);
    }

    function claimRefund() external nonReentrant {
        if (!_refundsEnabled) revert Presale__RefundsNotActive();

        uint256 contribution = _contributions[msg.sender];
        if (contribution == 0) revert Presale__NoContribution();

        uint256 tokensToReturn = (contribution * TOKEN_UNIT) / tokenPrice;

        _contributions[msg.sender] = 0;
        _totalRaised -= contribution;
        _tokensSold -= tokensToReturn;

        token.safeTransferFrom(msg.sender, address(this), tokensToReturn);

        if (address(this).balance < contribution) revert Presale__InsufficientRefundLiquidity();

        (bool success, ) = msg.sender.call{value: contribution}("");
        if (!success) revert Presale__EthTransferFailed();

        emit RefundClaimed(msg.sender, contribution, tokensToReturn);
    }
}
