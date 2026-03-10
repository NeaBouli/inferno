# Security Policy

## Responsible Disclosure

Inferno ($IFR) is an open-source project.
Security findings are welcome from the community.

### How to Report

**Public findings (Low/Informational):**
Open a GitHub Issue using the [Security Audit Finding template](.github/ISSUE_TEMPLATE/security-audit.md)

**Critical/High severity:**
Open a GitHub Issue marked `[PRIVATE]` — we will respond within 48h.
Or use [GitHub Security Advisories](https://github.com/NeaBouli/inferno/security/advisories/new) for confidential reporting.

### Scope

All contracts in `/contracts/`:
- InfernoToken.sol
- IFRLock.sol
- Governance.sol
- Vesting.sol
- LiquidityReserve.sol (v2)
- BuybackVault.sol (v2)
- BurnReserve.sol (v2)
- PartnerVault.sol
- FeeRouterV1.sol

### Out of Scope
- Testnet-only issues without mainnet impact
- Issues already listed in docs/SECURITY_AUDIT_SKYWALKER.md (W1-W12)
- UI/Frontend issues
- Gas optimization suggestions

### Known Issues
See [docs/SECURITY_AUDIT_SKYWALKER.md](docs/SECURITY_AUDIT_SKYWALKER.md)
for the complete internal audit (0 FAIL, 12 WARN, 78 PASS).

### No Bug Bounty
This project currently has no bug bounty program.
Community contributions are voluntary and credited in the audit docs.

### Hall of Fame
Community auditors who submit valid findings will be credited here.

| Auditor | Finding | Severity | Status |
|---------|---------|----------|--------|
| — | — | — | — |
