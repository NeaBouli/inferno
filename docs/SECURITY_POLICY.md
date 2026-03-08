# Security Policy — Inferno ($IFR)

## Responsible Disclosure

We take security seriously. If you find a vulnerability,
please follow this process — do not post publicly before we
have responded.

### Reporting
- **GitHub:** https://github.com/NeaBouli/inferno/security/advisories
- **Response Time:** We respond within 48h
- **Language:** English or German

### What we need:
- Description of the vulnerability
- Reproduction steps
- Potential impact
- Optional: Suggested fix

## Bug Bounty Framework

During the testnet phase, we did not pay monetary bounties.
Now that mainnet is deployed (2026-03-05), the following applies:

| Severity | Examples | Recognition |
|----------|----------|-------------|
| Critical | Drain of locked tokens, mint bug | Hall of Fame + NFT |
| High | Governance bypass, replay attack | Hall of Fame |
| Medium | Parameter manipulation, DoS | Hall of Fame |
| Low | Info leak, minor logic error | GitHub Credit |

**Mainnet Bug Bounty:** Active post-launch (details to follow).
Target: 5-10% of a defined treasury budget for critical findings.

## Scope

### In Scope (Mainnet + Sepolia):
- contracts/token/InfernoToken.sol
- contracts/lock/IFRLock.sol
- contracts/partner/PartnerVault.sol
- contracts/FeeRouterV1.sol
- contracts/governance/Governance.sol
- apps/benefits-network/ (Backend + Frontend)
- apps/points-backend/

### Out of Scope:
- Third-party contracts (Uniswap V2, OpenZeppelin)
- Frontend UI bugs without security relevance
- Gas optimizations
- Known issues (see AUDIT_BRIEF.md)

## Known Design Decisions (Not a Bug)

| Topic | Decision | Rationale |
|-------|----------|-----------|
| 9 Decimals | Intentional (not 18) | IFR-specific |
| No Mint | Supply fixed at deployment | Deflationary by design |
| Single EOA Testnet | Phase 0 bootstrap | Multisig Phase 1+ |
| No Oracle | Phase 0 pricing | USD pricing Phase 2+ |
| rewardBps 1500 | 15% default | Governance-adjustable |

## Security Audit Status

| Audit Type | Status | Result |
|------------|--------|--------|
| Slither Static Analysis | Completed | 0 High/Critical |
| ChatGPT Independent Audit | 7/7 PASS | No critical findings |
| Professional Audit | Recommended | Code4rena / Sherlock |
| Contract Tests | 494 total | All passing |

## Contact

For urgent security issues: GitHub Security Advisory (private)
For general questions: GitHub Issues (public)

---
*As of: March 2026 | Version 1.1*
