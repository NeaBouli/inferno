# Governance Proposal #7 — setFeeExempt

**Status:** 🔴 PENDING — CRITICAL
**Prepared:** 15.03.2026
**Priority:** SOFORT — ohne diesen Fix verliert jeder Transfer von Deployer/Safes 3.5%

## Target Contract

InfernoToken: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`

## Governance Contract

`0xc43d48E7FDA576C5022d0670B652A622E8caD041`

## Calls

### Call A — Deployer EOA

```javascript
const { ethers } = require('ethers');
const GOV = "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
const TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";

const gov = new ethers.Contract(GOV, [
  "function propose(address target, bytes calldata data) external returns (uint256)"
], signer);

const iface = new ethers.utils.Interface(["function setFeeExempt(address,bool)"]);

// Call A: Deployer
const calldata = iface.encodeFunctionData("setFeeExempt", [
  "0x6b36687b0cd4386fb14cf565B67D7862110Fed67", true
]);
const tx = await gov.propose(TOKEN, calldata);
console.log("Proposal TX:", tx.hash);
```

### Call B — Treasury Safe

```javascript
const calldata = iface.encodeFunctionData("setFeeExempt", [
  "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b", true
]);
const tx = await gov.propose(TOKEN, calldata);
```

### Call C — Community Safe

```javascript
const calldata = iface.encodeFunctionData("setFeeExempt", [
  "0xaC5687547B2B21d80F8fd345B51e608d476667C7", true
]);
const tx = await gov.propose(TOKEN, calldata);
```

## Encoded Calldata (raw)

For direct Gnosis Safe TX Builder use:

**setFeeExempt(Deployer, true):**
```
0x8ebfc7960000000000000000000000006b36687b0cd4386fb14cf565b67d7862110fed670000000000000000000000000000000000000000000000000000000000000001
```

**setFeeExempt(TreasurySafe, true):**
```
0x8ebfc7960000000000000000000000005ad6193ed6e1e31ed10977e73e3b609acbfece3b0000000000000000000000000000000000000000000000000000000000000001
```

**setFeeExempt(CommunitySafe, true):**
```
0x8ebfc796000000000000000000000000ac5687547b2b21d80f8fd345b51e608d476667c70000000000000000000000000000000000000000000000000000000000000001
```

## Timelock

- `propose()` → ETA = now + 48h
- After ETA: `execute(proposalId)` callable by anyone
- Guardian can `cancel(proposalId)` during timelock

## Verification (after Execute)

```javascript
const token = new ethers.Contract(TOKEN, [
  "function feeExempt(address) view returns (bool)"
], provider);

console.log(await token.feeExempt("0x6b36687b0cd4386fb14cf565B67D7862110Fed67")); // must be true
console.log(await token.feeExempt("0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b")); // must be true
console.log(await token.feeExempt("0xaC5687547B2B21d80F8fd345B51e608d476667C7")); // must be true
```

## After Execution

- [ ] Update `docs/wiki/transparency.html` — Proposal #7 status → Executed
- [ ] Update `docs/TODO.md` — mark as done
- [ ] Verify on-chain with script above
- [ ] Proceed with Proposal #8 (transferOwnership)

## Related

- Proposal #8: `transferOwnership(TreasurySafe)` — execute after #7
- Function selector: `setFeeExempt(address,bool)` = `0x8ebfc796`
