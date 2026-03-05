# Inferno ($IFR) -- Tokenomics Model & Simulations

## Base Parameters

| Parameter | Value |
|-----------|-------|
| Initial Supply | 1,000,000,000 IFR |
| Burn Rate | 2.5% per transfer |
| Pool Fee | 1.0% per transfer |
| Total Transfer Fee | 3.5% |
| Max Fee Cap | 5.0% (hard-coded) |
| Decimals | 9 |

## Deflation Mechanism

Every transfer permanently burns 2.5%:
- Transfer: 1,000 IFR
- Recipient receives: 965 IFR (after 3.5% fee)
- Burned: 25 IFR (permanent)
- Pool: 10 IFR (BuybackVault/PartnerPool)

### Deflation Curve (Simulation)

Assumption: 100,000 transfers/year at average of 1,000 IFR

| Year | Transfers | Burned/Year | Supply End |
|------|-----------|-------------|------------|
| 1 | 100,000 | 2,500,000 | 997,500,000 |
| 2 | 120,000 | 3,000,000 | 994,500,000 |
| 3 | 150,000 | 3,750,000 | 990,750,000 |
| 5 | 200,000 | 5,000,000 | 980,000,000 |
| 10 | 300,000 | 7,500,000 | 940,000,000 |

*Conservative assumptions. Higher volume leads to stronger deflation.*

## Token Allocation

| Category | % | IFR | Purpose |
|----------|---|-----|---------|
| DEX Liquidity | 40% | 400,000,000 | Uniswap V2 LP |
| Reserve | 20% | 200,000,000 | Ecosystem reserve |
| Team | 15% | 150,000,000 | Vesting 12-48 months |
| Treasury | 15% | 150,000,000 | Governance-controlled |
| Community & Grants | 6% | 60,000,000 | Ecosystem growth |
| Partner Ecosystem | 4% | 40,000,000 | PartnerVault (Creator Rewards) |

## PartnerVault Emission Model

### Parameters (Mainnet):
- rewardBps: 1000 (10%)
- annualEmissionCap: 4,000,000 IFR
- PartnerPool: 40,000,000 IFR total

### Runtime Simulation:
At a constant annualEmissionCap of 4M IFR:
- Pool lasts: 40M / 4M = **10 years**
- With rewardBps reduction to 10%: longer
- With Algo-Throttle: automatic extension

### Creator Reward Example:
- User A locks: 10,000 IFR
- Creator B rewardBps: 1000 (10%)
- Creator B Reward: 1,000 IFR (from PartnerPool)
- Net Effect: 10,000 locked - 1,000 reward = 9,000 net deflationary

**Important: Reward < Lock -> always net deflationary**

## Lock Economics

### Tier Thresholds:
| Tier | Min Lock | Benefits |
|------|----------|----------|
| Bronze | 1,000 IFR | Partner discounts |
| Silver | 2,500 IFR | Increased discounts |
| Gold | 5,000 IFR | Premium benefits |
| Platinum | 10,000 IFR | Maximum benefits |

### Lock Supply Effect:
With 5% of user wallets locking (conservative):
- Assumption: 10,000 active wallets, 5% = 500 lockers
- Average lock: 3,000 IFR
- Total locked: 1,500,000 IFR = 0.15% of supply
- Effectively removed from market: permanently (until unlock)

## FeeRouter Protocol Fee

| Scenario | Fee | Value at $1 Swap |
|----------|-----|------------------|
| Standard | 5 bps (0.05%) | $0.0005 |
| With Voucher (max) | 0 bps | $0.00 |
| Maximum (Cap) | 25 bps (0.25%) | $0.0025 |

**Fee revenue goes to feeCollector (Governance-controlled)**

## Bootstrap Pricing (Phase 0)

- No oracle, no TWAP, no USD price set by the project
- Price determined by market (DEX AMM)
- Phase 2+: USD pricing when sufficient LP is available
- Currently: Token-denominated pricing mechanisms

---
*Date: March 2026 | Version 1.1 | All numbers: Simulation/Illustration | Mainnet Live*
