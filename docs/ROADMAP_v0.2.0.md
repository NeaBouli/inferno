# Roadmap v0.2.0 — Mainnet Ready

Stand: 26. Februar 2026

## Ziel

v0.2.0 ist der **Mainnet-Ready Release**. Alle Voraussetzungen fuer ein sicheres Mainnet-Deployment muessen erfuellt sein.

## Milestones

### M1: Security Audit (Prioritaet: Kritisch)

| # | Aufgabe | Status |
|---|---------|--------|
| 1 | Audit-Firma auswaehlen (Code4rena, Sherlock, Trail of Bits) | Offen |
| 2 | AUDIT_SUBMISSION.md einreichen (9 Contracts, 1697 SLOC) | Vorbereitet |
| 3 | Audit durchfuehren (7-14 Tage empfohlen) | Offen |
| 4 | Findings beheben + Re-Audit | Offen |
| 5 | Audit Report veroeffentlichen | Offen |

### M2: Multisig Setup (Prioritaet: Hoch)

| # | Aufgabe | Status |
|---|---------|--------|
| 1 | Gnosis Safe deployen (Mainnet, 2-of-3 initial) | Offen |
| 2 | Signer festlegen (3-5 initiale Signer) | Offen |
| 3 | Guardian Multisig (separates Safe) | Offen |
| 4 | Ownership Transfer: Governance admin → Multisig | Offen |
| 5 | Test-Transaktion via Multisig | Offen |

### M3: Adressen & Wallets (Prioritaet: Hoch)

| # | Aufgabe | Status |
|---|---------|--------|
| 1 | Treasury Wallet (Multisig) | Offen |
| 2 | Community & Grants Wallet | Offen |
| 3 | Team Vesting Beneficiary Adresse | Offen |
| 4 | Fee Collector Adresse (FeeRouterV1) | Offen |
| 5 | Voucher Signer Adresse (FeeRouterV1) | Offen |

### M4: Mainnet Deployment (Prioritaet: Hoch)

| # | Aufgabe | Status |
|---|---------|--------|
| 1 | hardhat.config.js: Mainnet Network hinzufuegen | Offen |
| 2 | Deploy: 9 Contracts (gleiche Reihenfolge wie Sepolia) | Offen |
| 3 | LP Pairing: IFR/ETH auf Uniswap V2 (Mainnet) | Offen |
| 4 | Etherscan Verify: alle 9 Contracts | Offen |
| 5 | feeExempt: alle Contracts + FeeRouterV1 setzen | Offen |
| 6 | Token Distribution: 200M+150M+150M+60M+40M | Offen |
| 7 | Deployer feeExempt entfernen | Offen |
| 8 | Ownership → Governance transferieren | Offen |
| 9 | LP Token Lock/Burn (→ 0xdead) | Offen |
| 10 | Smoke Test: onchain-audit.js auf Mainnet | Offen |

### M5: Post-Launch (Prioritaet: Mittel)

| # | Aufgabe | Status |
|---|---------|--------|
| 1 | Bug Bounty Programm starten (5% Treasury) | Offen |
| 2 | CoinGecko / CMC Listing beantragen | Offen |
| 3 | Partner Onboarding: Erste Partner-Integration | Offen |
| 4 | Dashboard: Mainnet Support hinzufuegen | Offen |
| 5 | DEPLOYMENTS.md: Mainnet Adressen eintragen | Offen |

## Timeline (geschaetzt)

| Phase | Dauer | Abhaengigkeit |
|-------|-------|---------------|
| M1: Audit | 2-4 Wochen | — |
| M2: Multisig | 1 Woche | — |
| M3: Adressen | 1 Woche | M2 |
| M4: Deploy | 1-2 Tage | M1, M2, M3 |
| M5: Post-Launch | laufend | M4 |

**Fruehester Mainnet-Launch:** ~4-6 Wochen nach Audit-Start

## Checkliste vor v0.2.0 Tag

- [ ] Audit Report vorhanden (0 Critical, 0 High ungefixt)
- [ ] Multisig live + getestet
- [ ] Alle Adressen finalisiert
- [ ] Mainnet Deploy erfolgreich
- [ ] LP gelockt/geburnt
- [ ] Ownership transferiert
- [ ] Smoke Test bestanden
- [ ] DEPLOYMENTS.md aktualisiert
- [ ] README.md aktualisiert
- [ ] Landing Page aktualisiert
- [ ] Bug Bounty aktiv

## Abgrenzung v0.2.0 vs v0.3.0+

**In v0.2.0:** Audit, Multisig, Deploy, LP Lock, Post-Launch Basics
**Nicht in v0.2.0:** DAO Governance, Multi-Chain, Oracle Integration, CEX Listing

---
*Inferno ($IFR) — Roadmap v0.2.0 | Februar 2026*
