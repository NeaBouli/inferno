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
- [ ] Governance Proposal: `setFeeExempt(CommitmentVault, true)`
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

## LendingVault.sol — NEXT

### Status
- [ ] Contract design
- [ ] Contract written
- [ ] Tests written (target: 50+)
- [ ] Deploy Sepolia
- [ ] Audit
- [ ] Deploy Mainnet

### Design Notes
- IFR lending against ETH collateral
- Collateral: 200% initial, 150% margin call, 120% liquidation
- Interest rate: dynamic (0% util=2%, 100%=25%)
- Uniswap TWAP price oracle (24h average)
- Railway cron job (every 4h) for liquidation checks

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

*This document is maintained by the IFR Protocol team.*
*For questions: GitHub Issues or Telegram @IFR_token*
