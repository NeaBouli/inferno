# IFR Protocol — Developer TODO List
> Last updated: 2026-06-10 | Branch: main

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
ls docs/wiki/*.html | wc -l          # → update "32 wiki pages" everywhere
ls contracts/*.sol | wc -l           # → update "17 on-chain components" everywhere
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
- sitemap.xml current (all 32 wiki pages)?
- All IFR_UPDATE markers visited and current?
- h1/h2/h3 hierarchy correct (no h1→h3 jumps)?
On errors: fix immediately, commit with `seo:` prefix.

---

## BUG FIXES (15.03.2026)

- [x] Bootstrap Widget: number formatting (19,475,000 → 19.48M) ✅
- [x] Bootstrap ConsensusModule: wallet-connected voting buttons ✅
- [x] MetaMask Mobile: centralized deep-link + pending connect ✅
- [x] Protocol Plan wiki page created (26 pages) ✅

## ✅ ERLEDIGT — Proposal #13 executed (16.04.2026)

- [x] ✅ Proposal #13 executed (16.04.2026 10:31 Athen)
      setFeeExempt(BuybackController, true) ✅
      TX: 0x74a7c9c97800cfe5a68315db68e648ae1631124a748fa5b101e58bea2681404f
      Block: 24890909
      BuybackController feeExempt = TRUE (on-chain verified)

## ✅ Proposal B SUBMITTED als Proposal #14 (16.04.2026)

- [x] ✅ Proposal B submitted als #14 (16.04.2026)
      setFeeCollector(BuybackController) auf FeeRouterV1
      Target: 0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a (FeeRouterV1)
      Calldata: 0xa42dce80...1e0547d5...f7c (on-chain EXAKT bestätigt)
      ETA: 18.04.2026 11:09:35 Athen (48h Timelock)

## ✅ ERLEDIGT — Proposal #14 executed (18.04.2026)

- [x] ✅ Proposal #14 executed (18.04.2026)
      setFeeCollector(BuybackController) auf FeeRouterV1 ✅
      FeeRouterV1.feeCollector = 0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c (BuybackController)
      Protocol fees fließen jetzt in den 50/50 Buyback+Burn / LP-Deepening Flywheel
- [x] ✅ Verified on-chain: feeCollector == BuybackController

## ✅ ERLEDIGT — 13 Codex-Commits gepusht (18.04.2026)

- [x] ✅ 13 Codex-Commits gepusht (18.04.2026)
      - finalise-bootstrap.js Script ✅
      - propose-pool-feeexempt.js Script ✅
      - check-bootstrap-status.js Script ✅
      - IFR Token Adresse fix (Sepolia→Mainnet) ✅
      - Governance setOwner() Tests gefixt ✅
      - npm Vulns 69→60 ✅
- [x] ✅ inferno-redesign.html in .gitignore (18.04.2026)

---

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
- [x] ✅ DEPLOYER_PRIVATE_KEY in .env — Bewusste Entscheidung: behalten bis Projektabschluss (07.04.2026)
      Deployer hat keine Governance-Rechte mehr (seit 20.03.2026)
      Key wird für Sepolia-Deploys + Testnet-Scripts benötigt
      Nie committed (.gitignore ✅), kein Sicherheitsrisiko
- [x] ✅ WalletConnect Phase 1 stable (04.04.2026)
      wallet-core.js v1.2 — MetaMask connect with all bug fixes:
      30s timeout, accountsChanged re-creates provider/signer,
      listener guard, clean disconnect, mobile deep-link 2s delay
      Note: WC v2 QR needs bundler — planned Phase 2 build setup
- [x] ChatGPT External Audit published (04.04.2026)
      security.html + faq.html (3 new entries) + AUDIT_CHATGPT_19032026.md on GitHub
- [x] ✅ Grok (xAI) Audit published (07.04.2026)
      audit/GROK_AUDIT_07042026.md + .pdf
      docs/wiki/open-audit.html (new wiki page)
      security.html: CTA banner linked
      Result: 10/10 Coherence, 0 Critical, all claims verified
- [x] ✅ Blockaid Unflag bestätigt (10.06.2026)
      IFR Contract unflagged — Propagation ~24h ab 10.06.2026 02:25 UTC
      Nach 24h: MetaMask+WalletConnect testen
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
- [x] ✅ ORIGO — GitHub Issue #15 (07.04.2026)
      Vendetta Labs — Conway Game of Life Universe
      45% revenue → IFR buyback flywheel

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

- [x] ✅ finalise() ausgeführt (05.06.2026 23:51 UTC)
      TX: 0x949848bdd09f4c867a2593afffb0137c7db2c1457d8a8f5ff4428f8ecce69c5f
      Block: 25254575 | Gas: 2,778,422
      LP Token: 0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0
      GitHub Issue #32: CLOSED ✅

- [x] ✅ Proposals #11+#12: feeExempt(CV+LV) — EXECUTED 06.04.2026
      Submitted: 04.04.2026 via TreasurySafe 3-of-5
      Executed: 06.04.2026 via TreasurySafe 3-of-5
      Verified on-chain: feeExempt(CV) = true, feeExempt(LV) = true
- [x] ✅ Railway: COMMITMENT_VAULT_ADDR gesetzt (04.04.2026)
      0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3
- [x] ✅ Railway: LENDING_VAULT_ADDR gesetzt (04.04.2026)
      0x974305Ab0EC905172e697271C3d7d385194EB9DF
- [x] ✅ Proposal #15: setFeeExempt(LP Token, true)
      GitHub Issue: https://github.com/NeaBouli/inferno/issues/33
      LP Token: 0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0
      Status: EXECUTED 08.06.2026 — LP Token feeExempt = TRUE
      TX: 0xd5a3bc9527b6cc5288b892a9ba99a3af37b940f273856ab6ba938403cd2b4204

- [x] ✅ P0 berechnen + setzen — Proposal #16 executed 09.06.2026
      GitHub Issue: https://github.com/NeaBouli/inferno/issues/34
      P0 = 0.3 Gwei (0.0000000003 ETH per IFR) — on-chain ✅ IMMUTABLE

- [x] ✅ Alle 3 Contributors geclaimed (10.06.2026)
      0x4f63: 33,333,333 IFR ✅ (claimed: true, on-chain verified)
      0x80ff: 33,333,333 IFR ✅ (claimed: true, on-chain verified)
      0xf556: 33,333,333 IFR ✅ (claimed: true, on-chain verified)
      Total: 100M IFR verteilt (ifrAllocation = 100M, totalETH = 0.03 ETH)

- [x] ✅ Claim Button Fix in bootstrap.html (10.06.2026)
      claimed(address) zu ABI + ifr-state.js hinzugefügt
      4-Pfad-Logik: claim / claimed-msg / refund / awaiting
      Commit: 174fede3

- [x] ✅ BW.IFR_ALLOCATION Fix in bootstrap.html (10.06.2026)
      BW.IFR_ALLOCATION = 100000000 (on-chain: ifrAllocation() = 100M)
      Betrifft: IFR-Schätzung im Contribute-Widget + Allocation-Anzeige

- [ ] 🔴 Contributors informieren: ZUERST kaufen!
      Jeder Contributor: 0.03 ETH → Uniswap → IFR kaufen (BEVOR Lock!)
      3 × 0.03 ETH = 0.09 ETH Volumen → Pool ~0.128 ETH → Preis ~+300%
      https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B

- [ ] 🔴 11.06: Contributors kaufen 0.03 ETH auf Uniswap
      → Runbook: docs/CONTRIBUTOR_RUNBOOK.md

- [ ] 🔴 11.06: Blockaid Retest (nach 24h Propagation)
      → Checkliste: BRIDGE.md

- [ ] 🔴 CommitmentVault Lock ausführen (NACH Käufen)
      Script: scripts/contributors-lock.js (dynamisch: balance/10, TIME_ONLY 30d)
      DRY_RUN: CONTRIBUTOR_ADDR=0x... DRY_RUN=true node scripts/contributors-lock.js ✅
      LIVE:    CONTRIBUTOR_ADDR=0x... MAINNET=true PRIVATE_KEY=0x... node scripts/contributors-lock.js
      Dry Run Output: 10 × 3,333,333 IFR, TIME_ONLY(0), unlockTime+30d, p0Multiplier=0 ✅

- [ ] 🔴 LendingVault createOffer() ausführen
      Script: scripts/contributors-lending-offer.js (50% balance = ~16.6M IFR)
      DRY_RUN: CONTRIBUTOR_ADDR=0x... DRY_RUN=true node scripts/contributors-lending-offer.js ✅
      LIVE:    CONTRIBUTOR_ADDR=0x... MAINNET=true PRIVATE_KEY=0x... node scripts/contributors-lending-offer.js

- [ ] 🟡 StealthX × IFR Integration
      Spec: docs/STEALTHX_IFR_INTEGRATION.md
      IFRLock gate: lockedBalance(wallet) >= 1000 IFR → Premium unlock
      Nächster Schritt: StealthX Team briefen

- [ ] 🟡 Mehr Contributors für Bootstrap
      Ziel: mehr ETH = höheres P0
      Kanäle: Reddit/Farcaster/Telegram

- [ ] 🟡 inferno-redesign.html Review
      GitHub Issue: https://github.com/NeaBouli/inferno/issues/31
      NICHT deployen ohne Review + Abnahme!
      Lokal unter: /Users/gio/Desktop/repos/inferno/inferno-redesign.html

- [x] ✅ Bootstrap safety plan documented
      bootstrap.html + faq.html + Ali + TODO
      (03.04.2026)

### Phase 3 — After Bootstrap finalise() (~05.06.2026)
- [x] ✅ Proposal #15 — setFeeExempt(LP Token, true)
      GitHub Issue: https://github.com/NeaBouli/inferno/issues/33 — EXECUTED 08.06.2026
      LP Token: 0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0
      LP Token feeExempt = TRUE ✅
- [x] ✅ Proposal #16 — Set P0 in CommitmentVault — EXECUTED 09.06.2026
      GitHub Issue: https://github.com/NeaBouli/inferno/issues/34
      P0 = 0.3 Gwei on-chain ✅ IMMUTABLE
- [x] ✅ Deploy CommitmentVault (Core Dev)
      Voluntary lock with 4 condition types (time, price, time+price, time OR price)
      Auto-unlock after 30 days when condition met
      Set feeExempt after deploy
      Contributor lock: 10 tranches of 10M IFR (100M total)
- [x] ✅ Deploy LendingVault (Core Dev)
      IFR lending against ETH collateral (200% initial, margin call 150%, liquidation 120%)
      Interest rate: dynamic (0% util=2%, 100%=25%)
      Uniswap TWAP price oracle (24h average)
      Railway cron job (every 4h) for liquidation checks
- [x] ✅ Deploy BuybackController (14.04.2026)
      Mainnet: `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` — Verified
      Sepolia: `0xaA1496133B6c274190A2113410B501C5802b6fCF` — Verified
      TX: `0x761ee37c87d528317c5f7da13a2581e037f2fe39c71bfc58ce83a32930391677`
      Security: BC-1 Slippage Protection + BC-2 Exact Approve
- [x] ✅ Proposal A (= Proposal #13): setFeeExempt(BuybackController, true) — EXECUTED 16.04.2026 10:31 Athen
      TX: 0x74a7c9c97800cfe5a68315db68e648ae1631124a748fa5b101e58bea2681404f (Block 24890909)
      BuybackController feeExempt = TRUE ✅
- [x] ✅ Proposal B (= Proposal #14): setFeeCollector(BuybackController) auf FeeRouterV1 — EXECUTED 18.04.2026 ✅

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
- [x] ✅ BuybackController.sol written + tests (07.04.2026)
      50/50 split: buyback+burn / LP deepening
      Permissionless execute() after 24h cooldown
      50 tests passing, ABI: abi/BuybackController.json
      Handover: docs/CORE_DEV_PHASE3.md
- [x] ✅ Core Dev: All Phase 3 contracts deployed (14.04.2026)
      CommitmentVault → LendingVault → BuybackController — all Mainnet + Sepolia
      Docs: CORE_DEV_PHASE3.md, NEXT_STEPS.md

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
- [x] ✅ P2P Lending Market page built (04.04.2026)
      lending-market.html: live offers table + stats from Railway
      /api/lending/stats + /api/lending/offers endpoints
      How It Works, Interest Rate Curve, Collateral & Safety
- [ ] 🔵 Collateral Health Monitor
      Borrower sees collateral ratio, warning at <150% (red),
      "Top Up" button for margin calls

### Phase 3 — Railway Extensions
- [x] ✅ Lending Endpoints (07.04.2026)
      GET /api/lending/stats — market overview
      GET /api/lending/offers — all lender offers
      GET /api/lending/loans/:address — active loans per borrower
      GET /api/lending/health/:loanId — collateral ratio + health
      GET /api/lending/lender/:address — lender dashboard
- [x] ✅ CommitmentVault Endpoints (07.04.2026)
      GET /api/commitment/tranches/:address — all tranches
      GET /api/commitment/status/:address — quick summary + tier
      GET /api/commitment/p0 — P0 status
      GET /api/commitment/leaderboard — Diamond Hands (placeholder, Phase 2: event indexing)
- [x] ✅ Cron Job: Liquidation Monitor every 4h (07.04.2026)
      Checks all active loans, logs warning at <150%, critical at <120%
      Phase 2: Telegram alert integration

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
- [x] ✅ Transfer Governance → GnosisSafe ownership

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
- [x] ✅ Bootstrap status "NOW ACTIVE" (16.04.2026)
      ifr-knowledge.ts, system-prompts.ts, server/index.ts — dead "NOT YET ACTIVE" branch entfernt
      Status: Bootstrap started 07.03.2026 and ended 05.06.2026
- [x] ✅ Ali Copilot Bootstrap ENDED update (06.06.2026) — Issue #35
      ifr-knowledge.ts: phase/currentState/startDate updated, lpToken/finaliseTx/uniswapLink added, ETHRaised→0.030, Proposal #15 added
      system-prompts.ts: bootstrapBlock ENDED details, old live wording removed
- [ ] Ali Phase 2: WalletConnect → wallet-specific responses (after LP live)

---

## MID-TERM

### Bootstrap (ENDED 05.06.2026 — IFR live on Uniswap V2)
- [x] Announcement texts fertig — `docs/BOOTSTRAP_ANNOUNCEMENT.md` ✅
- [x] ✅ POST: Telegram @IFRtoken Channel + Community (08.06.2026) — 3 Posts gesendet (msg_ids: 42, 43, 154)
- [ ] 📢 POST: X Thread @IFRtoken (Text #2, 4 Tweets)
- [ ] 📢 POST: Reddit r/ethfinance (Text #3)
- [ ] 📢 POST: Reddit r/CryptoMoonShots (Text #4)
- [ ] 📢 POST: Farcaster (Text #5)
- [ ] 📢 POST: Reddit r/defi (Text #3 angepasst)
- [ ] 🔍 Reddit Karma prüfen vor Post (r/CryptoMoonShots Mindest-Karma)
- [ ] Set up Juicebox listing/discovery (NO funding — discovery only)
- [x] X/Twitter announcement text prepared ✅ (in BOOTSTRAP_ANNOUNCEMENT.md)
- [x] ✅ Etherscan Token Profile live (17.03.2026)
      Logo + Links bestätigt via Support-Mail
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

### Railway → Hetzner Migration
- [x] ✅ Telegram-Bot: Railway → Hetzner (09.06.2026) — läuft auf 135.181.254.229
- [x] ✅ Ali Copilot (ai-copilot): Railway → Hetzner (09.06.2026) — `copilot-api.ifrunit.tech`
      DNS: A-Record `copilot-api.ifrunit.tech` → 135.181.254.229 ✅
- [x] ✅ Railway `ifr-ai-copilot` Service gestoppt (10.06.2026) — Hetzner ist aktiv
- [x] ✅ points-backend Migration → Hetzner
      SQLite, Dockerfile-Fix, Prisma engine path, Traefik + SSL ✅
      URL: `points-api.ifrunit.tech`
- [x] ✅ DNS: A-Record `verify-api.ifrunit.tech` → `135.181.254.229` gesetzt (Papaki)
      Telegram-Bot Verify-API auf Hetzner, Traefik-Route + SSL ✅
- [x] ✅ DNS: A-Record `points-api.ifrunit.tech` → `135.181.254.229`

### Railway (Alt — vor Migration)
- [x] ✅ FeeRouterV1 tracking verified (nach Proposal #6)
- [x] ✅ BuybackVault + BurnReserve: tracking aktiv
- [x] ✅ Pool Fee Receiver: FeeRouterV1 gesetzt

### SEO / LLMO
- [x] ✅ SEO: 4 new Phase 3 wiki pages — OG tags + JSON-LD + canonical (20.03.2026)
- [x] ✅ llms.txt: Phase 3 wiki page URLs added (20.03.2026)
- [x] ✅ sitemap.xml: 4 new pages added (20.03.2026)
- [x] ✅ Ali Copilot: Phase 3 contracts + BuilderRegistry + Governance updated (20.03.2026)
- [x] ✅ Landing Page: IntersectionObserver for live data + lazy images + scroll throttle (20.03.2026)
- [ ] Full JSON-LD Schema.org check on all wiki pages
- [ ] Verify ChatGPT/Perplexity indexing
- [x] ❌ ethereum-lists PR #1010 CLOSED (auto-close 03.06.2026 — inactivity)
- [ ] 🟡 ethereum-lists neuer PR #1036 — submitted 10.06.2026
      URL: https://github.com/ethereum-lists/tokens/pull/1036
      JSON: email + chat + telegram + twitter ergänzt
      Alternativen: Trust Wallet Assets, Uniswap Token List

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
- [x] ✅ wallet-core.js v4.2 — Mobile/Tablet Detection (18.04.2026)
      _isMobileOrTablet(): Smartphones + Tablets (inkl. iPadOS 13+)
      _showDesktopOnlyModal(): Desktop-only Modal im Inferno Design
      connect() + autoReconnect() blockieren auf Mobile/Tablet
      Greift automatisch auf allen 34 HTML-Seiten — kein HTML-Edit nötig
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
- [x] ✅ Hetzner auto-deploy active (09.06.2026) — `copilot-api.ifrunit.tech`, 24 wiki docs, healthy

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
- [x] `rel="canonical"` on all 32 wiki pages
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
- [x] ✅ BuybackController.sol — 50/50 buyback+burn / LP deepening (07.04.2026)
- [ ] LiquidityVault.sol — 3-phase LP release (deploy after Bootstrap decision 05.06)
- [ ] Vesting Migration Option B — new multisig vesting contract after cliff (March 2027)

### Creator & Partner
- [ ] Creator Gateway (open-source bridge, Docker, OAuth + WalletConnect)
- [ ] YouTube integration hybrid model B
- [ ] PartnerVault Option C (milestone unlock + linear vesting)
- [ ] Bootstrap V4 (contributor voting, ETH-weighted)

### Phase 5 — IFR Integration Builder
> "IFR = Stripe for Web3 Access" — Builder integrate IFR in < 1 hour

- [x] ✅ Contract Library — Phase 5a (07.04.2026)
      Path: contracts/library/
      5 Contracts, 45 tests passing:
      - BaseAccessModule.sol (minimal balance check)
      - HardLockModule.sol (time-bound lock 7-365 days)
      - TierModule.sol (Tier 1/2/3: 500/2k/10k IFR)
      - CooldownModule.sol (anti-gaming 24h default)
      - IFRBuilderVault.sol (complete recommended solution)
      ABI: abi/library/IFRBuilderVault.json

- [x] ✅ Tier System (on-chain) — included in Contract Library
      Tier 1: >= 500 IFR → Basic Access
      Tier 2: >= 2,000 IFR → Premium
      Tier 3: >= 10,000 IFR → Pro / Full Access
      Uses locked balance (not wallet balance) for tier calculation
      Governance-configurable thresholds

- [x] ✅ Generator Engine + Security Scorer — Phase 5b (07.04.2026)
      apps/builder/engine/:
      - ConfigValidator.ts — validates partner JSON config
      - SecurityScorer.ts — 0-100 score, 🟢 SAFE / 🟡 MEDIUM / 🔴 RISKY
      - CodeGenerator.ts — generates contract + SDK snippet + deploy guide
      POST /api/builder/generate endpoint active
      30 tests passing (test/builder/GeneratorEngine.test.js)

- [x] ✅ IFR SDK — Phase 5c (07.04.2026)
      apps/sdk/ — npm installable (ifr-sdk v0.1.0)
      IFRClient: checkAccess(), getTier(), getBalance(), getLockedBalance(), isBuilder()
      Static: IFRClient.apiCheck() (no ethers needed)
      GET /api/ifr/check?wallet=0x...&required=1000 — Railway endpoint
      36 tests passing (test/sdk/sdk.test.js)

- [x] ✅ Generator UI — Phase 5d (07.04.2026)
      docs/builder.html — live at ifrunit.tech/builder.html
      Config: amount slider, lock type/duration, tier, cooldown, verification
      Live security score (0-100, SAFE/MEDIUM/RISKY)
      Code output: contract + SDK snippet + deploy guide
      Copy button, tab switching, step indicators
      Landing page + business-onboarding.html linked
      Sitemap + llms.txt updated

- [x] ✅ Business Onboarding Flow — included in Generator UI
      1. Configure → 2. Score → 3. Get Code → 4. Deploy
      4. 3 lines of code in app
      5. Test + Go live
      Docs: docs/wiki/business-onboarding.html

- [ ] 🔵 Revenue Share Discussion (Phase 5+ Governance)
      Governance Proposal after Phase 4:
      Option A: % of pool fees → holder rewards
      Option B: Tier-based rewards (more IFR = more)
      Option C: Builder pays % → holder pool
      Goal: not just burn — but cashflow
      Formula: Value = Utility + Cashflow

- [ ] 🔵 Flywheel Documentation (Wiki)
      New page: ecosystem-flywheel.html
      More builders use SDK → more IFR locked → supply drops
      → price rises → more builders come → FLYWHEEL

- [ ] 🔵 Bug bounty program
- [ ] 🔵 Professional audit (third-party: Code4rena / Sherlock / Cyfrin)
- [ ] 🔵 Ecosystem fund

### External Analysis — Findings (April 2026)

External AI analysis confirms:
- ✅ Live Balance Check (SecureCall) — strong security model
- ✅ Fair Launch — no VC, trustworthy distribution
- ✅ Clear use case — rare in DeFi space
- ✅ CommitmentVault solves "soft lock" vulnerability

Open items for Phase 5:
- 📌 SDK for builders → Phase 5
- 📌 Tier system → Phase 5
- 📌 Generator engine → Phase 5
- 📌 Revenue share → Phase 5+ Governance

Strategic goal: "IFR = Stripe for Web3 Access — Web3 SaaS Standard"

### Contract Count Standardization
- [x] ✅ Contract count standardized site-wide (07.04.2026)
      Canonical: 14 deployed contracts + 3 Gnosis Safes = 17 on-chain components
      Fixed: wiki (10 pages), Ali copilot, README, docs (PROJECT-SUMMARY, STATUS-REPORT, MAINNET_CHECKLIST)
      13 contracts: InfernoToken, Governance, IFRLock, BootstrapVaultV3, Vesting,
      LiquidityReserve, PartnerVault, FeeRouterV1, BuybackVault, BurnReserve,
      BuilderRegistry, CommitmentVault, LendingVault
      3 Safes: TreasurySafe, CommunitySafe, LP Reserve Safe

---

*This document is updated with every completed task.*
### Lending Market UI (Phase 3+ — after LP Launch)
> Prerequisite: Bootstrap finalise() + LP live

- [ ] 🔵 Lender Interface
      Create offer (deposit IFR), manage (pause/close), earnings dashboard
      WalletConnect required
- [ ] 🔵 Borrower Interface
      Browse offers, take loan (ETH collateral), manage loans, repay
      WalletConnect required
- [ ] 🔵 Collateral Health Monitor UI
      Live ratio per loan: HEALTHY/WARNING/CRITICAL
      Margin Call warning (<150%), Liquidation button (<120%)
      Telegram alert integration
- [ ] 🔵 Liquidation Interface
      All liquidatable loans, 5% liquidator bonus, permissionless
- [ ] 🔵 Market Overview Dashboard
      Total Lent/Available, Utilization, Interest Rate, Active Loans/Offers
      Data: /api/lending/stats + /api/lending/offers

Technical: WalletConnect v2 + ethers.js v5, ABI: abi/LendingVault.json
Railway endpoints already live: stats, offers, loans/:addr, health/:id, lender/:addr

### Interactive Onboarding Wizard
- [x] ✅ Onboarding Wizard (07.04.2026)
      docs/wizard/ — 6 sub-pages (buy, lock, build, lend, borrow, contribute)
      Embedded in landing page before "How It Works"
      6 user paths: Investor, Locker, Builder, Lender, Borrower, Community/Press
      Step-by-step with back/restart, mobile optimized
      All sub-pages noindex, hero CTA "Find your path"

---

*Last updated: 2026-06-10*
