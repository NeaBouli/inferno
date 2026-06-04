# Bootstrap finalise() — Execution Plan
**Datum: 05.06.2026 ab 23:50:23 UTC**
**(06.06.2026 ab 02:50 Uhr Athen)**

> Codex-reviewed: 31.05.2026 — alle 4 BRIDGE.md-Punkte beantwortet ✅

---

## ⚠️ BLOCKER — VOR MORGEN ERLEDIGEN

### .env Setup (KRITISCH)

`finalise-bootstrap.js` läuft via **Hardhat** — Hardhat liest Signer aus `.env`.
Ohne `.env` mit gesetztem `DEPLOYER_PRIVATE_KEY` schlägt der Call still fehl (`accounts: []`).

```bash
cd ~/Desktop/repos/inferno
# Falls .env noch nicht existiert:
cp .env.example .env

# Eintragen:
# DEPLOYER_PRIVATE_KEY=0x<deployer_private_key>
# MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
# ODER als Public-RPC-Fallback:
# MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com
```

### .env verifizieren:

```bash
node -e "require('dotenv').config(); \
  console.log('DEPLOYER_KEY set:', !!process.env.DEPLOYER_PRIVATE_KEY); \
  console.log('RPC set:', !!process.env.MAINNET_RPC_URL);"
# Erwartung: beide true
```

### Gas-Check:

Deployer-Wallet muss **≥ 0.05 ETH** auf Mainnet haben (Gas für finalise + feeExempt Proposal).

---

## On-chain Facts (verifiziert 31.05.2026)

| Feld | Wert |
|------|------|
| Vault | `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` |
| IFR Token | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| totalETHRaised | **0.030 ETH** |
| ifrAllocation | 100,000,000 IFR |
| Vault IFR Balance | **200,000,000 IFR** ✅ (2× allocation — ready) |
| endTime | `2026-06-05T23:50:23Z` |
| finalised | `false` |
| LP Token | `0x000...000` (erst nach finalise() bekannt) |

**Wichtige Erkenntnisse (Codex):**
- `finalise()` ist **PERMISSIONLESS** — kein Safe, kein onlyOwner
- Kein `minETH`-Check — 0.030 ETH reicht aus
- `hasRefundOccurred()` nicht im deployed Contract → Scripts behandeln als optional
- `estimateGas.finalise()` schützt vor Revert vor dem eigentlichen TX

---

## Pre-flight Checklist

- [x] Vault IFR Balance: 200M ✅
- [x] Governance Owner == TreasurySafe ✅
- [x] Deployer feeExempt ✅
- [x] BuybackController feeExempt ✅
- [x] FeeCollector == BuybackController ✅
- [x] `finalise-bootstrap.js` — Codex reviewed + chainId guard ✅ (via `npx hardhat run`)
- [x] `check-bootstrap-status.js` — standalone, kein Hardhat ✅ (via `node`)
- [ ] `.env` gesetzt: `DEPLOYER_PRIVATE_KEY` + `MAINNET_RPC_URL`?
- [ ] Gas ≥ 0.05 ETH auf Deployer-Wallet?
- [ ] Gas ETH auf ausführender Wallet vorhanden?
- [ ] Alle 5 Signer informiert (A.K., M.G., A.M., Y.K., A.P.)?

---

## Ablauf — 05.06.2026 23:50 UTC

### Schritt 0 — Kurz vorher: Status prüfen

```bash
cd ~/Desktop/repos/inferno
node scripts/check-bootstrap-status.js
```

Erwartung: `secondsLeft <= 0`, `finalised: false`

### Schritt 1 — finalise() aufrufen (PERMISSIONLESS)

```bash
npx hardhat run scripts/finalise-bootstrap.js --network mainnet
```

Script schätzt Gas → bestätigt chainId (muss 1 sein) → TX senden.
**TX Hash sofort notieren!**

> **Nicht** `node scripts/finalise-bootstrap.js` — das Script verwendet `require("hardhat")`.

### Schritt 2 — LP Token Adresse sichern

Aus finalise()-TX → `PairCreated` Event → LP Token Adresse.
Wird auch von `propose-pool-feeexempt.js` auto-gefetched.

### Schritt 3 — SOFORT: Uniswap Pool feeExempt (Issue #33)

```bash
npx hardhat run scripts/propose-pool-feeexempt.js --network mainnet
```

Proposal ID notieren → **48h Timelock** → danach ausführen.
**Ohne dieses Proposal: IFR auf Uniswap nicht handelbar (3.5% Fee auf jeden Swap)!**

### Schritt 5 — P0 berechnen + setzen (Issue #34)

```
P0 = totalETHRaised_wei / 100_000_000_000_000_000  (IFR Decimals = 9)
```

Bei 0.030 ETH: `P0 = 0.030e18 / 100e9 = 300_000_000` (= 3e-7 ETH/IFR)

Proposal erstellen: `setP0(p0Value)` auf CommitmentVault → 48h → ausführen.
**IMMUTABLE — korrekte Berechnung kritisch!**

### Schritt 6 — Post-Bootstrap Updates (Issue #35)

- `bootstrap.html`: Status auf ENDED setzen
- `index.html`: Buy IFR Button → Uniswap Link aktivieren
- Ali Copilot: hardcoded facts updaten + Railway redeploy
- `transparency.html`: finalise() TX eintragen
- Telegram @IFRtoken Announcement
- `TODO.md`: Issues #32–35 schließen

---

## Notfall — Falls finalise() reverted

```bash
node scripts/check-bootstrap-status.js
# standalone — zeigt estimateGas Revert-Grund
```

Häufigste Ursachen:
1. `endTime` noch nicht erreicht → warten
2. `finalised == true` → bereits erledigt
3. IFR Balance < 2× allocation → Vault auffüllen

---

## Kontakte

- TreasurySafe: `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` (3-of-5)
- Signer: A.K., M.G., A.M., Y.K., A.P.
- GitHub Issues: [#32](https://github.com/NeaBouli/inferno/issues/32) [#33](https://github.com/NeaBouli/inferno/issues/33) [#34](https://github.com/NeaBouli/inferno/issues/34) [#35](https://github.com/NeaBouli/inferno/issues/35)
