# Inferno ($IFR) — Project Whitepaper v1.0

## Executive Summary
IFR is a deflationary ERC-20 utility token on Ethereum.
Core idea: Users lock IFR tokens once and receive premium access to
builder products without recurring subscription payments. Access remains
active while the product's required IFR stays locked and that integration
remains available.
Every standard transfer between non-exempt addresses automatically burns 2.5%
of tokens permanently. The supply decreases as those transfers occur.

3 sentences for everyone:
- For users: Lock once and keep access active while the required IFR remains locked and the product integration remains available.
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
Access depends on each participating product's required IFR amount remaining locked
and that integration remaining available; a lock does not unlock every builder product.
IFRLock can be unlocked at any time — lock-based access ends and tokens are returned.
CommitmentVault tranches are separate locks and remain subject to their unlock conditions.

Analogy: Like a security deposit. You don't spend the money — you deposit it.
And as long as the deposit is in place, you're in.

---

## 3. Deflationary Mechanism

Every standard IFR transfer between non-exempt addresses automatically applies:
- 2.0% burned from sender (permanent)
- 0.5% burned from recipient (permanent)
- 1.0% to BuybackController since Proposal #21 (5 October 2026), previously FeeRouterV1
- Total: 3.5% per standard non-exempt transfer, of which 2.5% is real permanent burn

Maximum fee: 5% (enforced in the smart contract, immutable)
New minting: Impossible (no mint function in the contract)
Result: The supply can only decrease, never increase.

Example:
If you send 10,000 IFR, the recipient receives 9,650 IFR.
250 IFR are destroyed forever. 100 IFR go to the configured pool-fee receiver.
BuybackVault is dormant; no active buyback/burn flywheel is fed by this IFR pool fee.
BuybackController execution requires separate ETH funding and its configured execution conditions.

### Core Principle: Lock > Transfer

The fee structure is deliberately designed to reward holding and locking,
while penalizing frequent transferring:

- **Locking = 0% fee**: IFRLock, LiquidityReserve, BuybackVault, BurnReserve,
  and PartnerVault are feeExempt. Lock/unlock operations incur no fees.
- **Standard transferring = 3.5% fee**: Transfers between two non-exempt
  addresses apply the token fee.
- **Result**: Those who lock and hold IFR lose nothing. Standard transfers
  between non-exempt addresses apply the 3.5% fee.

### Fee-Exempt Addresses

| Contract | feeExempt | Reason |
|----------|-----------|--------|
| IFRLock | Yes | Lock/unlock without loss |
| LiquidityReserve | Yes | Staged release without burn |
| BuybackVault | Yes | ETH-to-IFR swap without double burn |
| BurnReserve | Yes | Deposit without additional burn |
| PartnerVault | Yes | Reward payout without loss |
| FeeRouterV1 | Yes | Fee routing without complication |

### Exchange Fee-Exemption Policy

On 26 August 2026 at 00:17 MET, the five-member Core Developer and Keyholder
Council approved full fee exemption by a 4-1 vote for transfers to and from officially verified
centralized-exchange operational addresses. Once an exact CEX address is
activated through TreasurySafe 3-of-5 Governance and the 48-hour timelock,
transfers where that address is sender or recipient bypass the entire 3.5%
fee.

No CEX address is currently active on-chain. Each exchange must first provide
its exact Ethereum addresses and prove control. Internal exchange trades are
off-chain ledger movements and never invoke the IFR token contract. The
public address register and activation process are defined in
`docs/EXCHANGE_FEE_EXEMPTION_POLICY.md`; integration details remain in
`docs/wiki/fee-design.html`.

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
| Builder Ecosystem | 4% | 40M | PartnerVault (partner rewards, not active; verified checkouts only) |

### Community Fair Launch Model (CFLM)

Fair Launch: No presale or VC rounds; the disclosed 15% team allocation is vested.
The public Bootstrap ended and finalized on 5 June 2026, creating the Uniswap V2 pool.

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
with a 12-month cliff. Until March 2027, not a single team token
can be released. Verifiable:
https://etherscan.io/address/0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271

---

## 5. Builder Ecosystem

### How Builders Earn IFR
Partner rewards are planned, not active; no pilot partner is activated:
1. Locks alone earn no rewards; Model B rewards verified checkout redemptions.
2. Partners require governance registration and a fixed allocation.
3. Per-period Governance `recordMilestone` is required for PartnerVault settlement.
4. Creating a seller profile does not activate rewards.

### IFR Benefits Network

Any business (online or offline) can use IFR lock as an access system:

- Merchants: no crypto knowledge needed, just a browser
- Customers: create a short-lived pass, review the exact seller offer and sign a proof that redeems that checkout once
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
No names or emails are required for the lock check; public wallet addresses are
processed as pseudonymous identifiers. A stateless resolver does not persist those queries.

**Off-Chain (Builder Apps)**
Each app decides independently what lock amount qualifies for premium access.
Integration: 5 lines of code. Fully decoupled.

---

## 8. Security

- Open source: All smart contracts public on GitHub
- Slither static analysis: 0 high/critical findings
- Full internal audits and public automated test evidence; current exact results belong to CI/release records, and an independent professional third-party audit remains pending
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
- Burned: 2,000,425+ IFR (0.20%+) — increases with standard non-exempt transfers

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
| Phase 0 — Bootstrap | Complete | Public Bootstrap finalized on 5 June 2026; Uniswap V2 IFR/WETH pool created |
| Phase 1 — Launch | Complete | Mainnet deployed (2026-03-05); 15 deployed protocol contracts plus 3 Gnosis Safes, including legacy and dormant components |
| Phase 2 — Multisig | Complete | Treasury, Community and LP Reserve Safes use 3-of-5 control |
| Phase 3 — Growth | In Progress | Web3 and Benefits public surfaces available; partner rewards inactive, independent professional third-party audit pending |
| Phase 4 — DAO | Long-term | Community governance |

---

## 11. For Builders: Why IFR?

- Real user retention: Users with locked tokens don't churn
- No subscription management: Lock on-chain, no backend needed
- Token incentives: 40M IFR PartnerVault pool; rewards require governance activation and are not active
- Simple integration: isLocked() — one API call
- Data minimization: lock checks process public wallet addresses as pseudonymous identifiers; no names or emails are required
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
