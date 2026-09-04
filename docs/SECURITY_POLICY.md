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
| Slither Static Analysis | CI candidate | 21 production sources; 0 unreviewed High, 6 reviewed High signals baselined, 0 Critical signals reported by the pinned toolchain |
| Mythril Symbolic Analysis | CI candidate | 17 concrete production contracts; bounded to two transactions and 30 seconds per contract; 0 signals at any severity in the verified local run |
| Internal repository audits | Completed | Published findings and remediation records |
| Professional third-party audit | Pending | Independent engagement remains open |
| Contract Tests | 644 current | Passing in the 4 September 2026 local integration audit |

The machine-readable Slither baseline is
[`audit/slither-high-baseline.json`](../audit/slither-high-baseline.json). It
does not suppress analysis: CI fails if a High signal is new, changes, or
disappears without an explicit baseline review. One entry, the unchecked
ERC-20 return value in the already deployed `BuybackController.withdrawIFR()`
source, is retained as a future V2 hardening item.

The Mythril candidate is intentionally a separate path-scoped, weekly and
manual workflow. It uses a hash-locked Python dependency set with Mythril
0.24.8 and setuptools 80.10.2 plus a repository-pinned SHA-256 for the Linux
amd64 solc 0.8.28 artifact, rejects hidden
compiler/tool errors even when Mythril exits successfully, and gates every
Critical, High or Medium signal. Its bounded search is complementary evidence;
it is not a proof that every state or multi-transaction sequence is safe.

Current browser, application and physical-device evidence is tracked separately
in [`CURRENT_FUNCTIONALITY_STATUS.md`](CURRENT_FUNCTIONALITY_STATUS.md).

## Contact

For urgent security issues: GitHub Security Advisory (private)
For general security questions: GitHub Discussions (public, non-sensitive only)

---
*As of: August 2026 | Version 1.2*
