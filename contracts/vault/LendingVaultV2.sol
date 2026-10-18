// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IUniswapV2FactoryPair, IUniswapV2PairTwap} from "./PriceLockVault.sol";

/// @notice IFR-specific exemption surface; absence/failure disables funding and borrowing.
interface ILendingV2IFR is IERC20Metadata {
    /// @notice Whether transfers involving the account are exempt from IFR transfer fees.
    function feeExempt(address account) external view returns (bool);
}

/// @notice Ratified shared adapter boundary. No conforming production adapter is supplied here.
/// @dev An implementation must prove cumulative direction, counterfactual accrual, wrap,
/// retention, all checkpoint depths and coverage; merely returning these fields is insufficient.
interface ILendingV2Oracle {
    struct Evidence {
        uint256 version;
        uint256 slowPrice; // wei per full IFR
        uint256 fastPrice;
        uint256 slowStart;
        uint256 slowEnd;
        uint256 fastStart;
        uint256 fastEnd;
        uint256 latestObservation;
        uint256 maxGap; // maximum checkpoint gap throughout both windows, seconds
        uint256 fastMaxGap; // retained fast history must support at least 30-minute cadence
        uint256 minWethDepth; // minimum across ALL coverage checkpoints and consumption, wei
        uint256 minIfrDepth; // same, IFR base units
        uint256 reason; // zero only for fully valid evidence
    }
    /// @notice Immutable IFR asset identity.
    function ifrToken() external view returns (address);
    /// @notice Immutable WETH asset identity.
    function weth() external view returns (address);
    /// @notice Immutable canonical factory identity, bound to the vault's manifest.
    function factory() external view returns (address);
    /// @notice Canonical IFR/WETH pair identity.
    function pair() external view returns (address);
    /// @notice Read a pinned policy version without refreshing observations or source timestamps.
    function read(uint256 version) external view returns (Evidence memory);
}

/// @notice Wrapped ETH payout surface, bound at construction; no approvals are used.
interface ILendingV2WETH is IERC20Metadata {
    /// @notice Mint WETH to the caller for exactly msg.value wei.
    function deposit() external payable;
}

/// @title LendingVaultV2 (release candidate)
/// @notice Release candidate of LENDINGVAULT_V2_SPEC.md; starts paused with zero caps.
/// @dev Release candidate, ratified 2026-10-18; not deployed; not externally audited;
/// activation only via Governance + Treasury Safe. Constants match the ratified defaults.
/// No production shared oracle, deployment, migration, sweep, manual price or upgrade path is supplied.
/// Trust: owner must be an approved two-step governance controller; guardian must be a two-step
/// controller; canonical factory/WETH and a reviewed immutable-version adapter must match a manifest.
contract LendingVaultV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice IFR base units per full token; all token accounting uses integers.
    uint256 public constant IFR_UNIT = 1e9;
    /// @notice Basis-point denominator.
    uint256 public constant BPS = 10_000;
    /// @notice Mandatory minimum governance delay, seconds.
    uint256 public constant GOVERNANCE_DELAY = 48 hours;
    /// @notice Ratified term lower bound, seconds.
    uint256 public constant MIN_TERM = 30 days;
    /// @notice Ratified term upper bound, seconds.
    uint256 public constant MAX_TERM = 90 days;
    /// @notice Ratified oracle-independent grace period, seconds.
    uint256 public constant GRACE = 7 days;
    /// @notice Ratified maximum fixed interest per 30 days, bps.
    uint256 public constant MAX_RATE_BPS = 200;
    /// @notice Ratified initial debt-inclusive LTV, bps; equality passes.
    uint256 public constant INITIAL_LTV_BPS = 3_000;
    /// @notice Ratified warning threshold, bps; equality warns.
    uint256 public constant WARNING_LTV_BPS = 4_000;
    /// @notice Ratified full-liquidation threshold, bps; equality liquidates.
    uint256 public constant LIQUIDATION_LTV_BPS = 5_000;
    /// @notice Ratified liquidation bonus, bps of current debt value.
    uint256 public constant BONUS_BPS = 500;
    /// @notice Ratified default payment multiplier, bps of maximum debt value at origination.
    uint256 public constant DEFAULT_BPS = 12_500;

    struct Configuration {
        address adapter;
        uint256 oracleVersion;
        address feeReceiver;
        uint256 minPrice; // explicit Council bounds, wei per IFR; no bootstrap default
        uint256 maxPrice;
        uint256 minIfrDepth; // mandatory IFR-side floor, base units
        uint256 totalCap; // IFR base units, <=100,000 IFR
        uint256 loanCap; // <=10,000 IFR
        uint256 borrowerCap; // <=20,000 IFR
        uint256 offerCap; // <=25,000 IFR
        uint256 dailyCap; // <=25,000 IFR, gross rolling 24 hours
        uint256 ethCap; // wei, <=0.5 ETH
        uint256 economicCap; // wei, explicitly reviewed gain ceiling; zero until research passes
    }
    struct Offer {
        address lender;
        uint256 available;
        uint256 lent;
        uint256 rateBps;
        uint256 minTerm;
        uint256 maxTerm;
        uint256 losses;
    }
    enum Status { Active, Repaid, Liquidated, Defaulted }
    struct Loan {
        address borrower;
        uint256 offerId;
        uint256 principal;
        uint256 collateral;
        uint256 start;
        uint256 term;
        uint256 rateBps;
        uint256 policyId;
        uint256 defaultETH;
        Status status;
    }
    struct BorrowRequest {
        uint256 offerId;
        uint256 principal;
        uint256 term;
        uint256 maxRateBps;
        uint256 minReceived;
        uint256 maxCollateral;
        uint256 deadline;
    }
    struct Origination { uint256 timestamp; uint256 cumulative; }

    /// @notice Immutable nine-decimal IFR asset. This contract never administers the token.
    ILendingV2IFR public immutable ifrToken;
    /// @notice Immutable canonical WETH payout asset, 18 decimals.
    ILendingV2WETH public immutable weth;
    /// @notice Immutable canonical factory from the future deployment manifest.
    address public immutable factory;
    /// @notice Current future-loan configuration ID; zero is unconfigured.
    uint256 public policyId;
    mapping(uint256 => Configuration) private _policies;
    Offer[] private _offers;
    Loan[] private _loans;
    Origination[] private _originations;
    /// @notice Available principal only, excluding interest credits, losses and donations.
    uint256 public totalAvailable;
    /// @notice Active IFR principal, excluding accrued interest.
    uint256 public totalLent;
    /// @notice Written-off IFR principal; never converted to available balance.
    uint256 public totalLosses;
    /// @notice Sum of active collateral, wei.
    uint256 public totalCollateral;
    /// @notice Sum of active immutable default ETH commitments, wei.
    uint256 public totalDefaultExposure;
    /// @notice Total unclaimed IFR credits, base units.
    uint256 public totalIFRCredits;
    /// @notice Total unclaimed ETH credits, wei.
    uint256 public totalETHCredits;
    /// @notice Original beneficiary => IFR gross claim entitlement.
    mapping(address => uint256) public ifrCredits;
    /// @notice Original beneficiary => ETH claim entitlement, wei.
    mapping(address => uint256) public ethCredits;
    /// @notice Borrower => active principal, base units.
    mapping(address => uint256) public borrowerPrincipal;
    /// @notice Borrower => active loan count, maximum two.
    mapping(address => uint256) public activeLoanCount;
    /// @notice Receiver proved ability to call the vault; it obtains no administration rights.
    mapping(address => bool) public receiverConfirmed;
    /// @notice Exact calldata digest => ETA; zero means absent. Queues have no time expiry.
    mapping(bytes32 => uint256) public actionETA;
    /// @notice Accepted pause controller; only immediate pause authority.
    address public guardian;
    /// @notice Governed nominee without authority until it accepts.
    address public pendingGuardian;
    /// @notice Borrowing always starts paused.
    bool public borrowingPaused = true;
    /// @notice Price liquidation always starts paused; contractual expiry never pauses.
    bool public liquidationPaused = true;
    /// @notice Invalidates queued resumptions after every new incident pause/configuration change.
    uint256 public pauseNonce;

    error InvalidAddress();
    error InvalidConfiguration();
    error InvalidTerms();
    error InvalidOffer();
    error InvalidLoan();
    error Unauthorized();
    error ZeroAmount();
    error InsufficientAvailable();
    error FeeExemptionRequired();
    error ReceiptMismatch(uint256 expected, uint256 received);
    error InsufficientReceipt(uint256 required, uint256 received);
    error InvalidOracle();
    error Paused();
    error CapExceeded();
    error QuoteRejected();
    error LoanSettled();
    error ExpiryBoundary();
    error NotExpired();
    error NotLiquidatable();
    error InvalidAction();
    error ActionNotReady();
    error ReceiverNotConfirmed();
    error NothingToClaim();
    error ETHTransferFailed();
    error RenunciationDisabled();

    /// @notice Exact bounded governance action queued; expiresAt=0 means no time expiry.
    event ActionQueued(bytes32 indexed id, bytes data, uint256 eta, uint256 expiresAt);
    /// @notice Queued operation cancelled or consumed; executed distinguishes the two.
    event ActionRemoved(bytes32 indexed id, bool executed);
    /// @notice Prospective policy stored; full data is also available through getConfiguration.
    event ConfigurationChanged(uint256 indexed oldId, uint256 indexed newId, Configuration configuration);
    /// @notice Immediate pause/resume, including invalidation nonce and authority.
    event PauseChanged(address indexed caller, bool borrowing, bool liquidation, uint256 nonce);
    /// @notice Guardian nomination/replacement; no authority is conferred.
    event GuardianNominated(address indexed oldPending, address indexed newPending);
    /// @notice Candidate accepted pause authority and cleared the nomination.
    event GuardianAccepted(address indexed oldGuardian, address indexed newGuardian);
    /// @notice Pending owner explicitly cancelled without changing the incumbent.
    event OwnershipNominationCancelled(address indexed candidate);
    /// @notice Fee beneficiary proved the ability to call the vault.
    event ReceiverConfirmed(address indexed receiver);
    /// @notice Fixed lender terms and actual principal funding.
    event OfferCreated(uint256 indexed offerId, address indexed lender, uint256 received, uint256 rateBps, uint256 minTerm, uint256 maxTerm);
    /// @notice Actual exact incoming IFR credited to an existing offer, including reopening.
    event OfferFunded(uint256 indexed offerId, uint256 received);
    /// @notice Gross principal debited and actual recipient IFR credit (tax is the difference).
    event OfferWithdrawn(uint256 indexed offerId, address indexed destination, uint256 gross, uint256 received);
    /// @notice Accepted quote and immutable non-recourse payoff; IFR received is measured.
    event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 indexed offerId, uint256 principal, uint256 received, uint256 collateral, uint256 defaultETH, uint256 policyId);
    /// @notice Additional collateral does not change the default commitment.
    event CollateralAdded(uint256 indexed loanId, uint256 added, uint256 collateral);
    /// @notice A paid terminal settlement; no beneficiary is called.
    event LoanPaid(uint256 indexed loanId, Status status, address indexed payer, uint256 debt, uint256 received, uint256 lenderInterest, uint256 protocolInterest);
    /// @notice Loss recognition and complete ETH partition; no IFR interest is fabricated.
    event LoanDefaulted(uint256 indexed loanId, uint256 principalLoss, uint256 lenderETH, uint256 borrowerETH);
    /// @notice Beneficiary-specific claimable balance increased; asset is IFR or zero for ETH.
    event CreditAdded(address indexed beneficiary, address indexed asset, uint256 amount);
    /// @notice Gross claim consumed and actual destination receipt; WETH indicates wrapped payout.
    event Claimed(address indexed beneficiary, address indexed destination, address indexed asset, uint256 gross, uint256 received);

    /// @notice Bind manifest assets and explicit governance owner; all activity starts disabled.
    /// @param token Nine-decimal IFR with feeExempt(address).
    /// @param wrappedETH Canonical 18-decimal WETH, trusted to wrap ETH one-for-one.
    /// @param canonicalFactory Canonical Uniswap V2 factory; cannot be replaced.
    /// @param governance Approved two-step controller (test EOAs do not establish production readiness).
    constructor(address token, address wrappedETH, address canonicalFactory, address governance) Ownable(governance) {
        if (token.code.length == 0 || wrappedETH.code.length == 0 || canonicalFactory.code.length == 0 || token == wrappedETH) revert InvalidAddress();
        if (IERC20Metadata(token).decimals() != 9 || IERC20Metadata(wrappedETH).decimals() != 18) revert InvalidConfiguration();
        ifrToken = ILendingV2IFR(token);
        weth = ILendingV2WETH(wrappedETH);
        factory = canonicalFactory;
    }

    /// @notice Nominate a nonzero pending owner; incumbent alone retains authority until acceptance.
    function transferOwnership(address nominee) public override onlyOwner {
        if (nominee == address(0) || nominee == address(this)) revert InvalidAddress();
        super.transferOwnership(nominee);
    }

    /// @notice Explicitly cancel a pending owner nomination; does not remove the current owner.
    function cancelOwnershipTransfer() external onlyOwner {
        address candidate = pendingOwner();
        if (candidate == address(0)) revert InvalidAddress();
        super.transferOwnership(address(0));
        emit OwnershipNominationCancelled(candidate);
    }

    /// @notice Renunciation is disabled, conservatively including periods without balances.
    function renounceOwnership() public view override onlyOwner { revert RenunciationDisabled(); }

    /// @notice Queue only configuration, guardian nomination or resumption calldata for >=48 hours.
    /// @param data Exact ABI calldata, visible in the event; no arbitrary-call execution exists.
    function queueAction(bytes calldata data) external onlyOwner {
        if (data.length < 4) revert InvalidAction();
        bytes4 selector = bytes4(data[:4]);
        if (selector != this.setConfiguration.selector && selector != this.nominateGuardian.selector && selector != this.resume.selector) revert InvalidAction();
        bytes32 id = keccak256(data);
        uint256 eta = block.timestamp + GOVERNANCE_DELAY;
        actionETA[id] = eta;
        emit ActionQueued(id, data, eta, 0);
    }

    /// @notice Owner cancels an exact pending action. Guardian cannot change configuration.
    function cancelAction(bytes32 id) external onlyOwner {
        if (actionETA[id] == 0) revert InvalidAction();
        delete actionETA[id];
        emit ActionRemoved(id, false);
    }

    /// @notice Apply queued, bounded future-loan policy and pause origination for explicit resumption.
    /// @param config All ceilings are <= proposed pilot maxima; zero caps disable borrowing.
    function setConfiguration(Configuration calldata config) external onlyOwner nonReentrant {
        _consumeAction();
        _validateConfiguration(config);
        uint256 oldId = policyId;
        policyId = oldId + 1;
        _policies[policyId] = config;
        borrowingPaused = true;
        pauseNonce++;
        emit ConfigurationChanged(oldId, policyId, config);
        emit PauseChanged(msg.sender, borrowingPaused, liquidationPaused, pauseNonce);
    }

    /// @notice Record beneficiary acceptance. Call through the actual controller when beneficiary is a contract.
    function confirmFeeReceiver() external {
        receiverConfirmed[msg.sender] = true;
        emit ReceiverConfirmed(msg.sender);
    }

    /// @notice Nominate a contract pause controller through exact queued calldata; acceptance is separate.
    /// @dev Candidate must follow Ownable2Step; code presence alone does not prove that semantic property.
    function nominateGuardian(address candidate) external onlyOwner {
        _consumeAction();
        if (candidate.code.length == 0 || candidate == address(this) || candidate == address(ifrToken) || candidate == address(weth)) revert InvalidAddress();
        emit GuardianNominated(pendingGuardian, candidate);
        pendingGuardian = candidate;
    }

    /// @notice Cancel an unaccepted guardian candidate, retaining the incumbent pause controller.
    function cancelGuardianNomination() external onlyOwner {
        if (pendingGuardian == address(0)) revert InvalidAddress();
        emit GuardianNominated(pendingGuardian, address(0));
        pendingGuardian = address(0);
    }

    /// @notice Only the pending controller can accept pause authority; no new fund rights are created.
    function acceptGuardian() external {
        if (msg.sender != pendingGuardian) revert Unauthorized();
        emit GuardianAccepted(guardian, msg.sender);
        guardian = msg.sender;
        pendingGuardian = address(0);
    }

    /// @notice Owner or accepted guardian immediately pauses selected price actions and invalidates resumptions.
    function pause(bool borrowPause, bool liquidatePause) external {
        if (msg.sender != owner() && msg.sender != guardian) revert Unauthorized();
        if (!borrowPause && !liquidatePause) revert InvalidAction();
        if (borrowPause) borrowingPaused = true;
        if (liquidatePause) liquidationPaused = true;
        pauseNonce++;
        emit PauseChanged(msg.sender, borrowingPaused, liquidationPaused, pauseNonce);
    }

    /// @notice Execute a queued resumption after 48 hours and fresh on-chain checks; never refreshes history.
    /// @param incidentNonce Current pauseNonce; any intervening pause/configuration invalidates this action.
    /// @param borrowResume Resume borrowing with nonzero budgets, confirmed receiver and exemption.
    /// @param liquidateResume Resume price liquidation; individual loans still validate their pinned policy.
    function resume(uint256 incidentNonce, bool borrowResume, bool liquidateResume) external onlyOwner nonReentrant {
        _consumeAction();
        if (incidentNonce != pauseNonce || (!borrowResume && !liquidateResume)) revert InvalidAction();
        Configuration storage config = _policies[policyId];
        _readOracle(config);
        if (borrowResume) {
            _requireFeeExemption();
            _requireBudgets(config);
            if (!receiverConfirmed[config.feeReceiver]) revert ReceiverNotConfirmed();
            borrowingPaused = false;
        }
        if (liquidateResume) liquidationPaused = false;
        emit PauseChanged(msg.sender, borrowingPaused, liquidationPaused, pauseNonce);
    }

    /// @notice Create fixed lender terms and fund exact net IFR; no automatic V1 migration.
    /// @param amount IFR base units to debit; must all arrive under fee exemption.
    /// @param rateBps Fixed noncompounding rate, 0..200 bps per 30 days.
    /// @param minTerm Minimum accepted term in seconds, 30..90 days.
    /// @param maxTerm Maximum accepted term in seconds, >=minTerm and <=90 days.
    /// @return offerId New independent offer ID; no stale one-offer index flags exist.
    function createOffer(uint256 amount, uint256 rateBps, uint256 minTerm, uint256 maxTerm) external nonReentrant returns (uint256 offerId) {
        if (rateBps > MAX_RATE_BPS || minTerm < MIN_TERM || maxTerm > MAX_TERM || minTerm > maxTerm) revert InvalidTerms();
        if (amount == 0) revert ZeroAmount();
        _requireFeeExemption();
        offerId = _offers.length;
        _offers.push(Offer(msg.sender, amount, 0, rateBps, minTerm, maxTerm, 0));
        totalAvailable += amount;
        _receiveExact(msg.sender, amount);
        emit OfferCreated(offerId, msg.sender, amount, rateBps, minTerm, maxTerm);
    }

    /// @notice Lender adds exact IFR to its offer, including a fully withdrawn/settled offer.
    function fundOffer(uint256 offerId, uint256 amount) external nonReentrant {
        Offer storage offer = _offer(offerId);
        if (msg.sender != offer.lender) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();
        _requireFeeExemption();
        offer.available += amount;
        totalAvailable += amount;
        _receiveExact(msg.sender, amount);
        emit OfferFunded(offerId, amount);
    }

    /// @notice Lender withdraws only available principal, even during pauses/outages/tax revocation.
    /// @param destination Lender-authorized nonzero recipient; gross debit and measured tax are disclosed.
    function withdrawOffer(uint256 offerId, uint256 amount, address destination) external nonReentrant {
        Offer storage offer = _offer(offerId);
        if (msg.sender != offer.lender) revert Unauthorized();
        _checkDestination(destination);
        if (amount == 0) revert ZeroAmount();
        if (amount > offer.available) revert InsufficientAvailable();
        offer.available -= amount;
        totalAvailable -= amount;
        uint256 received = _sendIFR(destination, amount);
        emit OfferWithdrawn(offerId, destination, amount, received);
    }

    /// @notice Debt-inclusive collateral/default quote using validated max(slow,fast), rounded up.
    /// @return required Required ETH collateral, wei; equality is accepted.
    /// @return defaultETH Immutable contractual default commitment at required collateral, wei.
    /// @return maxDebt IFR maximum principal plus term interest, base units.
    function quote(uint256 offerId, uint256 principal, uint256 term) external view returns (uint256 required, uint256 defaultETH, uint256 maxDebt) {
        Offer storage offer = _offer(offerId);
        _checkTerms(offer, principal, term);
        (uint256 price,,) = _readOracle(_policies[policyId]);
        return _quote(principal, offer.rateBps, term, price);
    }

    /// @notice Originate an exact-IFR, non-recourse loan; every cap and oracle check is atomic.
    /// @param request Borrower limits; deadline is nonexpired and at most one hour ahead.
    /// @return loanId Immutable accepted loan ID, with all msg.value held as its collateral.
    function borrow(BorrowRequest calldata request) external payable nonReentrant returns (uint256 loanId) {
        if (borrowingPaused) revert Paused();
        _requireFeeExemption();
        Offer storage offer = _offer(request.offerId);
        _checkTerms(offer, request.principal, request.term);
        if (msg.sender == offer.lender) revert Unauthorized();
        if (request.deadline < block.timestamp || request.deadline > block.timestamp + 1 hours || request.minReceived == 0 || request.minReceived > request.principal || offer.rateBps > request.maxRateBps) revert QuoteRejected();
        if (offer.available < request.principal) revert InsufficientAvailable();
        Configuration storage config = _policies[policyId];
        if (!receiverConfirmed[config.feeReceiver]) revert ReceiverNotConfirmed();
        (uint256 price,,uint256 depth) = _readOracle(config);
        (uint256 required, uint256 defaultETH,) = _quote(request.principal, offer.rateBps, request.term, price);
        if (required > request.maxCollateral || msg.value < required || msg.value > request.maxCollateral) revert QuoteRejected();
        _checkCaps(config, offer, request.principal, defaultETH, depth);

        offer.available -= request.principal;
        offer.lent += request.principal;
        totalAvailable -= request.principal;
        totalLent += request.principal;
        borrowerPrincipal[msg.sender] += request.principal;
        activeLoanCount[msg.sender]++;
        totalCollateral += msg.value;
        totalDefaultExposure += defaultETH;
        _recordOrigination(request.principal);
        loanId = _loans.length;
        _loans.push(Loan(msg.sender, request.offerId, request.principal, msg.value, block.timestamp, request.term, offer.rateBps, policyId, defaultETH, Status.Active));
        uint256 received = _sendIFR(msg.sender, request.principal);
        if (received != request.principal) revert ReceiptMismatch(request.principal, received);
        emit LoanCreated(loanId, msg.sender, request.offerId, request.principal, received, msg.value, defaultETH, policyId);
    }

    /// @notice Borrower repays before exact expiry, including grace/pause/outage; never calls the oracle.
    /// @param grossAmount Explicit maximum IFR debit authorized by payer; net must cover current debt.
    /// Received excess is the payer's IFR credit. No gross-up policy is silently inferred.
    function repay(uint256 loanId, uint256 grossAmount) external nonReentrant {
        Loan storage loan = _activeLoan(loanId);
        if (msg.sender != loan.borrower) revert Unauthorized();
        _beforeExpiry(loan);
        uint256 debt = _debt(loan);
        _paidSettlement(loanId, loan, debt, grossAmount, Status.Repaid, 0);
    }

    /// @notice Borrower adds collateral throughout active state, including outages and expiry readiness.
    function topUpCollateral(uint256 loanId) external payable nonReentrant {
        Loan storage loan = _activeLoan(loanId);
        if (msg.sender != loan.borrower) revert Unauthorized();
        if (msg.value == 0) revert ZeroAmount();
        loan.collateral += msg.value;
        totalCollateral += msg.value;
        emit CollateralAdded(loanId, msg.value, loan.collateral);
    }

    /// @notice Full debt payment by caller is mandatory; no price liquidation from exact expiry onward.
    /// @param grossAmount Explicit IFR debit bound; excess net IFR belongs to liquidator.
    function liquidate(uint256 loanId, uint256 grossAmount) external nonReentrant {
        if (liquidationPaused) revert Paused();
        Loan storage loan = _activeLoan(loanId);
        _beforeExpiry(loan);
        (,uint256 price,) = _readOracle(_policies[loan.policyId]);
        uint256 debt = _debt(loan);
        uint256 value = _value(debt, price);
        if (value < Math.mulDiv(loan.collateral, LIQUIDATION_LTV_BPS, BPS, Math.Rounding.Ceil)) revert NotLiquidatable();
        uint256 payout = Math.min(loan.collateral, Math.mulDiv(value, BPS + BONUS_BPS, BPS, Math.Rounding.Ceil));
        _paidSettlement(loanId, loan, debt, grossAmount, Status.Liquidated, payout);
    }

    /// @notice Any caller recognizes default from exact due+grace, without token/oracle/recipient calls.
    function expire(uint256 loanId) external nonReentrant {
        Loan storage loan = _activeLoan(loanId);
        if (block.timestamp < loan.start + loan.term + GRACE) revert NotExpired();
        uint256 collateral = loan.collateral;
        uint256 lenderETH = Math.min(collateral, loan.defaultETH);
        _close(loan, Status.Defaulted);
        _offers[loan.offerId].losses += loan.principal;
        totalLosses += loan.principal;
        _creditETH(_offers[loan.offerId].lender, lenderETH);
        _creditETH(loan.borrower, collateral - lenderETH);
        emit LoanDefaulted(loanId, loan.principal, lenderETH, collateral - lenderETH);
    }

    /// @notice Credit holder alone chooses a destination; failed ETH claims restore credit atomically.
    /// @param asWETH Wrap one-for-one and transfer WETH instead of calling an ETH-rejecting destination.
    function claimETH(address destination, bool asWETH) external nonReentrant {
        _checkDestination(destination);
        uint256 amount = ethCredits[msg.sender];
        if (amount == 0) revert NothingToClaim();
        ethCredits[msg.sender] = 0;
        totalETHCredits -= amount;
        if (asWETH) {
            uint256 beforeVault = weth.balanceOf(address(this));
            weth.deposit{value: amount}();
            uint256 wrapped = weth.balanceOf(address(this)) - beforeVault;
            if (wrapped != amount) revert ReceiptMismatch(amount, wrapped);
            uint256 beforeRecipient = weth.balanceOf(destination);
            IERC20(address(weth)).safeTransfer(destination, amount);
            uint256 received = weth.balanceOf(destination) - beforeRecipient;
            if (received != amount || weth.balanceOf(address(this)) != beforeVault) revert ReceiptMismatch(amount, received);
        } else {
            (bool ok,) = payable(destination).call{value: amount}("");
            if (!ok) revert ETHTransferFailed();
        }
        emit Claimed(msg.sender, destination, asWETH ? address(weth) : address(0), amount, amount);
    }

    /// @notice Credit holder claims gross IFR entitlement; recipient tax is measured, never subsidized.
    function claimIFR(address destination) external nonReentrant {
        _checkDestination(destination);
        uint256 amount = ifrCredits[msg.sender];
        if (amount == 0) revert NothingToClaim();
        ifrCredits[msg.sender] = 0;
        totalIFRCredits -= amount;
        uint256 received = _sendIFR(destination, amount);
        emit Claimed(msg.sender, destination, address(ifrToken), amount, received);
    }

    /// @notice Get immutable future-loan policy snapshots; index zero is unconfigured/zero.
    function getConfiguration(uint256 id) external view returns (Configuration memory) { return _policies[id]; }
    /// @notice Read fixed offer terms, balances and recognized losses; invalid IDs revert.
    function getOffer(uint256 id) external view returns (Offer memory) { return _offer(id); }
    /// @notice Read immutable loan terms and current settlement state; invalid IDs revert.
    function getLoan(uint256 id) external view returns (Loan memory) { return _loan(id); }
    /// @notice Number of independent offers, including exhausted offers that may be refilled.
    function getOfferCount() external view returns (uint256) { return _offers.length; }
    /// @notice Lifetime loan count, including settled loans.
    function getLoanCount() external view returns (uint256) { return _loans.length; }
    /// @notice Debt in IFR base units, rounded up per second and frozen at maturity; no oracle call.
    function debtOf(uint256 id) external view returns (uint256) { return _debt(_loan(id)); }
    /// @notice Active-loan warning/liquidation status using min(slow,fast) and accrued interest.
    function health(uint256 id) external view returns (uint256 debtValueWei, bool warning, bool liquidatable) {
        Loan storage loan = _activeLoan(id);
        (,uint256 price,) = _readOracle(_policies[loan.policyId]);
        debtValueWei = _value(_debt(loan), price);
        warning = debtValueWei >= Math.mulDiv(loan.collateral, WARNING_LTV_BPS, BPS, Math.Rounding.Ceil);
        liquidatable = debtValueWei >= Math.mulDiv(loan.collateral, LIQUIDATION_LTV_BPS, BPS, Math.Rounding.Ceil);
    }

    /// @notice Exact rolling 24-hour gross principal; repayments never replenish it. O(log lifetime entries).
    function rollingOriginations() public view returns (uint256) {
        uint256 count = _originations.length;
        if (count == 0) return 0;
        uint256 cutoff = block.timestamp > 1 days ? block.timestamp - 1 days : 0;
        uint256 lo;
        uint256 hi = count;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (_originations[mid].timestamp <= cutoff) lo = mid + 1;
            else hi = mid;
        }
        return _originations[count - 1].cumulative - (lo == 0 ? 0 : _originations[lo - 1].cumulative);
    }

    function _consumeAction() private {
        bytes32 id = keccak256(msg.data);
        uint256 eta = actionETA[id];
        if (eta == 0 || block.timestamp < eta) revert ActionNotReady();
        delete actionETA[id];
        emit ActionRemoved(id, true);
    }

    function _validateConfiguration(Configuration calldata c) private view {
        if (c.adapter.code.length == 0 || c.feeReceiver == address(0) || c.feeReceiver == address(this) || c.feeReceiver == address(ifrToken)) revert InvalidAddress();
        if (c.oracleVersion == 0 || c.minPrice == 0 || c.maxPrice < c.minPrice || c.maxPrice > type(uint128).max || c.minIfrDepth == 0 || c.minIfrDepth > type(uint112).max ||
            c.totalCap > 100_000 * IFR_UNIT || c.loanCap > 10_000 * IFR_UNIT || c.borrowerCap > 20_000 * IFR_UNIT || c.offerCap > 25_000 * IFR_UNIT || c.dailyCap > 25_000 * IFR_UNIT || c.ethCap > 0.5 ether || c.economicCap > 0.5 ether) revert InvalidConfiguration();
        ILendingV2Oracle a = ILendingV2Oracle(c.adapter);
        if (a.ifrToken() != address(ifrToken) || a.weth() != address(weth) || a.factory() != factory) revert InvalidConfiguration();
        address pair = IUniswapV2FactoryPair(factory).getPair(address(ifrToken), address(weth));
        if (pair.code.length == 0 || a.pair() != pair) revert InvalidConfiguration();
        address t0 = IUniswapV2PairTwap(pair).token0();
        address t1 = IUniswapV2PairTwap(pair).token1();
        if (!((t0 == address(ifrToken) && t1 == address(weth)) || (t1 == address(ifrToken) && t0 == address(weth)))) revert InvalidConfiguration();
    }

    function _readOracle(Configuration storage c) private view returns (uint256 borrowPrice, uint256 healthPrice, uint256 depth) {
        if (c.adapter == address(0)) revert InvalidOracle();
        ILendingV2Oracle.Evidence memory e;
        try ILendingV2Oracle(c.adapter).read(c.oracleVersion) returns (ILendingV2Oracle.Evidence memory evidence) { e = evidence; }
        catch { revert InvalidOracle(); }
        if (e.reason != 0 || e.version != c.oracleVersion || e.slowPrice < c.minPrice || e.slowPrice > c.maxPrice || e.fastPrice < c.minPrice || e.fastPrice > c.maxPrice ||
            e.slowStart == 0 || e.fastStart == 0 || e.slowEnd <= e.slowStart || e.fastEnd <= e.fastStart || e.slowEnd > block.timestamp || e.fastEnd > block.timestamp ||
            e.slowEnd - e.slowStart < 7 days || block.timestamp - e.slowStart > 7 days + 1 hours || e.fastEnd - e.fastStart < 30 minutes || e.fastEnd - e.fastStart > 1 hours ||
            block.timestamp - e.slowEnd > 1 hours || block.timestamp - e.fastEnd > 1 hours || e.latestObservation < Math.max(e.slowEnd, e.fastEnd) || e.latestObservation > block.timestamp || block.timestamp - e.latestObservation > 1 hours ||
            e.maxGap == 0 || e.maxGap > 1 hours || e.fastMaxGap == 0 || e.fastMaxGap > 30 minutes || e.minWethDepth < 50 ether || e.minIfrDepth < c.minIfrDepth) revert InvalidOracle();
        // Exact cross-product: |fast-slow| <=20% of slow (floor avoids permissive ceil).
        uint256 difference = e.fastPrice > e.slowPrice ? e.fastPrice - e.slowPrice : e.slowPrice - e.fastPrice;
        if (difference > Math.mulDiv(e.slowPrice, 2_000, BPS)) revert InvalidOracle();
        return (Math.max(e.slowPrice, e.fastPrice), Math.min(e.slowPrice, e.fastPrice), e.minWethDepth);
    }

    function _requireBudgets(Configuration storage c) private view {
        if (c.totalCap == 0 || c.loanCap == 0 || c.borrowerCap == 0 || c.offerCap == 0 || c.dailyCap == 0 || c.ethCap == 0 || c.economicCap == 0) revert CapExceeded();
    }

    function _checkCaps(Configuration storage c, Offer storage offer, uint256 amount, uint256 defaultETH, uint256 depth) private view {
        _requireBudgets(c);
        uint256 nextLent = totalLent + amount;
        uint256 exposureCap = Math.min(Math.min(c.ethCap, c.economicCap), depth / 100);
        if (amount > c.loanCap || nextLent > c.totalCap || nextLent > (totalAvailable + totalLent) / 10 ||
            borrowerPrincipal[msg.sender] + amount > c.borrowerCap || offer.lent + amount > c.offerCap ||
            activeLoanCount[msg.sender] >= 2 || rollingOriginations() + amount > c.dailyCap || totalDefaultExposure + defaultETH > exposureCap) revert CapExceeded();
    }

    function _checkTerms(Offer storage offer, uint256 amount, uint256 term) private view {
        if (amount == 0) revert ZeroAmount();
        if (term < offer.minTerm || term > offer.maxTerm) revert InvalidTerms();
    }

    function _quote(uint256 amount, uint256 rate, uint256 term, uint256 price) private pure returns (uint256 required, uint256 defaultETH, uint256 maxDebt) {
        maxDebt = amount + _interest(amount, rate, term);
        uint256 value = _value(maxDebt, price);
        required = Math.mulDiv(value, BPS, INITIAL_LTV_BPS, Math.Rounding.Ceil);
        // Always <=required at the fixed 30% initial LTV; additional collateral never increases it.
        defaultETH = Math.min(required, Math.mulDiv(value, DEFAULT_BPS, BPS, Math.Rounding.Ceil));
    }

    function _interest(uint256 principal, uint256 rate, uint256 elapsed) private pure returns (uint256) {
        return Math.mulDiv(principal, rate * elapsed, BPS * 30 days, Math.Rounding.Ceil);
    }

    function _value(uint256 amount, uint256 price) private pure returns (uint256) {
        return Math.mulDiv(amount, price, IFR_UNIT, Math.Rounding.Ceil);
    }

    function _debt(Loan storage loan) private view returns (uint256) {
        uint256 elapsed = block.timestamp > loan.start ? Math.min(block.timestamp - loan.start, loan.term) : 0;
        return loan.principal + _interest(loan.principal, loan.rateBps, elapsed);
    }

    function _paidSettlement(uint256 id, Loan storage loan, uint256 debt, uint256 gross, Status status, uint256 liquidatorETH) private {
        if (gross < debt) revert InsufficientReceipt(debt, gross);
        uint256 collateral = loan.collateral;
        _close(loan, status);
        Offer storage offer = _offers[loan.offerId];
        offer.available += loan.principal;
        totalAvailable += loan.principal;
        uint256 interest = debt - loan.principal;
        uint256 lenderInterest = interest / 2;
        uint256 protocolInterest = interest - lenderInterest;
        _creditIFR(offer.lender, lenderInterest);
        _creditIFR(_policies[loan.policyId].feeReceiver, protocolInterest);
        _creditETH(msg.sender, liquidatorETH);
        _creditETH(loan.borrower, collateral - liquidatorETH);
        // All effects precede token interaction; rollback restores them on failed/short receipt.
        uint256 received = _receiveIFR(msg.sender, gross);
        if (received < debt) revert InsufficientReceipt(debt, received);
        _creditIFR(msg.sender, received - debt);
        emit LoanPaid(id, status, msg.sender, debt, received, lenderInterest, protocolInterest);
    }

    function _close(Loan storage loan, Status status) private {
        loan.status = status;
        totalCollateral -= loan.collateral;
        loan.collateral = 0;
        totalDefaultExposure -= loan.defaultETH;
        _offers[loan.offerId].lent -= loan.principal;
        totalLent -= loan.principal;
        borrowerPrincipal[loan.borrower] -= loan.principal;
        activeLoanCount[loan.borrower]--;
    }

    function _recordOrigination(uint256 amount) private {
        uint256 count = _originations.length;
        uint256 cumulative = (count == 0 ? 0 : _originations[count - 1].cumulative) + amount;
        if (count > 0 && _originations[count - 1].timestamp == block.timestamp) _originations[count - 1].cumulative = cumulative;
        else _originations.push(Origination(block.timestamp, cumulative));
    }

    function _creditIFR(address beneficiary, uint256 amount) private {
        if (amount == 0) return;
        ifrCredits[beneficiary] += amount;
        totalIFRCredits += amount;
        emit CreditAdded(beneficiary, address(ifrToken), amount);
    }

    function _creditETH(address beneficiary, uint256 amount) private {
        if (amount == 0) return;
        ethCredits[beneficiary] += amount;
        totalETHCredits += amount;
        emit CreditAdded(beneficiary, address(0), amount);
    }

    function _requireFeeExemption() private view {
        try ifrToken.feeExempt(address(this)) returns (bool exempt) { if (!exempt) revert FeeExemptionRequired(); }
        catch { revert FeeExemptionRequired(); }
    }

    function _receiveExact(address payer, uint256 amount) private {
        uint256 received = _receiveIFR(payer, amount);
        if (received != amount) revert ReceiptMismatch(amount, received);
    }

    function _receiveIFR(address payer, uint256 amount) private returns (uint256 received) {
        uint256 beforeBalance = ifrToken.balanceOf(address(this));
        IERC20(address(ifrToken)).safeTransferFrom(payer, address(this), amount);
        received = ifrToken.balanceOf(address(this)) - beforeBalance;
    }

    function _sendIFR(address destination, uint256 amount) private returns (uint256 received) {
        uint256 beforeVault = ifrToken.balanceOf(address(this));
        uint256 beforeRecipient = ifrToken.balanceOf(destination);
        IERC20(address(ifrToken)).safeTransfer(destination, amount);
        received = ifrToken.balanceOf(destination) - beforeRecipient;
        uint256 debit = beforeVault - ifrToken.balanceOf(address(this));
        if (debit != amount || received > amount) revert ReceiptMismatch(amount, received);
    }

    function _checkDestination(address destination) private view {
        if (destination == address(0) || destination == address(this)) revert InvalidAddress();
    }

    function _beforeExpiry(Loan storage loan) private view {
        if (block.timestamp >= loan.start + loan.term + GRACE) revert ExpiryBoundary();
    }

    function _offer(uint256 id) private view returns (Offer storage) {
        if (id >= _offers.length) revert InvalidOffer();
        return _offers[id];
    }

    function _loan(uint256 id) private view returns (Loan storage) {
        if (id >= _loans.length) revert InvalidLoan();
        return _loans[id];
    }

    function _activeLoan(uint256 id) private view returns (Loan storage loan) {
        loan = _loan(id);
        if (loan.status != Status.Active) revert LoanSettled();
    }
}
