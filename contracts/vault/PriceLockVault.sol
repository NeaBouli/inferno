// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal Uniswap V2 pair surface used for the TWAP.
interface IUniswapV2PairTwap {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
}

/// @notice Minimal Uniswap V2 factory surface used to prove pair provenance.
interface IUniswapV2FactoryPair {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

/// @title PriceLockVault
/// @notice Locks IFR until a TWAP price target is reached, with a mandatory rescue time per lock.
///         Price locks are disabled until Governance activates them. Activation and every new lock revert unless
///         the on-chain readiness scope (pool depth and/or TWAP) holds at that moment. The rescue path
///         (maxUnlockTime) never calls the pair, so it works even if the pair reverts.
///         Tokens always return to the wallet that locked them; nobody can withdraw user funds.
///         See docs/PRICE_LOCK_VAULT_SPEC.md.
contract PriceLockVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Lock {
        uint256 amount;          // IFR credited to the vault (9 decimals)
        uint256 targetPriceWei;  // TWAP target in wei per 1 IFR
        uint64 lockedAt;
        uint64 earliestTime;     // 0 = no time condition
        uint64 maxUnlockTime;    // rescue: unlock always allowed from this time
        bool unlocked;
    }

    struct Observation {
        uint64 timestamp;
        uint256 priceCumulative; // IFR price cumulative (WETH per IFR, UQ112x112 seconds)
        uint256 wethReserve;     // pool WETH reserve when recorded
    }

    uint256 public constant MIN_LOCK_DURATION = 1 days;
    uint256 public constant MAX_LOCK_DURATION = 1461 days;
    uint256 public constant MIN_TWAP_WINDOW = 1 days;
    uint256 public constant MAX_TWAP_WINDOW = 30 days;
    uint256 public constant MAX_WETH_RESERVE_THRESHOLD = 100_000 ether;
    uint256 public constant OBSERVATION_SLOTS = 32;
    uint256 public constant MAX_LOCKS_PER_WALLET = 50;
    uint256 private constant Q112 = 2 ** 112;
    uint256 private constant IFR_UNIT = 1e9;

    IERC20 public immutable ifrToken;
    address public immutable weth;
    address public immutable factory;
    IUniswapV2PairTwap public immutable pair;
    bool public immutable ifrIsToken0;

    bool public active;
    uint256 public twapWindow;
    uint256 public minWethReserve;
    uint256 public minActivationPrice;
    uint256 public totalLocked;
    uint256 public observationCount;

    Observation[32] private _observations;
    mapping(address => Lock[]) private _locks;
    /// @notice Number of a wallet's locks that are not yet unlocked; MAX_LOCKS_PER_WALLET caps this, not the lifetime count
    mapping(address => uint256) public activeLockCount;

    event Locked(address indexed wallet, uint256 indexed lockId, uint256 amount, uint256 targetPriceWei, uint64 earliestTime, uint64 maxUnlockTime);
    event Unlocked(address indexed wallet, uint256 indexed lockId, uint256 amount, bool rescue);
    event ObservationRecorded(uint256 indexed index, uint64 timestamp, uint256 priceCumulative, uint256 wethReserve);
    event Activated(uint256 wethReserve, uint256 twapPriceWei);
    event Deactivated();
    event ThresholdsUpdated(uint256 minWethReserve, uint256 minActivationPrice);
    event TwapWindowUpdated(uint256 twapWindow);

    /// @param _ifrToken IFR token (9 decimals)
    /// @param _weth Canonical WETH of the network; the pair's other token must be exactly this
    /// @param _factory Uniswap V2 factory; the pair is taken from factory.getPair(IFR, WETH), never supplied directly
    /// @param _governance Owner (Governance timelock)
    /// @param _twapWindow TWAP window in seconds (1 to 30 days)
    /// @param _minWethReserve Readiness: minimum WETH reserve in wei (0 = not required)
    /// @param _minActivationPrice Readiness: minimum TWAP in wei per IFR (0 = not required)
    constructor(
        address _ifrToken,
        address _weth,
        address _factory,
        address _governance,
        uint256 _twapWindow,
        uint256 _minWethReserve,
        uint256 _minActivationPrice
    ) Ownable(_governance) {
        require(_ifrToken != address(0) && _weth != address(0) && _factory != address(0), "zero address");
        require(_ifrToken != _weth, "IFR equals WETH");
        address _pair = IUniswapV2FactoryPair(_factory).getPair(_ifrToken, _weth);
        require(_pair != address(0), "no IFR/WETH pair");
        address t0 = IUniswapV2PairTwap(_pair).token0();
        address t1 = IUniswapV2PairTwap(_pair).token1();
        require((t0 == _ifrToken && t1 == _weth) || (t0 == _weth && t1 == _ifrToken), "pair is not IFR/WETH");
        ifrToken = IERC20(_ifrToken);
        weth = _weth;
        factory = _factory;
        pair = IUniswapV2PairTwap(_pair);
        ifrIsToken0 = t0 == _ifrToken;
        _setTwapWindow(_twapWindow);
        _setThresholds(_minWethReserve, _minActivationPrice);
    }

    // ── Price observations ─────────────────────────────────────

    /// @notice Record a price observation if the minimum spacing (twapWindow / 16) has passed. Anyone may call.
    /// @return recorded True if a new observation was stored
    function poke() public returns (bool recorded) {
        uint256 count = observationCount;
        if (count > 0) {
            Observation storage last = _observations[(count - 1) % OBSERVATION_SLOTS];
            if (block.timestamp < uint256(last.timestamp) + twapWindow / 16) return false;
        }
        (uint256 cumulative, uint256 wethReserve, ) = _currentCumulative();
        uint256 index = count % OBSERVATION_SLOTS;
        _observations[index] = Observation(uint64(block.timestamp), cumulative, wethReserve);
        observationCount = count + 1;
        emit ObservationRecorded(index, uint64(block.timestamp), cumulative, wethReserve);
        return true;
    }

    /// @notice TWAP of IFR in wei per 1 IFR over at least twapWindow.
    /// @return valid False if no observation between twapWindow and 2 * twapWindow old exists or reserves are zero
    /// @return priceWei TWAP in wei per IFR (0 if invalid)
    /// @return observationWethReserve Pool WETH reserve recorded with the observation used
    function twap() public view returns (bool valid, uint256 priceWei, uint256 observationWethReserve) {
        (uint256 cumulative, , bool reservesNonZero) = _currentCumulative();
        if (!reservesNonZero) return (false, 0, 0);
        uint256 count = observationCount;
        uint256 slots = count < OBSERVATION_SLOTS ? count : OBSERVATION_SLOTS;
        uint256 window = twapWindow;
        uint256 bestTs = 0;
        uint256 bestCumulative = 0;
        uint256 bestReserve = 0;
        for (uint256 i = 0; i < slots; i++) {
            Observation storage o = _observations[i];
            uint256 age = block.timestamp - o.timestamp;
            if (age >= window && age <= 2 * window && o.timestamp > bestTs) {
                bestTs = o.timestamp;
                bestCumulative = o.priceCumulative;
                bestReserve = o.wethReserve;
            }
        }
        if (bestTs == 0) return (false, 0, 0);
        uint256 elapsed = block.timestamp - bestTs;
        uint256 average;
        unchecked {
            average = (cumulative - bestCumulative) / elapsed; // Uniswap cumulatives are designed to wrap
        }
        // UQ112x112 average first (as in Uniswap's oracle library): multiplying the raw delta could overflow,
        // and the precision lost by dividing first is below 1 wei per IFR.
        priceWei = (average * IFR_UNIT) / Q112;
        return (priceWei > 0, priceWei, bestReserve);
    }

    /// @notice Current readiness against the activation thresholds.
    /// @return wethReserve Current pool WETH reserve
    /// @return observationWethReserve WETH reserve at the TWAP observation (0 if no valid TWAP)
    /// @return requiredWethReserve minWethReserve (0 = not required)
    /// @return twapValid Whether a valid TWAP exists
    /// @return twapPriceWei TWAP in wei per IFR
    /// @return requiredPriceWei minActivationPrice (0 = not required)
    /// @return ready Whether activate() and new locks would pass the scope check now
    function readiness()
        public
        view
        returns (
            uint256 wethReserve,
            uint256 observationWethReserve,
            uint256 requiredWethReserve,
            bool twapValid,
            uint256 twapPriceWei,
            uint256 requiredPriceWei,
            bool ready
        )
    {
        (, wethReserve, ) = _currentCumulative();
        (twapValid, twapPriceWei, observationWethReserve) = twap();
        requiredWethReserve = minWethReserve;
        requiredPriceWei = minActivationPrice;
        uint256 depth = wethReserve < observationWethReserve ? wethReserve : observationWethReserve;
        bool reserveOk = requiredWethReserve == 0 || (twapValid && depth >= requiredWethReserve);
        bool priceOk = requiredPriceWei == 0 || (twapValid && twapPriceWei >= requiredPriceWei);
        ready = reserveOk && priceOk;
    }

    // ── Governance ─────────────────────────────────────────────

    /// @notice Enable new price locks. Reverts unless the readiness scope holds now.
    function activate() external onlyOwner {
        require(!active, "already active");
        poke();
        (uint256 wethReserve, , , , uint256 price, , bool ready) = readiness();
        require(ready, "readiness scope not met");
        active = true;
        emit Activated(wethReserve, price);
    }

    /// @notice Stop new price locks. Existing locks are unaffected.
    function deactivate() external onlyOwner {
        require(active, "not active");
        active = false;
        emit Deactivated();
    }

    /// @notice Update the readiness thresholds (at least one non-zero, reserve within bounds).
    /// @param _minWethReserve Minimum WETH reserve in wei (0 = not required)
    /// @param _minActivationPrice Minimum TWAP in wei per IFR (0 = not required)
    function setThresholds(uint256 _minWethReserve, uint256 _minActivationPrice) external onlyOwner {
        _setThresholds(_minWethReserve, _minActivationPrice);
    }

    /// @notice Update the TWAP window within 1 to 30 days.
    /// @param _twapWindow Window in seconds
    function setTwapWindow(uint256 _twapWindow) external onlyOwner {
        _setTwapWindow(_twapWindow);
    }

    // ── Locks ──────────────────────────────────────────────────

    /// @notice Lock IFR until the TWAP reaches targetPriceWei (and earliestTime, if set), or until maxUnlockTime.
    ///         Requires the vault to be active AND the readiness scope to hold now (re-checked on every lock).
    /// @param amount IFR to transfer in (the credited balance difference is recorded)
    /// @param targetPriceWei TWAP target in wei per IFR
    /// @param earliestTime Optional earliest unlock time (0 = none)
    /// @param maxUnlockTime Rescue time, 1 day to 4 years from now
    /// @return lockId Index of the new lock for msg.sender
    function lock(uint256 amount, uint256 targetPriceWei, uint64 earliestTime, uint64 maxUnlockTime)
        external
        nonReentrant
        returns (uint256 lockId)
    {
        require(active, "price locks not active");
        require(amount > 0, "amount=0");
        require(targetPriceWei > 0, "target=0");
        require(
            maxUnlockTime >= block.timestamp + MIN_LOCK_DURATION && maxUnlockTime <= block.timestamp + MAX_LOCK_DURATION,
            "maxUnlockTime out of range"
        );
        require(earliestTime == 0 || earliestTime <= maxUnlockTime, "earliestTime after maxUnlockTime");
        require(activeLockCount[msg.sender] < MAX_LOCKS_PER_WALLET, "too many locks");
        poke();
        (, , , , , , bool ready) = readiness();
        require(ready, "readiness scope not met");

        uint256 before = ifrToken.balanceOf(address(this));
        ifrToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = ifrToken.balanceOf(address(this)) - before;
        require(received > 0, "nothing received");

        lockId = _locks[msg.sender].length;
        _locks[msg.sender].push(Lock(received, targetPriceWei, uint64(block.timestamp), earliestTime, maxUnlockTime, false));
        activeLockCount[msg.sender] += 1;
        totalLocked += received;
        emit Locked(msg.sender, lockId, received, targetPriceWei, earliestTime, maxUnlockTime);
    }

    /// @notice Unlock one of msg.sender's locks; tokens go to msg.sender, the original locker.
    ///         From maxUnlockTime on (rescue) no pair or oracle call is made, so a broken pair cannot block it.
    /// @param lockId Index of the lock
    function unlock(uint256 lockId) external nonReentrant {
        require(lockId < _locks[msg.sender].length, "invalid lockId");
        Lock storage l = _locks[msg.sender][lockId];
        require(!l.unlocked, "already unlocked");
        bool rescue = block.timestamp >= l.maxUnlockTime;
        if (!rescue) {
            require(block.timestamp >= l.earliestTime, "earliest time not reached");
            poke();
            (bool valid, uint256 price, ) = twap();
            require(valid, "no valid TWAP");
            require(price >= l.targetPriceWei, "price target not met");
        }
        uint256 amount = l.amount;
        l.unlocked = true;
        l.amount = 0;
        activeLockCount[msg.sender] -= 1;
        totalLocked -= amount;
        ifrToken.safeTransfer(msg.sender, amount);
        emit Unlocked(msg.sender, lockId, amount, rescue);
    }

    // ── Views ──────────────────────────────────────────────────

    /// @notice Number of locks of a wallet
    /// @param wallet Locker address
    /// @return Number of locks
    function getLockCount(address wallet) external view returns (uint256) {
        return _locks[wallet].length;
    }

    /// @notice One lock of a wallet
    /// @param wallet Locker address
    /// @param lockId Index of the lock
    /// @return The lock
    function getLock(address wallet, uint256 lockId) external view returns (Lock memory) {
        require(lockId < _locks[wallet].length, "invalid lockId");
        return _locks[wallet][lockId];
    }

    /// @notice All locks of a wallet
    /// @param wallet Locker address
    /// @return The locks
    function getLocks(address wallet) external view returns (Lock[] memory) {
        return _locks[wallet];
    }

    /// @notice Whether a lock could be unlocked by its owner right now (ignoring the observation a call would add)
    /// @param wallet Locker address
    /// @param lockId Index of the lock
    /// @return True if unlock would succeed
    function canUnlock(address wallet, uint256 lockId) external view returns (bool) {
        if (lockId >= _locks[wallet].length) return false;
        Lock storage l = _locks[wallet][lockId];
        if (l.unlocked) return false;
        if (block.timestamp >= l.maxUnlockTime) return true;
        if (block.timestamp < l.earliestTime) return false;
        (bool valid, uint256 price, ) = twap();
        return valid && price >= l.targetPriceWei;
    }

    /// @notice A stored observation
    /// @param index Ring-buffer slot (0 to 31)
    /// @return The observation
    function getObservation(uint256 index) external view returns (Observation memory) {
        require(index < OBSERVATION_SLOTS, "invalid index");
        return _observations[index];
    }

    // ── Internal ───────────────────────────────────────────────

    function _currentCumulative() internal view returns (uint256 cumulative, uint256 wethReserve, bool reservesNonZero) {
        cumulative = ifrIsToken0 ? pair.price0CumulativeLast() : pair.price1CumulativeLast();
        (uint112 r0, uint112 r1, uint32 last) = pair.getReserves();
        (uint256 ifrReserve, uint256 wethRes) = ifrIsToken0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        wethReserve = wethRes;
        reservesNonZero = ifrReserve > 0 && wethRes > 0;
        uint32 nowTs = uint32(block.timestamp);
        if (reservesNonZero && last != nowTs) {
            unchecked {
                uint32 elapsed = nowTs - last; // wraps like Uniswap V2
                cumulative += ((wethRes * Q112) / ifrReserve) * elapsed;
            }
        }
    }

    function _setThresholds(uint256 _minWethReserve, uint256 _minActivationPrice) internal {
        require(_minWethReserve > 0 || _minActivationPrice > 0, "no threshold");
        require(_minWethReserve <= MAX_WETH_RESERVE_THRESHOLD, "reserve threshold too high");
        minWethReserve = _minWethReserve;
        minActivationPrice = _minActivationPrice;
        emit ThresholdsUpdated(_minWethReserve, _minActivationPrice);
    }

    function _setTwapWindow(uint256 _twapWindow) internal {
        require(_twapWindow >= MIN_TWAP_WINDOW && _twapWindow <= MAX_TWAP_WINDOW, "window out of range");
        twapWindow = _twapWindow;
        emit TwapWindowUpdated(_twapWindow);
    }
}
