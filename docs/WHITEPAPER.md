# Inferno ($IFR) — Project Whitepaper v1.0

## Executive Summary
IFR is a deflationary ERC-20 utility token on Ethereum.
Core idea: Users lock IFR tokens once and receive permanent premium
access to builder products — no subscriptions, no recurring payments.
Every transfer automatically burns 2.5% of tokens permanently.
The supply decreases with every transaction.

3 sentences for everyone:
- For users: Lock once, access forever.
- For builders: Acquire loyal users who have real skin in the game.
- For the protocol: More utility = more locking = less supply = more scarcity.

---

## 1. The Problem

Subscription fatigue: Users pay monthly for dozens of services.
Churning: Platforms lose users as soon as payments stop.
No real commitment: Users have no economic incentive to stay.
Tokens without utility: Most crypto tokens have no real use case.

---

## 2. The Solution: Lock-to-Access

Inferno introduces a new access model:

Instead of paying monthly, users lock IFR once (Lock).
Locked tokens remain the property of the user.
As long as locked, automatic premium access to all builder products.
Unlocking is possible at any time — access ends, tokens returned.

Analogy: Like a security deposit. You don't spend the money — you deposit it.
And as long as the deposit is in place, you're in.

---

## 3. Deflationary Mechanism

Every IFR transfer automatically burns tokens:
- 2.0% burned from sender (permanent)
- 0.5% burned from recipient (permanent)
- 1.0% to protocol pool
- Total: 3.5% per transfer, of which 2.5% is real permanent burn

Maximum fee: 5% (enforced in the smart contract, immutable)
New minting: Impossible (no mint function in the contract)
Result: The supply can only decrease, never increase.

Example:
If you send 10,000 IFR, the recipient receives 9,650 IFR.
250 IFR are destroyed forever. 100 IFR go to the pool.

### Core Principle: Lock > Transfer

The fee structure is deliberately designed to reward holding and locking,
while penalizing frequent transferring:

- **Locking = 0% fee**: IFRLock, LiquidityReserve, BuybackVault, BurnReserve,
  and PartnerVault are feeExempt. Lock/unlock operations incur no fees.
- **Transferring = 3.5% fee**: Every normal transfer burns tokens.
- **Result**: Those who lock and hold IFR lose nothing. Those who trade
  constantly lose 3.5% on every transfer.

### Fee-Exempt Addresses

| Contract | feeExempt | Reason |
|----------|-----------|--------|
| IFRLock | Yes | Lock/unlock without loss |
| LiquidityReserve | Yes | Staged release without burn |
| BuybackVault | Yes | ETH-to-IFR swap without double burn |
| BurnReserve | Yes | Deposit without additional burn |
| PartnerVault | Yes | Reward payout without loss |
| FeeRouterV1 | Yes | Fee routing without complication |

### CEX Compatibility

Fee-on-transfer is compatible with centralized exchanges (CEX) but requires
adaptation: the CEX must check the actually received amount
(balanceOf after transfer), not the sent amount.
Integration guide: docs/wiki/fee-design.html

---

## 4. Token Economics

Total supply: 1,000,000,000 IFR (1 billion, one-time, no minting)

| Category | % | Amount | Purpose |
|----------|---|--------|---------|
| DEX Liquidity | 40% | 400M | Trading & liquidity |
| Liquidity Reserve | 20% | 200M | Staged release (6-month lock) |
| Team (Vested) | 15% | 150M | 48-month vesting, 12-month cliff |
| Treasury | 15% | 150M | Protocol development |
| Community & Grants | 6% | 60M | Ecosystem building |
| Builder Ecosystem | 4% | 40M | PartnerVault (lock-triggered rewards) |

### Community Fair Launch Model (CFLM)

Fair Launch: No presale, no VC rounds, no insider advantages.

Why? Most token projects sell early to VCs and insiders —
who then immediately sell (dump) at launch. Inferno does the opposite:

- **No presale**: No tokens were sold before the public launch
- **No seed / private round**: No special conditions for early investors
- **No VC allocation**: No venture capital firms with preferential tokens
- **100% distributed on-chain**: All allocations visible, all vesting periods enforced by smart contracts

Comparison with other projects:

| Project | Presale? | VC Share | Community Share |
|---------|----------|----------|-----------------|
| Uniswap (UNI) | No | 18% | 60% |
| Aave (AAVE) | Yes | 23% | 77% |
| Compound (COMP) | Yes | 24% | 42% |
| **Inferno (IFR)** | **No** | **0%** | **46% (40% DEX + 6% Grants)** |

Team tokens (15%) are secured by a 4-year vesting contract
with a 12-month cliff. Until January 2027, not a single team token
can be released. Verifiable:
https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271

---

## 5. Builder Ecosystem

### How Builders Earn IFR
When a user locks IFR for a builder's product:
1. The builder automatically receives a percentage of the locked amount
2. Reward rate: 10-20% (policy target), hard bounds 5-25%
3. Rewards vest linearly over 6-12 months
4. Annual emission limit: 4M IFR (bounds: 1-10M)

Why deflationary: Users always lock more IFR than builders receive.
At 15% reward: 1,000 IFR locked -> 150 IFR reward -> net 850 IFR more bound.

### IFR Benefits Network
Any business (online or offline) can use IFR lock as an access system:
- Merchants: no crypto knowledge needed, just a browser
- Customers: scan QR -> connect wallet -> sign -> done
- System checks on-chain whether the customer has locked IFR

Example tiers (recommended, freely configurable):
- Bronze: 1,000 IFR locked -> 5% discount
- Silver: 2,500 IFR -> 10% discount
- Gold: 5,000 IFR -> 15% discount
- Platinum: 10,000 IFR -> 20% discount

---

## 6. Governance

How protocol changes work:
- No immediate admin access (nobody can change anything instantly)
- Every change: 48-hour public waiting period (timelock)
- Guardian role can stop any change during the 48h window
- No token voting (protection against whale manipulation)

Upgrade path:
- Phase 1: Timelock governance (single admin)
- Phase 2: Multisig (Gnosis Safe)
- Phase 3: Multisig expansion + guarded automation
- Phase 4: DAO with community voting

---

## 7. Technical Architecture

3 layers, cleanly separated:

**On-Chain (Truth Layer)**
IFRLock contract on Ethereum: stores who has locked how much IFR.
Single source of truth. No app knowledge, no user IDs.

**Bridge Layer (Stateless)**
License Resolver: translates wallet queries into access checks.
Privacy-neutral: no personal data stored.

**Off-Chain (Builder Apps)**
Each app decides independently what lock amount qualifies for premium access.
Integration: 5 lines of code. Fully decoupled.

---

## 8. Security

- Open source: All smart contracts public on GitHub
- Slither static analysis: 0 high/critical findings
- 568 tests (521 protocol + 47 ecosystem), all passing, 99% statement coverage
- Professional third-party audit: recommended as next security milestone
- Timelock: 48h mandatory waiting period on all changes
- No minting: technically impossible after launch

---

## 9. On-Chain Transparency (as of March 2026)

### Token Supply Distribution (verified)
- LP Pair: 400,000,000 IFR (40.08%)
- LiquidityReserve: 200,000,000 IFR (20.04%)
- Team Vesting: 150,000,000 IFR (15.03%) — 4 years, 0 released
- Treasury/Community: 169,387,995 IFR (16.97%)
- PartnerVault: 40,000,000 IFR (4.01%)
- Burned: 2,000,425+ IFR (0.20%+) — increases with every transfer

### Deflation in Action
Since deployment, 2,000,425+ IFR have been permanently destroyed.
Across 367 automated contract tests, real transfers were executed —
each of which confirmed the deflation mechanism on-chain.

### Verification
All values can be verified directly via scripts/onchain-audit.js.
No trust required — only code and chain.

---

## 10. Roadmap

| Phase | Status | Content |
|-------|--------|---------|
| Phase 0 — Bootstrap | Complete | Sepolia testnet, all contracts live |
| Phase 1 — Launch | Complete | Mainnet deployed (2026-03-05), 14 on-chain components verified |
| Phase 2 — Multisig | In Progress | Governance migration to Gnosis Safe |
| Phase 3 — Growth | Planned | Ecosystem expansion, Benefits Network, guarded automation |
| Phase 4 — DAO | Long-term | Community governance |

---

## 11. For Builders: Why IFR?

- Real user retention: Users with locked tokens don't churn
- No subscription management: Lock on-chain, no backend needed
- Token incentives: Builders receive IFR from the 40M builder pool
- Simple integration: isLocked() — one API call
- Privacy: No wallet data stored
- Permissionless: Anyone can integrate

Interested? See docs/PARTNER_INTEGRATION_SPEC.md

---

## 12. Contact & Links

| | |
|-|-|
| GitHub | https://github.com/NeaBouli/inferno |
| Website | https://ifrunit.tech/ |
| Docs | https://ifrunit.tech/wiki/ |
| X / Twitter | https://x.com/IFRtoken |
| Mainnet Token | 0x77e99917Eca8539c62F509ED1193ac36580A6e7B |
| Mainnet Governance | 0xc43d48E7FDA576C5022d0670B652A622E8caD041 |

---
*Inferno ($IFR) — Community Fair Launch Model*
*As of: March 2026 | Version 1.0*
