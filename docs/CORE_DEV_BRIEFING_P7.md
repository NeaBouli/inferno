# Core Dev Briefing — Proposals #7 + #8

**Date:** 16.03.2026
**Priority:** CRITICAL (Proposal #7) + HIGH (Proposal #8)

---

## Proposal #7 — setFeeExempt (CRITICAL)

**Problem:** Deployer, Treasury Safe, and Community Safe are NOT feeExempt.
Every transfer from these wallets costs 3.5% in burn + fees.

**Solution:** 3 Governance Proposals:
- `setFeeExempt(0x6b36..., true)` — Deployer
- `setFeeExempt(0x5ad6..., true)` — Treasury Safe
- `setFeeExempt(0xaC56..., true)` — Community Safe

**Executor:** A.K. (Governance Owner / Deployer)
**Script:** `scripts/propose_7.js`
**Guide:** `docs/PROPOSAL_7_EXECUTION.md`
**Calldata:** `docs/PROPOSAL_7_CALLDATA.md`
**Selector:** `0x8ebfc796` (verified)
**Timelock:** 48h after propose() → then execute()

### Review Checklist

```
[ ] Calldata verified and correct
[ ] Target addresses verified and correct
[ ] Deployer wallet ready (MetaMask / hardware)
[ ] Agree to execute
```

---

## Proposal #8 — setOwner (after #7)

**What:** Governance Ownership: Deployer EOA → Treasury Safe (3-of-5)
**Effect:** After execute, only 3-of-5 Multisig can create new proposals
**Script:** `scripts/propose_8.js`
**Target:** Governance Contract itself (`0xc43d48E7FDA576C5022d0670B652A622E8caD041`)
**Selector:** `0x13af4035` (setOwner)

### Review Checklist

```
[ ] All 5 signers available and hardware wallets ready
[ ] Treasury Safe address 0x5ad6... confirmed
[ ] Understand: no more single-key proposals after execution
[ ] Agree to execute
```

---

## Reference Documents

- `docs/PROPOSAL_7_CALLDATA.md` — encoded calldata for Etherscan TX Builder
- `docs/PROPOSAL_7_EXECUTION.md` — step-by-step guide
- `scripts/propose_7.js` — automated propose script
- `scripts/propose_8.js` — automated propose script (with 10s abort window)
