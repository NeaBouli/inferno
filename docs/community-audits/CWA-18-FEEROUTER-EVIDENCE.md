# CWA-18 / JUL-22: FeeRouterV1 executable evidence

Date: 2026-10-23. Scope: the repository's unmodified
[`contracts/FeeRouterV1.sol`](../../contracts/FeeRouterV1.sol), exercised through
[`test/FeeRouterV1.cwa18.test.js`](../../test/FeeRouterV1.cwa18.test.js).
This records local source behavior, without asserting any deployed contract state.
No network, fork, production credentials, or on-chain action is required.

Source baseline: `14b4afa505c8401905ce0a168814e3cae276a410`.
FeeRouterV1 source SHA-256:
`6c10e00ea4b82f41ea57c1535200169dc32f9eab6f9d1576c42d4629e5eaf396`.

## Results

The tests **disprove zero-address rejection and numerical `maxUses` enforcement**.
V1 accepts zero in every address-taking constructor/setter path. It consumes a
boolean nonce once per user, regardless of the signed `maxUses` value.
Replay protection, EIP-712 domain separation, expiry, signer/user binding, the
25-bps fee cap, and the swap pause work in the tested cases.

All 33 added tests assert actual behavior. A passing test marked `FINDING` is a
reproduction of a gap, not evidence that the gap has been remediated. Existing
tests, contracts, deployment scripts, remediation registers, and generated docs
are unchanged.

## Address paths and findings

These are all address-taking constructor/setter paths in FeeRouterV1. There is
no governance setter. `setFeeBps` and `setPaused` take no address.

| Path | Observed zero-address behavior | Finding | Source / test evidence |
| --- | --- | --- | --- |
| Constructor `_governance` | Deployment succeeds; all five ordinary test callers fail administration with `Not governance`. No adapter can be enabled through normal governance calls. | ZERO-01 | [Assignment, line 66](../../contracts/FeeRouterV1.sol#L66), [governance check, line 73](../../contracts/FeeRouterV1.sol#L73); [test, line 63](../../test/FeeRouterV1.cwa18.test.js#L63) |
| Constructor `_feeCollector` | Deployment succeeds; a paid swap transfers the protocol fee to zero. | ZERO-02 | [Assignment, line 67](../../contracts/FeeRouterV1.sol#L67), [fee transfer, line 109](../../contracts/FeeRouterV1.sol#L109); [test, line 74](../../test/FeeRouterV1.cwa18.test.js#L74) |
| Constructor `_voucherSigner` | Deployment succeeds; a voucher signed by the normal test signer is invalid. Swaps without vouchers still work. | ZERO-03 | [Assignment, line 68](../../contracts/FeeRouterV1.sol#L68), [signer check, line 143](../../contracts/FeeRouterV1.sol#L143); [test, line 86](../../test/FeeRouterV1.cwa18.test.js#L86) |
| `setFeeCollector(newCollector)` | Governance can store zero; subsequent protocol fees go to zero. | ZERO-02 | [Assignment, line 222](../../contracts/FeeRouterV1.sol#L222); [test, line 102](../../test/FeeRouterV1.cwa18.test.js#L102) |
| `setVoucherSigner(newSigner)` | Governance can store zero; an initially valid voucher fails until the signer is restored. The failed attempt does not consume its nonce. | ZERO-03 | [Assignment, line 209](../../contracts/FeeRouterV1.sol#L209); [test, line 112](../../test/FeeRouterV1.cwa18.test.js#L112) |
| `setAdapter(adapter, status)` | Both `true` and `false` accept zero. Enabling zero lets a swap successfully forward its post-fee ETH to zero. Disabling zero removes the entry and blocks that swap. | ZERO-04 | [Whitelist write, line 202](../../contracts/FeeRouterV1.sol#L202), [adapter call, line 116](../../contracts/FeeRouterV1.sol#L116); [enable test, line 127](../../test/FeeRouterV1.cwa18.test.js#L127), [disable test, line 139](../../test/FeeRouterV1.cwa18.test.js#L139) |

ZERO-01 through ZERO-04 are configuration-validation findings. Setters still
require governance: each address-taking setter is also tested from an
unauthorized caller supplying zero. Accepting zero when *removing* an adapter is
recorded for completeness; the demonstrated ETH-loss configuration is enabling
it. Balance checks establish both the zero-address transfer and the amount
received by the collector/adapter.

## FINDING USE-01: maxUses is signed but not enforced

[`maxUses`](../../contracts/FeeRouterV1.sol#L45) is included in both the
[redemption hash, line 137](../../contracts/FeeRouterV1.sol#L137) and the
[view-validation hash, line 177](../../contracts/FeeRouterV1.sol#L177). Its
numerical value is never compared with a use count. Redemption checks a
[boolean nonce, line 129](../../contracts/FeeRouterV1.sol#L129) and
[sets it to true, line 146](../../contracts/FeeRouterV1.sol#L146).

| Signed `maxUses` | First use | Identical signature, second attempt |
| --- | --- | --- |
| `0` | Accepted | `Nonce already used` |
| `1` | Accepted | `Nonce already used` |
| `2` | Accepted | `Nonce already used` |
| `3` | Accepted | `Nonce already used` |
| `4294967295` (`uint32` maximum) | Accepted | `Nonce already used` |

The five [usage tests, line 163](../../test/FeeRouterV1.cwa18.test.js#L163)
exercise both `isVoucherValid` and actual paid swaps. Before first use the view
returns `(true, "Valid")`, including for `maxUses=0`; afterwards it returns
`(false, "Used")`. Rejected repeats transfer no ETH to the adapter or collector.
The requirement that arbitrary N uses succeed is therefore disproved for N>1.

The effective limit is **one committed redemption per `(router, user, nonce)`**.
It is not a global nonce limit or a per-user lifetime total. Two users can each
redeem their own correctly signed voucher with the same numeric nonce, and one
user can redeem different nonces. Re-signing changed voucher fields cannot
revive that user's consumed nonce. A transaction that reverts in the adapter
rolls back both fee transfer and nonce consumption. `useVoucher=false` ignores
the voucher and its signature; a successful zero-value swap with
`useVoucher=true` still consumes the nonce. Changing `maxUses` without obtaining
a new signature fails signature validation.

## Replay, fee, and pause evidence

- **Same signature:** every tested `maxUses` value is single-use. Replay fails
  with `Nonce already used`.
- **Other contract:** a second router has the same governance, collector,
  signer, and adapter configuration but a different address. A signature
  successfully used on the first router fails on the second with
  `Invalid voucher signature`, despite its unused nonce. Re-signing for the
  second address succeeds.
- **Other chain:** two fresh in-process EDR networks use the local chainId and
  chainId+1. Their routers have identical addresses, configurations, users,
  signers, and initial nonces. A voucher successfully redeemed on the first
  fails on the second with `Invalid voucher signature`. Re-signing only for
  the second chainId succeeds. Both temporary networks are closed afterwards.
- **Wrong signer/user:** both view validation and redemption reject the
  attempt without consuming either user's nonce. Correctly authorized
  redemption afterwards succeeds.
- **Expiry:** redemption at exactly `expiry` succeeds. At `expiry+1`, view
  validation returns `Expired` and redemption reverts with `Voucher expired`.
- **Fee cap:** 0 and 25 bps are accepted and produce exact integer ETH fee
  amounts; 26 and 65535 bps revert with `Exceeds fee cap` and preserve the
  prior rate. Existing tests also cover discounts equal to/above the fee.
- **Pause:** both voucher and non-voucher swaps revert with `FeeRouter paused`
  without transfers or nonce consumption. Unpause permits the swap and charges
  the configured fee. Governance can update configuration during a pause.
  `isVoucherValid` still reports a valid voucher while paused, and `receive()`
  still accepts direct ETH: the pause applies to `swapWithFee`.

## Added test names (33)

All names below belong to `FeeRouterV1 CWA-18 / JUL-22 evidence`.

### zero-address constructor and setter paths (10)

1. `FINDING ZERO-01: constructor accepts zero governance and leaves
   administration inaccessible`
2. `FINDING ZERO-02: constructor accepts zero feeCollector and sends fees to
   zero`
3. `FINDING ZERO-03: constructor accepts zero voucherSigner and rejects
   otherwise valid signatures`
4. `FINDING ZERO-02: setFeeCollector accepts zero and sends fees to zero`
5. `FINDING ZERO-03: setVoucherSigner accepts zero and disables signed vouchers
   until restored`
6. `FINDING ZERO-04: setAdapter(zero, true) enables a successful value transfer
   to zero`
7. `FINDING ZERO-04: setAdapter(zero, false) accepts zero and removes its
   whitelist entry`
8. `setFeeCollector still rejects a non-governance caller supplying zero`
9. `setVoucherSigner still rejects a non-governance caller supplying zero`
10. `setAdapter still rejects a non-governance caller supplying zero`

### maxUses and nonce scope (10)

1. `FINDING USE-01: maxUses=0 still permits one successful use`
2. `enforces exactly one successful use when maxUses=1 (N succeeds, N+1
   reverts)`
3. `FINDING USE-01: maxUses=2 rejects the second use before the signed limit`
4. `FINDING USE-01: maxUses=3 rejects the second use before the signed limit`
5. `FINDING USE-01: maxUses=4294967295 rejects the second use before the signed
   limit`
6. `binds maxUses in the signature even though it does not enforce a use
   counter`
7. `tracks nonces per user rather than globally or as a per-user total`
8. `rejects a newly signed voucher that reuses an already consumed user nonce`
9. `ignores an unused voucher when useVoucher=false but consumes it even on a
   zero-value voucher swap`
10. `rolls back nonce consumption and fee transfers when the adapter call
    reverts`

### signature replay and expiry boundaries (6)

1. `rejects replay on another router address with identical configuration and an
   unused nonce`
2. `rejects replay on another chainId at the same router address`
3. `rejects a voucher signed by the wrong signer without consuming its nonce`
4. `rejects another user's signed voucher without consuming either user's nonce`
5. `accepts a voucher at its exact expiry timestamp`
6. `rejects a voucher one second after expiry without consuming its nonce`

### fee cap and pause boundaries (7)

1. `accepts feeBps=0 and charges that exact rate`
2. `accepts feeBps=25 and charges that exact rate`
3. `rejects feeBps=26 above the cap without changing the fee`
4. `rejects feeBps=65535 above the cap without changing the fee`
5. `blocks swaps with useVoucher=false while paused and resumes without losing
   the voucher`
6. `blocks swaps with useVoucher=true while paused and resumes without losing
   the voucher`
7. `continues to accept direct ETH deposits while paused`

## Verification and limitations

Environment: Node.js 22.22.2, Hardhat 3.20.0, Ethers 6.17.0. Tests use local
simulated networks with `HARDHAT_FORK=false`, and npm runs with
`npm_config_offline=true`. `npx --no-install` uses the already installed CLI.

Commands, in the same order as the results below:

```sh
npx --no-install hardhat test test/FeeRouterV1*.test.js
npm run test:contracts
npx --no-install hardhat test
```

| Run | Observed result |
| --- | --- |
| FeeRouter files | **66 passing**, 0 failing (33 existing, 33 added). |
| Repository contract suite | **1032 passing**, 0 failing (includes 33 added). |
| Bare full discovery | **Blocked** loading the existing Builder harness. |

`npm run test:contracts` runs
`hardhat test test/*.test.js test/library/*.test.js`.
Bare full discovery aborts with `MODULE_NOT_FOUND` for
`test/builder/compile-harness/node_modules/solc`, imported at
`test/builder/CodeGeneratorCompile.test.cjs:11`. No aggregate Hardhat pass count
is available for that invocation.

The bare full-discovery command also loads existing standalone tooling tests.
The compile-harness dependency is absent in this worktree. An attempted offline
installation failed with `ENOTCACHED` for `tmp-0.2.7.tgz`:

```sh
npm_config_offline=true npm ci --ignore-scripts --no-audit --no-fund \
  --prefix test/builder/compile-harness
```

No network fallback was used.
Additionally, that existing Builder test expects a compiled-engine directory
argument at [line 12](../../test/builder/CodeGeneratorCompile.test.cjs#L12),
and is normally run as a standalone script. The unrelated harness/test runner
was not changed. The bare full-suite acceptance criterion remains unmet.

The first normal test attempt hit a compiler-cache mutex timeout because the
shared cache is outside the writable sandbox. The successful normal focused
run used Hardhat's `setMockCacheDir` test override in a temporary Node preload,
with copies of the existing compiler manifests and binaries for solc 0.8.20
and 0.8.28 (native and WASM). Each copied binary's SHA-256 matched its cached
manifest. No compiler, dependency, configuration, or contract source was patched.
The normal focused command reported `No contracts to compile`; a separate run
with `--no-compile` also passed all 66 tests.
