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
| ------- | ------- | -------- | ------ |
| —       | —       | —        | —      |

## Development-dependency audit policy

Production audits permit no advisories. Policy
`benefits-full52-policy-v4-supported-test-runners-20261029` retains mandatory
complete fresh production/development audits, strict report validation, complete
via-chain coverage and development-only node checks.

Benefits backend and Creator Gateway use the supported Vitest test runner instead
of the Jest/ts-jest development chains. Their deepmerge dispositions are removed;
`GHSA-gcqx-w48m-w2h4` is no longer accepted for either application or another
claimed context. The upstream advisory remains valid and unpatched; removing its
consumer graph is not a claim that deepmerge itself is fixed. Earlier version2/3
results and raw failures apply only to their original sources and policies.

The separate existing braces disposition and its range remain unchanged through
2026-11-03 UTC inclusive. It is not a deepmerge allowance or an automatic renewal.
Unknown findings, incomplete reports/development coverage, changed advisory range,
production placement and expired remaining exceptions fail closed. Stable ranges
do not establish that no upstream fix is available; recheck affected upstreams.
The checker preserves the actual evaluated full/production JSON bodies and hashes.
