# Proposal #7 + #8 — Execution Guide

**Status:** 🟡 PROPOSED — submitted 16.03.2026
**Prepared:** 16.03.2026
**Executor:** A.K. (Deployer — Governance Owner)

## Submitted Proposals

| Call | Proposal ID | TX | ETA (execute after) |
|------|-------------|----|--------------------|
| Deployer feeExempt | 7 | [0xbb00c924...](https://etherscan.io/tx/0xbb00c92475f76a0370a7a2343d2c5c01cc5ed624cbe45971886ffd1f29402f8c) | 2026-03-17 ~22:50 UTC |
| TreasurySafe feeExempt | 8 | [0x9b080b44...](https://etherscan.io/tx/0x9b080b44ea30a889117dfdea0ecc7ef31e93efd4792e85a309fe1b69e0d41730) | 2026-03-17 ~22:51 UTC |
| CommunitySafe feeExempt | 9 | [0x94d29562...](https://etherscan.io/tx/0x94d29562b7431ae5c1d4d4873fdb15fa93ed3cbb94022f142fb27eada5c1a57a) | 2026-03-17 ~22:51 UTC |

### Execute Command (after ETA)

```bash
PRIVATE_KEY=0x... node -e "
require('dotenv').config();
const{ethers}=require('ethers');
const p=new ethers.providers.JsonRpcProvider(process.env.RPC_URL||'https://ethereum-rpc.publicnode.com');
const s=new ethers.Wallet(process.env.PRIVATE_KEY,p);
const g=new ethers.Contract('0xc43d48E7FDA576C5022d0670B652A622E8caD041',['function execute(uint256)'],s);
async function run(){
  for(const id of[7,8,9]){
    console.log('Executing ID',id,'...');
    const tx=await g.execute(id);console.log('TX:',tx.hash);
    await tx.wait();console.log('ID',id,'executed');
  }
}
run();
"
```

---

## Proposal #7 — setFeeExempt (CRITICAL)

3 separate Governance Proposals setting feeExempt on Deployer, Treasury Safe, Community Safe.
All 3 can be proposed simultaneously. After 48h timelock, execute all 3.

### Option 1 — Via Etherscan (simplest)

1. Go to Governance Write Contract:
   https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#writeContract

2. Connect MetaMask with Deployer wallet (`0x6b36687b0cd4386fb14cf565B67D7862110Fed67`)

3. Function: `propose(address target, bytes calldata data)`

4. Execute 3x propose():

**Call A — Deployer feeExempt:**
```
target: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B
data:   0x8ebfc7960000000000000000000000006b36687b0cd4386fb14cf565b67d7862110fed670000000000000000000000000000000000000000000000000000000000000001
```

**Call B — Treasury Safe feeExempt:**
```
target: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B
data:   0x8ebfc7960000000000000000000000005ad6193ed6e1e31ed10977e73e3b609acbfece3b0000000000000000000000000000000000000000000000000000000000000001
```

**Call C — Community Safe feeExempt:**
```
target: 0x77e99917Eca8539c62F509ED1193ac36580A6e7B
data:   0x8ebfc796000000000000000000000000ac5687547b2b21d80f8fd345b51e608d476667c70000000000000000000000000000000000000000000000000000000000000001
```

5. Note Proposal IDs from TX event logs (ProposalCreated → proposalId)

6. ETA = block.timestamp + 172800 (48h)

### Option 2 — Via Script

```
PRIVATE_KEY=0x... node scripts/propose_7.js
```

### After 48h: Execute

1. Etherscan Write Contract (same URL)
2. Function: `execute(uint256 proposalId)`
3. Execute for each of the 3 Proposal IDs

### Verification

Go to InfernoToken Read Contract:
https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#readContract

Function: `feeExempt(address)` — all 3 must return `true`:
- `0x6b36687b0cd4386fb14cf565B67D7862110Fed67` (Deployer)
- `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` (Treasury Safe)
- `0xaC5687547B2B21d80F8fd345B51e608d476667C7` (Community Safe)

---

## Proposal #8 — transferOwnership (after #7)

Transfers Governance ownership from Deployer EOA to Treasury Safe (3-of-5 Multisig).

**IMPORTANT:** After execution, only the 3-of-5 Multisig can create new proposals.
Ensure all 5 signers are reachable before executing!

### Calldata

```
Function: setOwner(address)
Selector: 0x13af4035
Target:   0xc43d48E7FDA576C5022d0670B652A622E8caD041 (Governance itself)
Data:     0x13af40350000000000000000000000005ad6193ed6e1e31ed10977e73e3b609acbfece3b
```

### Script

```
PRIVATE_KEY=0x... node scripts/propose_8.js
```

---

## After All Proposals Executed

- [ ] Update `docs/wiki/transparency.html` — Proposals #7/#8 → Executed
- [ ] Update `docs/TODO.md` — mark both as done
- [ ] Verify on-chain with Etherscan Read Contract
- [ ] Announce on Telegram: governance decentralized
