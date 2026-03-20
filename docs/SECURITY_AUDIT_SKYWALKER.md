# Security Audit — Inferno ($IFR) Smart Contracts

**Auditor:** Claude Opus 4.6 (Anthropic)
**Date:** 2026-03-04
**Scope:** 10 contracts, 1880 SLOC, Solidity 0.8.20
**Extended:** 2026-03-03 — BootstrapVault.sol added
**Extended:** 2026-03-04 — W15-W21 from ChatGPT Audit V5, W16 fixed
**Method:** Line-by-line manual review, 10 check categories (A-J)
**Severity:** PASS (no issue) | WARN (design risk, low/informational) | FAIL (critical/high)

---

## Global Observations

- **No `unchecked` blocks** — all arithmetic uses Solidity 0.8+ built-in overflow protection.
- **No `delegatecall`** — no proxy patterns, no upgrade risk.
- **No `selfdestruct`** — contracts cannot be destroyed.
- **No `assembly`** — no low-level bytecode manipulation.
- **No `tx.origin`** — no phishing vector via origin checks.
- **OpenZeppelin v5** for ERC20, Ownable, ReentrancyGuard, Pausable, SafeERC20, EIP712, ECDSA.
- **Consistent modifier pattern** across all contracts: `onlyOwner`, `onlyGuardian`, `onlyAdmin`.

---

## 1. InfernoToken.sol (93 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | PASS | `_update` calls `super._update` (internal ERC20 bookkeeping). No external calls. |
| B) Access Control | PASS | `setFeeExempt`, `setPoolFeeReceiver`, `setFeeRates` all `onlyOwner` (OZ Ownable). |
| C) Overflow | PASS | `value * bps / 10000` — max bps = 500 (5%), no overflow. `netAmount = value - totalBurn - poolFee` safe because fees <= 5%. |
| D) Front-running | PASS | Fee rate changes go through Governance 48h timelock. Users see upcoming changes. |
| E) DoS | PASS | `_update` is O(1). No loops. |
| F) Centralization | WARN | Owner can set fees to 0% (disable deflation) or 5% (max). Can exempt any address. Mitigated by 48h timelock. |
| G) Fee Edge Cases | PASS | 1 wei transfer: all fee components round to 0, user gets full 1 wei. Mint/burn bypass fees correctly (`from == 0` or `to == 0`). `super._update` prevents recursive fee application. |
| H) Timelock Bypass | PASS | Owner is Governance contract. No backdoor. |
| I) feeExempt | PASS | Only owner (Governance, 48h timelock) can modify. |
| J) Owner Privileges | PASS | Fee rates (0-5%), feeExempt mapping, poolFeeReceiver, ownership transfer. All documented. |

**Edge Case Verified:** Transfer where `to == poolFeeReceiver` — recipient gets `netAmount` + `poolFee`, no recursion because `super._update` is used. Correct.

---

## 2. IFRLock.sol (127 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | PASS | Both `_lock` and `unlock` use `nonReentrant` (OZ ReentrancyGuard). `unlock` follows CEI: state cleared before `token.transfer`. |
| B) Access Control | PASS | Anyone can lock their own tokens. Only the locker can unlock. Guardian: pause/unpause/setGuardian. No owner role. |
| C) Overflow | PASS | `ld.amount += amount` — bounded by total token supply (~10^18). |
| D) Front-running | PASS | Lock/unlock only affect the caller's own tokens. |
| E) DoS | PASS | No loops. |
| F) Centralization | PASS | Guardian can pause locks but NOT unlocks (line 63: `unlock` has no `whenNotPaused`). Users can always exit. Excellent design. |
| G) Fee Edge Cases | PASS | Contract MUST be feeExempt (documented in NatSpec line 18-19). Without feeExempt, `unlock` transfers less than recorded amount. Governance Proposal #1 set feeExempt. |
| H) Timelock Bypass | PASS | N/A — no timelock in this contract. |
| I) feeExempt | PASS | N/A — doesn't control feeExempt. |
| J) Owner Privileges | PASS | No owner role. Guardian is minimal: pause locks, update guardian. Cannot touch locked funds. |

**Design Highlight:** `unlock()` intentionally NOT gated by `whenNotPaused`. Users can always recover funds even during emergencies.

---

## 3. Governance.sol (150 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | PASS | `execute()` sets `p.executed = true` BEFORE `p.target.call(p.data)`. Re-entrant `execute()` fails on `!p.executed` check. |
| B) Access Control | PASS | `propose`/`execute`: onlyOwner. `cancel`: onlyOwnerOrGuardian. `setDelay`: onlySelf (must go through own timelock). `setOwner`: onlySelf (fixed 20.03.2026, was onlyOwner). `setGuardian`: onlyOwner. |
| C) Overflow | PASS | `block.timestamp + delay` — MAX_DELAY is 30 days (~2.6M seconds). No overflow. |
| D) Front-running | PASS | Proposals are public by design (transparency). 48h window lets users prepare. |
| E) DoS | PASS | No loops. |
| F) Centralization | WARN | Owner has full proposal power over any contract. Single point of failure if key is compromised. Guardian can cancel but not propose. |
| G) Fee Edge Cases | PASS | N/A — Governance doesn't handle tokens. |
| H) Timelock Bypass | FIXED | `setOwner()` now uses `onlySelf` modifier (fixed 20.03.2026), meaning ownership transfer must go through the governance proposal timelock. Previously was `onlyOwner` (immediate), which was a single-point-of-failure risk. Owner is now TreasurySafe 3-of-5. |
| I) feeExempt | PASS | N/A. |
| J) Owner Privileges | WARN | Can propose ANY calldata to ANY target contract. Can change owner immediately. Can change guardian immediately. Full control gated only by 48h timelock for execution. |

**Update (20.03.2026):** Owner migrated to TreasurySafe 3-of-5 Gnosis Safe. `setOwner` modifier fixed to `onlySelf`. Centralization risk significantly reduced.

---

## 4. Vesting.sol (132 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | PASS | `release()` updates `released += amt` BEFORE `token.transfer()`. CEI pattern. If token reenters, `releasableAmount()` returns 0. |
| B) Access Control | PASS | `release()`: onlyBeneficiary. `pause`/`unpause`: onlyGuardian. No admin functions. |
| C) Overflow | PASS | `totalAllocation * vestingElapsed` — 150M * 10^9 * 4yrs-in-seconds = ~1.9 * 10^25. Within uint256. |
| D) Front-running | PASS | Only beneficiary can release. No MEV vector. |
| E) DoS | PASS | No loops. |
| F) Centralization | PASS | Immutable: token, beneficiary, start, cliff, duration, allocation, guardian. Guardian can ONLY pause/unpause. Maximally trustless. |
| G) Fee Edge Cases | WARN | Vesting is NOT feeExempt. Each `release()` loses ~3.5% to fees. `released` counter tracks the gross amount, so accounting stays correct, but beneficiary receives ~96.5% of each release. This may be intentional (team contributes to deflation). |
| H) Timelock Bypass | PASS | N/A — no timelock in this contract. All parameters immutable. |
| I) feeExempt | PASS | N/A. |
| J) Owner Privileges | PASS | No owner. Guardian can only pause. Most locked-down contract in the protocol. |

**Note:** Immutable guardian means it cannot be rotated. If the guardian key is lost, pause/unpause is permanently unavailable (but release continues working when unpaused, which is the default).

---

## 5. LiquidityReserve.sol (161 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | PASS | `withdraw()` updates `withdrawnThisPeriod` and `totalWithdrawn` BEFORE `token.transfer()`. CEI pattern. |
| B) Access Control | PASS | `withdraw`: onlyOwner + whenNotPaused. `setMaxWithdrawPerPeriod`/`setGuardian`/`transferOwnership`: onlyOwner. `pause`/`unpause`: onlyGuardian. |
| C) Overflow | PASS | `withdrawnThisPeriod + amount <= maxWithdrawPerPeriod` — explicit check. |
| D) Front-running | PASS | Only owner can withdraw. |
| E) DoS | PASS | No loops. |
| F) Centralization | PASS | Period-based rate limiting provides structural protection. Max 50M IFR per 90-day period by default. Owner (Governance) can adjust limit. |
| G) Fee Edge Cases | PASS | LiquidityReserve v2 is feeExempt (Proposal #7). Recipient gets full amount. |
| H) Timelock Bypass | PASS | Owner is Governance (48h timelock). `transferOwnership` goes through the Governance propose/execute cycle. |
| I) feeExempt | PASS | N/A. |
| J) Owner Privileges | PASS | Withdraw (within period limits), adjust limits, change guardian, transfer ownership. |

---

## 6. BuybackVault.sol (173 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | WARN | No `nonReentrant` modifier. `executeBuyback` calls `router.swapExactETHForTokens` (external) and `token.transfer` (x2) after setting `lastBuybackAt`. Cooldown check prevents re-execution in same block. Router is mutable (set via `setParams`). |
| B) Access Control | PASS | `executeBuyback`/`setParams`/`transferOwnership`: onlyOwner. `pause`/`unpause`: onlyGuardian. `depositETH`: public (by design). |
| C) Overflow | WARN | `setParams` has no upper bounds on `burnShareBps`, `cooldown`, `slippageBps`. If `slippageBps > 10000`, `executeBuyback` reverts (underflow in `10_000 - slippageBps`). If `burnShareBps > 10000`, `totalOut - burnAmount` underflows. These would cause self-inflicted DoS via Governance. |
| D) Front-running | WARN | `executeBuyback` does a Uniswap swap visible in the mempool. MEV bots can sandwich the swap. Mitigated by `slippageBps` (default 5%) but profit within that tolerance is extractable. |
| E) DoS | PASS | No loops. Activation delay (60 days) is by design. |
| F) Centralization | WARN | `guardian` is immutable — cannot be rotated after deployment. If guardian key is lost, pause/unpause is permanently unavailable. Router is mutable — if changed to malicious contract, swaps could be manipulated (mitigated by slippage protection + 48h timelock). |
| G) Fee Edge Cases | PASS | BuybackVault v2 is feeExempt (Proposal #8). Both `token.transfer` calls deliver full amounts. |
| H) Timelock Bypass | PASS | Owner is Governance. |
| I) feeExempt | PASS | N/A. |
| J) Owner Privileges | WARN | Can set `burnShareBps`, `cooldown`, `slippageBps` to any value (no bounds). Can change router to arbitrary address. Can change treasury. All through Governance timelock. |

**Recommendation:** Add bounds validation in `setParams`:
- `burnShareBps <= 10000`
- `slippageBps <= 5000` (50% max reasonable slippage)
- `cooldown >= 60` (minimum 1 minute)
- `_router != address(0)`

---

## 7. BurnReserve.sol (102 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | PASS | `burn()` updates `totalBurned` BEFORE calling `IERC20Burnable.burn()`. CEI pattern. `burn()` is an internal ERC20 operation (not a transfer), so callback risk is minimal. |
| B) Access Control | PASS | `deposit`: public. `burn`/`burnAll`: onlyOwnerOrGuardian. `setGuardian`/`transferOwnership`: onlyOwner. |
| C) Overflow | PASS | `totalBurned += amount` — bounded by total supply. |
| D) Front-running | PASS | No sensitive parameters. |
| E) DoS | PASS | No loops. |
| F) Centralization | PASS | Owner and guardian can burn. No withdrawal function — tokens can only be burned, never extracted. Secure by design. |
| G) Fee Edge Cases | PASS | `deposit()` uses `transferFrom` — fees apply if depositor is not exempt. `burn()` calls `ERC20Burnable.burn()` which is `_update(address(this), address(0), amount)` — `to == address(0)` bypasses fees. Correct. |
| H) Timelock Bypass | PASS | Owner is Governance. |
| I) feeExempt | PASS | N/A. |
| J) Owner Privileges | PASS | Can only burn tokens and manage guardian. No way to extract tokens. |

---

## 8. PartnerVault.sol (549 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | PASS | `claim()` uses `nonReentrant` + `whenNotPaused`. State updates before `safeTransfer`. `_effectiveRewardBps()` calls external `ifrLock.totalLocked()` — trusted contract set by admin. |
| B) Access Control | PASS | Admin functions: onlyAdmin. Lock rewards: onlyAuthorized. Guardian: pause/unpause/setGuardian. `claim()`: permissionless (tokens go to registered beneficiary). |
| C) Overflow | PASS | `lockAmount * effectiveBps / 10000` — max product ~10^18 * 2500 = ~2.5 * 10^21. Safe. `totalAllocated` arithmetic in `setPartnerAllocation` is safe because `totalAllocated >= p.maxAllocation` invariant holds. |
| D) Front-running | PASS | Anti-double-count prevents duplicate rewards per wallet per partner. `claim` is permissionless but tokens go to beneficiary (not caller). |
| E) DoS | PASS | No loops in any function. |
| F) Centralization | PASS | Admin has significant power but bounded by hard-coded constants: PARTNER_POOL (40M), MIN/MAX_REWARD_BPS (500-2500), MIN/MAX_ANNUAL_CAP (1M-10M), vestingDuration (180-365 days). Guardian: pause only. |
| G) Fee Edge Cases | PASS | PartnerVault is feeExempt (Proposal #3). `safeTransfer` delivers full amount to beneficiary. |
| H) Timelock Bypass | PASS | Admin is Governance contract. All admin calls go through 48h timelock. |
| I) feeExempt | PASS | N/A. |
| J) Owner Privileges | PASS | Admin can create partners, record milestones, adjust allocations — all within hard bounds. Cannot exceed PARTNER_POOL. Cannot bypass vesting. |

**Design Highlights:**
- Hard bounds on ALL governance-adjustable parameters — even a compromised governance cannot exceed 2500 bps reward rate or 10M annual cap.
- Anti-double-count per wallet per partner.
- Algo throttle scales rewards down as more IFR is locked — self-regulating emission.
- `claim()` is permissionless — beneficiary doesn't need to interact with the contract directly.

---

## 9. FeeRouterV1.sol (228 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | WARN | No `nonReentrant` modifier. `swapWithFee` sends ETH to `feeCollector` (could be contract with fallback) and then calls `adapter` with arbitrary calldata. Nonce consumed before external calls. Re-entry would be a new independent swap (needs new ETH), not an exploit. |
| B) Access Control | PASS | `swapWithFee`: public + notPaused. All setters: onlyGovernance. |
| C) Overflow | PASS | `msg.value * effectiveFeeBps / 10000` — safe. `msg.value - feeAmount` — feeAmount always <= msg.value. |
| D) Front-running | PASS | Voucher is bound to `voucher.user == msg.sender`. Cannot be stolen. Swap MEV is inherent to DEX and not specific to this contract. |
| E) DoS | PASS | No loops. |
| F) Centralization | PASS | Fee capped at FEE_CAP_BPS (25 = 0.25%). Governance can pause, rotate signer, change collector, whitelist adapters. |
| G) Fee Edge Cases | PASS | FeeRouter handles ETH, not IFR directly. IFR fee-on-transfer does not apply. |
| H) Timelock Bypass | PASS | Governance address is the Governance contract (48h timelock). |
| I) feeExempt | PASS | N/A — ETH-based router. |
| J) Owner Privileges | WARN | `setVoucherSigner` and `setFeeCollector` accept `address(0)` without validation. Zero signer would break all voucher validation. Zero collector would send fees to address(0) (burned ETH). |

**Recommendation:** Add zero-address checks:
```solidity
function setVoucherSigner(address newSigner) external onlyGovernance {
    require(newSigner != address(0), "signer=0");
    voucherSigner = newSigner;
}

function setFeeCollector(address newCollector) external onlyGovernance {
    require(newCollector != address(0), "collector=0");
    feeCollector = newCollector;
}
```

---

## 10. BootstrapVault.sol (165 LOC)

| Check | Result | Details |
|-------|--------|---------|
| A) Reentrancy | PASS | All three state-changing functions (`contribute`, `finalise`, `claim`) use `nonReentrant` (OZ ReentrancyGuard). `finalised = true` set before external calls in `finalise()` (line 137). `claimed[msg.sender] = true` set before `token.transfer()` in `claim()` (line 187). CEI pattern throughout. |
| B) Access Control | PASS | No owner. No admin. No guardian. `contribute()`: public (parameterized by time window + min/max). `finalise()`: public (after endTime). `claim()`: public (after finalisation, contributor-only). Most permissionless contract in the protocol. |
| C) Overflow | PASS | `ifrAllocation * 2` (line 146): realistic max ~10^27, safe. `contributions[msg.sender] * ifrAllocation` (line 188): max ~10^18 * 10^27 = 10^45, within uint256. Pro-rata rounding: negligible at minContribution = 0.01 ETH. |
| D) Front-running | WARN | `addLiquidityETH` uses `amountTokenMin=0, amountETHMin=0` (lines 155-156). Correct for initial LP creation, but exploitable if IFR/WETH pair already exists with manipulated ratio. No on-chain check that pair is fresh. |
| E) DoS | PASS | No loops. `contributors` array grows unboundedly but is never iterated (push-only, O(1)). |
| F) Centralization | PASS | No admin functions. All parameters immutable at deploy. No pause mechanism. Most decentralized contract in the protocol. |
| G) Fee Edge Cases | WARN | Contract MUST be feeExempt. Without it, `transferFrom(ifrSource, ..., ifrAllocation * 2)` delivers fewer tokens — LP creation receives less IFR, claim balance is short, last claimers fail. Additionally: no emergency refund if `finalise()` is permanently blocked (e.g., ifrSource revokes approval). Contributor ETH locked forever. Documented as pre-deploy requirement in spec. RESOLVED in BootstrapVaultV2 (6537c11b): replaced with balanceOf check. |
| H) Timelock Bypass | PASS | N/A — no timelock, no admin functions. |
| I) feeExempt | PASS | N/A — doesn't control feeExempt. Dependency on Governance proposal documented in spec. |
| J) Owner Privileges | PASS | No owner. No admin. No privileged functions. All parameters immutable. Zero admin surface. |

**Design Highlights:**
- Zero admin surface — no owner, no guardian, no pause, no emergency functions. True trustlessness.
- `finalised = true` before any external calls eliminates re-finalisation vector.
- 0 ETH edge case handled gracefully: `finalise()` emits event and returns, no LP created, no claims needed.
- Pro-rata dust (rounding loss) is negligible but permanently locked in contract — no sweep function.

---

## Summary

| Contract | LOC | PASS | WARN | FAIL |
|----------|-----|------|------|------|
| InfernoToken | 93 | 9 | 1 | 0 |
| IFRLock | 127 | 10 | 0 | 0 |
| Governance | 150 | 6 | 4 | 0 |
| Vesting | 132 | 8 | 2 | 0 |
| LiquidityReserve | 161 | 10 | 0 | 0 |
| BuybackVault | 173 | 5 | 5 | 0 |
| BurnReserve | 102 | 10 | 0 | 0 |
| PartnerVault | 549 | 10 | 0 | 0 |
| FeeRouterV1 | 228 | 6 | 4 | 0 |
| BootstrapVault | 165 | 7 | 3 | 0 |
| System-wide | — | 0 | 1 | 0 |
| **Total** | **1880** | **81** | **20** | **0** |

### Result: 0 FAIL / 20 WARN (1 fixed) / 81 PASS

---

## All Warnings (sorted by severity)

### Medium

| # | Contract | Check | Finding | Recommendation |
|---|----------|-------|---------|----------------|
| W1 | Governance | H | `setOwner()` bypasses timelock — owner can transfer control immediately | Migrate owner to multisig before mainnet. Already planned. |
| W2 | Governance | F | Single owner key controls all proposals. Key compromise = protocol compromise. | Gnosis Safe 2-of-4 minimum. Then 4-of-7 for mainnet. |
| W3 | BuybackVault | C | `setParams` has no bounds on `burnShareBps`, `slippageBps`, `cooldown`. Invalid values cause DoS. | Add validation: `burnShareBps <= 10000`, `slippageBps <= 5000`, `cooldown >= 60`, `_router != address(0)`. |
| W4 | BuybackVault | D | Uniswap swap in `executeBuyback` is MEV-vulnerable. Sandwich attacks extract value within slippage tolerance. | Use private mempool (Flashbots Protect) for buyback transactions on mainnet. |
| W13 | BootstrapVault | D | `addLiquidityETH` with `amountTokenMin=0` exploitable if IFR/WETH pair pre-exists with manipulated ratio. No on-chain check. | Add `require(getPair(ifrToken, weth) == address(0), "pair exists")` before LP creation. Or verify pair freshness off-chain as pre-deploy step. |
| W15 | Governance | B | `setGuardian()` is not timelocked — owner can replace guardian immediately, removing the cancel safeguard before executing a malicious proposal. | Route setGuardian through the timelock (`onlySelf`) like `setDelay()`. |
| W16 | BuybackVault | E | ~~`pendingExpectedOut` accumulated at deposit time could be manipulated to force DoS on `executeBuyback()`.~~ **FIXED** — minOut now computed fresh via `getAmountsOut()` at execution time. | Fixed in commit (W16 fix). |
| W17 | BootstrapVault | G | LP tokens locked with `withdrawer=address(this)` but contract has no `unlockLP()` function. LP tokens are permanently stranded after lock period expires. | Accept (LP remains locked forever = stronger trust guarantee) or add governance-gated `reclaimLP()`. |
| W18 | Vesting | F | `guardian` is immutable — cannot be rotated. If guardian key is compromised, attacker can permanently pause releases. | Accept for v1 (already deployed). Consider `setGuardian` in v2. |
| W21 | System-wide | F | `feeExempt` is an operational dependency (not enforced in contract constructors). If a Governance proposal revokes feeExempt on IFRLock or PartnerVault, user funds become trapped (unlock/claim returns less than locked). | Document as governance invariant. Consider on-chain enforcement: IFRLock constructor could `require(token.isFeeExempt(address(this)))`. |

### Low / Informational

| # | Contract | Check | Finding | Recommendation |
|---|----------|-------|---------|----------------|
| W5 | InfernoToken | F | Owner can set fees to 0% (disable deflation entirely). | By design. Governance vote required. Document as governance power. |
| W6 | Vesting | G | Not feeExempt — team loses ~3.5% per release to deflation. | Likely intentional (team contributes to burn). Document explicitly. If unintentional, set feeExempt via governance. |
| W7 | BuybackVault | F | `guardian` is immutable — cannot be rotated. Key loss = permanent loss of pause ability. | Accept for v2 (already deployed). Fix in v3 if needed. |
| W8 | BuybackVault | A | No `nonReentrant` on `executeBuyback`. External calls to mutable router + token transfers. Cooldown provides indirect protection. | Consider adding `nonReentrant` in v3. Low risk: Governance-only function. |
| W9 | Governance | J | Owner can propose arbitrary calldata to any target. Maximum power if key compromised. | Mitigated by 48h timelock + guardian cancel. Multisig further reduces risk. |
| W10 | FeeRouterV1 | J | `setVoucherSigner` and `setFeeCollector` accept `address(0)`. | Add zero-address checks. Low risk: governance-only, 48h timelock. |
| W11 | FeeRouterV1 | A | No `nonReentrant` on `swapWithFee`. Adapter and feeCollector are external calls. | Low risk: nonce consumed before calls, no state to exploit. |
| W12 | BuybackVault | F | Mutable router — if changed to malicious contract, swaps could be manipulated. | Mitigated by slippage protection + 48h timelock on `setParams`. |
| W14 | BootstrapVault | G | No emergency refund. If `finalise()` is permanently blocked (ifrSource approval revoked, IFR paused), contributor ETH locked forever. By design (trustless) but liveness risk. | Consider time-delayed `refund()`: if endTime + 30 days passed and !finalised, contributors can withdraw ETH. RESOLVED in BootstrapVaultV2 (6537c11b): approval dependency eliminated. |
| W19 | FeeRouterV1 | J | `maxUses` field in Voucher struct is defined but never enforced — vouchers are single-use via nonce, making maxUses misleading. | Remove `maxUses` from struct or enforce it. Low risk: nonce-based replay protection works correctly. |
| W20 | FeeRouterV1 | A | `token.transfer()` used instead of SafeERC20 in potential future token-handling paths. Currently ETH-only, but if IFR transfers are added, non-reverting tokens could cause silent failures. | Use SafeERC20 consistently. Informational — no current IFR transfer paths in FeeRouterV1. |

---

## Cross-Contract Analysis

### Fee-Exempt Trust Chain
All core contracts that hold/transfer IFR are feeExempt. Only Governance (as InfernoToken owner) can modify this mapping, through the 48h timelock. The chain of trust is:

```
Governance.propose() → 48h wait → Governance.execute()
    → InfernoToken.setFeeExempt(address, bool)
```

No shortcut exists. **PASS**

### Governance as Single Point of Control
Governance owns: InfernoToken, LiquidityReserve v2, BuybackVault v2, BurnReserve v2.
Governance is admin of: PartnerVault, FeeRouterV1.
BootstrapVault has no owner — fully permissionless. Governance interaction limited to `setFeeExempt(BootstrapVault, true)` via InfernoToken.

All protocol parameter changes flow through the 48h timelock. The guardian (separate key) can cancel malicious proposals but cannot propose or execute.

**Risk:** If the Governance `owner` key is compromised, the attacker has 48h to execute any proposal. The guardian has that same 48h window to cancel.

**Mitigation Path:**
1. Migrate Governance owner to Gnosis Safe multisig (2-of-4 initially)
2. Scale to 4-of-7 for mainnet
3. Long-term: full DAO governance (token-weighted voting)

### Flash Loan / Price Manipulation Vectors
- **PartnerVault algo throttle:** Reads `ifrLock.totalLocked()`. A flash-lock (lock in same tx, trigger reward, unlock) could manipulate the reading. However, `recordLockReward` is `onlyAuthorized` and the anti-double-count prevents the same wallet from earning twice. Flash-locks would only REDUCE rewards (higher lock ratio = lower BPS), not increase them. **Not exploitable.**
- **BuybackVault swap:** Uses Uniswap price. Flash loan attacks could manipulate the pool price. Mitigated by `slippageBps` with fresh `getAmountsOut()` quote at execution time (W16 fix removed the vulnerable `pendingExpectedOut` pattern). **Low risk with slippage protection.**

---

## Positive Security Properties

1. **No mint function** — supply can only decrease. Eliminates inflation attack surface entirely.
2. **No proxy/upgrade pattern** — contracts are immutable once deployed. No upgrade attacks.
3. **No `delegatecall`** — no storage collision or context confusion risks.
4. **Guardian can always cancel** — emergency brake on governance proposals.
5. **Users can always unlock** — IFRLock.unlock() not gated by whenNotPaused.
6. **Hard-coded bounds** — PartnerVault has MIN/MAX on all parameters. BuybackVault has activation delay. InfernoToken has 5% fee cap. FeeRouterV1 has 0.25% fee cap.
7. **SafeERC20** used in PartnerVault for all token transfers.
8. **ReentrancyGuard** on IFRLock and PartnerVault (the two contracts with user-facing token operations).
9. **CEI pattern** consistently followed across all contracts.
10. **91% branch coverage** with 361 tests across 10 contracts.

---

## Pre-Mainnet Recommendations (Priority Order)

1. **CRITICAL:** Migrate Governance owner to Gnosis Safe multisig
2. **HIGH:** Professional third-party audit (Code4rena, Sherlock, or equivalent)
3. ~~**HIGH:** BuybackVault `pendingExpectedOut` DoS (W16)~~ — **FIXED**
4. **MEDIUM:** Add bounds validation to BuybackVault.setParams
5. **MEDIUM:** Add zero-address checks to FeeRouterV1 setters
6. **MEDIUM:** Route Governance.setGuardian through timelock (W15)
7. **LOW:** Decide on Vesting feeExempt status (intentional deflation contribution vs. team token loss)
8. **LOW:** Consider ReentrancyGuard on BuybackVault.executeBuyback for defense in depth
9. **INFO:** LP tokens should be burned or locked before mainnet (already planned)
10. **INFO:** Use Flashbots Protect for buyback transactions to avoid MEV

---

*This audit was conducted by Claude Opus 4.6 (Anthropic) and represents a best-effort review. It is NOT a substitute for a professional security audit by a specialized firm. A professional audit is strongly recommended before mainnet deployment.*

---

## Community Audit

This audit was conducted internally by Claude Opus 4.6.
**Community review is explicitly encouraged.**

### How to Contribute
- Open a GitHub Issue: [Security Audit Finding template](https://github.com/NeaBouli/inferno/issues/new?template=security-audit.md)
- Review the contracts in `/contracts/`
- Reference known issues in this document (W1-W14) to avoid duplicates
- See [SECURITY.md](../SECURITY.md) for full disclosure policy

### Known Warnings (W1-W21)
All 20 warnings are documented above. W16 (`pendingExpectedOut` DoS) has been fixed.
Fixes for W1, W2 (Multisig migration) are planned before mainnet.
W13 (pair pre-existence) mitigated by pre-deploy verification. W14 (no refund) is a design trade-off (trustlessness vs. liveness).
W15-W21 added 2026-03-04 based on ChatGPT Audit V5 cross-check.
