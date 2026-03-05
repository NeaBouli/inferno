# INFERNO ($IFR) -- Fair Launch Migration Plan (CFLM)

**Date:** 2026-02-15
**Status:** COMPLETED -- Migration executed on mainnet 2026-03-05

---

## 1. Strategy Change

Inferno switched from the presale model to the **Community Fair Launch Model (CFLM)**.

Reasons:
- No preferential buyers (no whale advantage)
- Trust through immediate DEX liquidity
- Community-first approach

---

## 2. New Token Allocation

| # | Recipient | Amount | Share | Mechanism |
|---|-----------|--------|-------|-----------|
| 1 | **Initial DEX Liquidity** | 400,000,000 IFR | 40% | Deployer paired with ETH on Uniswap V2/V3 |
| 2 | **Strategic Liquidity Reserve** | 200,000,000 IFR | 20% | LiquidityReserve.sol (time-locked, staged release) |
| 3 | **Team Vesting** | 150,000,000 IFR | 15% | Vesting.sol (12mo cliff, 36mo linear after cliff) |
| 4 | **Treasury Multisig** | 150,000,000 IFR | 15% | Direct to Multisig address |
| 5 | **Community/Ecosystem/Bug Bounty** | 100,000,000 IFR | 10% | Direct to Community wallet |
| | **Total** | **1,000,000,000 IFR** | **100%** | |

---

## 3. Analysis of Existing Contracts

### 3.1 InfernoToken.sol -- No Change Needed

- Mints 100% (1B IFR) to `msg.sender` in constructor
- Deploy script then distributes via `token.transfer()` to the 5 recipients
- Fee-on-Transfer (2% Sender Burn, 0.5% Recipient Burn, 1% Pool Fee) remains unchanged
- `feeExempt` mapping is set for all contracts

**Conclusion:** Contract stays as is. Only the deploy script changes the distribution.

### 3.2 Presale.sol -- Deleted

- Classic ETH->IFR presale logic, not compatible with CFLM
- Contract and tests removed
- feeExempt entry in deploy script removed

**Files affected:**
- `contracts/presale/Presale.sol` -> deleted
- `test/Presale.test.js` -> deleted
- `scripts/deploy-testnet.js` -> Presale steps removed

### 3.3 Vesting.sol -- Formula Adjustment Needed

**Problem with the original formula:**

```
vestedAmount = (totalAllocation * elapsed) / duration
```

With cliff=12mo, duration=36mo:
- Month 12 (cliff end): `(150M * 12) / 36 = 50M` -> **33.3% immediately available**
- This is NOT the desired behavior

**Desired behavior:** 12mo cliff, then 36mo linear FROM the cliff:
- Month 12: 0% available (cliff just expired, linear phase begins)
- Month 24: `(150M * 12) / 36 = 50M` (33.3%)
- Month 36: `(150M * 24) / 36 = 100M` (66.6%)
- Month 48: 150M (100%)

**New formula:**

```solidity
function vestedAmount() public view returns (uint256) {
    uint256 elapsed = block.timestamp - start;
    if (elapsed < cliffDuration) return 0;
    uint256 vestingElapsed = elapsed - cliffDuration;
    uint256 vestingDuration = duration - cliffDuration;
    if (vestingElapsed >= vestingDuration) return totalAllocation;
    return (totalAllocation * vestingElapsed) / vestingDuration;
}
```

**Parameters for Team Vesting:**
- `cliffDuration` = 365 days (12 months)
- `duration` = 365 * 4 days (48 months total = 12mo cliff + 36mo linear)
- `totalAllocation` = 150,000,000 * 10^9

**Files affected:**
- `contracts/vesting/Vesting.sol` -> formula changed
- `test/Vesting.test.js` -> tests adjusted

### 3.4 BuybackVault.sol -- 60-Day Activation Delay

**Change:** New `activationTime` parameter prevents buybacks in the first 60 days after launch.

```solidity
uint256 public immutable activationTime;

constructor(...) {
    activationTime = block.timestamp + 60 days;
    // ...
}

function executeBuyback() external onlyOwner {
    require(block.timestamp >= activationTime, "not active yet");
    // ...
}
```

**Files affected:**
- `contracts/buyback/BuybackVault.sol` -> activationTime added
- `test/BuybackVault.test.js` -> tests extended

### 3.5 BurnReserve.sol -- No Change Needed

---

## 4. New Contract: LiquidityReserve.sol

### Purpose

Holds 200M IFR (20% supply) as a strategic liquidity reserve. Staged release after lock period prevents supply shock.

### Design

```
LiquidityReserve
├── owner               (address) -- can withdraw after lock
├── guardian             (address) -- can pause
├── token               (IERC20, immutable) -- IFR Token
├── lockEnd             (uint256, immutable) -- block.timestamp + lockDuration
├── maxWithdrawPerPeriod (uint256) -- max withdrawal per period (e.g. 50M IFR)
├── periodDuration      (uint256) -- length of one period (e.g. 90 days = 1 quarter)
├── lastWithdrawPeriod  (uint256) -- last period in which withdrawal occurred
├── withdrawnThisPeriod (uint256) -- already withdrawn in current period
├── totalWithdrawn      (uint256) -- total withdrawn
└── paused              (bool)
```

### Functions

| Function | Auth | Description |
|----------|------|-------------|
| `constructor(token, lockDuration, maxPerPeriod, periodDuration, guardian)` | -- | Initialization |
| `withdraw(address to, uint256 amount)` | onlyOwner | Withdraw tokens (after lock, max per period) |
| `setMaxWithdrawPerPeriod(uint256)` | onlyOwner | Change period limit |
| `setGuardian(address)` | onlyOwner | Change guardian |
| `pause()` / `unpause()` | onlyGuardian | Pause withdrawals |
| `availableToWithdraw()` | view | Shows currently withdrawable amount |
| `currentPeriod()` | view | Current period number |
| `pendingBalance()` | view | Token balance in contract |

### Period Logic

```
Example: lockDuration=6mo, maxPerPeriod=50M, periodDuration=90d

Month 0-6:   Locked, no withdrawal
Month 6-9:   Period 1 -> max 50M withdrawable
Month 9-12:  Period 2 -> max 50M withdrawable
Month 12-15: Period 3 -> max 50M withdrawable
Month 15-18: Period 4 -> max 50M withdrawable (200M fully released)
```

### Default Parameters (Deploy)

- `lockDuration`: 180 days (6 months)
- `maxWithdrawPerPeriod`: 50,000,000 * 10^9 (50M IFR)
- `periodDuration`: 90 days (1 quarter)

---

## 5. Deploy Script (CFLM)

### New Flow

```
Step 1/8  Deploy InfernoToken (poolFeeReceiver = deployer)
Step 2/8  Deploy LiquidityReserve (6mo lock, 50M/quarter)
Step 3/8  Deploy Vesting (12mo cliff, 36mo linear, 150M IFR, beneficiary=TBD)
Step 4/8  Deploy BuybackVault (60d activation delay)
Step 5/8  Deploy BurnReserve
Step 6/8  Set feeExempt for all contracts + deployer
Step 7/8  Distribute Tokens:
            400M -> Deployer keeps for DEX liquidity pairing
            200M -> LiquidityReserve
            150M -> Vesting (Team)
            150M -> Treasury Multisig address
            60M  -> Community & Grants wallet
            40M  -> Partner Ecosystem (PartnerVault)
Step 8/8  Remove deployer feeExempt
```

### FeeExempt List (complete)

| Contract/Address | feeExempt | Reason |
|------------------|-----------|--------|
| Vesting | Yes | Token release without fees |
| LiquidityReserve | Yes | Internal protocol transfers |
| Treasury Multisig | Yes | Operational transfers |
| BuybackVault | Yes | Buyback mechanism |
| BurnReserve | Yes | Burn mechanism |
| Deployer | Yes -> No | Temporary for distribution, then removed |

**Important:** Deployer feeExempt is explicitly removed in Step 8 (`setFeeExempt(deployer, false)`).

---

## 6. LP Lock Strategy

**Recommendation: Own contract (LiquidityReserve.sol)**

| Criterion | Own Contract | Unicrypt/Team.finance |
|-----------|-------------|----------------------|
| Auditability | Full source code | External protocol |
| Flexibility | Staged release | Usually all-or-nothing |
| Dependency | None | External protocol risk |
| Trust Signal | Medium | High (well-known platform) |
| Cost | Gas for deploy | Platform fee |

LiquidityReserve.sol can also hold LP tokens (ERC20-compatible). External platform can be used additionally later.

---

## 7. File Overview

| File | Action | Description |
|------|--------|-------------|
| `contracts/liquidity/LiquidityReserve.sol` | **New** | Strategic Reserve with staged release |
| `test/LiquidityReserve.test.js` | **New** | Tests for LiquidityReserve |
| `contracts/vesting/Vesting.sol` | **Change** | Post-cliff formula |
| `test/Vesting.test.js` | **Change** | Tests for new formula |
| `contracts/buyback/BuybackVault.sol` | **Change** | activationTime (60d) |
| `test/BuybackVault.test.js` | **Change** | activationTime tests |
| `contracts/presale/Presale.sol` | **Delete** | No longer needed |
| `test/Presale.test.js` | **Delete** | No longer needed |
| `scripts/deploy-testnet.js` | **Rewrite** | CFLM allocation + feeExempt |
| `contracts/token/InfernoToken.sol` | No change | |
| `contracts/burnreserve/BurnReserve.sol` | No change | |

---

## 8. Implementation Order

1. `docs/FAIR-LAUNCH-MIGRATION.md` created (this document)
2. `contracts/liquidity/LiquidityReserve.sol` + tests implemented
3. `contracts/vesting/Vesting.sol` formula adjusted + tests
4. `contracts/buyback/BuybackVault.sol` activationTime + tests
5. `contracts/presale/Presale.sol` + tests deleted
6. `scripts/deploy-testnet.js` completely rewritten
7. Compile + run all tests
8. Commit & Push

**All steps completed. Migration executed on mainnet 2026-03-05.**

---

## 9. Open Questions (Resolved)

- [x] Treasury Multisig address -> `0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c`
- [x] Community wallet address -> `0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E`
- [x] Team Vesting beneficiary address -> Set during mainnet deploy
- [x] DEX Liquidity pairing: manual or automated in deploy script? -> Manual
- [x] Should Presale directory be completely deleted or keep .gitkeep? -> Completely deleted
