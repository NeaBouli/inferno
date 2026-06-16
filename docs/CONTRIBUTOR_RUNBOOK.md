# Contributor Runbook — updated 16.06.2026

## Vorbereitung (heute Abend ✅)
- [x] Scripts generalisiert
- [x] Dry Run für alle 3 Contributors
- [x] Status on-chain verifiziert
- [x] Blockaid Retest Checkliste vorbereitet

## Contributor Wallets
| Contributor | Address | On-chain Status |
|---|---|---|
| C1 | `0x4f632748460E5277bF8435259cADce440AbAC254` | Claimed, 33,333,333.333333333 IFR |
| C2 | `0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958` | Claimed, 33,333,333.333333333 IFR |
| C3 | `0xf556cCe85128c93AC6A7e088cF334180F2D3905B` | Claimed, 33,333,333.333333333 IFR |

## Wichtige Entscheidung vor Ausführung
Ein `LOCK_BPS=10000` Lock sperrt 100% der aktuellen IFR Balance in 10 Tranchen. Danach bleiben in derselben Wallet keine frei verfügbaren IFR für ein LendingVault Offer.

Empfohlen für morgen:
- Wenn Contributor lock + lending machen soll: `LOCK_BPS=5000` verwenden und danach Lending mit `LENDING_BPS=5000` ausführen.
- Wenn Contributor nur locken soll: Standard `LOCK_BPS=10000` verwenden.
- Wenn Contributor nur lender sein soll: Lock überspringen und nur Lending Offer ausführen.

## Aktueller Stand 16.06.2026
- C1/C2/C3 haben weiterhin je `33333333.333333333` IFR.
- C1/C2/C3 haben noch keine CommitmentVault Locks.
- C1/C2/C3 haben noch keine LendingVault Offers.
- C1/C2/C3 brauchen weiterhin mehr ETH für Kauf + Gas.
- Pool am 16.06.2026: `0.083261656128757442` ETH und `36128594.451082089` IFR.
- Detaillierter Snapshot: `docs/CONTRIBUTOR_EXECUTION_STATUS_20260616.md`

## Ablauf nach Contributor-Kauf

### Schritt 1 — Jeder Contributor kauft 0.03 ETH IFR
URL: https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B

Slippage: mind. 15% setzen.

Warten: TX confirmed.

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
CONTRIBUTOR_ADDR=0x[addr] DRY_RUN=true \
  node scripts/contributors-lending-offer.js
```

Erwarteter Output:
- Betrag = 50% IFR Balance
- approve(LendingVault, amount)
- createOffer(amount) oder increaseOffer(amount)

Hinweis: `LendingVault` hat keine `terms`-Struktur. Die echte ABI ist `createOffer(uint256 amount)`.

### Schritt 6 — Lending Offer ausführen
```bash
CONTRIBUTOR_ADDR=0x[addr] \
PRIVATE_KEY=0x[key] \
DRY_RUN=false \
MAINNET=true \
node scripts/contributors-lending-offer.js
```

TX Hashes notieren:
- approve tx
- createOffer / increaseOffer tx

### Schritt 7 — Ergebnis prüfen
```bash
CONTRIBUTOR_ADDR=0x[addr] DRY_RUN=true \
  node scripts/contributors-lock.js

CONTRIBUTOR_ADDR=0x[addr] DRY_RUN=true \
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
