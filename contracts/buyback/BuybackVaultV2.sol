// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IBuybackV2Pair {
    /// @notice Canonical pair's first immutable token.
    function token0() external view returns (address);
    /// @notice Canonical pair's second immutable token.
    function token1() external view returns (address);
    /// @notice Stored raw reserves and the last update timestamp modulo 2^32.
    function getReserves() external view returns (uint112, uint112, uint32);
    /// @notice Cumulative token1/token0 price, with Uniswap's modulo 2^256 arithmetic.
    function price0CumulativeLast() external view returns (uint256);
    /// @notice Cumulative token0/token1 price, with Uniswap's modulo 2^256 arithmetic.
    function price1CumulativeLast() external view returns (uint256);
}

interface IBuybackV2Factory {
    /// @notice Canonical factory registration for the two approved assets.
    function getPair(address, address) external view returns (address);
}

interface IBuybackV2Router {
    /// @notice Router's immutable wrapped-native asset identity.
    function WETH() external view returns (address);
    /// @notice Router's canonical factory identity.
    function factory() external view returns (address);
    /// @notice Exact-input swap enforcing the recipient's net output minimum and caller's absolute deadline.
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 minOut, address[] calldata path, address to, uint256 deadline
    ) external payable;
}

interface IBuybackV2Reserve {
    /// @notice Reserve's immutable IFR asset identity; receipt is distinct from later supply burning.
    function token() external view returns (address);
}

/// @title BuybackVaultV2 - local hardening draft, not deployed or Council-ratified
/// @notice Governance spends an exact ETH amount, splitting only net IFR received into reserve/treasury credits.
/// @dev Owner must be an independently reviewed timelock; this child cannot verify a proposal's ETA/expiry.
///      Treasury Safe starts as owner and must hand over using Ownable2Step. Guardian can only pause.
///      One constructor-pinned router is the complete allowlist. Code hashes are review inputs, not proof of trust;
///      canonical factory/pair/WETH identities and non-proxy implementations require independent review.
///      There is no LP, approval, withdrawal, sweep or arbitrary-call path. F01's approval surface is absent:
///      do not introduce forceApprove without a separate LP/recovery design and atomic cleanup tests.
///      The pair's cumulative IFR/WETH price is averaged over completed observations, never router quotes.
///      Counterfactual accrual uses the old reserves and Uniswap's uint32/uint256 wrap semantics. A same-block
///      pool move cannot rewrite elapsed price history. Execution also checks current depth, spot deviation,
///      observation age and trade size. This does not prevent sustained multi-block TWAP manipulation.
///      Deployment risk limits are explicit review inputs; no production liquidity/budget values are implied.
///      Gross TWAP less slippage bounds NET receipt, so taxes, AMM fees and price impact share that allowance.
///      Draft choices requiring Council ratification: at least one-hour observations, at most seven-day oracle
///      age/budget windows, at most one-day deadline window, and a per-leg net-credit bound using slippageBps.
///      Unlike the spec's optional router rotation, this draft requires replacement to change market identity.
contract BuybackVaultV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Immutable deployment identities; hashes must come from independently reviewed runtime code.
    struct Deployment {
        address token;
        address burnReserve;
        address treasury;
        address router;
        address factory;
        address pair;
        address weth;
        address guardian;
        address initialOwner;
        bytes32 routerCodeHash;
        bytes32 pairCodeHash;
    }

    /// @notice Constructor-fixed ceilings/floors. Amounts are wei; times are seconds; ratios are basis points.
    /// @dev No setter can enlarge these. Council must choose them from liquidity and oracle evidence before deployment.
    struct RiskLimits {
        uint256 rollingBudget;
        uint256 budgetWindow;
        uint256 minWethReserve;
        uint256 maxTradeBps;
        uint256 minOracleWindow;
        uint256 maxOracleWindow;
        uint256 maxOracleAge;
        uint256 maxDeviationBps;
        uint256 maxDeadlineWindow;
    }

    struct Spend { uint256 timestamp; uint256 cumulative; }

    /// @notice Basis-point denominator and maximum governance slippage, respectively.
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_SLIPPAGE_BPS = 1_000;
    /// @notice Assignment-specific minimum; zero bps would mean strict pricing, not a zero output floor.
    uint256 public constant MIN_SLIPPAGE_BPS = 1;
    /// @notice Minimum activation delay, independent of the explicit inactive/active state.
    uint256 public constant ACTIVATION_DELAY = 60 days;
    /// @notice Constructor-fixed IFR, reserve, reviewed router, pair and WETH identities.
    IERC20 public immutable token;
    address public immutable burnReserve;
    IBuybackV2Router public immutable router;
    IBuybackV2Pair public immutable pair;
    address public immutable weth;
    bool public immutable wethIsToken0;
    /// @notice Nonzero immutable per-execution ceiling in wei; later deposits cannot expand a queued spend.
    uint256 public immutable maxEthPerExecution;
    /// @notice Earliest possible activation timestamp; deployment and funding leave the vault inactive.
    uint256 public immutable activationTime;
    /// @notice Fixed deployment risk policy; there is deliberately no policy replacement setter.
    RiskLimits public riskLimits;
    /// @notice Governance-controlled distribution and pause identities.
    address public treasury;
    address public guardian;
    /// @notice Nominal reserve share (bps), execution cooldown (seconds), and combined net-output tolerance (bps).
    uint256 public burnShareBps = 5_000;
    uint256 public cooldown = 1 hours;
    uint256 public slippageBps = 500;
    /// @notice Minimum observation period in seconds, configurable within constructor-fixed bounds.
    uint256 public oracleWindow;
    /// @notice Observation baseline time in full-width Unix seconds.
    uint256 public observationAt;
    /// @notice Baseline Uniswap cumulative price (UQ112x112 IFR base units per wei times seconds, modulo 2^256).
    uint256 public observationCumulative;
    /// @notice Completed historical average, in UQ112x112 IFR base units per wei.
    uint256 public averagePriceX112;
    /// @notice Full-width timestamp and block of the most recent completed average.
    uint256 public oracleUpdatedAt;
    uint256 public oracleUpdatedBlock;
    /// @notice Successful execution timestamp and monotonically increasing reconciliation ID.
    uint256 public lastBuybackAt;
    uint256 public executionCount;
    /// @notice Separate opt-in activation and immediate pause states.
    bool public active;
    bool public paused;
    Spend[] private _spends;
    uint256 private constant Q112 = 2 ** 112;

    error InvalidAddress();
    error InvalidIdentity();
    error InvalidLimits();
    error InvalidParams();
    error InvalidOwnerNominee();
    error NoPendingOwnershipTransfer();
    error OwnershipRenunciationDisabled();
    error UnauthorizedGuardian();
    error NotActive();
    error VaultPaused();
    error CooldownNotElapsed();
    error InvalidDeadline();
    error InvalidAmount();
    error BudgetExceeded();
    error OracleNotReady();
    error ObservationTooShort();
    error InsufficientDepth();
    error SpotDeviation();
    error TradeTooLarge();
    error MinimumTooLow();
    error InsufficientReceipt();
    error InsufficientCredit();

    /// @notice ETH receipt never activates execution.
    event Deposited(address indexed sender, uint256 amount);
    /// @notice Full old/new configuration; router is immutable and cannot be silently replaced.
    event ParamsUpdated(uint256 oldBurnShare, uint256 newBurnShare, uint256 oldCooldown, uint256 newCooldown,
        uint256 oldSlippage, uint256 newSlippage, address oldTreasury, address newTreasury);
    /// @notice Governance replaced its pause-only guardian.
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    /// @notice Pause/resume authority is recorded separately.
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    /// @notice Explicit activation/deactivation, independent of pause state.
    event ActivationChanged(bool previous, bool current);
    /// @notice Window changes invalidate all cached observations and require a fresh warm-up.
    event OracleWindowUpdated(uint256 previous, uint256 current);
    /// @notice Baseline reset, including recovery from a stale observation.
    event ObservationStarted(uint256 timestamp, uint256 cumulative);
    /// @notice Completed historical average, its elapsed period and publication time.
    event OracleUpdated(uint256 averagePriceX112, uint256 elapsed, uint256 timestamp);
    /// @notice Explicit ownership nomination cancellation; OZ emits nomination/acceptance events.
    event OwnershipTransferCancelled(address indexed owner, address indexed previousNominee);
    /// @notice Reserve credits are deposits, not supply burns. Debits/credits use IFR's nine-decimal base units.
    event BuybackExecuted(uint256 indexed executionId, uint256 ethSpent, uint256 received,
        address indexed burnRecipient, address indexed treasuryRecipient, uint256 burnDebit,
        uint256 treasuryDebit, uint256 burnCredit, uint256 treasuryCredit);

    /// @notice Deploy an inactive draft with a single reviewed router and immutable risk envelope.
    /// @param d Approved identities and independently checked runtime hashes.
    /// @param limits Constructor-fixed nonzero policy bounds; ratios at most 10%, times at most seven days.
    /// @param ethCeiling Maximum wei per call, no greater than the rolling budget.
    constructor(Deployment memory d, RiskLimits memory limits, uint256 ethCeiling) Ownable(d.initialOwner) {
        if (d.initialOwner == address(this)) revert OwnableInvalidOwner(d.initialOwner);
        if (d.token.code.length == 0 || d.burnReserve.code.length == 0 || d.router.code.length == 0 ||
            d.pair.code.length == 0 || d.factory.code.length == 0 || d.weth.code.length == 0 ||
            d.guardian == address(0) || d.guardian == address(this)) revert InvalidAddress();
        if (d.token == d.burnReserve || d.token == d.weth || d.token == d.router ||
            d.burnReserve == d.router || d.burnReserve == d.pair ||
            d.router.codehash != d.routerCodeHash || d.pair.codehash != d.pairCodeHash ||
            IERC20Metadata(d.token).decimals() != 9 || IBuybackV2Reserve(d.burnReserve).token() != d.token ||
            IBuybackV2Router(d.router).WETH() != d.weth || IBuybackV2Router(d.router).factory() != d.factory ||
            IBuybackV2Factory(d.factory).getPair(d.weth, d.token) != d.pair) revert InvalidIdentity();
        bool forward = IBuybackV2Pair(d.pair).token0() == d.weth;
        if ((forward ? IBuybackV2Pair(d.pair).token1() : IBuybackV2Pair(d.pair).token0()) != d.token ||
            (!forward && IBuybackV2Pair(d.pair).token1() != d.weth)) revert InvalidIdentity();
        if (ethCeiling == 0 || limits.rollingBudget < ethCeiling || limits.budgetWindow < 1 hours ||
            limits.budgetWindow > 7 days || limits.minWethReserve == 0 || limits.maxTradeBps == 0 ||
            limits.maxTradeBps > 1_000 || limits.minOracleWindow < 1 hours ||
            limits.maxOracleWindow < limits.minOracleWindow || limits.maxOracleAge < limits.maxOracleWindow ||
            limits.maxOracleAge > 7 days || limits.maxDeviationBps == 0 || limits.maxDeviationBps > 1_000 ||
            limits.maxDeadlineWindow == 0 || limits.maxDeadlineWindow > 1 days) revert InvalidLimits();
        token = IERC20(d.token);
        burnReserve = d.burnReserve;
        router = IBuybackV2Router(d.router);
        pair = IBuybackV2Pair(d.pair);
        weth = d.weth;
        wethIsToken0 = forward;
        maxEthPerExecution = ethCeiling;
        activationTime = block.timestamp + ACTIVATION_DELAY;
        riskLimits = limits;
        oracleWindow = limits.minOracleWindow;
        guardian = d.guardian;
        _validateTreasury(d.treasury);
        treasury = d.treasury;
        emit GuardianUpdated(address(0), d.guardian);
        emit ParamsUpdated(0, burnShareBps, 0, cooldown, 0, slippageBps, address(0), d.treasury);
    }

    /// @notice Permissionless historical observation; stale baselines restart instead of publishing stale prices.
    /// @dev A completed price cannot be consumed in its publication block. Thin/empty pair reads fail closed.
    function updateOracle() external nonReentrant {
        (uint256 cumulative,,) = _currentPrice();
        uint256 elapsed = block.timestamp - observationAt;
        if (observationAt == 0 || elapsed > riskLimits.maxOracleAge) {
            averagePriceX112 = 0;
            oracleUpdatedAt = 0;
            emit ObservationStarted(block.timestamp, cumulative);
        } else {
            if (elapsed < oracleWindow) revert ObservationTooShort();
            uint256 delta;
            unchecked { delta = cumulative - observationCumulative; }
            uint256 average = delta / elapsed;
            if (average == 0) revert OracleNotReady();
            averagePriceX112 = average;
            oracleUpdatedAt = block.timestamp;
            oracleUpdatedBlock = block.number;
            emit OracleUpdated(average, elapsed, block.timestamp);
        }
        observationAt = block.timestamp;
        observationCumulative = cumulative;
    }

    /// @notice Set a new observation window and discard the previous oracle, requiring a full warm-up.
    /// @param window Seconds within the fixed deployment interval.
    function setOracleWindow(uint256 window) external onlyOwner nonReentrant {
        if (window < riskLimits.minOracleWindow || window > riskLimits.maxOracleWindow) revert InvalidParams();
        emit OracleWindowUpdated(oracleWindow, window);
        oracleWindow = window;
        observationAt = 0;
        observationCumulative = 0;
        averagePriceX112 = 0;
        oracleUpdatedAt = 0;
    }

    /// @notice Owner explicitly activates after 60 days and current readiness, or deactivates immediately.
    /// @param enabled Desired activation state; funding and elapsed time never enable it implicitly.
    function setActive(bool enabled) external onlyOwner nonReentrant {
        if (enabled) {
            if (block.timestamp < activationTime) revert NotActive();
            if (paused) revert VaultPaused();
            _requireReady(0);
        }
        emit ActivationChanged(active, enabled);
        active = enabled;
    }

    /// @notice Guardian or governance can halt execution immediately; this grants no resume power to guardian.
    function pause() external nonReentrant {
        if (msg.sender != guardian && msg.sender != owner()) revert UnauthorizedGuardian();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Only governance can resume; it must separately activate if inactive.
    function unpause() external onlyOwner nonReentrant {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Governance replaces a lost pause key; it cannot use a zero address to disable the role.
    /// @param replacement New nonzero pause-only guardian.
    function setGuardian(address replacement) external onlyOwner nonReentrant {
        if (replacement == address(0) || replacement == address(this)) revert InvalidAddress();
        emit GuardianUpdated(guardian, replacement);
        guardian = replacement;
    }

    /// @notice Atomic bounded owner configuration. Router/asset/oracle risk envelope cannot be replaced.
    /// @param burnBps Nominal reserve share, from zero to 10,000 inclusive.
    /// @param delay Execution cooldown, from one hour to seven days inclusive.
    /// @param slippage Net-output tolerance, from one to 1,000 basis points inclusive.
    /// @param recipient Approved treasury destination, distinct from protocol custody/market contracts.
    function setParams(uint256 burnBps, uint256 delay, uint256 slippage, address recipient)
        external onlyOwner nonReentrant
    {
        if (burnBps > BPS || delay < 1 hours || delay > 7 days ||
            slippage < MIN_SLIPPAGE_BPS || slippage > MAX_SLIPPAGE_BPS) revert InvalidParams();
        _validateTreasury(recipient);
        emit ParamsUpdated(burnShareBps, burnBps, cooldown, delay, slippageBps, slippage, treasury, recipient);
        burnShareBps = burnBps;
        cooldown = delay;
        slippageBps = slippage;
        treasury = recipient;
    }

    /// @notice Governance executes exactly the queued wei/minimum/expiry, with atomic receipt/distribution checks.
    /// @param ethAmount Exact wei to spend, within the immutable trade and rolling caps.
    /// @param minReceived Positive NET IFR base-unit minimum, at least the independent TWAP floor.
    /// @param deadline Absolute timestamp, strictly after now and at most now plus the fixed deadline window.
    function executeBuyback(uint256 ethAmount, uint256 minReceived, uint256 deadline)
        external onlyOwner nonReentrant
    {
        if (!active || block.timestamp < activationTime) revert NotActive();
        if (paused) revert VaultPaused();
        if (block.timestamp < lastBuybackAt + cooldown) revert CooldownNotElapsed();
        if (deadline <= block.timestamp || deadline - block.timestamp > riskLimits.maxDeadlineWindow) revert InvalidDeadline();
        if (ethAmount == 0 || ethAmount > maxEthPerExecution || ethAmount > address(this).balance) revert InvalidAmount();
        uint256 floor = _requireReady(ethAmount);
        if (floor == 0 || minReceived == 0 || minReceived < floor) revert MinimumTooLow();
        if (spentInWindow() + ethAmount > riskLimits.rollingBudget) revert BudgetExceeded();
        uint256 count = _spends.length;
        _spends.push(Spend(block.timestamp, (count == 0 ? 0 : _spends[count - 1].cumulative) + ethAmount));
        lastBuybackAt = block.timestamp;
        uint256 id = ++executionCount;
        _distribute(id, ethAmount, _swap(ethAmount, minReceived, deadline));
    }

    /// @notice Exact wei spent in (now - budgetWindow, now], using a cumulative history and bounded binary search.
    /// @return amount Gross historical spend; subsequent deposits/refunds never replenish the rolling allowance.
    function spentInWindow() public view returns (uint256 amount) {
        uint256 count = _spends.length;
        if (count == 0) return 0;
        uint256 cutoff = block.timestamp > riskLimits.budgetWindow ? block.timestamp - riskLimits.budgetWindow : 0;
        uint256 lo;
        uint256 hi = count;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (_spends[mid].timestamp <= cutoff) lo = mid + 1;
            else hi = mid;
        }
        return _spends[count - 1].cumulative - (lo == 0 ? 0 : _spends[lo - 1].cumulative);
    }

    /// @notice Owner nominates/replaces a pending owner; only the candidate can accept.
    /// @param candidate Nonzero address other than this vault or the current owner.
    function transferOwnership(address candidate) public override onlyOwner nonReentrant {
        if (candidate == address(0) || candidate == address(this) || candidate == owner()) revert InvalidOwnerNominee();
        super.transferOwnership(candidate);
    }

    /// @notice Owner cancels nomination; the former nominee immediately loses acceptance rights.
    function cancelOwnershipTransfer() external onlyOwner nonReentrant {
        address candidate = pendingOwner();
        if (candidate == address(0)) revert NoPendingOwnershipTransfer();
        super.transferOwnership(address(0));
        emit OwnershipTransferCancelled(owner(), candidate);
    }

    /// @notice Only the current nominee accepts, including a governance contract executing its delayed call.
    function acceptOwnership() public override nonReentrant { super.acceptOwnership(); }

    /// @notice Renunciation is forbidden so configuration/resumption responsibilities cannot be abandoned.
    function renounceOwnership() public view override onlyOwner { revert OwnershipRenunciationDisabled(); }

    /// @notice Anyone may fund the inactive or paused vault; receiving ETH confers no execution rights.
    function depositETH() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Direct ETH receipts are reported and never activate spending.
    receive() external payable nonReentrant { emit Deposited(msg.sender, msg.value); }

    function _validateTreasury(address recipient) private view {
        if (recipient == address(0) || recipient == address(this) || recipient == address(token) ||
            recipient == burnReserve || recipient == address(router) || recipient == address(pair) ||
            recipient == weth) revert InvalidAddress();
    }

    function _currentPrice() private view returns (uint256 cumulative, uint256 spot, uint256 depth) {
        (uint112 r0, uint112 r1, uint32 timestamp) = pair.getReserves();
        uint256 tokenReserve = wethIsToken0 ? r1 : r0;
        depth = wethIsToken0 ? r0 : r1;
        if (depth < riskLimits.minWethReserve || tokenReserve == 0) revert InsufficientDepth();
        spot = (tokenReserve << 112) / depth;
        cumulative = wethIsToken0 ? pair.price0CumulativeLast() : pair.price1CumulativeLast();
        unchecked { cumulative += spot * (uint32(block.timestamp) - timestamp); }
    }

    function _requireReady(uint256 ethAmount) private view returns (uint256 floor) {
        if (averagePriceX112 == 0 || block.timestamp - oracleUpdatedAt > riskLimits.maxOracleAge ||
            oracleUpdatedBlock >= block.number) revert OracleNotReady();
        (, uint256 spot, uint256 depth) = _currentPrice();
        uint256 delta = spot > averagePriceX112 ? spot - averagePriceX112 : averagePriceX112 - spot;
        if (Math.mulDiv(delta, BPS, averagePriceX112, Math.Rounding.Ceil) > riskLimits.maxDeviationBps) revert SpotDeviation();
        if (ethAmount > Math.mulDiv(depth, riskLimits.maxTradeBps, BPS)) revert TradeTooLarge();
        uint256 expected = Math.mulDiv(ethAmount, averagePriceX112, Q112);
        floor = Math.mulDiv(expected, BPS - slippageBps, BPS, Math.Rounding.Ceil);
    }

    function _transferMeasured(address recipient, uint256 debit) private returns (uint256 credit) {
        if (debit == 0) return 0;
        uint256 beforeBalance = token.balanceOf(recipient);
        token.safeTransfer(recipient, debit);
        credit = token.balanceOf(recipient) - beforeBalance;
        if (credit < Math.mulDiv(debit, BPS - slippageBps, BPS, Math.Rounding.Ceil)) revert InsufficientCredit();
    }

    function _swap(uint256 ethAmount, uint256 minReceived, uint256 deadline) private returns (uint256 received) {
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = address(token);
        uint256 beforeBalance = token.balanceOf(address(this));
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: ethAmount}(minReceived, path, address(this), deadline);
        received = token.balanceOf(address(this)) - beforeBalance;
        if (received < minReceived) revert InsufficientReceipt();
    }

    function _distribute(uint256 id, uint256 ethSpent, uint256 received) private {
        uint256 burnDebit = Math.mulDiv(received, burnShareBps, BPS);
        uint256 treasuryDebit = received - burnDebit;
        uint256 burnCredit = _transferMeasured(burnReserve, burnDebit);
        uint256 treasuryCredit = _transferMeasured(treasury, treasuryDebit);
        emit BuybackExecuted(id, ethSpent, received, burnReserve, treasury, burnDebit, treasuryDebit, burnCredit, treasuryCredit);
    }
}
