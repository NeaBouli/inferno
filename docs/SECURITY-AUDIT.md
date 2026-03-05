# Security Audit Report — Slither Static Analysis

**Date:** 2026-02-15
**Tool:** Slither v0.11.5
**Solidity:** 0.8.20
**Scope:** All 6 initial contracts (mocks excluded)

---

## Result

| Metric | Value |
|--------|-------|
| Detectors | 101 |
| Initial Findings | 51 |
| Fixed | 15 |
| Remaining | 36 (all accepted — false positives / by design) |
| High Severity | 0 |
| Critical Vulnerabilities | 0 |

---

## Fixed Findings (15)

### 1. missing-zero-check (4 Findings) — BuybackVault

**Problem:** Constructor and setParams() without zero-address validation for burnReserve, treasury, guardian.

**Fix:** Added `require != address(0)` checks.

```solidity
// Constructor
require(_burnReserve != address(0), "burnReserve=0");
require(_treasury != address(0), "treasury=0");
require(_guardian != address(0), "guardian=0");

// setParams()
require(_treasury != address(0), "treasury=0");
```

### 2. reentrancy-benign (2 Findings) — BurnReserve

**Problem:** `totalBurned` was written after external `IERC20Burnable.burn()` call. Violates Checks-Effects-Interactions (CEI) pattern.

**Fix:** State update before external call:

```solidity
// Before:
IERC20Burnable(address(token)).burn(amount);
totalBurned += amount;  // State after external call

// After:
totalBurned += amount;  // State BEFORE external call
IERC20Burnable(address(token)).burn(amount);
```

### 3. immutable-states (5 Findings) — BurnReserve, BuybackVault, LiquidityReserve

**Problem:** `owner`, `burnReserve`, `guardian` are only set in the constructor but not declared as `immutable`.

**Fix:** Added `immutable` for:
- `BurnReserve.owner`
- `BuybackVault.owner`
- `BuybackVault.guardian`
- `BuybackVault.burnReserve`
- `LiquidityReserve.owner`

**Gas Savings:** ~2,100 gas per SLOAD (immutable is embedded in bytecode instead of storage read).

### 4. unindexed-event-address (4 Findings) — BuybackVault, LiquidityReserve

**Problem:** Pause/Unpause events without `indexed` keyword on address parameters.

**Fix:** Added `indexed`:

```solidity
event Paused(address indexed account);
event Unpaused(address indexed account);
```

---

## Accepted Findings (36) — False Positives / By Design

### incorrect-equality (3)

| Contract | Code | Assessment |
|----------|------|------------|
| BuybackVault | `ethBal == 0` | Correct — early return on empty vault |
| LiquidityReserve | `period == lastWithdrawPeriod` | Correct — period comparison |
| Vesting | `amt == 0` | Correct — nothing to release |

**Rationale:** Strict equality on balance/counter is safe. Slither warns about `== 0` because it can be manipulable via rounding on token balances — not applicable here since internal counters are compared.

### reentrancy-events (7)

Events after external calls. No security risk — events are purely informational and cannot be exploited for reentrancy attacks.

### timestamp (10)

All Timelock/Vesting/Lock contracts use `block.timestamp` for time comparisons. This is by design and the only sensible method for on-chain time control. Miner manipulation (+/-15s) is irrelevant with delays of hours/days.

### low-level-calls (1)

`Governance.execute()` uses `target.call(data)`. This is the standard pattern for Timelock governors (OpenZeppelin TimelockController uses the same pattern).

### missing-inheritance (1)

Slither suggests BurnReserve should implement IERC20Burnable. However, BurnReserve is not a token — it uses IERC20Burnable as an interface for external calls.

### naming-convention (15)

Underscore prefix (`_param`) is a common Solidity convention for constructor/function parameters to distinguish them from state variables. No security risk.

---

## Not Covered by Slither

Slither is a static analyzer. The following aspects require additional review:

| Area | Tool | Status |
|------|------|--------|
| Formal Verification | Certora / Halmos | Open |
| Fuzz Testing | Foundry / Echidna | Open |
| Manual Code Review | External Auditor | Recommended |
| Gas Profiling | Hardhat Gas Reporter | Open |
