# Proposal B — setFeeCollector(BuybackController)

## Ziel
Der FeeRouterV1 soll protocol fees an den **BuybackController** senden statt
an den bisherigen feeCollector (Deployer-EOA Treasury). Damit fließen
Protocol-Fees in den 50/50 Buyback+Burn / LP-Deepening Flywheel.

## On-chain verifiziert (16.04.2026)

| Feld | Wert |
|------|------|
| **FeeRouterV1** | `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` |
| **FeeRouterV1.governance** | `0xc43d48E7FDA576C5022d0670B652A622E8caD041` (Governance Contract) |
| **FeeRouterV1.feeCollector (aktuell)** | `0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c` (alter Treasury-Empfänger) |
| **FeeRouterV1.protocolFeeBps** | `5` (0.05%) |
| **FeeRouterV1.paused** | `false` |
| **Target feeCollector** | `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` (BuybackController) |
| **Governance.owner** | `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` (TreasurySafe 3-of-5) |
| **Governance.delay** | 172800s (48h Timelock) |

## Route (Fall A — via Governance)

`setFeeCollector()` ist `onlyGovernance` auf FeeRouterV1 → Aufruf muss
durch den **Governance-Contract** erfolgen. Der Governance-Contract ist
`onlyOwner` für `propose()` und `execute()` → Owner ist die **TreasurySafe**
(3-of-5).

**Ablauf:**
1. TreasurySafe signiert `propose(FeeRouterV1, setFeeCollector(BuybackController))` (3/5)
2. 48h Timelock startet
3. TreasurySafe signiert `execute(proposalId)` (3/5, nach Ablauf)
4. Verify: `FeeRouterV1.feeCollector() == BuybackController`

## Calldata

### Inner — `setFeeCollector(BuybackController)` auf FeeRouterV1

- Selector: `0xa42dce80`
- Vollständig:

```
0xa42dce800000000000000000000000001e0547d50005a4af66abd5e6915ebfaa2d711f7c
```

### Outer — `propose(FeeRouterV1, innerCalldata)` auf Governance

- Selector: `0x9d481848`
- Vollständig:

```
0x9d4818480000000000000000000000004807b77b2e25cd055da42b09ba4d0af9e580c60a00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000024a42dce800000000000000000000000001e0547d50005a4af66abd5e6915ebfaa2d711f7c00000000000000000000000000000000000000000000000000000000
```

## Safe UI Schritte (TreasurySafe 3-of-5)

### Variante A — Contract Interaction (empfohlen)

1. https://app.safe.global/home?safe=eth:0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b
2. **New Transaction** → **Contract Interaction**
3. Contract Address: `0xc43d48E7FDA576C5022d0670B652A622E8caD041` (Governance)
4. ABI: Governance ABI (propose-Funktion)
5. Method: `propose(address target, bytes data)`
   - `target`: `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` (FeeRouterV1)
   - `data`: `0xa42dce800000000000000000000000001e0547d50005a4af66abd5e6915ebfaa2d711f7c`
6. 3-of-5 Signaturen sammeln → Submit
7. 48h Timelock abwarten

### Variante B — Transaction Builder (raw calldata)

1. **New Transaction** → **Transaction Builder**
2. To: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
3. Value: `0`
4. Data:

```
0x9d4818480000000000000000000000004807b77b2e25cd055da42b09ba4d0af9e580c60a00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000024a42dce800000000000000000000000001e0547d50005a4af66abd5e6915ebfaa2d711f7c00000000000000000000000000000000000000000000000000000000
```

5. 3-of-5 Signaturen → Submit

### Execute (nach 48h Timelock)

1. Neue Transaktion via Safe UI
2. Contract Interaction: Governance → `execute(uint256 proposalId)`
3. `proposalId`: (wird nach Submit aus `ProposalCreated` Event ausgelesen)
4. 3-of-5 Signaturen → Execute

## Verify nach Execute

```
node -e "require('dotenv').config();
const{ethers}=require('ethers');
const p=new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const fr=new ethers.Contract(
  '0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a',
  ['function feeCollector() view returns (address)'],p);
fr.feeCollector()
  .then(r=>console.log('feeCollector:',r,
    r.toLowerCase()==='0x1e0547d50005a4af66abd5e6915ebfaa2d711f7c'
      ? '✅ BuybackController' : '❌ noch alter Wert'));"
```

## Status

- [x] ✅ Submitted via TreasurySafe 3-of-5 — 16.04.2026
- [x] ✅ Proposal ID: **14** (on-chain EXAKT verifiziert)
- [x] ✅ Timelock abgelaufen: **18.04.2026 11:09:35 Athen** (Unix: 1776499775)
- [x] ✅ Executed via TreasurySafe 3-of-5 — 18.04.2026
- [x] ✅ Verified on-chain: `FeeRouterV1.feeCollector() == 0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` (BuybackController)
