# Inferno ($IFR) Governance Constitution v1.1

> **Current implementation notice (6 September 2026):** This document describes
> the present 3-of-5 TreasurySafe control model and the planned expansion path.
> The deployed contracts are authoritative where an older policy summary
> differs. Current Council agenda drafts and vote status are public at
> <https://ifrunit.tech/wiki/governance.html#council-agenda>.

## Preamble
The Inferno Governance ensures decentralized control over all
critical protocol parameters. No single actor can make changes without
a 48-hour timelock period and quorum approval.

## Article 1 — Governance Principles
1. **Transparency:** All proposals are traceable on-chain
2. **Time Delay:** Protocol target calls use the Governance proposal and 48h
   timelock; Governance's own explicitly coded owner/guardian administration
   remains subject to its deployed access controls
3. **Decentralization:** TreasurySafe 3-of-5 is active; 4-of-7 is planned only
   after the public community signer-expansion process
4. **Core Bounds:** No mint function, fixed 9 decimals, and a hard 5% aggregate
   fee cap; fee components are governable within that cap
5. **Guardian Right:** The current Guardian EOA can cancel pending proposals;
   a separate guardian multisig remains planned

## Article 2 — Governable Parameters

### 2.1 PartnerVault
| Parameter | Description | Bounds |
|-----------|-------------|--------|
| rewardBps | Builder reward rate | 500–2500 bps (5–25%) |
| annualEmissionCap | Annual emission limit | 1M–10M IFR |
| authorizedCaller | Whitelist for recordLockReward() | any address |
| algoThrottleEnabled | Algorithmic throttle on/off | bool |

### 2.2 FeeRouterV1
| Parameter | Description | Bounds |
|-----------|-------------|--------|
| protocolFeeBps | Protocol fee | 0–25 bps (hard cap) |
| whitelistedAdapters | Swap adapter whitelist | any address |
| voucherSigner | EIP-712 voucher signer | any address |
| paused | Emergency pause | bool |
| feeCollector | Fee recipient | any address |

### 2.3 IFRToken

| Parameter | Current/default value | Changeable? |
| --- | --- | --- |
| genesis supply | 1,000,000,000 IFR | No mint function; circulating supply decreases through burns |
| senderBurnBps | 200 (2.0%) | Yes, through Governance within aggregate cap |
| recipientBurnBps | 50 (0.5%) | Yes, through Governance within aggregate cap |
| poolFeeBps | 100 (1.0%) | Yes, through Governance within aggregate cap |
| decimals | 9 | No |
| aggregate fee cap | 500 (5.0%) | Hard contract cap |

## Article 3 — Proposal Lifecycle

### Phase 1: Proposal
1. Proposer calls `governance.propose(targets, values, calldatas, description)`
2. Proposal appears in timelock queue
3. ETA = block.timestamp + 48h (minimum)
4. Status: **PENDING**

### Phase 2: Timelock
- 48h waiting period (immutable in contract)
- During this time: community review, guardian cancel possible
- Status: **QUEUED**

### Phase 3: Execution
- After ETA: the Governance owner (currently TreasurySafe 3-of-5) calls
  `execute()`
- Before execution: re-verify that the proposal is still relevant
- Status: **EXECUTED**

### Phase 4: Rejected/Cancelled Proposals
- Governance owner or Guardian can call `cancel(proposalId)` while the proposal
  is pending
- Cancelled proposals cannot be re-executed
- Status: **CANCELLED**

## Article 4 — Multisig Structure (Mainnet)

### Owner Multisig (3-of-5 active)
Responsible for: All governance proposals

- Five current Safe owners, with three confirmations required
- 4-of-7 community signer expansion is planned, not active
- New signers require the public eligibility, conflict, security, selection,
  rotation and emergency-replacement process

### Guardian

The current Guardian is the deployer EOA and has emergency cancellation power;
it cannot propose or execute. Migration to a separate guardian multisig remains
planned.

## Article 5 — Prohibited Governance Actions
The following actions are technically impossible by contract design:
- Minting new IFR tokens
- Setting aggregate transfer fees above 5%
- Direct access to locked user tokens
- Bypassing the 48h delay for calls queued through `Governance.propose()`
- Changing the token decimals

## Article 6 — Governance Phases

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | Completed | Single EOA (deployer), bootstrap |
| Phase 1 | Completed | 2-of-4 multisig (14.03.2026) |
| Phase 2 | **Active** | 3-of-5 multisig (15.03.2026) ✅ |
| Phase 3 | Planned | 4-of-7 multisig |
| Phase 4 | Planned | Full DAO (token voting) |

## Article 7 — Amendments to This Constitution
- Amendments require a governance proposal + 48h timelock
- Core values (Article 5) are immutable (contract-level)
- Versioning: GOVERNANCE_CONSTITUTION_v{n}.md

---
*Version: 1.1 | Updated: 6 September 2026 | Network: Ethereum Mainnet*
