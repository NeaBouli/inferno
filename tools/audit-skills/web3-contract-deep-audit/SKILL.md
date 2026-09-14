---
name: web3-contract-deep-audit
description: >-
  Deep security audit of EVM/Solidity smart contracts, going beyond a general code review:
  manual line-by-line analysis PLUS local static analysis (Slither), symbolic execution
  (Mythril), property-based fuzzing (Foundry), deployed-bytecode-vs-source verification, and
  block-pinned on-chain state verification. Use this skill whenever the user asks for a
  contract-focused security audit, a "deep dive" on Solidity contracts, a pre-deployment or
  pre-activation contract review, a second opinion on an existing token/vault/timelock, or
  whenever a surface-level audit flagged a contract area that needs proof-grade depth. Trigger
  it for phrases like "audit the contracts properly", "Sicherheitsaudit speziell für die
  Contracts", "deep audit", "verify deployed code matches source", or when preparing a
  governance-critical activation (oracle prices, lending, fee changes). Works standalone on any
  EVM repo; for the IFR/Inferno project pair it with the inventory in `collateral-web3-audit`.
compatibility: "Claude Code (~/.claude/skills/), Kimi Code, Cowork"
---

# Web3 Contract Deep Audit

A general audit answers "is the system sound?" A *deep* contract audit answers "can you prove
it?" — every claim is backed by a reproduced tool run, a fuzzed invariant, a bytecode match, or
a block-pinned chain read. The difference from a normal review is the evidence bar, not the
checklist.

## When this applies

Contracts holding (or designed to hold) value; any upcoming activation/parameter change on live
contracts; deployed-source trust questions; second-opinion requests. If the target is the IFR
Protocol (NeaBouli/inferno), read the contract inventory and known-issues register from the
`collateral-web3-audit` skill's `references/contract-map.md` first and verify those entries
rather than re-discovering them.

## Evidence rules (non-negotiable)

1. **Pin baselines:** repo commit SHA, chain block number, tool versions. Every claim cites one.
2. **Reproduce, don't quote.** If the project reports a Slither/Mythril/test result, re-run it
   with the project's own pinned toolchain and config. A CI badge is a claim; a local run is
   evidence. If a tool cannot run in the current environment, say so explicitly and mark the
   result "CI-attested only" — never silently upgrade that to "verified".
3. **Concrete traces.** Every finding includes a numbered execution path with realistic numbers
   and preconditions. "Possible reentrancy" is not a finding; "callback X re-enters Y before Z
   is written, extracting N tokens" is.
4. **Deployed ≠ source until proven.** Compare bytecode (see §Bytecode verification) or cite a
   verified-source read. Docs saying "verified on Etherscan" is a claim to check, not evidence.
5. **Read-only on-chain.** `eth_call` only. No transactions, no signatures, no state changes.
6. **Report, don't fix.** Remediations are proposed, never applied to the audited tree.

## Method — six layers, in order

### Layer 1: Manual review (highest yield)

Read every in-scope contract line by line. Hunt by vulnerability class, and for each class
write down *why it does or doesn't apply* — the negative results go in the report's coverage
table, proving the class was considered:

- **Reentrancy**: classic (state written after external call), cross-function (two functions
  sharing state, one guarded differently), read-only (a view consumed by another contract while
  a call is mid-flight). CEI violations are only findings when a callback-capable callee exists
  (ERC-777/721/1155 hooks, contract wallets, malicious token). With a known in-house token and
  `nonReentrant`, say *why* it's safe — don't just pattern-match.
- **Access control**: enumerate every `external`/`public` state-changing function and its gate
  (none / owner / guardian / self / anyone-by-design). For each privileged function: what is the
  worst thing a key holder can do, and what bounds exist (caps, timelock, immutability)?
- **Value accounting**: deposits/withdrawals against a fee-on-transfer or rebasing token break
  naive accounting (`transferFrom` amount ≠ received amount). Check for the exemption dependency
  and what breaks if it's ever removed. Trace balance vs. internal-ledger invariants.
- **Oracle & price inputs**: who sets the price, what bounds/freshness exist, what a single bad
  value enables (compute the actual drain/liquidation scenario with the contract's live
  balances). Fail-closed beats fail-open — verify the closed state on-chain, don't infer it.
- **Signatures (EIP-712/191)**: domain separator contents (name/version/chainId/verifying
  contract), nonce/replay handling, deadline enforcement, `ecrecover` zero-address, unused
  signed fields (signed-but-unenforced fields mislead integrators).
- **Arithmetic**: truncation direction (who profits from rounding — protocol or user?), decimal
  mismatches (9 vs 18 decimals), min-first-period/min-amount quirks, overflow is mostly moot on
  0.8+ but bounds on *inputs* (bps sums, duration ranges) are not automatic.
- **DoS / griefing**: unbounded loops over user-controlled arrays, `.transfer()` 2300-gas to
  contract receivers (frozen funds / un-liquidatable positions), block-stuffing assumptions in
  time windows, permissionless triggers that revert under adversarial state.
- **Time**: `block.timestamp` tolerance is fine for days-scale logic; flag anything where seconds
  matter. Missing expiry/deadline on signatures and loans. Missing expiry *enforcement* on
  duration-bounded positions (what happens after `startTime + duration` passes with no repay?).
- **Governance surface**: for timelocks — what is *not* routed through the delay (guardian
  rotation? pauses? parameter setters on child contracts?); execution permissioned vs.
  permissionless; proposal expiry; arbitrary-call power; whether the timelock itself can send ETH.
- **Events / monitoring**: every state change emits an event? Could the claimed off-chain monitor
  actually reconstruct state from events alone?
- **Initialization**: constructor-set immutables vs. later setters; zero-address checks; single-
  step ownership transfer (no accept) is a reliability finding everywhere it appears.

### Layer 2: Static analysis (Slither)

Use the project's own pins when they exist (e.g. venv + `slither-analyzer==<pinned>` +
`solc-select` per CI). Otherwise: `pip install slither-analyzer`, match the compiler to the
deployment. Run, then triage every High/Medium: real / false-positive / by-design, each with a
one-line justification. If the project maintains a baseline file, diff your run against it and
report *new* signals first. Never paste raw detector output into the report — triage is the work.

### Layer 3: Symbolic execution (Mythril or equivalent)

Bounded runs on the concrete (deployed-shape) contracts: the project's config or a sane default
(2–3 transactions, execution timeout 30–60 s, solver timeout 10 s). Mythril's value is in the
exceptions it *doesn't* find; its absence of findings is weak evidence and must be presented as
bounded, with the bounds stated. On platform/toolchain mismatch (hashed requirement files are
platform-specific), fall back to the pinned version without `--require-hashes` and disclose the
deviation.

### Layer 4: Property-based fuzzing (Foundry)

Write Forge invariant/fuzz tests for the contract's load-bearing properties. This is where a
deep audit earns its keep: pick the 3–6 invariants whose violation would lose money, and fuzz
them. Typical set:

- Token fee conservation: for all amounts, `net + poolFee + burns == value`, and
  `totalSupply` never increases after construction.
- Lock accounting: `sum(user locks) == totalLocked == token.balanceOf(lock)` under random
  lock/unlock sequences (with and without fee exemption — prove the dependency).
- Vesting/curve monotonicity: vested amount is non-decreasing in time; never exceeds allocation.
- Staged-withdrawal caps: no call sequence exceeds `maxWithdrawPerPeriod` within a period.
- Reward bounds: rewards never exceed min(bps bounds, annual cap, allocation).

Setup: `forge init --no-git` in a scratch dir, `foundry.toml` with
`remappings = ["@openzeppelin/contracts=<repo>/node_modules/@openzeppelin/contracts"]` and a
`src` symlink or `fs_permissions` read access to the repo's `contracts/`. Keep the harness out of
the audited tree; publish it as report evidence, not as a repo change.

### Layer 5: Bytecode vs. source verification

For each deployed contract: compile at the pinned commit with the documented settings
(compiler version, optimizer on/off + runs, EVM version — get them from the explorer's verified
page or deployment docs), fetch deployed bytecode (`cast code --block <pinned> --rpc-url …`),
and compare after stripping the CBOR metadata trailer (its length is encoded in the last 2
bytes; also compare contract size and a stable prefix). Result per contract: **match /
mismatch / inconclusive** (mismatched build settings produce inconclusive, not suspicion —
escalate only with a real divergence in logic-bearing sections). Note which contracts carry a
full explorer source verification as corroboration.

### Layer 6: On-chain state audit

Block-pinned `cast call` sweep: every role address (owner/admin/guardian/governance), every
safety-critical parameter (fee rates, price feeds, caps, cooldowns, pause flags), every balance
vs. its documented invariant, multisig `getThreshold()`/`getOwners()`, proposal counts vs. the
public governance log. Divergences are findings — including "better than documented" (stale docs
are a finding class of their own).

## Output format

```markdown
# <Project> — Contract Deep Security Audit
> Scope: <contracts> · Commit: <sha> · Block: <n> · Tools: <versions> · Result: C/H/M/L/I tally

## 1. Executive summary
## 2. Scope, baselines, tooling (incl. what could NOT be run and why)
## 3. Per-contract results
### <Contract> — <CLEAN | findings>
- **[severity] title** — file:line · trace · recommendation
## 4. Invariant table (property → method → result: fuzzed/static/manual/chain-verified)
## 5. Bytecode & deployment verification (per contract: match/mismatch/inconclusive)
## 6. Tool-run evidence (slither/mythril diffs vs baseline, test-suite reproduction)
## 7. Known-issues register re-verification
## 8. Recommendations (prioritized)
## 9. Limitations & disclaimer (point-in-time, bounded symbolic runs, no guarantee)
```

Severity taxonomy: Critical (direct fund loss / takeover), High (fund risk under realistic
conditions or on a documented activation path), Medium (bounded/gameable/config-dependent), Low
(hardening/reliability), Informational (process/docs). Every Medium+ gets a concrete trace and a
likelihood qualifier.

## Boundaries

No transactions, no deployments, no edits to the audited code, no exfiltration of secrets. If
the audit needs a proof-of-concept exploit, demonstrate it on a local fork (`anvil`) — never
against live state. The fuzz harness and tool logs are evidence: save them next to the report.
