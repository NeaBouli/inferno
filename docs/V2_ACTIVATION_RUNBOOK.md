# V2 activation runbook

**Status:** Release candidate - ready, not activated. Ratified 2026-10-18.
Scope: GovernanceV2, LendingVaultV2 and the new time-only CommitmentVaultV2
source release candidates. No mainnet deployment or activation is authorized here.
The existing deployed CommitmentVault V2 is a separate address/build and remains
unchanged. The separate price-lock successor is outside this release.

External audit has **not** been performed. It is pending funding, deferred until
the token has a stable price and funding is available. Disclose that deferral and
the remaining risks in every approval dossier; never describe this release as audited.

## Remaining before activation

- Approved Governance proposal covering the exact release and activation scope.
- Treasury Safe signer approval and verified Safe identities, owners, thresholds,
  modules, guards and separation of the cancel-only 2-of-3 guardian.
- Reviewed constructor arguments, immutable dependencies, exact build and hashes.
- External audit deferred as stated above; record the deferral in the proposal.
- Applicable fork/staging, custody, fee-exemption, role and operational evidence
  from the [Governance](specs/GOVERNANCE_V2_IMPLEMENTATION_NOTES.md),
  [LendingVault](specs/LENDINGVAULT_V2_IMPLEMENTATION_NOTES.md) and
  [CommitmentVault](specs/COMMITMENTVAULT_V2_PRICE_LOCKS_SPEC_IMPLEMENTATION_NOTES.md)
  implementation notes. Lending activation additionally requires a conforming
  production oracle adapter and credible liquidity/manipulation evidence; neither
  is supplied by the mock tests. Keep borrowing paused with zero caps until then.

## 1. Prepare and deploy inactive contracts

Freeze the reviewed commit, compiler/settings, lockfile and constructor manifest.
Run `npx hardhat test`, the static/docs gates and the deployment dry-run below.
Obtain separate action-specific authorization before any real deployment.
Never copy historical mainnet addresses into a new manifest without fresh,
block/hash-pinned identity and bytecode verification.

`scripts/deploy-v2-release.js` selects one contract per invocation:

| `V2_CONTRACT` | Required environment inputs, in constructor order |
| --- | --- |
| `GovernanceV2` (default) | `V2_TREASURY_SAFE`, `V2_GUARDIAN_SAFE`, `V2_DELAY_SECONDS` (default `172800`) |
| `LendingVaultV2` | `V2_IFR_TOKEN`, `V2_WETH`, `V2_FACTORY`, `V2_OWNER` (approved GovernanceV2 address) |
| `CommitmentVaultV2` | `V2_IFR_TOKEN`, `V2_OWNER` (approved GovernanceV2 address) |

All addresses are explicit; there are no live-address defaults. Delay is an integer
in seconds within `[172800, 2592000]`; the ratified initial default is 48 hours.
Governance owner and guardian must be distinct. Use reviewed contract identities
for production roles; a syntactically valid address does not prove Safe identity.

After exporting the selected constructor inputs, run:

```sh
npx hardhat run scripts/deploy-v2-release.js --network hardhat
```

The default `V2_BROADCAST=false` prints network/chain ID, constructor arguments,
creation-bytecode hash, full init-code hash (including constructor arguments), and
runtime size. It requests no signer and sends no transaction. It does not simulate
the constructor, verify dependency identities or prove deployment acceptance.
Local test addresses are unsuitable for a real deployment.

For an authorized Sepolia rehearsal use `--network sepolia`; only the literal
`V2_BROADCAST=true` sends a deployment transaction. Mainnet is refused, even for a
dry-run, unless `V2_ALLOW_MAINNET=true` is also set. The flags are technical guards,
not authorization. Signers come exclusively from the existing Hardhat configuration;
this script does not read keys, configure roles, transfer ownership or activate entry.
Deploy GovernanceV2 first, verify it, then use its approved address as each vault owner.

## 2. Verify before wiring

Record chain ID, deployment receipt/block/hash, constructor inputs and actual
deployed-code hash printed by the script. Verify source and compiler settings
through the configured Hardhat verification provider. Compare actual runtime code
against the reviewed build with constructor immutables resolved; the creation hash
alone is not a deployed-runtime attestation. Archive verification and role reads.

Verify GovernanceV2 owner/guardian separation, delay and empty proposal count;
LendingVaultV2 must have both pauses set and zero caps; CommitmentVaultV2 must have
deposits disabled and zero entry limits. Verify every dependency, controller and
required two-step acceptance with the real Safe/controller path on staging.
No token/custody migration or legacy-role handoff is implicit in deployment.

## 3. Governance proposal and signer approval

Publish exact targets, calldata, constructor/build hashes, risks, audit deferral,
rollback/pause plan and evidence. Obtain the Governance vote and Treasury Safe
signer approval. Queue only the approved wiring/fee-exemption/configuration calls.
For an expired proposal, submit a new proposal with a fresh ID and full delay;
the off-chain dossier must reference the old `(chainId, controller, id)` and
operation hash. Never revive the expired ID or change the target calldata to
carry a human-readable reference.

## 4. Wait at least 48 hours

Respect every snapshotted ETA, current approved delay and execution deadline.
GovernanceV2 has a 48-hour floor and seven-day execution window after ETA.
Vault configuration queues have their own 48-hour delays; an outer GovernanceV2
proposal does not satisfy the inner vault timer. Queue and execute each layer
through separately approved exact calls, checking both clocks. The guardian may
cancel; there is no emergency bypass. Vault queue lifetime rules differ from
GovernanceV2 proposal expiry; inspect the applicable notes.

## 5. Execute and confirm activation

Execute only while the proposal is Ready and every prerequisite still holds.
Recheck roles, accepted/pending owners, fee exemption, caps, pauses, oracle policy
and version at a recorded block/hash. Verify successful receipts and expected
balance/accounting invariants; start alerts and rehearse the approved pause path.
Route only newly authorized opt-in activity after those checks. Existing custody,
V1 retirement, current time-only V2 routing and CV-01 compensation remain separate.
