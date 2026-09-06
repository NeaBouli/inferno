# IFR Exchange Fee-Exemption Policy

**Adopted:** 26 August 2026 at 00:17 MET, by a 4-1 vote

**Decision body:** five-member Core Developer and Keyholder Council

**Activation authority:** TreasurySafe 3-of-5 through the Governance contract and its 48-hour timelock

## Decision

By a 4-1 vote, officially verified centralized-exchange operational addresses are eligible
for full IFR transfer-fee exemption. Once an exchange address is activated
on-chain, every IFR transfer where that address is either the sender or the
recipient bypasses the complete 3.5% transfer fee:

- no 2.0% sender burn;
- no 0.5% recipient burn; and
- no 1.0% pool fee.

This policy is intended to make supported exchange deposits, withdrawals and
operational wallet movements predictable and compatible with exchange
accounting.

## Current Activation Status

The policy is approved. **No centralized-exchange address is currently
fee-exempt on-chain.** The policy does not become active for a particular
exchange until its exact Ethereum addresses have completed verification and a
public Governance proposal has been executed after the 48-hour timelock.

The existing IFR/WETH Uniswap V2 pair is already fee-exempt under Governance
Proposal #15. That DEX pair exemption is separate from this CEX policy.

## Address Verification

The IFR token contract cannot determine whether an address belongs to an
exchange. Before an address can be proposed for exemption, the exchange must:

1. communicate through an official listing or integration channel;
2. provide each Ethereum address and its operational role;
3. prove control through a signed message or an agreed on-chain verification;
4. identify whether addresses are deposit, sweep, omnibus, hot-wallet or other
   operational addresses; and
5. provide a process for notifying IFR Governance before an address changes.

Public block-explorer labels are supporting evidence, not sufficient proof by
themselves.

## Governance Activation

For every approved address:

1. TreasurySafe prepares a public Governance proposal calling
   `InfernoToken.setFeeExempt(exchangeAddress, true)`;
2. the proposal and address purpose remain visible during the 48-hour
   timelock;
3. TreasurySafe executes the proposal after the delay; and
4. the resulting `FeeExemptUpdated` event and final on-chain state are added to
   the public register below.

No individual developer or signer can activate an exchange exemption alone.

## Operational Boundaries

- Only Ethereum transfers invoke the IFR token contract.
- Trading or transfers performed solely inside a centralized exchange are
  off-chain ledger entries and never create an IFR burn or pool fee.
- A shared exempt exchange wallet makes transfers to and from that address
  fee-free. A separate customer deposit address remains subject to the normal
  fee until that exact address is also exempt.
- Exemptions are not retroactive. Fees from transfers completed before an
  address is activated cannot be reversed by the token contract.
- No blanket router, market-maker or unidentified address exemption is
  permitted under this policy.

## Monitoring And Revocation

Active exchange exemptions must be monitored through `FeeExemptUpdated`
events and periodically reconfirmed with the exchange. If ownership, purpose
or security status changes, Governance can revoke an address through
`setFeeExempt(exchangeAddress, false)`, again through the public 48-hour
timelock process.

## Public CEX Address Register

| Exchange | Ethereum address | Role | Proposal / transaction | Status |
|----------|------------------|------|------------------------|--------|
| None | — | — | — | No CEX address activated as of 26 August 2026 |

Canonical contracts:

- InfernoToken: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Governance: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
- TreasurySafe: `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
- IFR/WETH Uniswap V2 pair: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`

## Open Council Agenda: Exchange Participation

**Status:** Discussion draft only. No vote date is set, no IFR is allocated,
and no exchange has Council or TreasurySafe rights.
Agenda entries intentionally contain no proposer attribution or personal name.

The Council will consider the following questions separately from the already
adopted fee-exemption policy:

1. Should a verified exchange receive any IFR incentive at all?
2. If yes, should it be limited to measurable integration work or a
   returnable market-making mandate rather than an unrestricted listing fee?
3. Which pool, cap, milestones, custody controls, reporting duties and
   clawback terms would apply?
4. Should exchanges have any governance role, and must that role remain
   advisory and non-voting?

The initial options for discussion are:

| Option | Source and limit for discussion | Required controls |
| --- | --- | --- |
| No token incentive | 0 IFR | Fee exemption may still be considered per verified address under the existing policy |
| Integration pilot | PartnerVault only when the exchange delivers qualifying, verifiable builder/integration work; proposed ceiling of 500,000 IFR per exchange | Milestones, vesting, public recipient address, conflict disclosure and Governance approval |
| Liquidity pilot | LiquidityReserve; proposed ceiling of 2,000,000 IFR per exchange and 5,000,000 IFR aggregate per 90-day period | Returnable or escrowed mandate, proportional liquidity plan, reporting, termination/clawback terms, market-impact review and Governance approval |

These figures are agenda ceilings, not allocations. LiquidityReserve currently
holds 200,000,000 IFR; 50,000,000 IFR is technically withdrawable under the
current 90-day cap, but 0 IFR has been withdrawn. Availability does not create
spending authority. PartnerVault is reserved for builder rewards and is only a
candidate source where an exchange performs genuine qualifying integration
work.

The governance options include **no exchange voting seat and no TreasurySafe
signer or execution access in return for listing, liquidity or services**, or
at most two disclosed, non-voting advisory seats with no Safe permissions. Any
future voting or signer role must use the normal community signer-expansion
process, independent conflict and security review, and a separate public vote.

The live agenda and future vote log will be maintained at
<https://ifrunit.tech/wiki/governance.html#council-agenda>.
