# PROJEKT INFERNO — VOLLSTÄNDIGE TODO-LISTE
Stand: 08.03.2026 | Konsolidiert (Claude + Core Dev)

---

## KRITISCH — 10.03.2026 ab 00:21 CET (Timelock)

1. Execute Proposal #1: `setFeeExempt(Vesting, true)`
   `PROPOSAL_ID=1 npx hardhat run scripts/execute-proposal.js --network mainnet`
2. Execute Proposal #2: `setFeeExempt(BurnReserve, true)`
   `PROPOSAL_ID=2 npx hardhat run scripts/execute-proposal.js --network mainnet`
3. Execute Proposal #3: `setFeeExempt(BootstrapVaultV3, true)` — ab 00:50 CET
   `PROPOSAL_ID=3 npx hardhat run scripts/execute-proposal.js --network mainnet`

## KRITISCH — Direkt nach Proposals

4. Treasury Safe → BootstrapVaultV3: **150M IFR** senden
   Gnosis Safe UI, Ziel: `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141`
5. Community Safe → BootstrapVaultV3: **50M IFR** senden (gleiche Zieladresse)
6. Verify on-chain: `vault.balanceOf() >= 200M IFR`
7. **Naechsten Governance Proposal Termin im Blick behalten — nicht verpassen!**

---

## HOCH — Bootstrap Ankuendigung (nach Funding verified)

1. X (@IFRtoken): Bootstrap live Tweet verfassen + posten
2. Juicebox: Projekt anlegen
3. Wiki `bootstrap.html`: Live-Status + Vault-Balance Banner aktivieren
4. Bootstrap Countdown Widget auf Landing Page aktivieren
5. Telegram Kanal & Chat auf Landing Page und Juicebox verlinken

## HOCH — Multisig + Governance

6. Multisig Upgrade: 1-of-2 → 2-of-4 (Treasury Safe + Community Safe)
7. Governance → GnosisSafe ubergeben
8. Sepolia Proposal #10: `setFeeExempt(BootstrapVaultV3 Sepolia)` executen — ETA 10.03. 00:38 CET

---

## MITTEL — Plan B Umstellung (Kohaerenz)

1. **Alle Seiten auf Plan B updaten** (Landing Page, Wiki, Live Tracker etc.) — aktuell viele Inkohaerenzen. Teilweise erledigt (Commits 861c33ab + 7e5a8eea + 879f4b55)
2. **`.md` Dateien bereinigen** — geloeste TODOs entfernen, auf Plan B angleichen
3. **Wallet-Eintraege im Live Tracker anpassen** + Berechnungen auf Plan B umstellen
4. **Plan B Dokumentation verfassen mit Zeitstempel der Entscheidung:**
   - Warum wurden zusaetzliche Token gesperrt?
   - Nur 10M IFR fuer 9 Monate fuer Devs → bewusste Selbstbeschraenkung als Trust-Signal
   - Platzierung: README / Wiki / Landing Page (noch festlegen)
5. ✅ ERLEDIGT (10.03.2026): Bootstrap auf Plan B umgestellt. Siehe CHANGELOG.md.
6. ✅ ERLEDIGT (10.03.2026): Plan A Texte bereinigt in BOOTSTRAP_VAULT_SPEC.md + DEPLOYMENTS.md.
7. `docs/index.html:1987` — Live Tracker JS: bootstrap Adresse noch V1 (`0xA820`), muss V3 werden (`0xf72565...e141`)
8. `docs/wiki/deployment.html:499` — Mainnet-Tabelle zeigt alte V1 BootstrapVault Adresse (`0xA820`), muss V3 werden
9. `scripts/propose-bootstrap-feeexempt.js:16` — Script hardcoded alte V1 Adresse, updaten oder DEPRECATED markieren
10. `docs/wiki/security.html:1128` — "TODOs vor Mainnet" Abschnitt ist veraltet (Mainnet seit 05.03.2026 deployed)
11. `SKYWALKER.md` — Mehrere alte V1 Referenzen (Zeile 34, 364) + veraltete Projekt-Infos (Sepolia-Stand statt Mainnet)

## MITTEL — Listing + Sichtbarkeit

12. CoinGecko Listing beantragen
13. CoinMarketCap Listing beantragen
14. Token Logo: 256x256 PNG transparent (fuer CG/CMC)
15. OG-Image: 1200x630 fuer Social Sharing
16. **Logo spiegelverkehrt (horizontal) generieren** → fuer Landing Page

## MITTEL — WalletConnect + Copilot Gate

17. **WalletConnect in Landing Page einbauen**
18. WalletConnect Phase 1: Basic Connect + Adresse anzeigen
19. WalletConnect Phase 2: `isLocked(wallet, 1000e9)` Check → Copilot Gate
20. AI Copilot Gate: >=1000 IFR locked → Premium Zugang
21. **AI Copilot Update** — Plan B Bootstrap info geupdated (Commit 879f4b55, Railway deployed)
22. Uniswap Link aktivieren — NUR wenn LP live

## MITTEL — Infrastruktur

23. Repo-Maintainer rekrutieren (2-3 Personen)
24. Eigene Domain (weg von GitHub Pages)
25. Multisig Policy Wiki-Seite erstellen
26. Project Continuity Sektion in Landing + README + Wiki
27. "Protection Shield" Statement einbauen

---

## NIEDRIG — Frontend Fixes & Styling

1. **Bug: INFERNO "I" auf Mobile/Tablet verschoben**
   - Erstes Zeichen "I" steht initial zu weit links (Portrait-Modus)
   - Workaround: Drehen & zurueck → positioniert sich korrekt
   - Vermutlich: CSS-Reflow-Problem beim ersten Render (Pulsar-Interaktion)
   - Reproduzieren & fixen (mobile + tablet, Portrait-Modus)

2. **Bug: Silber/Gas-Aufflackern INFERNO startet zu spaet**
   - Animation-Delay nach Seitenlade reduzieren → frueher starten lassen

3. **Subtitle anpassen:**
   - Neu: **`$IFR`** *(rot, fett)* `The Deflationary Utility Token`
   - Darunter unveraendert: `Lock. Use. Benefit. Across Every Product.`

4. **"Read the Docs" / "Borrow" Button:**
   - Farbe: Transparent Rot
   - Effekt: Soft pulsierend (CSS Animation)
   - Ort: Landing Page

5. **FAQ / Name-Erklaerung einbauen:**
   > Warum "Inferno"? — Bei jeder Transaktion betreten die verbrannten Token (2,5%) buchstaeblich das Inferno – sie verschwinden fuer immer. Dieser Feuerprozess laeutert das Verbliebene: knapper, reiner, wertvoller. Anspielung auf Dantes Laeuterungsreise. Durch das Feuer wird $IFR mit jeder Transaktion gestaerkt.

## NIEDRIG — Telegram

6. **Telegram Bot Relay Bug fixen**
7. **Telegram Bot Simultanposting implementieren:**
   - Problem: Supergroup laesst sich nicht direkt mit Channel verknuepfen
   - Loesung: Bot postet Announcements simultan in Community (Supergroup) + Channel

## NIEDRIG — Dokumentation + Community

8. CHANGELOG.md: Plan B dokumentieren (eigener Commit)
9. Wiki-Inkonsistenzen fixen:
   - Security: 361 → 494 Tests
   - Roadmap: 6 → 5 Phasen
   - Testnet-Seite: falsche LiqRes-v2-Adresse
10. Vesting-Zeitplan Dokument erstellen (intern)
11. Transparency Page: Railway `burned` vs `burnBalance` Fix
12. `docs/wiki/testnet.html:479` + `ai-copilot/wiki-content.json` (testnet slug) — BootstrapVault Sepolia zeigt V1 (`0xE0E8`), sollte V3 (`0x16086d4f...`) zeigen oder beide listen
13. `docs/PROJECT-SUMMARY.md:29` — BootstrapVault Sepolia zeigt V1 Adresse, sollte V3 sein
14. `docs/WHITEPAPER_EN.md` — Traegt DEPRECATED Header, kann entfernt oder archiviert werden

## NIEDRIG — Audits & Tests

15. Weitere Security Audits durchfuehren
16. Testabdeckung erweitern / neue Tests schreiben

---

## PHASE 2/3 — Spaeter

1. LiqRes Withdrawal: ab 01.09.2026 — `setMaxWithdrawPerPeriod(200M)` Proposal
2. LP-Erweiterung aus LiqRes (Phase 2/3)
3. Creator Rewards / SDK (Phase 3)
4. DAO Upgrade (Phase 4)
5. Bug Bounty Programm (Phase 5)

---

## Wichtige Adressen

| Contract | Adresse |
|----------|---------|
| BootstrapVaultV3 Mainnet | `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` |
| BootstrapVaultV3 Sepolia | `0x16086d4f7F191047d8A4fFf2090126E12e865A7E` |
| BootstrapVault V1 (DEPRECATED) | `0xA820540936d18e1377C39dd9445E5b36F3F1261a` |
| Treasury Safe | `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` |
| Community Safe | `0xaC5687547B2B21d80F8fd345B51e608d476667C7` |
| LiquidityReserve (locked bis 01.09.2026) | `0xdc0309804803b3A105154f6073061E3185018f64` |

## Wichtige Termine

| Datum | Aktion |
|-------|--------|
| 10.03.2026 00:21 CET | Proposals #1 + #2 executen |
| 10.03.2026 00:50 CET | Proposal #3 executen |
| 10.03.2026 00:38 CET | Sepolia Proposal #10 executen |
| 10.03.2026 danach | Treasury + Community → BootstrapVaultV3 (200M IFR) |
| 01.09.2026 | LiqRes Lock-Ende — LP-Erweiterung moeglich |

---

**Gesamtuebersicht:**
KRITISCH: 7 | HOCH: 8 | MITTEL: 27 (+5 neu) | NIEDRIG: 16 (+3 neu) | Phase 2+: 5
