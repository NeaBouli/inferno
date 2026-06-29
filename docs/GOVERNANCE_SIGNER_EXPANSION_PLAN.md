# Community Signer Expansion Plan

Status: Planned
Scope: Future governance and multisig expansion after community voting is live.
Last updated: 30 June 2026

## Purpose

Inferno currently uses a conservative multisig model for protocol execution. Once community voting is live, the signer set can be expanded to include additional community members without turning execution security into pure token-holder control.

The objective is not to make multisig signer selection risk-free. No signer model can be risk-free. The objective is to minimize the practical risks: key compromise, inactivity, whale capture, random unqualified signers, conflicts of interest, and slow emergency response.

## Recommended Architecture

Use a hybrid model:

1. Eligibility filter
2. Public nomination or application
3. Community vote or shortlist
4. Security review
5. Safe expansion in stages
6. Fixed term, rotation, and emergency replacement

This means signers are community-legitimized, but still operationally qualified.

## Why Not Pure Token-Holder Selection

Large holders can be aligned with the protocol, but pure whale selection creates avoidable risks:

- Plutocracy: token amount becomes the only route to operational control.
- Concentration: one entity can split holdings across wallets or acquire influence quickly.
- Borrowed influence: freely tradable balances are weaker than locked, long-term alignment.
- Reputation gap: a large balance does not prove key-management skill.

Token holdings should be a signal, not the only qualification.

## Why Not Pure Random Selection

Randomness can improve fairness, but multisig signing is an operational security role. Pure random selection can select users who:

- do not understand Safe transactions,
- use weak wallet setups,
- are inactive during urgent execution windows,
- cannot verify calldata,
- or are not reachable when coordination is required.

Randomness can only be used after a candidate has passed eligibility and security checks.

## Candidate Eligibility

Minimum requirements before a candidate can be nominated or voted in:

- Wallet security: hardware wallet or equivalent secure signing setup.
- Safe readiness: ability to use Safe, verify transaction target, calldata, value, and network.
- Availability: expected response window, for example 24-48 hours.
- Contact reliability: reachable through an agreed public or semi-public channel.
- Public acceptance: candidate confirms signer duties and risks.
- Conflict review: no obvious hostile exchange, competitor, exploit history, or compromised-wallet risk.
- Alignment: locked IFR, long-term holding, verified contributor activity, lender activity, builder activity, or community work.
- Independence: signer should not be operationally dependent on another signer.

## Signals That Can Improve Ranking

These are positive signals, not hard guarantees:

- Locked IFR balance rather than only free IFR balance.
- Long holding duration.
- Active participation in governance discussions.
- Active lending or builder contribution.
- Verifiable contributor history.
- Ability to explain a Safe transaction before signing.
- Public commitment to never sign opaque or rushed transactions.

## Stage 1: Current State

Current model:

- 3-of-5 Safe.
- Suitable for early execution and operational reliability.
- Community voting is not yet the controlling process for signer expansion.

Action:

- Keep current 3-of-5 until community voting, identity/contact standards, and signer onboarding are ready.

## Stage 2: First Community Expansion

Target model:

- 4-of-7 Safe.

Suggested seat mix:

| Seat type | Count | Purpose |
|---|---:|---|
| Core / protocol signers | 3 | Continuity, technical context, emergency execution |
| Contributor / builder signers | 2 | Ecosystem execution and product context |
| Community-elected signers | 2 | Community mandate and decentralization |

Why 4-of-7 first:

- Adds community representation without slowing execution too much.
- Prevents any 3-person subgroup from acting alone.
- Allows one or two inactive signers without freezing routine execution.

Recommended before activation:

- Publish candidate requirements.
- Open applications/nominations.
- Run community vote from eligible/verified voters.
- Perform signer onboarding drill on a test Safe.
- Add signers through Safe transaction.
- Announce new signer set and threshold publicly.

## Stage 3: Mature Community Expansion

Target model:

- 5-of-9 Safe.

Suggested seat mix:

| Seat type | Count | Purpose |
|---|---:|---|
| Core / security signers | 3 | Protocol continuity and security review |
| Contributor / builder signers | 2 | Ecosystem representation |
| Community-elected signers | 3 | Broader community mandate |
| Independent security / guardian seat | 1 | Extra review capacity |

Why 5-of-9 later:

- Better decentralization.
- Better community representation.
- Higher threshold against signer compromise.

Tradeoff:

- Slower coordination.
- More onboarding and monitoring overhead.
- Higher probability that one signer becomes inactive.

Only move to 5-of-9 after 4-of-7 has operated reliably for at least one term.

## Safe Separation

Do not apply the same signer-expansion speed to every Safe.

Recommended structure:

- Treasury Safe: conservative expansion, highest qualification bar.
- Community / Grants Safe: can expand earlier and include more community seats.
- LP Reserve Safe: conservative, because liquidity actions affect market structure.
- Guardian Safe: separate cancel-only or emergency-only role, not treasury spending.

This gives the community real participation without exposing every critical asset to the same risk surface.

## Terms And Rotation

Recommended term:

- 6 months for first community signer term.
- 12 months once the process is stable.

Rotation:

- At least one community seat can rotate each term.
- Existing signers can stand for re-election.
- Inactivity, unreachable status, or unsafe signing behavior should trigger replacement.

Emergency removal:

- Predefine removal conditions before adding community signers.
- Examples: compromised wallet, unreachable for repeated execution windows, public refusal to follow Safe verification policy, conflict of interest, or suspected hostile control.

## Voting Model

Recommended voting weight:

- Locked IFR should count more than freely transferable IFR.
- Contributor, lender, builder, and long-term participation can be eligibility or reputation signals.
- Free balance alone should not decide signer seats.

Suggested approach:

- Candidate passes eligibility first.
- Community vote ranks eligible candidates.
- Final Safe change is executed through existing governance and timelock.

## Implementation Checklist

- [ ] Publish signer eligibility criteria.
- [ ] Define signer duties and removal conditions.
- [ ] Define voting eligibility: locked IFR, verified wallet, or other governance credential.
- [ ] Create candidate application template.
- [ ] Run test Safe onboarding.
- [ ] Hold community nomination period.
- [ ] Hold community vote.
- [ ] Publish results and rationale.
- [ ] Queue Safe signer update through governance.
- [ ] Wait 48h timelock where applicable.
- [ ] Execute signer update.
- [ ] Verify owners and threshold on Safe.
- [ ] Update docs, landing, wiki, and AI copilot knowledge.

## Preferred IFR Path

1. Keep current 3-of-5 while community voting is being built.
2. Launch community governance and verified voter access.
3. Expand to 4-of-7 using the mixed model.
4. Operate for one term.
5. Review signer responsiveness and execution quality.
6. Consider 5-of-9 only after the process is proven.

Bottom line: community-democratic selection, security-filtered eligibility, staged threshold expansion, and documented rotation.
