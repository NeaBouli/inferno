# Security Policy

## Responsible Disclosure

Inferno ($IFR) is an open-source project.
Security findings are welcome from the community.

### How to Report

**Public issues must NOT contain undisclosed security vulnerabilities.**

GitHub **Private Vulnerability Reporting is enabled** for this repository.
Please report all security vulnerabilities privately via GitHub Security Advisories:
https://github.com/NeaBouli/inferno/security/advisories/new

This ensures confidential handling. We aim to respond promptly,
but no response time is guaranteed.

### What to Include (privately)

- **Impact:** what an attacker could do and what is at risk
- **Affected version/deployment:** commit, tag, or deployment (mainnet/testnet)
- **Reproducible evidence:** steps, PoC code, or transaction references
- **Suggested remediation:** how you would fix it (optional but welcome)

### Duplicates and Known Findings

Duplicates and findings already listed as known issues
(see below) are **not new findings**. Please check the known issues
list before reporting.

### Scope

- All first-party smart contracts under `/contracts/`, including
  CommitmentVault and LendingVault
- First-party production applications and APIs under `/apps/`
- Repository-controlled deployment, CI, and wallet-integration code

### Out of Scope
- Testnet-only issues without mainnet impact
- Issues already listed in docs/SECURITY_AUDIT_SKYWALKER.md (W1-W21)
- UI/frontend issues without security impact
- Gas optimization suggestions

### Known Issues
See [docs/SECURITY_AUDIT_SKYWALKER.md](docs/SECURITY_AUDIT_SKYWALKER.md)
for the complete internal audit (0 FAIL, 20 active WARN, 1 fixed, 81 PASS).

### No Bug Bounty
This project currently has no bug bounty program.
Community contributions are voluntary and credited in the audit docs.

### Hall of Fame
Community auditors who submit valid findings will be credited here.

| Auditor | Finding | Severity | Status |
|---------|---------|----------|--------|
| — | — | — | — |

## Scoped development-advisory dispositions

Production audits permit no advisories. The complete development audit remains
mandatory, with strict report, via-chain and development-node validation. Policy
`benefits-full52-policy-v2-reviewed-dev-20261028` temporarily permits the open,
unpatched `GHSA-gcqx-w48m-w2h4` only for the reviewed Benefits backend Jest-config
path. Canonical app/package identity, seven versions and four source hashes are
bound in `scripts/check-dev-advisory-exceptions.cjs`. The disposition expires after
2026-11-03 UTC; changed context, pins, range, package, unknown findings or production
placement fail closed. It is not a dependency fix or a global exception. Re-review
immediately when a fix or a changed test-input/CI-privilege boundary appears.
No automatic renewal or complete patched-version detection is provided.
