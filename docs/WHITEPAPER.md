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

Fair Launch: Kein Presale, keine VC-Runden, keine Insider-Vorteile.

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
- 276 Unit Tests (alle bestehen)
- Third-party Audit: empfohlen vor Mainnet-Deployment
- Timelock: 48h Pflicht-Wartezeit auf alle Aenderungen
- Kein Minting: technisch unmoeglich nach Launch

---

## 9. Roadmap

| Phase | Status | Inhalt |
|-------|--------|--------|
| Phase 0 — Bootstrap | Aktiv | Sepolia Testnet, alle Contracts live |
| Phase 1 — Launch | Geplant | Mainnet, LP, erste Partner |
| Phase 2 — Multisig | Geplant | Governance zu Multisig |
| Phase 3 — Growth | Geplant | Ecosystem-Expansion, Benefits Network |
| Phase 4 — DAO | Langfristig | Community-Governance |

---

## 10. Fuer Partner: Warum IFR?

- Echte Nutzerbindung: Nutzer mit gesperrten Token wandern nicht ab
- Kein Subscription-Management: Lock on-chain, kein Backend noetig
- Token-Incentives: Partner erhalten IFR aus dem 40M Partner-Pool
- Einfache Integration: isLocked() — ein API-Call
- Datenschutz: Keine Wallet-Daten gespeichert
- Permissionless: Jeder kann integrieren

Interesse? → docs/PARTNER_INTEGRATION_SPEC.md

---

## 11. Kontakt & Links

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
