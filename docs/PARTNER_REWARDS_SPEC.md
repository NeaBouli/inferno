# Builder Rewards Specification — IFR PartnerVault

## Overview
Builders (creators, businesses, developers) receive IFR rewards
when users lock IFR tokens and reference the builder.

## Reward Mechanism

### Formula
Reward = LockAmount x rewardBps / 10000

### Example (rewardBps = 1500 = 15%):
- User locks: 10,000 IFR
- Builder reward: 10,000 x 15% = 1,500 IFR
- Net effect: 10,000 locked, 1,500 paid out
- Deflation: 8,500 IFR net deflationary

### Key Invariant:
**Reward ALWAYS < Lock** — guarantees net deflation
- At rewardBps 1500 (15%): 10,000 lock -> 1,500 reward
- At rewardBps 2500 (25%): 10,000 lock -> 2,500 reward
- Never 1:1 or 2x — that would be inflationary

## Parameters

| Parameter | Value | Governance Bounds |
|-----------|-------|-------------------|
| rewardBps | 1500 (15%) | 500-2500 bps (5-25%) |
| annualEmissionCap | 4,000,000 IFR | 1M-10M IFR |
| vestingDuration | 180 days (6 months) | Gov-adjustable |
| maxVestingDuration | 365 days (12 months) | Gov-adjustable |

## Builder Pool Sustainability

| Year | Emission | Pool Remaining |
|------|----------|----------------|
| 1 | 4,000,000 | 36,000,000 |
| 2 | 4,000,000 | 32,000,000 |
| 5 | 4,000,000 | 20,000,000 |
| 10 | 4,000,000 | 0 |

*Pool lasts 10 years at constant cap.*
*Algorithmic throttle extends duration automatically.*

## Vesting

- Rewards are NOT paid out immediately
- Linearly vested over 6-12 months
- Claim via PartnerVault.claim() (permissionless after vesting)
- Partial withdrawal possible (claimable = vested - already claimed)

## Anti-Gaming

### authorizedCaller:
Only whitelisted backend wallets can call recordLockReward().
Prevents: Unauthorized reward manipulation.

### Anti-double-count:
```solidity
mapping(address => mapping(bytes32 => bool)) public rewardClaimed;
```
Prevents: Double rewards for the same lock event.

### Algorithmic Throttle (optional):
At high lock ratio (>30%), effective rewardBps decreases automatically.
Prevents: Emission explosion during sudden high lock volume.

## Builder Types

### Type A: Business Builder
- Accepts IFR lock for customer discounts
- Reward: Share of customers' lock amounts
- Example: Cafe accepts Bronze Tier -> 1,000 IFR Lock -> 150 IFR Reward

### Type B: Creator Builder
- YouTube/content creator with hybrid access
- Reward: Share of fans' lock amounts
- Example: 100 fans x 5,000 IFR = 500,000 IFR Lock -> 75,000 IFR Reward (6 mo.)

### Type C: Developer Builder
- Integrates IFR lock into their own app/platform
- Reward: Share of lock events via SDK
- Example: App with 1,000 users x 2,500 IFR = 2,500,000 IFR Lock -> 375,000 IFR Reward

## Onboarding

1. Builder application via GitHub Issue or direct contact
2. Governance Proposal: createPartner(beneficiary, maxAlloc)
3. 48h Timelock -> Execute
4. Builder is active: authorizedCaller can call recordLockReward()
5. First lock event -> Reward begins vesting

## Links
- PartnerVault Contract: contracts/partner/PartnerVault.sol
- Mainnet Deployment: `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`
- Sepolia Deployment: `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39`
- Builder Onboarding: docs/BUSINESS_ONBOARDING.md
- Creator Setup: docs/YOUTUBE_INTEGRATION.md
- Developer SDK: docs/SDK_QUICKSTART.md

---
*As of: March 2026 | Version 1.1*
