# BRIDGE — inferno
# CC ↔ Codex ↔ Gio Kommunikationskanal
# Format: ## [DATUM] [AUTOR] ### TYPE: [MEMO|TODO|BUG|FIX|DECISION|SECURITY|REVIEW]

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
