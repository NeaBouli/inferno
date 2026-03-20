# Core Dev Handover — BuilderRegistry Deploy

**Date:** 2026-03-20
**Author:** IFR Protocol
**Status:** Ready for Core Dev

---

## Deine Aufgabe

BuilderRegistry.sol auf Sepolia deployen + testen, dann Audit, dann Mainnet.

**Alles ist vorbereitet:**
- Contract: `contracts/BuilderRegistry.sol` (188 LOC, Ownable)
- Tests: `test/BuilderRegistry.test.js` (27/27 passing)
- ABI: `abi/BuilderRegistry.json`
- Deploy Script: `scripts/deploy-builder-registry.js`
- Checklist: `docs/BUILDER_REGISTRY_DEPLOY.md`

---

## Contract Overview

```
BuilderRegistry is Ownable
  - owner = Governance (0xc43d...D041) → now TreasurySafe 3-of-5
  - registerBuilder(wallet, name, url, category) → onlyOwner
  - removeBuilder(wallet) → onlyOwner
  - updateBuilder(wallet, name, url, category) → onlyOwner
  - isBuilder(address) → bool (view)
  - getBuilderInfo(address) → BuilderInfo (view)
  - getActiveBuilders() → address[] (view)
  - getBuilderCount() → uint256 (view)

Categories: "creator" | "integration" | "tooling" | "dao"
```

Constructor nimmt `governance_` als Parameter → wird Owner (Governance Timelock).

---

## Voraussetzungen

- [ ] Eigener Private Key in lokaler .env (NICHT den Deployer-Key verwenden)
- [ ] Sepolia ETH (min 0.1 ETH) — Faucet: https://sepoliafaucet.com
- [ ] Node.js 18+ und npm installiert
- [ ] Etherscan API Key (für Verification)

---

## Schritt 1 — Repo klonen + Setup

```bash
git clone https://github.com/NeaBouli/inferno
cd inferno
npm install
```

---

## Schritt 2 — .env konfigurieren

```bash
cp .env.example .env
```

Eintragen:
```
DEPLOYER_PRIVATE_KEY=0x[dein-private-key]
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/[dein-key]
MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com
ETHERSCAN_API_KEY=[dein-etherscan-key]
```

---

## Schritt 3 — Tests lokal laufen lassen

```bash
npx hardhat test test/BuilderRegistry.test.js
```

Erwartet: **27/27 passing** — alle Tests grün.

---

## Schritt 4 — Sepolia Deploy

```bash
# Sepolia Governance Address setzen (aus docs/DEPLOYMENTS.md):
GOVERNANCE_ADDRESS=0x6050b22E4EAF3f414d1155fBaF30B868E0107017 \
  npx hardhat run scripts/deploy-builder-registry.js --network sepolia
```

**Notiere die Contract-Adresse!**

---

## Schritt 5 — Sepolia Verify

Falls auto-verify fehlschlägt:
```bash
npx hardhat verify [CONTRACT_ADDRESS] \
  "0x6050b22E4EAF3f414d1155fBaF30B868E0107017" \
  --network sepolia
```

---

## Schritt 6 — Sepolia Funktionstest

```bash
node -e "
const{ethers}=require('ethers');
const p=new ethers.providers.JsonRpcProvider('[SEPOLIA_RPC]');
const c=new ethers.Contract('[CONTRACT_ADDRESS]',
  ['function getBuilderCount() view returns (uint256)',
   'function isBuilder(address) view returns (bool)'],p);
c.getBuilderCount().then(n=>console.log('Count:',n.toString()));
c.isBuilder('0x0000000000000000000000000000000000000000').then(b=>console.log('isBuilder(0x0):',b));
"
```

Erwartet: `Count: 0`, `isBuilder(0x0): false`

---

## Schritt 7 — Audit

- Contract zur Audit einreichen (Cyfrin / Code4rena / Sherlock)
- Findings beheben
- Re-audit falls nötig
- Audit-Report in `docs/` ablegen

---

## Schritt 8 — Mainnet Deploy (nach Audit)

```bash
# Mainnet Governance Address (default im Script):
npx hardhat run scripts/deploy-builder-registry.js --network mainnet
```

Mainnet Governance: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
(Owner = TreasurySafe 3-of-5 seit 20.03.2026)

---

## Schritt 9 — Railway env vars setzen

Railway Dashboard → **ifr-ai-copilot** Service → Variables:
```
BUILDER_REGISTRY_ADDR = 0x[mainnet-contract-address]
```

Railway Dashboard → **telegram-bot** Service → Variables:
```
BUILDER_REGISTRY_ADDR = 0x[mainnet-contract-address]
```

Auto-deploy aktiviert die Endpoints automatisch.

**Verify:**
```
GET https://[railway-url]/api/builders/count → { "count": 0 }
GET https://[railway-url]/api/builders/check/0x... → { "address": "0x...", "isBuilder": false }
```

---

## Schritt 10 — Docs updaten + Kaspartizan informieren

1. Mainnet-Adresse in `docs/DEPLOYMENTS.md` eintragen
2. `docs/wiki/contracts.html` updaten
3. `docs/wiki/wallet-guide.html` updaten
4. Kaspartizan die Mainnet-Adresse mitteilen

---

## Wichtige Adressen

| Netzwerk | Governance | Rolle |
|----------|-----------|-------|
| Sepolia | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` | Owner des BuilderRegistry |
| Mainnet | `0xc43d48E7FDA576C5022d0670B652A622E8caD041` | Owner des BuilderRegistry |

**Governance Owner (Mainnet):** TreasurySafe 3-of-5 (`0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`)
→ Builder-Registrierungen laufen als Governance Proposals (48h Timelock)

---

## Dateien-Referenz

| Was | Pfad |
|-----|------|
| Contract | `contracts/BuilderRegistry.sol` |
| Tests | `test/BuilderRegistry.test.js` |
| ABI | `abi/BuilderRegistry.json` |
| Deploy Script | `scripts/deploy-builder-registry.js` |
| Deploy Checklist | `docs/BUILDER_REGISTRY_DEPLOY.md` |
| API Integration | `backend/routes/builders.js` |
| Telegram Integration | `apps/telegram/telegram-bot/src/services/onChainReader.js` |
