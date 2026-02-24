<p align="center">
  <img src="assets/ifr_logo.png" alt="Inferno $IFR" width="200" />
</p>

# Inferno – Projektstatus & Struktur

## Legende
- [x] erledigt — Code + Tests abgeschlossen, stabil
- [ ] offen — noch nicht implementiert oder in Arbeit

---

## Repository-Struktur

```
inferno/
├── contracts/
│   ├── token/InfernoToken.sol          [x] 76 LOC, 21 Tests
│   ├── liquidity/LiquidityReserve.sol  [x] 139 LOC, 28 Tests
│   ├── vesting/Vesting.sol             [x] 111 LOC, 7 Tests
│   ├── buyback/BuybackVault.sol        [x] 148 LOC, 9 Tests
│   ├── burnreserve/BurnReserve.sol     [x] 86 LOC, 21 Tests
│   ├── governance/Governance.sol       [x] 150 LOC, 36 Tests
│   ├── lock/IFRLock.sol               [x] 127 LOC, 29 Tests
│   ├── partner/PartnerVault.sol       [x] 491 LOC, 89 Tests
│   └── mocks/                          MockToken, MockRouter, MockInfernoToken
├── test/
│   ├── InfernoToken.test.js            [x] 258 LOC
│   ├── LiquidityReserve.test.js        [x] 283 LOC
│   ├── Vesting.test.js                 [x] 112 LOC
│   ├── BuybackVault.test.js            [x] 149 LOC
│   ├── BurnReserve.test.js             [x] 212 LOC
│   ├── Governance.test.js              [x] 320 LOC
│   ├── IFRLock.test.js                [x] 363 LOC
│   └── PartnerVault.test.js           [x] 480 LOC
├── scripts/
│   ├── deploy-testnet.js               [x] 232 LOC (9-Step CFLM Deploy)
│   ├── create-lp.js                    [x] 4-Step LP Pairing + Router Update
│   ├── test-transfer.js               [x] Live Fee-on-Transfer Verification
│   ├── sepolia-smoke-test.js          [x] Full Protocol Smoke Test (11 Checks)
│   ├── execute-proposal.js           [x] Governance Proposal Executor (Status/ETA/Execute/Verify)
│   ├── deploy-lock.js                [x] IFRLock Deploy + Governance Proposal
│   └── test-lock.js                  [x] IFRLock Live Test (Lock/Unlock/isLocked)
├── apps/
│   ├── dashboard/                      [x] React + Vite Frontend (Phase 1 + Phase 2)
│   ├── governance-dashboard/          [x] React + Vite + TS + Tailwind (Overview, Partners, Timelock, Calldata)
│   └── benefits-network/
│       ├── backend/                   [x] Express + Prisma + SQLite (8 Tests)
│       └── frontend/                  [x] Next.js 14 + Tailwind + wagmi v2 (PWA)
├── docs/
│   ├── DOCS.md                         Dieses Dokument
│   ├── FAIR-LAUNCH-MIGRATION.md        CFLM Migrationsplan
│   ├── WHITEPAPER.md                   Whitepaper (DE)
│   ├── WHITEPAPER_EN.md                Whitepaper (EN)
│   ├── CHANGELOG.md                    Aenderungsprotokoll
│   ├── KNOWN-ISSUES.md                 Bekannte Probleme
│   ├── SECURITY-AUDIT.md               Slither Audit Report
│   ├── DEPLOYMENTS.md                  Sepolia Contract-Adressen
│   ├── PATCH-GUIDELINES.md             Patch-Richtlinien
│   ├── PROJECT-SUMMARY.md             Projektzusammenfassung
│   └── wiki/                          [x] 8 HTML-Seiten (Contracts, Tokenomics, Lock, Governance, Security, Deploy, Integration)
├── STATUS-REPORT.md                    Vollstaendiger Statusbericht
└── README.md                           Projekt-Uebersicht
```

---

## Module

### 1. InfernoToken — [x] FERTIG
- **Pfad:** `contracts/token/InfernoToken.sol`
- **Tests:** 21 (InfernoToken.test.js)
- **Beschreibung:** ERC20 + ERC20Burnable + Ownable, 9 Decimals, 1B Supply
- **Features:** Fee-on-Transfer (2% Sender Burn, 0.5% Recipient Burn, 1% Pool Fee), Fee Exemption, Owner-Functions (setFeeRates, setFeeExempt, setPoolFeeReceiver), Max 5% Fee Cap

### 2. LiquidityReserve — [x] FERTIG
- **Pfad:** `contracts/liquidity/LiquidityReserve.sol`
- **Tests:** 28 (LiquidityReserve.test.js)
- **Beschreibung:** Strategic Reserve fuer 200M IFR
- **Features:** 6-Monats-Lock, gestaffelte Freigabe (50M pro Quartal), Perioden-Tracking, Guardian Pause, Owner-Withdraw nach Lock

### 3. Vesting — [x] FERTIG
- **Pfad:** `contracts/vesting/Vesting.sol`
- **Tests:** 7 (Vesting.test.js)
- **Beschreibung:** Team Vesting fuer 150M IFR
- **Features:** Post-Cliff-Formel (12mo Cliff, 36mo linear), Guardian Pause, Beneficiary Release
- **Formel:** `(totalAllocation * (elapsed - cliff)) / (duration - cliff)`

### 4. BuybackVault — [x] FERTIG
- **Pfad:** `contracts/buyback/BuybackVault.sol`
- **Tests:** 9 (BuybackVault.test.js)
- **Beschreibung:** ETH-zu-IFR Buyback mit automatischem Split
- **Features:** 50/50 Split (BurnReserve + Treasury), Cooldown (1h), Slippage Protection (5%), 60-Tage-Aktivierungssperre, Guardian Pause

### 5. BurnReserve — [x] FERTIG
- **Pfad:** `contracts/burnreserve/BurnReserve.sol`
- **Tests:** 21 (BurnReserve.test.js)
- **Beschreibung:** Permanentes Token-Burning mit Tracking
- **Features:** deposit(), burn(), burnAll(), totalBurned-Zaehler, ERC20Burnable (totalSupply sinkt), Owner + Guardian Auth

### 6. Governance — [x] FERTIG
- **Pfad:** `contracts/governance/Governance.sol`
- **Tests:** 36 (Governance.test.js)
- **Beschreibung:** Timelock Governor fuer alle Protokoll-Parameter
- **Features:** propose/execute/cancel, Delay 1h–30d (default 48h), Guardian Emergency Cancel, Self-Governance (setDelay via eigenen Timelock), Integration mit InfernoToken (transferOwnership)

### 7. IFRLock — [x] FERTIG
- **Pfad:** `contracts/lock/IFRLock.sol`
- **Tests:** 29 (IFRLock.test.js)
- **Beschreibung:** Generic IFR Token Lock ohne Rewards/Vesting
- **Features:** lock(amount), lockWithType(amount, lockType), unlock(), isLocked(user, minAmount), lockInfo(), ReentrancyGuard, Emergency Pause (nur lock), Guardian Auth, Multi-App lockType Tag

### 8. PartnerVault — [x] FERTIG
- **Pfad:** `contracts/partner/PartnerVault.sol`
- **Tests:** 89 (PartnerVault.test.js)
- **Beschreibung:** Partner Ecosystem Pool (40M IFR) mit Milestone-Unlocking + Lock-triggered Creator Rewards
- **Features:** createPartner, activatePartner, recordMilestone, recordLockReward (lockAmount × effectiveBps, wallet), claim (linear Vesting mit Cliff), finalizeMilestones, SafeERC20, ReentrancyGuard, Pausable, Guardian Auth, Governance-kontrollierte Parameter (rewardBps 5-25%, annualEmissionCap, partnerCap) mit min/max Bounds, Annual Cap Reset, authorizedCaller Whitelist, Anti-Double-Count (wallet→partner), Algo Emission Throttle (lockRatio-basierte BPS-Skalierung via IIFRLock)
- **Sepolia:** rewardBps=1500 (15%), annualCap=4M IFR, Adresse: `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`
- **Mainnet-Empfehlung:** rewardBps=1000 (10%), annualCap=4M IFR, partnerCap=100K IFR/Partner (skalierbar fuer 500-1000+ Partner)
- **KRITISCH:** feeExempt MUSS VOR dem 40M Transfer gesetzt werden (Sepolia-Lesson: 1.4M IFR Fee-Verlust)

### Entfernt
- ~~Presale.sol~~ — Entfernt bei CFLM-Migration (kein Presale im Fair Launch Modell)

---

## Zusammenfassung

| Metrik | Wert |
|--------|------|
| Contracts | 9 (+ 3 Mocks) |
| Solidity LOC | 1,127 |
| Tests | 243 (alle bestanden) |
| Test LOC | 2,177 |
| Deploy Script | 232 LOC, 9 Steps |
| Modell | CFLM (Community Fair Launch) |
| Compiler | 0 Errors, 0 Warnings |

---

## Changelog

| Datum | Aenderung |
|-------|-----------|
| 2026-02-24 | Governance Dashboard: React 18 + Vite + TS + Tailwind (Overview, Partners, Timelock Queue, Calldata Generator) |
| 2026-02-23 | PartnerVault Upgrade: authorizedCaller Whitelist, Anti-Double-Count, Algo Emission Throttle (89 Tests) |
| 2026-02-23 | Benefits Network: Backend (Express + Prisma, 8 Tests) + Frontend (Next.js 14 PWA, wagmi v2) |
| 2026-02-23 | PartnerVault.sol implementiert (491 LOC, 89 Tests): Milestone-Unlocking + Lock-triggered Creator Rewards, SafeERC20, Governance-Parameter |
| 2026-02-23 | 6 Doku-Inkonsistenzen gefixt: PartnerVault, Creator Rewards, Bootstrap Pricing, Governance Trennung, alte Tier-Zahlen ersetzt |
| 2026-02-22 | Governance Proposal #1 executed: setFeeExempt(IFRLock, true) — Full Lock/Unlock Cycle verified (8/8) |
| 2026-02-20 | IFRLock Contract implementiert (127 LOC, 29 Tests): Generic Token Lock, ReentrancyGuard, Pause, Multi-App lockType |
| 2026-02-20 | Governance Proposal #0 executed: setFeeExempt via 48h Timelock — Full Governance Lifecycle verified |
| 2026-02-18 | Sepolia Smoke Test (11/11 PASS): Fee Transfer, Burn, Governance Proposal, Contract State |
| 2026-02-18 | Live Fee-on-Transfer Verification Script (test-transfer.js), ALL CHECKS PASSED |
| 2026-02-18 | Dashboard Phase 2: Vollstaendige Governance UI (Proposals, Create, Execute, Cancel) |
| 2026-02-16 | LP Pairing Script erstellt (create-lp.js), Router-Update integriert |
| 2026-02-15 | Slither Audit bestanden, 15 Fixes applied, Deploy Dry-Run erfolgreich |
| 2026-02-15 | Governance.sol implementiert (150 LOC, 36 Tests) |
| 2026-02-15 | CFLM-Migration: LiquidityReserve neu, Vesting-Formel fix, BuybackVault Activation Delay, Presale entfernt |
| 2026-02-15 | BurnReserve implementiert (86 LOC, 21 Tests) |
| 2026-02-15 | Statusbericht erstellt und aktualisiert |
| 2025-09-25 | Dokumentation ueberarbeitet |
| 2025-09-24 | BuybackVault implementiert |
| 2025-09-23 | Presale + Vesting implementiert |
| 2025-09-23 | InfernoToken implementiert |

---

## Deploy

### Vorbereitung

```bash
cp .env.example .env
# .env mit echten Werten fuellen (RPC URL, Private Key, Adressen)
```

### Dry-Run (lokal)

```bash
npx hardhat run scripts/deploy-testnet.js
```

### Testnet (Sepolia)

```bash
npx hardhat run scripts/deploy-testnet.js --network sepolia
```

### Deploy-Ablauf (9 Steps)

```
Step 1/9  InfernoToken deployen (1B IFR an Deployer)
Step 2/9  LiquidityReserve deployen (6mo Lock, 50M/Quartal)
Step 3/9  Vesting deployen (12mo Cliff, 36mo linear, 150M)
Step 4/9  BurnReserve + BuybackVault deployen (60d Aktivierung)
Step 5/9  (BurnReserve bereits in Step 4)
Step 6/9  Governance deployen (48h Timelock)
Step 7/9  feeExempt setzen (alle Contracts + Deployer temporaer)
Step 8/9  Tokens verteilen (200M+150M+150M+60M+40M, 400M bei Deployer)
Step 9/9  Deployer feeExempt entfernen
```

### LP Pairing (Uniswap V2)

```bash
npx hardhat run scripts/create-lp.js --network sepolia
```

### Post-Deploy Checklist

| # | Schritt | Status |
|---|---------|--------|
| 1 | Contracts deployen | **Erledigt** (8/8) |
| 2 | Etherscan verifizieren | **Erledigt** (7/7) |
| 3 | LP erstellen | **Erledigt** (`0x2252e8bBDE0E50CD372748aC233A99C08627d9c7`) |
| 4 | Ownership transferieren | **Erledigt** |
| 5 | Governance Proposal #0 ausfuehren | **Erledigt** (setFeeExempt via 48h Timelock) |

---

## Offene Punkte

| # | Aufgabe | Prioritaet | Status |
|---|---------|------------|--------|
| 1 | Testnet Deploy (Sepolia) | Naechster Schritt | **Erledigt** (8 Contracts live, PartnerVault pending) |
| 2 | Etherscan Verifikation | Nach Deploy | **Erledigt** (7/7 verified) |
| 3 | Security Audit (Slither) | Empfohlen | **Erledigt** (v0.11.5, 0 High/Critical) |
| 4 | Uniswap LP Pairing | Vor Launch | **Erledigt** (`0x2252e8bB...`) |
| 5 | Router/Adressen setzen | Vor Launch | **Erledigt** (Uniswap V2 Router02) |
| 6 | Ownership → Governance | Vor Launch | **Erledigt** |
| 7 | Dashboard Phase 2 (Governance UI) | Nach Deploy | **Erledigt** |
| 8 | Live Fee Verification (Sepolia) | Nach Deploy | **Erledigt** (ALL CHECKS PASSED) |
| 9 | Sepolia Smoke Test (Full Protocol) | Nach Deploy | **Erledigt** (11/11 PASS) |
| 10 | Governance Lifecycle (Proposal #0) | Nach Deploy | **Erledigt** (setFeeExempt via Timelock) |
| 11 | Governance Proposal #1 (IFRLock feeExempt) | Nach Deploy | **Erledigt** (8/8 Lock/Unlock Tests) |
| 12 | Gas-Optimierung | Optional | Offen |
| 13 | Doku-Inkonsistenzen (6 Tickets) | Hoch | **Erledigt** (PartnerVault, Creator Rewards, Bootstrap Pricing) |
