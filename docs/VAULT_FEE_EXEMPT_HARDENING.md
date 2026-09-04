# Vault Fee-Exemption Invariant and Hardening Plan

Status: Monitoring and negative tests implemented; V2 hardening remains future work
Last verified: 4 September 2026 at Ethereum Mainnet block `25900438`

## Current Mainnet State

InfernoToken charges a total transfer fee of 3.5% on non-exempt transfers:
2.0% base burn, 0.5% extra burn, and 1.0% pool fee. CommitmentVault and
LendingVault account deposits and withdrawals at their nominal IFR amounts,
so both contracts rely on their token-side `feeExempt` status remaining active.

The invariant was healthy at block `25900438`:

| Contract | Fee exempt | Token balance | Internal accounting | Difference |
| --- | --- | ---: | ---: | ---: |
| CommitmentVault (`0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3`) | `true` | 47,952,476.871794375 IFR | `totalLocked`: 47,952,476.871794375 IFR | 0 IFR |
| LendingVault (`0x974305Ab0EC905172e697271C3d7d385194EB9DF`) | `true` | 52,155,440.952845656 IFR | `totalAvailable`: 52,155,440.952845656 IFR (`totalLent`: 0 IFR) | 0 IFR liquid surplus |

Token: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`

This snapshot means the reported fee mismatch is not present in the deployed
Mainnet state. It does not remove the operational dependency: governance must
not revoke either vault's exemption while V1 holds funds.

For LendingVault, the liquid custody invariant is `token balance >=
totalAvailable`. Outstanding `totalLent` is held by borrowers and is therefore
a receivable, not part of the vault's liquid token balance. The complete
principal asset comparison is `token balance + totalLent >= totalAvailable +
totalLent`, which reduces to the same liquid coverage check. Comparing the
vault balance directly to `totalAvailable + totalLent` would raise a false
alarm whenever a legitimate loan is active.

## Hardening Work

- [x] Monitor `feeExempt` for CommitmentVault and LendingVault.
- [x] Monitor CommitmentVault token balance against `totalLocked`.
- [x] Monitor LendingVault liquid token balance against `totalAvailable`, while
      reporting `totalLent` separately as a receivable.
- [x] Fail the scheduled operational check if an exemption is removed or
      liquid custody falls below accounting.
- [x] Add negative regression tests that remove each exemption and prove the
      resulting deposit/withdrawal behavior is detected and rejected by the
      operational safety gate.

Implementation: `scripts/check-vault-invariants.js`, deterministic test
`scripts/test-vault-invariants.cjs`, contract regressions `T46` and `T56`, and
the read-only scheduled workflow `.github/workflows/vault-invariant-monitor.yml`.
The monitor has no signer and cannot submit transactions.

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
