# Inferno ($IFR) Governance Constitution v1.0

## Preamble
The Inferno Governance ensures decentralized control over all
critical protocol parameters. No single actor can make changes without
a 48-hour timelock period and quorum approval.

## Article 1 — Governance Principles
1. **Transparency:** All proposals are traceable on-chain
2. **Time Delay:** 48h timelock for all changes (no bypass)
3. **Decentralization:** Target 4-of-7 multisig for mainnet
4. **Immutability of Core Values:** Burn rate, max fee, supply are never changeable
5. **Guardian Right:** Emergency cancel by guardian multisig

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

### 2.3 IFRToken (immutable)
| Parameter | Value | Changeable? |
|-----------|-------|-------------|
| totalSupply | 1,000,000,000 IFR | No |
| burnFeeBps | 250 (2.5%) | No |
| poolFeeBps | 100 (1.0%) | No |
| decimals | 9 | No |
| maxFeeBps | 500 (5.0%) | Hard cap |

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
- After ETA: anyone can call `execute()` (permissionless)
- Before execution: re-verify that the proposal is still relevant
- Status: **EXECUTED**

### Phase 4: Rejected/Cancelled Proposals
- Guardian can cancel at any time: `guardian.cancel(proposalId)`
- Cancelled proposals cannot be re-executed
- Status: **CANCELLED**

## Article 4 — Multisig Structure (Mainnet)

### Owner Multisig (4-of-7)
Responsible for: All governance proposals
- 2 founder wallets (hardware wallet, Ledger)
- 2 community representatives (elected via Snapshot)
- 2 builder representatives (first accredited builders)
- 1 reserve wallet (cold storage, emergency)

### Guardian Multisig
Responsible for: Emergency cancel only
- 1 founder wallet
- 1 independent security reviewer
- 1 community representative

## Article 5 — Prohibited Governance Actions
The following actions are technically impossible by contract design:
- Minting new IFR tokens
- Increasing the burn rate above 5%
- Direct access to locked user tokens
- Bypassing the 48h timelock
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
*Version: 1.0 | As of: March 2026 | Network: Ethereum Mainnet (deployed 2026-03-05)*
