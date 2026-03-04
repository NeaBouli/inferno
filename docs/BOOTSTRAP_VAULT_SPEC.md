# BootstrapVault — Technical Specification

**Version:** 1.0
**Date:** 2026-03-03
**Status:** Approved — Ready for Implementation
**Author:** IFR Protocol

---

## Overview

The BootstrapVault is a trustless, permissionless smart contract that enables
community-driven initial liquidity creation for the IFR token without any team
capital. ETH contributed by the community is automatically paired with IFR tokens
from the LiquidityReserve to create the initial Uniswap V2 liquidity pool.

No admin keys. No team ETH. No presale. Pure community bootstrap.

---

## Design Principles

- **Trustless:** No admin can modify, pause, or withdraw during bootstrap phase
- **Permissionless:** Anyone can contribute ETH; anyone can trigger finalisation
- **Transparent:** All contributions visible on-chain in real time
- **Fair:** Pro-rata IFR distribution based on ETH contribution
- **No Soft Cap:** LP is always created regardless of ETH amount raised
- **Deflationary-safe:** Bootstrap contributions are fee-exempt

---

## Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Duration | 90 days | Sufficient time for organic community growth |
| Min contribution | 0.01 ETH | Anti-spam, accessible entry |
| Max contribution | 2 ETH | Anti-whale, fair distribution |
| IFR allocation | 100,000,000 IFR | 10% of supply, from LiquidityReserve |
| Soft cap | None | LP always created |
| Hard cap | None | More ETH = deeper liquidity |
| LP lock | 12 months | Via Team.Finance after finalisation |
| Fee exempt | Yes | BootstrapVault is feeExempt on IFR token |

---

## Pricing Formula

The IFR start price is determined organically by total ETH raised:

```
IFR price (ETH) = total_ETH_raised / 100_000_000
```

### Example Scenarios

| ETH Raised | IFR Price (ETH) | Price @ ETH=2000€ | FDV |
|------------|----------------|-------------------|-----|
| 2 ETH | 0.00000002 | 0.00004€ | 40,000€ |
| 5 ETH | 0.00000005 | 0.0001€ | 100,000€ |
| 10 ETH | 0.0000001 | 0.0002€ | 200,000€ |
| 20 ETH | 0.0000002 | 0.0004€ | 400,000€ |
| 50 ETH | 0.0000005 | 0.001€ | 1,000,000€ |

No fixed price. No team decision. Pure market discovery.

---

## Contract Architecture

### State Variables

```solidity
// Configuration (immutable after deploy)
IERC20 public immutable ifrToken;
IIFRLock public immutable liquidityReserve;
IUniswapV2Router02 public immutable uniswapRouter;
ITeamFinanceLocker public immutable teamFinanceLocker;

uint256 public immutable startTime;
uint256 public immutable endTime;          // startTime + 90 days
uint256 public immutable ifrAllocation;    // 100_000_000 * 1e9
uint256 public immutable minContribution;  // 0.01 ETH
uint256 public immutable maxContribution;  // 2 ETH
uint256 public immutable lpLockDuration;   // 365 days

// State
mapping(address => uint256) public contributions;
address[] public contributors;
uint256 public totalETHRaised;
bool public finalised;
address public lpTokenAddress;
uint256 public lpLockId;
```

### Core Functions

```solidity
// Phase 1 — Contribution
function contribute() external payable
// - Checks: bootstrap active, min/max per wallet, not finalised
// - Records contribution
// - Emits Contributed(address, amount)

// Phase 2 — Finalisation (permissionless, callable by anyone after endTime)
function finalise() external
// - Checks: endTime passed, not already finalised
// - Pulls 100M IFR from LiquidityReserve (requires prior approval)
// - Creates Uniswap V2 LP: totalETHRaised + ifrAllocation
// - Locks LP tokens via Team.Finance (12 months)
// - Sets finalised = true
// - Emits Finalised(totalETHRaised, ifrPrice, lpTokenAddress)

// Phase 3 — Claim (permissionless, after finalisation)
function claim() external
// - Checks: finalised, contributor has unclaimed balance
// - Calculates: userIFR = (userETH / totalETH) * ifrAllocation
// - Transfers IFR to contributor
// - Emits Claimed(address, ifrAmount)

// View functions
function getContribution(address user) external view returns (uint256)
function getEstimatedIFR(address user) external view returns (uint256)
function getBootstrapStatus() external view returns (
    bool active, bool finalised, uint256 totalETH,
    uint256 timeRemaining, uint256 contributorCount
)
function getStartPrice() external view returns (uint256 ethPerIFR)
```

### Events

```solidity
event Contributed(address indexed contributor, uint256 ethAmount, uint256 totalETH);
event Finalised(uint256 totalETHRaised, uint256 ifrPerETH, address lpToken, uint256 lockId);
event Claimed(address indexed contributor, uint256 ifrAmount);
event EmergencyTriggered(address indexed caller, string reason); // governance only
```

---

## Security Requirements

### Access Control

- `contribute()`: public, no restrictions except parameters
- `finalise()`: public, only callable after endTime
- `claim()`: public, only by contributors after finalisation
- NO owner-only functions during bootstrap phase
- Governance CAN add BootstrapVault to feeExempt list (via proposal)

### Reentrancy Protection

- `contribute()`: nonReentrant
- `finalise()`: nonReentrant
- `claim()`: nonReentrant

### Edge Cases

| Scenario | Handling |
|----------|----------|
| 0 ETH raised | finalise() still creates LP (very low price), contributors array empty, no claims needed |
| 1 contributor | Gets 100% of IFR allocation |
| Max contributions hit | Still accepts from new wallets up to their max |
| Finalise called twice | Reverts: "Already finalised" |
| Claim called twice | Reverts: "Already claimed" |
| IFR transfer fails | finalise() reverts entirely |

### Known Risks (to document in audit)

- Team.Finance integration: if locker fails, fallback needed
- LiquidityReserve must approve BootstrapVault before finalise()
- Uniswap V2 pair must not exist before finalise() (or addLiquidity handles it)
- **W17:** LP tokens locked with `withdrawer=address(this)` but contract has no `unlockLP()` function — LP tokens are permanently stranded after lock period expires. Accepted as stronger trust guarantee (LP permanently locked = rug-proof).

---

## Integration Requirements

### Pre-Deploy Checklist

- [ ] LiquidityReserve approves BootstrapVault for 100M IFR
- [ ] Governance proposal: setFeeExempt(BootstrapVault, true)
- [ ] Team.Finance locker address verified on Mainnet
- [ ] Uniswap V2 Router address verified on Mainnet
- [ ] IFR/ETH pair does NOT exist yet on Uniswap

### Deployment Order

1. Deploy BootstrapVault (all params immutable)
2. Governance: setFeeExempt(BootstrapVault, true)
3. LiquidityReserve: approve(BootstrapVault, 100M IFR)
4. Announce bootstrap start on all channels
5. After 90 days: anyone calls finalise()
6. Contributors call claim()

---

## Announcement Strategy

### Own Channels

- Landing Page: Bootstrap Event Banner with countdown
- X (@IFRtoken): Launch announcement + weekly updates
- GitHub Discussions: Technical Q&A thread
- Wiki: Dedicated Bootstrap page (wiki/bootstrap.html)

### Juicebox (Discovery)

- Create Juicebox project as visibility tool
- Link to BootstrapVault contract address
- Juicebox community as additional discovery channel
- Clear disclaimer: actual bootstrap runs on-chain via BootstrapVault

---

## Test Requirements (minimum 20 tests)

### Deployment

- [ ] Deploys with correct parameters
- [ ] Immutable params cannot be changed

### Contribution Phase

- [ ] contribute() accepts valid ETH
- [ ] Rejects below minContribution
- [ ] Rejects above maxContribution per wallet
- [ ] Allows multiple contributions up to max
- [ ] Rejects after endTime
- [ ] Rejects if already finalised
- [ ] Tracks totalETHRaised correctly
- [ ] getEstimatedIFR() returns correct estimate

### Finalisation

- [ ] Reverts before endTime
- [ ] Succeeds after endTime (permissionless)
- [ ] Reverts if called twice
- [ ] Creates Uniswap V2 LP
- [ ] Locks LP via Team.Finance
- [ ] Emits Finalised event with correct params

### Claim

- [ ] Reverts before finalisation
- [ ] Returns correct IFR proportional to contribution
- [ ] Reverts if called twice (already claimed)
- [ ] Reverts for non-contributors

### Edge Cases

- [ ] finalise() with 0 contributions
- [ ] Single contributor gets 100% IFR

---

## Audit Update

After implementation, add to docs/SECURITY_AUDIT_CLAUDE.md:

**Scope v2 addition:** BootstrapVault.sol
Focus areas: reentrancy, contribution accounting,
finalise() atomicity, LP creation edge cases,
Team.Finance integration

---

## Status Tracking

- [x] Spec approved
- [x] Contract implemented (BootstrapVault.sol) — commit 2ce8b6b5
- [x] Tests written (22/22 passing) — commit 2ce8b6b5
- [x] Audit updated (SECURITY_AUDIT_CLAUDE.md) — 2026-03-03
- [x] Sepolia testnet deploy — [`0xE0E8F76e4fb38B2e367Aee043a2C02b8D1c7c037`](https://sepolia.etherscan.io/address/0xE0E8F76e4fb38B2e367Aee043a2C02b8D1c7c037) — 2026-03-04
- [x] Landing Page bootstrap banner — 2026-03-04
- [x] Wiki bootstrap page — docs/wiki/bootstrap.html — 2026-03-04
- [ ] Juicebox project created
- [ ] Mainnet deploy

---
*Inferno ($IFR) — BootstrapVault Technical Specification*
