# IFR Protocol — AI Readiness Audit (copilot knowledge + AI anchors)

**Auditor:** Collateral Web3 Open Audits
**Client:** NeaBouli / Inferno Protocol (ifrunit.tech)
**Date:** 2026-09-14
**Baselines:** repo `NeaBouli/inferno` @ `e8cf1ece8c40c0fa19f18344fe25593304ef5c26` · mainnet
block **25974493** · live anchor checks 2026-09-14 (anonymous-browser GET/HEAD only)
**Companion documents:** full-scope (CWA-01…24), deep audit (CWA-25…27), surfaces (CWA-28…45),
integration (CWA-46…50), README (CWA-51…56), content coherence (CWA-57…74)
**Method skill:** `ai-readiness-audit` (this audit is its reference application)
**Report version:** 1.0

Scope, two halves: **(A) the IFR Copilot's knowledge** — can the bot answer correctly?
(`apps/ai-copilot`: knowledge file, mode prompts, local wiki RAG, live wiki fetch, safety
rails, endpoint answer sources) and **(B) the project's AI/search anchors** — can external AI
and search engines discover it correctly? (robots.txt, sitemap.xml, llms.txt, ai.txt, JSON-LD,
meta/og/canonical — on apex, web3, shop).

**Verdict: READY w/ gaps.** The anchor layer is unusually strong for a project this size
(llms.txt on all hosts, explicit AI-crawler policy, complete sitemap, valid JSON-LD on 38/39
pages). The copilot's knowledge architecture is layered and mostly accurate on core facts — but
it teaches users a **tier system that contradicts its own API**, advertises a **premium
on-chain-context feature that is not implemented**, and two reliability flaws in the live-wiki
fetch can silently degrade or slow every answer. The bot is not "trained" in the ML sense — it
is context-grounded (static knowledge + bundled RAG + hourly live wiki); that design choice is
sound, the defects are in the details.

**Findings: 0 Critical · 0 High · 4 Medium · 3 Low · 1 Informational (CWA-75 … CWA-82)**

## 1. Copilot knowledge path (verified map)

| Layer | Source | Evidence |
|---|---|---|
| Static knowledge | `apps/ai-copilot/src/context/ifr-knowledge.ts` (319 lines), JSON-stringified into every mode prompt | `system-prompts.ts:27-28, 88, 119, 177` |
| Local wiki RAG | pre-built `src/context/wiki-content.json` (36 docs, 2,000 chars/doc, ≤8 docs/mode) | `server/wiki-rag.ts:18-151` |
| Live wiki fetch | hourly crawl of `ifrunit.tech/wiki/*` + landing, tag-stripped, 4,000 chars/page, ≤80k chars injected into the **system** role with "Always prioritize" | `server/index.ts:90-156, 481-484` |
| Surface context | per-host allowlisted app hints | `server/surface-context.ts:3-8` |
| Model | `claude-haiku-4-5-20251001` via fetch (no SDK), max_tokens 500 | `server/index.ts:488-501` |
| Not in chat path | RPC/Etherscan reads (standalone REST endpoints only); points backend is POST-only telemetry | `index.ts:527-537`, §6 table in evidence |

RAG slot note: the priority lists have 7 entries and the filler always lands on
`agent.html` as the permanent 8th doc in every mode (`wiki-rag.ts:124-151`) — the page carrying
the CWA-73 overstatements is therefore *always* in context.

## 2. Knowledge completeness vs canonical facts (block 25974493)

**Covered and correct (spot-checked):** token address/decimals/genesis, fee split and cap, LP
pair, bootstrap parameters and outcome, LP stranding (W17), governance 48h/TreasurySafe 3-of-5,
CEX policy, CommitmentVault address + balance + fail-closed price path, LendingVault address +
3 offers + rates + collateral tiers, rewardBps 1500/cap 4M, LiquidityReserve 200M/50M-cap,
LP Reserve 400.6M, BuilderRegistry address + 0 builders, 1,000-IFR premium gate. The core is
solid.

**Wrong/stale and absent** → findings CWA-77/78/79 below. **Absent from the static file**
(reachable only via RAG/live-wiki, if at all): points/voucher mechanics, FeeRouter state
(5 bps/25 cap/371,544 stranded), lending interest split + unset protocolFeeReceiver, vesting
schedule details, Treasury 0 / Community 7.9M balances, per-contributor claim amounts, the W15
guardian exception. Full matrix: `evidence/content-audit/copilot-checks.txt` + agent ledger.

## 3. Findings

### Medium

#### [CWA-75] Live-wiki fetch wipes last-good cache on failure and refetches inside every chat request
- **Severity:** Medium · **Status:** Open · **Component:** `apps/ai-copilot/server/index.ts:90-156`
- **Evidence:** the outer `catch` (:148) only logs; execution then writes
  `liveWikiContext = results.join()` (:152) — on discovery failure `results` is empty, so the
  **last good context is destroyed** and the timestamp bumped (:153). The early-return (:97)
  requires a non-empty cache, so until the next successful crawl **every `/api/chat` call runs
  the full sequential fetch loop** (per-page 5 s timeouts, :130) before the Anthropic call.
- **Impact:** a transient outage of the wiki index turns into multi-second latency amplification
  on every chat request plus degraded answers (static knowledge only) — with no disclosure to
  the user. Self-reinforcing under load (CWA-12 context: cost guard is warn-only).
- **Fix direction:** only overwrite cache/timestamp on success; serve stale-if-error; move the
  refresh out of the request path (background timer).

#### [CWA-76] Live-wiki discovery follows off-origin `.html` links into the system prompt
- **Severity:** Medium · **Status:** Open · **Component:** `server/index.ts:106-123`
- **Evidence:** the discovery regex accepts **any** `href="http…"` ending in `.html` found on
  the wiki index page (:110-114) and injects the fetched text into the system role capped at
  80k chars with "Always prioritize this context" (:483). The CWA-24 trust boundary (hourly
  fetch of project pages) silently extends to any third-party host the wiki index links to.
- **Impact:** today the wiki index links only in-origin (verified against the page at the pinned
  commit) — but a future off-origin link (compromised third party, typo to a lookalike domain)
  lands unfiltered in the bot's authoritative context. No content sanitization beyond tag
  stripping; no prompt-injection screening.
- **Fix direction:** restrict discovered URLs to the `ifrunit.tech` origin; consider a hash-pinned
  wiki snapshot as the authority instead of live HTML (CWA-24).

#### [CWA-77] The copilot teaches two contradictory tier systems
- **Severity:** Medium · **Status:** Open
- **Evidence:** user-mode prompt and widget welcome teach "Bronze 1K, Silver 2.5K, Gold 5K,
  Platinum 10K IFR" (`system-prompts.ts:95`, widget `index.ts:358`) while the knowledge file and
  the live endpoints use Basic/Premium/Pro at **500/2,000/10,000** (`ifr-knowledge.ts:244-248`;
  `/api/ifr/check` logic `index.ts:1498-1501, 1913`). A user asking the bot "which tier do I get
  for 1,500 IFR" receives a different answer from chat than from the check API.
- **Impact:** in-product contradiction about the product's core gating numbers; same family as
  the CWA-20 wiki tier drift, but this instance is *operational* (the API enforces one table
  while the bot teaches another).
- **Fix direction:** one tier table, imported by prompt, knowledge file and API from a single
  constant.

#### [CWA-78] "Premium Copilot uses verified on-chain wallet/lock context" is not implemented
- **Severity:** Medium · **Status:** Open
- **Evidence:** claims at `system-prompts.ts:65` ("users who lock >=1,000 IFR unlock Premium …
  based on verified on-chain lock status"), `:103` ("it can use verified wallet and lock
  context"), `ifr-knowledge.ts:64-66`, and the React component (`IFRCopilot.tsx:218`). The chat
  handler injects **no** chain state: the `x-wallet-address` header feeds only the points
  telemetry (`index.ts:527-537`); the RPC reads serve the standalone REST endpoints, not
  `/api/chat` (:442-540).
- **Impact:** users lock 1,000 IFR expecting the advertised personalized on-chain guidance; the
  feature they paid attention (and a lock) for does not exist at runtime. Distinct from CWA-53/73
  (README/wiki overstatements) — this is the runtime prompt + in-product claim itself.
- **Fix direction:** either inject verified balance/lock context server-side for locked wallets
  (chain read at request time, cached), or remove the claim from prompts, knowledge and widget.

### Low

#### [CWA-79] Stale/wrong static-knowledge rows (cluster)
- **Severity:** Low · **Status:** Open
- **Instances (lead-verified):** `ifr-knowledge.ts:40` supply frozen at block 25812380
  (997,673,879.09) vs canonical 997,571,140.02 @ 25974493 — honestly block-pinned but aging;
  widget dev welcome "544 documented tests • 91% branch coverage" (`index.ts:359`) vs
  644+30+36 (CWA-20 family); `ifr-knowledge.ts:156` builder "tests: 27/27" vs 30;
  `ifr-knowledge.ts:139` proposal ledger omits executed #13/#14 while `:188` and
  `system-prompts.ts:154` credit exactly those with the Buyback wiring (internal contradiction);
  `ifr-knowledge.ts:153` `builderRegistry.sepolia` = `0x77e9…A6e7B` — the **mainnet token**
  address (copy-paste).
- **Fix direction:** refresh the snapshot values; single canonical proposal list; correct or
  delete the Sepolia field.

#### [CWA-80] Copilot policy/UX contradictions and latent defects
- **Severity:** Low · **Status:** Open
- **Instances:** "NO CONTRACT ADDRESSES IN RESPONSES" (`system-prompts.ts:37`) vs dev mode
  listing 12 addresses and instructing the model to cite them (`:137-148`, `:171`) — outcome is
  model-dependent; widget history cap 40 (`index.ts:397`) vs server cap 20 (`:465-468`) → users
  hit a hard 400 mid-conversation; copilot's `checkHealth` declared `view` (`index.ts:1574`) but
  the contract function is state-changing (LendingVault.sol:308, emits MarginCallWarning) —
  latent, uncalled today; `POST /api/bootstrap/vote` still accepts "finalise"/"refund" votes
  although the bootstrap finalized 05.06.2026 (`index.ts:1202-1226`; extends CWA-13's unsigned-
  vote finding with a sunset question).
- **Fix direction:** scope the address ban to non-dev modes; align caps; correct or remove the
  ABI entry; sunset the vote endpoint.

#### [CWA-81] AI-anchor defects on the web3 host (+ minor apex items)
- **Severity:** Low · **Status:** Open
- **Evidence (live-fetched 2026-09-14, `evidence/content-audit/anchor-*.txt`):**
  - `https://web3.ifrunit.tech/llms.txt` drops the exemption qualifier: "Every transfer burns
    2.5% permanently" — false as stated (apex llms.txt correctly says "standard transfer
    between non-exempt addresses").
  - `https://web3.ifrunit.tech/sitemap.xml` lists **ifrunit.tech** URLs (cross-host sitemap —
    ignored by search engines for URLs outside the host) and misses `wiki/liquidity.html`
    (38 vs 39 entries).
  - Apex `sitemap.xml` lists `https://ifrunit.tech/web3/` although that page canonicalizes to
    `https://web3.ifrunit.tech/` (sitemap↔canonical mismatch).
  - `lastmod` is stale on 27 of 39 sitemap entries (2026-04-07) — pages changed through
    September (e.g. bootstrap/wiki updates in June–September).
  - `docs/builder.html` is the only page without a JSON-LD block (38/39 have one; all blocks
    parse as valid JSON-LD — `evidence/content-audit/jsonld-check.txt`).
- **Fix direction:** sync the web3 copies with apex; per-host sitemaps with same-host URLs;
  regenerate lastmod at build time; add JSON-LD to builder.html.

### Informational

#### [CWA-82] Anchor completeness notes (policy choices, not defects)
- No `llms-full.txt`, `humans.txt`, `.well-known/ai-plugin.json` on any host (all optional).
- AI-crawler policy is explicitly `Allow` for GPTBot, ClaudeBot, Google-Extended, PerplexityBot,
  anthropic-ai, cohere-ai on all hosts — a deliberate, consistent choice worth recording.
- Anchor-carried instances of known page claims: apex llms.txt repeats "48-hour timelock, no
  instant changes" (→ CWA-62) and "all verified on Etherscan" (→ CWA-20 family); both flow to
  external AI answers.
- Wiki-content defects (CWA-57…74) flow into copilot answers via the prioritized live fetch —
  cross-reference, not a new finding: fixing the wiki fixes the bot's second knowledge source.

## 4. External anchor inventory (all live-fetched 2026-09-14)

| Anchor | apex ifrunit.tech | web3 | shop | Notes |
|---|---|---|---|---|
| robots.txt | ✓ AI-allows + sitemap ref | ✓ same policy | ✓ precise allow/disallow + Host + Sitemap | shop excludes `/api/ /b/ /p/ /r/` by design |
| sitemap.xml | ✓ **39/39 pages complete, no orphans** | ⚠ cross-host + 38/39 | ✓ 5 URLs matching robots | apex lastmod stale on 27 |
| llms.txt | ✓ comprehensive, mostly chain-accurate | ⚠ wrong burn qualifier | ✓ accurate (matches code-verified copy) | no llms-full.txt anywhere |
| ai.txt | ✓ minimal, correct pointers | ✓ same | ✓ (in repo public/) | — |
| JSON-LD | 38/39 pages, all valid | ✓ | n/a (app shell) | builder.html missing |
| meta/og/twitter | present across pages | ✓ | ✓ | spot-checked |
| canonical | self-referential; /web3/ → web3 host | ✓ correct dedup | ✓ | verified |

Apex llms.txt verified in detail: all **14** contract addresses correct (incl. BuilderRegistry
`0xdfe6636D…0EE3` vs contract-map), test counts correct (CommitmentVault 46, LendingVault 56 —
counted in repo), block-pinned supply honestly labeled, "Contributor locks verified for
C1/C2/C3" **chain-verified TRUE** (`getTrancheCount` = 2/10/11 @ 25974493), CEX/listing status
accurate, "seller rewards are not active" correctly stated.

## 5. Verified strengths

- The copilot's core knowledge is accurate on everything spot-checked (§2 list) — addresses,
  fees, vault states, rates, governance — the layered design (curated static + bundled RAG +
  hourly live refresh) is the right architecture for a docs-heavy project.
- Client-side seed-phrase interceptor exists in the React component (IFRCopilot.tsx:55-65) —
  but see CWA-53: the served inline widget lacks it.
- The anchor layer is best-in-class for the project's size: AI-crawler policy explicit, llms.txt
  on all three hosts with mostly verified content, complete sitemap, valid JSON-LD, correct
  canonical dedup of the web3 double-hosting.
- Safety rate limits, body/message caps and CORS allowlist are implemented in code (not just
  prompts).

## 6. Limitations

- No POSTs to the live chat endpoint (series boundary: anonymous-browser GETs only) — answer
  quality was assessed from the knowledge path statically, not by sampling live answers.
- The bundled `wiki-content.json` snapshot was treated as build-faithful to `docs/wiki/`
  (spot-checked); its build timestamp is not pinned in-repo.
- Copilot live config (model, env) inferred from source + `/api/health` behavior documented in
  CWA-11; no authenticated probing.

## 7. Disclaimer

AI-readiness review of the project's own copilot and its public discovery anchors. Not an ML
evaluation, not a security audit of the LLM vendor, not financial advice. All verification
read-only. AI-assisted analysis; every finding was re-verified line-by-line by the lead before
inclusion (`evidence/content-audit/copilot-checks.txt`, `anchor-*.txt`, `jsonld-check.txt`).
