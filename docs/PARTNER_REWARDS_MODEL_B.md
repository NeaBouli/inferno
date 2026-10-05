# Partner Rewards — Model B (Lane 4 decision)

**Status:** decided 2026-10-03, not active. No partner is registered, no reward has been paid and no
authorized reward caller is set. Each pilot partner is activated separately by a Safe proposal through
Governance (48-hour timelock).

This document supersedes the lock-percentage reward described in
[PARTNER_REWARDS_SPEC.md](PARTNER_REWARDS_SPEC.md) as project policy. The contract facts in that spec
remain accurate; the policy for using them changes.

## Verified State (Ethereum Mainnet, block 26,110,741)

| Item | Value |
| --- | --- |
| PartnerVault | `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` |
| IFR balance | 40,000,000 IFR |
| `rewardBps` | 1500 (bounds 500–2500) |
| `annualEmissionCap` | 4,000,000 IFR (bounds 1M–10M) |
| `totalAllocated` / `totalRewarded` / `totalClaimed` | 0 / 0 / 0 |
| `ifrLock` (algorithmic throttle) | unset, so the throttle is inactive |
| `admin` | Governance `0xc43d48E7FDA576C5022d0670B652A622E8caD041` |
| `guardian` (pause) | Treasury Safe `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` |
| BuilderRegistry builders | 0 |
| Refill mechanism | none (CWA-59) |

## Why Model B

The lock-percentage formula (`reward = lockAmount × rewardBps / 10000`) rewards a lock, not a sale.
A lock can be opened, rewarded and closed again, so the reward can be farmed. The finite 40M pool has
no refill. Model B ties every reward to a verified purchase at a partner.

## Policy

1. **Trigger:** only a verified checkout redemption at a registered pilot partner. The Benefits backend
   records the redemption (seller-confirmed QR checkout, idempotent event id). A partner's own system may
   be the source only if its redemption export is auditable, reconciled per period and named in the
   activation proposal. Locks, commitments, reviews, sign-ups, activations, referrals or page views never
   earn a reward.
2. **Valuation:** the reward is defined in EUR per verified redemption (amount fixed per pilot in the
   activation proposal). No fixed EUR/IFR rate is promised.
3. **Payout in IFR:** the EUR total of a settlement period is converted to IFR at the 7-day TWAP of the
   IFR/WETH Uniswap V2 pair `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` and a published ETH/EUR
   reference at the settlement block. Start/end blocks and both prices are published with each
   settlement.
4. **Budgets:** a hard per-partner budget (the partner's `maxAllocation` in PartnerVault) and a global
   pilot budget recorded in the decision register. The pool total is 40M IFR and is never refilled.
   When a budget is reached, rewards for that partner stop.
5. **Anti-double-count:** one reward per redemption event id; the same checkout is never settled twice.
   Self-redemptions by the partner's own wallets are excluded.
6. **Vesting:** per partner, 180–365 days linear (contract bounds), optional cliff. Larger budgets get
   the longer vesting.
7. **Pause:** the Treasury Safe (PartnerVault guardian) can pause claims at any time; Governance can
   lower a partner's allocation down to what it has already earned.
8. **Custody:** any service key that prepares settlements is separate from Safe signer keys. Under the
   recommended path below no hot key can move rewards at all.

## Mapping onto the Deployed PartnerVault

Model B can run on the deployed contract **without a new contract**, through the milestone path:

- `createPartner(partnerId, beneficiary, maxAllocation, vestingDuration, cliff, tier)` and
  `activatePartner(partnerId)` set up a pilot partner with its hard budget (Governance proposal).
- Per settlement period, Governance calls `recordMilestone(partnerId, milestoneId, unlockAmount)` with the
  exact IFR amount computed from the verified EUR redemptions. The first call starts the partner's
  vesting; the partner claims vested IFR with `claim(partnerId)`.
- The contract enforces `unlockedTotal + rewardAccrued <= maxAllocation`, so the per-partner budget is a
  hard on-chain cap.

Limits of this path, stated plainly:

- Every settlement is a Governance proposal (Safe signatures plus 48 hours). That suits a pilot with a few
  partners and monthly settlements; it does not scale to many partners.
- Milestone unlocks do not count toward `annualEmissionCap`; the global pilot budget is enforced by the
  sum of partner allocations and by this policy.

**Not used:** `recordLockReward` via an authorized caller. It would need a synthetic `lockAmount` to hit
a target reward, which records a lock that never happened on-chain, and it rewards each customer wallet
only once per partner. Model B therefore does not set an authorized caller.

**When a new contract is needed:** only for automated, per-redemption settlement without a Governance
proposal per batch (an EUR-budgeted claim contract with a hot settlement key and on-chain caps). That is
a separate decision and needs an independent review before deployment.

## Known Follow-Up

The Benefits backend settlement mode is implemented (T-275) and default-off: for a configured pilot
partner the reward queue marks verified post-pilot redemption events `SETTLEMENT_PENDING` instead of
`BLOCKED_CALLER`, and an operator-only monthly export reconciles them and, only with reviewed price
evidence, adds an unsigned `recordMilestone` proposal template. No pilot is active and no reviewed
price evidence source exists yet, so rewards stay disabled.

Open first-pilot gates, all fail closed:

- The existing outbox records at most one reward event per customer wallet and partner, so a repeat
  customer's later redemptions have no reward event. A month with such a seller-confirmed redemption
  (not a self-redemption and not before pilot start) is a blocking reconciliation discrepancy, and the
  export stays diagnostic. The policy decision is still open: accept one reward per customer and
  partner, or approve a reviewed migration.
- A month that the partner or global budget covers only partly stays diagnostic. A template would use
  up that month's milestone ID and the events left out could never be settled. A rule for a final
  capped period needs its own approval.
- The export checks price evidence only against its schema and the pilot policy, not against the
  chain. Before any Safe execution, a reviewed source must be named and the TWAP and ETH/EUR values
  must be reproduced independently.

## Activation Checklist per Pilot Partner

1. Partner verified in BuilderRegistry (Governance proposal).
2. Reward per redemption (EUR), budget (`maxAllocation`), vesting and cliff recorded in the decision
   register.
3. `createPartner` + `activatePartner` proposal through the Treasury Safe and Governance.
4. Benefits backend redemption export reconciled for the period; settlement amount and price evidence
   published.
5. `recordMilestone` proposal per settlement period.
