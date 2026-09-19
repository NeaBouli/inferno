# IFR Protocol — Claims Register (verify every entry, record Confirmed / Diverged / Unverifiable)

This project has a documented, actively-managed claims-drift problem
(`AUDIT_REPORT_20260314.md` lists 19 stale test-count locations). Each row: the claim, its dated
source, and how to verify it. Add new rows as you find new claims.

## Quantitative claims

| # | Claim | Source (dated) | Verify via |
|---|---|---|---|
| Q1 | "642 contract tests passing" | homepage, live 09/2026 | clone at pinned commit, `npm run test:contracts:all` |
| Q2 | "644 contract tests" / "91% branch coverage" | wiki index, 04/2026 | same run + coverage tool; note methodology (solidity-coverage vs Hardhat 3 native) |
| Q3 | "644 + 30 Generator Engine + 36 SDK" | FAQ | root + `test/builder/` + `test/sdk/` runs |
| Q4 | "544 tests, 99.45% stmts / 90.79% branch" | `docs/COVERAGE_REPORT.md`, 05.03.2026 — explicitly historical | do NOT present as current; check whether any live page still cites it |
| Q5 | "17 on-chain components / 17 contracts" | homepage, wiki index | count deployed mainnet contracts (14 protocol + LP pair + ?) — reconcile the number |
| Q6 | "16/16 contracts verified on Etherscan" | docs/DEPLOYMENTS.md | Etherscan API per address in contract-map.md |
| Q7 | Supply: 1,000,000,000 genesis; ~997.57M current; burned ~2.43M | copilot-api live 13.09.2026 | direct chain reads: `totalSupply()`, BurnReserve/token burn accounting |
| Q8 | LiquidityReserve: 200M held, 50M/90d cap, 0 withdrawn | lp-strategy page @ block 25918433 | chain reads at audit block |
| Q9 | Vault invariant snapshot: CommitmentVault 47,952,476.871794375; LendingVault 52,155,440.952845656, totalLent 0 | transparency page @ block 25900438 | chain reads; also re-run the repo's `vault-invariant-monitor.yml` logic |
| Q10 | C2 lock: 20,156,940.952845656 IFR, 10 TIME_ONLY tranches, unlock 29.07.2026 | transparency/homepage 29.06.2026 | CommitmentVault reads for `0x80fF32c5…B6958` |

## Security-process claims

| # | Claim | Source | Verify via |
|---|---|---|---|
| S1 | Slither: 21 production sources, 0 unreviewed High, 6 baselined High, 0 Critical | README + `audit/slither-high-baseline.json` (PR #77) | re-run Slither 0.11.5 / solc 0.8.28 at pinned commit; diff against baseline |
| S2 | Mythril: 17 concrete contracts, bounded, "no signals at any severity", 4 clean runs 04.09.2026 | README + `audit/mythril-config.json` | check `mythril-analysis.yml` CI run history (`gh run list`); optionally re-run |
| S3 | Internal audit "0 FAIL / 20 WARN (1 fixed) / 81 PASS" (Skywalker, Claude Opus 4.6, 04.03.2026) | `docs/SECURITY_AUDIT_SKYWALKER.md` | cross-check W1–W21 statuses against current source |
| S4 | App security review "12 findings (2 CRITICAL, 5 HIGH — all fixed)" | `docs/APP_SECURITY_REVIEW.md` | spot-check fixes in `apps/` |
| S5 | "All contracts governed by 48h timelock + Gnosis Safe multisig" | README header | chain reads: every `owner()`/`admin()`/`governance()`; **known exceptions: Governance.setGuardian is not timelocked and several guardians remain the Deployer EOA; BuybackController owner is Governance** — qualify the claim accordingly. |
| S6 | "No private keys in code / .env never committed" | `AUDIT_REPORT_20260316.md` | gitleaks at HEAD (`--config .gitleaks.toml`) |
| S7 | 4-hour vault-invariant monitor active | `vault-invariant-monitor.yml` | `gh run list` — recent runs green? |
| S8 | GitHub Actions pinned by full SHA; Node 22; gitleaks weekly; npm audit gates | `security-audit.yml` + 15 other workflows | read all workflow files; check run history |
| S9 | Branch protection: 1 approval + linear history | recon 09/2026 (`gh api repos/…/branches/main/protection`) | re-check; note: **no required status checks, enforce_admins=false** at recon |

## Product-state claims (fail-closed states are safety features — verify they are still closed)

| # | Claim | Source | Verify via |
|---|---|---|---|
| P1 | LendingVault borrowing disabled (`ifrPriceWei = 0`) | roadmap + KNOWN-ISSUES OPS-001 | chain read `ifrPriceWei()` |
| P2 | CommitmentVault price conditions unavailable (`priceOracle = 0x0`, `_getCurrentPrice()` stub returns 0) | contracts page + OPS-002 | chain read + source at pinned commit |
| P3 | Points system "designed, not yet live (Phase 3)" | wiki agent page | vs. points-api `/health` answering 200 — reconcile |
| P4 | No CEX address active; CEX fee policy approved 26.08.2026 (Council 4-1), activation needs TreasurySafe 3-of-5 + 48h | homepage + fee-design | token reads/events for recent `setFeeExempt`/CEX wiring |
| P5 | BuilderRegistry: 0 registered builders (OPS-005) | contracts page | chain read `getActiveBuilders()` |
| P6 | BootstrapVaultV3 FINALIZED; all 3 contributors claimed; LP retained in vault (no withdrawal fn) | homepage + bootstrap page | chain: vault state, LP token balance of pair held by vault |
| P7 | "Unlock always available, even when paused" (IFRLock) | contracts page | source + paused-state test |
| P8 | Team vesting: cliff ~05.03.2027, 36-month linear, beneficiary immutable, ~4.17M/month | vesting page | chain reads (`start: 1741168424` documented) |

## Documentation-consistency findings already known (confirm + extend)

1. Test-count drift: 642 vs 644 vs 544 across homepage/wiki/FAQ/press-kit.
2. Signer #1 naming conflict: "A.K." vs "G.M. (Kaspartizan)" for `0x6b36…ed67`.
3. contracts.html uses Sepolia addresses in mainnet reference examples.
4. LP phases: protocol-plan 150/100/150M vs tokenomics 100/100/100M.
5. Security page stale supply table (BootstrapVaultV3 200M vs ~1 wei live).
6. Tier tables: press-kit 1,000/5,000/25,000/100,000 vs lock-mechanism 1,000/2,500/5,000/10,000
   vs integration 1,000/5,000/25,000 — three variants for integrators.
7. "audited smart contract" wording on lending pages vs "third-party audit pending" elsewhere.
8. License: contracts `SPDX MIT` vs README "© 2026 All rights reserved", no LICENSE file.
9. Transparency page duplicates "3-of-5 active" text in the Safe table.
10. FAQ claims LiquidityVault.sol is "concept only, not deployed" — confirm it is absent from
    all address tables and the repo's deployed set.
11. `deployments/mainnet.json` records only BuybackController; authoritative mapping lives in
    `docs/DEPLOYMENTS.md` + README — tooling that trusts `deployments/` sees an incomplete truth.
12. `.env.example` contains `DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE` with comment
    "TODO: REMOVE after all governance transfers complete" — confirm placeholder-only, and
    assess whether the TODO's precondition has now been met.

## Reputation/external claims

- GeckoTerminal live; CoinGecko ticket CL0309260050 (04.09.2026, pending); CMC ticket 1390230
  (pending); Zerion live; Rainbow discoverable without icon. — reputation page; verify current
  listing state at audit time.
- Prior audits named as aspiration: Trail of Bits / OpenZeppelin / Consensys (security page) and
  Code4rena / Sherlock (`docs/AUDIT_SUBMISSION.md`) — none engaged at recon time. This report,
  once issued, becomes the first external review; the report template's disclaimer is mandatory.
