# Documentation Truth Matrix — 2026-09-27

**Repository baseline:** `e4a1a75f` (`origin/main`, #124)
**Scope:** repository evidence only. No chain reads, no live HTTP probes, no new finding IDs.
Evidence is attached to existing register entries CWA-20, CWA-55 and CWA-70.
**Guard:** `npm run test:docs-truth`

| Claim under test | Result | Canonical value and evidence |
| --- | --- | --- |
| 17 vs 16 on-chain components | **17 confirmed, definition-bound** | 14 protocol contracts (`deployments/mainnet.json`, `docs/DEPLOYMENTS.md` table) + 3 Gnosis Safes (Treasury `0x5ad6…cE3b`, Community `0xaC56…67C7`, LP Reserve `0x5D93…6C04`). LP pair, BootstrapVault V1, router and EOAs are not counted. "16 (13 + 3)" is the pre-BuybackController snapshot (before 14.04.2026) and was stale in `docs/STATUS-REPORT.md`. |
| "17 protocol contracts" / "17 immutable contracts" | **Diverged, corrected** | The 3 Safes are Safe proxy wallets. Wiki FAQ, security and fair-launch pages now say 14 protocol contracts. |
| Safe-address coverage | **Diverged, corrected** | Before: README and `docs/DEPLOYMENTS.md` listed only the Treasury Safe; the landing list showed 2 Safes and 13 contracts (BuybackController missing) under "14 + 3 = 17". All three surfaces now list the full set. Thresholds are documented 3-of-5 and were not re-read on chain here. |
| 642 contract tests | **Historical, not current** | `npm run test:contracts:all` at `e4a1a75f`: **644 passing** + Generator 30/30 + SDK 36/36. 642 appears only in dated records (`SKYWALKER.md` 29.07.2026, `docs/DEPENDENCY_UPGRADES.md`). Register `canonicalTests.contracts` = `644/644` matches. |
| Browser suite counts (found during this pass) | **Diverged, corrected** | `npm run test:wallet-connect` **24 passed** and `npm run test:web3-write` **27 passed** at `e4a1a75f`; register, README, status reports, `llms.txt` and Copilot knowledge said Landing/Wiki 20/20 and Web3 24/24. |
| 91% vs 84.65% branch coverage | **Both historical; current branch figure not reproducible** | 84.65% = solidity-coverage 26.02.2026 (`docs/DOCS.md`); 90.79% (rounded 91%) = solidity-coverage 05.03.2026, 544 tests, 9 contracts (`docs/COVERAGE_REPORT.md`). Current `npx hardhat test --coverage` (Hardhat 3 native) reports lines/statements only: 96.06% lines / 95.11% statements over 26 files incl. mocks, 644 passing. No current branch figure is published. |
| Four vs seven live apps | **Both true under different definitions** | 4 public user surfaces (Landing, Wiki, Web3, IFR Benefits) run as 7 deployment units (Pages, Web3, Benefits FE, Benefits BE, Points, Copilot, Telegram/verify-api). Evidence per unit in `docs/CURRENT_FUNCTIONALITY_STATUS.md`. Live health not asserted. Creator Gateway has no deployment record. |

## Unresolved (kept unresolved)

- CWA-23: tx/deployer/timestamp provenance for 13 of 14 Mainnet contracts remains `null`.
- Sepolia table row 11 (`BuybackController`) in `docs/DEPLOYMENTS.md` shows the address that is the
  Mainnet BurnReserve (`0xaA14…6fCF`). Provenance cannot be settled from repository evidence;
  not changed.
- Safe thresholds/owners and "all verified on Etherscan" were not re-read on chain in this pass.
- Dated historical records (audit prompts, release notes, changelogs, archived reports) keep their
  original figures by design.

## Follow-up 2026-10-05 — component count 18

CommitmentVault V2 (`0x8efa…7c8F`, CV-01 repair, fee-exempt since Governance proposal #17) joined
the counted list as the 15th protocol contract: **15 protocol contracts + 3 Gnosis Safes = 18
documented on-chain components**. The count lists deployed components; it is not a claim that all of
them are active (CommitmentVault V1 stays listed as legacy with its V1 unlock path; LendingVault V1
is retired). `deployments/mainnet.json`, `docs/DEPLOYMENTS.md`, README, landing, wiki, `llms.txt`
and Copilot knowledge now state 18; `npm run test:docs-truth` enforces 15 + 3 = 18. The figures in
the matrix above are the dated 2026-09-27 values and stay unchanged.
