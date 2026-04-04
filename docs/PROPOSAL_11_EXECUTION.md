# Proposal #11 — setFeeExempt(CommitmentVault)

**Status:** PENDING — prepared 2026-04-04
**Priority:** CRITICAL — must execute BEFORE first user lock!
**Executor:** TreasurySafe 3-of-5 (0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b)

---

## Summary

| Field | Value |
|-------|-------|
| **Proposal ID** | 11 (next available) |
| **Action** | `InfernoToken.setFeeExempt(CommitmentVault, true)` |
| **Target** | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` (InfernoToken) |
| **CommitmentVault** | `0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3` |
| **Calldata** | `0x8ebfc7960000000000000000000000000719d9eb28df7f5e63f91fac4bbb2d579c4f73d30000000000000000000000000000000000000000000000000000000000000001` |
| **Timelock** | 48 hours |

## Why This Is Critical

Without feeExempt, every `lock()` and `unlock()` call on CommitmentVault will lose 3.5% of IFR to fees. Users would receive less IFR than they locked. **This proposal MUST be executed before any user interacts with CommitmentVault.**

---

## Step 1 — Propose (via TreasurySafe on Etherscan)

1. Go to Governance Write Contract:
   https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#writeContract

2. Connect MetaMask with **TreasurySafe signer** wallet

3. Function: `propose`
   - `target`: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
   - `data`: `0x8ebfc7960000000000000000000000000719d9eb28df7f5e63f91fac4bbb2d579c4f73d30000000000000000000000000000000000000000000000000000000000000001`

4. Submit transaction via TreasurySafe (needs 3-of-5 signatures)

### Alternative — Via Script

```bash
node -e "
require('dotenv').config();
const{ethers}=require('ethers');
const p=new ethers.providers.JsonRpcProvider(process.env.MAINNET_RPC_URL);
const s=new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY,p);
const gov=new ethers.Contract('0xc43d48E7FDA576C5022d0670B652A622E8caD041',
  ['function propose(address,bytes) returns (uint256)','function owner() view returns (address)'],s);
async function run(){
  console.log('Owner:',await gov.owner());
  console.log('NOTE: Only TreasurySafe can propose. Use Gnosis Safe TX Builder.');
}
run();
"
```

**NOTE:** Since Governance.owner = TreasurySafe, proposals must be submitted via Gnosis Safe Transaction Builder, NOT directly from an EOA.

---

## Step 2 — Execute (after 48h)

After the 48-hour timelock passes:

```bash
node -e "
require('dotenv').config();
const{ethers}=require('ethers');
const p=new ethers.providers.JsonRpcProvider(process.env.MAINNET_RPC_URL);
const s=new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY,p);
const gov=new ethers.Contract('0xc43d48E7FDA576C5022d0670B652A622E8caD041',
  ['function execute(uint256)'],s);
async function run(){
  console.log('Executing proposal #11...');
  const tx=await gov.execute(11);
  console.log('TX:',tx.hash);
  await tx.wait();
  console.log('Proposal #11 executed!');
}
run();
"
```

**NOTE:** `execute()` can be called by anyone after the timelock — no Safe signature needed.

---

## Step 3 — Verify

```bash
node -e "
require('dotenv').config();
const{ethers}=require('ethers');
const p=new ethers.providers.JsonRpcProvider(process.env.MAINNET_RPC_URL);
const token=new ethers.Contract('0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
  ['function feeExempt(address) view returns (bool)'],p);
async function run(){
  const exempt=await token.feeExempt('0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3');
  console.log('CommitmentVault feeExempt:',exempt);
  console.log(exempt?'CONFIRMED':'NOT YET - check proposal status');
}
run();
"
```

---

## Gnosis Safe Transaction Builder

For submitting via Safe UI (https://app.safe.global):

1. Open TreasurySafe: `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
2. New Transaction → Transaction Builder
3. **To:** `0xc43d48E7FDA576C5022d0670B652A622E8caD041` (Governance)
4. **Value:** 0
5. **Data:** `0xd6e1b3d400000000000000000000000077e99917eca8539c62f509ed1193ac36580a6e7b000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000448ebfc7960000000000000000000000000719d9eb28df7f5e63f91fac4bbb2d579c4f73d3000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000`
6. Collect 3-of-5 signatures → Execute
