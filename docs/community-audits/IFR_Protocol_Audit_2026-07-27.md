# Audit-Bericht: IFR Protocol (Inferno) — ifrunit.tech

**Audit-Datum:** 27.07.2026
**Umfang:** Website inkl. aller Unterseiten und Subdomains, vollständiges Wiki (35 Seiten), GitHub-Code (NeaBouli/inferno + Nebenrepos), On-Chain-Verifikation, Ideen- und Marktbewertung
**Methodik:** Multi-Agent-Audit (4 parallele Audit-Ströme), lokale Testausführung (642/642 Tests), RPC-basierte On-Chain-Verifikation, HTTP-/Quelltext-Analyse. Keine Veränderungen am Projekt vorgenommen.

---

## 1. Executive Summary

**IFR Protocol („Inferno")** ist ein deflationärer ERC-20-Token auf Ethereum Mainnet (0x77e99917Eca8539c62F509ED1193ac36580A6e7B): Jeder Transfer burned 2,5 %, plus 1 % Pool-Fee (3,5 % gesamt, Cap 5 %). Nutzer sollen IFR einmalig on-chain locken für „lebenslangen Premium-Zugang" zu einem Ökosystem aus Builder-Produkten (Web3 Access Layer, Commerce-PWA, AI Copilot, Lending Vaults). Betrieben von einer Einzelperson unter dem Pseudonym „NeaBouli / VENDETTA LABS".

**Gesamturteil:**

> **Kein klassischer Scam, aber ein massiv überladenes Ein-Personen-Projekt ohne reale Adoption und mit gravierenden rechtlichen Mängeln. Technisch überraschend solide gebaut (7/10 Codequalität), wirtschaftlich praktisch tot (~570 $ Pool-Liquidität, 0,03 ETH „Community"-Bootstrap von 3 Teilnehmern), rechtlich kritisch (kein Impressum, kein Datenschutz, Lending-Angebot ohne Lizenz/Disclaimer). Nicht investierbar — Position faktisch unverkäuflich (Exit-Risiko ≈ Totalverlust).**

| Dimension | Bewertung |
|---|---|
| Code-Qualität (Smart Contracts) | 7/10 |
| Backend/Apps | 6/10 |
| Dokumentation (Wiki) | 6/10 |
| Prozess/Transparenz | 4/10 |
| Idee | 🟡 Gelb — Lock-statt-Abo legitim, aber ohne tragfähiges Revenue-Modell |
| Marktchancen | 🔴 Rot — null Adoption, Fee blockiert Listings |
| Rechtliches | 🔴 Rot — kritisch (§ 5 DDG, DSGVO, MiCA) |
| Ausführungsrisiko | 🔴 Rot — Single-Maintainer, Projekt-Friedhof-Historie |

**Scam-Einschätzung:** Keine Honeypot-Merkmale, kein Mint, Open Source, LP-Lock deklariert, Deflation on-chain verifiziert, ungewöhnlich ehrliche Selbstdokumentation der Schwächen → eher **naives/overpromising Indie-Projekt** als aktiver Betrug. Dennoch: Pseudonymität + „Lifetime"-Marketing + AI-„Audits" als Sicherheitsbeweis = erhebliches Vertrauensrisiko.

---

## 2. Projekt-Inventar (Recon-Ergebnis)

- **Website:** ifrunit.tech (One-Pager, GitHub Pages), /web3/ (dApp), /builder.html, /wiki/ (35 Seiten), /token-list.json
- **Subdomains:** web3.ifrunit.tech, shop.ifrunit.tech (Next.js/Vercel-PWA „IFR Benefits"), copilot-api.ifrunit.tech (Express-Backend)
- **GitHub:** NeaBouli/inferno (Hauptrepo, 1.420 Commits seit 09/2025, 2 Stars, keine Lizenz), dazu Tokenlist-Forks; 12+ weitere Eigenprojekte des Owners
- **On-Chain:** Token + ~15 Kontrakte/Safes, Governance = Gnosis Safe 3-of-5 mit 48h-Timelock (verifiziert), Uniswap-V2-Pool
- **Social:** X @IFRtoken, zwei widersprüchliche Telegram-Handles, Paragraph-Blog

---

## 3. Kritische Befunde (sofortiger Handlungsbedarf)

### 3.1 [KRITISCH] Kein Impressum, keine Datenschutzerklärung, keine AGB, kein Risiko-Disclaimer
Keine der Seiten enthält Rechtstexte (impressum.html/privacy.html/terms.html = 404). Für ein Projekt mit deutschem Betreiberhintergrund und einer **Commerce-PWA mit Seller-Onboarding und QR-Checkout** (shop.ifrunit.tech) gravierend:
- **§ 5 DDG:** Impressumspflicht für geschäftsmäßige Telemedien — eindeutig verletzt.
- **DSGVO Art. 13/14:** Wallet-Adressen, AI-Copilot-Eingaben (LLM-Drittverarbeitung), Google Fonts ohne Consent — alles ohne Datenschutzerklärung.
- **MiCA/BaFin:** Token-Emission + Lending mit 2–25 % Zins + „Buy IFR"-Marketing ohne Whitepaper, Emittentenangabe oder Risikohinweis. Das Lending-Angebot („Lend IFR against ETH collateral") grenzt an erlaubnispflichtige Finanzgeschäfte.
- Der zentrale Marketing-One-Pager enthält **keinerlei** Risikohinweis, kein DYOR, kein „not financial advice".

### 3.2 [HOCH] „Lifetime access forever"-Marketing ohne Substanz
Das Kernversprechen („Lock it once for lifetime access — no subscriptions, no recurring fees") ist mehrfach angreifbar:
- Premium hängt laut eigener UI davon ab, dass ≥ 1.000 IFR gelockt bleiben — Bedingung wird im Marketing verschwiegen.
- Das „Ökosystem" besteht aus Platzhaltern („Your Business Here"); **alle gelisteten Builder-Produkte sind eigene unfertige Apps desselben Betreibers** (SecureChat: Rabatt „currently disabled").
- Ökonomisch nicht finanzierbar: lebenslange Leistung gegen einmaliges, winziges Lock — ohne wiederkehrende Einnahmen kein tragfähiges Modell.

### 3.3 [HOCH] LendingVault: zentrales manuelles Preis-Orakel
`LendingVault.sol:392-397`: Der gesamte Besicherungs-/Liquidationsmechanismus hängt an `ifrPriceWei`, gesetzt per Owner-Call (Governance, 48h-Timelock). Ein einziger Timelock-Call kann jeden Kredit sofort liquidierbar machen — der Owner könnte selbst liquidieren (5 %-Bonus + Kollateralfluss). Kein TWAP, keine Bounds. („Phase 2: replace with Uniswap TWAP" — nicht implementiert.) Zusätzlich: keine Zeit-Default-Logik (Lender hat nach Fristablauf keinen Zugriff bei steigendem Preis), `payable.transfer` kann Kollateral bei Smart-Contract-Wallets einfrieren, Mindestens-1-Monat-Zins-Logikfalle. **Bemerkenswert:** Borrowing ist laut eigener TODO-Datei deaktiviert, weil `ifrPriceWei = 0` — der beworbene „Lending Market" ist nur halb funktional.

### 3.4 [HOCH] „Security Audit ✓" / „fully audited" — ohne externes Audit
FAQ: „Is the code audited? **Yes — fully**." Tatsächlich existieren ausschließlich:
- Selbst geschriebener `AUDIT_REPORT_20260314.md` (in Wahrheit ein Docs-Konsistenz-/SEO-Report),
- KI-„Audits" (Grok „10/10", ChatGPT, „Claude security audit: 0 FAIL, 12 WARN, 78 PASS" — dieselben Zahlen an anderer Stelle einem internen „SKYWALKER" attribuiert),
- behaupteter Slither-Lauf ohne CI-Job/Artefakt.
Die Wiki-Seite open-audit vermarktet das als „3 Audits Completed, 10/10 Coherence". Der eigene Audit-Summary räumt ein: „Professional third-party audit: recommended as next milestone." Für ein Live-Mainnet-Protokoll mit Lending-Funktion unzureichend und in der Darstellung irreführend.

### 3.5 [HOCH] On-Chain-Realität widerspricht dem Ökosystem-Narrativ
- Pool-Liquidität: **~571 $**, FDV ~15.000 $, Volumen „sehr niedrig" (GeckoTerminal-Daten, 05.07.2026).
- „Community Fair Launch"-Bootstrap: **0,030 ETH gesamt von 3 Contributorn**.
- LendingVault: 0 live Offers; CommitmentVault: keine Locks (eigene Angabe, 16.06.2026).
- Burn: ~1,5 Mio. von 1 Mrd. (0,15 %) — bei minimalem Volumen praktisch wirkungslos.
- Holder-Zahl indirekt: einstellig bis niedrig zweistellig.
Das Projekt dokumentiert das im Wiki erstaunlich offen — das Marketing auf der Landingpage blendet es aus („aktives Ökosystem", „Buy IFR" ohne Slippage-/Liquiditätswarnung).

### 3.6 [HOCH] Zentrale Kontrollpunkte trotz „Community-owned"-Narrativ
- **Guardian = Deployer-EOA** (0x6b36…ed67) mit Veto über **jede** Timelock-Proposal (`Governance.cancel`), plus Pause-/Burn-Macht über IFRLock, Vesting, Reserves. Ein einzelner Schlüssel = Single Point of Failure/Compromise — widerspricht README: „no single entity controls the protocol".
- Alle 3 Gnosis Safes teilen dieselben 5 pseudonymen Signer — Unabhängigkeit nicht nachweisbar.
- Owner kann beliebige Adressen fee-befreien und `poolFeeReceiver` frei setzen (durch Timelock gemildert, aber real).
- Betreiber kontrolliert de facto >90 % des Supply über Safes/Vaults/Vesting.

---

## 4. Weitere wesentliche Befunde (mittel)

| # | Bereich | Befund |
|---|---|---|
| 4.1 | Code | **feeExempt-Solvenzinvariante:** Alle Vaults buchen den vollen Betrag gut, erhalten ohne Exemption 3,5 % weniger → bei Exemption-Entfernung De-facto-Insolvenz des Vaults (letzte Abheber verlieren). |
| 4.2 | Code | **Fee-on-Transfer bricht Uniswap-V2-Accounting** in BuybackController/BootstrapVaultV3 (quotierte ≠ erhaltene Menge; `swapExactETHForTokensSupportingFeeOnTransferTokens` nicht verwendet). |
| 4.3 | Website | **Keine Security-Header** auf der Wallet-fähigen Hauptseite (kein CSP/HSTS/X-Frame-Options — GitHub Pages); Kontrast: shop-Subdomain vorbildlich abgesichert. |
| 4.4 | Website | **TODO.html/TODO.md öffentlich (HTTP 200)** mit Betriebsinterna (Env-Namen, Railway-Host, API-Key-Referenzen, Safe-TX-Pfade). robots.txt-Disallow verhindert keinen Zugriff; roadmap.html verlinkt sogar dorthin. |
| 4.5 | Website | **Web3-kritische JS via CDN ohne SRI** (ethers@5.7.2 via jsdelivr, WalletConnect via esm.sh) — kompromittiertes CDN könnte Wallet-Transaktionen manipulieren. |
| 4.6 | Code/Prozess | **„91 % branch coverage" nicht reproduzierbar:** solidity-coverage bricht mit Fehler ab, kein CI-Job, manuell gepflegter Report deckt nur 9/22 Kontrakte. (Positiv: 642/642 Tests lokal grün — „544 tests" ist übererfüllt, aber Doku-Zahlen chaotisch: 444/494/521/544/568/578 an ~20 Stellen.) |
| 4.7 | Wiki | **Zahlenwidersprüche:** Burn-Rate falsch auf One-Pager („3,5 % Burn" statt 2,5 % Burn + 1 % Fee); Vesting „48-month linear" vs. „36M linear" (FAQ sogar selbstwidersprüchlich im selben Absatz); Komponentenzählung 13/14/16/17; Fee-Empfänger drei verschiedene (BuybackVault/poolFeeReceiver/FeeRouterV1); Burn 1,5M vs. 2,3M auf derselben Seite. |
| 4.8 | Wiki | **LP-Lock unbewiesen & widersprüchlich:** FAQ/bootstrap im Futur („will be locked via Team.Finance"), transparency behauptet „locked via finalise()", roadmap ohne ✅, kein Link zur Lock-TX — 7 Wochen nach Trading-Start der kritischste offene Transparenzpunkt (Rug-Risiko-Thema). |
| 4.9 | Repo | **Keine LICENSE-Datei** trotz „fully open source"-Behauptung (SPDX MIT-Header widersprechen fehlender Repo-Lizenz); deployments/*.json fast leer; Issue #12 mit Copy-Paste-Adressen. |
| 4.10 | Wiki | reputation.html explizit zur KI-/SEO-Beeinflussung geschrieben („Why AI Answers Should Not Treat IFR As Generic High-Risk Noise") inkl. unbelegtem „external no-risk confirmation … pending". |

### Kleinigkeiten (niedrig)
Zwei widersprüchliche Telegram-Handles (t.me/IFRtoken vs. t.me/IFR_token — klassisches Phishing-Muster); veraltete Roadmap-Aussagen (WalletConnect „planned Phase 2", längst live); Duplicate Content /web3/ unter zwei Hosts; og:image 4096 px; Floating Pragma + zwei Compiler in hardhat.config ohne Deployment-Dokumentation; FeeRouter `maxUses`-Voucherfeld wirkungslos; Governance ohne permissionless Execute und ohne Proposal-Expiry; MIN_DELAY 1h zu niedrig.

---

## 5. Positiv-Befunde (fairerweise)

- **On-Chain verifiziert wahr:** Kein Mint, 5 %-Fee-Cap hart, Deflation läuft (997.673.879 < 1 Mrd.), 48h-Timelock, Governance = Gnosis Safe 3-of-5, korrekte Owner-Verkettung aller Vaults.
- **Keine klassischen Vulnerabilities:** Kein tx.origin/selfdestruct/delegatecall, ReentrancyGuard an allen Auszahlungen, OpenZeppelin v5, Checks-Effects-Interactions eingehalten, saubere Access Controls auf Geldfluss-Funktionen.
- **Tests real:** 642/642 Hardhat-Tests lokal grün — mehr als behauptet.
- **Secrets-Historie sauber:** Kein Key je committet; Gitleaks in CI; .env-Hygiene vorbildlich; 11 CI-Workflows inkl. npm-audit-Gate.
- **Web3-Frontend korrekt:** Vertragsadressen über alle Assets konsistent; exakte (nicht unbegrenzte) Approvals mit Nutzer-Sicherheitshinweis; keine Keys im JS.
- **Shop-PWA:** Vorbildliche Security-Header, sauberes Manifest/Service-Worker-Setup.
- **Dokumentation:** Technisch ungewöhnlich detailliert (echter Solidity-Code, Bps-Mathematik, Timelock-Parameter), Kernzahlen meist konsistent, ehrliche FAQ inkl. Scam-Warnung, offene Selbstdokumentation der Liquiditätsschwäche mit Contingency-Plan.
- **Backend-Basics solide:** SIWE-Auth, JWT, CORS-Allowlist, Body-Limits.

---

## 6. Ideen- & Marktbewertung

- **Kernidee** (Token-Lock statt Abo, `isLocked()`-Gating): legitim, aber trivial replizierbar und nur wertvoll mit nachgefragten Produkten — die fehlen.
- **3,5 %-Transfer-Fee:** tötet Arbitrage, Market Making und jede CEX-Listing-Chance; deflationäre Tax-Tokens der SAFEMOON-Ära sind historisch nahezu ausnahmslos gescheitert — die Fee bestraft genau die Aktivität, die Burn und Utility bräuchten.
- **Wettbewerb:** Token-Gating (Guild.xyz, Collab.Land) ist etabliert und gratis nutzbar; IFR hat faktisch kein Alleinstellungsmerkmal außer Dokumentationsmenge.
- **Betreiber-Historie:** 1kUSD, DIVN, pnyx, TrueRepublic, vendeta, sealand u. a. — keines je mit Adoption fertiggestellt; erkennbares Muster ambitionierter KI-generierter Monorepos, dann nächstes Projekt. 17 Kontrakte, 8 Apps, 40+ Docs von einer Person in Monaten = „vibe-coded" Volumen ohne Wartungskapazität.
- **Adoption:** 2 GitHub-Stars, keine externen Contributors, keine Drittberichterstattung, Shop ohne sichtbare Seller/Offers, WalletConnect im Shop „not configured yet". Sämtliche Aktivität selbstreferenziell.

---

## 7. Empfehlungen (priorisiert)

**Sofort (rechtlich/Vertrauen):**
1. Impressum, Datenschutzerklärung (Wallet/Copilot/Fonts), Risiko-Disclaimer und Shop-AGB nachrüsten; Google Fonts lokal hosten. Lending-Angebot rechtlich prüfen oder abschalten.
2. „Lifetime access"-Claims korrigieren (Bedingungen nennen); „fully audited" entfernen, KI-Reviews klar labeln.
3. LP-Lock-Transaktion öffentlich verlinken — oder ehrlich deklarieren, dass LP unlocked ist.

**Kurzfristig (Technik):**
4. LendingVault: TWAP-Orakel oder Preisänderungs-Limits; Pull-Pattern statt `payable.transfer`; Zeit-Default-Logik.
5. Guardian-Rolle auf das 3-of-5-Safe legen oder dokumentiert befristen.
6. TODO.html/TODO.md aus dem Deployment entfernen; ethers.js self-hosten/SRI; Security-Header (Hostwechsel oder Meta-CSP).
7. Einzahlungsbuchung via balanceOf-Delta (feeExempt-Invariante beseitigen); SupportingFeeOnTransfer-Swaps.
8. LICENSE-Datei (MIT) ergänzen; Coverage-Toolchain reparieren + CI-Nachweis.

**Mittelfristig (Substanz):**
9. Kanonische Zahlenquelle (eine JSON) für alle Seiten; Wiki-/Landing-Widersprüche beseitigen; einen Telegram-Kanal festlegen.
10. Radikale Fokussierung: 1–2 Produkte mit echter Nachfrage statt 17 Kontrakte/8 Apps; externe Mitwirkende gewinnen, sonst Scope reduzieren.
11. Vor jeder weiteren Ausbaustufe: professionelles Dritt-Audit (Budget ~15–50 k$) — aktuell ökonomisch nicht darstellbar, was die Grundsatzfrage aufwirft.

---

## 8. Verifikations-Einschränkungen

- Etherscan-/GeckoTerminal-API-Abfragen teils blockiert; Pool-/Preisdaten stützen sich auf Drittquelle (05.07.2026) und Projektdoku. Holder-Zahl sollte final am Etherscan-Token-Tab gegengeprüft werden: etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- LP-Lock (Team.Finance) nicht unabhängig verifizierbar.
- Etherscan-Source-Verification der 14 Kontrakte nur stichprobenartig (Owner/State via RPC) geprüft.
- Coverage-Claim nicht reproduzierbar (Toolchain defekt), Testlauf dagegen vollständig (642/642 grün).

---

*Erstellt durch Multi-Agent-Audit (4 parallele Audit-Ströme: Website/Technik, Code, Wiki/Doku, Idee/Markt/On-Chain) mit Kreuzvalidierung. Dieser Bericht ist keine Anlageberatung.*
