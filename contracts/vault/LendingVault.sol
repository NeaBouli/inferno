// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LendingVault
/// @notice IFR lending against ETH collateral.
///         Lenders deposit IFR and earn interest. Borrowers post ETH collateral to borrow IFR.
///         Interest rate is utilization-based (2%–25% per month).
///         Collateral thresholds: 200% initial, 150% margin call, 120% liquidation.
///         Liquidator bonus: 5% of collateral.
///         Interest split: 50% lender, 50% protocol (Uniswap LP or BurnReserve).
///
///         IMPORTANT: This contract MUST be set as feeExempt on InfernoToken
///         to prevent fee deductions on deposit/withdraw/borrow/repay transfers.
contract LendingVault is Ownable, ReentrancyGuard {

    IERC20 public immutable ifrToken;

    // ── Constants ─────────────────────────────────────────────

    /// @notice Collateral ratio thresholds (percentage, e.g. 200 = 200%)
    uint256 public constant INITIAL_COLLATERAL_PCT = 200;
    uint256 public constant WARNING_COLLATERAL_PCT = 150;
    uint256 public constant LIQUIDATION_COLLATERAL_PCT = 120;

    /// @notice Liquidator receives 5% of collateral as bonus
    uint256 public constant LIQUIDATOR_BONUS_PCT = 5;

    /// @notice Interest split: 50% to lender, 50% to protocol
    uint256 public constant LENDER_INTEREST_PCT = 50;

    /// @notice Loan duration limits
    uint256 public constant MIN_DURATION = 30 days;
    uint256 public constant MAX_DURATION = 365 days;

    /// @notice Maximum active loans per borrower
    uint256 public constant MAX_LOANS_PER_BORROWER = 10;

    // ── State ─────────────────────────────────────────────────

    struct LendingOffer {
        address lender;
        uint256 availableIFR;   // IFR deposited and available to lend
        uint256 lentIFR;        // IFR currently lent out
        bool active;
    }

    struct Loan {
        address borrower;
        uint256 offerId;        // Reference to lender's offer
        uint256 ifrAmount;      // IFR borrowed (9 decimals)
        uint256 ethCollateral;  // ETH posted as collateral (wei)
        uint256 startTime;      // Loan start timestamp
        uint256 duration;       // Loan duration in seconds
        uint256 monthlyRateBps; // Monthly interest rate at time of borrow (bps)
        bool active;
    }

    LendingOffer[] public offers;
    Loan[] public loans;

    /// @notice lender address => offer ID
    mapping(address => uint256) public lenderOfferIndex;
    mapping(address => bool) public hasOffer;

    /// @notice borrower => active loan count
    mapping(address => uint256) public activeLoanCount;

    /// @notice Protocol fee receiver (Uniswap LP or BurnReserve)
    address public protocolFeeReceiver;

    /// @notice IFR price in wei per 1e9 IFR (1 full IFR token).
    ///         Set by Governance via price oracle or manual update.
    ///         Example: if 1 IFR = 0.000001 ETH, then ifrPriceWei = 1e12
    uint256 public ifrPriceWei;

    /// @notice Total IFR available across all offers
    uint256 public totalAvailable;
    /// @notice Total IFR currently lent out
    uint256 public totalLent;

    // ── Events ────────────────────────────────────────────────

    event OfferCreated(address indexed lender, uint256 indexed offerId, uint256 amount);
    event OfferIncreased(address indexed lender, uint256 indexed offerId, uint256 addedAmount);
    event OfferWithdrawn(address indexed lender, uint256 indexed offerId, uint256 amount);
    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 offerId, uint256 ifrAmount, uint256 ethCollateral);
    event LoanRepaid(uint256 indexed loanId, uint256 principal, uint256 interest);
    event LoanLiquidated(uint256 indexed loanId, address indexed liquidator, uint256 liquidatorBonus, uint256 lenderReceived);
    event MarginCallWarning(uint256 indexed loanId, uint256 collateralRatioPct);
    event PriceUpdated(uint256 newPriceWei);
    event ProtocolFeeReceiverUpdated(address indexed receiver);

    // ── Constructor ───────────────────────────────────────────

    constructor(address _ifrToken, address _governance) Ownable(_governance) {
        require(_ifrToken != address(0), "token=0");
        ifrToken = IERC20(_ifrToken);
    }

    // ── Lender Functions ──────────────────────────────────────

    /// @notice Create a lending offer by depositing IFR
    function createOffer(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        require(!hasOffer[msg.sender], "offer exists");

        require(ifrToken.transferFrom(msg.sender, address(this), amount), "transfer failed");

        uint256 offerId = offers.length;
        offers.push(LendingOffer({
            lender: msg.sender,
            availableIFR: amount,
            lentIFR: 0,
            active: true
        }));

        lenderOfferIndex[msg.sender] = offerId;
        hasOffer[msg.sender] = true;
        totalAvailable += amount;

        emit OfferCreated(msg.sender, offerId, amount);
    }

    /// @notice Increase an existing lending offer
    function increaseOffer(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        require(hasOffer[msg.sender], "no offer");

        uint256 offerId = lenderOfferIndex[msg.sender];
        LendingOffer storage offer = offers[offerId];
        require(offer.active, "offer not active");

        require(ifrToken.transferFrom(msg.sender, address(this), amount), "transfer failed");

        offer.availableIFR += amount;
        totalAvailable += amount;

        emit OfferIncreased(msg.sender, offerId, amount);
    }

    /// @notice Withdraw unlent IFR from offer
    function withdrawOffer(uint256 amount) external nonReentrant {
        require(hasOffer[msg.sender], "no offer");

        uint256 offerId = lenderOfferIndex[msg.sender];
        LendingOffer storage offer = offers[offerId];
        require(offer.active, "offer not active");
        require(offer.availableIFR >= amount, "insufficient available");

        offer.availableIFR -= amount;
        totalAvailable -= amount;

        if (offer.availableIFR == 0 && offer.lentIFR == 0) {
            offer.active = false;
        }

        require(ifrToken.transfer(msg.sender, amount), "transfer failed");

        emit OfferWithdrawn(msg.sender, offerId, amount);
    }

    // ── Borrower Functions ────────────────────────────────────

    /// @notice Borrow IFR against ETH collateral
    /// @param offerId The lending offer to borrow from
    /// @param ifrAmount Amount of IFR to borrow (9 decimals)
    /// @param durationDays Loan duration in days (30–365)
    function borrow(
        uint256 offerId,
        uint256 ifrAmount,
        uint256 durationDays
    ) external payable nonReentrant {
        require(ifrAmount > 0, "amount=0");
        require(durationDays >= 30 && durationDays <= 365, "duration: 30-365 days");
        require(activeLoanCount[msg.sender] < MAX_LOANS_PER_BORROWER, "max loans reached");
        require(offerId < offers.length, "invalid offerId");

        LendingOffer storage offer = offers[offerId];
        require(offer.active, "offer not active");
        require(offer.availableIFR >= ifrAmount, "insufficient IFR");
        require(offer.lender != msg.sender, "cannot self-borrow");

        // Validate collateral (200% of IFR value)
        uint256 requiredCollateral = getRequiredCollateral(ifrAmount);
        require(msg.value >= requiredCollateral, "insufficient collateral");

        uint256 rate = getInterestRate();

        offer.availableIFR -= ifrAmount;
        offer.lentIFR += ifrAmount;
        totalAvailable -= ifrAmount;
        totalLent += ifrAmount;
        activeLoanCount[msg.sender]++;

        uint256 loanId = loans.length;
        loans.push(Loan({
            borrower: msg.sender,
            offerId: offerId,
            ifrAmount: ifrAmount,
            ethCollateral: msg.value,
            startTime: block.timestamp,
            duration: durationDays * 1 days,
            monthlyRateBps: rate,
            active: true
        }));

        require(ifrToken.transfer(msg.sender, ifrAmount), "transfer failed");

        emit LoanCreated(loanId, msg.sender, offerId, ifrAmount, msg.value);
    }

    /// @notice Repay a loan: return IFR + interest, receive ETH collateral back
    function repay(uint256 loanId) external nonReentrant {
        require(loanId < loans.length, "invalid loanId");
        Loan storage loan = loans[loanId];
        require(loan.active, "loan not active");
        require(loan.borrower == msg.sender, "not borrower");

        uint256 interest = calculateInterest(loanId);
        uint256 totalRepay = loan.ifrAmount + interest;

        require(ifrToken.transferFrom(msg.sender, address(this), totalRepay), "transfer failed");

        // Split interest: 50% lender, 50% protocol
        uint256 lenderInterest = interest * LENDER_INTEREST_PCT / 100;
        uint256 protocolInterest = interest - lenderInterest;

        // Return principal + lender's interest share to lender offer
        LendingOffer storage offer = offers[loan.offerId];
        offer.availableIFR += loan.ifrAmount;
        offer.lentIFR -= loan.ifrAmount;
        totalAvailable += loan.ifrAmount;
        totalLent -= loan.ifrAmount;

        // Transfer lender interest directly
        if (lenderInterest > 0) {
            require(ifrToken.transfer(offer.lender, lenderInterest), "lender transfer failed");
        }

        // Protocol interest → fee receiver (or stays in contract)
        if (protocolInterest > 0 && protocolFeeReceiver != address(0)) {
            require(ifrToken.transfer(protocolFeeReceiver, protocolInterest), "protocol transfer failed");
        }

        // Return ETH collateral
        uint256 collateral = loan.ethCollateral;
        loan.active = false;
        loan.ethCollateral = 0;
        activeLoanCount[msg.sender]--;

        payable(msg.sender).transfer(collateral);

        emit LoanRepaid(loanId, loan.ifrAmount, interest);
    }

    /// @notice Add more ETH collateral to an active loan (top-up for margin calls)
    function topUpCollateral(uint256 loanId) external payable nonReentrant {
        require(loanId < loans.length, "invalid loanId");
        Loan storage loan = loans[loanId];
        require(loan.active, "loan not active");
        require(loan.borrower == msg.sender, "not borrower");
        require(msg.value > 0, "no ETH sent");

        loan.ethCollateral += msg.value;
    }

    // ── Liquidation ───────────────────────────────────────────

    /// @notice Liquidate an undercollateralized loan (< 120% collateral ratio).
    ///         Liquidator receives 5% bonus. Remaining collateral → lender.
    function liquidate(uint256 loanId) external nonReentrant {
        require(loanId < loans.length, "invalid loanId");
        Loan storage loan = loans[loanId];
        require(loan.active, "loan not active");

        uint256 ratio = getCollateralRatio(loanId);
        require(ratio < LIQUIDATION_COLLATERAL_PCT, "not liquidatable");

        uint256 collateral = loan.ethCollateral;
        uint256 bonus = collateral * LIQUIDATOR_BONUS_PCT / 100;
        uint256 lenderReceived = collateral - bonus;

        loan.active = false;
        loan.ethCollateral = 0;

        // Update offer and totals
        LendingOffer storage offer = offers[loan.offerId];
        offer.lentIFR -= loan.ifrAmount;
        totalLent -= loan.ifrAmount;
        activeLoanCount[loan.borrower]--;

        // Liquidator gets bonus
        payable(msg.sender).transfer(bonus);
        // Lender gets remaining collateral (compensates for lost IFR)
        payable(offer.lender).transfer(lenderReceived);

        emit LoanLiquidated(loanId, msg.sender, bonus, lenderReceived);
    }

    // ── Health Check ──────────────────────────────────────────

    /// @notice Check collateral health of a loan. Emits MarginCallWarning if < 150%.
    ///         Called by Railway cron every 4h.
    function checkHealth(uint256 loanId) external returns (uint256 ratio) {
        require(loanId < loans.length, "invalid loanId");
        Loan storage loan = loans[loanId];
        require(loan.active, "loan not active");

        ratio = getCollateralRatio(loanId);

        if (ratio < WARNING_COLLATERAL_PCT) {
            emit MarginCallWarning(loanId, ratio);
        }
    }

    // ── View Functions ────────────────────────────────────────

    /// @notice Get utilization-based interest rate (bps per month)
    function getInterestRate() public view returns (uint256) {
        uint256 total = totalAvailable + totalLent;
        if (total == 0) return 200; // 2% base

        uint256 utilization = (totalLent * 100) / total;

        if (utilization <= 25) return 200;  // 2%
        if (utilization <= 50) return 300;  // 3%
        if (utilization <= 75) return 500;  // 5%
        if (utilization <= 90) return 800;  // 8%
        if (utilization < 100) return 1500; // 15%
        return 2500;                         // 25%
    }

    /// @notice Calculate interest owed on a loan
    function calculateInterest(uint256 loanId) public view returns (uint256) {
        require(loanId < loans.length, "invalid loanId");
        Loan storage loan = loans[loanId];

        uint256 elapsed = block.timestamp - loan.startTime;
        uint256 months = elapsed / 30 days;
        if (months == 0) months = 1; // Minimum 1 month interest

        return (loan.ifrAmount * loan.monthlyRateBps * months) / 10000;
    }

    /// @notice Get required ETH collateral for borrowing ifrAmount
    function getRequiredCollateral(uint256 ifrAmount) public view returns (uint256) {
        require(ifrPriceWei > 0, "price not set");
        // ifrPriceWei = wei per 1e9 IFR (1 full token)
        // collateral = ifrAmount * ifrPriceWei / 1e9 * INITIAL_COLLATERAL_PCT / 100
        return (ifrAmount * ifrPriceWei * INITIAL_COLLATERAL_PCT) / (1e9 * 100);
    }

    /// @notice Get current collateral ratio for a loan (percentage, e.g. 200 = 200%)
    function getCollateralRatio(uint256 loanId) public view returns (uint256) {
        require(loanId < loans.length, "invalid loanId");
        Loan storage loan = loans[loanId];
        if (loan.ifrAmount == 0 || ifrPriceWei == 0) return type(uint256).max;

        uint256 ifrValueWei = (loan.ifrAmount * ifrPriceWei) / 1e9;
        if (ifrValueWei == 0) return type(uint256).max;

        return (loan.ethCollateral * 100) / ifrValueWei;
    }

    /// @notice Get total number of offers
    function getOfferCount() external view returns (uint256) {
        return offers.length;
    }

    /// @notice Get total number of loans
    function getLoanCount() external view returns (uint256) {
        return loans.length;
    }

    /// @notice Get a lending offer by ID
    function getOffer(uint256 offerId) external view returns (LendingOffer memory) {
        require(offerId < offers.length, "invalid offerId");
        return offers[offerId];
    }

    /// @notice Get a loan by ID
    function getLoan(uint256 loanId) external view returns (Loan memory) {
        require(loanId < loans.length, "invalid loanId");
        return loans[loanId];
    }

    // ── Governance ────────────────────────────────────────────

    /// @notice Update IFR price (wei per 1e9 IFR). Governance only.
    ///         Phase 2: replace with Uniswap TWAP oracle call.
    function setIFRPrice(uint256 _priceWei) external onlyOwner {
        require(_priceWei > 0, "price=0");
        ifrPriceWei = _priceWei;
        emit PriceUpdated(_priceWei);
    }

    /// @notice Set protocol fee receiver. Governance only.
    function setProtocolFeeReceiver(address _receiver) external onlyOwner {
        protocolFeeReceiver = _receiver;
        emit ProtocolFeeReceiverUpdated(_receiver);
    }
}
