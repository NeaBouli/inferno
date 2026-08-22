# Vault Fee-Exemption Invariant and Hardening Plan

Status: Open defense-in-depth work; no active accounting deficit observed  
Last verified: 22 August 2026 at Ethereum Mainnet block `25811214`

## Current Mainnet State

InfernoToken charges a total transfer fee of 3.5% on non-exempt transfers:
2.0% base burn, 0.5% extra burn, and 1.0% pool fee. CommitmentVault and
LendingVault account deposits and withdrawals at their nominal IFR amounts,
so both contracts rely on their token-side `feeExempt` status remaining active.

The invariant was healthy at block `25811214`:

| Contract | Fee exempt | Token balance | Internal accounting | Difference |
| --- | --- | ---: | ---: | ---: |
| CommitmentVault (`0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3`) | `true` | 47,952,476.871794375 IFR | `totalLocked`: 47,952,476.871794375 IFR | 0 IFR |
| LendingVault (`0x974305Ab0EC905172e697271C3d7d385194EB9DF`) | `true` | 52,155,440.952845656 IFR | `totalAvailable + totalLent`: 52,155,440.952845656 IFR | 0 IFR |

Token: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`

This snapshot means the reported fee mismatch is not present in the deployed
Mainnet state. It does not remove the operational dependency: governance must
not revoke either vault's exemption while V1 holds funds.

## Open Hardening Work

- [ ] Monitor `feeExempt` for CommitmentVault and LendingVault.
- [ ] Monitor CommitmentVault token balance against `totalLocked`.
- [ ] Monitor LendingVault token balance against `totalAvailable + totalLent`.
- [ ] Alert and stop operational execution if an exemption is removed or an
      accounting difference appears.
- [ ] Add negative regression tests that remove each exemption and prove the
      resulting deposit/withdrawal behavior is detected and rejected by the
      operational safety gate.

## V2 Design Requirement

A future vault version should measure actual token balance changes on inflow
instead of assuming the requested transfer amount was received. Balance-diff
accounting protects internal solvency when interacting with fee-on-transfer
tokens. It does not by itself protect users from a fee on outgoing transfers,
so V2 must also check the required exemption at runtime and fail closed before
affected deposit, withdrawal, offer, loan, repayment, lock, or unlock flows.

Any V2 requires a separate design review, migration plan, tests, audit, and
governance-approved deployment. The deployed V1 contracts are non-upgradeable;
there is no urgent migration while the verified invariant remains healthy.

## Traceability

- Existing audit finding: `M-03` in [Security Audit Report](SECURITY_AUDIT_REPORT.md)
- Community audit observation: section 4.1 in
  [Community Audit 2026-07-27](community-audits/IFR_Protocol_Audit_2026-07-27.md)
- Public reports triaged against Mainnet state:
  [#57](https://github.com/NeaBouli/inferno/issues/57),
  [#58](https://github.com/NeaBouli/inferno/issues/58), and
  [#59](https://github.com/NeaBouli/inferno/issues/59)

