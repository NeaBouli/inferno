# Inferno – Whitepaper (EN)

> **DEPRECATED** — This document reflects the initial draft from September 2025 and is no longer accurate. The project has since migrated to the Community Fair Launch Model (CFLM) — no presale, no VC, no IDO. The current whitepaper is [WHITEPAPER.md](WHITEPAPER.md) (German). For an up-to-date English overview, see the [Landing Page](https://neabouli.github.io/inferno/) or the [Technical Wiki](https://neabouli.github.io/inferno/wiki/).

## Abstract
Inferno ($IFR) is a deflationary ERC-20 token on Ethereum. Supply reduction is achieved through fee-based burns on transfers (2.5% per transfer) and an on-chain buyback mechanism. Governance controls parameters via a 48-hour timelock. The token serves as a universal utility lock: users lock IFR on-chain to access lifetime premium features across partner products.

## 1. Rationale & Goals
- **Deflation:** Predictable, transparent reduction of circulating supply.
- **Transparency:** On-chain, auditable burns & buybacks.
- **Security:** Clear roles (Governor/Guardian), pausability, parameter control.

## 2. Token Specification
- **Name/Ticker:** Inferno / IFR  
- **Decimals:** 9  
- **Total Supply:** 1,000,000,000 IFR (fixed)  
- **Chain:** Ethereum (Mainnet)
- **Source of truth:** On-chain contracts & events.

## 3. Fees & Burn Mechanics
- **Standard transfer fees:**  
  - SenderBurn: **2.0%**  
  - RecipientBurn: **0.5%**  
  - PoolFee: **1.0%** (for buyback/treasury)  
- **FeeExempt:** Certain addresses (vesting, treasury, IFRLock) can be exempted.
- **Invariants:** Sum of fee parts ≤ max fee budget; deterministic rounding.  
- **Events:** `FeesApplied(senderBurn, recipientBurn, poolFee)` + `Transfer`.

## 4. Fair Launch (CFLM)
- **Model:** Community Fair Launch — no presale, no VC, no IDO.
- **Distribution:** 100% of supply allocated at deployment (40% DEX, 20% Reserve, 15% Team vested, 15% Treasury, 6% Community, 4% Partner Ecosystem).
- **FeeExempt:** Token distribution is not reduced by fees.

## 5. Vesting
- **Model:** Cliff + linear release; `release()` by beneficiaries.  
- **FeeExempt:** Vesting transfers are exempt.  
- **Rounding:** Deterministic; tested for edge cases.  
- **Events:** `Released(beneficiary, amount)`.

## 6. BurnReserve
- **Purpose:** Temporarily holds and finally burns tokens.  
- **Control:** Governance only (timelock/multi-sig).  
- **Event:** `Burned(amount, caller)`.

## 7. Buyback Vault & Strategy
- **Vault:** Accepts ETH/funds; `execute()` performs DEX swaps (e.g., UniswapV2).  
- **Strategy parameters:**  
  - Slippage limit (default **5%**, adjustable)  
  - Cooldown (min. **1h**)  
  - Burn/treasury split (default **50/50**, 0–100%)  
- **Events:** `BuybackExecuted(ethIn, ifrOut, burned, toTreasury)`.  
- **Roles:** Governor (parameters), Guardian (pause).  
- **Security:** Reentrancy protection, router quote checks, fail-safes.

## 8. Governance
- **Roles:** Governor (multi-sig/DAO), Guardian (emergency pause).  
- **Timelock:** Parameter updates with delay and on-chain accountability.  
- **Upgrades:** Strategy replacement (vault ↔ strategy).  
- **Process:** ADRs record each relevant change.

## 9. Security & Testing
- **Tooling:** Slither, Mythril, Echidna/fuzzing, gas reports.  
- **Invariants:** Fee sums, fee-exempt lists, vesting rounding.  
- **Integration:** Fork tests with DEX router; buyback dry-runs.  
- **Audits:** Third-party audits recommended pre-launch.

## 10. Roadmap & Milestones
- **MS-1:** Token core + vesting + fair launch (stable ABIs)
- **MS-2:** Governance live (48h timelock, guardian)
- **MS-3:** IFRLock + PartnerVault + FeeRouter deployed
- **MS-4:** Testnet deployment (Sepolia, all verified)
- **MS-5:** Mainnet launch (audit, multisig, deployment)

## 11. Compliance & Notes
- This document is **not investment advice**.  
- Legal/tax review of token mechanics and UI texts per jurisdiction is recommended.
- Geo-fencing/KYC optional depending on market.

## 12. Summary
Inferno combines predictable **fee-burn** with an **active buyback** under governance control. The aim is a long-term deflationary, transparent token ecosystem with well-defined parameters and security gates.
