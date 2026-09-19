# IFR Protocol — Content Coherence Audit (landing + wiki + shop copy)

**Auditor:** Collateral Web3 Open Audits
**Client:** NeaBouli / Inferno Protocol (ifrunit.tech)
**Date:** 2026-09-14
**Baselines:** repo `NeaBouli/inferno` @ `e8cf1ece8c40c0fa19f18344fe25593304ef5c26` (main HEAD;
all audited content pages byte-identical to audit baseline `eb538a35` — the only merges since
are the audit documents themselves) · mainnet block **25974493** (fresh reads;
`evidence/content-audit/chain-reads-content.txt`)
**Companion documents:** CWA full-scope audit (CWA-01…24), contract deep audit (CWA-25…27),
surfaces supplement (CWA-28…45), Web3 integration audit (CWA-46…50), README audit (CWA-51…56)
**Method skill:** `web3-content-coherence-audit` (this audit is its reference application)
**Report version:** 1.0

> **Editorial correction — 2026-09-19:** the original summary counted CWA-64
> as Medium although its published finding label is Low. The aggregate below
> now follows all 18 individual labels; no finding text, severity label or
> technical conclusion changed.

Scope: every public content page served from the repo — landing `docs/index.html`,
`docs/builder.html`, the wallet dApp copy of `docs/web3/index.html`, all **36** wiki pages
(`docs/wiki/*.html`), and the customer-facing copy of the Benefits Network PWA
(`apps/benefits-network/frontend`, sitemap routes `/ /guide /scan /privacy /support` plus
global UI strings and `llms.txt`). ~500 checkable claims extracted into a ledger, each verified
against block-pinned chain reads, source at the pinned commit, or CI records. Prior audit
register (CWA-01…56) deduplicated: still-open known instances are marked, not re-registered.

**Verdict: the engineering claims are largely true; the editorial layer has drifted.** Every
contract address on every page is correct; every fee/lock/vesting parameter that matters checks
out against chain; the shop copy is fully accurate (83/83 claims verified). The defects
concentrate where pages describe *history* (proposal logs, funding tables) and *mechanisms not
yet live* (buyback, vouchers, lending yield) — plus one systematic wrong-network address column.

**Findings: 0 Critical · 0 High · 10 Medium · 7 Low · 1 Informational (CWA-57 … CWA-74)**

No finding is live-exploitable or moves funds; the audit target here is the *public record*.
Nothing in this report changes any CWA-01…56 severity. Two proposed agent findings were
**dropped after lead verification** (see §7 honesty notes) — the wiki's "Deployer holds 0 IFR"
is true today, and PartnerVault's `partners()` getter exists (the doc errors are narrower than
proposed).

## 1. Surface inventory

39 repo-served pages + shop PWA copy. Full table with byte sizes:
`evidence/content-audit/page-inventory.txt`. The three wiki pages added since the
2026-06-16 internal content audit (`community-signer-expansion.html`, `liquidity.html`,
`reputation.html`) are included; the prior audit's fixed-claims list was re-verified and holds.

## 2. Claims ledger summary

| Class | Extracted | Verified OK | Contradicted/Stale (new) | Known (CWA-01…56) | No-source |
|---|---|---|---|---|---|
| Landing + dApp pages | ~165 | 131 | 9 | 22 | 3 |
| Wiki 36 pages | ~250 | 176 | 38 | 24 | 12 |
| Shop PWA copy | 83 | 83 | 0 | 0 | 0 |
| **Total** | **~500** | **390** | **47 instances → 18 findings** | 46 | 15 |

(Per-page ledgers with verbatim quotes: agent extraction logs, retained in
`evidence/content-audit/`; every finding quote below was re-verified line-by-line by the lead —
`evidence/content-audit/page-checks.txt`.)

## 3. Cross-page consistency matrix (repeated facts, all located variants)

| Fact | Values found across pages | Truth (evidence) |
|---|---|---|
| Contract/component count | 13 (multisig:869) · 14 (deployment:612, wallet-guide:797) · 16 (mainnet-checklist:632) · 17 (10+ pages) · "17 = 13+3" (open-audit:687, sums to 16) | **14 contracts + 3 Safes** (contract map, chain) — CWA-55 registered; the "13" and "13+3" variants are new |
| Sepolia contract count | 17 (testnet meta) · 14 (testnet body) · 13+3 (testnet JSON-LD) · 16 (roadmap:621) | 12 entries documented (contract-map:64); page also claims "10 proposals executed" vs its own table's 6 (CWA-70) |
| Wiki page count | 33 (2026-06 audit) · 35 (one-pager:710, roadmap:648) · 36 (wiki/index meta ✓) | **36** files at pinned commit |
| Tier thresholds | 1,000/2,500/5,000/10,000 (lock-mechanism, benefits app) · 1,000/5,000/25,000/100,000 (press-kit) · 1,000/5,000/25,000 (integration) · 500/2,000/10,000 (TierModule + `/api/ifr/check`) · builder slider 100–10,000 | CWA-20 registered; benefits-app internal tension (500 template vs 1,000 "typical") newly noted in CWA-74 |
| P0 denomination | 300,000,000 wei (faq:582, governance:1159, lp-strategy:841 ✓) · "0.030 ETH / 200,000,000 IFR" (commitment-vault:1076 ✗) · $0.0000002 USD (ecosystem:1125, lp-strategy:825) | **300,000,000 wei** (Proposal #16, chain); USD figure implies ETH ≈ $667, conflicts with pages using ~$2,000 |
| LP phase split | 100/100/100M (tokenomics:1134) · 150/100/150M (protocol-plan:1045) · 100/150M (transparency:1131) · in-page 150M bar vs 100M text (protocol-plan:1045-1052) | Executed Phase 1 = **100M + 0.030 ETH** (chain); claims-register #4 known; protocol-plan's bar/text split is new (CWA-69) |
| LP pool IFR content | 100M initial ✓ (bootstrap:837) · ~195M (contracts:2137/2180 ✗) · 36.128M (bootstrap:1433, dated 16.06) | **11,899,172 IFR** @ 25974493 — buys drained the pool's IFR side; contracts.html is wrong in *both* directions |
| Buyback status | "fully active ✅" (contracts:2420, roadmap:712, tokenomics:1176) · "Inactive — activates Phase 3" (wallet-guide:981) · "ecosystem buyback into PartnerVault" (protocol-plan:1073) | Controller + vaults hold **0 ETH/0 IFR**; no buyback ever executed (CWA-02 family; CWA-59 for the invented mechanism) |
| Governance proposals | "#0–#9 executed" (wallet-guide:836) · "7 executed" (protocol-plan:937) · #1/#3 "executed" (deployment:911/923) · #6 dual identity (transparency:1359 vs :1505) | Chain-decoded @ 25974493: **#1/#3 cancelled** (targets Vesting/BootstrapVaultV3), **#6 = setPoolFeeReceiver(FeeRouterV1), executed** (CWA-61) |
| Multisig phase history | Phase 0 "Single EOA" (governance:1604) · Phase 0 "Genesis 1-of-2" + 2c "2-of-5" (faq:884, multisig:618) | Two irreconcilable histories on different pages (CWA-69) |
| EOA→Safe migration date | 06.03.2026 (transparency:822) · 07.03.2026 (transparency:1021/1030, wallet-guide:768/785) | Same event, two dates, one page self-conflicted (CWA-69) |
| Treasury→Bootstrap amount | ~150M (transparency:1042, roadmap:681, tokenomics:996) · 144.75M (transparency:1401, wallet-guide:690) | Both on the *same* transparency page; the 144.75M figure also contradicts the page's "feeExempt (zero burn)" note for that transfer (CWA-72 family note) |
| Deployer feeExempt | "explicitly revoked" (tokenomics:1224/1242/1309) · "Active since 18.03.2026" (wallet-guide:656, transparency prop #7) | **Chain: `feeExempt(Deployer) = true`** @ 25974493 → tokenomics wrong (CWA-63) |
| Burned supply | "2.3M" (index:2309) · "2.33M" (index:2757) · ~2.43M actual | 1e9 − totalSupply = **2,428,859.98 IFR** @ 25974493 (CWA-71) |
| Test counts | 27 (bootstrap:1048) · 544 (historical, disclaimed ✓) · 642 (index:1694) · 644+30+36 (faq:979 ✓) | CWA-20/54 known; bootstrap's 27 vs actual 30 `it()` new (CWA-70) |
| DAO phase labeling | "Phase 4 — Verified" (open-audit:690) · "Phase 4 NEXT" (one-pager:718) · "Phase 5" (security:1226) · Phase 3 = multisig Q3–Q4 2026 (press-kit:847) while 3-of-5 active since 15.03.2026 | No RatVoting/ForumVoting/IFRSpamProtection exists in `contracts/` (grep: 0) — "Verified" impossible (CWA-69) |

## 4. Findings

### Medium

#### [CWA-57] The advertised 15-bps points voucher can never execute on the deployed FeeRouter
- **Severity:** Medium · **Status:** Open — works as coded, promise impossible
- **Pages:** `docs/wiki/agent.html:865` ("Discount: 15 bps"), `:898-899` ("Fee drops to 0 when
  discount exceeds fee"); `docs/wiki/tokenomics.html:1501-1502` ("100 points → 15 bps
  discount"); `docs/wiki/security.html:1271` ("Discount > Fee → Clamp: max(fee − discount, 0)")
- **Truth:** `FeeRouterV1.sol:130` — `require(voucher.discountBps <= protocolFeeBps, "Discount
  exceeds fee")`: discount > fee **reverts**; the clamp branch at `:151-154` is unreachable via
  the voucher path. With `protocolFeeBps = 5` (`:23`, chain-confirmed), the documented 15-bps
  voucher reverts on every use. `isVoucherValid` would return `("Discount too high")` (`:170`).
- **Impact:** the points→voucher benefit advertised on three pages is structurally undeliverable
  at current parameters. Dormant today (points system not live), so no user harm — but the docs
  describe a mechanism the deployed contract forbids. Adjacent to CWA-18 (maxUses dead code),
  distinct defect.
- **Fix direction:** either document "voucher ≤ 5 bps at current fee" and cap issuance, or note
  the intended `discountBps ≤ fee` contract rule on all three pages; security.html's clamp row
  should describe the revert.

#### [CWA-58] Lending yield described with wrong asset and wrong destination
- **Severity:** Medium · **Status:** Open
- **Pages:** `docs/wiki/lending-vault.html:834` — "Interest is split: 50% → Contributor (ETH
  yield), 50% → Uniswap LP (pool becomes deeper and more stable)"; `docs/wiki/commitment-vault.html:897` —
  "Earns ETH yield via LendingVault during the lock phase" (present tense).
- **Truth:** `LendingVault.sol:228-246` — interest accrues in **IFR**, split 50% lender /
  50% `protocolFeeReceiver` (unset on mainnet, CWA-08); no Uniswap LP route exists; and
  `totalLent = 0` @ 25974493 — no yield has ever accrued. lending-vault.html *itself* states
  the correct mechanism at `:951` — the page contradicts itself.
- **Fix direction:** correct both sentences to the IFR 50/50 lender/protocol split; drop the
  present-tense yield claim until `totalLent > 0`.

#### [CWA-59] protocol-plan.html documents a buyback/refill mechanism that does not exist
- **Severity:** Medium · **Status:** Open
- **Page:** `docs/wiki/protocol-plan.html` — `:1073-1075` "the protocol automatically reinvests
  accumulated fee IFR back into the builder ecosystem via the PartnerVault. It is not a market
  buyback with ETH"; `:1103-1124` "PartnerVault ≥ 85% (34M) → auto-refill to 90% … Overflow >
  2M IFR → Treasury … 70% Operating Pool / 30% SOS Reserve … Community Vote (12 days)";
  `:1265` "Auto-rebalancing contract for PartnerVault refill + overflow routing. Deployed after
  LP launch."
- **Truth (code):** BuybackController does `swapExactETHForTokens` — an ETH→IFR **market
  buyback**, 50% → `burnReserve`, 50% → LP via `lpReceiver` (contract source; contract-map
  §105-109). No PartnerVault refill path, no 70/30 split, no SOS reserve, no 12-day vote exists
  in any contract (grep across `contracts/`). The controller was deployed 14.04.2026 — **before**
  the LP launch (05.06.2026), not after. Chain: BuybackVault 0 IFR, BurnReserve 0 IFR,
  controller 0 ETH @ 25974493.
- **Impact:** this is the CWA-02/52 flywheel family, but worse than drift: the page specifies
  parameters (85%/90%/2M/70/30/12 days) for machinery that was never built. Readers evaluating
  the token's value-accrual story get a fabricated mechanism.
- **Fix direction:** rewrite the section to the deployed design (or label it as unbuilt Phase-3
  design with a visible "not implemented" banner).

#### [CWA-60] contracts.html "Sepolia" column links four mainnet contract addresses
- **Severity:** Medium · **Status:** Open
- **Page:** `docs/wiki/contracts.html` — `:2299` BuilderRegistry "Sepolia" = `0x77e9…A6e7B`
  (mainnet InfernoToken); `:2332` CommitmentVault "Sepolia" = `0xc43d…D041` (mainnet
  Governance); `:2362` LendingVault "Sepolia" = `0x7699…54Eb` (mainnet IFRLock); `:2394`
  BuybackController "Sepolia" = `0xaA14…6fCF` (mainnet BurnReserve). All four are
  `sepolia.etherscan.io` links carrying mainnet addresses — systematic copy-paste.
- **Impact:** an integrator following the "Sepolia" reference lands on mainnet contracts; the
  testnet page has the correct Sepolia set. Wrong-network address presentation is the classic
  pretext for signing-against-the-wrong-deployment mistakes.
- **Fix direction:** replace with the documented Sepolia addresses (contract-map:64) or drop
  the column.

#### [CWA-61] Governance proposal logs misstate executed/cancelled status and actions
- **Severity:** Medium · **Status:** Open — chain-decoded @ block 25974493
- **Pages:** `docs/wiki/deployment.html:911` "Proposal #1 executed (setFeeExempt IFRLock)" and
  `:923` "Proposal #3 executed (setFeeExempt new PartnerVault)"; `docs/wiki/transparency.html`
  gives proposal #6 two different actions: `:1359` "setPoolFeeReceiver(FeeRouterV1) ✅" vs
  `:1505` "setFeeExempt(BootstrapVaultV3, true)".
- **Truth (chain):** `proposals(1)` → `setFeeExempt(Vesting, true)`, **cancelled**;
  `proposals(3)` → `setFeeExempt(BootstrapVaultV3, true)`, **cancelled**; `proposals(6)` →
  `setPoolFeeReceiver(FeeRouterV1)`, **executed**. So deployment.html is wrong on status *and*
  target for both rows, and transparency's table row for #6 is wrong (its :1359 narrative is
  right). Related link rot: `governance.html:1042/1051/1060` use 8-hex-char placeholders
  (`etherscan.io/tx/0xdb1590bf`, `0x1c885fbe`, `0x89eebca7`) as full TX hrefs — guaranteed
  404s; same truncation pattern in `bootstrap.html:1230-1241` and `mainnet-checklist.html:1032/1036`.
- **Fix direction:** correct the #1/#3 rows to cancelled with the decoded targets; deduplicate
  #6; use full 66-char hashes or no link.

#### [CWA-62] Blanket "every change requires the 48h timelock" claims omit the live guardian exception
- **Severity:** Medium · **Status:** Open (docs side of W15/CWA-09)
- **Pages (verbatim instances):** `docs/index.html:2712` ("No instant admin changes — every
  action requires a 48-hour public delay"), `:2829`, `docs/wiki/index.html:586`,
  `fair-launch.html:727` ("no admin backdoors"), `faq.html:869` ("All changes require the full
  timelock delay"), `security.html:1181/1186`, `one-pager.html:700/725`, `multisig.html:778-779`
  ("Execute instantly — every change is public for 48 hours"), `transparency.html:1222`,
  `protocol-plan.html:930-937` ("No change can take effect instantly"), `wallet-guide.html:834`.
- **Truth:** `Governance.setGuardian` is `onlyOwner`, **not timelocked** (Governance.sol:120;
  W15 open, CWA-09) — the owner (TreasurySafe 3-of-5) can rotate the guardian instantly, and the
  guardian can cancel any proposal. Eleven pages assert universality without the exception.
  Note: the previously-cited second exception (BuybackController owner = Deployer EOA) no longer
  exists on-chain — owner = Governance @ 25974493 (see CWA-64); the guardian exception stands.
- **Fix direction:** one sentence wherever the blanket claim appears: "Exception: guardian
  rotation (`setGuardian`) executes without the timelock (W15, accepted)."

#### [CWA-63] tokenomics.html claims the Deployer fee exemption was revoked — chain says it is active
- **Severity:** Medium · **Status:** Open
- **Page:** `docs/wiki/tokenomics.html:1224` "Deployer's feeExempt status is explicitly revoked
  after distribution" (also `:1242`, `:1309`).
- **Truth (chain):** `feeExempt(0x6b36687b…ed67) = true` @ block 25974493; transparency.html
  proposal #7 ("setFeeExempt(Deployer, true)", 18.03.2026) and `wallet-guide.html:656` ("Active
  since 18.03.2026") are the correct pages. No revocation proposal exists in #8–#16.
- **Impact:** the tokenomics page — the canonical fee reference — denies an insider exemption
  that exists. Risk-understating (unlike CWA-64's safe-direction drift). The exemption itself is
  a documented accepted risk; the false *denial* is the finding.
- **Fix direction:** correct the three sentences; link the exemption table to the live state.

#### [CWA-64] Role/ownership reference drift across contracts.html, multisig.html, mainnet-checklist.html
- **Severity:** Low · **Status:** Open
- **Instances (each lead-verified):**
  - `contracts.html:2402` — BuybackController "Owner: Deployer (0x6b36…)"; chain:
    `owner() = Governance` (0xc43d…D041) @ 25974493. Safe-direction drift. (Our own merged
    reference `tools/audit-skills/.../contract-map.md:28` carries the same stale row —
    self-flagged for correction.)
  - `multisig.html:841-842` — "PartnerVault `admin()` Governance (immutable)"; code:
    `setAdmin` exists (PartnerVault.sol:391) — transferable, not immutable.
  - `multisig.html:851-852` — "Vesting `guardian()` Deployer (revoke-only)"; code: Vesting has
    **no revoke function** — guardian can pause/unpause/transferGuardian (Vesting.sol:75-95).
  - `multisig.html:741-742` — "Emergency pause (IFRLock)" listed under *what the Safe signers
    can do*; IFRLock's guardian is the Deployer EOA personally, not the Safe (CWA-09).
  - `multisig.html:766-767` — timelock "Hardcoded in Governance contract. Not configurable.";
    code: `setDelay` exists, bounded 1h–30d (Governance.sol:112-116).
  - `mainnet-checklist.html:969` — "FeeRouterV1 … feeCollector = Treasury"; chain:
    feeCollector = BuybackController (Proposal #14, executed 18.04.2026 — which the same page
    lists as executed at `:1167`).
  - `security.html:790-805` — W1 status "Multisig planned" / W3 "Fix in v3" vs the known-issues
    register's "fixed in source" state (and the CWA-25/26 not-deployed nuance).
- **Fix direction:** sync all role tables to the chain state; adopt one register as the single
  source.

#### [CWA-65] transparency.html supply table does not sum; three custody statements are false
- **Severity:** Medium · **Status:** Open
- **Page:** `docs/wiki/transparency.html` — the supply-distribution table (`:1392-1416`) lists
  LP Reserve Safe 400.6M + LiquidityReserve 200M + Vesting 150M + Treasury 0 + Community 7.9M +
  PartnerVault 40M + burned ≈ 2.4M → **≈ 800.9M (80.1%)**, then a Total row claiming
  **"1,000,000,000 / 100%"**. Missing rows: LP pair (11,899,172 IFR @ 25974493), CommitmentVault
  (47,952,477), LendingVault (52,155,441), FeeRouterV1 (371,544), user wallets (~184M).
  Separately on the same page: `:1194` FeeRouterV1 "Pass-through — **holds no IFR**" (chain:
  371,543.99 IFR stranded — the CWA-02 finding itself); `:1201` IFRLock "No IFR held by contract
  itself (user balances tracked internally)" (code: `transferFrom(user, address(this), amount)`
  — IFRLock custodies all locked IFR, IFRLock.sol:117); `:1222` "Immutable timelock hardcoded"
  (setDelay exists).
- **Impact:** the transparency page is the project's "verify everything" surface; a supply table
  that cannot sum and three contradicted custody statements undercut exactly the trust the page
  exists to build.
- **Fix direction:** recompute the table from chain (all balances above are in
  `evidence/content-audit/chain-reads-content.txt`); fix the three rows.

#### [CWA-66] lp-strategy.html's core arithmetic is wrong by orders of magnitude
- **Severity:** Medium · **Status:** Open
- **Page:** `docs/wiki/lp-strategy.html` — `:865-869` "Milestone 1 … Pool after: ~150M IFR +
  1.5 ETH ($3,000 depth) … Buying 99% costs: ~$30,000 instead of $2,000"; `:927-941` table
  "At P0 ($0.0000002) 400M = $80 / pool depth $0.016 … At P0×1,000 = $80,000 / $1,600,000" and
  "SAME 400M IFR = 100,000,000x more liquidity."
- **Truth (x·y=k, verifiable arithmetic):** draining 99% of a 150M-IFR/1.5-ETH pool costs
  **148.5 ETH ≈ $297k** @ $2k, not $30k; from the actual 100M/0.03-ETH pool it costs 2.97 ETH
  ≈ $5.9k, not $2k. Matched-pool depth is ≈ 2× one side's value ($160 / $160,000), not
  $0.016 / $1.6M — the table's ratio column is off by 100,000×, and the "100,000,000x" headline
  by 100,000×. Additionally the page implies ETH ≈ $667 at `:825` and uses ~$2,000 at `:865`.
- **Impact:** the page argues a liquidity strategy to governance voters using numbers that do
  not survive arithmetic.
- **Fix direction:** recompute or remove the efficiency proof; keep the (correct) canonical
  facts: 100M + 0.030 ETH initial pool, 400.6M in the LP Reserve Safe.

#### [CWA-67] P0 denomination inconsistencies across pages
- **Severity:** Low · **Status:** Open
- **Instances:** `commitment-vault.html:1076` widget hint "P0 = 0.030 ETH / **200,000,000**
  IFR" — that ratio is 150,000,000 wei; the on-chain P0 is 300,000,000 wei (Proposal #16), and
  the code comment specifies the 100M denominator (CommitmentVault.sol:70). The same page states
  the correct value at `:964`/`:1060`. USD-denominated "P0 = $0.0000002" on
  `ecosystem.html:1125` / `lp-strategy.html:825` implies ETH ≈ $667 and conflicts with the
  ~$2,000 ETH assumption used on the same pages.
- **Fix direction:** wei everywhere (one canonical figure), USD only as dated examples.

#### [CWA-68] Developer-reference API drift (integration.html, faq.html, lock-mechanism.html, governance.html)
- **Severity:** Medium · **Status:** Open — every item lead-verified against source
- **Instances:**
  - `integration.html:1266-1272` documents `swapWithFee(adapter, data, tokenIn, amountIn,
    voucher)`; actual: `swapWithFee(adapter, swapData, voucher, voucherSig, useVoucher)`
    (FeeRouterV1.sol:90-96).
  - `integration.html:1274-1284` documents `DiscountVoucher{user, discountBps, nonce, deadline,
    signature}`; actual: `{user, discountBps, maxUses, expiry, nonce}` (`:42-48`), and
    `isVoucherValid` returns `(bool, string)` (`:164`), not `(bool)`.
  - `integration.html:1036` — `recordLockReward(partnerId, lockAmount)`; actual:
    `recordLockReward(bytes32, uint256, address wallet)` (PartnerVault.sol:265-269).
  - `integration.html:1046-1051` — `partners(uint256)` returning `(address,uint256,…,bool,bool,
    string)`; actual: `partners(bytes32)` returning `(address, 4×uint256, 3×uint32, bool, bool,
    uint8)` (PartnerVault.sol:463-480) — the getter exists (an earlier draft of this audit
    wrongly denied it), but key type and shape are wrong.
  - `integration.html:951-952` — "Ethers.js v5 (CommonJS)" while the same page's examples use
    v6 (`:756`, `:1068`) and the repo pins ethers 6.17.0.
  - `integration.html:1223` — `/auth/siwe/nonce` documented GET; implemented POST
    (apps/points-backend/src/routes/auth.ts:20).
  - `faq.html:1090` — lists `lock(uint256, string)`; code has `lock(uint256)` and
    `lockWithType(uint256, bytes32)` (IFRLock.sol:51,58).
  - `faq.html:934` — "finalise() … once the minimum ETH threshold is met"; no minimum-ETH
    threshold exists (BootstrapVaultV3.sol:138-153 — time + IFR-balance checks only).
  - `lock-mechanism.html:788` — "`lockedAt` = block timestamp of the **first** lock"; code
    overwrites it on every lock (IFRLock.sol:121). `:835` — "stores a lockType for resolver
    metadata"; lockType is event-only, not stored (`:24-27`, `:125`).
  - `governance.html:943` — revert string documented as `"Governance: too early"`; actual:
    `"too early"` (Governance.sol:89).
- **Fix direction:** regenerate the API tables from the compiled ABIs (the repo already builds
  them — `/abi/`); one source of truth.

### Low

#### [CWA-69] Status/phase incoherence across the wiki
- **Severity:** Low · **Status:** Open
- **Instances (lead-verified):** `open-audit.html:690` "Phase 4: Two-Chamber DAO, 48h timelock —
  **Verified**" (contracts don't exist; other pages say Phase 4 NEXT/planned); `open-audit.html:687`
  "17 on-chain components (13 + 3 Safes)" (sums to 16); `press-kit.html:847-854` schedules
  "multisig governance" for Phase 3 (Q3–Q4 2026) while 3-of-5 is active since 15.03.2026;
  `governance.html:1405` "Next: Multisig Governance" (live since 20.03.2026, same page `:857`);
  `governance.html:1105-1127` "Upcoming & Planned Proposals" + red "CRITICAL — must execute
  before first user lock/deposit!" on proposals #11/#12, both executed 06.04.2026;
  `ecosystem.html:1161` proposals #15/#16 "queued (ETA 08./09.06)" — executed;
  `protocol-plan.html:822/974/1227` "Bootstrap LIVE — accepting ETH" vs `:994` "ENDED
  05.06.2026" on one page; `wallet-guide.html:836` "Proposals: #0–#9 executed" (#11–#16
  missing); `mainnet-checklist.html:1118-1127` FeeRouter setup all "Pending" (voucher signer is
  configured; 371,544 IFR have accrued); `protocol-plan.html:1045-1052` Phase-1 bar 150M vs
  executed 100M text; roadmap/security/transparency disagree whether DAO is Phase 4, Phase 5 or
  Milestone 5; multisig history: `governance.html:1604-1608` (Phase 0 "Single EOA") vs
  `faq.html:884` / `multisig.html:618-645` (Phase 0 "Genesis 1-of-2", extra 2-of-5 phase);
  EOA→Safe migration 06.03 vs 07.03 on transparency.html itself.
- **Fix direction:** one status register (single page) that others embed or link.

#### [CWA-70] Remaining count drift beyond CWA-20/54/55
- **Severity:** Low · **Status:** Open
- **Instances:** `testnet.html` four divergent Sepolia counts (17 meta / 14 body / 13+3 JSON-LD;
  roadmap:621 says 16) plus "10 governance proposals were executed on Sepolia" vs its own
  table's 6 executed / 4 cancelled; `bootstrap.html:1048` "27 automated tests" (actual 30
  top-level `it()` in test/BootstrapVaultV3.test.js); `one-pager.html:710` + `roadmap.html:648`
  "35 wiki pages" (36 at pinned commit; wiki/index.html's own meta is correct); `multisig.html:869`
  "all 13 contracts verified" (14); `wallet-guide.html:635` "All 7 wallets" vs 8 wallet cards on
  the same page (`:606-619` stats bar says 8).
- **Fix direction:** regenerate counts at build time where possible; at minimum fix the
  within-page contradictions.

#### [CWA-71] Landing-page stale fallbacks and mechanism summaries
- **Severity:** Low · **Status:** Open
- **Page:** `docs/index.html` — `:2309` SVG fallback "997.7M supply · 2.3M burned" and `:2757`
  "2.33M IFR Burned" (chain @ 25974493: **2,428,860 burned**; fallbacks disagree with each
  other); `:2371` "FeeRouter 314.2K IFR fees held" (chain: 371,544); all three are
  `data-live-key` fallbacks — correct after JS loads, wrong for no-JS/preview contexts
  (link previews, crawlers, reader mode). `:2266` "Irrevocable IFR lock … Auto-unlock after 30
  days" — the summary collapses two mechanisms: auto-unlock applies only 30 days *after a
  condition is met* (CommitmentVault.sol:51,148-170), and TIME_ONLY tranches are unlockable by
  design. `:2974` "On-chain verified via RatVoting.sol" for a contract that exists nowhere
  (grep `contracts/`: 0 hits) — labeled "not live" one line up. `:2` HTML comment "content
  baseline 2026-08-22" predates the page's own 26.08/01.09 content.
- **Fix direction:** update fallbacks to the current snapshot; rewrite the CommitmentVault
  summary; delete the RatVoting "verified" clause.

#### [CWA-72] bootstrap.html internal inconsistencies
- **Severity:** Low · **Status:** Open
- **Instances:** funding table (`:886-904`) "Community Safe 60M sent / 57.9M received … 50M
  Bootstrap + ~7.9M reserve" vs the same page's timeline rows (`:1230-1241`) "Community Safe →
  Vault: 50M IFR" and parameter row (`:1173`) "Treasury (150M) + Community (50M)" — three
  values for one fact. Footnote `:908` "Transfers were subject to the 3.5% fee-on-transfer …
  Treasury sent 150M, vault received 150M" — impossible as written (150M × 0.965 = 144.75M);
  the two Safes are fee-exempt on-chain, so the fee premise itself is doubtful. `:1406` example:
  "10% of the claim allocation" computed as ~19,475,000 IFR — 10% of 100M is 10,000,000.
  `:2231` second widget computes IFR-per-ETH from `parseUnits("200000000", 9)` while the page's
  wallet widget uses the verified 100M (`:1940`) — the two on-page estimates diverge 2×.
  Timeline: contributions open 07.03 (`:1246`) but "BootstrapVaultV3 deployed + verified 08.03"
  (`:1226`) — coherent only via the deprecated V1, which the page mentions once in a
  struck-through table row (`:1037`) without connecting it to the timeline.
- **Fix direction:** settle on 150M + 50M (the chain-consistent story), fix or delete the
  example and the second widget, one sentence on the V1→V3 migration.

#### [CWA-73] Mechanism/UX wording overstatements (assorted pages)
- **Severity:** Low · **Status:** Open
- **Instances:** `commitment-vault.html:854` "Once unlocked, stays unlocked — even if the price
  drops afterwards" — only true once `markConditionMet` has latched `conditionMetAt`; a plain
  `unlock()` re-evaluates the condition (CommitmentVault.sol:148-170). (Moot for price
  conditions on mainnet — CWA-03.) `docs/web3/index.html:1794` — "The hero is built with a
  replaceable Three.js layer": no Three.js exists in the page (grep: 1 hit — the sentence
  itself); the hero is a static image. `agent.html:798` — "every answer includes a `Source: …`
  reference pointing to the specific documentation page or contract": the shipped widget shows
  only a static generic "Source: IFR_KNOWLEDGE" badge (IFRCopilot.tsx:246). `agent.html:799` —
  "the copilot **only** answers from IFR_KNOWLEDGE": the server additionally injects a live wiki
  fetch into the context (server/index.ts:483) — the knowledge-bound claim is stronger than the
  implementation (CWA-24 related). `open-audit.html:787` — a live-status JS snippet targets
  element ids absent from the page (never rendered; dead code). `builder.html:125` — static
  "85 SAFE" placeholder vs the same page's formula computing 90 (self-corrects on load).
  `tokenomics.html` — two sections numbered "7." (`:1419`, `:1465`). Doc-version footers drift
  (v1.0 / v1.1 / v2.2 across pages).
- **Fix direction:** per-instance wording fixes; delete dead code.

### Informational

#### [CWA-74] Notes and unverifiable-but-plausible claims (no defect)
- Migration arithmetic notes: Community Safe 60 − 50 − 7.9 leaves 2.1M unexplained on
  index.html's flow (other spends possible); Treasury 150 − 144.75 = 5.25M unexplained in
  protocol-plan's text. transparency.html:1208 "C2 50% lock" vs the figures it cites
  (20,156,940.95 of 33,333,333.33 = 60.5% — the 50% is LOCK_BPS of the *post-buy* balance;
  chain-consistent, wording confusing). Process claims with no repo source (48h PR review,
  LP-addition announcements, "all signers have hardware wallets" Pending vs multisig.html's
  policy-as-fact). Sepolia governance table rows (#0–#9) unverifiable read-only. The benefits
  app's "typical 1,000 IFR" (WalletStatus.tsx:290) vs its own 500-IFR "Welcome benefit"
  template (SellerRuleBuilder.tsx:94) — both hedged, pulling opposite directions.
  vesting.html:984 (transferable guardian) is *correct per code* — the stale item here is our
  own register wording ("W18 guardian not rotatable"); reconcile in the register.

## 5. Link & structure integrity (repo-pinned, scripted)

Script: `docs/community-audits/CWA_IFR_ContentCoherence_LinkCheck_2026-09-14.py` (same
convention as the CWA fuzz harness). Output: `evidence/content-audit/link-check.txt`.

- **39 pages scanned; 0 dead internal links; 0 orphan pages** — after resolving the site
  conventions (GitHub Pages root = `docs/`; `https://ifrunit.tech/…` treated as internal).
  The apparent 53 dead links in a naive run are root-absolute paths that resolve correctly
  against the site root — methodology note, not a defect.
- **3 dead in-page anchors**, all on `docs/wiki/integration.html`: `#creator-gateway` (×2,
  `:1206-1207`) and `#e2e-flow` (`:1251`) — link cards promise a "Creator Gateway Spec/Guide"
  and "E2E Flow Guide" section that does not exist (folded into CWA-68).
- 1,528 absolute `ifrunit.tech` references resolve; external hosts (276 Etherscan links etc.)
  not HEAD-checked en masse — spot checks OK; the truncated-hash Etherscan hrefs are covered
  in CWA-61.
- Live-vs-repo spot check: sampled pages served from GitHub Pages match the pinned commit
  (no deploy drift detected at audit time).

## 6. Verified strengths (checked and held)

- **Every contract address on every audited page matches the deployment map** — including all
  13 rows on deployment.html, the landing's contract table, the dApp's dialogs, and the shop's
  `contracts.ts` constants. The only address-class defect is the wrong-network *Sepolia column*
  (CWA-60).
- **Shop copy: 83/83 claims verified** — profile limits (5/25), history TTL (10 min), page size
  (50), QR TTL bounds, single-redeem checkout, sessionStorage-only tokens, masked seller views,
  `llms.txt` statements (incl. "Sepolia prototype, not production") — all match the code.
  Cleanest surface of the audit.
- **liquidity.html: 14/14 claims verified against the calculator source** — the 0.997 factor,
  60 s refresh, 3-minute expiry, and the capacity formula all match `docs/assets/*.mjs`.
- **C2's identical lock and offer amounts are TRUE on-chain** — offer(0) belongs to C2
  (0x80fF…B6958) with exactly 20,156,940.952845656 IFR @ 25974493, matching its CommitmentVault
  lock; the 50/50 `LOCK_BPS` design reconciles the identity. An agent-proposed "impossible"
  finding was dissolved by the chain read.
- **Core economics copy is correct wherever it matters:** fee split (200/50/100 bps), 5% cap,
  9 decimals, no-mint, allocation buckets (sum = 100%), vesting arithmetic (4.17M/month, March
  2027 cliff, March 2030 end), lending rate tables (200–2500 bps mapping), collateral thresholds
  (200/150/120), bootstrap parameters (0.01–2 ETH, 90 days), FAQ math examples, annualized-rate
  table, "82 questions" (counted: 82), wiki/index "36 pages" meta (counted: 36).
- **Honesty patterns worth keeping:** dated snapshots, "historical" disclaimers on the 544
  figures, "internal audits ≠ professional certification" wording, and the seeded "fail-closed"
  disclosures on lending pages are accurate and made this audit faster.

## 7. Honesty notes (lead verification corrections)

- Agent proposal "governance.html 'Deployer holds 0 IFR' contradicts the ~21k IFR register
  entry" — **dropped**: `balanceOf(Deployer) = 0` @ 25974493; the wiki is right, and the
  register note (AUDIT_SCOPE) is what aged. transparency.html:1359's own narrative explains the
  ~21k accumulation window correctly.
- Agent proposal "PartnerVault has no `partners()` getter" — **narrowed**: the getter exists
  (PartnerVault.sol:463); the doc errors are the key type and return shape (CWA-68).
- Agent proposal "press-kit 'Anthropic API' claim unverifiable" — **dropped**: the copilot calls
  `api.anthropic.com/v1/messages` via fetch (server/index.ts:488-492); no SDK dependency is
  required for the claim to be true.
- contracts.html:2402 staleness means our own merged `contract-map.md:28` (Deployer-EOA row)
  needs the same correction — flagged in CWA-64.

## 8. Limitations

- Live external links (276 Etherscan + others) not HEAD-checked en masse; repo-internal link
  integrity is complete (script above). TX hashes quoted on pages are unverifiable where pages
  truncate them (itself filed under CWA-61).
- Sepolia state verified only against the documented map; Sepolia proposal history is
  no-source (CWA-74).
- Dynamic shop routes (`/b /r /p /s`) are robots-excluded by design and were out of the copy
  scope; their wiring was covered by the Web3 integration audit (CWA-46…50).
- Chain state is a moving target: distribution figures are block-pinned to 25974493 and will
  drift (the LP pair's IFR side already moved 36.1M → 11.9M since the 16.06 snapshot).

## 9. Disclaimer

Content-coherence audit of public pages against public sources and chain state. Not a security
audit of the underlying code (see companion documents) and not financial advice. All
verification read-only; no transactions, no authenticated calls, no changes to the audited
material. AI-assisted analysis; every finding quote and chain value was re-verified by the lead
before inclusion.
