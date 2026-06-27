# BRIDGE — inferno
# CC ↔ Codex ↔ Gio Kommunikationskanal
# Format: ## [DATUM] [AUTOR] ### TYPE: [MEMO|TODO|BUG|FIX|DECISION|SECURITY|REVIEW]

---

## 2026-06-10 [CODEX]
### TYPE: MEMO
### STATUS: CURRENT — Session Backup / Restart Stand

- HEAD Commit: `7cd356cb`
- Phase: 2 abgeschlossen / Phase 3 läuft
- IFR: live auf Uniswap
- Bootstrap: FINALIZED 05.06.2026
- Blockaid: unflagged 10.06.2026
- Pool: 0.038 ETH (dünn — Contributors kaufen morgen)
- Contributor Adressen on-chain aus `BootstrapVaultV3.contributors()` verifiziert:
  - C1: `0x4f632748460E5277bF8435259cADce440AbAC254`
  - C2: `0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958`
  - C3: `0xf556cCe85128c93AC6A7e088cF334180F2D3905B`

Session Log: `docs/SESSION_LOG_20260610.md`

---

## 2026-06-16 [CODEX]
### TYPE: MEMO
### STATUS: READY — Contributor Buy → Lock → Lending vorbereitet

Aktueller Stand on-chain geprüft am 16.06.2026:
- Pool: `0.083261656128757442` ETH / `36128594.451082089` IFR
- C1/C2/C3: je `33333333.333333333` IFR frei, `0` locked, `0` Tranches
- CommitmentVault Allowance: `0` für alle Contributor
- LendingVault Allowance: `0` für alle Contributor
- LendingVault Offers: keine bestehenden Offers, `totalAvailable=0`, `totalLent=0`
- LendingVault Zinssatz: `200` bps/month

Contributor-Käufe sind noch ausstehend. Danach:
1. Dry-runs erneut ausführen, weil die IFR-Balances nach dem Kauf höher sind.
2. `LOCK_BPS=5000` verwenden, wenn Lock + Lending aus derselben Wallet kommen.
3. Danach `contributors-lending-offer.js` mit default `LENDING_BPS=5000` ausführen.

Aktueller Snapshot: `docs/CONTRIBUTOR_EXECUTION_STATUS_20260616.md`

---

## 2026-06-16 [CODEX]
### TYPE: TOOLING
### STATUS: READY — Contributor Execution Monitor

Read-only Monitor ergänzt:

```bash
node scripts/check-contributors-execution.js
```

Das Script liest BootstrapVaultV3, IFR, CommitmentVault, LendingVault und den LP
Pool. Es zeigt pro Contributor:
- ETH/IFR Balance
- ob ein Uniswap-Kauf gegenüber der Claim-Balance erkannt wurde
- Lock-Balance und Tranche Count
- LendingVault Allowance und Offer Status
- nächsten operativen Schritt

`STRICT=true node scripts/check-contributors-execution.js` beendet mit Exit-Code
`1`, solange Contributor Buy/Lock/Lending noch offen ist.

---

## Blockaid Unflag — 10.06.2026
### TYPE: SECURITY
### STATUS: DONE — Unflag bestaetigt

IFR Contract `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
war faelschlich von Blockaid geflaggt — Unflag bestaetigt.
Propagation: ~24h ab 10.06.2026 02:25 UTC.

Nach 24h testen:
- MetaMask → IFR importieren → keine Warnung?
- Uniswap → IFR kaufen → keine Warnung?
- bootstrap.html → WalletConnect → funktioniert?

---

## Blockaid Retest — 11.06.2026 (nach 24h)

| Test | Device | Result |
|---|---|---|
| MetaMask: IFR importieren | Desktop | PASS/FAIL |
| MetaMask: Uniswap IFR kaufen | Desktop | PASS/FAIL |
| WalletConnect: bootstrap.html | Desktop | PASS/FAIL |
| MetaMask: IFR importieren | Samsung S10 | PASS/FAIL |
| WalletConnect: bootstrap.html | Samsung S10 | PASS/FAIL |

---

## 2026-06-10 [CODEX]
### TYPE: REVIEW
### STATUS: DONE — Vollstaendiger Projekt-Status-Audit

### Gelesene Quellen
- `docs/TODO.md`
- `BRIDGE.md`
- `docs/wiki/transparency.html`
- `docs/wiki/governance.html`
- `docs/wiki/roadmap.html`
- `docs/SECURITY_AUDIT_REPORT.md`

### ✅ ERLEDIGT (Phase 2 / Post-Bootstrap)
- Bootstrap `finalise()` ausgefuehrt am 05.06.2026 23:51 UTC.
- LP Token live: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`.
- Proposal #15 `setFeeExempt(LP Token, true)` executed am 08.06.2026; LP feeExempt on-chain `true`.
- Proposal #16 `setP0(CommitmentVault)` executed am 09.06.2026; P0 = `300,000,000 wei`.
- Alle 3 Bootstrap-Contributors haben geclaimed; 100M IFR verteilt.
- `BW.IFR_ALLOCATION` in `bootstrap.html` ist auf `100000000` gesetzt; TODO als erledigt synchronisiert.
- CommitmentVault, LendingVault und BuybackController sind deployed, verified und dokumentiert.
- Governance Owner ist TreasurySafe 3-of-5.
- Telegram Bot, Ali Copilot, points-backend und Verify-API Migration nach Hetzner laut Bridge abgeschlossen.
- Blockaid Unflag fuer IFR Contract bestaetigt; Propagation ~24h ab 10.06.2026 02:25 UTC.
- Internal Security Audit Report v1.0 erstellt: 0 manuell bestaetigte Critical/High Issues; 597 Contract-Tests passing.

### 🔴 KRITISCH OFFEN
- Contributors informieren: zuerst je 0.03 ETH IFR auf Uniswap kaufen, erst danach locken.
- CommitmentVault Lock ausfuehren nach Kaeufen: `scripts/contributor1-lock.js`.
- LendingVault `createOffer()` ausfuehren: `scripts/contributor1-lending-allowance.js`.

### 🟡 MEDIUM OFFEN
- StealthX x IFR Integration briefen und WalletConnect/MetaMask Flow nach Blockaid-Propagation erneut testen.
- Mehr Contributors / Marktkommunikation fuer Bootstrap-Nachlauf.
- `inferno-redesign.html` Review vor jedem Deploy.
- ethereum-lists PR #1036 weiterverfolgen.
- CoinGecko und CoinMarketCap Listing beantragen.
- Slither/Mythril CI, Coverage Badge, Maintainer-Recruiting.

### 📋 OFFENE GITHUB ISSUES
| Issue | Title | Labels |
|---:|---|---|
| #31 | Review inferno-redesign.html before deploy | design, review-required |
| #15 | [BUILDER] ORIGO — Conway's Game of Life Universe (Vendetta Labs) | builder-registry |
| #13 | [BUILDER] NEXUS GR — AI-Powered B2B & P2P Matching Platform | builder-registry |
| #12 | Builder Registration: Vendetta | builder-registry |
| #11 | [BUILDER] K-9 Academy | builder-registry |
| #9 | [BUILDER] StealthX / SecureCall | builder-registry |

### 🔗 ON-CHAIN STATUS
Prompt ABI check mit `finalized()` revertete, weil der deployed Contract die britische Schreibweise `finalised()` nutzt. Korrigierter read-only Check:

```text
=== ON-CHAIN STATUS 10.06.2026 ===
IFR Supply: 997976080.83640976
Bootstrap finalized: true
Bootstrap ETH raised: 0.03
Pool token0: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B
Pool token1: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
Pool ETH: 0.0460
Pool IFR: 65,324,702.034
LP feeExempt: true
Proposals total: 17
Gov Owner: 0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b
```

### Git Log letzte 10
```text
048474f3 docs: internal security audit report v1.0
4e13c988 feat: add BuilderRegistry registration proposal script
c8a2eaae docs: contributor price strategy + lock script TIME_ONLY
17b67774 feat: contributor lock scripts fixed + StealthX integration spec
fff11432 docs: ethereum-lists PR #1036 submitted — TODO updated
d9bd9cd0 docs: all 3 contributors claimed — TODO updated + IFR_ALLOCATION fix
174fede3 fix: claim() button visibility — read claimed(address) from BootstrapVaultV3
9c946de7 docs: BRIDGE.md — contributor1 lock+lending scripts memo
be9253a7 feat: contributor1 lock + lending allowance scripts (DRY_RUN safe)
01d1f8f5 fix: bootstrap.html — remove ALL live/active states, add FINALIZED
```

---

## 2026-06-11 [CC]
### TYPE: MEMO
### STATUS: DONE — Alle sofortigen Aktionen abgeschlossen

**Uniswap "Potential Honeypot Detected" — Root Cause & Aktionen**

#### Root Cause (verifiziert)
- Quelle: Blockaid → Uniswap GraphQL API → `attackType: HONEYPOT`
- Beweis: Uniswap Interface Quellcode (`getCurrencySafetyInfo.ts`) nutzt `protectionInfo.blockaidFees` → Blockaid ist der direkte Datenprovider
- GoPlus: `is_honeypot: 0` → kein Problem bei GoPlus
- IFR Fee (3.5%) liegt weit unter Uniswap's `TOKEN_PROTECTION_FOT_FEE_BREAKPOINT = 15%` → FOT-Score löst die Warning NICHT aus
- Uniswap-Pair `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` ist `feeExempt: true` → Swaps funktionieren korrekt

#### Abgeschlossene Aktionen
1. ✅ **Uniswap Default Token List** — GitHub Issue #2509: https://github.com/Uniswap/default-token-list/issues/2509
2. ✅ **Blockaid Email** — gesendet an support@blockaid.io (2026-06-11)
3. ✅ **Blockaid Portal Report** — abgesendet via report.blockaid.io (2026-06-11, kaspartisan@proton.me)
4. ✅ **Blockaid Follow-up** — Dokumentation nachgeliefert (2026-06-12): Whitepaper, Security-Page, Grok Audit PDF, GitHub. Ticket #1280903 / #1280905, Bearbeiter: Jas Olleres (support@blockaid.co)

#### Offene Punkte (optional — kein Blocker für den Fix)
- [ ] **CoinGecko Listing** — https://www.coingecko.com/request-form (CoinGecko-Account nötig)
- [ ] **CoinMarketCap Listing** — https://support.coinmarketcap.com/hc/en-us/requests/new (CMC-Account nötig)

#### Reminder & Follow-up
- **~2026-06-19** — Falls keine weitere Antwort von Jas Olleres: Ticket #1280903 nachhaken via Reply.
- **Nach Blockaid-Fix** — Uniswap-Warning verschwindet automatisch, kein weiterer Handlungsbedarf.
- **Falls Blockaid ablehnt** — Nächster Schritt: Uniswap Labs direkt kontaktieren (token-safety@uniswap.org oder Discord #token-listing).

#### TODO
- [ ] **2026-06-19** — Blockaid Ticket #1280903 checken. Falls keine Antwort: Reply an support@blockaid.co mit "Any update on this? Ticket #1280903"
- [ ] **CoinGecko** — Listing beantragen: https://www.coingecko.com/request-form
- [ ] **CoinMarketCap** — Listing beantragen: https://support.coinmarketcap.com/hc/en-us/requests/new

#### Technische Fakten für alle Submissions
- Token: Inferno (IFR), `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`, Ethereum Mainnet
- Uniswap V2 Pair: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` (feeExempt=true)
- Owner: Governance Contract `0xc43d48E7FDA576C5022d0670B652A622E8caD041` mit 48h Timelock (172.800s on-chain verifiziert)
- Keine Mint-Funktion, supply only decreases
- GoPlus: is_honeypot=0
- Website: https://ifrunit.tech | GitHub: https://github.com/NeaBouli/inferno

#### Ausstehend (Gio action required)
- [x] Blockaid Portal https://report.blockaid.io — abgesendet 2026-06-11
- [x] Email an support@blockaid.io — gesendet 2026-06-11
- [ ] CoinGecko Request Form — https://www.coingecko.com/request-form (Login mit CoinGecko-Account nötig)
- [ ] CoinMarketCap — https://support.coinmarketcap.com/hc/en-us/requests/new (CMC-Account nötig)

---

## 2026-06-10 [CC]
### TYPE: DECISION
### STATUS: OPEN — Contributors ausstehend

**Contributor Preis-Strategie**

#### Pool-Zustand (on-chain verifiziert, 10.06.2026)
- ETH im Pool: 0.038 ETH (~$95) — extrem dünn
- IFR im Pool: 79M IFR
- Aktueller Preis: ~$0.0000012 per IFR (0.0000000005 ETH/IFR)
- P0 = 0.3 ETH/IFR → Abstand ~600,000,000× → Preis-Unlock unrealistisch

#### Kauf-Impact (x*y=k)
| ETH Kauf | Preisanstieg |
|---|---|
| 0.01 ETH | +60% |
| 0.05 ETH | +437% |
| 0.1 ETH | +1,220% |
| 3 × 0.03 ETH | ~+300% kombiniert → Pool ~0.128 ETH |

#### Empfohlene Reihenfolge
1. **SOFORT**: Jeder Contributor kauft 0.03 ETH IFR auf Uniswap
   → 3 × 0.03 = 0.09 ETH Volumen → Pool ~0.128 ETH → Preis ~+300%
   → https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B

2. **DANACH**: Lock 33.3M IFR TIME_ONLY 30 Tage
   → `CONTRIBUTOR_ADDR=0x... MAINNET=true PRIVATE_KEY=0x... node scripts/contributor1-lock.js`
   → cType: TIME_ONLY (0) — P0-Preis-Unlock auf absehbare Zeit irrealistisch
   → ~100M IFR aus Umlauf entfernt

3. **PARALLEL**: StealthX Integration ankündigen
   → Spec: `docs/STEALTHX_IFR_INTEGRATION.md`

#### Warum TIME_ONLY statt TIME_OR_PRICE
P0 = 0.3 ETH/IFR liegt ~600 Mio.× über dem aktuellen Preis.
Selbst mit 1 ETH Kauf wäre der Preis immer noch ~10.000× unter P0.
TIME_ONLY (cType=0) garantiert Unlock nach 30 Tagen ohne Preis-Abhängigkeit.

#### Status
- [x] Contributors informiert (16.06.2026 — kaufen IFR danach)
- [ ] Käufe auf Uniswap ausgeführt (je 0.03 ETH)
- [ ] Locks ausgeführt (alle 3 Contributors)

---

## 2026-06-10 [CC]
### TYPE: FIX
### STATUS: DONE

**Fix: claim() Button Visibility nach Bootstrap FINALIZED**
- On-chain verifiziert: `finalised()=true`, `contributions(0x4f63...)=0.01 ETH`, `claimed(addr)=false`
- Bug: `claimed(address)` fehlte in `ABI_BOOTSTRAP` (ifr-state.js) + wurde nicht geladen
- Fix `ifr-state.js`:
  - `claimed(address)` zu `ABI_BOOTSTRAP` hinzugefügt
  - `result.bootstrapClaimed = await bootstrap.claimed(address)` nach `bootstrapContributionETH`
- Fix `docs/wiki/bootstrap.html`:
  - `claimed(address)` zu `BW.ABI` hinzugefügt
  - `bwUpdateUI()`: `alreadyClaimed = state.bootstrapClaimed` ausgelesen
  - Claim-Section Sichtbarkeit: `myContrib > 0 || alreadyClaimed` (vorher: nur `myContrib > 0`)
  - 4-Pfad-Logik: claim-button (finalized+unclaimed), claimed-msg (finalized+claimed), refund (nicht finalized+30d), awaiting (nicht finalized)

---

## 2026-06-09 [CC]
### TYPE: FIX
### STATUS: DONE

**Railway → Hetzner Migration: ai-copilot**
- `inferno-ai-copilot` Container läuft auf Hetzner (135.181.254.229) — healthy ✅
- Port 3003, Traefik-Route: `copilot-api.ifrunit.tech` (SSL via letsencrypt)
- Wiki RAG: 24 Docs geladen aus wiki-content.json ✅
- Bootstrap-Votes: 2 Votes aus BOOTSTRAP_VOTES env ✅
- BuilderRegistry / LendingVault / CommitmentVault aktiv ✅
- Volume: `inferno_copilot_data` für BOOTSTRAP_VOTES Persistenz
- `vercel.json` Rewrite: `ifr-copilot-api.railway.app` → `copilot-api.ifrunit.tech`
- DNS: A-Record `copilot-api.ifrunit.tech` → `135.181.254.229` ✅ (10.06.2026)
- Let's Encrypt Zertifikat ausgestellt ✅
- HTTPS: `{"status":"ok","apiKeySet":true,"etherscanKeySet":true}` ✅
- Railway `ifr-ai-copilot` Service gestoppt (`railway down`) ✅

**points-backend**: Migration abgeschlossen ✅
- Deployed auf Hetzner, Port 3004, Traefik-Route `points-api.ifrunit.tech` (SSL)
- Container: `inferno-points-backend` — healthy ✅
- Volume: `inferno_points_data` für SQLite DB
- Dockerfile multi-stage (builder: tsc + prisma generate; runner: --omit=dev)
- Fix: `PRISMA_QUERY_ENGINE_LIBRARY` → `/app/node_modules/@prisma/engines/libquery_engine-linux-musl-openssl-3.0.x.so.node`
- Grund: TSC kompiliert keine `.node`-Binaries; Prisma sucht nicht in `@prisma/engines/` standardmäßig
- VOUCHER_SIGNER_PRIVATE_KEY: neues EOA generiert (Voucher-Signing only, kein Funds)
- DNS: A-Record `points-api.ifrunit.tech` → `135.181.254.229` ✅ (10.06.2026)
- Let's Encrypt Zertifikat ausgestellt ✅
- HTTPS: `{"status":"ok"}` ✅
- ai-copilot: `POINTS_BACKEND_URL=http://inferno-points-backend:3004` gesetzt + recreated ✅

**Verify-API (Telegram Bot):**
- `verify-api.ifrunit.tech` Traefik-Route konfiguriert (Port 3001)
- DNS: A-Record `verify-api.ifrunit.tech` → `135.181.254.229` ✅ (10.06.2026)
- Let's Encrypt Zertifikat ausgestellt ✅
- HTTPS erreichbar — POST `/api/verify` antwortet mit 400 (validiert Input) ✅
- verify.html aktualisiert auf `verify-api.ifrunit.tech`

**Telegram Announcement Posts (08.06.2026)** — bereits gesendet:
- Post 1+2 → @IFRtoken Channel (msg_ids: 42, 43)
- Post 3 → @IFR_token Community #General (msg_id: 154)

---

## 2026-06-09 [CC]
### TYPE: FIX
### STATUS: DONE

**Governance Contract Adresse korrigiert**
- Falsche Adresse in `.env.production` und allen Scripts: `0x6050b22...` (Sepolia)
- Korrekte Mainnet-Adresse: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
- `eth_getCode` bestätigt: 16140 Zeichen Bytecode ✅, `proposalCount` = 17 ✅
- Bot-Governance-Notifier und VoteAnnouncements aktiv (beide schedulers gestartet)
- Scripts aktualisiert: deploy-lock, propose-ownership-transfer, execute-ownership-transfer, deploy-feerouter, transfer-ownership, redeploy-reserves, onchain-audit, deploy-bootstrap-vault (all v), execute-proposal, deploy-partner-vault, deploy-buyback-controller
- sepolia-smoke-test.js bewusst NICHT geändert (Sepolia-Adresse korrekt dort)

---

## 2026-06-09 [CC]
### TYPE: BUG → FIX
### STATUS: DONE

**Telegraf v4 bot.launch() Scheduler-Bug — Silent Failure**
- Root cause: Telegraf v4 `startPolling()` returns an infinite-loop Promise
- `bot.launch()` NEVER resolves while polling → `.then()` only fires on shutdown
- All schedulers (dailyReport, governance, votes, bootstrap) silently never started
- Fix: `bot.launch()` fire-and-forget (`.catch()` only), +3s delay for 409 detection, then init all services
- Commit: `8c84efde` — deployed to Hetzner, all schedulers confirmed running
- Logs confirmed: dailyReport ✅, dailyWelcome ✅, governance notifier ✅, vote announcements ✅

---

## 2026-06-09 [CC]
### TYPE: FIX
### STATUS: DONE

**Telegram Posts gesendet — IFR Live-Ankündigungen**
- Post 1 (Channel Announcements) "🔥 IFR IS NOW LIVE ON UNISWAP" → msg_id: 42
- Post 2 (Channel Announcements) "⚡ PHASE 2 COMPLETE — ALL GOVERNANCE EXECUTED" → msg_id: 43
- Post 3 (Community #General) "🎉 Gm Community!" → msg_id: 154

**Telegram-Bot Railway → Hetzner**
- Railway Service `inferno` → `○ Offline` (via `railway down --yes`)
- BOT_TOKEN: aus Railway Variables gesichert (`8685690992:AAGVgjKJSjZtQ3vYX1h6kbajvpZ-FBbGRlM`) → in Memory
- Code + Dockerfile auf Hetzner: `/opt/inferno/telegram-bot/`
- Docker Compose: `/opt/inferno/docker-compose.yml`
- Fix: `dropPendingUpdates: true` entfernt (verursachte Launch-Hang auf Hetzner)
- Container: `inferno-telegram-bot` — läuft auf Hetzner

**Governance-Fehler (WARN, kein kritischer Bug)**
- `proposalCount()` revert auf GOVERNANCE_ADDRESS `0x6050...` — contract evtl. nicht deployed oder ABI-Mismatch
- Telegram-Bot läuft trotzdem, nur Governance-Notifier deaktiviert

---

## 2026-06-06 [AUTOR: CC]
### TYPE: FIX

**Full site documentation update — Bootstrap ENDED, LP live, Proposals #15/#16**

Files changed (full site update):
- `docs/wiki/bootstrap.html` — CRITICAL callout: #11→#15, #12→#16 (with QUEUED/ETA)
- `docs/wiki/governance.html` — Proposal #16: Planned→Queued, ETA 09.06.2026 02:56 Athen, CommitmentVault address added
- `docs/wiki/roadmap.html` — Phase 4 LP pending→done (finalise() TX + LP Token), Post-Bootstrap Milestones updated (#11→#15, #12→#16), Current Focus updated
- `docs/wiki/contracts.html` — LP Pair: "Not yet created"→real address 0xbE495E9c..., ETH in Pool 0.030, LP lock Team.Finance, ethers.js example updated to mainnet
- `docs/wiki/deployment.html` — BootstrapVaultV3 badge: ACTIVE→FINALIZED
- `docs/wiki/fee-design.html` — LP Token row added to feeExempt table (Proposal #15 pending)
- `docs/wiki/tokenomics.html` — Bootstrap Event marked COMPLETED, Phase 1 LP Allocation marked DONE, LP Token added to feeExempt grid
- `docs/index.html` — Wallet dropdown Bootstrap link→Buy IFR (Uniswap)
- `README.md` — Bootstrap: ACTIVE→FINALIZED, LP Token added, CommitmentVault row added
- `docs/TODO.md` — Proposal #16: Timing→QUEUED ETA 09.06.2026
- `docs/TODO.html` — Proposal #16: Planned→QUEUED ETA 09.06.2026

Grep verifications:
- "Bootstrap ACTIVE": 0 hits ✅
- bE495E9c (LP Token): 23 hits ✅ (≥5 required)
- 0719d9eb (CommitmentVault): 8 hits ✅ (≥2 required)
- 08.06.2026|09.06.2026: 9 hits ✅ (≥4 required)

Risk: Low — docs only, no contract changes.

---

## 2026-06-06 [AUTOR: CC]
### TYPE: FIX

**Issue #35 — Post-Bootstrap Website + Ali Copilot updates**

Bootstrap ended 05.06.2026 23:51 UTC. All public-facing content updated to reflect FINALIZED state.

Files changed:
- `docs/wiki/bootstrap.html` — ACTIVE→ENDED banner, LP Token, TX, disabled Contribute/Vote buttons (prev session)
- `docs/wiki/transparency.html` — finalise() TX row DONE, Proposal #15 row added (prev session)
- `docs/wiki/governance.html` — Proposal #15 Queued ETA 08.06, setP0→Planned #16 (prev session)
- `docs/index.html` — Bootstrap Vault badge FINALIZED, Uniswap link, FAQ updated, Phase 2 roadmap DONE
- `apps/ai-copilot/src/context/ifr-knowledge.ts` — bootstrap.phase/currentState/startDate updated, lpToken/finaliseTx/uniswapLink/totalETHRaised(0.030) added, Proposal #15 in governance, bootstrapSafetyPlan.currentStatus updated
- `apps/ai-copilot/src/context/system-prompts.ts` — bootstrapBlock ENDED details with LP Token + Uniswap, "NOW LIVE" removed from explorer prompt
- `docs/TODO.md` — Issue #35 Ali update logged, Proposal #13→#15 QUEUED, Proposal #14→#16 updated P0 value, Bootstrap section header updated
- `docs/TODO.html` — finalise() row DONE with TX/LP, Proposal #15 QUEUED, Proposal #16 P0 updated

Tests: no test suite for docs/HTML — verified edits correct by Read inspection.
closes #35

---

## 2026-05-10 CC
### TYPE: SECURITY

**npm audit — vulnerability reduction**

Ran `npm audit` on fresh clone. Initial state: 69 vulnerabilities (4 critical).

Actions taken:
- Added `overrides` to `package.json` forcing: `elliptic >=6.6.1`, `handlebars >=4.7.9`, `form-data >=4.0.0`
- Ran non-breaking `npm audit fix`
- Result: 60 vulnerabilities (30 low, 17 moderate, 10 high, 3 critical)

Remaining 3 critical vulnerabilities — all in dev/test dependencies only (not deployed code):

| Package | Path | Fix requires | Risk |
|---------|------|-------------|------|
| `elliptic *` | node_modules/elliptic, node_modules/ganache/node_modules/elliptic | ethers@6 (breaking) | Dev-only; Hardhat test env |
| `form-data <2.5.4` | node_modules/request/node_modules/form-data | ethereum-waffle@3.4.4 (breaking) | Dev-only; waffle test runner |
| (undici high) | node_modules/undici | hardhat@3 (breaking) | Dev-only |

**Decision**: Accept dev-only risk. Deployed Solidity contracts have no Node.js runtime — these vulns cannot affect on-chain code.

**Full fix path** (when ready): requires ethers@5→@6 migration + hardhat@2→@3 migration + full test regression. Estimate: 4-8h. Defer until after Bootstrap finalise() (05.06.2026).

---

## 2026-05-10 CC
### TYPE: FIX

**Wiki HTML consistency fixes — BuybackController governance wiring**

Fixed inconsistent status display across wiki pages:

| File | Fix |
|------|-----|
| `docs/wiki/contracts.html` | Badge: "feeExempt Pending" (yellow) → "✅ Active" (green); Status row: proposals as pending → Proposal #13+#14 executed |
| `docs/wiki/roadmap.html` | Phase 4 list: "feeExempt pending" → "governance wiring complete ✅ (Proposals #13+#14 executed 16.&18.04.2026)" |

`docs/wiki/tokenomics.html` was already correct (no change needed).

Source of truth: Proposal #13 (setFeeExempt) executed 16.04.2026, Proposal #14 (setFeeCollector) executed 18.04.2026. BuybackController fully active.

---

## 2026-05-10 CC
### TYPE: TODO

**Pending items for Codex review:**

1. **ethers@5→@6 migration** — unblock remaining npm criticals. Requires updating all Hardhat scripts (deploy-*.js, propose-*.js) to ethers@6 API. Low urgency (dev-only risk).

2. **Bootstrap finalise()** — hard deadline 05.06.2026. Script: `scripts/bootstrap/finalize.js` (verify exists). Call via Hardhat with DEPLOYER_PRIVATE_KEY.

3. **Proposal #11 (Uniswap Pool feeExempt)** — must execute IMMEDIATELY after finalise(). Without this, IFR is not tradeable on Uniswap. Critical.

4. **on-chain state verification** — verify Proposal #13+#14 executed status via etherscan. Cannot verify locally without DEPLOYER_PRIVATE_KEY.

---

## 2026-05-23 [CC]
### TYPE: SECURITY + FIX
### Commit: 49914983

**BUG: Falsche IFR-Adresse in finalise-bootstrap.js**

`IFR_MAINNET` zeigte auf `0x3Bd71947...` — das ist die **Sepolia** IFR-Testadresse (aus `execute-proposal.js` chainId 11155111 Block). Der Mainnet-IFR-Token ist `0x77e99917...`.

Konsequenz ohne Fix: `balanceOf(BOOTSTRAP_V3_MAINNET)` würde den falschen Contract abfragen → entweder 0 (Revert wegen fehlender Funktion) oder falsche Balance → Pre-flight-Check wirft `Insufficient IFR` obwohl genug IFR im Vault sind.

**Fix:** `IFR_MAINNET = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B"` (konsistent mit `check-bootstrap-status.js`, `propose-pool-feeexempt.js`, `execute-proposal.js` mainnet config).

**Bootstrap Pre-flight — vollständige Checkliste für 05.06.2026:**

```bash
# T-1: Status prüfen (read-only, kein private key nötig)
npx hardhat run scripts/check-bootstrap-status.js --network mainnet

# T0 (nach endTime): Finalise aufrufen
npx hardhat run scripts/finalise-bootstrap.js --network mainnet
# → Gibt LP Token Address aus

# SOFORT danach: Proposal für LP feeExempt einreichen
LP_TOKEN=0x<adresse_aus_finalise> npx hardhat run scripts/propose-pool-feeexempt.js --network mainnet
# → Gibt Proposal ID aus

# +48h: Proposal ausführen
PROPOSAL_ID=<id> npx hardhat run scripts/execute-proposal.js --network mainnet
# → IFR handelbar auf Uniswap ✅
```

**Scripts verifiziert (2026-05-23):**
- `finalise-bootstrap.js` ✅ (IFR-Adresse gefixt)
- `check-bootstrap-status.js` ✅
- `propose-pool-feeexempt.js` ✅
- `execute-proposal.js` ✅

### EMPFÄNGER: GIO
**Gio-Action 05.06.2026:** DEPLOYER_PRIVATE_KEY in .env sicherstellen, dann Checkliste oben abarbeiten. Genug ETH für Gas bereithalten (~0.05 ETH Puffer).

---

## 2026-05-10 CC
### TYPE: MEMO

**finalise-bootstrap.js — Script für BootstrapVaultV3.finalise() erstellt**

Commit: `0df5ecb0`

**Gio muss dieses Script ausführen:**
```bash
cd /Users/gio/Desktop/repos/inferno
npx hardhat run scripts/finalise-bootstrap.js --network mainnet
```

**Wann:** Ab 05.06.2026 (Bootstrap endTime) — möglichst früh am Tag.

**Pre-flight checks im Script:**
- Prüft ob endTime schon erreicht
- Prüft IFR-Balance (>= 200M IFR erforderlich im Vault)
- Gibt Fehlermeldung wenn Bedingungen nicht erfüllt

**KRITISCH nach finalise():**
- Sofort Proposal #11 einreichen: setFeeExempt(UniswapPool, true)
- Nach 48h Timelock: Proposal #11 ausführen
- OHNE feeExempt: IFR nicht handelbar auf Uniswap!

**Empfänger: CODEX** — bitte BootstrapVaultV3 ABI und Script vor Ausführung nochmals reviewen.

---

## 2026-05-23 [CC]
### TYPE: FIX
### STATUS: DONE
### Commit: 04f6acf6

**Governance.test.js — setOwner() Tests für onlySelf korrigiert**

`setOwner()` nutzt `onlySelf` Modifier (muss über eigenen Timelock laufen) — Verbesserung gegenüber `onlyOwner`. Tests hatten noch den alten direkten Aufruf.

3 Tests gefixt:
- "owner can transfer ownership" → propose + DELAY warten + execute via Timelock
- "reverts for non-owner" → direkter Aufruf revert "not self" (war: "not owner")
- "reverts for zero address" → propose + execute reverts (.to.be.reverted ohne String-Match, da execute() den inner revert als string(returnData) propagiert — ABI-Bytes werden als raw string gesetzt)

Tests: 596 passing, 0 failing ✅

---

## 2026-05-30 [CC]
### TYPE: DECISION

**GitHub Issues ab sofort Teil des Workflows**

Ab sofort werden GitHub Issues (NeaBouli/inferno) aktiv genutzt — parallel zu BRIDGE.md.

**Aufteilung:**
- BRIDGE.md: CC↔Codex technische Kommunikation, Entscheidungen, Fixes, Security-Einträge
- GitHub Issues: Tasks, Bugs, Features — trackbar, assignierbar, schließbar per Commit-Referenz

**Konvention für CC:**
- Neue Tasks/Bugs → GitHub Issue erstellen mit Label (`bug`, `enhancement`, `task`, `security`)
- Fix-Commits referenzieren Issue: `fix: ... (closes #42)`
- Erledigte Issues werden geschlossen, nicht offen gelassen
- BRIDGE.md-Einträge die ein Issue erzeugen: Issue-Nummer vermerken

**Empfänger: CODEX** — bitte GitHub Issues bei Reviews und TODOs ebenfalls referenzieren.

---

## 2026-05-31 [CC]
### TYPE: REVIEW
### STATUS: GEGENPRÜFUNG ANGEFORDERT

**Bootstrap Pre-flight Audit — 6 Tage bis Deadline (05.06.2026)**

Vollständiger TODO- und On-Chain-Audit durchgeführt. Ergebnisse für Codex-Review:

---

### ON-CHAIN STATUS (31.05.2026, via PublicNode RPC)

| Feld | Wert | OK? |
|------|------|-----|
| `finalised()` | `false` | ✅ (erwartet) |
| `totalETHRaised` | **0.030 ETH** | ⚠️ sehr niedrig |
| `ifrAllocation` | 100,000,000 IFR | ✅ |
| Vault IFR Balance | **200,000,000 IFR** | ✅ (2× Allocation) |
| `endTime` | 2026-06-05T23:50:23Z | ✅ |
| LP Token Address | `0x000...000` | ✅ (noch nicht erstellt) |
| Deployer feeExempt | `true` | ✅ |
| BuybackController feeExempt | `true` | ✅ |
| FeeCollector | `0x1e0547D5...` (BuybackController) | ✅ |
| Governance Owner | `0x5ad6193e...` (TreasurySafe) | ✅ |

**Pre-flight: GRÜN.** Vault ist technisch ready für `finalise()`.

---

### KRITISCHE OFFENE ITEMS (GitHub Issues erstellt)

| Issue | Item | Timing |
|-------|------|--------|
| [#32](https://github.com/NeaBouli/inferno/issues/32) | `finalise()` aufrufen | 05.06.2026 23:50 UTC |
| [#33](https://github.com/NeaBouli/inferno/issues/33) | Uniswap Pool feeExempt Proposal | SOFORT nach finalise() |
| [#34](https://github.com/NeaBouli/inferno/issues/34) | P0 setzen in CommitmentVault | nach finalise() |
| [#35](https://github.com/NeaBouli/inferno/issues/35) | Post-Bootstrap: Website + Ali + Telegram | nach finalise() |
| [#31](https://github.com/NeaBouli/inferno/issues/31) | inferno-redesign.html Review | offen |

---

### FRAGEN AN CODEX

1. **Script `finalise-bootstrap.js`** — bitte vor Ausführung nochmals reviewen:
   - Korrekte Vault-Adresse: `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` ✅
   - Korrekte Funktion: `finalise()` (britisch) — ABI bestätigt
   - Script lief bisher nur gegen Hardhat-Local (chainId 31337) — niemals gegen Mainnet getestet

2. **`check-bootstrap-status.js`** nutzt `require("hardhat")` — läuft nur via `npx hardhat run ... --network mainnet`. Kein standalone-Aufruf möglich. Bitte Workaround prüfen oder Script anpassen für `ethers.providers.JsonRpcProvider`.

3. **totalETHRaised: 0.030 ETH** — Bootstrap endet in 6 Tagen mit sehr wenig ETH. P0 wird entsprechend niedrig sein. CommitmentVault-Tranchen-Targets werden darauf basieren (IMMUTABLE). Ist die Logik korrekt dass finalise() auch mit minimalem ETH-Betrag durchläuft?

4. **`hasRefundOccurred()`** revert — Funktion scheint im deployed Contract nicht vorhanden. In ABI aber deklariert. Bitte deployed Contract vs. aktuellem Source prüfen.

**Empfänger: CODEX** — bitte alle 4 Punkte prüfen und in BRIDGE.md antworten.

## 2026-06-04 [AUTOR: CC]
### TYPE: FIX

**Runbook-Korrektur: FINALISE_EXECUTION_PLAN.md — Hardhat-Commands + .env Blocker**

Kritischer Fehler in Execution Plan behoben. `finalise-bootstrap.js` verwendet intern
`require("hardhat")` und muss via `npx hardhat run --network mainnet` ausgeführt werden —
nicht via `node scripts/...`. Ohne Hardhat liest ethers keine Signer aus .env.

Fixes:
- `node scripts/finalise-bootstrap.js` → `npx hardhat run scripts/finalise-bootstrap.js --network mainnet`
- `node scripts/propose-pool-feeexempt.js` → `npx hardhat run scripts/propose-pool-feeexempt.js --network mainnet`
- `node scripts/check-bootstrap-status.js` bleibt standalone ✅
- BLOCKER-Sektion oben eingefügt: .env Setup + Verify-Command + Gas-Check
- .env aus .env.example erstellt (Placeholders — Gio muss DEPLOYER_PRIVATE_KEY + MAINNET_RPC_URL eintragen)
- TODO.md + TODO.html sync: Issue #32 Blocker-Hinweis, ethereum-lists PR CLOSED
- ethereum-lists PR #1010 als CLOSED markiert (31.05.2026) — Neueinreichung nach LP Launch

refs #32

## 2026-06-05 [AUTOR: CC]
### TYPE: FIX

**🔥 BOOTSTRAP FINALISED — 23:51 UTC**

finalise() erfolgreich ausgeführt (auto-script).

- TX: `0x949848bdd09f4c867a2593afffb0137c7db2c1457d8a8f5ff4428f8ecce69c5f`
- Block: 25254575
- Gas used: 2,778,422
- Finalised: true
- **LP Token: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`**

**feeExempt Proposal — FEHLGESCHLAGEN:**
`execution reverted: not owner`
Deployer (0x6b36687b) ist NICHT Owner der Governance — TreasurySafe ist Owner.
Proposal muss über TreasurySafe (3-of-5) submitted werden via Gnosis Safe UI.

**Action required (Issue #33):**
Target: InfernoToken.setFeeExempt(0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0, true)
Via: TreasurySafe 0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b (3-of-5)
Calldata: 0x8ebfc796000000000000000000000000be495e9c0d8cc2dcf95570cf95b63c4844df31a00000000000000000000000000000000000000000000000000000000000000001

## 2026-06-06 [AUTOR: CC]
### TYPE: TODO

**Issue #34: P0 setzen in CommitmentVault — Analyse + Script vorbereitet**

**P0-Berechnung:**
- totalETHRaised = 30,000,000,000,000,000 wei (0.030 ETH) — on-chain, Bootstrap TX 0x9498...69c5f
- ifrAllocation = 100,000,000 IFR (whole tokens, 9 decimals)
- **P0 = totalETHRaised_wei / ifrAllocation = 30_000_000_000_000_000 / 100_000_000 = 300,000,000 wei per 1 IFR**
- Entspricht: 3e-10 ETH/IFR = 0.3 Gwei/IFR
- NatSpec-konform: `setP0()` erwartet wei per 1 IFR (whole token, nicht smallest unit)

**Contract-Analyse:**
- `setP0(uint256 _p0)` — `onlyOwner`, EINMALIG setzbar (`p0Set` flag)
- Owner von CommitmentVault = Governance (`0xc43d48E7FDA576C5022d0670B652A622E8caD041`)
- Owner von Governance = TreasurySafe (`0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`, 3-of-5)
- Deployer (0x6b36687b) kann NICHT direkt proposieren — gleicher Blocker wie Issue #33

**KRITISCH — CommitmentVault deployed address fehlt im Repo:**
- `deployments/mainnet.json` enthält NUR BuybackController
- `deploy-commitment-vault.js` existiert, aber keine gespeicherte Deployment-Adresse
- **Gio muss CommitmentVault-Adresse aus Etherscan/TX-History ermitteln und als env-Var setzen**
- Wenn CommitmentVault noch nicht deployed: zuerst deployen via `npx hardhat run scripts/deploy-commitment-vault.js --network mainnet`

**Script: `scripts/propose-set-p0.js`**
- Standardmodus: DRY_RUN=true (gibt nur Calldata aus, kein TX-Broadcast)
- Prüft on-chain ob p0Set bereits true — schützt vor Doppel-Proposal
- Gibt vollständige Gnosis Safe UI Calldata aus
- Fallback: live broadcast wenn DRY_RUN=false UND Deployer = Gov-Owner (nicht der Fall)

**Gio muss tun:**
1. CommitmentVault deployed address ermitteln (Etherscan / Deploy-TX suchen)
2. Adresse in `.env` setzen: `COMMITMENT_VAULT=0x<address>`
3. Dry-run: `COMMITMENT_VAULT=0x<address> DRY_RUN=true npx hardhat run scripts/propose-set-p0.js --network mainnet`
4. Output-Calldata via Gnosis Safe UI submitten:
   - URL: https://app.safe.global/transactions/queue?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b
   - To: 0xc43d48E7FDA576C5022d0670B652A622E8caD041 (Governance)
   - Data: [Calldata aus Script-Output]
5. 48h warten (Timelock)
6. Proposal via TreasurySafe execute()

**Wenn CommitmentVault noch NICHT deployed:**
- Zuerst deployen: `npx hardhat run scripts/deploy-commitment-vault.js --network mainnet`
- Dann: `setFeeExempt(CommitmentVault, true)` Proposal nötig (analog Issue #33) — BEFORE users lock!
- Dann erst P0 Proposal

refs #34

## 2026-06-06 [AUTOR: CC]
### TYPE: FIX
Issue #34 DONE: P0 Proposal on-chain via TreasurySafe.

Proposal #16 (proposals-mapping, nicht getProposal):
- Target: 0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3 (CommitmentVault)
- ETA: 09.06.2026 02:56 Athen (48h Timelock)
- P0 = 300_000_000 wei/IFR (0.030 ETH / 100M IFR)
- execute() via TreasurySafe nach 09.06. 02:56 Athen

Hinweis: getProposal() hat off-by-one (gibt immer leeres nächstes Slot zurück). proposals(id) ist korrekt.

closes #34 (Proposal submitted — execute ausstehend)

## 2026-06-08 [AUTOR: CC]
### TYPE: FIX

**Proposal #15 EXECUTED — IFR live on Uniswap**

TX: `0xd5a3bc9527b6cc5288b892a9ba99a3af37b940f273856ab6ba938403cd2b4204`
Block: 25271071
LP Token (`0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`) feeExempt = TRUE — IFR tradeable on Uniswap without 3.5% swap fee.

Files changed:
- `docs/wiki/governance.html` — Proposal #15: Queued → Executed, TX + Block documented; Bootstrap notice updated
- `docs/wiki/transparency.html` — Proposal #15 row: Queued → Executed; new row in Token Movements (ProposalExecuted #15)
- `docs/wiki/fee-design.html` — LP Token feeExempt: Pending → TRUE (08.06.2026); Bootstrap notice updated
- `docs/index.html` — Buy IFR Uniswap URL: `/#/swap` → `/swap` (canonical URL fix)
- `docs/wiki/faq.html` — "Where can I buy $IFR": updated to live Uniswap link; "When does trading go live": DONE; "Bootstrap finalized with 1 contributor": updated P0 + status

Pending: Proposal #16 setP0(CommitmentVault) — ETA 09.06.2026 02:56 Athen

closes #33

---

## 2026-06-06 [AUTOR: CC]
### TYPE: FIX
Prompt #63: Vollständiges Seiten-Audit — alle 42 HTML-Seiten geprüft.

**Geändert (12 Seiten):**
- wiki/bootstrap.html — BW.END + BOOTSTRAP_END auf 23:51 UTC (exakter finalise() Zeitpunkt); Callout von "CRITICAL AFTER FINALISE()" auf Post-Finalise-Status mit Proposal #15/#16
- wiki/roadmap.html — badge "Active" → "FINALIZED"; countdown widget item → ENDED
- wiki/protocol-plan.html — "Bootstrap is active (until June 5)" → "Bootstrap ENDED 05.06.2026 23:51 UTC" + Block/TX
- wiki/faq.html — "after Bootstrap closes June 5, 2026" → "Bootstrap FINALIZED 05.06.2026 23:51 UTC"
- wiki/transparency.html — Proposal #16 Row hinzugefügt (setP0 CommitmentVault, ETA 09.06.2026)
- wiki/governance.html — P0 Formel korrigiert (100M → 200M IFR); Bootstrap FINALIZED Notice + Proposal #15/#16 hinzugefügt
- wiki/tokenomics.html — Block 25254575 + TX + Proposal #15/#16 hinzugefügt
- wiki/fee-design.html — Bootstrap FINALIZED Notice + Block/TX + Proposal #15/#16 hinzugefügt
- wiki/contracts.html — Bootstrap FINALIZED + ENDED Note in LP Pair Description
- wiki/wallet-guide.html — BootstrapVaultV3 Badge LIVE → FINALIZED + Block/TX/LP Token
- wiki/ecosystem.html — Timeline "Bootstrap End + finalise()" von future → done, mit Block/TX/LP Token
- wiki/lending-vault.html — "Lending available after Bootstrap finalise (June 2026)" → FINALIZED + Proposal #16
- wiki/commitment-vault.html — 3 Stellen: "Bootstrap finalise (June 2026)" → FINALIZED + Proposal #16 + P0-Formel
- wiki/deployment.html — LP Token Row mit Block/TX hinzugefügt
- wizard/buy.html — "Bootstrap is live" → FINALIZED, Schritte auf Uniswap-Buy aktualisiert

**Bereits korrekt (30 Seiten):**
index.html, TODO.html, wiki/agent.html, wiki/business-onboarding.html, wiki/contributing.html, wiki/dao-governance.html, wiki/fair-launch.html, wiki/index.html, wiki/integration.html, wiki/lending-market.html, wiki/lock-mechanism.html, wiki/lp-strategy.html, wiki/mainnet-checklist.html, wiki/multisig.html, wiki/one-pager.html, wiki/open-audit.html, wiki/press-kit.html, wiki/security.html, wiki/testnet.html, wiki/verify.html, wiki/vesting.html, wizard/borrow.html, wizard/build.html, wizard/contribute.html, wizard/lend.html, wizard/lock.html

**Grep-Checks:**
- Bootstrap ACTIVE (sichtbar): 0 echte Treffer (nur JS-Code, Nav-Links, historische TODOs)
- LP Token bE495E9c: 38 Treffer
- Block 25254575: 16 Treffer

---

## 2026-06-10 [CC]
### TYPE: MEMO
### STATUS: DONE

**Contributor 1 — CommitmentVault lock + LendingVault offer scripts**

- Contributor 1 found on-chain: `BootstrapVault.contributors[0]` = `0x4f632748460E5277bF8435259cADce440AbAC254`
  - Block: 24663703, ETH contributed: 0.01 ETH
- CommitmentVault p0: 300000000 wei, p0Set: true ✅
- Scripts created:
  - `scripts/contributor1-lock.js` — 10 tranches × 10M IFR, cType=TIME_OR_PRICE(2), 30d OR P0*2
  - `scripts/contributor1-lending-allowance.js` — approve + createOffer(50M IFR) on LendingVault
- Note: LendingVault has no setLendingAllowance(). createOffer() is permissionless.
- DRY_RUN=true verified clean ✅
- Commit: be9253a7 on main
- WARNING: Contributor 1 IFR balance = 0 — tokens not yet claimed from BootstrapVault. Run claim before executing MAINNET=true.

---

## 2026-06-11 [CODEX]
### TYPE: FEATURE
### STATUS: DONE
### EMPFÄNGER: CC|GIO

**NEA-150 — Chameleon BuilderRegistry Governance Payload**

- Gio wallet for Chameleon registration: `0x4f632748460E5277bF8435259cADce440AbAC254`.
- Read-only Mainnet check:
  - BuilderRegistry: `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3`
  - Registry owner: Governance `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
  - Governance owner: TreasurySafe `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
  - Chameleon wallet `isBuilder`: false
  - Builder count: 0
- Added `scripts/propose-builder-registration.js`.
  - Defaults: wallet Gio address, name `Chameleon`, url `https://github.com/NeaBouli/chameleon`, category `integration`.
  - Default `DRY_RUN=true`; prints Safe/Governance calldata and does not broadcast.
  - If run with `DRY_RUN=false`, it refuses unless signer is Governance owner.
- Verification:
  - `DRY_RUN=true npx hardhat run scripts/propose-builder-registration.js --network mainnet` ✅ produced Safe calldata.
  - `npx hardhat test test/BuilderRegistry.test.js` ✅ 27 passing.
- Next: submit printed calldata via TreasurySafe, wait timelock ETA, execute proposal, then verify `isBuilder(0x4f6327...) == true`.

---

## 2026-06-18 [CODEX]
### TYPE: TOKEN-METADATA
### STATUS: DONE / EXTERNAL OPEN

**IFR Token Icon Distribution**

- Etherscan: icon live at `https://etherscan.io/token/images/infernoprotocol_ifr.svg`; token page shows `Inferno (IFR)`.
- Hosted schema-valid Uniswap Token List:
  - `https://ifrunit.tech/token-list.json`
  - `https://ifrunit.tech/.well-known/token-list.json`
- Landing page: added MetaMask import flow via EIP-747 `wallet_watchAsset`.
  - Contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  - Symbol: `IFR`
  - Decimals: `9`
  - Image: `https://ifrunit.tech/assets/ifr_icon_256.png`
- Uniswap Default Token List: existing request is open:
  - `https://github.com/Uniswap/default-token-list/issues/2509`
- MetaMask Registry: blocked for now.
  - `MetaMask/contract-metadata` is effectively frozen for new tokens.
  - Ethereum assets require Etherscan reputation `NEUTRAL` or `OK`; IFR currently shows `Unknown`.

Next:
- Update Uniswap issue #2509 with the new token-list and icon URLs after deploy.
- Request Etherscan reputation review from `Unknown` to `Neutral`/`OK`.
- Revisit MetaMask registry only after Etherscan reputation changes.

---

## 2026-06-18 [CODEX TERMINAL]
### TYPE: STATUS / EXTERNAL
### STATUS: SYNCED

**Datum:** 2026-06-18 13:02 PDT
**Autor:** CODEX TERMINAL

**Was geprüft wurde**

- `BRIDGE.md` vollständig gelesen; bestehender Token-Metadata-Stand vom 2026-06-18 weiterverwendet.
- Git HEAD vor dieser Bridge-Synchronisierung: `14117740 feat: publish IFR token metadata`.
- `git status --short` war vor dieser Bridge-Synchronisierung clean.
- IFR Token List live und maschinenlesbar:
  - `https://ifrunit.tech/token-list.json`
  - `https://ifrunit.tech/.well-known/token-list.json`
- Beide Token-List-Endpunkte liefern:
  - Name: `Inferno Token List`
  - Symbol: `IFR`
  - Address: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  - Logo: `https://ifrunit.tech/assets/ifr_icon_256.png`
  - Timestamp: `2026-06-18T15:30:00.000Z`
- Landing enthält den MetaMask-Import-Flow via `lpAddIFRToken()` / `wallet_watchAsset`.
- Uniswap Default Token List Issue bleibt offen:
  - `https://github.com/Uniswap/default-token-list/issues/2509`
  - State: `open`
  - Last updated: `2026-06-18T15:28:12Z`
- MetaMask Registry bleibt blockiert, solange Etherscan Token Reputation für IFR noch `Unknown` ist.

**Commit/PR/Issue**

- Commit: `14117740 feat: publish IFR token metadata`
- Issue: `https://github.com/Uniswap/default-token-list/issues/2509`

**Offene nächste Schritte**

- Uniswap Issue #2509 weiter aktualisieren, falls Reviewer zusätzliche Token-List- oder Icon-Nachweise anfordern.
- Etherscan Reputation Review anstoßen bzw. nachfassen, bis IFR von `Unknown` auf `Neutral`/`OK` wechselt.
- MetaMask Registry erst nach Reputation-Upgrade erneut angehen.
- Bei künftigen Token-Metadata-Änderungen `docs/token-list.json` und `docs/.well-known/token-list.json` synchron halten.

---

## 2026-06-18 [CODEX TERMINAL]
### TYPE: STATUS / EXTERNAL
### STATUS: MONITORING

**Datum:** 2026-06-18 14:42 PDT
**Autor:** CODEX TERMINAL

**Festgehalten**

- Uniswap Default Token List Issue #2509 bleibt der aktive öffentliche Listing-Thread für IFR:
  - `https://github.com/Uniswap/default-token-list/issues/2509`
- IFR Token List ist bereits live und kann bei Uniswap als Nachweis verwendet werden:
  - `https://ifrunit.tech/token-list.json`
  - `https://ifrunit.tech/.well-known/token-list.json`
- Etherscan Icon/Token-Metadaten sind live, aber Reputation ist weiterhin der relevante Blocker für MetaMask Registry.
- MetaMask Registry bleibt zurückgestellt, bis Etherscan IFR nicht mehr als `Unknown`, sondern mindestens als `Neutral`/`OK` führt.

**Monitoring-Auftrag**

- Uniswap Issue #2509 regelmäßig prüfen:
  - Statuswechsel `open` -> `closed` beobachten.
  - Neue Reviewer-Kommentare beantworten.
  - Falls verlangt, Token-List-URLs, Icon-URL, Etherscan-Link und Governance-/No-Mint-Nachweise erneut posten.
- Etherscan Reputation regelmäßig prüfen:
  - Sobald Reputation von `Unknown` auf `Neutral`/`OK` wechselt, MetaMask Registry wieder aufnehmen.
- MetaMask Registry erst nach Etherscan-Reputation-Upgrade erneut anfassen.

**Offene nächste Schritte**

- Ticket-Watch aktiv halten: Uniswap #2509 + Etherscan Reputation.
- Bei jeder Statusänderung neuen `EXTERNAL`-Eintrag in `BRIDGE.md` ergänzen.
- Keine neue Token-Metadata-Quelle anlegen; `BRIDGE.md` bleibt die zentrale Übergabe.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: DECISION / PROCESS
### STATUS: ACTIVE

**Datum:** 2026-06-19 03:18 PDT
**Autor:** CODEX TERMINAL

**Bridge-Regel bestätigt**

- `BRIDGE.md` bleibt die zentrale laufende Übergabe- und Synchronisationsquelle für alle Agenten.
- Jede relevante Änderung, externe Prüfung, Ticket-Aktualisierung, neue Erkenntnis oder offene Entscheidung wird am Ende von `BRIDGE.md` ergänzt.
- Bestehende Bridge-Einträge werden weiterverwendet; keine parallele Übergabedatei für denselben Status anlegen.
- Bei externen Stati immer konkrete Links, Zeitpunkte und offene nächste Schritte notieren.

**Aktuell besonders zu beobachten**

- Uniswap Default Token List Issue #2509:
  - `https://github.com/Uniswap/default-token-list/issues/2509`
- Etherscan Reputation für IFR, aktuell noch relevanter Blocker für MetaMask Registry.
- Contributor-Ausführung: Uniswap-Käufe, 50% CommitmentVault-Locks, 50% LendingVault-Offers.
- Chameleon BuilderRegistry Governance-Ausführung via TreasurySafe/Timelock.

**Nächste Regel für Agenten**

- Vor neuen Arbeiten `BRIDGE.md` lesen.
- Nach relevanten Arbeiten oder Checks `BRIDGE.md` aktualisieren.
- Danach committen und pushen, sofern eine Dateiänderung entstanden ist.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: STATUS / EXTERNAL
### STATUS: MONITORING — NO STATE CHANGE

**Datum:** 2026-06-19 13:02 PDT
**Autor:** CODEX TERMINAL

**Was geprüft wurde**

- `BRIDGE.md` vollständig gelesen und mit letztem dokumentiertem Stand synchronisiert.
- Git HEAD vor dieser Bridge-Aktualisierung: `ff577914 docs: record bridge update policy`.
- `git status --short` war vor dieser Bridge-Aktualisierung clean.
- Uniswap Default Token List Issue #2509 geprüft:
  - `https://github.com/Uniswap/default-token-list/issues/2509`
  - Status: `open`
  - Titel: `Add IFR: Inferno`
  - Last updated: `2026-06-18T15:28:12Z`
  - Comments: `2`
  - Kein PR/Branch verknüpft.
- IFR Token Lists geprüft und live:
  - `https://ifrunit.tech/token-list.json`
  - `https://ifrunit.tech/.well-known/token-list.json`
  - Beide liefern `Inferno Token List`, 1 Token, `IFR`, Decimals `9`, Address `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`, Logo `https://ifrunit.tech/assets/ifr_icon_256.png`, Timestamp `2026-06-18T15:30:00.000Z`.
- Etherscan Token Page geprüft:
  - `https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  - Token Rep weiterhin `Unknown`.
  - Holders: `17` zum Check-Zeitpunkt laut Etherscan HTML.
- Contributor Execution Monitor ausgeführt:
  - Command: `node scripts/check-contributors-execution.js`
  - Network: Ethereum Mainnet (`homestead`, chainId `1`)
  - Block: `25353887`
  - Pool: `0.083261656128757442` ETH / `36128594.451082089` IFR
  - LendingVault: `totalAvailable=0`, `totalLent=0`, Rate `200` bps/month
  - C1: `0x4f632748460E5277bF8435259cADce440AbAC254`, ETH `0.001055298994466727`, IFR `33333333.333333333`, buy=false, locked=0, offer=false, next=`top up ETH for buy + gas`
  - C2: `0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958`, ETH `0.004243668025184632`, IFR `33333333.333333333`, buy=false, locked=0, offer=false, next=`top up ETH for buy + gas`
  - C3: `0xf556cCe85128c93AC6A7e088cF334180F2D3905B`, ETH `0.004617965521402287`, IFR `33333333.333333333`, buy=false, locked=0, offer=false, next=`top up ETH for buy + gas`
- Chameleon BuilderRegistry dry-run ausgeführt:
  - Command: `DRY_RUN=true npx hardhat run scripts/propose-builder-registration.js --network mainnet`
  - BuilderRegistry owner: Governance `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
  - Governance owner: TreasurySafe `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
  - Builder count: `0`
  - Chameleon wallet `0x4f632748460E5277bF8435259cADce440AbAC254` active/isBuilder: `false`
  - Safe calldata wurde erneut ausgegeben; keine Transaktion gesendet.

**Commit/PR/Issue**

- Current pre-update HEAD: `ff577914 docs: record bridge update policy`
- Uniswap Issue: `https://github.com/Uniswap/default-token-list/issues/2509`
- Safe queue URL fuer Chameleon Governance: `https://app.safe.global/transactions/queue?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`

**Offene nächste Schritte**

- Contributors brauchen weiter ETH-Top-up auf mindestens ca. `0.05 ETH` je Wallet, danach IFR-Kauf auf Uniswap.
- Nach Contributor-Käufen erneut `node scripts/check-contributors-execution.js` ausführen.
- Danach je Contributor erst `LOCK_BPS=5000` CommitmentVault-Lock dry-run/live, dann LendingVault offer dry-run/live.
- Uniswap Issue #2509 weiter beobachten und bei Reviewer-Kommentaren sofort aktualisieren.
- Etherscan Reputation Review nachfassen, bis Token Rep von `Unknown` auf `Neutral`/`OK` wechselt.
- MetaMask Registry erst nach Etherscan-Reputation-Upgrade wieder aufnehmen.
- Chameleon BuilderRegistry Proposal via TreasurySafe submitten, Timelock abwarten, ausführen, dann `isBuilder(...) == true` verifizieren.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: FIX
### STATUS: DONE — Mobile/tablet landing navigation restored

**Datum:** 2026-06-19 13:07 PDT
**Autor:** CODEX TERMINAL

**Was geändert wurde**

- Landing-Header auf Smartphone und Tablet repariert: die Navigationslinks werden unter `900px` nicht mehr ausgeblendet.
- `docs/assets/landing-header-template.css`
  - Mobile/tablet `.nav-inner` darf umbrechen.
  - `.nav-links` wird als sichtbare zweite Header-Zeile gerendert.
  - Tablet: einzeilige Navigation.
  - Smartphone (`<=520px`): kompakte zweizeilige Navigation, damit alle Links direkt sichtbar sind.
- `docs/assets/redesign-skin.css`
  - Gleiche responsive Header-Regeln ergänzt, damit der Skin die Landing-Vorlage nicht wieder überschreibt.

**Verifikation**

- Lokaler Server:
  - `python3 -m http.server 4177 --bind 127.0.0.1` aus `docs/`
- Playwright mit lokalem Google Chrome:
  - Mobile viewport `390x844`: 8/8 Nav-Links sichtbar (`Overview`, `How`, `Ecosystem`, `Tokenomics`, `Security`, `Governance`, `Contracts`, `FAQ`), kein horizontaler Body-Overflow.
  - Tablet viewport `768x1024`: 8/8 Nav-Links sichtbar, kein horizontaler Body-Overflow.
- Screenshots zur manuellen Kontrolle:
  - `/Users/gio/Desktop/inferno-nav-mobile-20260619.png`
  - `/Users/gio/Desktop/inferno-nav-tablet-20260619.png`

**Commit/PR/Issue**

- Kein externes Issue; direkter UI-Fix auf Landing.

**Offene nächste Schritte**

- Nach Deploy auf `ifrunit.tech` mobile Safari/Chrome real-device prüfen.
- Falls Gio weniger Header-Höhe auf Smartphone wünscht, kurze Mobile-Labels oder horizontale Scroll-Nav als Alternative prüfen.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: FIX
### STATUS: DONE — Wiki wallet dropdown aligned with Landing

**Datum:** 2026-06-19 14:22 PDT
**Autor:** CODEX TERMINAL

**Was geändert wurde**

- Wiki-Wallet-Bar auf allen 33 `docs/wiki/*.html` Seiten an Landing-Wallet-Aktionen angepasst.
- Alter verbundener Dropdown-CTA `🔥 Bootstrap` wurde entfernt.
- Neuer Dropdown-CTA-Satz wie Landing:
  - `🔥 Buy IFR` -> Uniswap Swap URL mit IFR Token-Adresse
  - `Add IFR` -> MetaMask/EIP-747 Token-Import
  - `Disconnect`
- `lpAddIFRToken()` auf den Wiki-Seiten ergänzt; nutzt `IFRWallet.addIFRToken()` aus `docs/assets/wallet-core.js`.
- Sichtbarer Wiki-Connect-Button auf Landing-ähnlichen Status angepasst:
  - Text: `Connect Wallet`
  - Farbe: `#B0481E`
  - kein alter Fox/Outline-Button mehr im Wiki-Wallet-Bar-Header.

**Verifikation**

- Repo-Checks:
  - `rg "Bootstrap</a>" docs/wiki --glob "*.html"` -> keine Treffer für den alten Dropdown-CTA.
  - `git diff --check` -> clean.
- Lokaler Browsercheck:
  - Server: `python3 -m http.server 4178 --bind 127.0.0.1` aus `docs/`
  - Seite: `http://127.0.0.1:4178/wiki/index.html`
  - Viewport: mobile `390x844`
  - Ergebnis:
    - Connect-Button Text: `Connect Wallet`
    - Connect-Button Background: `rgb(176, 72, 30)`
    - Dropdown enthält keinen Bootstrap-Action-Link mehr.
    - Dropdown-Actions: `Buy IFR`, `Add IFR`, `Disconnect`
    - `window.lpAddIFRToken` vorhanden.
    - Kein horizontaler Body-Overflow.
- Screenshot:
  - `/Users/gio/Desktop/inferno-wiki-wallet-mobile-20260619.png`

**Commit/PR/Issue**

- Kein externes Issue; direkter UI-/Wallet-Fix im Wiki.

**Offene nächste Schritte**

- Nach Deploy auf `ifrunit.tech` echte mobile Safari/Chrome-Prüfung machen.
- Wallet-Flow mit echter MetaMask-Extension/App prüfen: Connect, Add IFR, Disconnect.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: FIX
### STATUS: DONE — Juicebox removed, IFR Protocol branding clarified

**Datum:** 2026-06-19 14:33 PDT
**Autor:** CODEX TERMINAL

**Was geändert wurde**

- Veralteten Juicebox-Link `https://juicebox.money/v5/eth:79` aus öffentlichen Seiten und Begleitdokumenten entfernt.
- Landing klar auf `IFR Protocol` erweitert:
  - SEO Title/Description/Keywords
  - OpenGraph/Twitter Metadata
  - Header-Branding `IFR PROTOCOL` + `$IFR`
  - versteckter SEO-H1
  - Footer-Branding `IFR Protocol / Inferno ($IFR)`
- Wiki klar auf `IFR Protocol / Inferno Protocol` erweitert:
  - Wiki-Startseite Title/Meta/JSON-LD/H1/Intro
  - Sidebar-Logo auf allen `docs/wiki/*.html` Seiten von `INFERNO` auf `IFR PROTOCOL`
  - Sidebar-CSS auf längeres Label angepasst (`font-size`, `white-space`)
- Alte Bootstrap-/Announcement-/TODO-Referenzen von Juicebox auf kanonische IFR-Protocol-Website/Wiki umgestellt.

**Verifikation**

- `rg -n "juicebox\.money|Juicebox|juicebox" docs README.md package.json --glob "*.html" --glob "*.md" --glob "*.json"` -> keine Treffer.
- `rg -n 'class="sidebar-logo">INFERNO' docs/wiki --glob "*.html"` -> keine Treffer.
- `git diff --check` -> clean.
- Lokaler Browsercheck:
  - Server: `python3 -m http.server 4173` aus `docs/`
  - Landing mobile `390x844`: Title `IFR Protocol — Inferno ($IFR) Deflationary Utility Token`, Brand `IFR PROTOCOL$IFR`, kein Top-Row-Overlap, kein Juicebox im DOM.
  - Wiki mobile/desktop: Title `IFR Protocol Documentation — Inferno ($IFR)`, Sidebar `IFR PROTOCOL`, kein Juicebox im DOM.

**Commit/PR/Issue**

- Lokaler Commit folgt nach finalem Statuscheck.

**Offene nächste Schritte**

- Nach Deploy auf `ifrunit.tech` kurz live prüfen, ob Landing Header, Wiki Sidebar und Footer wie lokal gerendert werden.
- Externe Token-List-/Registry-Tickets weiterhin beobachten wie im vorherigen Bridge-Stand dokumentiert.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: FIX
### STATUS: DONE — IFR price feed reads Uniswap V2 reserves

**Datum:** 2026-06-19 15:45 PDT
**Autor:** CODEX TERMINAL

**Was geprüft/geändert wurde**

- Landing zeigte `IFR Price -> Soon -> Waiting for API price feed`.
- Root Cause:
  - `https://copilot-api.ifrunit.tech/api/ifr/price` liefert live noch veraltete Bootstrap-Logik (`bootstrap_active`, `price:null`).
  - Backend-Code hatte noch keinen Uniswap-Reserve-Read und verwendete für Bootstrap-finalized außerdem die falsche US-Schreibweise im Kommentar/Flow.
- `apps/ai-copilot/server/index.ts`
  - `/api/ifr/price` liest jetzt direkt das Uniswap V2 IFR/WETH Pair `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`.
  - Antwort enthält `status: uniswap_v2_live`, ETH/IFR-Reserven, `ifrPerEth`, Blocknummer und `price` in ETH pro IFR.
  - Quelle bewusst als `Uniswap V2 spot` bezeichnet, nicht als TWAP.
- `docs/index.html`
  - IFR-Price-Kachel zeigt sehr kleine ETH-Preise mit ausreichend Dezimalstellen.
  - Text von `Live Uniswap TWAP` auf `Live Uniswap V2 spot` korrigiert.
  - Price-Kachel wird initial gerendert und nicht mehr vom Supply/Balances-Feed blockiert.
  - Generisches `N/A` überschreibt `ifr-price` nicht mehr.
- `apps/ai-copilot/src/context/wiki-content.json`
  - durch `npm run build` regeneriert; nimmt die vorherige IFR-Protocol-Wiki-Umbenennung in den Copilot-RAG-Index auf.

**Live/Local Werte beim Check**

- Direkter Pair-Read:
  - Block: `25354686`
  - ETH Reserve: `0.08326165612875744`
  - IFR Reserve: `36128594.45108209`
  - Preis: `0.0000000023045916231668866 ETH/IFR`
  - IFR pro ETH: `433916356.35030043`
- Lokaler neuer API-Response:
  - `price: 2.3045916231668866e-9`
  - `status: uniswap_v2_live`
  - `source: Uniswap V2 IFR/WETH reserves`
- Lokale Landing mit geroutetem lokalem API-Response:
  - Kachel zeigt `Ξ0.000000002305`
  - Subtext: `Live Uniswap V2 spot · 0.0833 ETH LP`
  - Kein `Soon`, kein `Waiting for API price feed`.

**Verifikation**

- `npm ci` in `apps/ai-copilot` ausgeführt, weil lokale Dependencies fehlten.
- `npm run build` in `apps/ai-copilot` -> erfolgreich (`vite v6.4.1`, 30 modules transformed).
- `git diff --check` -> clean.

**Hinweise**

- `npm ci` meldet bestehende Audit-Warnings im App-Dependency-Tree: `9 vulnerabilities` (`2 low`, `2 moderate`, `3 high`, `2 critical`). Nicht durch diesen Fix verursacht; sollte separat behandelt werden.
- Nach Deploy der Copilot-API muss der Live-Endpunkt `https://copilot-api.ifrunit.tech/api/ifr/price` erneut geprüft werden; aktuell ist nur der lokale Handler gefixt.

**Offene nächste Schritte**

- Copilot-API deployen/restarten, damit der neue Price-Endpoint live geht.
- Danach `https://ifrunit.tech` prüfen: IFR Price darf nicht mehr `Soon` zeigen.
- Optional spaeter echten TWAP/Oracle ergänzen, falls die UI wieder `TWAP` nennen soll.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: FIX / DEPLOY
### STATUS: IN PROGRESS — Copilot container redeploy for IFR price feed

**Datum:** 2026-06-19 15:52 PDT
**Autor:** CODEX TERMINAL

**Was geprüft/geändert wurde**

- Nach Commit `c3cc9524` wurde der Hetzner-Service geprüft.
- `copilot-api.ifrunit.tech/api/ifr/price` lief weiter mit altem Container-Code bzw. war nach erstem Rebuild fehlerhaft.
- Server-Check:
  - Host: `hetzner` -> `135.181.254.229`
  - Compose path: `/opt/inferno/docker-compose.yml`
  - Service: `ai-copilot`, Container: `inferno-ai-copilot`
  - Source path: `/opt/inferno/ai-copilot`
  - Kein Git-Checkout auf dem Server; Source wird per rsync synchronisiert.
- Manuelles Rebuild/Restart wurde ausgeführt:
  - `rsync apps/ai-copilot/ -> hetzner:/opt/inferno/ai-copilot/`
  - `docker compose build ai-copilot`
  - `docker compose up -d ai-copilot`
- Danach war der Container healthy, aber `/api/ifr/price` gab `502`.
- Root Cause im Container-Log:
  - `ERR_MODULE_NOT_FOUND: Cannot find package 'ethers' imported from /app/server/index.ts`
  - Das App-Paket nutzte `ethers` bereits dynamisch im Server, deklarierte es aber nicht in `apps/ai-copilot/package.json`; lokal funktionierte es durch Root-Hoisting.
- Fix:
  - `ethers@^5.8.0` zu `apps/ai-copilot` Runtime-Dependencies ergänzt.
  - `apps/ai-copilot/package-lock.json` aktualisiert.

**Verifikation lokal**

- `npm run build` in `apps/ai-copilot` -> erfolgreich.
- `npx tsc --noEmit` in `apps/ai-copilot` -> erfolgreich.

**Hinweise**

- `npm install ethers@^5.8.0` erhöht den App-npm-audit-Zähler auf `24 vulnerabilities` (`14 low`, `4 moderate`, `4 high`, `2 critical`) durch transitive Dependencies. Separate Dependency-Audit-Aufgabe bleibt offen.

**Offene nächste Schritte**

- Dependency-Fix committen/pushen.
- `apps/ai-copilot` erneut nach Hetzner rsyncen.
- `docker compose build ai-copilot && docker compose up -d ai-copilot`.
- Live-Endpunkt erneut prüfen:
  - `https://copilot-api.ifrunit.tech/api/ifr/price` muss `status: uniswap_v2_live` und einen numerischen `price` liefern.
  - Danach Landing live prüfen.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: DEPLOY
### STATUS: DONE — IFR price live on production

**Datum:** 2026-06-19 15:55 PDT
**Autor:** CODEX TERMINAL

**Was deployed wurde**

- Commit `77a19e82 fix: declare ai copilot ethers dependency` nach Hetzner synchronisiert.
- `apps/ai-copilot` per rsync nach `/opt/inferno/ai-copilot/` übertragen.
- Service neu gebaut und gestartet:
  - `cd /opt/inferno`
  - `docker compose build ai-copilot`
  - `docker compose up -d ai-copilot`
- Container `inferno-ai-copilot` ist `healthy`.

**Live-Verifikation**

- `https://copilot-api.ifrunit.tech/api/ifr/price`:
  - `status: uniswap_v2_live`
  - `price: 2.3045916231668866e-9`
  - `source: Uniswap V2 IFR/WETH reserves`
  - reserves:
    - ETH: `0.08326165612875744`
    - IFR: `36128594.45108209`
  - `ifrPerEth: 433916356.35030043`
- `https://ifrunit.tech` live per Playwright geprüft:
  - Title: `IFR Protocol — Inferno ($IFR) Deflationary Utility Token`
  - IFR Price Kachel: `Ξ0.000000002305`
  - Subtext: `Live Uniswap V2 spot · 0.0833 ETH LP`
  - Kein `Soon`
  - Kein `Waiting for API price feed`

**Commit/PR/Issue**

- `c3cc9524 fix: read IFR price from Uniswap reserves`
- `77a19e82 fix: declare ai copilot ethers dependency`

**Offene nächste Schritte**

- Optional: echten TWAP/Oracle implementieren, wenn die UI langfristig wieder `TWAP` nennen soll.
- Dependency-Audit für `apps/ai-copilot` separat planen; Docker build meldet weiter `24 vulnerabilities`.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: FIX / STATUS
### STATUS: DONE — Landing Token Flow checked against Mainnet

**Datum:** 2026-06-19 16:03 PDT
**Autor:** CODEX TERMINAL

**Was geprüft wurde**

- Landing Token-Flow-Abschnitt in `docs/index.html`.
- Mainnet read-only Check gegen IFR Token, FeeRouterV1 und bekannte Contract-Adressen.
- Live API Checks:
  - `https://copilot-api.ifrunit.tech/api/ifr/supply`
  - `https://copilot-api.ifrunit.tech/api/ifr/balances`
  - `https://copilot-api.ifrunit.tech/api/ifr/price`

**On-chain Fakten beim Check**

- IFR Token:
  - `senderBurnBps = 200` (2.0%)
  - `recipientBurnBps = 50` (0.5%)
  - `poolFeeBps = 100` (1.0%)
  - Gesamt: `3.5%` auf nicht fee-exempt Transfers.
  - Pool fee receiver: `FeeRouterV1` (`0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`)
  - Owner: Governance (`0xc43d48E7FDA576C5022d0670B652A622E8caD041`)
  - Supply: `997,769,355.275448874` IFR
- FeeRouterV1:
  - `protocolFeeBps = 5` (0.05% ETH protocol fee for router swaps)
  - `feeCollector = BuybackController` (`0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c`)
  - `paused = false`
- Current relevant balances:
  - LP Reserve Safe: `400,600,000` IFR
  - LiquidityReserve: `200,000,000` IFR
  - Vesting: `150,000,000` IFR
  - CommunitySafe: `7,900,000` IFR
  - FeeRouterV1: `292,257.88982045` IFR
  - Uniswap V2 pool: `36,128,594.45108209` IFR / `0.08326165612875744` ETH

**Was geändert wurde**

- Veraltete Landing-Structured-Data-Descriptions korrigiert:
  - vorher falsch: `1% burn + 1% buyback + 1% pool + 0.5% team`
  - jetzt: `2.5% burn + 1% IFR pool fee`
- Landing-Text korrigiert:
  - FeeRouterV1 empfängt die 1% IFR pool fee.
  - BuybackController verarbeitet separate ETH protocol fees; kein direkter Team-Fee.
- Token-Flow-Grafik aktualisiert:
  - Supply von statisch `998.5M` auf live `data-live-key="supply-flow"`.
  - LP Reserve Safe auf `400.6M IFR`.
  - Bootstrap V3 als `finalised · claims done`.
  - Uniswap V2 als live `data-live-key="lp-flow"`.
  - FeeRouter als live `data-live-key="feerouter-flow"`.
- Live-JS ergänzt:
  - `supply-flow` aktualisiert aus Supply API.
  - `lp-flow` aktualisiert aus Price/Reserve API.
  - `feerouter-flow` aktualisiert aus Balances API.

**Verifikation**

- `rg` auf Landing:
  - keine Treffer mehr für falsche alte Splits wie `1% buyback`, `0.5% team`, `Splits to BuybackVault`.
- Lokaler Browsercheck:
  - Server: `python3 -m http.server 4175` aus `docs/`
  - Playwright desktop `1366x900`
  - Token Flow gerendert mit:
    - `997.8M supply`
    - `36.1M IFR + 0.083 ETH`
    - `292K IFR fees held`
  - `badFeeSplit = false`
- `git diff --check` -> clean.

**Commit/PR/Issue**

- Commit: `d699eb31 fix: align landing token flow with mainnet`

**Offene nächste Schritte**

- Nach Deploy auf `ifrunit.tech` kurz live prüfen, ob der Token Flow dieselben Live-Werte rendert.
- Separat Wiki-Seiten `tokenomics.html` und `fee-design.html` auf gleiche FeeRouter/BuybackController-Nuance prüfen, falls Gio das vollständige Wiki-Audit fortsetzen will.

---

## 2026-06-19 [CODEX TERMINAL]
### TYPE: FIX
### STATUS: DONE — Wiki Connect Wallet button contrast

**Datum:** 2026-06-19 16:20 PDT
**Autor:** CODEX TERMINAL

**Was geändert wurde**

- Ursache: `docs/assets/redesign-skin.css` setzt in Wiki-Wallet-Bar und generischen inline-color Overrides dunkle Textfarbe. Dadurch wurde der `Connect Wallet` Button trotz inline `color:#fff` dunkel/schlecht lesbar.
- Fix in `docs/assets/redesign-skin.css`:
  - gezielte CSS-Ausnahme für `#wiki-wallet-bar #lp-header-connect-btn`
  - `color: #fff !important`
  - `background: #B0481E !important`
  - transparenter Border und leichter Textshadow für Kontrast
- Keine 33 Wiki-HTML-Seiten einzeln geändert; gemeinsame Skin-Regel reicht für alle Wiki-Seiten.

**Verifikation**

- Lokaler Server:
  - `python3 -m http.server 4176` aus `docs/`
- Playwright:
  - `wiki/index.html` mobile `390x844`: Button Text `Connect Wallet`, computed color `rgb(255, 255, 255)`, background `rgb(176, 72, 30)`.
  - `wiki/index.html` desktop `1366x900`: Button Text `Connect Wallet`, computed color `rgb(255, 255, 255)`, background `rgb(176, 72, 30)`.
- `git diff --check` -> clean.

**Commit/PR/Issue**

- Commit folgt.

**Offene nächste Schritte**

- Nach Deploy kurz auf echter Wiki-Seite prüfen, ob der Button in Safari/Chrome weiß bleibt.

---

## 2026-06-21 [CODEX TERMINAL]
### TYPE: STATUS
### STATUS: RESTART CHECKPOINT — Bridge-only Sicherung

**Datum:** 2026-06-21
**Autor:** CODEX TERMINAL

**Was gesichert wurde**

- Gio muss den Rechner neu starten; dieser Eintrag hält den letzten bekannten Arbeitsstand fest.
- Letzter bekannter sauberer HEAD aus der vorherigen Synchronisation:
  - `e20a10b6 fix: improve wiki connect button contrast`
- Letzter bekannter Git-Status aus der vorherigen Synchronisation:
  - clean nach Commit/Push
- Letzte erledigte Arbeit:
  - Wiki `Connect Wallet` Button-Kontrast korrigiert.
  - Button-Text im Wiki ist weiß und besser lesbar.
  - Änderung liegt in `docs/assets/redesign-skin.css`.
  - Lokale Playwright-Prüfung war erfolgreich auf Mobile und Desktop.

**Wichtiger Hinweis**

- Während dieses Checkpoints war der Terminal-Runner nicht funktionsfähig:
  - `pwd`, `echo ok`, `date`, `git status --short` und weitere minimale Shell-Kommandos lieferten nur `code -1` ohne Ausgabe.
- Deshalb konnten in dieser Sitzung nicht erneut verifiziert werden:
  - aktueller `git status --short`
  - aktueller `git log -1 --oneline`
  - Commit/Push dieses Bridge-Checkpoints

**Offene nächste Schritte nach Neustart**

- Repo öffnen:
  - `cd /Users/gio/Desktop/repos/inferno`
- Status prüfen:
  - `git status --short`
  - `git log -1 --oneline`
- Falls dieser Bridge-Checkpoint uncommitted ist:
  - `git add BRIDGE.md`
  - `git commit -m "docs: checkpoint before restart"`
  - `git push origin main`
- Danach weiter mit den bekannten offenen Punkten:
  - Contributors ETH top-up, IFR-Kauf, 50% Lock, 50% Lending.
  - Uniswap Issue #2509 beobachten.
  - Etherscan Reputation / MetaMask Registry Blocker beobachten.
  - Chameleon BuilderRegistry Governance-Ausführung abschließen.

---

## 2026-06-22 [CODEX TERMINAL]
### TYPE: DOCS / DECISION
### STATUS: DONE — StealthX IFR integration model corrected

**Datum:** 2026-06-22
**Autor:** CODEX TERMINAL

**Entscheidung / Klarstellung**

- StealthX/SecureCall/SecureChat/Chameleon nutzt IFR aktuell als Holder-Discount-Signal.
- Partner hat die frühere Lock-Funktion aus technischen Gründen aus den Apps entfernt.
- Der aktuelle öffentliche Flow ist:
  - Browser-Wallet-Verifikation
  - read-only IFR Balance Check auf Ethereum Mainnet
  - 50% Stripe Checkout Discount für qualifizierte IFR Holder
  - normale Produktaktivierung über Stripe/Lizenz/Activation Code
- Kein aktueller In-App WalletConnect Unlock.
- Kein aktueller IFRLock/CommitmentVault Gate für StealthX App-Features.

**Geänderte Dateien**

- `docs/STEALTHX_IFR_INTEGRATION.md`
  - alte Lock/Premium-Unlock-Spec ersetzt
  - aktuelles Holder-Discount-Modell dokumentiert
  - SecureCall, SecureChat und Chameleon als öffentliche StealthX-Produkte aufgenommen
- `README.md`
  - Integrated Builder Products: StealthX-Zeile auf IFR Holder Verification / 50% Checkout Discount korrigiert
- `docs/TODO.md`
  - StealthX TODO von Lock-Gate auf Balance-Verification-Discount umgestellt
- `docs/TODO.html`
  - gleiche Korrektur im HTML-TODO

**Offene nächste Schritte**

- StealthX-Seiten auf Schwellenwert-Konsistenz prüfen; SecureChat public copy enthielt unterschiedliche Suite-Schwellen.
- Falls gewünscht: StealthX/Chameleon per Governance in IFR `BuilderRegistry` registrieren.
- Künftige Kommunikation als "IFR holder discount" formulieren, nicht als "IFR lock unlock", solange Lock-Gating nicht wieder eingeführt wird.

---

## 2026-06-22 [CODEX TERMINAL]
### TYPE: STATUS
### STATUS: CURRENT — Offene Punkte nach StealthX-Doku-Korrektur

**Datum:** 2026-06-22
**Autor:** CODEX TERMINAL

**Repo**

- Branch: `main`
- Remote: `origin/main`
- Aktueller Worktree hat uncommitted Docs-Änderungen:
  - `BRIDGE.md`
  - `README.md`
  - `docs/STEALTHX_IFR_INTEGRATION.md`
  - `docs/TODO.md`
  - `docs/TODO.html`
- Zweck der Änderung: StealthX-Integration von altem Lock-Gating auf aktuellen IFR Holder Discount Flow korrigiert.

**Verifizierter Mainnet-Status**

- Check: `node scripts/check-contributors-execution.js`
- Block: `25371602`
- Bootstrap: `finalised=true`
- Uniswap V2 Pool:
  - ETH: `0.083261656128757442`
  - IFR: `36128594.451082089`
- LendingVault:
  - `totalAvailable=0`
  - `totalLent=0`
  - Rate: `200` bps/month

**Contributors**

- C1 `0x4f632748460E5277bF8435259cADce440AbAC254`
  - ETH `0.001055298994466727`
  - IFR `33333333.333333333`
  - Buy detected: `false`
  - Locked: `0`
  - Lending offer: `false`
  - Next: ETH top-up for buy + gas
- C2 `0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958`
  - ETH `0.004243668025184632`
  - IFR `33333333.333333333`
  - Buy detected: `false`
  - Locked: `0`
  - Lending offer: `false`
  - Next: ETH top-up for buy + gas
- C3 `0xf556cCe85128c93AC6A7e088cF334180F2D3905B`
  - ETH `0.004617965521402287`
  - IFR `33333333.333333333`
  - Buy detected: `false`
  - Locked: `0`
  - Lending offer: `false`
  - Next: ETH top-up for buy + gas

**BuilderRegistry / Chameleon / StealthX**

- Registry: `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3`
- Block: `25371602`
- `getBuilderCount() = 0`
- `getActiveBuilders().length = 0`
- Chameleon/Gio wallet `0x4f632748460E5277bF8435259cADce440AbAC254`:
  - `isBuilder=false`
- Interpretation:
  - StealthX products are public IFR partner/use-case pages through holder discount.
  - No StealthX/Chameleon entry is registered on-chain in BuilderRegistry yet.
  - On-chain builder registration is optional governance visibility, not required for the public discount flow.

**External**

- Uniswap Default Token List Issue:
  - URL: `https://github.com/Uniswap/default-token-list/issues/2509`
  - State: `open`
  - Updated: `2026-06-18T15:28:12Z`
  - Comments: `2`
- Etherscan reputation / MetaMask Registry:
  - Still treated as open blocker from prior Bridge status until reputation changes from `Unknown` to `Neutral`/`OK`.

**Offen / Als nächstes**

1. Commit der aktuellen StealthX-Doku-Korrektur vorbereiten:
   - optional `git diff --check`
   - `git add BRIDGE.md README.md docs/STEALTHX_IFR_INTEGRATION.md docs/TODO.md docs/TODO.html`
   - commit/push
2. Contributor-Ausführung:
   - C1/C2/C3 mit ETH auf ca. `0.05 ETH` je Wallet auffüllen
   - IFR-Käufe auf Uniswap ausführen
   - danach `node scripts/check-contributors-execution.js`
   - danach Lock-Dry-runs und Lending-Dry-runs
   - dann live `LOCK_BPS=5000` und LendingVault offers
3. StealthX-Seiten:
   - öffentliche Thresholds prüfen und Inkonsistenzen bereinigen, besonders SecureChat Suite-Schwelle.
   - Kommunikation konsequent als "IFR holder discount" führen.
4. BuilderRegistry:
   - entscheiden, ob StealthX/Chameleon on-chain registriert werden soll.
   - falls ja: Safe-Payload aus `scripts/propose-builder-registration.js` submitten, 48h Timelock abwarten, ausführen, `isBuilder=true` verifizieren.
5. External listings:
   - Uniswap Issue #2509 weiter beobachten.
   - Etherscan Reputation nachfassen.
   - MetaMask Registry erst nach Etherscan Reputation Upgrade wieder aufnehmen.

---

## 2026-06-27 [CODEX TERMINAL]
### TYPE: FIX / EXTERNAL
### STATUS: DONE — GeckoTerminal dofollow footer backlink added

**Datum:** 2026-06-27 15:53 PDT
**Autor:** CODEX TERMINAL

**Was geaendert wurde**

- GeckoTerminal verlangt fuer die Token-Profil-Freigabe einen dofollow-Linkback.
- Footer-Suche vor dem Edit:
  - Keine dedizierte `Footer.tsx` / Next-Footer-Komponente fuer `ifrunit.tech` gefunden.
  - Gefunden wurden nur Footer-Helper-Scripts:
    - `scripts/docs-footer-generator.js`
    - `scripts/docs-footer-injector.js`
  - Oeffentliche `ifrunit.tech` Landing liegt in diesem Repo als statische Seite in `docs/index.html`.
- `docs/index.html` Footer erweitert:
  - Neuer Link in bestehender `.footer-links` Liste, direkt nach `Etherscan`.
  - Bestehendes Footer-Pattern uebernommen: normales `<a>` mit `target="_blank"` und `rel="noopener"`.
  - Keine bestehenden Footer-Inhalte entfernt oder umstrukturiert.

**Link**

```html
<a href="https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0" target="_blank" rel="noopener">Track $IFR on GeckoTerminal</a>
```

**Dofollow-Status**

- Dofollow ist erfuellt:
  - `rel` enthaelt nur `noopener`.
  - Kein `nofollow`, kein `sponsored`, kein `ugc` am GeckoTerminal-Link.

**Verifikation**

- Vollstaendiger Diff fuer die Aenderung:

```diff
diff --git a/docs/index.html b/docs/index.html
index acf5e72f..680ed772 100644
--- a/docs/index.html
+++ b/docs/index.html
@@ -2923,6 +2923,7 @@ if (isLocked) {
       <a href="wiki/index.html">Documentation</a>
       <a href="https://paragraph.com/@0x6b36687b0cd4386fb14cf565b67d7862110fed67/the-ifr-fair-launch-story-%E2%80%94-from-code-to-community" target="_blank" rel="noopener">Blog</a>
       <a href="https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code" target="_blank" rel="noopener">Etherscan</a>
+      <a href="https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0" target="_blank" rel="noopener">Track $IFR on GeckoTerminal</a>
       <a href="https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#code" target="_blank" rel="noopener">Governance</a>
       <a href="https://github.com/NeaBouli/inferno/issues" target="_blank" rel="noopener">&#x2709; Contact</a>
     </div>
```

- `grep -ri "geckoterminal" docs/index.html`:
  - zeigt den Link mit `rel="noopener"`.
- Negativcheck:
  - `rg -n "geckoterminal.*nofollow|nofollow.*geckoterminal|geckoterminal.*sponsored|sponsored.*geckoterminal|geckoterminal.*ugc|ugc.*geckoterminal" docs/index.html`
  - keine Treffer.
- Statischer HTTP-Check:
  - `python3 -m http.server 4180 --bind 127.0.0.1` aus `docs/`
  - `curl -fsS http://127.0.0.1:4180/ | grep -i "geckoterminal"` liefert den Link.
  - HTTP-Negativcheck auf `nofollow|sponsored|ugc` am GeckoTerminal-Link liefert keine Treffer.

**Build-Status**

- Geforderter Command `npm ci && npm run build` wurde ausgefuehrt, aber nicht gruen:
  - `npm ci` bricht ab, weil `package.json` und `package-lock.json` im Root nicht synchron sind.
  - Fehler:
    - `form-data@4.0.5` im Lockfile erfuellt nicht `form-data@4.0.6`.
    - `hasown@2.0.2` im Lockfile erfuellt nicht `hasown@2.0.4`.
  - Danach wurde `npm run build` separat geprueft und scheitert im Root mit `Missing script: "build"`.
- Interpretation:
  - Der Footer-Fix betrifft die statische GitHub-Pages-Site `docs/index.html`.
  - Es gibt in diesem Repo keinen Root-Build fuer diese statische Landing.
  - Der einzige gefundene Next-Kontext ist `apps/benefits-network/frontend/next.config.js`, nicht die `ifrunit.tech` Landing.

**Offene naechste Schritte**

- Root `package-lock.json` separat mit dem Root `package.json` synchronisieren, wenn der Root-`npm ci` wieder gruen werden soll.
- Falls GeckoTerminal spaeter explizit das Token-Profil statt des Pool-Profils verlangt, Linkziel auf `https://www.geckoterminal.com/eth/tokens/0x77e99917Eca8539c62F509ED1193ac36580A6e7B` umstellen.

---

## 2026-06-27 [CODEX TERMINAL]
### TYPE: DOCS / STATUS
### STATUS: DONE — StealthX IFR holder-discount docs finalized

**Datum:** 2026-06-27 15:55 PDT
**Autor:** CODEX TERMINAL

**Was abgeschlossen wurde**

- Die seit 2026-06-22 offenen StealthX-Doku-Aenderungen wurden geprueft und fuer Commit vorbereitet.
- Inhaltliche Korrektur:
  - StealthX/SecureCall/SecureChat/Chameleon wird nicht mehr als aktuelles IFR-Lock-Gating beschrieben.
  - Aktueller Stand ist IFR holder verification / read-only balance check fuer 50% Stripe checkout discount.
  - `IFRLock` und `CommitmentVault` bleiben als IFR-Protokollkomponenten dokumentiert, sind aber nicht Teil des aktuellen StealthX-Checkout-Discount-Flows.

**Geaenderte Dateien**

- `README.md`
  - Integrated Builder Products: StealthX-Zeile auf `IFR holder verification for 50% checkout discount` korrigiert.
- `docs/STEALTHX_IFR_INTEGRATION.md`
  - alte Lock/Premium-Unlock-Spec durch aktuellen Holder-Discount-Flow ersetzt.
  - SecureCall, SecureChat und Chameleon als StealthX-Produkte aufgenommen.
  - technische Balance-Check-Skizze gegen IFR Token `balanceOf(address)` dokumentiert.
- `docs/TODO.md`
  - StealthX TODO auf browser-based IFR balance verification und 50% Stripe checkout discount umgestellt.
- `docs/TODO.html`
  - gleicher Status im HTML-TODO synchronisiert.

**Verifikation**

- `git diff --check` -> clean.
- Alte falsche Aussagen in den betroffenen Dateien geprueft:
  - keine Treffer mehr fuer `IFR Lock for premium calls`
  - keine Treffer mehr fuer `Premium unlock`
  - keine Treffer mehr fuer `lockedBalance(wallet) >= 1000`
  - keine Treffer mehr fuer `IFRLock gate`
- Aktuelle Aussagen vorhanden:
  - `IFR holder verification for 50% checkout discount`
  - `browser-based IFR balance verification -> 50% Stripe checkout discount`
  - `50% checkout discount for eligible IFR holders`

**Build/Test-Status**

- Docs-only Aenderung, kein Contract- oder Runtime-Code.
- Root-Build bleibt separat blockiert wie im GeckoTerminal-Eintrag dokumentiert:
  - Root `npm ci` scheitert weiter an nicht synchronem `package.json` / `package-lock.json`.
  - Root `npm run build` existiert nicht.

**Offene naechste Schritte**

- StealthX public pages ausserhalb dieses Repos auf Threshold-Konsistenz pruefen.
- Falls gewuenscht, StealthX/Chameleon spaeter per Governance in IFR `BuilderRegistry` registrieren.
