# Known Issues And Operational Boundaries

**Original inventory date:** 22 August 2026
**Scoped documentation reconciliation:** 12 November 2026

This file lists current limitations. Resolved historical build issues are kept
at the end. The canonical surface matrix is
[`CURRENT_FUNCTIONALITY_STATUS.md`](CURRENT_FUNCTIONALITY_STATUS.md).
This reconciliation does not refresh other dated chain figures, audit scopes
or the physical-device acceptance matrix.

## OPS-001 -- LendingVault V1 borrowing disabled

**Status:** OPEN / FAIL-CLOSED
**Severity:** Operational activation boundary

The retained contract-input snapshot `LendingVault.ifrPriceWei = 0` is dated,
not a fresh chain measurement. Official interfaces permanently retire
LendingVault V1 creation/increase and new borrowing under owner policy
(#209/#211), regardless of price. The underlying contract functions are not
removed. Offer reads, full-available lender withdrawal and existing-loan
repayment/top-up remain available.
V1 has no oracle freshness, post-activation pause, borrowing caps or borrower
allowlist. Do not activate borrowing by setting only a static price. The safe
path is a separately audited V2/oracle design with emergency controls.

## OPS-002 -- CommitmentVault price locks disabled

**Status:** OPEN / FAIL-CLOSED

Mainnet `CommitmentVault.priceOracle` is the zero address. TIME_ONLY tranches
are operational. PRICE_ONLY, TIME_OR_PRICE and TIME_AND_PRICE conditions must
remain unavailable until an oracle contract and its behavior are deployed,
audited and tested.

## OPS-003 -- Benefits physical wallet/device acceptance incomplete

**Status:** OPEN

The automated Benefits release gate passes, but the physical matrix is `1/10`
passed and `9` pending. iOS/iPadOS wallet paths, Android wallet paths, desktop
seller proof and an eligible APPROVED-to-REDEEMED path still require recorded
real-device evidence. See
`docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json`.

## OPS-004 -- Embedded wallet is a prototype

**Status:** DEFERRED

`apps/benefits-wallet-prototype` is isolated from production. The live Benefits
app uses external self-custody wallets. No embedded custody, recovery or key
management should be advertised as production functionality.

## OPS-005 -- Seller rewards require governance activation

**Status:** OPEN

Creating a public Benefits seller profile does not register a BuilderRegistry
builder or allocate PartnerVault rewards. Mainnet currently reports zero
registered and active builders. Reward wallets require explicit seller opt-in,
on-chain registration/allocation and authorized processing.

## OPS-006 -- SDK publication pending

**Status:** RESOLVED (2026-10-10)

`ifr-sdk` 0.4.1 is published on npm through the Trusted Publishing workflow
with SLSA provenance; 0.4.0 (9 October 2026) was the explicitly approved
one-time manual bootstrap without provenance. Later versions are published
only through the same workflow after a separate release gate; a version in
the repository must not be read as published.

## OPS-007 -- Dependency advisory monitoring

**Status:** MONITORING

The 2026-10-01 root audit result after `@nomicfoundation/hardhat-verify` 3.1.2
removed the Elliptic chain (#151) is historical, not a current
zero-vulnerability claim. The 12 November 2026 wallet-graph evidence below
still includes unresolved Zod3 advisories; a root gate does not clear those
separate graphs.

Audit acceptance must identify the exact source and lockfile, dependency
graph and FULL/production scope. Metadata findings do not establish installed
versions, emitted-code reachability or production exploitation. Do not apply
a forced incompatible update or infer an audit waiver; monitor upstream and
retain negative regression tests.

## OPS-008 -- Non-primary app modernization warnings

**Status:** OPEN / AUDIT AND QUALIFICATION HOLD

The 12 November 2026 evidence for [PR #434](https://github.com/NeaBouli/inferno/pull/434),
candidate `127c148be108d9bbbf1a8d0775bcbe9fdb649bc0`, is source-scoped:
Dashboard FULL and production metadata audits at 07:00-07:01 UTC each reported
18 High and 3 Low package entries, including propagated parents. These are
not distinct-advisory counts or proof of production exploitation. Zod3 High
and deepmerge Low findings remain; the candidate's Vite 6.4.5 copy was not
reported as affected in those two reports.

The candidate's owning Dashboard CI passed build and registry-signature
checks before its advisory gate failed. The prototype's advisory guard
reported 21 High entries; application and bundle-boundary tests were skipped.
These results are not complete CI, runtime, custody or device acceptance, and
do not close the separate wallet-provider graph or establish its emitted-code
reachability. The prototype remains isolated from production.

Deprecation notices, bundle size and the historical Creator Gateway test
cleanup warning remain separate modernization observations, not a substitute
for resolving advisory or qualification failures. No current Creator Gateway
test run or first production deployment is claimed here.

## Historical Resolved Issues

### BBV-001 -- Hardhat compile in `MockRouter.sol`

**Status:** RESOLVED

The mock now uses valid dynamic array allocation (`new uint256[](2)`).

### BBV-002 -- BuybackVault tests

**Status:** RESOLVED

Resolved after BBV-001. The current contract suite is covered by the repository
contract test gate.

### DEP-001 -- Governance dashboard `nanoid` advisory

**Status:** RESOLVED 22 August 2026

The transitive `nanoid` dependency was updated from `3.3.16` to `3.3.18` in
the governance-dashboard lockfile. Its package audit now reports zero
vulnerabilities and the production build passes.
