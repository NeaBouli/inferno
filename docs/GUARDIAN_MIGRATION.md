# Guardian Migration to the Treasury Safe (CWA-09)

**Status:** prepared. Every Mainnet step is performed by the deployer or the Safe signers, never by automation.

## Decision

Owner decision (2026-10-03): every changeable guardian role moves from the deployer EOA
`0x6b36687b0cd4386fb14cf565B67D7862110Fed67` to the Treasury Safe `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b`
(3-of-5). A single stolen or lost key can then no longer pause contracts or cancel Governance proposals.
Accepted trade-off: an emergency pause needs three Safe signatures and is slower than a single key.

## Change Paths (verified on a Mainnet fork)

| Contract | Function | Caller |
| --- | --- | --- |
| Governance | `setGuardian` | Treasury Safe, immediate |
| LiquidityReserve, BurnReserve | `setGuardian` | Governance proposal, 48h delay |
| IFRLock, PartnerVault | `setGuardian` | current guardian (deployer) |
| Vesting | `transferGuardian` | current guardian (deployer) |
| BuybackVault, BuybackController | none, `guardian` is `immutable` | cannot change |

The BuybackVault and BuybackController guardian stays the deployer EOA permanently. That role can only pause and
unpause buyback execution; it cannot move funds. Changing it would need a redeployment.

## Steps

1. `node scripts/guardian-migration-proposal.cjs <Governance.proposalCount()> ./cwa09-guardian`
2. **Deployer:** sends the three transactions in `guardian-deployer-txs.json` (IFRLock, PartnerVault, Vesting).
3. **Treasury Safe:** imports `guardian-step1-safe.json`: Governance guardian now, plus two proposals.
4. **Treasury Safe, after 48 hours:** imports `guardian-step2-execute.json`.
5. Verify `guardian()` on all six contracts returns the Treasury Safe.

## Tests

- `node scripts/test-guardian-migration-proposal.cjs` (CI, contracts workflow)
- `HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent> MAINNET_RPC_URL=<rpc> npx hardhat test test/fork/GuardianMigrationFork.test.js`:
  full migration against the deployed contracts; afterwards the Safe can pause and unpause IFRLock and the deployer cannot.
