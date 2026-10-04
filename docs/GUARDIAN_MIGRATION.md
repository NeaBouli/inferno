# Guardian Migration to the Treasury Safe (CWA-09)

**Status:** in progress (2026-10-04). Every Mainnet step is performed by the deployer or the Safe signers, never by
automation. Steps 1-3 are done; step 4 waits for the Governance delay. The step-2 generator is pinned to the queued
proposals and verifies their exact on-chain content before writing any file (T-242).

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
   The positional form and the later `--fixture` mode are retired (T-242/T-242a): the CLI only writes verified
   `--execute` output; the offline `build()` fixture is a library export for tests and the fork rehearsal.
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
4. **Pending.** After the ETA the Treasury Safe executes proposals #19 and #20. Final pre-sign validation
   (fresh, immediately before signing):
   1. Regenerate the batch: `node scripts/guardian-migration-proposal.cjs --execute ./cwa09-guardian`
      (optionally with `MAINNET_RPC_URL=<archive rpc>`). The script re-reads proposals #19/#20 and refuses to
      write unless both still exist with exactly target LiquidityReserve/BurnReserve, calldata
      `setGuardian(0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b)` and ETA 2026-10-04 23:56:11 UTC, and neither is
      executed or cancelled. A non-Mainnet RPC, an unreachable endpoint or any drift exits non-zero and writes
      nothing.
   2. Confirm the printed verification line and compare `guardian-step2-execute.json` byte-for-byte with the
      transactions shown in the Safe UI (targets Governance, `execute(19)`, `execute(20)`, value 0).
   3. Generating before the ETA is valid; signing and executing must wait until the ETA has passed.
      `Governance.execute` reverts with `too early` otherwise.
   4. Re-run step 4.1 if any signing session happens long after generation; a cancelled or already-executed
      proposal makes the regenerated file refuse.
   Until then the LiquidityReserve and BurnReserve guardian is still the deployer EOA.
5. **Pending.** Verify `guardian()` on all six contracts returns the Treasury Safe.

## Tests

- `node scripts/test-guardian-migration-proposal.cjs` (CI, contracts workflow): fixture bytes, pinned
  queued-proposal verification (wrong id/target/calldata/ETA, executed, cancelled, wrong-chain and unreadable
  RPC), the RPC transport boundary (non-2xx, malformed JSON-RPC envelope, timeout) and the CLI mode boundary
  (`--execute` only, no file on any refusal).
- `HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=26108024 MAINNET_RPC_URL=<archive rpc> npx hardhat test test/fork/GuardianMigrationFork.test.js`:
  full migration against the deployed contracts; afterwards the Safe can pause and unpause IFRLock and the deployer cannot.
  The rehearsal is pinned to exactly block 26108024, the last block before the live migration. Later blocks already
  contain the moved roles, and the test refuses them. Forking a past block needs an archive-capable RPC.
- `HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=26119897 MAINNET_RPC_URL=<archive rpc> npx hardhat test test/fork/GuardianQueuedExecutionFork.test.js`:
  post-queue proof at exactly the evidence block 26119897: the generator verifies the real queued #19/#20 on the
  fork, the Safe executes the generated bytes, and all six mutable guardians end at the Treasury Safe. A read
  pinned to a pre-queue block must refuse generation (wrong fork block).
