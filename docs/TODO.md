# IFR Protocol — Developer TODO List
> Last updated: 2026-03-18 | Branch: main

---

## CLAUDE CODE — STANDING INSTRUCTIONS (read before every task)

> These instructions apply to EVERY task. Execute them at the END of every prompt.

### After completing ANY task — always run this checklist:

**1. Test Count Sync**
Find new test counts:
```
npx mocha tests/**/*.test.js --reporter min 2>&1 | tail -3
npx hardhat test --reporter min 2>&1 | tail -3
```
Then update ALL of these if counts changed:
- `docs/index.html` — test badges/counters
- `docs/wiki/index.html` — Quick Stats (Tests, Wiki Pages, On-chain Components)
- `docs/wiki/security.html` — test table + totals
- `docs/wiki/faq.html` — JSON-LD + FAQ answers
- `docs/wiki/press-kit.html` — tech stack table
- `docs/wiki/one-pager.html` — stats table
- `docs/wiki/roadmap.html` — phase checklist
- `README.md` — test count table
- `docs/DOCS.md` — test summary
- `docs/PROJECT-SUMMARY.md` — test totals
- `docs/STATUS-REPORT.md` — status header
- `docs/MAINNET_CHECKLIST.md` — checklist header
- `docs/WHITEPAPER.md` — security section
- `docs/PRESS_KIT.md` — tech stack
- `docs/ONE-PAGER.md` — stats
- `docs/COVERAGE_REPORT.md` — header
- `docs/FULL_REVIEW_REPORT.md` — review summary
- `docs/CHATGPT_AUDIT_PROMPT_V2.md` — audit context
- `docs/CHATGPT_AUDIT_PROMPT_V4.md` — audit context
- `docs/AUDIT_BRIEF.md` — brief summary
- `docs/AUDIT_SUBMISSION.md` — submission stats
- `docs/SECURITY_POLICY.md` — security table
- `docs/CONTRIBUTING.md` — contributor guide
- `docs/PATCH-GUIDELINES.md` — patch checklist
- `docs/TESTNET_GUIDE.md` — expected output
- `docs/ROADMAP.md` — phase checklist
- `SKYWALKER.md` — project instructions
- `apps/ai-copilot/src/context/system-prompts.ts` — Ali knowledge
- `reports/docs-status.md` — docs watchdog
- `reports/docs-watchdog-report.md` — watchdog report
- `audit/summary.md` — audit summary
- `audit/test-audit.md` — test audit
- `audit/contracts/token-audit.md` — token audit
- `audit/BOOTSTRAP_SECURITY_REVIEW_13032026.md` — bootstrap review
- `docs/TODO.md` + `docs/TODO.html` — always

**2. Wiki/Contract Count Sync**
If a new wiki page or contract was added:
```
ls docs/wiki/*.html | wc -l          # → update "26 wiki pages" everywhere
ls contracts/*.sol | wc -l           # → update "14 on-chain components" everywhere
```

**Quick bulk replace command:**
```
grep -rn "OLD_COUNT" docs/ README.md SKYWALKER.md reports/ audit/ apps/ai-copilot/ \
  --include="*.html" --include="*.md" --include="*.ts" | grep -i test
```

**3. Consistency Check**
```
grep -rn "TODO: IFR_UPDATE" docs/ --include="*.html" | head -20
```
Visit each marked location and update if needed.

**4. TODO.md Update**
- Mark completed items: `[ ]` → `[x]`
- Move to COMPLETED section
- Update "Last updated" date

**5. TODO.html Sync**
Regenerate TODO.html from TODO.md content.

**6. Commit everything together** — never leave counts out of sync.

**7. EVERY 7th PROMPT — SEO/AI Marker Audit:**
Check all wiki pages + landing page for:
- `<meta name="description">` present and current?
- `<title>` correct and unique per page?
- `<link rel="canonical">` set?
- JSON-LD Schema.org block present? (WebSite/Article/FAQPage)
- Open Graph: og:title, og:description, og:image, og:url
- Twitter Card: twitter:card, twitter:site, twitter:title
- robots.txt allows GPTBot/ClaudeBot/PerplexityBot?
- sitemap.xml current (all 26 wiki pages)?
- All IFR_UPDATE markers visited and current?
- h1/h2/h3 hierarchy correct (no h1→h3 jumps)?
On errors: fix immediately, commit with `seo:` prefix.

---

## BUG FIXES (15.03.2026)

- [x] Bootstrap Widget: number formatting (19,475,000 → 19.48M) ✅
- [x] Bootstrap ConsensusModule: wallet-connected voting buttons ✅
- [x] MetaMask Mobile: centralized deep-link + pending connect ✅
- [x] Protocol Plan wiki page created (26 pages) ✅

## CRITICAL

### Governance Proposals
- [x] ✅ Proposals #7/8/9 — EXECUTED 18.03.2026
      TX #7 (Deployer feeExempt):      `0xfbb98818e1124e5c238b209cef370370e01474538fead9d1e279a4bf4baae644`
      TX #8 (TreasurySafe feeExempt):   `0x4caadb53fc0a7a8f8635bd478155419c2b96fb16d70a00c87a71e828b6fd7f59`
      TX #9 (CommunitySafe feeExempt):  `0x1d43de02fe76da2f94ead84c2037f4f96b3ecb13a9fb8a5afb5bd838ecf08259`
- [x] ✅ feeExempt verified on-chain: Deployer, TreasurySafe, CommunitySafe
- [ ] 🟡 Proposal #10: `transferOwnership(TreasurySafe)` — QUEUED, ETA: 2026-03-20T07:18:23 UTC

### Known Bugs
- [x] Landing Page Stats FINAL FIX (19.03.2026): LP Reserve Safe 0→400.6M, Protocol Locked 350M→998.5M, all stats verified on-chain ✅
- [x] Builder Vault lock mechanism documented for all users (19.03.2026): index, tokenomics, wallet-guide, faq, security, fair-launch ✅
- [x] Multisig 2-of-4 references removed — all Safes already 3-of-5 since 15.03.2026 ✅
- [x] Ali Copilot facts updated: supply, component count, governance proposals, multisig (19.03.2026) ✅
- [x] SEO: llms.txt created + preconnect Railway (19.03.2026) ✅
- [x] Landing Page performance: defer scripts + fetch timeout 8s (19.03.2026) ✅
- [x] Wiki index: all 27 pages now have cards (was 16/27) (19.03.2026) ✅
- [ ] Android MetaMask Deep-Link: opens new browser instance instead of returning to Chrome
- [ ] npm audit: 34 vulnerabilities (2 critical, 9 high, 11 moderate, 12 low) — fix after LP launch
      Link: https://github.com/NeaBouli/inferno/security/dependabot
      Note: affects node_modules only, not Solidity contracts
- [x] Bootstrap public stats: PublicNode RPC fallback + _publicStatsLoaded race guard ✅
- [x] Recent Votes: loadSavedVotes() on DOMContentLoaded ✅ (bc18c85a)
- [x] WalletConnect placeholder text removed ✅

### Bot & Infrastructure
- [x] `voteAnnouncement.js` — Bot announces Governance Proposals + verify.html link + 24h reminder ✅
- [x] `SIGNER_WALLETS` gesetzt in Railway (alle 5 Signers: A.K./M.G./A.M./Y.K./A.P.) ✅ 16.03.2026
- [x] `VERIFY_PORT=3001` gesetzt in Railway ✅ 16.03.2026

### Core Developer (external)
- [ ] Deploy BuilderRegistry.sol on Sepolia
- [ ] BuilderRegistry audit
- [ ] Deploy BuilderRegistry on Mainnet
- [ ] `BUILDER_REGISTRY_ADDR` in Railway env (after deploy)

---

## THIS WEEK

### Multisig
- [x] A.M. als 3. Signer hinzugefügt ✅
- [x] Y.K. als 4. Signer hinzugefügt ✅
- [x] Threshold auf 2-of-4 gesetzt ✅ (14.03.2026)
- [x] 5. Signer Psaltin (A.P.) hinzugefügt (beide Safes) ✅ (15.03.2026)
- [x] Threshold auf 2-of-5 gesetzt ✅ (15.03.2026)
- [x] Threshold auf 3-of-5 gesetzt ✅ (15.03.2026)
- [ ] Transfer Governance → GnosisSafe ownership

### Telegram Bot
- [x] `/announce` command: auto-append community link (`https://t.me/IFR_token/1`) ✅
- [x] Channel → Community Announcements auto-sync + pin ✅
- [x] Keep latest announcement always pinned ✅
- [x] Test Daily Welcome (`/testwelcome` admin command) ✅
- [x] Test Daily Burn Report (`/testburn` admin command) ✅
- [x] Full language check/switch to English (7 files rewritten) ✅
- [ ] Final test Protected Topics (Vote/Council/Dev&Builder/Core Dev)

### Ali Copilot
- [x] Security policy: no PII, no wallet outputs, no contract addresses, only ifrunit.tech, reliability disclaimer, scam awareness ✅
- [ ] Ali Phase 2: WalletConnect → wallet-specific responses (after LP live)

---

## MID-TERM

### Bootstrap (LIVE since 07.03.2026, ends 05.06.2026)
- [x] Announcement texts fertig — `docs/BOOTSTRAP_ANNOUNCEMENT.md` ✅
- [ ] 📢 POST: Telegram @IFRtoken (Text #1)
- [ ] 📢 POST: X Thread @IFRtoken (Text #2, 4 Tweets)
- [ ] 📢 POST: Reddit r/ethfinance (Text #3)
- [ ] 📢 POST: Reddit r/CryptoMoonShots (Text #4)
- [ ] 📢 POST: Farcaster (Text #5)
- [ ] 📢 POST: Reddit r/defi (Text #3 angepasst)
- [ ] 🔍 Reddit Karma prüfen vor Post (r/CryptoMoonShots Mindest-Karma)
- [ ] Set up Juicebox listing/discovery (NO funding — discovery only)
- [x] X/Twitter announcement text prepared ✅ (in BOOTSTRAP_ANNOUNCEMENT.md)
- [ ] Final review bootstrap page
- [ ] Communicate Bootstrap V4 on bootstrap.html: "V4 governance voting planned for Phase 3"

### Frontend
- [ ] Create animated token GIF (still missing)
- [ ] `Buy IFR` → activate Uniswap button (ONLY after LP live)
- [ ] Integrate live token price (ONLY after LP live)
- [ ] WalletConnect Phase 2: `isLocked(wallet,1000e9)` check → Copilot gate (after LP)
- [ ] WalletConnect Phase 3: Uniswap link (ONLY after LP live)

### Documentation
- [ ] Plan B documentation with exact decision timestamp
- [ ] Update handover document for Core Developer
- [ ] Project Continuity section (Landing + README + Wiki)

### Railway
- [ ] Verify FeeRouterV1 tracking (after Proposal #6)
- [ ] Verify BuybackVault + BurnReserve accumulation tracking
- [ ] Pool Fee Receiver: switch from Deployer EOA to FeeRouterV1

### SEO / LLMO
- [ ] Full JSON-LD Schema.org check on all wiki pages
- [ ] Verify ChatGPT/Perplexity indexing
- [ ] Follow up on ethereum-lists PR #1010

### CI/CD
- [ ] Set up Slither CI
- [ ] Set up Mythril CI
- [ ] Coverage badge in README
- [ ] Recruit 2-3 repo maintainers

---

## PHASE 2+ FEATURES

### Landing Page — Dashboard Role Badges
- [ ] Dashboard Badges/Patches auf Landing Page einbauen (sichtbarer Bereich)
  - Dashboard User Badge (klickbar → User Dashboard)
  - Dashboard Builder Badge (klickbar → Builder Dashboard)
  - Dashboard Developer / Core Team Badge (klickbar → Dev Dashboard)
  - Visuell als klickbare Patches/Embleme gestaltet
  - Je nach verbundener Wallet-Rolle sichtbar/aktiv

### Governance Section — Live Wallet Verification Stats
- [ ] Live-Anzeige: Anzahl verifizierter Wallets (keine öffentlichen Adressen)
  - Aufschlüsselung nach Topic: General / Vote+Council / Dev&Builder / Core Team
  - Nur Statistik/Anzahl — kein Datenschutz-Problem
  - Backend-Endpoint: /api/verify/stats (Railway)

### Governance Section — Letzte Abstimmungen (on-chain live)
- [ ] The Council (Der Rat): letzte 5 Abstimmungen
  - Titel, Ergebnis, Datum, Etherscan-Link
- [ ] Das Forum (Community Vote): letzte 5 Votes
  - Titel, Ergebnis, Datum, Link zu Details
  - "Mehr anzeigen" Link → ältere Abstimmungen
  - Live on-chain via Governance Contract Events

### Landing Page — Mobile Performance Optimierung
- [ ] Lazy Loading via IntersectionObserver (Animationen, Canvas, Widgets)
- [ ] Rendering-Priorisierung: Text+CTA sofort, Animationen deferred
- [ ] Header-Animation auf Mobile vereinfachen/überspringen
- [ ] CSS will-change + transform statt top/left für Animationen
- [ ] requestAnimationFrame für alle JS-Animationen
- [ ] Passive Event Listeners für Scroll-Events
- [ ] contain: layout wo möglich
- [ ] Bilder: WebP + srcset korrekte Größen
- [ ] Kritisches CSS inline, Rest deferred
- [ ] font-display: swap für alle Fonts
- [ ] Device Detection: Mobile/Low-End → reduzierte Animations-Variante
- [ ] prefers-reduced-motion Media Query vollständig respektieren
- [ ] Ziel: ruckelfreies Scrollen auf Low-End Smartphones

---

## COMPLETED

### Phase 3 — Sprint 2 (Wallet Verification)
- [x] `wallet-core.js` — Central wallet session (EIP-5749 multi-wallet)
- [x] `ifr-state.js` — On-chain state reader (IFR/Lock/Bootstrap)
- [x] Bootstrap widget — contribute/claim/refund
- [x] Landing page header dropdown
- [x] `agent.html` free/premium gate
- [x] 26 wiki top-bar wallet buttons
- [x] `verificationStore.js` — 3-tier nonce + session store
- [x] `onChainReader.js` — IFRLock + Gnosis Safe getOwners() auto-sync
- [x] `/verify` + `/mystatus` bot commands
- [x] `verify.html` — 3-tier signing UI
- [x] Topic guards (Core Dev 58 / Council 21 / Vote 23 / Dev&Builder 11)
- [x] 23/23 verify tests green

### Phase 3 — Sprint 3 (On-Chain Reader)
- [x] `BuilderRegistry.sol` — 27/27 tests, ABI exported
- [x] Deploy script (Sepolia + Mainnet + Etherscan verify)
- [x] Gnosis Safe `getOwners()` auto-sync (5 min cache)
- [x] BuilderRegistry placeholder in onChainReader.js

### Phase 3 — Sprint 4 (Wiki)
- [x] `governance.html` — Bot commands table + topic access table
- [x] `integration.html` — BuilderRegistry process + 4 categories
- [x] `roadmap.html` — Phase 3 sprint status updated

### WalletConnect Phase 1
- [x] Connect button landing page header
- [x] Wallet dropdown (ETH/IFR balance, lock badge, bootstrap link)
- [x] X-button dropdown
- [x] Disconnect instant UI reset
- [x] Mobile MetaMask deeplink
- [x] visibilitychange auto-reconnect
- [x] 14 Playwright tests green

### Telegram Bot
- [x] `voteAnnouncement.js` — Governance proposal announcements + executable reminder + verify.html link (12 tests)
- [x] Verification gate + spam moderation
- [x] Daily burn report (09:00 CET)
- [x] Bootstrap start/end announcement (automatic from 07.03.2026)
- [x] 7-day countdown (before start + before end)

### Ali Copilot
- [x] Automatic bootstrap date check (NOT YET ACTIVE → ACTIVE → ENDED)
- [x] Wiki pages auto-fetch every 60 min
- [x] Railway auto-deploy active

### DAO Governance
- [x] Two-chamber visual on landing page
- [x] `governance.html` — DAO concept fully documented (DE→EN)
- [x] DAO contracts table (Phase 4 placeholder)

### Ali Copilot
- [x] Security policy — no PII, no wallet outputs, no contract addresses, only ifrunit.tech links, reliability disclaimer, scam awareness (9-point policy in system-prompts.ts)

### FAQ & Documentation
- [x] `faq.html` — 8 new DAO/Governance FAQs (G1-G8: two-chamber, voting, verification, tiers, spam protection, timeline, supply, BuilderRegistry)

### SEO / Audit
- [x] Audit report `AUDIT_REPORT_20260314.md` created
- [x] Test counts 494/444 → 556 across 32 files
- [x] Wiki page count 16/24 → 25 across 8 files
- [x] `rel="canonical"` on all 26 wiki pages
- [x] `twitter:card` + `twitter:site` + `twitter:image` on all pages
- [x] JSON-LD on `verify.html`
- [x] `verify.html` in sitemap
- [x] Developer TODO markers (`IFR_UPDATE`) set
- [x] robots.txt (GPTBot, ClaudeBot, PerplexityBot allowed)

---

## AFTER LP LIVE (after 05.06.2026)

- [ ] Apply for CoinGecko listing
- [ ] Apply for CoinMarketCap listing
- [ ] Activate AI Copilot gate (≥1,000 IFR locked)
- [ ] Telegram wallet whitelist via WalletConnect
- [ ] LiqRes withdrawal proposal: `setMaxWithdrawPerPeriod(200M)` from 01.09.2026

---

## PHASE 4 — DAO (after LP live + ecosystem)

### Smart Contracts
- [ ] `RatVoting.sol` — Team governance, Merkle tree, on-chain anchoring
- [ ] `ForumVoting.sol` — Community voting, ecrecover signatures
- [ ] `IFRSpamProtection.sol` — 10 IFR per proposal, deflationary

### Bot Extensions (Phase 4)
- [ ] `/propose` command (Forum)
- [ ] `/vote [id] [yes/no]` command
- [ ] `/proposals` command
- [ ] `/result [id]` command
- [ ] `/ratpropose` command (Council/Signer only)
- [ ] `/ratvote` command (Council/Signer only)
- [ ] Wallet mapper service
- [ ] IFR reader service
- [ ] Reaction tracker service
- [ ] Poll manager service

---

## PHASE 3+ VISION (long-term)

### Web Dashboard
- [ ] Role-based via WalletConnect (User/Builder/Partner/Core Dev)
- [ ] Integrated governance tool
- [ ] CDN/Edge on app.ifrunit.tech

### Client App
- [ ] APK (Android direct)
- [ ] F-Droid
- [ ] Google Play
- [ ] App Store (iOS)
- [ ] Integrated DAO governance (The Council + The Forum)

### Smart Contracts (Phase 3)
- [ ] BuybackController.sol — auto-refill PartnerVault, overflow → Treasury, SOS reserve
- [ ] LiquidityVault.sol — 3-phase LP release (deploy after Bootstrap decision 05.06)
- [ ] Vesting Migration Option B — new multisig vesting contract after cliff (March 2027)

### Creator & Partner
- [ ] Creator Gateway (open-source bridge, Docker, OAuth + WalletConnect)
- [ ] YouTube integration hybrid model B
- [ ] PartnerVault Option C (milestone unlock + linear vesting)
- [ ] Bootstrap V4 (contributor voting, ETH-weighted)

### Phase 5
- [ ] Bug bounty program
- [ ] Professional audit (third-party)
- [ ] Ecosystem fund

---

*This document is updated with every completed task.*
*Last updated: 2026-03-18*

