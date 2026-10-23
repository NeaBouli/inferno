# CWA-19: dormant buyback path evidence

Date: 2026-10-23. Scope: the current repository source in
`contracts/buyback/BuybackController.sol` and `BuybackVault.sol`, based on commit
`14b4afa505c8401905ce0a168814e3cae276a410`.

This is a local, non-forked evidence review before any future funding. It makes no
claim about deployed bytecode, current balances, live roles, or activation status.
No network, production contract changes, deployment changes, register updates,
generated documentation changes, or on-chain actions are part of this work.

The tests establish several protections, but **do not establish a blanket
reentrancy prohibition, safe approval-return handling, submission-bound MEV
protection, or a literally pause-only guardian**. The exceptions below are
executable observations, not assumptions that those properties already hold.

## Executable evidence

Test file: [`test/Buyback.cwa19.test.js`](../../test/Buyback.cwa19.test.js).

The tests reuse `MockRouter`, `MockFeeOnTransferToken`, `MockReentrantToken` and
`MockFalseReturnToken`. The new
[`MockBuybackCwa19.sol`](../../contracts/mocks/MockBuybackCwa19.sol) supplies only
missing test capabilities: empty/false ERC20 returns over a real nine-decimal
ledger, false approval resets, arbitrary router callbacks, observed swap/LP
arguments, and actual LP allowance consumption. The existing router's LP mock
never pulls tokens and ignores minima/deadlines, so it alone cannot prove the
approval-reset and deadline cases. The probe delegates its swaps and quotes to
that existing router. Its unrestricted helpers are adversarial test fixtures.

All token amounts and assertions use integer base units (`10n ** 9n` per IFR).
The no-return mock performs the ledger operation and then returns empty ABI data;
this tests rollback after an actual token state change, not a pre-transfer revert.

| Area | Cases | Evidence |
| --- | --- | --- |
| Reentrancy | R01-R05, R07-R09 | Router/token/LP callbacks cannot recursively enter guarded controller execution; non-owner callbacks cannot withdraw or execute the vault; vault cooldown is updated before interactions. Reverted operations restore balances and accounting. |
| Reentrancy limits | R06, R10 | A token callback from unguarded `withdrawIFR` can trigger permissionless `execute`; an owner/router can reenter a zero-cooldown vault, producing an empty nested execution. |
| ERC20 transfers | E01-E03 | False transfer returns are explicitly rejected. Empty transfer returns revert during ABI decoding. Both vault distribution legs and controller IFR withdrawal fail atomically. |
| ERC20 approvals | E04-E07 | False approval returns are unchecked. A failed initial approval causes the realistic LP pull to revert and triggers ETH buyback fallback; empty approval data reverts the entire cycle; a false reset retains spendable allowance on LP success or failure. |
| Slippage | M01-M04, M06-M08 | Normal swap/LP bounds are passed; default excessive swap slippage reverts. Vault 100% tolerance and quote rounding permit zero minimums. Spot-quote depression is accepted. |
| Expiry | M01, M05, M08 | Swap/LP deadlines equal the execution block timestamp. A transaction queued for one day still executes with a freshly generated deadline. |
| Roles | A01-A04 | Controller execution is permissionless; configuration/withdrawals are owner-only. Vault execution/configuration are owner-only. Guardians can pause and unpause, cannot configure or withdraw, and have no guardian setter. |
| Dormancy | D01-D03 | With neither ETH nor IFR, no positive token amount moves. Controller execution fails; empty vault execution emits zeros and changes its cooldown timestamp. IFR-only funding remains owner-recoverable from the controller. |

The controller's initial owner is the supplied `_governance` address; the vault's
initial owner is its deployer. Both owners can transfer ownership. The controller
allows anyone to execute after its pause/cooldown/minimum-ETH checks; the vault
requires its owner plus the pause/activation/cooldown checks. Only the owner can
change a router or execution parameters. Only the controller exposes ETH/IFR
withdrawals, both owner-only and available while paused. Guardians have no
privileged asset-movement function. Anyone may deposit ETH; pausing execution
does not prevent receipt of funds.

## Findings

### F01 — Low: unchecked approval resets retain a former router's spending authority

Source: [BuybackController.sol:186](../../contracts/buyback/BuybackController.sol#L186),
[203](../../contracts/buyback/BuybackController.sol#L203),
[206](../../contracts/buyback/BuybackController.sol#L206).

`approve(router, balance)` and both `approve(router, 0)` calls ignore the returned
boolean. E06 starts with 100 IFR, supplies a successful approval, consumes 95 IFR
for LP within the default 5% tolerance, and makes the reset return false without
changing the allowance. Execution succeeds with 5 IFR still approved. Even after
the owner replaces the router, the former spender can transfer those 5 IFR out.
E04 separately proves an initial false approval is ignored; an honest router's
failed token pull is caught and the ETH is routed to buyback instead. E07 proves
that a failed LP operation followed by a false reset retains the full 100 IFR
allowance while both ETH shares are successfully routed to buyback.

This is conditional on non-standard approval behavior. It does not assert that
the immutable production IFR token returns false on reset, or that any live
router currently has such an allowance. Low severity reflects that dependency
condition and the owner-selected token/router trust model.

Before supporting such tokens in a funded replacement, use checked safe approval
operations and verify that cleanup succeeds; cover both LP success and fallback
cleanup. Review outstanding allowances before router replacement.

### F02 — Low: the vault owner can disable the swap output floor

Source: [BuybackVault.sol:164](../../contracts/buyback/BuybackVault.sol#L164),
[127](../../contracts/buyback/BuybackVault.sol#L127).

`setParams` accepts `slippageBps = 10_000`, producing `minOut = 0`. M06 spends
1 ETH and credits zero IFR to both recipients with a successful transaction and
`BuybackExecuted(1 ether, 0, 0)`. Values above 100% are rejected in current source;
exactly 100% is allowed. Only the owner can configure this, so this is a
configuration hazard, not a permissionless override.

The controller rejects slippage above 1,000 bps (10%). Zero slippage bps means
requiring the full quote, not allowing zero output (M07).

For a funded replacement, impose a meaningful maximum below 100% and reject a
zero computed minimum/output. Existing deployed-version differences are outside
this local review.

### F03 — Medium: execution-time spot quotes provide no independent value floor

Source: [BuybackController.sol:161](../../contracts/buyback/BuybackController.sol#L161),
[188](../../contracts/buyback/BuybackController.sol#L188),
[BuybackVault.sol:126](../../contracts/buyback/BuybackVault.sol#L126).

Both contracts derive their swap minimum from `router.getAmountsOut` inside the
same execution that performs the swap. Neither executor accepts a caller-bound
absolute minimum or checks an independent historical price. M03 depresses the
mock quote and output by 1,000 times; both contracts spend their full ETH balance
at that price successfully. A configured 5% tolerance only bounds deviation from
the execution-time quote.

M04 also proves that a quote of one raw IFR unit rounds the computed minimum to
zero at the default 500 bps tolerance. Both contracts then accept zero delivered
IFR and spend all ETH. There is no explicit positive-minimum/output check.

The mock-rate switch models an adverse spot price; it is not a mainnet sandwich
simulation or a proof of profitable manipulation against a particular pool.
Medium severity is conditional on funding and a manipulable/insufficiently
liquid pricing venue. A funded design needs an independently anchored price
policy, appropriate liquidity/size limits, and explicit nonzero floors. For the
permissionless controller, caller-provided minimums alone are insufficient if a
different caller can execute first with weaker bounds.

### F04 — Low: router deadlines do not expire queued executor transactions

Source: [BuybackController.sol:167](../../contracts/buyback/BuybackController.sol#L167),
[197](../../contracts/buyback/BuybackController.sol#L197),
[BuybackVault.sol:132](../../contracts/buyback/BuybackVault.sol#L132).

The router receives `block.timestamp`. A caller cannot supply zero, an unlimited
deadline, or any other deadline through these executor entry points. However,
the timestamp is generated when the transaction is included, so it cannot expire
an executor transaction based on when it was submitted. M05 queues execution,
mines it one day later, and observes successful swaps whose deadlines equal the
new block timestamp. M08 checks the same timestamp policy for LP.

This is a timing/control limitation, amplified by F03, rather than a standalone
authorization bypass. If a funded design promises bounded execution validity,
bind an expiry to the authorized execution intent and enforce it in the executor.
For permissionless execution, enforce a protocol price policy as well.

### F05 — Low: immutable guardians can unpause as well as pause

Source: [BuybackController.sol:42](../../contracts/buyback/BuybackController.sol#L42),
[125](../../contracts/buyback/BuybackController.sol#L125),
[BuybackVault.sol:28](../../contracts/buyback/BuybackVault.sol#L28),
[97](../../contracts/buyback/BuybackVault.sol#L97).

A03 proves both guardians can pause and unpause, including after ownership is
transferred. Both declarations are immutable, neither ABI has `setGuardian`, and
owners cannot invoke the guardian-only pause/unpause functions unless the roles
coincide. A guardian cannot change the router/parameters, execute an owner-only
vault buyback, transfer ownership, or withdraw controller assets (A01-A02).
Controller execution remains permissionless for the guardian just as for any
other account when execution conditions are satisfied.

“Pause-only” is accurate only if it means no privileged configuration or asset
withdrawal powers; it is false if it means only the ability to stop execution.
The immutable key can also lift its halt. Low severity describes this mismatch
with the requested pause-only property. Agree on the intended recovery authority
before funding; changing the immutable role or separating pause/unpause authority
requires a replacement contract.

## Reentrancy conclusions and limits

`BuybackController.execute` uses `nonReentrant` at line 133, and updates
`lastExecution`, `executionCount` and `totalETHProcessed` before external calls
(lines 138-142). R01 and R04 observe the exact OpenZeppelin
`ReentrancyGuardReentrantCall()` error for router callbacks during swaps and LP;
R02 proves token-triggered failure restores all accounting and balances.

Withdrawals at lines 245 and 252 are owner-gated but **not** `nonReentrant`.
R03/R05 establish the authorization boundary for non-owner router/token callbacks.
R06 deliberately starts in an owner-authorized token withdrawal: its malicious
token calls permissionless `execute`, which succeeds because the outer withdrawal
did not acquire the execution guard. This causes a buyback/LP cycle but no
unauthorized withdrawal. It disproves a blanket cross-function exclusion without
demonstrating a privilege escalation. `withdrawETH` uses Solidity `transfer`
(line 248). R05-ETH exercises a recipient attempting a nested owner-only ETH
withdrawal: the outer transaction reverts atomically with unchanged balances.
This fixture does not isolate stipend exhaustion from access-control rejection,
and does not establish a general callback lock. Do not treat the gas stipend as
equivalent to a shared reentrancy guard.

`BuybackVault.executeBuyback` has no reentrancy guard. Its `onlyOwner` check
(line 109) blocks ordinary dependency callbacks. The timestamp is written before
external calls (line 114), so a privileged callback also hits a positive cooldown
(R09). The owner can set cooldown to zero. R10 makes the router the owner and
observes a successful nested empty execution: the full ETH balance has already
been sent to the router, so it cannot be spent twice in that fixture. This is a
privileged-composition limitation, not evidence of an unprivileged drain.

Neither contract exposes a public `burn()` function. The “burn” paths tested here
transfer/swap IFR to the configured burn-reserve address; they do not themselves
destroy supply. A separate reserve's later burn behavior is outside scope.

## ERC20 compatibility and dormancy conclusions

Neither contract uses `SafeERC20`. Explicit transfer boolean checks reject false
returns; empty return data is ABI-incompatible and reverts atomically (E01-E03).
Thus no-return tokens are unsupported but fail closed in the tested paths. Empty
approval data likewise reverts the entire controller execution, including its
earlier swap (E05). False approvals require the separate F01 treatment.

Dormancy here means **no ETH and no IFR in a local fixture**, not an activation
flag or a verified live balance. Empty controller execution reverts before router
interaction. Empty vault execution succeeds without router interaction and emits
zero amounts, while updating its cooldown timestamp. Zero-amount controller
withdrawals may succeed; no positive asset amount moves. D03 shows why zero ETH
alone is insufficient: the owner can still recover pre-existing controller IFR.
The vault has no withdrawal entry point. Both contracts accept direct ETH, and
the vault also accepts `depositETH`; they are not permanently funding-disabled.

## Verification

All commands use local dependencies and cached solc binaries, with
`HARDHAT_FORK=false`, `DOTENV_CONFIG_PATH=/dev/null`,
`HARDHAT_DISABLE_TELEMETRY=true`, and npm offline mode. They run from an empty
environment allowing only `PATH`, `TMPDIR` and those settings, plus
`NODE_OPTIONS` for a temporary compiler-cache preloader. The global compiler
cache is read-only in this workspace sandbox; the preloader uses Hardhat's
`setMockCacheDir` hook to point at a temporary copy of the existing solc cache.
No toolchain, repository configuration, or existing tests were changed for this.

| Command | Result |
| --- | --- |
| `npx --no-install hardhat test test/Buyback.cwa19.test.js` | **44 passing**, 0 failing (14 seconds). |
| `npx --no-install hardhat test` | **Blocked / exit 1** during Mocha file loading: the existing Builder compile harness cannot resolve its pinned local `solc` dependency. No complete Hardhat-suite pass count is available. |
| `npm run test:contracts` | **1,043 passing**, 0 failing (2 minutes), including the 44 new CWA-19 cases. |

The unfiltered-run blocker is at
[`test/builder/CodeGeneratorCompile.test.cjs:11`](../../test/builder/CodeGeneratorCompile.test.cjs#L11):
it requires `test/builder/compile-harness/node_modules/solc`, which is absent in
this worktree. The existing harness is a standalone tool that also requires a
compiled Builder directory argument (lines 3, 12-15). This file, the root package
scripts, and Hardhat configuration are unchanged. Installing dependencies or
changing test discovery is outside the assigned scope and no-network constraint.
The full unfiltered command therefore does **not** satisfy the requested green
acceptance gate in this environment. The CI contract command separately covers
`test/*.test.js` and `test/library/*.test.js`, including all new CWA-19 cases.

The new JavaScript file passes `node --check`. The complete added diff was
reviewed; all three new files pass whitespace checks, and tracked files remain
unchanged. No existing tests were weakened and no commits were created.
