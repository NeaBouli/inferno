# Inferno ($IFR) — Project Whitepaper v1.0

## Executive Summary
IFR ist ein deflationaerer ERC-20 Utility Token auf Ethereum.
Kernidee: Nutzer sperren IFR-Token einmalig und erhalten dafuer
dauerhaften Premium-Zugang zu Partner-Produkten — keine Abonnements,
keine wiederkehrenden Zahlungen. Jeder Transfer verbrennt automatisch
2.5% der Tokens permanent. Das Angebot sinkt mit jeder Transaktion.

3 Saetze fuer jeden:
- Fuer Nutzer: Lock once, access forever.
- Fuer Partner: Acquire loyal users who have real skin in the game.
- Fuer das Protokoll: More utility = more locking = less supply = more scarcity.

---

## 1. Das Problem

Abonnement-Muedigkeit: Nutzer zahlen monatlich fuer Dutzende Services.
Churning: Plattformen verlieren Nutzer sobald Zahlungen ausbleiben.
Keine echte Bindung: Nutzer haben keinen wirtschaftlichen Anreiz zu bleiben.
Token ohne Nutzen: Die meisten Crypto-Token haben keine echte Verwendung.

---

## 2. Die Loesung: Lock-to-Access

Inferno fuehrt ein neues Zugriffsmodell ein:

Statt monatlich zu zahlen → einmalig IFR sperren (Lock).
Gesperrte Token bleiben Eigentum des Nutzers.
Solange gesperrt → automatischer Premium-Zugang zu allen Partner-Produkten.
Entsperren jederzeit moeglich → Zugang endet, Token zurueck.

Analogie: Wie eine Kaution. Du gibst das Geld nicht aus — du hinterlegst es.
Und solange die Kaution liegt, bist du drin.

---

## 3. Deflationaere Mechanik

Jeder IFR-Transfer verbrennt automatisch Token:
- 2.0% vom Sender verbrannt (permanent)
- 0.5% vom Empfaenger verbrannt (permanent)
- 1.0% ins Protokoll-Pool
- Gesamt: 3.5% pro Transfer, davon 2.5% echter permanenter Burn

Maximale Fee: 5% (im Smart Contract erzwungen, unveraenderbar)
Neues Minting: Unmoeglich (kein Mint im Contract)
Ergebnis: Das Angebot kann nur sinken, niemals steigen.

Beispiel:
Sendest du 10.000 IFR → Empfaenger erhaelt 9.650 IFR.
250 IFR sind fuer immer vernichtet. 100 IFR ins Pool.

### Kern-Prinzip: Lock > Transfer

Die Fee-Struktur ist bewusst so gestaltet, dass Halten und Sperren (Lock)
belohnt wird, waehrend haeufiges Transferieren bestraft wird:

- **Locken = 0% Fee**: IFRLock, LiquidityReserve, BuybackVault, BurnReserve
  und PartnerVault sind feeExempt. Lock/Unlock-Operationen kosten keine Fees.
- **Transferieren = 3.5% Fee**: Jeder normale Transfer verbrennt Token.
- **Ergebnis**: Wer IFR sperrt und haelt, verliert nichts. Wer staendig
  tradet, verliert bei jedem Transfer 3.5%.

### Fee-Exempt Adressen

| Contract | feeExempt | Warum |
|----------|-----------|-------|
| IFRLock | Ja | Lock/Unlock ohne Verlust |
| LiquidityReserve | Ja | Staged Release ohne Burn |
| BuybackVault | Ja | ETH→IFR Swap ohne Doppel-Burn |
| BurnReserve | Ja | Deposit ohne Zusatz-Burn |
| PartnerVault | Ja | Reward-Auszahlung ohne Verlust |
| FeeRouterV1 | Geplant | Fee-Routing ohne Komplikation |

### CEX-Kompatibilitaet

Fee-on-Transfer ist mit zentralen Boersen (CEX) kompatibel, erfordert aber
Anpassung: CEX muss den tatsaechlich empfangenen Betrag pruefen
(balanceOf nach Transfer), nicht den gesendeten Betrag.
Integration-Guide: docs/wiki/fee-design.html

---

## 4. Token-Oekonomie

Gesamtangebot: 1.000.000.000 IFR (1 Milliarde, einmalig, kein Minting)

| Kategorie | % | Menge | Zweck |
|-----------|---|-------|-------|
| DEX Liquidity | 40% | 400M | Handel & Liquiditaet |
| Liquidity Reserve | 20% | 200M | Gestaffelter Release (6 Monate Lock) |
| Team (Vested) | 15% | 150M | 48 Monate Vesting, 12 Monate Cliff |
| Treasury | 15% | 150M | Protokoll-Entwicklung |
| Community & Grants | 6% | 60M | Ecosystem-Aufbau |
| Partner Ecosystem | 4% | 40M | PartnerVault (Lock-triggered Rewards) |

### Community Fair Launch Model (CFLM)

Fair Launch: Kein Presale, keine VC-Runden, keine Insider-Vorteile.

Warum? Die meisten Token-Projekte verkaufen frueh an VCs und Insider —
die dann zum Launch sofort verkaufen (Dump). Inferno macht das Gegenteil:

- **Kein Presale**: Kein Token wurde vor dem oeffentlichen Launch verkauft
- **Kein Seed / Private Round**: Keine Sonder-Konditionen fuer Frueh-Investoren
- **Kein VC-Anteil**: Keine Venture Capital Firmen mit Vorzugs-Token
- **100% on-chain verteilt**: Alle Allocations sichtbar, alle Vesting-Perioden erzwungen durch Smart Contracts

Vergleich mit anderen Projekten:

| Projekt | Presale? | VC-Anteil | Community-Anteil |
|---------|----------|-----------|------------------|
| Uniswap (UNI) | Nein | 18% | 60% |
| Aave (AAVE) | Ja | 23% | 77% |
| Compound (COMP) | Ja | 24% | 42% |
| **Inferno (IFR)** | **Nein** | **0%** | **46% (40% DEX + 6% Grants)** |

Team-Token (15%) sind durch einen 4-Jahres-Vesting-Contract gesichert
mit 12 Monaten Cliff. Bis Januar 2027 kann kein einziger Team-Token
freigegeben werden. Verifizierbar:
https://sepolia.etherscan.io/address/0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B

---

## 5. Partner Ecosystem

### Wie Partner IFR verdienen
Wenn ein Nutzer IFR fuer das Produkt eines Partners sperrt:
1. Partner erhaelt automatisch einen Prozentsatz des gesperrten Betrags
2. Reward-Rate: 10–20% (Policy-Ziel), Hard-Bounds 5–25%
3. Rewards vesten linear ueber 6–12 Monate
4. Jaehrliches Emissions-Limit: 4M IFR (Bounds: 1–10M)

Warum deflationaer: Nutzer sperren immer mehr IFR als Partner erhalten.
Bei 15% Reward: 1.000 IFR gesperrt → 150 IFR Reward → netto 850 IFR mehr gebunden.

### IFR Benefits Network
Jedes Business (online oder offline) kann IFR-Lock als Zugangssystem nutzen:
- Haendler: kein Crypto-Wissen noetig, nur Browser
- Kunde: scannt QR → verbindet Wallet → signiert → fertig
- System prueft on-chain ob Kunde IFR gesperrt hat

Beispiel-Tiers (empfohlen, frei konfigurierbar):
- Bronze: 1.000 IFR gesperrt → 5% Rabatt
- Silver: 2.500 IFR → 10% Rabatt
- Gold: 5.000 IFR → 15% Rabatt
- Platinum: 10.000 IFR → 20% Rabatt

---

## 6. Governance

Wie Aenderungen am Protokoll funktionieren:
- Kein sofortiger Admin-Zugriff (niemand kann sofort etwas aendern)
- Jede Aenderung: 48-Stunden oeffentliche Wartezeit (Timelock)
- Guardian-Rolle kann jede Aenderung in den 48h stoppen
- Kein Token-Voting (Schutz vor Whale-Manipulation)

Upgrade-Pfad:
- Heute: Timelock-Governance (Single Admin, Testnet)
- Phase 2: Multisig (4-of-7 Gnosis Safe)
- Phase 4: DAO mit Community-Voting

---

## 7. Technische Architektur

3 Schichten, sauber getrennt:

**On-Chain (Truth Layer)**
IFRLock Contract auf Ethereum: speichert wer wie viel IFR gesperrt hat.
Einzige Wahrheitsquelle. Kein App-Wissen, keine User-IDs.

**Bridge Layer (Stateless)**
License Resolver: uebersetzt Wallet-Abfragen in Zugangs-Checks.
Datenschutz-neutral: keine personenbezogenen Daten gespeichert.

**Off-Chain (Partner Apps)**
Jede App entscheidet selbst welcher Lock-Betrag fuer Premium-Zugang gilt.
Integration: 5 Zeilen Code. Vollstaendig entkoppelt.

---

## 8. Sicherheit

- Open Source: Alle Smart Contracts oeffentlich auf GitHub
- Slither Static Analysis: 0 High/Critical Findings
- 330 Tests (276 Contract + 54 App), alle bestehen, 99% Statement Coverage
- Third-party Audit: empfohlen vor Mainnet-Deployment
- Timelock: 48h Pflicht-Wartezeit auf alle Aenderungen
- Kein Minting: technisch unmoeglich nach Launch

---

## 9. On-Chain Transparency (Stand: Februar 2026)

### Token Supply Verteilung (verifiziert)
- LP Pair: 400,000,000 IFR (40.08%)
- LiquidityReserve: 200,000,000 IFR (20.04%)
- Team Vesting: 150,000,000 IFR (15.03%) — 4 Jahre, 0 released
- Treasury/Community: 169,387,995 IFR (16.97%)
- PartnerVault: 40,000,000 IFR (4.01%)
- Verbrannt: 2,000,425+ IFR (0.20%+) — steigt mit jedem Transfer

### Deflation in Aktion
Seit Deployment wurden 2,000,425+ IFR permanent vernichtet.
Bei 276 automatisierten Tests wurden reale Transfers durchgeführt —
jeder davon hat die Deflationsmechanik on-chain bestätigt.

### Verifikation
Alle Werte sind über scripts/onchain-audit.js direkt prüfbar.
Kein Trust notwendig — nur Code und Chain.

---

## 10. Roadmap

| Phase | Status | Inhalt |
|-------|--------|--------|
| Phase 0 — Bootstrap | Aktiv | Sepolia Testnet, alle Contracts live |
| Phase 1 — Launch | Geplant | Mainnet, LP, erste Partner |
| Phase 2 — Multisig | Geplant | Governance zu Multisig |
| Phase 3 — Growth | Geplant | Ecosystem-Expansion, Benefits Network |
| Phase 4 — DAO | Langfristig | Community-Governance |

---

## 11. Fuer Partner: Warum IFR?

- Echte Nutzerbindung: Nutzer mit gesperrten Token wandern nicht ab
- Kein Subscription-Management: Lock on-chain, kein Backend noetig
- Token-Incentives: Partner erhalten IFR aus dem 40M Partner-Pool
- Einfache Integration: isLocked() — ein API-Call
- Datenschutz: Keine Wallet-Daten gespeichert
- Permissionless: Jeder kann integrieren

Interesse? → docs/PARTNER_INTEGRATION_SPEC.md

---

## 12. Kontakt & Links

| | |
|-|-|
| GitHub | https://github.com/NeaBouli/inferno |
| Website | https://neabouli.github.io/inferno/ |
| Docs | https://neabouli.github.io/inferno/wiki/ |
| X / Twitter | https://x.com/IFRtoken |
| Sepolia Token | 0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4 |
| Sepolia Governance | 0x6050b22E4EAF3f414d1155fBaF30B868E0107017 |

---
*Inferno ($IFR) — Community Fair Launch Model*
*Stand: Februar 2026 | Version 1.0 | Vertraulich — nur fuer Partner & Investoren*
