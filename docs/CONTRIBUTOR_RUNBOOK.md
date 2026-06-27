# Contributor Runbook — updated 28.06.2026

## Vorbereitung (heute Abend ✅)
- [x] Scripts generalisiert
- [x] Dry Run für alle 3 Contributors
- [x] Status on-chain verifiziert
- [x] Blockaid Retest Checkliste vorbereitet

## Contributor Wallets
| Contributor | Address | On-chain Status |
|---|---|---|
| C1 | `0x4f632748460E5277bF8435259cADce440AbAC254` | Claimed, buy detected, 36,735,135.849220732 IFR |
| C2 | `0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958` | Claimed, buy detected, 40,313,881.905691312 IFR |
| C3 | `0xf556cCe85128c93AC6A7e088cF334180F2D3905B` | Claimed, buy detected, 38,050,900.069727987 IFR |

## Wichtige Entscheidung vor Ausführung
Ein `LOCK_BPS=10000` Lock sperrt 100% der aktuellen IFR Balance in 10 Tranchen. Danach bleiben in derselben Wallet keine frei verfügbaren IFR für ein LendingVault Offer.

Empfohlen für die Live-Ausführung:
- Wenn Contributor lock + lending machen soll: `LOCK_BPS=5000` verwenden und danach den verbleibenden Rest mit `LENDING_BPS=10000` ausführen.
- Wenn Contributor nur locken soll: Standard `LOCK_BPS=10000` verwenden.
- Wenn Contributor nur lender sein soll: Lock überspringen und nur Lending Offer ausführen.

## Aktueller Stand 28.06.2026
- C1/C2/C3 haben je `0.02 ETH` auf Uniswap in IFR geswapt.
- `node scripts/check-contributors-execution.js` erkennt `Buy detected: true` für alle drei Contributor.
- C1/C2/C3 haben noch keine CommitmentVault Locks.
- C1/C2/C3 haben noch keine LendingVault Offers.
- Pool am 28.06.2026: `0.143261656128757442` ETH und `21028676.626442057` IFR.
- C1 hat nur noch `0.000813371861694519` ETH und sollte vor Live-Lock/Lending für Gas aufgefüllt werden.
- C2/C3 haben mehr ETH, sind für 13 TXs aber ebenfalls nicht komfortabel gepuffert.
- Aktueller Bridge-Snapshot: `BRIDGE.md` Abschnitt `2026-06-28 [CODEX TERMINAL]`.

## Status nach Käufen prüfen
```bash
node scripts/check-contributors-execution.js
```

Das Script ist read-only und zeigt pro Contributor:
- ETH/IFR Balance
- ob ein Uniswap-Kauf erkannt wurde
- CommitmentVault Locks/Tranches
- LendingVault Offer Status
- nächsten auszuführenden Schritt

## Ablauf nach Contributor-Kauf

### Schritt 1 — Jeder Contributor kauft 0.02 ETH IFR
URL: https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B

Status: erledigt und on-chain verifiziert.

### Schritt 2 — Status prüfen
```bash
CONTRIBUTOR_ADDR=0x[addr] DRY_RUN=true \
  node scripts/contributors-lock.js
```

Prüfen:
- IFR Balance größer als vorher
- ETH Balance reicht für Gas
- Allowance zu CommitmentVault und LendingVault bekannt
- Lock-Strategie entschieden (`LOCK_BPS=10000` oder `LOCK_BPS=5000`)

### Schritt 3 — Dry Run Lock
```bash
CONTRIBUTOR_ADDR=0x[addr] DRY_RUN=true \
  node scripts/contributors-lock.js
```

Erwarteter Output bei Full Lock:
- 10 Tranchen à ca. 3.3M IFR plus neu gekaufte IFR anteilig
- cType: TIME_ONLY (0)
- unlockTime: jetzt + 30 Tage
- p0Multiplier: 0

Erwarteter Output bei 50% Lock:
- `LOCK_BPS=5000`
- 10 Tranchen über 50% der aktuellen Balance nach dem Kauf
- 50% bleibt für Lending verfügbar

### Schritt 4 — Lock ausführen
Full Lock:
```bash
CONTRIBUTOR_ADDR=0x[addr] \
PRIVATE_KEY=0x[key] \
DRY_RUN=false \
MAINNET=true \
node scripts/contributors-lock.js
```

Lock + Lending Split:
```bash
CONTRIBUTOR_ADDR=0x[addr] \
PRIVATE_KEY=0x[key] \
DRY_RUN=false \
MAINNET=true \
LOCK_BPS=5000 \
node scripts/contributors-lock.js
```

TX Hashes notieren:
- approve tx
- lock tranche 1-10 tx

### Schritt 5 — Lending Offer Dry Run
```bash
CONTRIBUTOR_ADDR=0x[addr] LENDING_BPS=10000 DRY_RUN=true \
  node scripts/contributors-lending-offer.js
```

Erwarteter Output:
- Nach `LOCK_BPS=5000`: Betrag = verbleibende freie IFR Balance
- approve(LendingVault, amount)
- createOffer(amount) oder increaseOffer(amount)

Hinweis: `LendingVault` hat keine `terms`-Struktur. Die echte ABI ist `createOffer(uint256 amount)`.
Wichtig: Nach dem 50%-Lock würde der Default `LENDING_BPS=5000` nur die Hälfte des verbleibenden Rests anbieten. Für "50% Lock + 50% Lending" deshalb nach dem Lock `LENDING_BPS=10000` setzen.

### Schritt 6 — Lending Offer ausführen
```bash
CONTRIBUTOR_ADDR=0x[addr] \
PRIVATE_KEY=0x[key] \
DRY_RUN=false \
MAINNET=true \
LENDING_BPS=10000 \
node scripts/contributors-lending-offer.js
```

TX Hashes notieren:
- approve tx
- createOffer / increaseOffer tx

### Schritt 7 — Ergebnis prüfen
```bash
CONTRIBUTOR_ADDR=0x[addr] DRY_RUN=true \
  node scripts/contributors-lock.js

CONTRIBUTOR_ADDR=0x[addr] LENDING_BPS=10000 DRY_RUN=true \
  node scripts/contributors-lending-offer.js
```

## Rollback / Abort
Falls TX fehlschlägt:
- `DRY_RUN=true` nochmal prüfen
- Gas erhöhen: `GAS_LIMIT=500000`
- RPC wechseln: `MAINNET_RPC_URL=https://eth.llamarpc.com`
- Keine zweite Live-TX senden, bevor die erste TX confirmed oder failed ist

## Blockaid Retest
Nach 24h Propagation:
- MetaMask: IFR importieren
- Uniswap: IFR kaufen
- `bootstrap.html`: WalletConnect Flow
- Desktop und Samsung S10 separat testen

## Ergebnisprotokoll
| Contributor | Buy TX | Lock TXs | Lending TX | Result |
|---|---|---|---|---|
| C1 |  |  |  |  |
| C2 |  |  |  |  |
| C3 |  |  |  |  |
