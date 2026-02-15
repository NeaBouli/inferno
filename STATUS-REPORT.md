# INFERNO ($IFR) — Vollstaendiger Projekt-Statusbericht

**Datum:** 2026-02-15
**Branch:** `main`
**Letzter Commit:** `753835c8` — feat: migrate to Community Fair Launch Model (CFLM)
**Modell:** Community Fair Launch (CFLM) — kein Presale

---

## Build & Tests

| Check | Status |
|-------|--------|
| `npx hardhat compile` | **PASS** — 0 Errors, 0 Warnings |
| `npx hardhat test` | **89/89 PASS** (16s) |
| Git | Clean — `main` synced mit `origin/main` |

---

## Contracts

| # | Contract | Datei | LOC | Beschreibung |
|---|----------|-------|-----|-------------|
| 1 | **InfernoToken** | `contracts/token/InfernoToken.sol` | 76 | ERC20 + ERC20Burnable + Ownable, 9 Decimals, Fee-on-Transfer |
| 2 | **LiquidityReserve** | `contracts/liquidity/LiquidityReserve.sol` | 139 | Strategic Reserve, 6mo Lock, gestaffelte Freigabe (50M/Quartal) |
| 3 | **BuybackVault** | `contracts/buyback/BuybackVault.sol` | 148 | ETH→IFR Buyback, Slippage, Cooldown, 60d Aktivierungssperre |
| 4 | **BurnReserve** | `contracts/burnreserve/BurnReserve.sol` | 86 | Permanent Burn, totalBurned Tracking, Owner+Guardian Auth |
| 5 | **Vesting** | `contracts/vesting/Vesting.sol` | 111 | Post-Cliff Linear Vesting (12mo Cliff, 36mo linear), Guardian Pause |

### Mocks (nur Tests)

| Contract | Datei | LOC | Zweck |
|----------|-------|-----|-------|
| MockToken | `contracts/mocks/MockToken.sol` | 16 | ERC20 fuer Tests |
| MockRouter | `contracts/mocks/MockRouter.sol` | 79 | Uniswap V2 Router Mock |
| MockInfernoToken | `contracts/mocks/MockInfernoToken.sol` | 14 | IFR Mock ohne Fees (9 Decimals) |

### Entfernt (CFLM-Migration)

| Contract | Grund |
|----------|-------|
| ~~Presale.sol~~ | Nicht kompatibel mit Fair Launch |

**Solidity gesamt: 669 LOC** | **Tests gesamt: 1,014 LOC** | **Deploy Script: 211 LOC**

---

## Token Economics

| Parameter | Wert |
|-----------|------|
| Name / Symbol | Inferno / IFR |
| Decimals | 9 |
| Total Supply | 1,000,000,000 IFR |
| Sender Burn | 2.0% (200 bps) |
| Recipient Burn | 0.5% (50 bps) |
| Pool Fee | 1.0% (100 bps) |
| Max Fee Cap | 5.0% (500 bps) |

### Token Distribution (CFLM)

| # | Empfaenger | Menge | Anteil | Mechanismus |
|---|------------|-------|--------|-------------|
| 1 | **DEX Liquidity** | 400,000,000 IFR | 40% | Deployer paired mit ETH auf Uniswap |
| 2 | **Liquidity Reserve** | 200,000,000 IFR | 20% | LiquidityReserve.sol (6mo Lock, 50M/Quartal) |
| 3 | **Team Vesting** | 150,000,000 IFR | 15% | Vesting.sol (12mo Cliff, 36mo linear) |
| 4 | **Treasury** | 150,000,000 IFR | 15% | Direkt an Multisig-Adresse |
| 5 | **Community/Ecosystem** | 100,000,000 IFR | 10% | Direkt an Community-Wallet |

---

## Contract-Funktionen

### InfernoToken

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(address _poolFeeReceiver)` | — | Mint 1B IFR an Deployer |
| `decimals()` | public view | Gibt 9 zurueck |
| `setFeeExempt(address, bool)` | external onlyOwner | Fee-Exemption setzen |
| `setPoolFeeReceiver(address)` | external onlyOwner | Pool-Fee-Empfaenger aendern |
| `setFeeRates(uint256, uint256, uint256)` | external onlyOwner | Fee-Raten aendern (max 5%) |
| `_update(from, to, value)` | internal override | Fee-on-Transfer Logik |
| `burn(uint256)` | public (ERC20Burnable) | Tokens verbrennen |

### LiquidityReserve (NEU)

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(token, lockDuration, maxPerPeriod, periodDuration, guardian)` | — | Initialisierung |
| `withdraw(address to, uint256 amount)` | external onlyOwner | Gestaffelte Entnahme nach Lock |
| `availableToWithdraw()` | external view | Aktuell entnehmbare Menge |
| `currentPeriod()` | public view | Aktuelle Perioden-Nummer |
| `pendingBalance()` | external view | Token-Bestand |
| `setMaxWithdrawPerPeriod(uint256)` | external onlyOwner | Perioden-Limit aendern |
| `setGuardian(address)` | external onlyOwner | Guardian aendern |
| `pause()` / `unpause()` | external onlyGuardian | Pausieren |

**Defaults:** lockEnd=deploy+180d, maxWithdrawPerPeriod=50M, periodDuration=90d

**Freigabe-Schema:**
```
Monat 0-6:   Gesperrt
Monat 6-9:   Periode 1 → max 50M IFR
Monat 9-12:  Periode 2 → max 50M IFR
Monat 12-15: Periode 3 → max 50M IFR
Monat 15-18: Periode 4 → max 50M IFR (200M komplett)
```

### BuybackVault (AKTUALISIERT)

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(token, burnReserve, treasury, router, guardian, activationDelay)` | — | Initialisierung mit Aktivierungssperre |
| `depositETH()` | external payable | ETH einzahlen + Quote speichern |
| `executeBuyback()` | external onlyOwner | ETH → IFR swappen (nach Aktivierung) |
| `setParams(burnBps, cooldown, slippage, router, treasury)` | external onlyOwner | Parameter aendern |
| `pause()` / `unpause()` | external onlyGuardian | Pausieren |

**Defaults:** burnShareBps=5000 (50%), cooldown=3600s, slippageBps=500 (5%), **activationDelay=60d**

### BurnReserve

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(address _token, address _guardian)` | — | Initialisierung |
| `deposit(uint256 amount)` | external | Tokens via transferFrom einzahlen |
| `burn(uint256 amount)` | external onlyOwnerOrGuardian | Bestimmte Menge verbrennen |
| `burnAll()` | external onlyOwnerOrGuardian | Gesamten Bestand verbrennen |
| `pendingBurn()` | external view | Tokens im Bestand anzeigen |
| `setGuardian(address)` | external onlyOwner | Guardian aendern |

### Vesting (AKTUALISIERT)

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(token, beneficiary, cliff, duration, allocation, guardian)` | — | Initialisierung |
| `release()` | external onlyBeneficiary | Geveste Tokens abheben |
| `releasableAmount()` | public view | Aktuell abholbare Menge |
| `vestedAmount()` | public view | Post-Cliff Linear: `(alloc * (elapsed-cliff)) / (duration-cliff)` |
| `vestingSchedule()` | external view | Start, Cliff, Duration |
| `pause()` / `unpause()` | external onlyGuardian | Pausieren |

**Vesting-Formel (Post-Cliff):**
```
Vor Cliff (0-12mo):  0% vested
Am Cliff (12mo):     0% verfuegbar (lineare Phase beginnt)
Nach Cliff:          linear ueber 36 Monate
Monat 24:            33.3% vested
Monat 36:            66.6% vested
Monat 48:            100% vested
```

---

## Test-Abdeckung

### InfernoToken.test.js (21 Tests)

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Deployment | 4 | Name, Symbol, Decimals, Supply, Fee-Defaults, PoolFeeReceiver |
| Fee-on-Transfer | 3 | Korrekte Abzuege (2% + 0.5% + 1%), transferFrom |
| Fee Exemption | 3 | Sender exempt, Recipient exempt, Beide nicht exempt |
| Owner Functions | 6 | setFeeExempt, setPoolFeeReceiver, setFeeRates + Reverts |
| Mint/Burn bypass | 1 | Minting ohne Fees |
| Edge Cases | 4 | 1 Unit Transfer, Zero Fees, Updated Rates |

### LiquidityReserve.test.js (28 Tests) — NEU

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Deployment | 5 | Params, Balance, Zero-Address Guards, lockDuration=0 |
| Lock period | 3 | Withdraw revert, available=0, period=0 |
| withdraw() | 10 | Period limit, Akkumulation, Reset, 4-Perioden-Full-Drain, Reverts |
| availableToWithdraw() | 3 | Full limit, nach Withdraw, bei Pause |
| Pause | 3 | Guardian Pause/Unpause, Non-Guardian revert |
| setMaxWithdrawPerPeriod() | 3 | Update + Event, Non-Owner, Zero |
| setGuardian() | 3 | Update + Event, Non-Owner, Zero Address |

### BuybackVault.test.js (9 Tests) — AKTUALISIERT

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Deposit | 1 | ETH-Deposit + Event |
| Buyback | 1 | 50/50 Split burn/treasury |
| Cooldown | 1 | Cooldown-Enforcement + Bypass nach 1h |
| Slippage | 1 | Revert bei Rate-Aenderung > 5% |
| Pause | 1 | Guardian Pause/Unpause |
| Params | 1 | Owner kann Parameter aendern |
| Activation (60d) | 3 | Revert vor Aktivierung, Pass danach, activationTime korrekt |

### BurnReserve.test.js (21 Tests)

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Deployment | 3 | Owner, Guardian, Token, Zero-Address Guards |
| deposit() | 3 | TransferFrom + Event, Zero Amount, No Approval |
| burn() | 6 | Owner/Guardian burn, totalSupply-Reduktion, Reverts, Akkumulation |
| burnAll() | 4 | Full Burn + Event, Guardian, Zero Balance, Unauthorized |
| pendingBurn() | 2 | Balance-Anzeige, Reduktion nach Burn |
| setGuardian() | 3 | Update + Event, Not Owner, Zero Address |

### Vesting.test.js (7 Tests) — AKTUALISIERT

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Cliff | 1 | Kein Release vor Cliff |
| Post-Cliff 0% | 1 | ~0% vested am Cliff-Ende (neue Formel) |
| Linear | 1 | Lineare Freigabe nach Cliff |
| 50% Midpoint | 1 | 50% vested an Halbzeit der linearen Phase |
| Full Release | 1 | 100% am Ende |
| Access Control | 1 | Nur Beneficiary |
| Pause | 1 | Guardian Pause/Unpause |

**Gesamt: 89 Tests, alle bestanden**

---

## Deploy Script (`scripts/deploy-testnet.js`) — CFLM

### Ablauf (8 Steps)

```
Step 1/8  Deploy InfernoToken (poolFeeReceiver = deployer)
Step 2/8  Deploy LiquidityReserve (6mo Lock, 50M/Quartal)
Step 3/8  Deploy Vesting (12mo Cliff, 36mo linear, 150M IFR)
Step 4/8  Deploy BurnReserve + BuybackVault (60d Aktivierung)
Step 5/8  (BurnReserve bereits in Step 4 deployt)
Step 6/8  Set feeExempt: Vesting, LiquidityReserve, Treasury, BuybackVault, BurnReserve, Deployer
Step 7/8  Distribute: 200M→Reserve, 150M→Vesting, 150M→Treasury, 100M→Community, 400M bleibt bei Deployer
Step 8/8  Remove Deployer feeExempt
```

### FeeExempt-Wiring (CFLM)

| Contract/Adresse | Exempt | Wiring |
|------------------|--------|--------|
| Vesting | Ja | — |
| LiquidityReserve | Ja | — |
| Treasury | Ja | — |
| BuybackVault | Ja | burnReserve → BurnReserve.address |
| BurnReserve | Ja | — |
| Deployer | **Ja → Nein** | Temporaer, wird in Step 8 entfernt |

### Umgebungsvariablen (.env)

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# Optional: Adressen (default = deployer als Placeholder)
TREASURY_ADDRESS=0x...
COMMUNITY_ADDRESS=0x...
TEAM_BENEFICIARY=0x...
```

---

## Tech Stack

| Komponente | Version |
|------------|---------|
| Solidity | 0.8.20 |
| Hardhat | ^2.x |
| ethers.js | ^5.x |
| OpenZeppelin Contracts | v5 |
| Chai | ^4.x |
| Waffle | @nomiclabs/hardhat-waffle |
| Netzwerk | Sepolia (konfiguriert) |

---

## Git History (relevante Commits)

```
753835c8 feat: migrate to Community Fair Launch Model (CFLM)
5e7be945 docs: add full project status report
b8220b2e feat: add BurnReserve to deploy script and wire into BuybackVault
16f9801e feat: implement BurnReserve contract with ERC20Burnable support
f79a43cb chore: lock dependencies (hardhat v2, chai v4, dotenv)
de88510b feat: add testnet deploy script with full contract setup
ff070c9e docs: update README with full contract overview and setup instructions
d3f8dd3d feat: implement Presale contract with TOKEN_PRICE for 9 decimals
8582a196 feat: implement InfernoToken with fee-on-transfer (9 decimals)
047fc0fa chore: remove node_modules from git tracking, add .gitignore rules
```

---

## Architektur-Fluss (CFLM)

```
    [Deployer] ──→ 1B IFR geminted
         |
         ├── 400M → DEX Liquidity (manuelles Pairing mit ETH)
         ├── 200M → [LiquidityReserve] (6mo Lock, 50M/Quartal)
         ├── 150M → [Vesting] (12mo Cliff, 36mo linear)
         ├── 150M → [Treasury Multisig]
         └── 100M → [Community Wallet]

    [BuybackVault] (aktiviert nach 60 Tagen)
         |
    ETH Einzahlung → DEX Swap → IFR
         |                         |
    50% → [BurnReserve]      50% → [Treasury]
         |
    burn() → totalSupply sinkt

    [InfernoToken] ──→ jeder Transfer:
       2.0% Sender Burn (totalSupply sinkt)
       0.5% Recipient Burn (totalSupply sinkt)
       1.0% Pool Fee → poolFeeReceiver
```

---

## Aenderungen gegenueber vorherigem Report

| Aenderung | Alt | Neu |
|-----------|-----|-----|
| Modell | Presale | **CFLM (Fair Launch)** |
| Presale.sol | Vorhanden (127 LOC, 24 Tests) | **Geloescht** |
| LiquidityReserve.sol | — | **Neu (139 LOC, 28 Tests)** |
| Vesting Formel | `(alloc * elapsed) / duration` | **`(alloc * (elapsed-cliff)) / (duration-cliff)`** |
| BuybackVault | Sofort aktiv | **60-Tage-Aktivierungssperre** |
| Token Distribution | 20% Presale, 10% Vesting, 70% Deployer | **40% DEX, 20% Reserve, 15% Team, 15% Treasury, 10% Community** |
| Deployer feeExempt | Dauerhaft | **Wird nach Distribution entfernt** |
| Tests | 78 | **89** |

---

## Offene Punkte / Next Steps

| # | Aufgabe | Prioritaet | Status |
|---|---------|------------|--------|
| 1 | 400M IFR + ETH auf Uniswap pairen (LP erstellen) | Vor Launch | Offen |
| 2 | Uniswap Router auf BuybackVault setzen (`setParams()`) | Vor Launch | Offen |
| 3 | Treasury Multisig Adresse setzen | Vor Launch | Offen |
| 4 | Community Wallet Adresse setzen | Vor Launch | Offen |
| 5 | Team Beneficiary Adresse fuer Vesting setzen | Vor Launch | Offen |
| 6 | Contracts auf Etherscan verifizieren | Nach Deploy | Offen |
| 7 | Security Audit (Slither/MythX) | Empfohlen | Offen |
| 8 | Governance Contract implementieren | Phase 2 | Offen |
| 9 | Gas-Optimierung pruefen | Optional | Offen |

---

## Dokumentation

| Datei | Beschreibung |
|-------|-------------|
| `README.md` | Projekt-Uebersicht, Setup, Architektur |
| `STATUS-REPORT.md` | Dieses Dokument |
| `docs/FAIR-LAUNCH-MIGRATION.md` | CFLM Migrationsplan und Architektur-Analyse |
| `.env.example` | Umgebungsvariablen-Template |

---

## Fazit

Alle 5 Hauptcontracts sind **vollstaendig implementiert, kompiliert und getestet**. Die Migration von Presale zu CFLM ist abgeschlossen. 89 Tests bestehen fehlerfrei. Das Deploy Script verteilt den Supply gemaess der CFLM-Allokation (40/20/15/15/10) mit vollstaendiger feeExempt-Konfiguration und automatischer Deployer-Exemption-Entfernung. Das Projekt ist **testnet-ready**.
