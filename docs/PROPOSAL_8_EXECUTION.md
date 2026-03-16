# Proposal #8 — transferOwnership to Treasury Safe

**Status:** PENDING (propose after Proposal #7 executed)
**Prepared:** 17.03.2026
**Dependency:** Proposal #7 must be executed first (Deployer feeExempt)

---

## What It Does

Transfers Governance ownership from Deployer EOA to Treasury Safe (3-of-5 Multisig).

| Before | After |
|--------|-------|
| `Governance.owner()` = `0x6b36...Fed67` (Deployer EOA) | `Governance.owner()` = `0x5ad6...cE3b` (Treasury Safe 3-of-5) |
| Single key can propose | 3-of-5 multisig required to propose |

**After execution:**
- Only Treasury Safe (3-of-5) can create new governance proposals
- Deployer has NO more governance control — permanently
- All 5 signers must be reachable for future governance actions

---

## Prerequisites

- [ ] Proposal #7 executed (Deployer + Safes are feeExempt)
- [ ] All 5 signers reachable: A.K. / M.G. / A.M. / Y.K. / A.P.
- [ ] Treasury Safe tested — can sign and execute transactions
- [ ] Team aligned — this is irreversible

---

## Calldata

```
Function: setOwner(address)
Selector: 0x13af4035
Target:   0xc43d48E7FDA576C5022d0670B652A622E8caD041 (Governance calls itself)
Param:    0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b (Treasury Safe)
Data:     0x13af40350000000000000000000000005ad6193ed6e1e31ed10977e73e3b609acbfece3b
```

---

## Step 1: Propose

```bash
PRIVATE_KEY=0x... node scripts/propose_8.js
```

The script performs 3 safety checks:
1. Signer = Deployer
2. Current owner = Deployer (not already transferred)
3. Proposal #7 executed (Deployer is feeExempt)

Then waits 15 seconds before submitting (Ctrl+C to abort).

---

## Step 2: Wait 48h

After proposal submission, the 48-hour timelock begins.
The script outputs the exact ETA.

---

## Step 3: Execute (after ETA)

**Option A — Via script:**
```bash
PROPOSAL_ID=<id> PRIVATE_KEY=0x... node scripts/execute-proposal.js --network mainnet
```

**Option B — Via Etherscan:**
1. Go to: https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#writeContract
2. Connect Deployer wallet
3. Function: `execute(uint256 proposalId)`
4. Enter Proposal ID from Step 1

---

## Step 4: Verify

**Via Etherscan Read Contract:**
https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041#readContract

Function: `owner()` — must return `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`

**Via CLI:**
```bash
node -e "
require('dotenv').config();
const{ethers}=require('ethers');
const p=new ethers.providers.JsonRpcProvider(process.env.RPC_URL||'https://ethereum-rpc.publicnode.com');
const g=new ethers.Contract('0xc43d48E7FDA576C5022d0670B652A622E8caD041',['function owner() view returns (address)'],p);
g.owner().then(function(o){
  console.log('Owner:',o);
  console.log(o.toLowerCase()==='0x5ad6193ed6e1e31ed10977e73e3b609acbfece3b'?'Treasury Safe':'NOT Treasury Safe');
});"
```

---

## After Execution Checklist

- [ ] Verify `owner()` = Treasury Safe on Etherscan
- [ ] Update `docs/wiki/transparency.html` — Governance owner updated
- [ ] Update `docs/wiki/wallet-guide.html` — Deployer card: owner transferred
- [ ] Update `docs/TODO.md` — mark Proposal #8 as executed
- [ ] Announce on Telegram: governance decentralized to 3-of-5 multisig
- [ ] Test: Treasury Safe can create a new proposal (dry run on testnet first)
