# Audit Submission — Inferno ($IFR)

This document prepares the submission for Code4rena or
Sherlock. Auditors will find all relevant information here.

## Project Overview

| Parameter | Value |
|-----------|-------|
| Project | Inferno ($IFR) |
| Network | Ethereum Mainnet (deployed 2026-03-05) |
| Language | Solidity 0.8.20 |
| Framework | Hardhat |
| Libraries | OpenZeppelin 5.x |
| Tests | 568 (99% Statement Coverage) |

## Audit Scope (In Scope)

The following contracts are in audit scope:

| Contract | Path | SLOC | Priority |
|----------|------|------|----------|
| PartnerVault | contracts/partner/PartnerVault.sol | 549 | High |
| FeeRouterV1 | contracts/FeeRouterV1.sol | 228 | High |
| BuybackVault | contracts/buyback/BuybackVault.sol | 175 | High |
| Governance | contracts/governance/Governance.sol | 150 | Medium |
| LiquidityReserve | contracts/liquidity/LiquidityReserve.sol | 151 | Medium |
| IFRLock | contracts/lock/IFRLock.sol | 127 | High |
| Vesting | contracts/vesting/Vesting.sol | 132 | Medium |
| BurnReserve | contracts/burnreserve/BurnReserve.sol | 92 | Low |
| InfernoToken | contracts/token/InfernoToken.sol | 93 | High |
| **Total** | | **1697** | |

## Out of Scope

- OpenZeppelin base contracts (ERC20, Ownable, ReentrancyGuard, Pausable)
- Uniswap V2 Contracts (Router, Factory, Pair)
- Test mocks (MockToken, MockRouter, MockAdapter, MockInfernoToken)
- Off-chain apps (Points Backend, AI Copilot, Creator Gateway, Benefits Network)

## Known Issues (not a finding)

| Issue | Justification |
|-------|---------------|
| LP not yet locked | Post-deploy — Mainnet: burn to 0xdead or Unicrypt lock |
| 9 Decimals | Intentional — IFR-specific |
| No Oracle | Phase 0 — USD pricing Phase 2+ |
| Fee-on-transfer breaks naive integrations | Documented — builders must check balanceOf |

## Critical Functions (Focus for Auditors)

### InfernoToken._update()
Fee-on-transfer logic. Critical: correct fee calculation,
no rounding exploit, fee-exempt correctly checked.

### IFRLock.lock() / unlock()
Token custody. Critical: no drain possible,
correct balance bookkeeping, reentrancy.

### PartnerVault.recordLockReward()
Emission logic. Critical: authorizedCaller,
anti-double-count, annualEmissionCap.

### FeeRouterV1.swapWithFee()
EIP-712 Voucher + Fee Routing. Critical:
replay protection, signer verification, discount clamp.

### Governance.propose() / execute()
Timelock logic. Critical: ETA calculation,
double execution, cancel logic.

## Code4rena Submission Checklist

- [x] GitHub repo public
- [x] README complete
- [x] Hardhat tests run: `npx hardhat test`
- [x] Coverage report: `npx hardhat coverage`
- [x] NatSpec comments for all public functions
- [x] Known issues documented (above)
- [x] Deployment addresses verified (Etherscan)
- [ ] Contest duration: 7-14 days recommended
- [ ] Prize pool: minimum $15,000 for serious auditors

## Bug Bounty (post-audit)

Planned: 5% of Treasury for critical mainnet findings.
Details: docs/SECURITY_POLICY.md

## Contact

GitHub: https://github.com/NeaBouli/inferno
Security: GitHub Security Advisories (private)

---
*Version 1.1 | March 2026*
