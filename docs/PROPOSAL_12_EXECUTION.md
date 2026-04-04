# Proposal #12 — setFeeExempt(LendingVault)

**Status:** PENDING — prepared 2026-04-04
**Priority:** CRITICAL — must execute BEFORE first deposit/borrow!
**Executor:** TreasurySafe 3-of-5 (0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b)

---

## Summary

| Field | Value |
|-------|-------|
| **Proposal ID** | 12 (after #11) |
| **Action** | `InfernoToken.setFeeExempt(LendingVault, true)` |
| **Target** | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` (InfernoToken) |
| **LendingVault** | `0x974305Ab0EC905172e697271C3d7d385194EB9DF` |
| **Calldata** | `0x8ebfc796000000000000000000000000974305ab0ec905172e697271c3d7d385194eb9df0000000000000000000000000000000000000000000000000000000000000001` |
| **Timelock** | 48 hours |

## Why This Is Critical

Without feeExempt, every `createOffer()`, `borrow()`, and `repay()` on LendingVault will lose 3.5% of IFR to fees. Lenders would lose IFR on deposit, borrowers on receiving IFR. **This proposal MUST be executed before any user interacts with LendingVault.**

---

## Step 1 — Propose (via TreasurySafe on Etherscan)

1. Go to Governance Write Contract:
   https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#writeContract

2. Connect MetaMask with **TreasurySafe signer** wallet

3. Function: `propose`
   - `target`: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
   - `data`: `0x8ebfc796000000000000000000000000974305ab0ec905172e697271c3d7d385194eb9df0000000000000000000000000000000000000000000000000000000000000001`

4. Submit transaction via TreasurySafe (needs 3-of-5 signatures)

---

## Step 2 — Execute (after 48h)

```bash
node -e "
require('dotenv').config();
const{ethers}=require('ethers');
const p=new ethers.providers.JsonRpcProvider(process.env.MAINNET_RPC_URL);
const s=new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY,p);
const gov=new ethers.Contract('0xc43d48E7FDA576C5022d0670B652A622E8caD041',
  ['function execute(uint256)'],s);
async function run(){
  console.log('Executing proposal #12...');
  const tx=await gov.execute(12);
  console.log('TX:',tx.hash);
  await tx.wait();
  console.log('Proposal #12 executed!');
}
run();
"
```

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
  const exempt=await token.feeExempt('0x974305Ab0EC905172e697271C3d7d385194EB9DF');
  console.log('LendingVault feeExempt:',exempt);
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
5. **Data:** `0xd6e1b3d400000000000000000000000077e99917eca8539c62f509ed1193ac36580a6e7b00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000044` + `8ebfc796000000000000000000000000974305ab0ec905172e697271c3d7d385194eb9df000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000`
6. Collect 3-of-5 signatures → Execute

---

## Both Proposals Can Be Submitted Simultaneously

Submit #11 and #12 in the same Safe batch transaction to save gas and time. Both have 48h timelock — execute both together after delay.
