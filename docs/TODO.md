# IFR Protocol — Developer TODO List
> Last updated: 2026-03-15 | Branch: main

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
ls docs/wiki/*.html | wc -l          # → update "25 wiki pages" everywhere
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

---

## CRITICAL

### Bot & Infrastructure
- [x] `voteAnnouncement.js` — Bot announces Governance Proposals + verify.html link + 24h reminder ✅
- [ ] `SIGNER_WALLETS` in Railway env: `0x6b36687...` + `0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4`
- [ ] `VERIFY_PORT=3001` in Railway env

### Core Developer (external)
- [ ] Deploy BuilderRegistry.sol on Sepolia
- [ ] BuilderRegistry audit
- [ ] Deploy BuilderRegistry on Mainnet
- [ ] `BUILDER_REGISTRY_ADDR` in Railway env (after deploy)

---

## THIS WEEK

### Multisig
- [ ] Upgrade Multisig 1-of-2 → 2-of-4 (Gnosis Safe UI)
- [ ] 2 missing verifiers must join Safe and sign
- [ ] Transfer Governance → GnosisSafe ownership

### Telegram Bot
- [ ] `/announce` command: auto-append community link (`https://t.me/IFR_token/1`)
- [ ] Channel → Community Announcements auto-sync
- [ ] Keep latest announcement always pinned
- [ ] Test Daily Welcome (TELEGRAM_GENERAL_TOPIC_ID=5)
- [ ] Test Daily Burn Report (TELEGRAM_BURNS_TOPIC_ID=7)
- [ ] Full language check/switch to English
- [ ] Final test Protected Topics (Vote/Council/Dev&Builder/Core Dev)

### Ali Copilot
- [x] Security policy: no PII, no wallet outputs, no contract addresses, only ifrunit.tech, reliability disclaimer, scam awareness ✅
- [ ] Ali Phase 2: WalletConnect → wallet-specific responses (after LP live)

---

## MID-TERM

### Bootstrap (before 17.04.2026)
- [ ] Finalize announcement text (Reddit/X/Telegram/Farcaster)
- [ ] Reddit posts: r/defi + r/ethfinance + r/CryptoMoonShots
- [ ] Prepare Farcaster post
- [ ] Set up Juicebox listing/discovery (NO funding — discovery only)
- [ ] Prepare X/Twitter announcement
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

## COMPLETED

### Phase 3 — Sprint 2 (Wallet Verification)
- [x] `wallet-core.js` — Central wallet session (EIP-5749 multi-wallet)
- [x] `ifr-state.js` — On-chain state reader (IFR/Lock/Bootstrap)
- [x] Bootstrap widget — contribute/claim/refund
- [x] Landing page header dropdown
- [x] `agent.html` free/premium gate
- [x] 25 wiki top-bar wallet buttons
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
- [x] Bootstrap start/end announcement (automatic from 17.04.2026)
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
- [x] `rel="canonical"` on all 25 wiki pages
- [x] `twitter:card` + `twitter:site` + `twitter:image` on all pages
- [x] JSON-LD on `verify.html`
- [x] `verify.html` in sitemap
- [x] Developer TODO markers (`IFR_UPDATE`) set
- [x] robots.txt (GPTBot, ClaudeBot, PerplexityBot allowed)

---

## AFTER LP LIVE (after 15.07.2026)

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
*Last updated: 2026-03-15*
