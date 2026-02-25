# IFR Partner Integration — Technical Specification

## 1. Overview

Partners integrate with two on-chain contracts:

| Contract | Purpose | Address (Sepolia) |
|----------|---------|-------------------|
| **IFRLock** | Users lock IFR → `isLocked()` gates premium access | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| **PartnerVault** | Partner rewards, milestones, vesting, claims | `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` |
| InfernoToken | ERC-20 (9 decimals), fee-on-transfer | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| Governance | 48h timelock, admin of PartnerVault | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` |

**Token:** $IFR, 9 decimals, 1B initial supply, 2.5% burn per transfer, no mint function.

---

## 2. Partner Lifecycle

```
createPartner() → activatePartner() → recordMilestone() / recordLockReward()
                                           ↓
                                     vesting starts
                                           ↓
                                       claim()
```

| Step | Caller | Function | When |
|------|--------|----------|------|
| 1. Create | Admin (Governance) | `createPartner(partnerId, beneficiary, maxAllocation, vestingDuration, cliff, tier)` | Once per partner |
| 2. Activate | Admin (Governance) | `activatePartner(partnerId)` | After review |
| 3a. Milestones | Admin (Governance) | `recordMilestone(partnerId, milestoneId, unlockAmount)` | Per milestone achieved |
| 3b. Lock Rewards | Admin or AuthorizedCaller | `recordLockReward(partnerId, lockAmount, wallet)` | Per user lock event |
| 4. Claim | Beneficiary (permissionless) | `claim(partnerId)` | Anytime (vested amount) |

---

## 3. IFRLock — Contract Reference

### Read Functions (for partner resolvers)

```solidity
function isLocked(address user, uint256 minAmount) view returns (bool)
function lockedBalance(address user) view returns (uint256)
function lockInfo(address user) view returns (uint256 amount, uint256 lockedAt)
function totalLocked() view returns (uint256)
```

### Write Functions (user-facing)

```solidity
function lock(uint256 amount) external                          // default lockType = 0x0
function lockWithType(uint256 amount, bytes32 lockType) external // tagged lock
function unlock() external                                       // returns all locked tokens
```

### Minimal ABI (ethers v5 human-readable)

```javascript
const IFR_LOCK_ABI = [
  "function isLocked(address user, uint256 minAmount) view returns (bool)",
  "function lockedBalance(address user) view returns (uint256)",
  "function lockInfo(address user) view returns (uint256 amount, uint256 lockedAt)",
  "function totalLocked() view returns (uint256)",
  "function lock(uint256 amount)",
  "function lockWithType(uint256 amount, bytes32 lockType)",
  "function unlock()",
  "event Locked(address indexed user, uint256 amount, bytes32 indexed lockType)",
  "event Unlocked(address indexed user, uint256 amount)",
];
```

### lockType Convention

Partners tag locks with a `bytes32` identifier for analytics:

```javascript
const lockType = ethers.utils.id("myapp_premium"); // keccak256 hash → bytes32
await lock.lockWithType(amount, lockType);
```

`lockType` is metadata only — it does not affect `isLocked()` queries. One user has one lock balance, shared across all apps.

---

## 4. PartnerVault — Contract Reference

### Partner Struct

```solidity
struct Partner {
    address beneficiary;      // Wallet that receives claimed IFR
    uint256 maxAllocation;    // Max IFR this partner can earn (milestone + rewards)
    uint256 unlockedTotal;    // Sum of milestone unlocks
    uint256 rewardAccrued;    // Sum of lock-triggered rewards
    uint256 claimedTotal;     // Already claimed IFR
    uint32  vestingStart;     // Timestamp: first milestone or reward
    uint32  vestingDuration;  // 180–365 days
    uint32  cliff;            // Cliff period (≤ vestingDuration)
    bool    active;           // Must be true for milestones/rewards/claims
    bool    milestonesFinal;  // No more milestones after finalization
    uint8   tier;             // 0–255, governance-defined
}
```

### Partner ID

`bytes32 partnerId` — deterministic identifier, typically `keccak256(abi.encodePacked("partner_name"))`.

```javascript
const partnerId = ethers.utils.id("securecall"); // bytes32
```

### Admin Functions (via Governance Timelock)

```solidity
// Partner management
function createPartner(bytes32 partnerId, address beneficiary, uint256 maxAllocation, uint32 vestingDuration, uint32 cliff, uint8 tier) external onlyAdmin
function activatePartner(bytes32 partnerId) external onlyAdmin
function recordMilestone(bytes32 partnerId, bytes32 milestoneId, uint256 unlockAmount) external onlyAdmin
function finalizeMilestones(bytes32 partnerId) external onlyAdmin
function setPartnerBeneficiary(bytes32 partnerId, address newBeneficiary) external onlyAdmin
function setPartnerAllocation(bytes32 partnerId, uint256 newMax) external onlyAdmin

// Global parameters
function setRewardBps(uint256 newBps) external onlyAdmin           // 500–2500
function setAnnualEmissionCap(uint256 newCap) external onlyAdmin   // 1M–10M IFR
function setAuthorizedCaller(address caller, bool status) external onlyAdmin
function setIFRLock(address _ifrLock) external onlyAdmin
```

### AuthorizedCaller Functions

```solidity
function recordLockReward(bytes32 partnerId, uint256 lockAmount, address wallet) external onlyAuthorized
```

`onlyAuthorized` = `msg.sender == admin || authorizedCaller[msg.sender]`

### Permissionless Functions

```solidity
function claim(bytes32 partnerId) external              // Sends vested IFR to beneficiary
```

### View Functions

```solidity
function partners(bytes32 partnerId) view returns (address, uint256, uint256, uint256, uint256, uint32, uint32, uint32, bool, bool, uint8)
function claimable(bytes32 partnerId) view returns (uint256)
function vestedAmount(bytes32 partnerId) view returns (uint256)
function pendingBalance() view returns (uint256)         // Contract's IFR balance
function walletRewardClaimed(address wallet, bytes32 partnerId) view returns (bool)
function authorizedCaller(address caller) view returns (bool)
function rewardBps() view returns (uint256)
function annualEmissionCap() view returns (uint256)
function totalAllocated() view returns (uint256)
function totalRewarded() view returns (uint256)
function totalClaimed() view returns (uint256)
function yearlyEmitted() view returns (uint256)
```

### Full ABI (ethers v5 human-readable)

```javascript
const PARTNER_VAULT_ABI = [
  // Admin
  "function createPartner(bytes32 partnerId, address beneficiary, uint256 maxAllocation, uint32 vestingDuration, uint32 cliff, uint8 tier)",
  "function activatePartner(bytes32 partnerId)",
  "function recordMilestone(bytes32 partnerId, bytes32 milestoneId, uint256 unlockAmount)",
  "function finalizeMilestones(bytes32 partnerId)",
  "function setPartnerBeneficiary(bytes32 partnerId, address newBeneficiary)",
  "function setPartnerAllocation(bytes32 partnerId, uint256 newMax)",
  "function setRewardBps(uint256 newBps)",
  "function setAnnualEmissionCap(uint256 newCap)",
  "function setAuthorizedCaller(address caller, bool status)",
  "function setIFRLock(address _ifrLock)",
  // AuthorizedCaller
  "function recordLockReward(bytes32 partnerId, uint256 lockAmount, address wallet)",
  // Permissionless
  "function claim(bytes32 partnerId)",
  // Views
  "function partners(bytes32) view returns (address, uint256, uint256, uint256, uint256, uint32, uint32, uint32, bool, bool, uint8)",
  "function claimable(bytes32 partnerId) view returns (uint256)",
  "function vestedAmount(bytes32 partnerId) view returns (uint256)",
  "function pendingBalance() view returns (uint256)",
  "function walletRewardClaimed(address, bytes32) view returns (bool)",
  "function authorizedCaller(address) view returns (bool)",
  "function rewardBps() view returns (uint256)",
  "function annualEmissionCap() view returns (uint256)",
  "function totalAllocated() view returns (uint256)",
  "function totalRewarded() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function yearlyEmitted() view returns (uint256)",
  // Events
  "event PartnerCreated(bytes32 indexed partnerId, address beneficiary, uint256 maxAllocation, uint32 vestingDuration, uint32 cliff, uint8 tier)",
  "event PartnerActivated(bytes32 indexed partnerId)",
  "event MilestoneRecorded(bytes32 indexed partnerId, bytes32 indexed milestoneId, uint256 unlockAmount)",
  "event LockRewardRecorded(bytes32 indexed partnerId, address indexed wallet, uint256 lockAmount, uint256 reward)",
  "event Claimed(bytes32 indexed partnerId, address indexed beneficiary, uint256 amount)",
];
```

---

## 5. Reward Mechanics

### 5.1 recordLockReward Flow

```
User locks IFR via IFRLock
    → Backend detects Locked event
    → Backend calls recordLockReward(partnerId, lockAmount, wallet)
    → Contract calculates: reward = lockAmount × effectiveBps / 10000
    → reward added to partner.rewardAccrued
    → reward vests linearly (cliff → linear release)
    → Partner calls claim() to withdraw vested amount
```

### 5.2 Anti-Double-Count

Each `(wallet, partnerId)` combination can only be rewarded once:

```solidity
mapping(address => mapping(bytes32 => bool)) public walletRewardClaimed;
```

- Same wallet + same partner → reverts with `"already rewarded"`
- Same wallet + different partner → allowed
- Different wallet + same partner → allowed

Check before calling:

```javascript
const alreadyRewarded = await vault.walletRewardClaimed(wallet, partnerId);
if (!alreadyRewarded) {
  await vault.recordLockReward(partnerId, lockAmount, wallet);
}
```

### 5.3 Algorithmic Emission Throttle

The effective reward rate scales down as more IFR is locked globally:

```
lockRatio = totalLocked / TOTAL_SUPPLY (in bps)

If lockRatio < 1%   → effectiveBps = rewardBps (full rate)
If lockRatio ≥ 50%  → effectiveBps = MIN_REWARD_BPS (500 = 5%)
Between 1%–50%      → linear interpolation
```

**Formula:**
```
drop = (rewardBps - MIN_REWARD_BPS) × (lockRatio - 100) / (5000 - 100)
effectiveBps = rewardBps - drop
```

**Example** (rewardBps = 1500):

| Lock Ratio | effectiveBps | Reward on 10,000 IFR lock |
|------------|-------------|---------------------------|
| 0.5% | 1500 (15%) | 1,500 IFR |
| 1% | 1500 (15%) | 1,500 IFR |
| 10% | 1316 (13.16%) | 1,316 IFR |
| 25% | 1010 (10.10%) | 1,010 IFR |
| 50% | 500 (5%) | 500 IFR |
| 90% | 500 (5%) | 500 IFR |

If `ifrLock` is not set (address(0)), the flat `rewardBps` is used (backward compatible).

### 5.4 Annual Emission Cap

Total rewards per year are capped. The year resets automatically when 365 days have passed:

```solidity
yearlyEmitted + reward <= annualEmissionCap  // must be true
```

| Parameter | Min | Max | Default |
|-----------|-----|-----|---------|
| annualEmissionCap | 1,000,000 IFR | 10,000,000 IFR | 4,000,000 IFR |

### 5.5 Vesting

Earned rewards (milestones + lock rewards) vest linearly after the cliff:

```
If now < vestingStart + cliff       → vested = 0
If now ≥ vestingStart + vestingDuration → vested = totalEarned
Else:
  elapsed = now - (vestingStart + cliff)
  effectiveDuration = vestingDuration - cliff
  vested = totalEarned × elapsed / effectiveDuration
```

`vestingStart` is set automatically on first milestone or first reward.

---

## 6. Hard Bounds (Contract-Enforced)

These cannot be changed by governance or any admin:

| Parameter | Min | Max | Constant |
|-----------|-----|-----|----------|
| rewardBps | 500 (5%) | 2500 (25%) | `MIN_REWARD_BPS` / `MAX_REWARD_BPS` |
| annualEmissionCap | 1,000,000 IFR | 10,000,000 IFR | `MIN_ANNUAL_CAP` / `MAX_ANNUAL_CAP` |
| vestingDuration | 180 days | 365 days | enforced in `createPartner()` |
| PARTNER_POOL | — | 40,000,000 IFR | `PARTNER_POOL` constant |
| TOTAL_SUPPLY | — | 1,000,000,000 IFR | `TOTAL_SUPPLY` constant |

---

## 7. AuthorizedCaller Setup

The `recordLockReward()` function accepts calls from `admin` (Governance Timelock) or any address in the `authorizedCaller` whitelist.

**Typical setup:** A backend wallet monitors `Locked` events on IFRLock, verifies the lock, and calls `recordLockReward()`.

### Setting up an authorized caller (via Governance)

```javascript
// Governance proposal calldata:
const iface = new ethers.utils.Interface([
  "function setAuthorizedCaller(address caller, bool status)",
]);
const calldata = iface.encodeFunctionData("setAuthorizedCaller", [
  "0xYOUR_BACKEND_WALLET",
  true,
]);
// Submit as governance proposal targeting PartnerVault address
```

### Backend reward recording

```javascript
const { ethers } = require("ethers");

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.BACKEND_PRIVATE_KEY, provider);

const vault = new ethers.Contract(VAULT_ADDRESS, PARTNER_VAULT_ABI, wallet);
const lock = new ethers.Contract(LOCK_ADDRESS, IFR_LOCK_ABI, provider);

// Listen for lock events
lock.on("Locked", async (user, amount, lockType) => {
  const partnerId = ethers.utils.id("mypartner");

  // Check anti-double-count
  const already = await vault.walletRewardClaimed(user, partnerId);
  if (already) return;

  // Record reward
  const tx = await vault.recordLockReward(partnerId, amount, user);
  await tx.wait();
  console.log(`Reward recorded for ${user}: ${ethers.utils.formatUnits(amount, 9)} IFR locked`);
});
```

---

## 8. Partner Query — Full Example

```javascript
const { ethers } = require("ethers");

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const vault = new ethers.Contract(
  "0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39",
  PARTNER_VAULT_ABI,
  provider
);

const partnerId = ethers.utils.id("securecall");

// Get partner info
const info = await vault.partners(partnerId);
console.log("Beneficiary:", info[0]);
console.log("Max Allocation:", ethers.utils.formatUnits(info[1], 9), "IFR");
console.log("Milestone Unlocked:", ethers.utils.formatUnits(info[2], 9), "IFR");
console.log("Reward Accrued:", ethers.utils.formatUnits(info[3], 9), "IFR");
console.log("Claimed:", ethers.utils.formatUnits(info[4], 9), "IFR");
console.log("Active:", info[8]);
console.log("Tier:", info[10]);

// Get claimable amount
const claimable = await vault.claimable(partnerId);
console.log("Claimable now:", ethers.utils.formatUnits(claimable, 9), "IFR");

// Get global stats
const [rewardBps, annualCap, totalRewarded, yearlyEmitted] = await Promise.all([
  vault.rewardBps(),
  vault.annualEmissionCap(),
  vault.totalRewarded(),
  vault.yearlyEmitted(),
]);
console.log("Reward rate:", rewardBps.toNumber() / 100, "%");
console.log("Annual cap:", ethers.utils.formatUnits(annualCap, 9), "IFR");
console.log("Total rewarded:", ethers.utils.formatUnits(totalRewarded, 9), "IFR");
console.log("Emitted this year:", ethers.utils.formatUnits(yearlyEmitted, 9), "IFR");
```

---

## 9. License Resolver — Minimal Backend

Partners need a resolver to check if a user's wallet has enough IFR locked:

```javascript
const { ethers } = require("ethers");
const express = require("express");

const LOCK_ADDRESS = "0x0Cab0A9440643128540222acC6eF5028736675d3";
const LOCK_ABI = [
  "function isLocked(address user, uint256 minAmount) view returns (bool)",
  "function lockedBalance(address user) view returns (uint256)",
];
const MIN_LOCK = ethers.utils.parseUnits("5000", 9); // 5000 IFR

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const lock = new ethers.Contract(LOCK_ADDRESS, LOCK_ABI, provider);

const app = express();

app.get("/api/license/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    if (!ethers.utils.isAddress(wallet)) {
      return res.status(400).json({ error: "invalid address" });
    }
    const [premium, balance] = await Promise.all([
      lock.isLocked(wallet, MIN_LOCK),
      lock.lockedBalance(wallet),
    ]);
    res.json({
      wallet,
      premium,
      lockedIFR: ethers.utils.formatUnits(balance, 9),
      minRequired: "5000",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("Resolver on :3000"));
```

---

## 10. Fee-on-Transfer — Critical Notes

IFR has a 3.5% fee on every transfer (2% sender burn + 0.5% recipient burn + 1% pool fee).

| Scenario | Fee? | Notes |
|----------|------|-------|
| User → IFRLock (lock) | **No** | IFRLock is feeExempt |
| IFRLock → User (unlock) | **No** | IFRLock is feeExempt |
| PartnerVault → Beneficiary (claim) | **No** | PartnerVault is feeExempt (after Proposal #3) |
| User → User | **Yes** | 3.5% deducted |
| External → PartnerVault | **Yes** | Unless sender is feeExempt |

**For integrators:** Lock/unlock and claim operations are fee-free. No adjustment needed in your resolver logic.

---

## 11. Events Reference

### IFRLock Events

```solidity
event Locked(address indexed user, uint256 amount, bytes32 indexed lockType);
event Unlocked(address indexed user, uint256 amount);
```

### PartnerVault Events

```solidity
event PartnerCreated(bytes32 indexed partnerId, address beneficiary, uint256 maxAllocation, uint32 vestingDuration, uint32 cliff, uint8 tier);
event PartnerActivated(bytes32 indexed partnerId);
event MilestoneRecorded(bytes32 indexed partnerId, bytes32 indexed milestoneId, uint256 unlockAmount);
event LockRewardRecorded(bytes32 indexed partnerId, address indexed wallet, uint256 lockAmount, uint256 reward);
event Claimed(bytes32 indexed partnerId, address indexed beneficiary, uint256 amount);
event MilestonesFinalized(bytes32 indexed partnerId);
event AuthorizedCallerUpdated(address indexed caller, bool status);
event IFRLockUpdated(address indexed oldLock, address indexed newLock);
event RewardBpsUpdated(uint256 oldBps, uint256 newBps);
event AnnualCapUpdated(uint256 oldCap, uint256 newCap);
```

---

## 12. FeeRouterV1 ABI

### Minimal ABI (ethers v5 human-readable)

```javascript
const FEE_ROUTER_ABI = [
  "function protocolFeeBps() view returns (uint16)",
  "function FEE_CAP_BPS() view returns (uint16)",
  "function paused() view returns (bool)",
  "function feeCollector() view returns (address)",
  "function voucherSigner() view returns (address)",
  "function usedNonces(address, uint256) view returns (bool)",
  "function whitelistedAdapters(address) view returns (bool)",
  "function isVoucherValid(tuple(address user, uint16 discountBps, uint32 maxUses, uint64 expiry, uint256 nonce), bytes) view returns (bool, string)",
  "function swapWithFee(address, bytes, tuple(address user, uint16 discountBps, uint32 maxUses, uint64 expiry, uint256 nonce), bytes, bool) payable",
  "function setFeeBps(uint16) external",
  "function setAdapter(address, bool) external",
  "function setVoucherSigner(address) external",
  "function setPaused(bool) external",
  "function setFeeCollector(address) external"
];
```

### Events

```solidity
event VoucherUsed(address indexed user, uint256 indexed nonce, uint16 discountBps);
event FeeCharged(address indexed user, uint256 feeAmount);
event FeeBpsUpdated(uint16 oldBps, uint16 newBps);
event AdapterWhitelisted(address indexed adapter, bool status);
event Paused(bool status);
```

### Sepolia Address

| Contract | Address |
|----------|---------|
| FeeRouterV1 | `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4` |

---

## 13. Testing on Sepolia

### Prerequisites
- Sepolia ETH (from faucet)
- Test IFR tokens (swap on Uniswap Sepolia or request from team)
- ethers v5, Node.js

### Contract Addresses

| Contract | Sepolia Address |
|----------|----------------|
| InfernoToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| PartnerVault | `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` |
| FeeRouterV1 | `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4` |
| Uniswap V2 Router | `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008` |
| LP Pair (IFR/WETH) | `0x2252e8bBDE0E50CD372748aC233A99C08627d9c7` |

### Quick Test with cast (Foundry)

```bash
# Check if wallet has ≥5000 IFR locked
cast call 0x0Cab0A9440643128540222acC6eF5028736675d3 \
  "isLocked(address,uint256)(bool)" \
  0xYOUR_WALLET 5000000000000 \
  --rpc-url $SEPOLIA_RPC_URL

# Get locked balance
cast call 0x0Cab0A9440643128540222acC6eF5028736675d3 \
  "lockedBalance(address)(uint256)" \
  0xYOUR_WALLET \
  --rpc-url $SEPOLIA_RPC_URL

# Check partner claimable
cast call 0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39 \
  "claimable(bytes32)(uint256)" \
  $(cast keccak "securecall") \
  --rpc-url $SEPOLIA_RPC_URL
```

---

## 14. Checklist

### For Lock Integration (read-only, permissionless)
- [ ] Resolver queries `isLocked(wallet, minAmount)` — returns bool
- [ ] Uses 9 decimals for all IFR amounts (`parseUnits(value, 9)`)
- [ ] RPC endpoint is private (Alchemy/Infura with API key)
- [ ] Caching with short TTL (max 5 minutes)
- [ ] No wallet-to-identity linking in logs/database
- [ ] Tested on Sepolia before mainnet

### For Reward Recording (requires authorizedCaller)
- [ ] Backend wallet set as `authorizedCaller` via Governance proposal
- [ ] Monitors IFRLock `Locked` events
- [ ] Checks `walletRewardClaimed(wallet, partnerId)` before calling
- [ ] Calls `recordLockReward(partnerId, lockAmount, wallet)`
- [ ] Handles `"already rewarded"` revert gracefully
- [ ] Handles `"exceeds annual cap"` revert gracefully
- [ ] Backend private key stored securely (not in code)

### For Claiming (beneficiary)
- [ ] Calls `claimable(partnerId)` to check vested amount
- [ ] Calls `claim(partnerId)` from beneficiary address
- [ ] Understands vesting schedule (cliff + linear release)

---

*Stand: Februar 2026 | Inferno Protocol | PartnerVault v1.0*
