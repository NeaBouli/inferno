# INFERNO ($IFR) — Fair Launch Migration Plan (CFLM)

**Datum:** 2026-02-15
**Status:** ENTWURF — Warte auf Freigabe vor Code-Aenderungen

---

## 1. Strategiewechsel

Inferno wechselt vom Presale-Modell zum **Community Fair Launch Model (CFLM)**.

Gruende:
- Keine bevorzugten Kaeufern (kein Whale-Vorteil)
- Vertrauen durch sofortige DEX-Liquiditaet
- Community-First Ansatz

---

## 2. Neue Token-Allokation

| # | Empfaenger | Menge | Anteil | Mechanismus |
|---|------------|-------|--------|-------------|
| 1 | **Initial DEX Liquidity** | 400,000,000 IFR | 40% | Deployer paired mit ETH auf Uniswap V2/V3 |
| 2 | **Strategic Liquidity Reserve** | 200,000,000 IFR | 20% | LiquidityReserve.sol (zeitgesperrt, gestaffelte Freigabe) |
| 3 | **Team Vesting** | 150,000,000 IFR | 15% | Vesting.sol (12mo Cliff, 36mo linear nach Cliff) |
| 4 | **Treasury Multisig** | 150,000,000 IFR | 15% | Direkt an Multisig-Adresse |
| 5 | **Community/Ecosystem/Bug Bounty** | 100,000,000 IFR | 10% | Direkt an Community-Wallet |
| | **Gesamt** | **1,000,000,000 IFR** | **100%** | |

---

## 3. Analyse bestehender Contracts

### 3.1 InfernoToken.sol — Keine Aenderung noetig

- Mintet 100% (1B IFR) an `msg.sender` im Constructor
- Deploy-Script verteilt danach via `token.transfer()` an die 5 Empfaenger
- Fee-on-Transfer (2% Sender Burn, 0.5% Recipient Burn, 1% Pool Fee) bleibt unveraendert
- `feeExempt` Mapping wird fuer alle Contracts gesetzt

**Fazit:** Contract bleibt wie er ist. Nur das Deploy-Script aendert die Verteilung.

### 3.2 Presale.sol — Wird geloescht

- Klassische ETH→IFR Presale-Logik, nicht kompatibel mit CFLM
- Contract und Tests werden entfernt
- feeExempt-Eintrag im Deploy-Script wird entfernt

**Dateien betroffen:**
- `contracts/presale/Presale.sol` → loeschen
- `test/Presale.test.js` → loeschen
- `scripts/deploy-testnet.js` → Presale-Steps entfernen

### 3.3 Vesting.sol — Formel-Anpassung noetig

**Problem mit aktueller Formel:**

```
vestedAmount = (totalAllocation * elapsed) / duration
```

Bei cliff=12mo, duration=36mo:
- Monat 12 (Cliff-Ende): `(150M * 12) / 36 = 50M` → **33.3% sofort verfuegbar**
- Das ist NICHT das gewuenschte Verhalten

**Gewuenschtes Verhalten:** 12mo Cliff, dann 36mo linear AB dem Cliff:
- Monat 12: 0% verfuegbar (Cliff gerade abgelaufen, lineare Phase beginnt)
- Monat 24: `(150M * 12) / 36 = 50M` (33.3%)
- Monat 36: `(150M * 24) / 36 = 100M` (66.6%)
- Monat 48: 150M (100%)

**Neue Formel:**

```solidity
function vestedAmount() public view returns (uint256) {
    uint256 elapsed = block.timestamp - start;
    if (elapsed < cliffDuration) return 0;
    uint256 vestingElapsed = elapsed - cliffDuration;
    uint256 vestingDuration = duration - cliffDuration;
    if (vestingElapsed >= vestingDuration) return totalAllocation;
    return (totalAllocation * vestingElapsed) / vestingDuration;
}
```

**Parameter fuer Team Vesting:**
- `cliffDuration` = 365 days (12 Monate)
- `duration` = 365 * 4 days (48 Monate gesamt = 12mo Cliff + 36mo linear)
- `totalAllocation` = 150,000,000 * 10^9

**Dateien betroffen:**
- `contracts/vesting/Vesting.sol` → Formel aendern
- `test/Vesting.test.js` → Tests anpassen

### 3.4 BuybackVault.sol — 60-Tage-Aktivierungssperre

**Aenderung:** Neuer `activationTime` Parameter verhindert Buybacks in den ersten 60 Tagen nach Launch.

```solidity
uint256 public immutable activationTime;

constructor(...) {
    activationTime = block.timestamp + 60 days;
    // ...
}

function executeBuyback() external onlyOwner {
    require(block.timestamp >= activationTime, "not active yet");
    // ...
}
```

**Dateien betroffen:**
- `contracts/buyback/BuybackVault.sol` → activationTime ergaenzen
- `test/BuybackVault.test.js` → Tests erweitern

### 3.5 BurnReserve.sol — Keine Aenderung noetig

---

## 4. Neuer Contract: LiquidityReserve.sol

### Zweck

Haelt 200M IFR (20% Supply) als strategische Liquiditaetsreserve. Gestaffelte Freigabe nach Lock-Periode verhindert Supply-Schock.

### Design

```
LiquidityReserve
├── owner               (address) — kann nach Lock entnehmen
├── guardian             (address) — kann pausieren
├── token               (IERC20, immutable) — IFR Token
├── lockEnd             (uint256, immutable) — block.timestamp + lockDuration
├── maxWithdrawPerPeriod (uint256) — max Entnahme pro Periode (z.B. 50M IFR)
├── periodDuration      (uint256) — Laenge einer Periode (z.B. 90 Tage = 1 Quartal)
├── lastWithdrawPeriod  (uint256) — letzte Periode in der entnommen wurde
├── withdrawnThisPeriod (uint256) — bereits entnommen in aktueller Periode
├── totalWithdrawn      (uint256) — gesamt entnommen
└── paused              (bool)
```

### Funktionen

| Funktion | Auth | Beschreibung |
|----------|------|-------------|
| `constructor(token, lockDuration, maxPerPeriod, periodDuration, guardian)` | — | Initialisierung |
| `withdraw(address to, uint256 amount)` | onlyOwner | Entnimmt Tokens (nach Lock, max pro Periode) |
| `setMaxWithdrawPerPeriod(uint256)` | onlyOwner | Aendert Perioden-Limit |
| `setGuardian(address)` | onlyOwner | Aendert Guardian |
| `pause()` / `unpause()` | onlyGuardian | Pausiert Entnahmen |
| `availableToWithdraw()` | view | Zeigt aktuell entnehmbare Menge |
| `currentPeriod()` | view | Aktuelle Perioden-Nummer |
| `pendingBalance()` | view | Token-Bestand im Contract |

### Perioden-Logik

```
Beispiel: lockDuration=6mo, maxPerPeriod=50M, periodDuration=90d

Monat 0-6:   Gesperrt, keine Entnahme
Monat 6-9:   Periode 1 → max 50M entnehmbar
Monat 9-12:  Periode 2 → max 50M entnehmbar
Monat 12-15: Periode 3 → max 50M entnehmbar
Monat 15-18: Periode 4 → max 50M entnehmbar (200M komplett frei)
```

### Default-Parameter (Deploy)

- `lockDuration`: 180 Tage (6 Monate)
- `maxWithdrawPerPeriod`: 50,000,000 * 10^9 (50M IFR)
- `periodDuration`: 90 Tage (1 Quartal)

---

## 5. Deploy-Script (CFLM)

### Neuer Ablauf

```
Step 1/8  Deploy InfernoToken (poolFeeReceiver = deployer)
Step 2/8  Deploy LiquidityReserve (6mo Lock, 50M/Quartal)
Step 3/8  Deploy Vesting (12mo Cliff, 36mo linear, 150M IFR, beneficiary=TBD)
Step 4/8  Deploy BuybackVault (60d Aktivierungssperre)
Step 5/8  Deploy BurnReserve
Step 6/8  Set feeExempt fuer alle Contracts + Deployer
Step 7/8  Distribute Tokens:
            400M → Deployer behaelt fuer DEX Liquidity Pairing
            200M → LiquidityReserve
            150M → Vesting (Team)
            150M → Treasury Multisig Adresse
            60M  → Community & Grants Wallet
            40M  → Partner Ecosystem (PartnerVault)
Step 8/8  Remove Deployer feeExempt
```

### FeeExempt-Liste (komplett)

| Contract/Adresse | feeExempt | Grund |
|------------------|-----------|-------|
| Vesting | Ja | Token-Freigabe ohne Gebuehren |
| LiquidityReserve | Ja | Liquiditaets-Management |
| Treasury Multisig | Ja | Operative Transfers |
| BuybackVault | Ja | Buyback-Mechanismus |
| BurnReserve | Ja | Burn-Mechanismus |
| Deployer | Ja → Nein | Temporaer fuer Distribution, danach entfernen |

**Wichtig:** Deployer feeExempt wird in Step 8 explizit entfernt (`setFeeExempt(deployer, false)`).

---

## 6. LP-Lock Strategie

**Empfehlung: Eigener Contract (LiquidityReserve.sol)**

| Kriterium | Eigener Contract | Unicrypt/Team.finance |
|-----------|-----------------|----------------------|
| Auditierbarkeit | Voller Quellcode | Externes Protokoll |
| Flexibilitaet | Gestaffelte Freigabe | Meist alles-oder-nichts |
| Abhaengigkeit | Keine | Externes Protokoll-Risiko |
| Vertrauenssignal | Mittel | Hoch (bekannte Plattform) |
| Kosten | Gas fuer Deploy | Platform Fee |

LiquidityReserve.sol kann auch LP-Tokens halten (ERC20-kompatibel). Externe Plattform kann spaeter zusaetzlich genutzt werden.

---

## 7. Dateien-Uebersicht

| Datei | Aktion | Beschreibung |
|-------|--------|-------------|
| `contracts/liquidity/LiquidityReserve.sol` | **Neu** | Strategic Reserve mit gestaffelter Freigabe |
| `test/LiquidityReserve.test.js` | **Neu** | Tests fuer LiquidityReserve |
| `contracts/vesting/Vesting.sol` | **Aendern** | Post-Cliff-Formel |
| `test/Vesting.test.js` | **Aendern** | Tests fuer neue Formel |
| `contracts/buyback/BuybackVault.sol` | **Aendern** | activationTime (60d) |
| `test/BuybackVault.test.js` | **Aendern** | activationTime Tests |
| `contracts/presale/Presale.sol` | **Loeschen** | Nicht mehr benoetigt |
| `test/Presale.test.js` | **Loeschen** | Nicht mehr benoetigt |
| `scripts/deploy-testnet.js` | **Ueberarbeiten** | CFLM-Allokation + feeExempt |
| `contracts/token/InfernoToken.sol` | Keine Aenderung | |
| `contracts/burnreserve/BurnReserve.sol` | Keine Aenderung | |

---

## 8. Reihenfolge der Implementierung

1. `docs/FAIR-LAUNCH-MIGRATION.md` erstellen (dieses Dokument) ← **Aktueller Schritt**
2. `contracts/liquidity/LiquidityReserve.sol` + Tests implementieren
3. `contracts/vesting/Vesting.sol` Formel anpassen + Tests
4. `contracts/buyback/BuybackVault.sol` activationTime + Tests
5. `contracts/presale/Presale.sol` + Tests loeschen
6. `scripts/deploy-testnet.js` komplett ueberarbeiten
7. Compile + alle Tests ausfuehren
8. Commit & Push

---

## 9. Offene Fragen (vor Implementierung zu klaeren)

- [ ] Treasury Multisig Adresse (oder Placeholder im Deploy-Script?)
- [ ] Community Wallet Adresse (oder Placeholder?)
- [ ] Team Vesting Beneficiary Adresse
- [ ] DEX Liquidity Pairing: manuell oder automatisiert im Deploy-Script?
- [ ] Soll Presale-Verzeichnis komplett geloescht werden oder .gitkeep behalten?
