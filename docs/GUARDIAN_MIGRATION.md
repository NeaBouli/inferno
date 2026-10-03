# Guardian Migration to the Treasury Safe (CWA-09)

**Status:** in progress (2026-10-03). Every Mainnet step is performed by the deployer or the Safe signers, never by
automation. Steps 1-3 are done; step 4 waits for the Governance delay.

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

1. **Done.** `node scripts/guardian-migration-proposal.cjs 19 ./cwa09-guardian` (first proposal id 19).
2. **Done (deployer).** The three transactions in `guardian-deployer-txs.json`, each verified on-chain afterwards
   (`guardian()` = Treasury Safe):
   - IFRLock: block 26108025,
     [`0x8e3beb0f…822b93`](https://etherscan.io/tx/0x8e3beb0f87acb6bc83d38572c28697ceb65bc632b7cadf95e19992b1f1822b93)
   - PartnerVault: block 26108027,
     [`0x38172595…185fcb`](https://etherscan.io/tx/0x38172595e9eb1ebc87ee9b910cae5a4db4545fd0efb00d1a164f97568a185fcb)
   - Vesting: block 26108029,
     [`0x5c0f8996…203fe0`](https://etherscan.io/tx/0x5c0f89964819e8712eadd1b954a571a36db1137fcaac9254e88e2527ec203fe0)
3. **Done (Treasury Safe, nonce 20).** `guardian-step1-safe.json` executed in block 26108062,
   [`0xfdd90c5e…e3d394c`](https://etherscan.io/tx/0xfdd90c5ef44efd617af0338fa2e95867cfa45367ac644975774e1b3fae3d394c):
   Governance `guardian()` = Treasury Safe; proposals #19 (LiquidityReserve) and #20 (BurnReserve) queued with ETA
   2026-10-04 23:56:11 UTC.
4. **Pending.** After the ETA the Treasury Safe imports `guardian-step2-execute.json` (execute #19 and #20).
   Until then the LiquidityReserve and BurnReserve guardian is still the deployer EOA.
5. **Pending.** Verify `guardian()` on all six contracts returns the Treasury Safe.

## Tests

- `node scripts/test-guardian-migration-proposal.cjs` (CI, contracts workflow)
- `HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=26108024 MAINNET_RPC_URL=<archive rpc> npx hardhat test test/fork/GuardianMigrationFork.test.js`:
  full migration against the deployed contracts; afterwards the Safe can pause and unpause IFRLock and the deployer cannot.
  The rehearsal is pinned to block 26108024, the last block before the live migration. Later blocks already contain
  the moved roles, and the test refuses them. Forking a past block needs an archive-capable RPC.
