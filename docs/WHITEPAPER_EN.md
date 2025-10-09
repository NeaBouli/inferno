# 🔥 Inferno – Whitepaper (EN)

## Abstract
Inferno ($IFR) is a deflationary token on an EVM-compatible network. Supply reduction is achieved through fee-based burns on transfers and an on-chain buyback mechanism that uses treasury funds to repurchase IFR and (partially) burn it. Governance (multi-sig/DAO) controls parameters via timelocks.

## 1. Rationale & Goals
- **Deflation:** Predictable, transparent reduction of circulating supply.
- **Transparency:** On-chain, auditable burns & buybacks.
- **Security:** Clear roles (Governor/Guardian), pausability, parameter control.

## 2. Token Specification
- **Name/Ticker:** Inferno / IFR  
- **Decimals:** 9  
- **Total Supply:** 1,000,000,000 IFR (fixed)  
- **Chain:** EVM-compatible L2/sidechain (Kasplex/Kaspa EVM planned)  
- **Source of truth:** On-chain contracts & events.

## 3. Fees & Burn Mechanics
- **Standard transfer fees:**  
  - SenderBurn: **2.0%**  
  - RecipientBurn: **0.5%**  
  - PoolFee: **1.0%** (for buyback/treasury)  
- **FeeExempt:** Certain addresses (presale, vesting, treasury) can be exempted.  
- **Invariants:** Sum of fee parts ≤ max fee budget; deterministic rounding.  
- **Events:** `FeesApplied(senderBurn, recipientBurn, poolFee)` + `Transfer`.

## 4. Presale (Fixed Price)
- **Function:** ETH ➜ IFR at fixed `TOKEN_PRICE`.  
- **Traits:** Caps/phases optional; reentrancy-safe; pausable.  
- **FeeExempt:** Token distribution is not reduced by fees.  
- **Treasury:** Receives ETH directly; presale is not a long-term custodian.

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
- **MS-1:** Token core + presale + vesting (stable ABIs)  
- **MS-2:** Governance live (timelock/roles)  
- **MS-3:** Indexer + backend v1 (staging)  
- **MS-4:** Buyback vault integrated, dry-run passed (**current: tests 🔴**)  
- **MS-5:** Public launch (explorer, observability, compliance notes)

## 11. Compliance & Notes
- This document is **not investment advice**.  
- Legal/tax review of presale flows and UI texts per jurisdiction is recommended.  
- Geo-fencing/KYC optional depending on market.

## 12. Summary
Inferno combines predictable **fee-burn** with an **active buyback** under governance control. The aim is a long-term deflationary, transparent token ecosystem with well-defined parameters and security gates.
