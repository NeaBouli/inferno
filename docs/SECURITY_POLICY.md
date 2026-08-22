# Security Policy — Inferno ($IFR)

## Responsible Disclosure

We take security seriously. If you find a vulnerability,
please follow this process — public issues must NOT contain undisclosed
security vulnerabilities.

### Reporting
- **GitHub:** https://github.com/NeaBouli/inferno/security/advisories/new
- **Private Vulnerability Reporting is enabled** for this repository
- **Response Time:** We aim to respond promptly, but no response time is guaranteed
- **Language:** English or German

### What we need (submitted privately):
- Description of the vulnerability and its potential **impact**
- **Affected version/deployment** (commit, tag, or mainnet/testnet deployment)
- **Reproducible evidence** (reproduction steps, PoC code, transaction references)
- Optional: **suggested remediation**

### Duplicates and Known Findings

Duplicates and findings already documented as known issues
(see AUDIT_BRIEF.md and the Known Design Decisions below)
are **not new findings**. Please check before reporting.

## Bug Bounty

**There is no bug bounty program.** The earlier testnet-phase and
post-mainnet bounty plans described in previous versions of this
document are not in effect. Community security reports are voluntary
and are credited in the Hall of Fame (see SECURITY.md).

## Scope

### In Scope (Mainnet + Sepolia):
- All first-party smart contracts under `contracts/`, including
  CommitmentVault and LendingVault
- First-party production applications and APIs under `apps/`
- Repository-controlled deployment, CI, and wallet-integration code

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
| Internal repository audits | Completed | Published findings and remediation records |
| Professional third-party audit | Pending | Independent engagement remains open |
| Contract Tests | 642 current | Passing in the 22 August 2026 clean audit |

Current browser, application and physical-device evidence is tracked separately
in [`CURRENT_FUNCTIONALITY_STATUS.md`](CURRENT_FUNCTIONALITY_STATUS.md).

## Contact

For urgent security issues: GitHub Security Advisory (private)
For general security questions: GitHub Discussions (public, non-sensitive only)

---
*As of: August 2026 | Version 1.2*
