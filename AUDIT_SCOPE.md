# Audit Scope — IFR Inferno Protocol

> Last updated: 12.03.2026
> Status: Open Community Audit (Phase 2)

## Overview

This document defines the audit scope for the IFR Inferno Protocol smart contracts
deployed on Ethereum Mainnet. It is intended for security researchers, auditors,
and community contributors performing security reviews.

## In Scope

### Core Contracts (Ethereum Mainnet)
| Contract | Address | Priority |
|---|---|---|
| InfernoToken | 0x77e99917Eca8539c62F509ED1193ac36580A6e7B | 🔴 Critical |
| FeeRouterV1 | 0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a | 🔴 Critical |
| BuybackVault | 0x670D293e3D65f96171c10DdC8d88B96b0570F812 | 🔴 Critical |
| BurnReserve | 0xaA1496133B6c274190A2113410B501C5802b6fCF | 🔴 Critical |
| IFRGovernance | 0xc43d48E7FDA576C5022d0670B652A622E8caD041 | 🟠 High |
| BootstrapVaultV3 | 0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141 | 🟠 High |
| IFRLock | 0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb | 🟡 Medium |
| LiquidityReserve | 0xdc0309804803b3A105154f6073061E3185018f64 | 🟡 Medium |
| Vesting | 0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271 | 🟡 Medium |
| PartnerVault | 0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D | 🟡 Medium |

### Key Attack Surfaces
- Fee-on-transfer mechanism (2.5% burn + 1% pool fee)
- feeExempt whitelist manipulation
- setPoolFeeReceiver routing
- FeeRouterV1 adapter whitelist
- BuybackVault parameter manipulation
- Governance proposal execution + Timelock delay
- Bootstrap finalise() permissionless execution

## Out of Scope
- Frontend (docs/index.html, wiki pages)
- Railway backend (AI Copilot)
- Telegram bot
- BootstrapVault V1 (deprecated)
- Testnet deployments (Sepolia)

## Known Issues / Accepted Risks
- Pre-FeeRouter pool fees (~21,000 IFR) remained in Deployer EOA — documented,
  not re-routed (see transparency.html)
- Proposals #1–#3 cancelled — intentional developer tests of Guardian functionality

## Previous Audit Results
- Internal review: 8 PASS, 2 WARN, 0 FAIL
- Full report: https://ifrunit.tech/wiki/security.html
- Responsible disclosure: GitHub Security Advisories

## Reporting
Found a vulnerability? Please report via:
- GitHub Security Advisories (preferred)
- Telegram: @IFRtoken (for non-critical issues)

**Please do not disclose vulnerabilities publicly before the team has had a chance
to address them.**

## Bounty
Bug bounty program planned for Phase 5. Currently no formal bounty —
recognition in BUILDERS.md and community acknowledgment for valid findings.
