# Known Issues And Operational Boundaries

**Updated:** 22 August 2026

This file lists current limitations. Resolved historical build issues are kept
at the end. The canonical surface matrix is
[`CURRENT_FUNCTIONALITY_STATUS.md`](CURRENT_FUNCTIONALITY_STATUS.md).

## OPS-001 -- LendingVault V1 borrowing disabled

**Status:** OPEN / FAIL-CLOSED
**Severity:** Operational activation boundary

Mainnet `LendingVault.ifrPriceWei` is `0`. Lenders can create and withdraw
offers, and all offers remain readable, but borrow transactions are disabled.
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

**Status:** OPEN

The IFR SDK builds and passes local package-consumer tests. Public npm
publication remains a separate release action and must not be inferred from the
repository package.

## OPS-007 -- Dependency advisory monitoring

**Status:** MONITORING

Root dependency audit reports 8 low transitive development-tool findings and
no moderate, high or critical findings. The remaining Elliptic advisory in the
Hardhat verification dependency path has no available upstream fix. Runtime
frontends and the Benefits backend report zero audit findings. Do not apply a
forced incompatible update; monitor upstream and retain negative regression
tests.

## OPS-008 -- Non-primary app modernization warnings

**Status:** OPEN / LOW PRIORITY

The token dashboard and isolated embedded-wallet prototype build successfully
and report zero audit vulnerabilities, but their dependency trees emit
deprecation notices for older MetaMask/WalletConnect support packages. Their
production bundles also exceed Vite's default 500 kB chunk warning. The Creator
Gateway's 41 tests pass, but Jest reports an open-handle cleanup warning after
completion. These are tracked modernization/performance/test-hygiene items;
they do not change the live Web3 or Benefits release gates.

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
