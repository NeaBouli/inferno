# CommitmentVault V2 Repair (CV-01)

**Status:** V2 deployed, not yet wired (2026-10-03). Every Mainnet step below is performed by the deployer or the
Safe signers, never by automation.

- **V2:** `0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F`, deployed 2026-10-02 21:22:23 UTC in block 26107296, TX
  `0x9857a5707b650b8828f41b893f91a10ff26d7990742e782bb0b7e86df23ea0f7`. Owner Governance, no P0, no oracle;
  a `PRICE_ONLY` lock reverts with `price conditions disabled`. Runtime bytecode equals the compiled artifact
  except the immutable IFR address. Sourcify exact match; Etherscan source verification pending.
- **Proposal #17** `setFeeExempt(V2, true)`: queued by the Treasury Safe, TX
  `0x6e113b6cc66a369604d46c3b4a5560f1418302de6ecc371f1217d72aeabd39bd`, ETA 2026-10-04 21:53:11 UTC.
  **Not executed:** `InfernoToken.feeExempt(V2)` stays `false` until step 4 is executed.

## Why

The deployed CommitmentVault V1 (`0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3`) accepts price-conditioned
tranches but cannot evaluate a price. Its price check always reads zero, and it has no rescue, pause or upgrade
path. 26,418,467.994338353 IFR are therefore permanently locked
([CV-01](https://ifrunit.tech/wiki/commitment-vault-compensation.html)).

V1 cannot be changed. The repair is a new vault, V2, built from the repository source:

- `lock()` accepts only `TIME_ONLY` until a real, reviewed price source exists
  (`require(cType == ConditionType.TIME_ONLY, "price conditions disabled")`).
- An impossible condition can therefore never be created again.
- A time-only tranche always unlocks after its `unlockTime`.

## Rehearsal (repeatable, no Mainnet effect)

```sh
HARDHAT_FORK=true HARDHAT_FORK_BLOCK_NUMBER=<recent block> MAINNET_RPC_URL=<rpc> npm run test:commitment-v2-fork
npm run test:commitment-v2-proposal
```

The fork test checks the following against the **deployed** Governance and IFR token:

- V2 is deployed with Governance as owner, without P0 or an oracle.
- All three price-conditioned lock types are rejected.
- The Safe executes the **exact bytes** of the generated batch files: propose, then a refused early execute, then
  execute after the on-chain Governance delay. After that, `InfernoToken.feeExempt(V2)` is `true`.
- A `TIME_ONLY` lock keeps nominal accounting (vault balance equals `totalLocked`) and returns the exact amount
  after its unlock time.

The weekly `benefits-verify-live.yml` fork job runs the rehearsal again.

## Mainnet Steps

### 1. Deploy (deployer) — done 2026-10-02

```sh
npx hardhat run scripts/deploy-commitment-vault.js --network mainnet
```

- Constructor: IFR token and Governance `0xc43d48E7FDA576C5022d0670B652A622E8caD041` as owner.
- Record the address and the deployment transaction in `deployments/mainnet.json` and `docs/DEPLOYMENTS.md`.
- Do not call `setP0` or `setPriceOracle`. V2 has no price path.

### 2. Generate the Safe batch files (anyone) — done (proposal id 17)

```sh
node scripts/commitment-vault-v2-proposal.cjs <V2 address> <Governance.proposalCount()> ./cv01-safe
```

This writes `cv01-v2-step1-propose.json` and `cv01-v2-step2-execute.json` for the Safe Transaction Builder:

- **Step 1** calls `Governance.propose(InfernoToken, setFeeExempt(V2, true))`.
- **Step 2** calls `Governance.execute(<id>)`.

The script refuses the V1 address.

### 3. Propose (Safe, 3-of-5) — done 2026-10-02 21:53 UTC

- Import step 1 into the Safe Transaction Builder of the Governance owner Safe.
- Check the decoded call: target `Governance`, inner target `InfernoToken`, `setFeeExempt(<V2>, true)`.
- Sign and execute.

### 4. Execute after the delay (Safe) — open, from 2026-10-04 21:53:11 UTC

- Wait until the proposal `eta` has passed (48 hours).
- Import step 2, check the proposal id, then sign and execute.
- Verify that `InfernoToken.feeExempt(<V2>)` returns `true`.

### 5. Switch the interfaces (repository PR)

**New locks:**

- `docs/web3/index.html` and the CommitmentVault wiki widget create new locks only in V2.

**Existing V1 tranches:**

- Existing V1 tranches stay visible and can still be unlocked through V1.
- C2's time tranches are unlockable now, C3's time tranche from 2026-10-05, and C1's TIME_OR_PRICE tranche
  after its time condition.

**Other surfaces:**

- Add V2 to the vault-invariant monitor, the transparency pages and the benefits verifier contracts list.
- Do this only after step 4 is verified.

### 6. Record

Update the following:

- the decision register (lane 2);
- the CWA register (CWA-03): V1 permanent loss recorded, V2 live;
- CV-01 and the changelog.

## What V2 Does Not Do

- It does not release V1 tranches. Nothing can.
- It does not implement price-conditioned locks. A price path needs a reviewed manipulation-resistant oracle
  and a rescue route for unreachable conditions, and is a separate decision (decision register lane 2).
