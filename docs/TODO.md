# IFR Protocol — Developer TODO List
> Last updated: 2026-03-14 | Branch: main

---

## 🔴 KRITISCH

### Bot & Infrastruktur
- [ ] `voteAnnouncement.js` — Bot kündigt Governance Proposals an + verify.html Link + 24h Reminder
- [ ] `SIGNER_WALLETS` in Railway env setzen: `0x6b36687...` + `0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4`
- [ ] `VERIFY_PORT=3001` in Railway env setzen

### Core Developer (extern)
- [ ] BuilderRegistry.sol auf Sepolia deployen
- [ ] BuilderRegistry Audit durchführen
- [ ] BuilderRegistry auf Mainnet deployen
- [ ] `BUILDER_REGISTRY_ADDR` in Railway env setzen (nach Deploy)

---

## 🟠 DIESE WOCHE

### Multisig
- [ ] Multisig 1-of-2 → 2-of-4 upgraden (Gnosis Safe UI)
- [ ] 2 fehlende Verifizierer müssen Safe beitreten und signieren
- [ ] Governance → GnosisSafe Ownership übergeben

### Telegram Bot
- [ ] `/announce` Command: Community-Link automatisch anhängen (`https://t.me/IFR_token/1`)
- [ ] Channel → Community Announcements auto-sync
- [ ] Letzte Announcement immer angepinnt halten
- [ ] Daily Welcome testen (TELEGRAM_GENERAL_TOPIC_ID=5)
- [ ] Daily Burn Report testen (TELEGRAM_BURNS_TOPIC_ID=7)
- [ ] Sprache komplett auf Englisch prüfen/umstellen
- [ ] Protected Topics final testen (Vote/Council/Dev&Builder/Core Dev)

### Ali Copilot
- [ ] Sicherheitsrichtlinie: keine PII, keine Wallet-Ausgaben, keine Contract-Adressen direkt, nur ifrunit.tech, immer Reliability-Disclaimer
- [ ] Ali Phase 2: WalletConnect → wallet-spezifische Antworten (nach LP live)

---

## 🟡 MITTELFRISTIG

### Bootstrap (vor 17.04.2026)
- [ ] Announcement Text finalisieren (Reddit/X/Telegram/Farcaster)
- [ ] Reddit Posts: r/defi + r/ethfinance + r/CryptoMoonShots
- [ ] Farcaster Post vorbereiten
- [ ] Juicebox Listing/Discovery einrichten (KEIN Funding — nur Discovery)
- [ ] X/Twitter Announcement vorbereiten
- [ ] Bootstrap-Seite final review
- [ ] Bootstrap V4 auf bootstrap.html kommunizieren: "V4 Governance-Voting geplant für Phase 3"

### Frontend
- [ ] Animated Token GIF erstellen (fehlt noch)
- [ ] `Buy IFR` → Uniswap Button aktivieren (NUR nach LP live)
- [ ] Live Token Price einbinden (NUR nach LP live)
- [ ] WalletConnect Phase 2: `isLocked(wallet,1000e9)` Check → Copilot Gate (nach LP)
- [ ] WalletConnect Phase 3: Uniswap Link (NUR nach LP live)

### Dokumentation
- [ ] Plan B Dokumentation mit exaktem Zeitstempel der Entscheidung
- [ ] Handover-Dokument für Core Developer aktualisieren
- [ ] Project Continuity Sektion (Landing + README + Wiki)

### Railway
- [ ] FeeRouterV1 Tracking verifizieren (nach Proposal #6)
- [ ] BuybackVault + BurnReserve Accumulation Tracking verifizieren
- [ ] Pool Fee Receiver: von Deployer EOA auf FeeRouterV1 umstellen

### SEO / LLMO
- [ ] JSON-LD Schema.org auf allen Wiki-Seiten vollständig prüfen
- [ ] ChatGPT/Perplexity Indexierung verifizieren
- [ ] ethereum-lists PR #1010 verfolgen

### CI/CD
- [ ] Slither CI einrichten
- [ ] Mythril CI einrichten
- [ ] Coverage Badge im README
- [ ] 2-3 Repo-Maintainer rekrutieren

---

## ✅ ERLEDIGT

### Phase 3 — Sprint 2 (Wallet Verifikation)
- [x] `wallet-core.js` — Zentrale Wallet Session (EIP-5749 Multi-Wallet)
- [x] `ifr-state.js` — On-Chain State Reader (IFR/Lock/Bootstrap)
- [x] Bootstrap Widget — contribute/claim/refund
- [x] Landing Page Header Dropdown
- [x] `agent.html` Free/Premium Gate
- [x] 25 Wiki Top-Bar Wallet Buttons
- [x] `verificationStore.js` — 3-Tier Nonce + Session Store
- [x] `onChainReader.js` — IFRLock + Gnosis Safe getOwners() auto-sync
- [x] `/verify` + `/mystatus` Bot Commands
- [x] `verify.html` — 3-Tier Signing UI
- [x] Topic Guards (Core Dev 58 / Council 21 / Vote 23 / Dev&Builder 11)
- [x] 23/23 Verify Tests grün

### Phase 3 — Sprint 3 (On-Chain Reader)
- [x] `BuilderRegistry.sol` — 27/27 Tests, ABI exportiert
- [x] Deploy Script (Sepolia + Mainnet + Etherscan verify)
- [x] Gnosis Safe `getOwners()` Auto-Sync (5 Min Cache)
- [x] BuilderRegistry Placeholder in onChainReader.js

### Phase 3 — Sprint 4 (Wiki)
- [x] `governance.html` — Bot Commands Tabelle + Topic Access Tabelle
- [x] `integration.html` — BuilderRegistry Prozess + 4 Kategorien
- [x] `roadmap.html` — Phase 3 Sprint Status aktualisiert

### WalletConnect Phase 1
- [x] Connect Button Landing Page Header
- [x] Wallet Dropdown (ETH/IFR Balance, Lock Badge, Bootstrap Link)
- [x] X-Button Dropdown
- [x] Disconnect sofortiger UI-Reset
- [x] Mobile MetaMask Deeplink
- [x] visibilitychange Auto-Reconnect
- [x] 14 Playwright Tests grün

### Telegram Bot
- [x] Verification Gate + Spam Moderation
- [x] Daily Burn Report (09:00 CET)
- [x] Bootstrap Start/End Announcement (automatisch ab 17.04.2026)
- [x] 7-Tage Countdown (vor Start + vor Ende)

### Ali Copilot
- [x] Automatischer Bootstrap Datum-Check (NOT YET ACTIVE → ACTIVE → ENDED)
- [x] Wiki-Seiten Auto-Fetch alle 60 Min
- [x] Railway auto-deploy aktiv

### DAO Governance
- [x] Two-Chamber Visual auf Landing Page
- [x] `governance.html` — DAO Konzept vollständig dokumentiert (DE→EN)
- [x] DAO Contracts Tabelle (Phase 4 Placeholder)

### SEO / Audit
- [x] Audit Report `AUDIT_REPORT_20260314.md` erstellt
- [x] Test-Counts 494/444 → 556 in 32 Dateien
- [x] Wiki-Seitenanzahl 16/24 → 25 in 8 Dateien
- [x] `rel="canonical"` auf allen 25 Wiki-Seiten
- [x] `twitter:card` + `twitter:site` + `twitter:image` auf allen Seiten
- [x] JSON-LD auf `verify.html`
- [x] `verify.html` in Sitemap
- [x] Developer TODO Marker (`IFR_UPDATE`) gesetzt
- [x] robots.txt (GPTBot, ClaudeBot, PerplexityBot erlaubt)

---

## ⏳ NACH LP LIVE (nach 15.07.2026)

- [ ] CoinGecko Listing beantragen
- [ ] CoinMarketCap Listing beantragen
- [ ] AI Copilot Gate ≥1.000 IFR locked aktivieren
- [ ] Telegram Wallet-Whitelist via WalletConnect
- [ ] LiqRes Withdrawal Proposal: `setMaxWithdrawPerPeriod(200M)` ab 01.09.2026

---

## 🔵 PHASE 4 — DAO (nach LP live + Ecosystem)

### Smart Contracts
- [ ] `RatVoting.sol` — Team-Governance, Merkle Tree, on-chain Verankerung
- [ ] `ForumVoting.sol` — Community-Voting, ecrecover Signaturen
- [ ] `IFRSpamProtection.sol` — 10 IFR pro Proposal, deflationär

### Bot-Erweiterungen (Phase 4)
- [ ] `/propose` Command (Forum)
- [ ] `/vote [id] [yes/no]` Command
- [ ] `/proposals` Command
- [ ] `/result [id]` Command
- [ ] `/ratpropose` Command (Council/Signer only)
- [ ] `/ratvote` Command (Council/Signer only)
- [ ] Wallet-Mapper Service
- [ ] IFR-Reader Service
- [ ] Reaction-Tracker Service
- [ ] Poll-Manager Service

---

## 🏗️ PHASE 3+ VISION (langfristig)

### Web Dashboard
- [ ] Rollenbasiert via WalletConnect (User/Builder/Partner/Core Dev)
- [ ] Governance-Tool integriert
- [ ] CDN/Edge auf app.ifrunit.tech

### Client App
- [ ] APK (Android direkt)
- [ ] F-Droid
- [ ] Google Play
- [ ] App Store (iOS)
- [ ] DAO Governance integriert (Der Rat + Das Forum)

### Creator & Partner
- [ ] Creator Gateway (Open-Source Bridge, Docker, OAuth + WalletConnect)
- [ ] YouTube Integration Hybrid Modell B
- [ ] PartnerVault Option C (Milestone Unlock + Linear Vesting)
- [ ] Bootstrap V4 (Contributor-Voting, ETH-gewichtet)

### Phase 5
- [ ] Bug Bounty Programm
- [ ] Professioneller Audit (Third-Party)
- [ ] Ecosystem Fund

---

*Dieses Dokument wird bei jedem erledigten Task aktualisiert.*
*Zuletzt aktualisiert: 2026-03-14*
