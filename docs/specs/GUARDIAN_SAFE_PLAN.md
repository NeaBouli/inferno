# Separate Guardian Safe Plan

**Status:** plan only, 17 October 2026. Safe creation, signer appointments and
role transfers require later explicit Council authorization.

## Decision and permission boundary

Gio selected a separate **2-of-3 cancel-only Guardian Safe** on 17 October 2026.
It is separate from the Treasury Safe and its proposer/asset-custody duties.
It receives the Governance `cancel(proposalId)` privilege only, initially for
the planned G2 and later for legacy G1 if the bridge migration is approved.
It receives no token owner, vault admin, pause, unpause, burn, withdrawal,
fee-setting or proposal-creation role. It cannot remove a timelock.

Scope references: CWA-09, CWA-62 and JUL-06 in the
[CWA register](../community-audits/cwa-remediation-register.json) and
[July register](../community-audits/july-2026-remediation-register.json),
[Governance V2](GOVERNANCE_V2_SPEC.md), and
[migration plan](../GOVERNANCE_MIGRATION_PLAN.md).

A standard Safe can sign arbitrary wallet transactions; its protocol authority
is restricted by the roles granted on the target contracts. No custom Safe
module/guard that enforces a selector allowlist is approved or assumed here.
Validate that Safe setup has no unapproved module or handler bypass. The Safe
is not a funding treasury; only bounded transaction-gas funding is contemplated.
Calling G2's permissionless execute gives it the same rights as any account,
not special guardian execution authority.

## Documented current holders and powers

This table is a repository-derived role inventory, not a new mainnet attestation.
It uses [DEPLOYMENTS.md](../DEPLOYMENTS.md),
[GUARDIAN_MIGRATION.md](../GUARDIAN_MIGRATION.md) and current contract interfaces.
The October 3/5 mutable-guardian migrations have recorded receipts; a fresh
block-bound read is mandatory before relying on them. Network/explorer access
was unavailable during this planning task.

`T` is Treasury Safe `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`, documented
3-of-5. `E` is the old deployer EOA
`0x6b36687b0cd4386fb14cf565B67D7862110Fed67`.

| Contract and address | Documented holder | Actual guardian powers / rotation path |
| --- | --- | --- |
| Governance G1 `0xc43d48E7FDA576C5022d0670B652A622E8caD041` | T, since 3 October | Cancel proposals; owner changes guardian immediately via `setGuardian` on deployed G1 |
| IFRLock `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` | T, since 3 October | Pause/unpause; current guardian calls `setGuardian` |
| PartnerVault `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` | T, since 3 October | Pause/unpause; current guardian calls `setGuardian`, independently of admin |
| Vesting `0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271` | T, since 3 October | Pause/unpause releases; current guardian calls `transferGuardian`; no maximum pause duration |
| LiquidityReserve `0xdc0309804803b3A105154f6073061E3185018f64` | T, since 5 October, proposal #19 | Pause/unpause withdrawals; owner calls `setGuardian` through its Governance timelock |
| BurnReserve `0xaA1496133B6c274190A2113410B501C5802b6fCF` | T, since 5 October, proposal #20 | `burn`/`burnAll`, alongside owner; owner calls `setGuardian` through its Governance timelock |
| BuybackVault V1 `0x670D293e3D65f96171c10DdC8d88B96b0570F812` | E, immutable | Pause/unpause buybacks; no guardian setter; replacement required |
| BuybackController `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` | E, immutable | Pause/unpause execution; no guardian setter; replacement required |

BurnReserve guardian is a burn authority, not a pause authority: assigning that
role to the cancel Safe would grant irreversible token-supply power. T's other
existing pause/unpause and burn privileges also remain immediate after owner
pointers migrate to G2. The new cancellation role does not retroactively remove
those legacy exceptions or prove that all protocol actions are delayed.

## Signer selection and setup acceptance

Select three named, consenting, operationally independent custodians. Council
approval must cover their public role identities and consented addresses; do
not publish private key, recovery or personal security details.

- Prefer no overlap with Treasury Safe signers, especially enough overlap to
  compromise both quorums. Any unavoidable overlap requires explicit Council
  acceptance and a documented correlated-compromise assessment. A separate
  wallet address alone is not independence.
- Use independently controlled hardware wallets, devices and recovery custody;
  no shared seed, remote signer, account, cloud backup or administrator.
- Require availability across time zones, ability to decode exact proposal
  target/calldata and identify G1 versus G2, and a tested two-person emergency
  response within the proposed 48-hour review period.
- Disclose relevant proposer/vendor conflicts and avoid a single organization
  controlling two guardian keys. Establish rotation, loss and inactivity rules.
- Verify key ownership on the approved test network, Safe owner set and exactly
  2-of-3 threshold. Test one signature fails, two succeed, an outsider fails and
  nonce/chain/domain replay is rejected. Do not expose signer recovery material.

Use a reviewed official Safe singleton/proxy version with recorded code hashes.
Record setup, fallback handler, guard and all enabled modules; default acceptance
is no unapproved module or alternate execution authority. Changes to these
settings need Council policy review and new identity evidence. A future
threshold or signer change is not authorized just by this setup plan.

## Role transition plan

1. Freeze and approve the role/Safe manifest and signer independence evidence;
   re-read all eight current holders above at one recorded block. Stop on drift.
2. Create and verify the new Safe without protocol roles. Run the test-network
   cancellation exercise, including detection, quorum collection and receipt
   verification. Verify no proposal creation, early execution, pause, burn,
   configuration or fund movement can be authorized by its guardian role.
3. Deploy G2 with the new Safe as cancel guardian after separate deployment
   approval. G2 owner is T; owner/guardian addresses must be distinct. Do not
   move any legacy pause or burn role to the new Safe.
4. If the Council approves the FeeRouter bridge, complete the child transfers
   and G1 owner handoff in the migration plan first. Then T proposes through
   G2 `G1.setGuardian(newSafe)`, waits the full G2 delay, and anyone executes
   before expiry. Verify G1/G2 guardian values, events and Safe configuration.
   Until then T remains G1 guardian; no old role is assumed moved by G2 creation.
5. Keep IFRLock, PartnerVault, Vesting, LiquidityReserve and BurnReserve
   guardians on T under the recorded existing policy. A future change of
   pause/burn custody needs its own scope and authorizations using the actual
   rotation paths in the table. Sending those roles to the cancel Safe is
   prohibited by this plan.
6. Deploy replacement BuybackVault with a separately approved operational pause
   guardian, proposed T, and timelocked rotation. Its G2 ownership uses actual
   nomination and acceptance. Replacing a service does not rewrite V1's guardian.
7. Plan a later, separately reviewed BuybackController replacement if the
   Council wants E removed from the active controller role. Specify JUL-08
   accounting, reentrancy/MEV controls, fee inflow, existing balances, feeCollector
   and poolFeeReceiver wiring, exemptions, LP recipient and ownership acceptance.
   Test withdrawals/migration limits, fund the replacement only after its own
   activation gate, and verify every changed pointer after its timelock.

**Explicit retained exception, owner decision 17 October 2026:** E remains the
immutable guardian of both existing BuybackVault and BuybackController for now.
No EOA rotation or deployer signature is requested here. Their guardian roles
cannot be changed in place. Later removal from operational use requires
replacement, reviewed asset/flow migration and retirement of old execution;
the immutable historical getter will still return E. Old residual assets or
ongoing inflows mean retirement is incomplete and must be disclosed. The old
vault has no generic withdrawal; the Controller's governed withdrawal methods
do not imply the vault has them. The future role recipient must be a pause
authority approved separately, never this cancel-only Safe.

## Cancellation operations, monitoring and recovery

Monitor both governor addresses, full calldata, ETA/expiry and configuration
events. Assess the exact operation, not a human-readable title alone. A guardian
cancellation requires two C signatures over a Safe transaction targeting the
correct Governance `cancel(id)` with value zero, then verification of the
receipt/event and terminal cancelled state at a canonical block.

Cancellation needs no timelock. Once a proposal is ready, execution can beat a
cancellation; there is no guaranteed veto after ETA. For a material response,
cancel before ETA, publish a reason without sensitive incident data, and have T
re-propose corrected bytes with a fresh delay if appropriate. Expired G2
proposals need no cancellation; legacy G1 proposals do not expire on their own.

Two compromised guardian keys can censor proposals, including guardian-rotation
and ownership proposals. G2 deliberately has no immediate owner bypass. Key loss
or correlated proposer/guardian compromise may therefore prevent recovery;
the Council must approve its incident/censorship policy before assigning roles.
The 2-of-3 threshold tolerates one unavailable signer, not loss of two.

Required acceptance evidence: current role snapshot; signer independence and
consent; verified Safe setup; test-network role-negative and cancellation
rehearsals; implementation/migration review; later authorization and receipts
for each live assignment; monitoring ownership and response drill. This plan
alone does not mark JUL-06 or new guardian deployment as completed.
