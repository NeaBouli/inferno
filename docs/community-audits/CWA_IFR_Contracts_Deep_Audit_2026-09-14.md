# IFR Protocol — Contract Deep Security Audit

**Auditor:** Collateral Web3 Open Audits
**Client:** NeaBouli / Inferno Protocol (ifrunit.tech)
**Date:** 2026-09-14
**Baselines:** repo `NeaBouli/inferno` @ `eb538a355001b042b343bfb19221af2407a96e63` · Ethereum
mainnet block **25971217** (pinned 2026-09-13T21:29:57Z) · Foundry 1.7.1 · Slither 0.11.5 ·
Mythril 0.24.8 · solc 0.8.20 (`a1b79de6`) / 0.8.28
**Companion documents:** `CWA_IFR_Protocol_Audit_2026-09-14.md` (full-scope audit, CWA-01…24),
`CWA_IFR_Surfaces_Supplement_2026-09-14.md` (remaining app surfaces, CWA-28+)
**Report version:** 1.0

> **Editorial correction — 2026-09-19:** the original summary counted two
> Informational findings although this report registers CWA-25…CWA-27 as one
> Medium, one Low and one Informational finding. The aggregate below is
> corrected; no finding text, severity label or technical conclusion changed.

This document is the contract-focused deep audit: proof-grade verification of the 14 deployed
mainnet contracts. Where the full-scope audit reviewed behavior, this audit proves it — with
reproduced tool runs, fuzzed invariants, bytecode comparison against deployed code, and
block-pinned chain reads.

---

## 1. Executive summary

All six evidence layers were executed end-to-end. The contract suite is in strong shape:
Slither and Mythril gates were **reproduced locally** (not just CI-attested), a purpose-built
Foundry harness fuzzed the load-bearing invariants (14/14 passing, 256 runs per property), and
the deployed bytecode was compared against locally compiled source for every contract.

The most important result is not a new bug but a **precision correction**: two documented
"fixed" issues are fixed **in the repository source only — the deployed mainnet bytecode
predates both fixes**. Governance's `setOwner` is still directly callable by the owner on-chain
(CWA-25, four independent proofs), and BuybackVault's `setParams` bounds are absent on-chain
(CWA-26, era-source diff). Neither creates an immediate fund risk (both sit behind the
TreasurySafe 3-of-5 and, for parameter changes, the 48h timelock), but the public security
record currently says "fixed" where the chain says "not deployed".

No new vulnerability was found in the deployed contract logic itself.

**Result: 0 Critical · 0 High · 1 Medium · 1 Low · 1 Informational** (this document's new
findings; register continues from the full-scope audit)

## 2. Scope, baselines, tooling

**In scope:** the 14 deployed mainnet contracts (addresses in Appendix A of the full-scope
report), their sources at `eb538a35`, their deployed bytecode at block 25971217, and the
protocol's safety invariants.

**Tools and evidence files** (relative to the audit workspace; the PR contains the fuzz
harness):
- Full test suite reproduction: `npm ci` → `npm run test:contracts:all` → **644 + 30 + 36
  passing, exit 0** (`evidence/test-run.log`).
- Slither 0.11.5 (venv, solc 0.8.28) via the project's own gate: `npm run test:slither-baseline`
  PASS + `npm run check:slither` → "analyzed 21 production Solidity files · observed 6 reviewed
  High signals · PASS — no new or changed High signals", exit 0 (`evidence/slither-run.log`).
- Mythril 0.24.8 (Python 3.12 venv, solc 0.8.28) via the project's own gate:
  `npm run check:mythril` → **0 signals on all 17 concrete contracts**, branch coverage
  77.8–97.8% per contract, "PASS — no Critical, High or Medium signals in the bounded scope",
  exit 0 (`evidence/mythril-run.log`; bounds: 2 tx / 30 s execution / 10 s solver per
  `audit/mythril-config.json`).
- Foundry 1.7.1 fuzz harness (`evidence/IFRDeepAudit.t.sol`, pinned-commit sources imported
  read-only; solc 0.8.28/cancun for the harness because current OZ `EIP712.sol` requires
  ≥0.8.24 — logic-equivalent for the tested properties): **14/14 passing**
  (`evidence/fuzz-run.txt`).
- Bytecode comparison: solc 0.8.20/paris/no-opt local builds vs. `cast code` at block 25971217,
  CBOR-metadata-stripped (`evidence/bytecode-compare.txt`), plus era-source diffs from
  Blockscout's verified-source packages and git history per file.
- Explorer verification sweep: **all 14 contracts verified on Blockscout** (name, compiler
  v0.8.20+commit.a1b79de6, no optimization, paris — per-contract records in
  `evidence/blockscout-verification-sweep.txt`); InfernoToken additionally confirmed on
  Etherscan.

**Could not be run locally:** gitleaks binary (CI gate green at HEAD + local pattern sweep
instead); Etherscan's API without a key (Blockscout used as the independent second source).

## 3. Per-contract results

| Contract | Manual review | Slither | Mythril | Fuzz/chain | Result |
|---|---|---|---|---|---|
| InfernoToken | clean | baseline | 0 signals | fee conservation + exemption fuzz PASS | CLEAN |
| Governance | 1 finding | baseline | 0 signals | live probe proves CWA-25 | **MEDIUM (CWA-25)** |
| IFRLock | clean | baseline | 0 signals | accounting fuzz PASS; drift proof PASS; deployed source byte-identical to HEAD | CLEAN |
| Vesting | clean | baseline | 0 signals | monotonicity/cap fuzz PASS; `transferGuardian` exists on-chain | CLEAN |
| LiquidityReserve | clean (cap mutability noted in CWA-15) | baseline | 0 signals | period-cap fuzz PASS | CLEAN |
| BuybackVault | 1 finding | baseline | 0 signals | era-source diff proves CWA-26 | **LOW (CWA-26)** |
| BurnReserve | clean | baseline | 0 signals | chain: burn-only surface | CLEAN |
| PartnerVault | clean | baseline | 0 signals | chain: bounds active (rewardBps 1500 ∈ [500,2500], cap 4M) | CLEAN |
| FeeRouterV1 | known W10/W11/W19 confirmed in source | baseline | 0 signals | voucher lifecycle fuzz PASS (7 cases) | CLEAN w/ known Lows (CWA-18) |
| BootstrapVaultV3 | clean | baseline | 0 signals | finalized on-chain; LP custody proven | CLEAN (W17 verified) |
| BuilderRegistry | clean | baseline | 0 signals | chain: 0 builders | CLEAN |
| CommitmentVault | CWA-03 confirmed + fuzz-proofed | baseline | 0 signals | price-tranche permanence proven | known MEDIUM (CWA-03) |
| LendingVault | CWA-01/08 confirmed in source | baseline | 0 signals | chain: fail-closed | known HIGH-dormant (CWA-01) |
| BuybackController | clean | baseline | 0 signals | chain: owner=Governance, 0 ETH | CLEAN |

## 4. Findings

### Medium

#### [CWA-25] Deployed Governance predates the W1 fix: `setOwner` bypasses the timelock on mainnet
- **Severity:** Medium · **Likelihood:** low (requires the 3-of-5 Safe itself) · **Status:** Open on-chain / fixed in source
- **Component:** `Governance.sol` (`0xc43d48E7FDA576C5022d0670B652A622E8caD041`)
- **Cross-refs:** W1 (documented as fixed); full-scope audit CWA-09 (guardian model)
- **Description:** The repo source (since commit `67065174`, 2026-03-20) routes `setOwner`
  through the timelock (`onlySelf`). The deployed contract (deployed 2026-03-05) still carries
  the original `onlyOwner` version, so the TreasurySafe can replace Governance ownership
  **immediately, without a 48h proposal window and without the guardian's cancel option**.
- **Proofs (four independent):**
  1. Live read at block 25971217: a `setOwner(address)` call from an arbitrary address reverts
     `"not owner"` — the `onlyOwner` gate text, not the `onlySelf` gate text (`"not self"`).
  2. Bytecode comparison: deployed 8,016 B vs. HEAD-compiled 7,984 B (no constructor immutables
     exist in this contract, so the difference is real code drift).
  3. Commit `67065174` diff: `- function setOwner(address _owner) external onlyOwner` →
     `+ ... onlySelf` — dated 15 days *after* the 2026-03-05 deployment.
  4. Blockscout era-source package for the deployed address contains the `onlyOwner` variant.
- **Impact:** the honest residual risk is narrow. The Safe already holds absolute power through
  the timelock; what is lost for this one transition is the **48h public window and the
  guardian-cancel backstop** on the single most sensitive action (ownership transfer). All
  subsequent parameter changes by a new owner would still be timelocked (`propose`/`execute`
  unchanged). No direct fund movement is enabled beyond what the Safe can already do.
- **Recommendation:** publish a one-line correction wherever W1 is listed as "fixed" ("fixed in
  source; live Governance carries the pre-fix variant; ownership is with the 3-of-5 Safe; a
  Governance redeploy would change its address and require migrating every child contract's
  owner pointer"). If a Governance V2 is ever deployed, migrate deliberately with a public
  checklist. Do not hot-swap.

### Low

#### [CWA-26] Deployed BuybackVault predates the W3 bounds fix (`setParams` unbounded on-chain)
- **Severity:** Low · **Likelihood:** low (governance-error path only; contract holds 0 ETH) · **Status:** Open on-chain / fixed in source
- **Component:** `BuybackVault.sol` (`0x670D293e3D65f96171c10DdC8d88B96b0570F812`)
- **Cross-refs:** W3
- **Description:** era-source diff (Blockscout verified package vs. HEAD) shows exactly three
  added lines in HEAD: `require(_burnShareBps <= 10_000)`, `require(_slippageBps <= 10_000)`,
  `require(_router != address(0))` — committed 2026-03-10 ("fix: BuybackVault — add bounds
  validation to setParams()"), five days after deployment. On-chain, a timelocked governance
  proposal could set `slippageBps > 10000` or `burnShareBps > 10000`; both paths then revert on
  underflow during `executeBuyback` — a buyback DoS until re-parameterized, not a fund-loss
  path (and the contract holds 0 ETH / 0 IFR at baseline).
- **Recommendation:** same class of action as CWA-25: correct the register wording ("fixed in
  source, not deployed"), fold into any future V2. No urgency while unfunded.

### Informational

#### [CWA-27] Bytecode verification classification (methodology result, not a defect)
- **Byte-exact match (HEAD ↔ deployed):** InfernoToken, BuilderRegistry.
- **Deployed source byte-identical to HEAD** (per Blockscout era packages + git history: no
  post-deploy edits); residual bytecode differences fully explained by constructor-baked
  immutables and/or OpenZeppelin dependency drift between the deployment-era lockfile and the
  current one: IFRLock (proven byte-identical source), Vesting, LiquidityReserve, BurnReserve,
  BuybackController, PartnerVault, BootstrapVaultV3, CommitmentVault, LendingVault.
- **Real drift:** Governance (CWA-25), BuybackVault (CWA-26).
- **Locally inconclusive:** FeeRouterV1 — current `@openzeppelin/contracts@^5.6.1`
  `EIP712.sol` requires solc ≥0.8.24, so a 0.8.20 local rebuild cannot reproduce the deployment
  build; the contract is dual-explorer verified (Blockscout + Etherscan) with the era's
  dependency set. Recommend adding the deployment-era `package-lock.json` reference to
  `docs/DEPLOYMENTS.md` so future bytecode reproductions stay possible.

*(The fuzz harness itself is delivered alongside this report as a permanent evidence artifact;
it carries no finding ID — the supplement document continues the register from CWA-28.)*

## 5. Invariant table

| # | Property | Method | Result |
|---|---|---|---|
| I1 | `net + poolFee + burns == value` on every non-exempt transfer; `totalSupply` only decreases | fuzz (256 runs, random fee rates within cap + amounts) | **HOLDS** |
| I2 | `feeExempt` transfer moves the full amount and burns nothing | fuzz (256 runs) | HOLDS (documents exemption blast radius) |
| I3 | IFRLock: `balanceOf == totalLocked == Σ user locks` under random lock/unlock sequences | fuzz (256 runs, 1–24 actions, 3 users) | **HOLDS** — with exemption set |
| I4 | IFRLock **without** feeExempt: user is credited more than the contract receives and **cannot unlock** | targeted proof test | **PROVEN** — the exemption is load-bearing; governance must never remove it while locks exist |
| I5 | Vesting: `vestedAmount` non-decreasing, ≤ allocation, 0 before cliff, full after duration; `release()` pays exactly vested | fuzz (256 runs over time pairs) | **HOLDS** |
| I6 | LiquidityReserve: pre-lock withdrawals revert; per-period cap holds to the wei; 1 wei over cap reverts | fuzz (256 runs, 1–4 periods) | **HOLDS** |
| I7 | CommitmentVault: PRICE_ONLY tranche can never unlock — not by owner, not by anyone, even with oracle set, even after 2,000 days | targeted proof test | **PROVEN** (CWA-03 formalized); TIME_ONLY control unlocks correctly |
| I8 | FeeRouterV1 voucher: valid discount executes; replay reverts; wrong signer reverts; discount > fee reverts; expiry reverts; no-voucher path charges exactly 5 bps | 6 targeted tests | **HOLDS** |
| I9 | FeeRouterV1 with `feeCollector = 0x0`: fee ETH is silently burned (call succeeds) | targeted proof test | **PROVEN** (CWA-18 mechanism confirmed) |

## 6. Tool-run evidence

- Slither: `[slither] analyzed 21 production Solidity files · observed 6 reviewed High signals ·
  PASS - no new or changed High signals` (exit 0) — locally reproduced with the project's pinned
  venv recipe; baseline file matches the CI claim.
- Mythril: per-contract table in `evidence/mythril-run.log`; all 17 concrete contracts **0
  signals** under the project's bounded config; worst branch coverage 77.8% (IFRBuilderVault
  library module), core contracts 85–98%.
- Repo test suite: 644 contract + 30 builder + 36 SDK tests passing at `eb538a35`.
- Fuzz: 14/14 PASS (`evidence/fuzz-run.txt`); harness `evidence/IFRDeepAudit.t.sol`
  (reproducible with the remappings in `evidence/fuzz-foundry.toml`).

## 7. Known-issues register — precision corrections

| Item | Previously documented | Deep-audit status |
|---|---|---|
| W1 (`setOwner` timelock bypass) | "fixed" | **Fixed in source only; NOT deployed on mainnet (CWA-25)** |
| W3 (unbounded `setParams`) | "partially addressed" | **Fixed in source only; NOT deployed on mainnet (CWA-26)** |
| W18 (Vesting guardian not rotatable) | open | **Outdated** — `transferGuardian` present in source and in deployed bytecode (selector probe reverts `OnlyGuardian()` for strangers) |
| W6 (Vesting pays 3.5% fees) | accepted | **Superseded** — `feeExempt[Vesting] = true` on-chain |
| W17 (LP stranded in BootstrapVaultV3) | accepted | **Verified** — `lpLockId = 0`, vault holds all LP minus the 1000-wei Uniswap minimum; no withdrawal function exists (by design) |
| OPS-001 / OPS-002 | fail-closed | **Verified on-chain** (`ifrPriceWei = 0`, `priceOracle = 0x0`) |

## 8. Recommendations (prioritized)

1. Correct the public register wording for W1/W3 ("fixed in source; deployed variant differs;
   no immediate risk because …"). Precision here is the project's credibility engine.
2. Add the deployment-era dependency lockfile reference to `docs/DEPLOYMENTS.md` so bytecode
   reproduction stays possible (CWA-27).
3. Before any funding of BuybackVault/BuybackController, redeploy or accept the on-chain
   absence of `setParams` bounds (CWA-26) explicitly in the funding proposal text.
4. Add the fuzz harness (delivered with this report) to the repo's test tree or CI as a
   permanent invariant gate — especially I4 (feeExempt dependency), which is the protocol's
   single load-bearing operational assumption.
5. If a Governance V2 ever ships: migrate via public checklist, never hot-swap; every child
   contract's owner pointer must move in one governed sequence.

## 9. Limitations & disclaimer

Point-in-time review at the stated baselines. Symbolic execution is bounded (2 tx / 30 s / 10 s
solver) — "0 signals" means "no signal within the bounded scope", not proof of absence. Fuzzing
covers the nine invariants in §5, not all possible properties. The bytecode method proves
equivalence classes (exact match / immutable-slot drift / dependency drift / real drift); the
two real-drift cases were additionally proven by live probes and era-source diffs. This report
is not a certification, not financial advice, and no guarantee that no vulnerability exists.
On-chain state changes with every block — re-verify before relying.

— Collateral Web3 Open Audits, 2026-09-14
