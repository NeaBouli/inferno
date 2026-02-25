# IFR Testnet Integration Guide — Sepolia

Step-by-step guide for partners and developers to test the full IFR
integration on Sepolia before mainnet.

---

## Contract Addresses (Sepolia)

| Contract | Address | Etherscan |
|----------|---------|-----------|
| IFRToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` | [View](https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4) |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` | [View](https://sepolia.etherscan.io/address/0x0Cab0A9440643128540222acC6eF5028736675d3) |
| PartnerVault | `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` | [View](https://sepolia.etherscan.io/address/0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39) |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` | [View](https://sepolia.etherscan.io/address/0x6050b22E4EAF3f414d1155fBaF30B868E0107017) |

Network: **Sepolia Testnet** | Chain ID: **11155111** | Token Decimals: **9**

---

## Voraussetzungen

- [ ] MetaMask installiert (oder anderes EIP-1193 Wallet)
- [ ] Sepolia ETH vorhanden (Faucet: https://sepoliafaucet.com)
- [ ] Node.js >= 18 installiert
- [ ] Repo geklont: `git clone https://github.com/NeaBouli/inferno`
- [ ] Dependencies: `npm install`
- [ ] `.env` konfiguriert (siehe `.env.example`)

---

## Schritt 1: IFR Token zu MetaMask hinzufuegen

1. MetaMask oeffnen → "Import Token"
2. Token Contract Address: `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`
3. Symbol: `IFR`
4. **Decimals: 9** — kritisch, nicht 18!
5. "Save" → IFR erscheint in deiner Wallet

**Falsche Decimals (18 statt 9) = alle Betraege um Faktor 10^9 falsch.**

---

## Schritt 2: Test-IFR erhalten

Option A — Script:
```bash
cd /Users/gio/Desktop/Inferno
npx hardhat run scripts/mint-test-tokens.js --network sepolia
# Sendet Test-IFR an deine Wallet (nur Testnet)
```

Option B — direkt via Etherscan:
1. IFRToken auf Sepolia Etherscan oeffnen
2. "Write Contract" → connect wallet
3. `transfer()` vom Deployer (falls du Zugriff hast)

---

## Schritt 3: IFR sperren (Lock)

### Via Script:
```bash
# Sperre 5.000 IFR (Gold Tier)
npx hardhat run scripts/lock-tokens.js --network sepolia
# Script fragt: Betrag? → 5000
```

### Via Etherscan (manuell):
1. IFRLock Contract → "Write Contract"
2. Funktion: `lock(uint256 amount)`
3. Amount: `5000000000000` (= 5.000 IFR x 10^9)
4. Transaktion bestaetigen

### Verifikation:
```bash
npx hardhat run scripts/check-lock.js --network sepolia
# Output: Locked: 5000.0 IFR | isLocked(5000): true
```

---

## Schritt 4: Lock-Status pruefen (isLocked)
```javascript
// check-lock.js (oder direkt in Node REPL)
const { ethers } = require("ethers");

const provider = new ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC);
const ifrLock = new ethers.Contract(
  "0x0Cab0A9440643128540222acC6eF5028736675d3",
  ["function isLocked(address, uint256) view returns (bool)",
   "function lockedAmount(address) view returns (uint256)"],
  provider
);

const wallet = "0xDEINE_WALLET_ADRESSE";
const amount = ethers.utils.parseUnits("5000", 9);

const locked = await ifrLock.isLocked(wallet, amount);
const total = await ifrLock.lockedAmount(wallet);

console.log("isLocked(5000):", locked);        // true
console.log("Total locked:", ethers.utils.formatUnits(total, 9), "IFR");
```

---

## Schritt 5: Benefits Network testen (QR-Flow)

### Backend starten:
```bash
cd apps/benefits-network/backend
cp .env.example .env
# .env: CHAIN_ID=11155111, IFRLOCK_ADDRESS=0x0Cab0A..., RPC_URL=SEPOLIA_RPC
npm install && npm run dev
# Backend laeuft auf Port 3001
```

### Frontend starten:
```bash
cd apps/benefits-network/frontend
npm install && npm run dev
# Frontend laeuft auf Port 3000
```

### Test-Business anlegen:
```bash
curl -X POST http://localhost:3001/api/admin/businesses \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Business Sepolia",
    "discountPercent": 15,
    "requiredLockIFR": 1000,
    "tierLabel": "Bronze"
  }'
# → gibt businessId zurueck
```

### QR-Flow testen:
1. Browser: `http://localhost:3000/b/{businessId}`
2. "Verifikation starten" → QR-Code erscheint
3. Handy: QR scannen → WalletConnect → signieren
4. Merchant sieht: **APPROVED** (gruener Screen)
5. "Einloesen" klicken → Status: REDEEMED

---

## Schritt 6: Governance Dashboard testen
```bash
cd apps/governance-dashboard
npm run dev
# Dashboard laeuft auf http://localhost:5174
```

Was du siehst:
- **Overview Tab**: PartnerVault Balance, RewardBps 15%, TotalSupply
- **Timelock Queue**: Proposal #3 (Pending, Countdown)
- **Calldata Generator**: Governance-Proposals erstellen

---

## Schritt 7: Partner Lock Reward testen (PartnerVault)

Dieser Schritt setzt voraus, dass:
- PartnerVault feeExempt ist (nach Proposal #3)
- Ein Partner in PartnerVault registered ist (via Governance)

```bash
# Partner registrieren (Governance Proposal noetig)
npx hardhat run scripts/propose-create-partner.js --network sepolia

# Nach 48h executen:
npx hardhat run scripts/execute-proposal.js --network sepolia

# Lock Reward aufzeichnen (als authorizedCaller):
npx hardhat run scripts/record-lock-reward.js --network sepolia
# Args: partnerId, lockAmount, userWallet
```

---

## Schritt 8: Full Smoke Test (automatisiert)
```bash
cd /Users/gio/Desktop/Inferno
npx hardhat test --network sepolia --grep "smoke"
# Oder alle Tests:
npx hardhat test --network sepolia
```

Erwartetes Ergebnis: **256 tests passing**

---

## Haeufige Fehler

| Fehler | Ursache | Loesung |
|--------|---------|--------|
| "insufficient funds" | Kein Sepolia ETH | Faucet: sepoliafaucet.com |
| Falscher Token-Betrag | Decimals 18 statt 9 | Immer `parseUnits(x, 9)` |
| "execution reverted" | feeExempt nicht gesetzt | Proposal #3 erst executen |
| "Not authorized" | Kein authorizedCaller | setAuthorizedCaller via Governance |
| RPC timeout | Alchemy Free Tier | Eigenen RPC Key nutzen |
| MetaMask "wrong network" | Nicht auf Sepolia | Netzwerk wechseln (Chain ID 11155111) |

---

## Naechste Schritte nach erfolgreichem Test

- [ ] Mainnet Checklist durchgehen: [MAINNET_CHECKLIST.md](MAINNET_CHECKLIST.md)
- [ ] Security Audit beauftragen: [AUDIT_BRIEF.md](AUDIT_BRIEF.md)
- [ ] Multisig einrichten: [MULTISIG_SETUP.md](MULTISIG_SETUP.md)
- [ ] Partner Integration: [PARTNER_INTEGRATION_SPEC.md](PARTNER_INTEGRATION_SPEC.md)

---
*Stand: Februar 2026 | Sepolia Testnet Guide v1.0*
