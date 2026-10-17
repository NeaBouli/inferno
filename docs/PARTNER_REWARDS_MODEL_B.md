# Partner Rewards — Model B (Lane 4 decision)

**Status:** model decided 2026-10-03; pilot parameters and EXT-10 decided by Gio on 2026-10-17.
Local prerequisites only; no activation, on-chain action or deployment is authorized by this update.
The previously recorded state is: no partner is registered, no reward has been paid and no
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
2. **Valuation:** **EUR 0.50 per reward-eligible verified checkout redemption**, paid in IFR.
   No fixed EUR/IFR rate is promised.
3. **Payout in IFR:** the EUR total of a settlement period is converted to IFR at the 7-day TWAP of the
   IFR/WETH Uniswap V2 pair `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` and a published ETH/EUR
   reference at the settlement block. Start/end blocks and both prices are published with each
   settlement.
4. **Budgets:** **EUR 250 lifetime per pilot partner; one pilot partner to start**, hence EUR 250
   total initial pilot budget and at most 500 eligible redemptions. The activation also fixes the
   partner's IFR `maxAllocation`; every batch must fit both the remaining EUR budget and that IFR
   allocation. Neither budget refills. The pilot partner's name, business and wallet remain pending.
5. **Anti-double-count (EXT-10):** **one wallet = one reward-eligible redemption per partner per
   settlement period**. Periods are whole UTC calendar months, half-open `[start, end)`. Repeated
   checkouts still redeem their exact signed offer but earn no additional seller reward that month;
   the wallet may qualify again next month. Event replay and double settlement of a month are also
   forbidden. Self-redemptions by the partner's own wallets are excluded.
6. **Vesting:** **six months**. The activation proposal must record the contract duration in seconds
   within its bounds and any cliff explicitly.
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

## Local operator prerequisites

These commands prepare evidence and unsigned calldata only. Run them from
`apps/benefits-network/backend` with its installed dependencies and usual protected backend
configuration. Model B remains default-off; pilot identity and governance activation are separate.

EXT-10 additionally requires `MODEL_B_DEDUP_SECRET`, a dedicated random 32-byte hex HMAC key
(64 hex characters, no `0x` prefix). Never use an admin secret, signer key or wallet key. Keep it
stable throughout each settlement period; a change while that period already has eligible events
blocks new rewards. Missing/invalid keys also block rewards without blocking valid checkout use.
The additive `20261017120000_model_b_period_dedup` migration must be reviewed and applied with any
backend release containing this code, even when Model B is disabled. This task runs it only against
synthetic local test databases; it does not authorize a release or a production migration.

After verified customer proof and seller confirmation of the exact signed offer, the redemption
transaction stores one HMAC scoped to chain/vault/partner/month in `RewardEvent.rewardDedupKey`,
plus `rewardPeriod`. A unique index and SQLite's redemption write lock prevent concurrent duplicates.
Repeated checkouts get `SKIPPED_DUPLICATE` with no second customer key. No customer raw address,
signature, balance, verification block or globally stable wallet hash is added. This is the narrow
customer-pseudonym exception implied by the task's explicit “hash or minimal key” instruction;
it changes the older no-identifier boundary and is not anonymity. See
[data minimization](BENEFITS_PWA_AND_DATA_MINIMIZATION.md#model-b-ext-10-local-follow-up).

```sh
node scripts/model-b-export.cjs --period 2026-09 --seller-counts /protected/seller-counts.json > /protected/period.json
node scripts/model-b-proposal.cjs --export /protected/period.json --vault-state /protected/vault-state.json --state /protected/model-b-ledger.json --price-eur-per-ifr 0.003 > /protected/proposal.json
node --test scripts/model-b-tools.test.cjs
```

`seller-counts.json` maps the configured bytes32 partner ID to the seller-confirmed checkout count
(including duplicates and self-checkouts, so the gross total reconciles). The export contains aggregate
counts per partner, blocking discrepancies and a deterministic reconciliation checksum; it contains no
raw wallet addresses, customer keys or event/session IDs. Its checksum detects changes, not authorship:
the operator must reproduce the export from the authoritative database and reconcile seller evidence.

`vault-state.json` is a separately reviewed, block-numbered read-only snapshot. Its exact fields are
`chainId`, `partnerVault`, `governance`, `partnerId`, `blockNumber`, `blockHash`, `milestoneId`,
`active`, `milestonesFinal`, `paused`, `milestoneDone`, `maxAllocationBaseUnits`,
`unlockedTotalBaseUnits`, `rewardAccruedBaseUnits`, and `recordedMilestoneIds` (an array of previously
reserved IDs verified as done at this snapshot block, initially empty). IDs and addresses use lowercase hex; all IFR
amounts are integer strings in nine-decimal base units. The milestone ID uses the existing
chain/vault/partner/month identity, independent of export content or policy version. No RPC call or
transaction is made by the proposal CLI. Operator-supplied snapshot values are not chain verification.

The explicit decimal price is **EUR per one IFR**, with up to 18 decimal places. Conversion floors
only at the final IFR base unit, using bigint arithmetic. The generator pays only whole eligible
redemptions, capped by EUR 250 less previous reservations and the remaining IFR allocation. A final
capped period reports its uncovered count; it cannot be settled again with another milestone.
Price input is not an oracle or approval: independently reproduce the policy's 7-day TWAP and ETH/EUR
reference before any Governance submission.

The mandatory local ledger reserves **drafts**, keyed by partner + month, under an exclusive lock and
atomic file replacement. A repeat run refuses even before submission. All drafts consume the local
EUR budget; pending IFR amounts are deducted in addition to snapshot usage. Amounts for snapshot-verified
recorded milestones are reconciled against `unlockedTotalBaseUnits` and are not deducted twice.
The ledger itself never marks a draft paid or settled. Unreconciled snapshot usage is refused, so a fresh
ledger cannot silently forget previously recorded rewards. Use the same protected ledger across all periods; deleting it,
switching files or manually clearing reservations defeats local replay/budget protection. Back it up.
Reconciling executed drafts requires the reviewed snapshot; abandoning drafts requires separate review. This CLI has no reset
or settlement-confirmation command. A crash after reservation can leave a draft reserved without
printed output. Governance review must also recheck current allocation and `milestoneDone`.

## Remaining activation gates

The Benefits backend settlement mode is implemented (T-275) and default-off: for a configured pilot
partner the reward queue marks verified post-pilot redemption events `SETTLEMENT_PENDING` instead of
`BLOCKED_CALLER`. The backend monthly export reconciles them but remains diagnostic: it lacks the
lifetime EUR reservation ledger (`OPERATOR_LEDGER_REQUIRED`). Only the offline generator above
prepares the unsigned `recordMilestone` template with that ledger. Pilot identity, activation and
reviewed settlement price evidence remain required, so rewards stay disabled by default.

Open first-pilot gates, all fail closed:

- Review and accept the narrowly scoped EXT-10 HMAC exception before activation, together with its
  protected key handling and retention. Old `BLOCKED_POLICY` events remain non-payable. Legacy data
  cannot be backfilled because customer identity was intentionally not retained; exports containing
  such post-pilot events stay diagnostic and the offline generator refuses them.
- The admin TWAP-export path stays diagnostic without an operator ledger. The offline generator
  reports final caps explicitly, reserves the entire period identity and offers no carry-over.
- The export checks price evidence only against its schema and the pilot policy, not against the
  chain. It does bind the evidence to the period: the 7-day TWAP window must end between the period
  end and 72 hours after it, and the ETH/EUR reference must be published between 24 hours before
  and 72 hours after the period end. A later window, which could be picked for a low IFR price, keeps
  the export diagnostic. Before any Safe execution, a reviewed source must be named and the TWAP and ETH/EUR values
  must be reproduced independently.

## Activation Checklist per Pilot Partner

1. Partner verified in BuilderRegistry (Governance proposal).
2. Reward per redemption (EUR), budget (`maxAllocation`), vesting and cliff recorded in the decision
   register.
3. `createPartner` + `activatePartner` proposal through the Treasury Safe and Governance.
4. Benefits backend redemption export reconciled for the period; settlement amount and price evidence
   published.
5. `recordMilestone` proposal per settlement period.
