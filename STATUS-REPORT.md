# INFERNO ($IFR) — Vollständiger Projekt-Statusbericht

**Datum:** 2026-02-15
**Branch:** `main`
**Letzter Commit:** `b8220b2e` — feat: add BurnReserve to deploy script and wire into BuybackVault

---

## Build & Tests

| Check | Status |
|-------|--------|
| `npx hardhat compile` | **PASS** — 0 Errors, 0 Warnings |
| `npx hardhat test` | **78/78 PASS** |
| Git | Clean — `main` synced mit `origin/main` |

---

## Contracts

| # | Contract | Datei | LOC | Beschreibung |
|---|----------|-------|-----|-------------|
| 1 | **InfernoToken** | `contracts/token/InfernoToken.sol` | 76 | ERC20 + ERC20Burnable + Ownable, 9 Decimals, Fee-on-Transfer |
| 2 | **Presale** | `contracts/presale/Presale.sol` | 127 | TOKEN_PRICE mit 9 Decimals, Hard/Wallet Cap, Finalize/Withdraw |
| 3 | **BuybackVault** | `contracts/buyback/BuybackVault.sol` | 144 | ETH→IFR Buyback via DEX, Slippage, Cooldown, Burn/Treasury Split |
| 4 | **BurnReserve** | `contracts/burnreserve/BurnReserve.sol` | 86 | Permanent Burn, totalBurned Tracking, Owner+Guardian Auth |
| 5 | **Vesting** | `contracts/vesting/Vesting.sol` | 109 | Linear Vesting mit Cliff, Guardian Pause |

### Mocks (nur Tests)

| Contract | Datei | LOC | Zweck |
|----------|-------|-----|-------|
| MockToken | `contracts/mocks/MockToken.sol` | 16 | ERC20 fuer Tests |
| MockRouter | `contracts/mocks/MockRouter.sol` | 79 | Uniswap V2 Router Mock |
| MockInfernoToken | `contracts/mocks/MockInfernoToken.sol` | 14 | IFR Mock ohne Fees (9 Decimals) |

**Solidity gesamt: 651 LOC** | **Tests gesamt: 952 LOC** | **Deploy Script: 185 LOC**

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

### Token Distribution (Deploy Script)

| Empfaenger | Menge | Anteil |
|------------|-------|--------|
| Presale | 200,000,000 IFR | 20% |
| Vesting | 100,000,000 IFR | 10% |
| Deployer | 700,000,000 IFR | 70% |

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

### Presale

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(token, price, hardCap, walletCap, start, end)` | — | Initialisierung |
| `buyTokens()` | external payable | ETH → IFR kaufen |
| `getTokenAmount(uint256 ethAmount)` | public view | Berechnung: `(eth * 10^9) / TOKEN_PRICE` |
| `finalize()` | external onlyOwner | Presale beenden |
| `withdrawETH(address)` | external onlyOwner | ETH abheben (nach Finalize) |
| `withdrawUnsoldTokens(address)` | external onlyOwner | Unverkaufte Tokens abheben |
| `isActive()` | public view | Presale-Status pruefen |

### BuybackVault

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(token, burnReserve, treasury, router, guardian)` | — | Initialisierung |
| `depositETH()` | external payable | ETH einzahlen + Quote speichern |
| `executeBuyback()` | external onlyOwner | ETH → IFR swappen, Split burn/treasury |
| `setParams(burnBps, cooldown, slippage, router, treasury)` | external onlyOwner | Parameter aendern |
| `pause()` / `unpause()` | external onlyGuardian | Pausieren |

**Defaults:** burnShareBps=5000 (50%), cooldown=3600s, slippageBps=500 (5%)

### BurnReserve

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(address _token, address _guardian)` | — | Initialisierung |
| `deposit(uint256 amount)` | external | Tokens via transferFrom einzahlen |
| `burn(uint256 amount)` | external onlyOwnerOrGuardian | Bestimmte Menge verbrennen |
| `burnAll()` | external onlyOwnerOrGuardian | Gesamten Bestand verbrennen |
| `pendingBurn()` | external view | Tokens im Bestand anzeigen |
| `setGuardian(address)` | external onlyOwner | Guardian aendern |

### Vesting

| Funktion | Sichtbarkeit | Beschreibung |
|----------|-------------|-------------|
| `constructor(token, beneficiary, cliff, duration, allocation, guardian)` | — | Initialisierung |
| `release()` | external onlyBeneficiary | Geveste Tokens abheben |
| `releasableAmount()` | public view | Aktuell abholbare Menge |
| `vestedAmount()` | public view | Bisher geveste Menge |
| `vestingSchedule()` | external view | Start, Cliff, Duration |
| `pause()` / `unpause()` | external onlyGuardian | Pausieren |

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

### Presale.test.js (24 Tests)

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Deployment | 3 | Constructor-Params, isActive, Token-Balance |
| TOKEN_PRICE | 4 | 1 ETH=10k IFR, 0.5 ETH=5k, 0.0001 ETH=1, 10 ETH=100k |
| buyTokens() | 3 | Kauf + Event, Akkumulation, Fee-Free |
| Guards | 7 | Not started, Ended, Zero ETH, Wallet Cap, Hard Cap, Finalized |
| Finalize & Withdraw | 7 | Finalize, Double-Finalize, ETH/Token Withdraw + Reverts |

### BuybackVault.test.js (6 Tests)

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Deposit | 1 | ETH-Deposit + Event |
| Buyback | 1 | 50/50 Split burn/treasury |
| Cooldown | 1 | Cooldown-Enforcement + Bypass nach 1h |
| Slippage | 1 | Revert bei Rate-Aenderung > 5% |
| Pause | 1 | Guardian Pause/Unpause |
| Params | 1 | Owner kann Parameter aendern |

### BurnReserve.test.js (21 Tests)

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Deployment | 3 | Owner, Guardian, Token, Zero-Address Guards |
| deposit() | 3 | TransferFrom + Event, Zero Amount, No Approval |
| burn() | 6 | Owner/Guardian burn, totalSupply-Reduktion, Reverts, Akkumulation |
| burnAll() | 4 | Full Burn + Event, Guardian, Zero Balance, Unauthorized |
| pendingBurn() | 2 | Balance-Anzeige, Reduktion nach Burn |
| setGuardian() | 3 | Update + Event, Not Owner, Zero Address |

### Vesting.test.js (6 Tests)

| Kategorie | Tests | Prueft |
|-----------|-------|--------|
| Cliff | 1 | Kein Release vor Cliff |
| Linear | 1 | Lineare Freigabe nach Cliff |
| Full Release | 1 | 100% am Ende |
| Access Control | 1 | Nur Beneficiary |
| Pause | 1 | Guardian Pause/Unpause |

**Gesamt: 78 Tests, alle bestanden**

---

## Deploy Script (`scripts/deploy-testnet.js`)

### Ablauf (7 Steps)

```
Step 1/7  Deploy InfernoToken (poolFeeReceiver = deployer)
Step 2/7  Deploy Presale (TOKEN_PRICE, Caps, Zeitfenster)
Step 3/7  Deploy BurnReserve (guardian = deployer)
Step 4/7  Deploy BuybackVault (burnReserve = BurnReserve.address)
Step 5/7  Deploy Vesting (90d Cliff, 365d Duration, 100M IFR)
Step 6/7  Set feeExempt: Presale, Vesting, BuybackVault, BurnReserve, Deployer
Step 7/7  Fund: 200M IFR → Presale, 100M IFR → Vesting
```

### FeeExempt-Wiring

| Contract | Exempt | BuybackVault Wiring |
|----------|--------|---------------------|
| Presale | Ja | — |
| Vesting | Ja | — |
| BuybackVault | Ja | `burnReserve` → BurnReserve.address |
| BurnReserve | Ja | — |
| Deployer | Ja (temporaer) | — |

### Umgebungsvariablen (.env)

```
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# Optional
TOKEN_PRICE=100000000000000
HARD_CAP=100000000000000000000
PER_WALLET_CAP=10000000000000000000
PRESALE_DURATION_DAYS=30
VESTING_CLIFF_DAYS=90
VESTING_DURATION_DAYS=365
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

## Architektur-Fluss

```
                         ETH
                          |
                    [Presale] ──→ IFR an Kaeufer
                          |
                     ETH geraised
                          |
                   [BuybackVault]
                     /         \
                ETH→IFR      ETH→IFR
               (burn share)  (treasury share)
                   |              |
             [BurnReserve]   [Treasury]
                   |
              burn() → totalSupply sinkt
```

```
[Vesting] ──→ lineare Freigabe nach Cliff ──→ Beneficiary

[InfernoToken] ──→ jeder Transfer:
   2.0% Sender Burn (totalSupply sinkt)
   0.5% Recipient Burn (totalSupply sinkt)
   1.0% Pool Fee → poolFeeReceiver
```

---

## Offene Punkte / Next Steps

| # | Aufgabe | Prioritaet | Status |
|---|---------|------------|--------|
| 1 | Uniswap Router auf BuybackVault setzen (`setParams()`) | Vor Mainnet | Offen |
| 2 | Treasury-Adresse auf BuybackVault setzen (`setParams()`) | Vor Mainnet | Offen |
| 3 | Vesting-Beneficiary setzen (Redeploy) | Vor Mainnet | Offen |
| 4 | Deployer aus feeExempt entfernen nach Setup | Vor Mainnet | Offen |
| 5 | Contracts auf Etherscan verifizieren | Nach Deploy | Offen |
| 6 | Security Audit (Slither/MythX) | Empfohlen | Offen |
| 7 | Gas-Optimierung pruefen | Optional | Offen |

---

## Fazit

Alle 5 Hauptcontracts sind **vollstaendig implementiert, kompiliert und getestet**. 78 Tests bestehen fehlerfrei. Das Deploy Script deployt alle Contracts in korrekter Reihenfolge mit BurnReserve→BuybackVault Wiring und FeeExempt fuer alle relevanten Adressen. Das Projekt ist **testnet-ready**.
