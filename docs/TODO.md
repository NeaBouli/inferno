# IFR Protocol — Developer TODO List
> Last updated: 2026-04-04 | Branch: main

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
- [x] ✅ Proposals #1/#2/#3 cancelled — stale/redundant (20.03.2026)
      feeExempt already set directly by Deployer (05.03.2026)
      Governance history now clean: 0 open proposals
      TX cancel(1): `0xc7128c8892ce7170530a0c0bdef204664904c1c768ddff13a479570260d432f6`
      TX cancel(2): `0x33ae7c2350d707a7e940195a8f5323195a08167e79f52d8b148d08f07adf82c3`
      TX cancel(3): `0xa4c33997ca97515f6e109a6a8f46ad9020515d1a7b987d358c30ae87588413cb`
- [x] ✅ Proposal #10: `setOwner(TreasurySafe)` — EXECUTED 20.03.2026
      Proposal #10 cancelled (structural bug: `setOwner` had `onlyOwner` instead of `onlySelf`)
      Direct `setOwner()` via Deployer (was owner at the time)
      TX: `0xcd9f99d2e5df5c28b81f885c7ebf7e2d42a873bd1c81bef9d94aa5c2d19c46c3`
      Block: 24698977
      Contract bug fixed: `setOwner` modifier changed `onlyOwner` → `onlySelf` for future deployments

### Known Bugs
- [x] Landing Page Stats FINAL FIX (19.03.2026): LP Reserve Safe 0→400.6M, Protocol Locked 350M→998.5M, all stats verified on-chain ✅
- [x] Builder Vault lock mechanism documented for all users (19.03.2026): index, tokenomics, wallet-guide, faq, security, fair-launch ✅
- [x] Multisig 2-of-4 references removed — all Safes already 3-of-5 since 15.03.2026 ✅
- [x] Ali Copilot facts updated: supply, component count, governance proposals, multisig (19.03.2026) ✅
- [x] SEO: llms.txt created + preconnect Railway (19.03.2026) ✅
- [x] Landing Page performance: defer scripts + fetch timeout 8s (19.03.2026) ✅
- [x] Wiki index: all 27 pages now have cards (was 16/27) (19.03.2026) ✅
- [x] FeeRouterV1 tracking verified: Railway + Landing Page + SVG all correct (19.03.2026) ✅
- [x] Token Visualisierung: SVG + Kacheln verified correct (19.03.2026) ✅
- [x] ~~Animated Token GIF~~ — gestrichen (not planned) ✅
- [x] ✅ .env security verified (04.04.2026)
      .gitignore: .env/.env.*/.env.local patterns ✅
      .env never committed to git ✅
      No real keys in git history ✅
      .env.example updated with all current variables ✅
- [ ] 🔴 DEPLOYER_PRIVATE_KEY aus .env entfernen — DEADLINE: 30.03.2026 (OVERDUE)
      Deployer hat keine Governance-Rechte mehr (seit 20.03.2026)
      Voraussetzung: Alle Tests grün (contract + bot + e2e)
      Aktion: DEPLOYER_PRIVATE_KEY Zeile aus .env löschen
      Verify: `grep DEPLOYER_PRIVATE_KEY .env` → leer
- [x] ✅ WalletConnect Phase 1 stable (04.04.2026)
      wallet-core.js v1.2 — MetaMask connect with all bug fixes:
      30s timeout, accountsChanged re-creates provider/signer,
      listener guard, clean disconnect, mobile deep-link 2s delay
      Note: WC v2 QR needs bundler — planned Phase 2 build setup
- [x] ChatGPT External Audit published (04.04.2026)
      security.html + faq.html (3 new entries) + AUDIT_CHATGPT_19032026.md on GitHub
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

### Builder Applications
- [x] NEXUS GR — GitHub Issue #13 (19.03.2026) ✅

### Core Developer (external)
- [x] ✅ Deploy BuilderRegistry.sol on Sepolia (20.03.2026)
      Sepolia: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- [x] ✅ Deploy BuilderRegistry on Mainnet (20.03.2026)
      Mainnet: `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3`
      Owner: Governance (0xc43d...D041) → TreasurySafe 3-of-5
      Etherscan verified
- [x] ✅ `BUILDER_REGISTRY_ADDR` in Railway gesetzt (20.03.2026)
      Services: ifr-ai-copilot + inferno (telegram-bot backend)
      Mainnet: `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3`
      API Endpoints aktiv: /api/builders/count + /api/builders/check/:address
      Fix: function selectors corrected (isBuilder 0xb6b6b475, getBuilderCount 0xe54a01f9)
- [ ] BuilderRegistry audit (post-deploy — contract is upgradeable via Governance)

### 🔴 POST-BOOTSTRAP CHECKLISTE (nach 05.06.2026)

- [ ] 🔴 finalise() aufrufen (permissionless)
      Prüfen: vault.finalized() = true

- [ ] 🔴 Proposal #11: feeExempt(CommitmentVault) — PENDING
      KRITISCH vor ersten User-Locks!
      Script: docs/PROPOSAL_11_EXECUTION.md
      Via TreasurySafe 3-of-5
- [ ] 🔴 Proposal #12: feeExempt(LendingVault) — PENDING
      KRITISCH vor ersten Loans/Deposits!
      Script: docs/PROPOSAL_12_EXECUTION.md
      Via TreasurySafe 3-of-5
- [ ] 🔴 Proposal #13: Uniswap Pool feeExempt
      SOFORT nach finalise()!
      Pool Adresse erst nach finalise() bekannt

- [ ] 🔴 P0 berechnen:
      P0 = totalETHRaised / 100,000,000
      In CommitmentVault setzen (Proposal #14)
      IMMUTABLE — korrekt berechnen!

- [ ] 🔴 Contributor 1: CommitmentVault Lock
      100M IFR → 10 Tranchen konfigurieren
      Contributor hat zugestimmt ✅

- [ ] 🔴 Contributor 1: LendingVault Allowance
      setLendingAllowance(50,000,000 IFR)

- [ ] 🟡 Mehr Contributors für Bootstrap
      Ziel: mehr ETH = höheres P0
      Kanäle: Reddit/Farcaster/Telegram

- [x] ✅ Bootstrap safety plan documented
      bootstrap.html + faq.html + Ali + TODO
      (03.04.2026)

### Phase 3 — After Bootstrap finalise() (~05.06.2026)
- [ ] 🔴 CRITICAL: Proposal #13 — Set Uniswap Pool feeExempt
      WARNING: Without this proposal IFR is effectively not tradeable (3.5% fee on every swap!)
      Timing: IMMEDIATELY after finalise() + pool creation
      Address: Uniswap V2 Pair (only known after finalise())
- [ ] 🔴 CRITICAL: Proposal #14 — Set P0 in CommitmentVault
      P0 = Total ETH raised / 100,000,000 (IMMUTABLE once set!)
      All CommitmentVault tranche targets are based on P0 — wrong calculation = catastrophic
      Timing: After finalise() + Uniswap Pool live
- [ ] 🔵 Deploy CommitmentVault (Core Dev)
      Voluntary lock with 4 condition types (time, price, time+price, time OR price)
      Auto-unlock after 30 days when condition met
      Set feeExempt after deploy
      Contributor lock: 10 tranches of 10M IFR (100M total)
- [ ] 🔵 Deploy LendingVault (Core Dev)
      IFR lending against ETH collateral (200% initial, margin call 150%, liquidation 120%)
      Interest rate: dynamic (0% util=2%, 100%=25%)
      Uniswap TWAP price oracle (24h average)
      Railway cron job (every 4h) for liquidation checks
- [ ] 🔵 Deploy BuybackController (Phase 3+)
      Automated fee distribution (BuybackVault + BurnReserve)

### Phase 3 — Wiki Pages (new)
- [x] ✅ Wiki: CommitmentVault page — `docs/wiki/commitment-vault.html` (20.03.2026)
      4 condition types, 10 tranches, auto-unlock, stakeholders, FAQ
- [x] ✅ Wiki: LendingVault page — `docs/wiki/lending-vault.html` (20.03.2026)
      Lending cycle (6 steps), interest rates, collateral, default logic
- [x] ✅ Wiki: Phased LP Strategy page — `docs/wiki/lp-strategy.html` (20.03.2026)
      AMM mathematics, 4 phases, efficiency proof
- [x] ✅ Wiki: Ecosystem page — `docs/wiki/ecosystem.html` (20.03.2026)
      Self-reinforcing loop, 3 principles, stakeholders, timeline
- [x] ✅ Wiki Navigation: Phase 3 pages in sidebar (31 pages) + index (20.03.2026)
      All pages marked "Phase 3 — Coming Soon"

### Phase 3 — Contracts (Core Dev — Solidity)
- [x] ✅ CommitmentVault.sol written + tests (04.04.2026)
      4 condition types (TIME/PRICE/OR/AND), auto-unlock 30d, P0 immutable
      45 tests passing, ABI exported
      Handover: docs/CORE_DEV_PHASE3.md
- [x] ✅ CommitmentVault deployed Mainnet (04.04.2026)
      Sepolia: 0xc43d48E7FDA576C5022d0670B652A622E8caD041
      Mainnet: 0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3
      Etherscan verified, UI activated
- [x] ✅ LendingVault.sol written + tests (04.04.2026)
      Utilization-based interest (2–25%/month), 200/150/120% collateral
      50/50 interest split, liquidator 5% bonus, top-up collateral
      55 tests passing, ABI exported
      Handover: docs/CORE_DEV_PHASE3.md
- [x] ✅ LendingVault deployed Mainnet (04.04.2026)
      Sepolia: 0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb
      Mainnet: 0x974305Ab0EC905172e697271C3d7d385194EB9DF
      Etherscan verified, UI activated
- [ ] 🔵 Write BuybackController.sol + tests
      Automated fee distribution (BuybackVault + BurnReserve)
- [ ] 🔵 Core Dev: Deploy Sepolia → Audit → Mainnet
      Order: CommitmentVault → LendingVault → BuybackController
      Docs: Create CORE_DEV_PHASE3.md

### Phase 3 — WalletConnect UI
- [x] ✅ CommitmentVault UI built (04.04.2026)
      WalletConnect + IFR balance + tranche configurator (4 conditions)
      Preview, lock button, my-tranches dashboard
      "Coming Soon" until contract deployed
      ACTIVATE: set CV_ADDR after Core Dev deploy
- [x] ✅ LendingVault UI built (04.04.2026)
      3 tabs: Lender / Borrower / Market Overview
      Loan preview calculator (interest + collateral)
      Interest rate curve table
      "Coming Soon" until contract deployed
      ACTIVATE: set LV_ADDR after Core Dev deploy
- [ ] 🔵 P2P Lending Matching Interface (docs/wiki/lending-market.html)
      Public loan marketplace: lenders list offers, borrowers browse all,
      Filter: amount/interest rate/duration, "Request Loan" → on-chain TX
- [ ] 🔵 Collateral Health Monitor
      Borrower sees collateral ratio, warning at <150% (red),
      "Top Up" button for margin calls

### Phase 3 — Railway Extensions
- [ ] 🔵 Lending Endpoints
      GET /api/lending/offers — all lender offers
      POST /api/lending/request — request loan
      GET /api/lending/loans/:address — active loans
      GET /api/lending/health/:loanId — collateral ratio
- [ ] 🔵 CommitmentVault Endpoints
      GET /api/commitment/:address — tranche status
      GET /api/commitment/leaderboard — Diamond Hands
- [ ] 🔵 Cron Job: Liquidation Monitor (every 4h)
      Checks all open loans, warning at <150%, Telegram alert at <120%

### Phase 3 — Uniswap Integration
- [ ] 🔵 "Buy IFR" button on landing page (after LP is live)
      Uniswap link with pre-filled token address
- [ ] 🔵 Live IFR price on landing page
      Uniswap TWAP → Railway GET /api/ifr/price → Landing Page

### Phase 4 — Mobile App (IFR Wallet)
- [ ] 🔵 App Concept + Design
      Platforms: iOS + Android + APK + F-Droid
      Features MVP: Wallet connect, IFR Balance, Lock/Unlock,
      CommitmentVault management, LendingVault (Lender + Borrower),
      Governance Proposals + Voting, Push Notifications
      (Tranche unlockable, Loan due, Margin Call, new Proposals)
- [ ] 🔵 Tech Stack Decision
      Option A: React Native | B: Flutter | C: PWA
      Recommendation: PWA first (app.ifrunit.tech), then native
- [ ] 🔵 app.ifrunit.tech — Progressive Web App
      Subdomain, CDN/Edge Hosting, WalletConnect v2
- [ ] 🔵 App Store Submission
      Apple App Store, Google Play, APK (direct), F-Droid (open source)

### Phase 4 — DAO + Governance App
- [ ] 🔵 In-App Governance
      Read + vote on proposals, wallet-weighted voting (IFR-based),
      Proposal creation (TreasurySafe Members only)
- [ ] 🔵 Diamond Hands Leaderboard
      Top wallets by locked IFR, CommitmentVault tranches public,
      Community status badges

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
- ~~Create animated token GIF~~ — not planned
- [ ] `Buy IFR` → activate Uniswap button (ONLY after LP live)
- [x] ✅ IFR Price Widget + Railway /api/ifr/price endpoint (04.04.2026)
      Landing page: price stat card (TBD until LP)
      Phase 2: Uniswap TWAP after LP live
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
- [x] ✅ SEO: 4 new Phase 3 wiki pages — OG tags + JSON-LD + canonical (20.03.2026)
- [x] ✅ llms.txt: Phase 3 wiki page URLs added (20.03.2026)
- [x] ✅ sitemap.xml: 4 new pages added (20.03.2026)
- [x] ✅ Ali Copilot: Phase 3 contracts + BuilderRegistry + Governance updated (20.03.2026)
- [x] ✅ Landing Page: IntersectionObserver for live data + lazy images + scroll throttle (20.03.2026)
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

### WalletConnect Phase 1 ✅ LIVE
- [x] Connect button landing page header
- [x] Wallet dropdown (ETH/IFR balance, lock badge, bootstrap link)
- [x] X-button dropdown
- [x] Disconnect instant UI reset
- [x] Mobile MetaMask deeplink
- [x] visibilitychange auto-reconnect
- [x] 14 Playwright tests green
- [x] ✅ wallet-core.js v1.2 stable (04.04.2026)
      MetaMask connect with 5 bug fixes (timeout, accountsChanged,
      listener guard, disconnect cleanup, mobile deep-link)
- [ ] 🔵 WalletConnect v2 QR (needs webpack/vite build setup)

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
→ Moved to Phase 4 — Mobile App section above

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
*Last updated: 2026-04-04*

