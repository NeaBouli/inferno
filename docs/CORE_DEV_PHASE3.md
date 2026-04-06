# Core Dev Phase 3 — Handover Document

> Last updated: 2026-04-04

---

## CommitmentVault.sol — READY FOR REVIEW

### Contract Overview

| Field | Value |
|-------|-------|
| **File** | `contracts/vault/CommitmentVault.sol` |
| **Solidity** | ^0.8.20 |
| **Base** | OpenZeppelin v5 (Ownable, ReentrancyGuard) |
| **Tests** | 45/45 passing (`test/CommitmentVault.test.js`) |
| **ABI** | `abi/CommitmentVault.json` |

### Features

- **4 Condition Types:**
  - `TIME_ONLY` — unlock after timestamp
  - `PRICE_ONLY` — unlock when price >= P0 * multiplier
  - `TIME_OR_PRICE` — whichever comes first
  - `TIME_AND_PRICE` — both must be met
- **Auto-unlock:** 30 days after condition marked as met, anyone can trigger unlock
- **Tokens always return to original depositor** — never the caller
- **P0 is IMMUTABLE** — set once after Bootstrap finalise()
- **MAX_TRANCHES = 50** per wallet (gas safety)
- **totalLocked tracking** for protocol-wide stats
- **View functions:** `getTranches()`, `getTranche()`, `lockedBalance()`, `hasActiveLock()`

### Status Checklist

- [x] Contract written + compiled
- [x] Tests written — 45 passing
- [x] ABI exported to `abi/CommitmentVault.json`
- [ ] Deploy to Sepolia
- [ ] Security audit
- [ ] Deploy to Mainnet
- [x] Governance Proposal: `setFeeExempt(CommitmentVault, true)` — Executed 06.04.2026
- [ ] Governance Proposal: `setP0(value)`

### Deploy Steps

```bash
# 1. Run tests
npx hardhat test test/CommitmentVault.test.js

# 2. Deploy to Sepolia
npx hardhat run scripts/deploy-commitment-vault.js --network sepolia

# 3. Verify on Etherscan
npx hardhat verify --network sepolia <ADDRESS> <IFR_TOKEN> <GOVERNANCE>

# 4. Test setP0 with Bootstrap data
# (via Governance Proposal on Sepolia)

# 5. Submit for audit

# 6. Deploy to Mainnet
npx hardhat run scripts/deploy-commitment-vault.js --network mainnet

# 7. Governance Proposals (in order):
#    - Proposal A: setFeeExempt(CommitmentVault, true) — BEFORE users lock!
#    - Proposal B: setP0(value) — AFTER Bootstrap finalise()
```

### CRITICAL: P0 Calculation

```
P0 = totalETHRaised / 100,000,000

Example: 10 ETH raised → P0 = 0.0000001 ETH per IFR
         In wei: P0 = 100000000000 (1e11)
```

**P0 is IMMUTABLE once set. Triple-check the calculation.**

All CommitmentVault tranche targets are relative to P0:
- `p0Multiplier = 200` → target price = P0 * 2
- `p0Multiplier = 1000` → target price = P0 * 10
- `p0Multiplier = 500000` → target price = P0 * 5000

### Constructor Arguments

```solidity
constructor(
    address _ifrToken,    // Mainnet: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B
    address _governance   // Mainnet: 0xc43d48E7FDA576C5022d0670B652A622E8caD041
)
```

### Important Notes

1. **Set feeExempt BEFORE first user locks!** Otherwise lock/unlock transfers lose 3.5% to fees
2. **P0 must be set via Governance Proposal** — it goes through 48h timelock
3. **Price oracle is optional** — TIME_ONLY tranches work without it
4. **Phase 2:** Deploy Uniswap TWAP oracle, then call `setPriceOracle(address)`

---

## LendingVault.sol — READY FOR REVIEW

### Contract Overview

| Field | Value |
|-------|-------|
| **File** | `contracts/vault/LendingVault.sol` |
| **Solidity** | ^0.8.20 |
| **Base** | OpenZeppelin v5 (Ownable, ReentrancyGuard) |
| **Tests** | 55/55 passing (`test/LendingVault.test.js`) |
| **ABI** | `abi/LendingVault.json` |

### Features

- **Utilization-based interest rate** (per month):
  - 0–25% util → 2%, 26–50% → 3%, 51–75% → 5%, 76–90% → 8%, 91–99% → 15%, 100% → 25%
- **Collateral thresholds:** 200% initial, 150% margin call, 120% liquidation
- **Liquidator bonus:** 5% of collateral
- **Interest split:** 50% lender, 50% protocol (Uniswap LP or BurnReserve)
- **Loan duration:** 30–365 days, minimum 1 month interest
- **MAX_LOANS_PER_BORROWER = 10** (gas safety)
- **Top-up collateral** for margin calls
- **Health check** with MarginCallWarning event (for Railway cron)

### Status Checklist

- [x] Contract written + compiled
- [x] Tests written — 55 passing
- [x] ABI exported to `abi/LendingVault.json`
- [ ] Deploy to Sepolia
- [ ] Security audit
- [ ] Deploy to Mainnet
- [x] Governance Proposal: `setFeeExempt(LendingVault, true)` — Executed 06.04.2026
- [ ] Governance Proposal: `setIFRPrice(value)` (initial price)
- [ ] Set protocolFeeReceiver (BurnReserve or LP address)

### Deploy Steps

```bash
# 1. Run tests
npx hardhat test test/LendingVault.test.js

# 2. Deploy to Sepolia
npx hardhat run scripts/deploy-lending-vault.js --network sepolia

# 3. Verify on Etherscan
npx hardhat verify --network sepolia <ADDRESS> <IFR_TOKEN> <GOVERNANCE>

# 4. Governance Proposals (in order):
#    - Proposal A: setFeeExempt(LendingVault, true)
#    - Proposal B: setIFRPrice(wei_per_1e9_IFR)
#    - Proposal C: setProtocolFeeReceiver(address)

# 5. Railway cron: checkHealth(loanId) every 4h
```

### Constructor Arguments

```solidity
constructor(
    address _ifrToken,    // Mainnet: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B
    address _governance   // Mainnet: 0xc43d48E7FDA576C5022d0670B652A622E8caD041
)
```

### IFR Price Format

```
ifrPriceWei = wei per 1e9 IFR (1 full token)
Example: 1 IFR = 0.000001 ETH → ifrPriceWei = 1e12
```

### Important Notes

1. **Set feeExempt BEFORE anyone deposits/borrows!**
2. **setIFRPrice via Governance** — needs 48h timelock
3. **Phase 2:** Replace manual price with Uniswap TWAP oracle
4. **Railway cron:** Call `checkHealth(loanId)` every 4h for all active loans
5. **Liquidation alert:** MarginCallWarning event → Telegram bot notification

---

## BuybackController.sol — AFTER LENDING

### Status
- [ ] Contract design
- [ ] Contract written
- [ ] Tests
- [ ] Deploy

### Design Notes
- Automated fee distribution from FeeRouterV1
- Split: BuybackVault + BurnReserve
- SOS reserve mechanism

---

## Deploy Order

1. **CommitmentVault** (ready now)
2. **LendingVault** (after CommitmentVault audit)
3. **BuybackController** (Phase 3+)

Each deploy follows: Sepolia → Audit → Mainnet → feeExempt Proposal

---

## UI Activation — After Contract Deploy

Both wiki pages have fully functional UIs that are currently in "Coming Soon" mode.
Activation requires changing **1 line per contract** — no other code changes needed.

### CommitmentVault UI (`docs/wiki/commitment-vault.html`)

**What already works:**
- Wallet connect → IFR balance + IFRLock status
- 4 condition types configurable (Time/Price/OR/AND)
- Tranche preview before locking
- "My Tranches" dashboard (loads from contract)
- Coming Soon overlay until contract is live

**ACTIVATION — change 1 line:**

```
File: docs/wiki/commitment-vault.html
Find: var CV_ADDR = "0x0000000000000000000000000000000000000000";
Replace: var CV_ADDR = "0x<REAL_MAINNET_ADDRESS>";
```

### LendingVault UI (`docs/wiki/lending-vault.html`)

**What already works:**
- 3 tabs: Lender / Borrower / Market Overview
- Wallet connect → IFR + ETH balance
- Loan preview calculator (interest + collateral + total repay)
- Interest rate curve table (2%–25% by utilization)
- Market stats grid
- Coming Soon overlay until contract is live

**ACTIVATION — change 1 line:**

```
File: docs/wiki/lending-vault.html
Find: var LV_ADDR = "0x0000000000000000000000000000000000000000";
Replace: var LV_ADDR = "0x<REAL_MAINNET_ADDRESS>";
```

### Post-Activation Checklist

After changing the addresses, complete these steps in order:

1. **Governance Proposal:** `setFeeExempt(CommitmentVault, true)` — BEFORE users lock
2. **Governance Proposal:** `setFeeExempt(LendingVault, true)` — BEFORE users deposit/borrow
3. **Governance Proposal:** `setP0(value)` — CommitmentVault, AFTER Bootstrap finalise
4. **Governance Proposal:** `setIFRPrice(value)` — LendingVault, AFTER Bootstrap finalise
5. **Ali Copilot:** Update contract addresses in `apps/ai-copilot/server/index.ts` (`PROTOCOL_ADDRESSES`)
6. **Railway:** Set `COMMITMENT_VAULT_ADDR` + `LENDING_VAULT_ADDR` as env vars
7. **TODO.md:** Mark deploy items as completed
8. **Telegram Bot:** Announce new contracts in @IFR_token channel

---

*This document is maintained by the IFR Protocol team.*
*For questions: GitHub Issues or Telegram @IFR_token*
*Last updated: 2026-04-04*
