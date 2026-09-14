# IFR Protocol — README Audit (claim-by-claim consistency review)

**Auditor:** Collateral Web3 Open Audits
**Client:** NeaBouli / Inferno Protocol (ifrunit.tech)
**Date:** 2026-09-14
**Baselines:** repo `NeaBouli/inferno` @ `eb538a355001b042b343bfb19221af2407a96e63` · mainnet
block 25971217 · web surfaces 2026-09-13/14
**Companion documents:** CWA full-scope audit (CWA-01…24), contract deep audit (CWA-25…27),
surfaces supplement (CWA-28…45), Web3 integration audit (CWA-46…50)
**Report version:** 1.0

Scope: the repository's public face — `README.md` (371 lines). Every verifiable claim was
checked against chain state (block-pinned reads), reproduced tool runs, source review, or link
liveness. Verdicts: **Confirmed / Diverged / Overstated / Unverifiable-as-stated**.

**Verdict: largely accurate, with 2 substantive divergences and 1 overstatement.** The README's
honesty patterns (dated snapshots, explicit "older internal inventory" disclaimers) are above
industry norm and made this review faster — the fixes below are cheap because the framing is
already honest.

**Findings: 0 Critical · 0 High · 2 Medium · 1 Low · 3 Informational (CWA-51 … CWA-56)**

## 1. Claim-by-claim results

### Branding, addresses, links

| Claim | Verdict | Evidence |
|---|---|---|
| Token contract `0x77e9…A6e7B`, LP pair `0xbE49…31A0` | **Confirmed** | chain reads @ 25971217 |
| Contracts table: 14 protocol contracts + LP + deprecated V1, all addresses | **Confirmed** | every address matches the verified deployment map; all dual-explorer verified |
| Bootstrap FINALIZED 05.06.2026; LP retained in vault, no withdrawal function, Team.Finance disabled | **Confirmed** | `getBootstrapStatus()` = (false, true, 0.03 ETH, 0, 3); `lpLockId=0`; LP balance = totalSupply − 1000 wei |
| 51 internal `docs/` links + 3 relative files exist; external spot-checks (token-list.json, wiki, raw asset) return 200 | **Confirmed** | `evidence/readme-link-check.txt` |
| Safe section: Treasury `0x5ad6…cE3b`, threshold 3-of-5, 5 signers | **Confirmed** | `getThreshold()=3`, `getOwners()=5 documented addresses` — on all three Safes |

### Token economics

| Claim | Verdict | Evidence |
|---|---|---|
| 2.5% burn per transfer (2% + 0.5%), 1% pool fee, 5% hard cap | **Confirmed** | `senderBurnBps=200, recipientBurnBps=50, poolFeeBps=100`, cap enforced in `setFeeRates` (fuzz-proven) |
| Decimals 9, genesis 1B, no mint function | **Confirmed** | source + chain |
| "Current Supply ~997.67M (verified 22 August 2026)", "Burned ~2.33M (22 August 2026)" | **Confirmed as dated snapshot** | honestly date-labeled; current chain truth 997,571,140.02 / 2,428,859.98 (13.09) — fine as a dated figure |
| Team vesting: 12m cliff, 36m linear, "0 tokens available before March 2027" | **Confirmed** | `start=1772670647` (2026-03-05), `released=0`, beneficiary immutable |
| Liquidity Reserve: lock ended 01.09.2026, 200M held, 50M/90d cap, no withdrawals | **Confirmed** | chain reads (`lockEnd=1788222659`, balance 200M, `totalWithdrawn=0`) |

### Governance & security statements

| Claim | Verdict | Evidence |
|---|---|---|
| "governed by a 48-hour timelock … Gnosis Safe multisig" | **Mostly confirmed, exceptions named** | delay=172,800 s; all owners/admins = Governance; **but**: all guardian roles = single EOA, `setGuardian` untimelocked (CWA-09), deployed Governance carries pre-W1 `setOwner` (CWA-25) |
| Slither paragraph (21 sources, 6 reviewed High baseline, 0 unreviewed High / 0 Critical) | **Confirmed — reproduced locally** | `evidence/slither-run.log` (exit 0) |
| Mythril paragraph (17 contracts, bounded, no signals) | **Confirmed — reproduced locally** | `evidence/mythril-run.log` (exit 0) |
| Internal audit 0 FAIL / 20 WARN / 1 fixed / 81 PASS (Skywalker) | **Confirmed as document claim** | note: W1/W3 are "fixed in source, not deployed" (CWA-25/26) — the README should not imply otherwise |
| App security review 12 findings (2 CRITICAL, 5 HIGH, all fixed) | **Confirmed as document claim** | spot consistency only |
| Bootstrap review 11/14 secure, 3 low, 0 critical | **Confirmed as document claim** | |
| "Governance lifecycle tested: propose → 48h → execute" | **Confirmed** | 17 on-chain proposals, spot-decoded #15/#16 match the public log |
| "Full Sepolia testnet deployment with verified contracts" | **Confirmed per docs** | spot-check level |
| "No single entity controls the protocol" | **Directionally true, needs the guardian caveat** | one EOA holds pause/cancel everywhere (CWA-09) |

## 2. Findings

### Medium

#### [CWA-51] Allocation table: Treasury/Community custody rows diverge from chain state
- **Where:** README "Token Allocation" table (Treasury and Community & Grants rows)
- **Claim:** Treasury 150M held by "Gnosis Safe multisig (0x5ad6193...)"; Community "57.9M
  received … 50M → Bootstrap. ~7.9M operational reserve".
- **Chain truth (block 25971217):** Treasury Safe holds **0 IFR**; Community Safe holds 7.9M
  (matches); the **LP Reserve Safe holds 400.6M** — i.e. the 400M DEX allocation plus what
  appears to be the aggregated Treasury/Community portions, but the table does not say so for
  those rows (only the DEX row names the LP Reserve Safe). The "50M → Bootstrap" wording is also
  not the documented flow (bootstrap funding came from LiquidityReserve).
- **Impact:** a reader verifying the README against Etherscan finds an empty Treasury Safe and
  no explanation — unnecessary FUD material against a project that is actually transparent.
- **Recommendation:** add custody notes per row ("currently aggregated in LP Reserve Safe
  0x5D93…, see lp-strategy page") or regenerate the table from chain state; fix the
  "50M → Bootstrap" phrasing to the actual destination.

#### [CWA-52] "BuybackVault and BurnReserve accumulate from the 1% protocol pool fee" — not true on-chain
- **Where:** README line following the allocation table.
- **Chain truth:** the 1% pool fee is IFR-denominated and routes to **FeeRouterV1**, which has
  no withdrawal function — 371,543 IFR are stranded there; BuybackVault and BurnReserve each
  hold **0** (verified at block 25971217). This sentence is the README-level root of the
  flywheel misdescription tracked as CWA-02.
- **Recommendation:** same decision as CWA-02 (sink vs. re-point `poolFeeReceiver`), then align
  this sentence, FEE_DESIGN.md, transparency page and press-kit in one sweep.

### Low

#### [CWA-53] AI Copilot "Automatic seed phrase / private key detection" is overstated
- **Where:** README "AI Copilot" section.
- **Reality:** the copilot server and widget (reviewed in full, `apps/ai-copilot/server/index.ts`)
  contain a static "never share keys" disclaimer and prompt-level safety rules, but **no
  automatic seed-phrase/private-key detector** (no pattern check on inbound messages or outbound
  rendering). The widget itself renders chat as text (safe), and the claim's intent is good —
  but "automatic detection" describes code that does not exist.
- **Recommendation:** either implement a two-line detector (regex for 12/24-word sequences /
  `0x[0-9a-f]{64}` on the inbound message → canned warning), or reword to "explicit safety
  warnings and knowledge-bounded answers".

### Informational

- **[CWA-54] Test tables are stale but correctly disclaimed** — "Protocol Tests 521" /
  "Browser / WalletConnect 12" vs. reproduced reality (644 contract + 44 browser tests green at
  the pinned commit). The inline disclaimer ("older internal inventory… must not be read as a
  current total") is exactly the right pattern; extending `update-stats.yml` to regenerate these
  numbers would close the gap permanently.
- **[CWA-55] "17 documented on-chain components"** — the counted list is not published anywhere;
  the README's own contract table lists 16 rows. Publish the counted set once (token + 13
  protocol + LP + safes? — pick a definition) and the number becomes self-verifying.
- **[CWA-56] "Integrated Builder Products" table vs. empty on-chain registry** —
  `getActiveBuilders() = []` (block 25971217). The listed products may be real integrations in
  progress, but the README does not distinguish "product-level integration" from "registered
  on-chain builder". One clarifying sentence prevents a wrong conclusion either way.

## 3. What the README gets right (keep doing)

- Dated, labeled snapshots instead of silent live claims ("verified 22 August 2026").
- Explicit "older inventory" disclaimer above the test tables.
- Honest placeholder labeling for `admin-console`/`investor-web`; "not used in production" for
  the wallet prototype; "npm publication pending" for the SDK.
- Bootstrap/LP custody described with the actual mechanism (no withdrawal function) rather than
  marketing shorthand.
- 51/51 internal links resolve; external links sampled are live.

## 4. Limitations

Point-in-time at the stated baselines. "Diverged" verdicts are about README-vs-chain accuracy,
not accusations — every divergence found has an innocent operational explanation in the project
record; the issue is only that the README does not yet tell that story.

— Collateral Web3 Open Audits, 2026-09-14
