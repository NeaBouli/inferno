# BuilderRegistry V2 Specification Draft

Status: **PROPOSED DRAFT - NOT RATIFIED, NOT IMPLEMENTED, NOT DEPLOYED.**
Draft date: 24 October 2026. Repository baseline:
`4dc607041f40af3b289a6306a7b9ed0296f53f5a`.

Every V2 rule, value, API name and acceptance gate below is a proposal for review,
not a decision or approval by Gio, the registry owner, Governance or a Safe.
Requirement words describe the proposed design only. This document authorizes
no implementation, funds, transactions, deployment or consumer cutover. It
changes no Solidity, ABI, runtime configuration or audit-issue disposition.

## Scope and V1 evidence

This is an offline, docs-only design proposal grounded in:

- [Current BuilderRegistry source](../../contracts/BuilderRegistry.sol).
- [V1 rights tests](../../test/BuilderRegistry.rights.test.js).
- [Post-deployment rights review](BUILDER-REGISTRY-REVIEW.md), including its
  provenance limits and BR-01 through BR-05 observations.
- [Repository Governance source](../../contracts/governance/Governance.sol),
  which is not proof of the recorded deployed Governance implementation.

V1 has three registry mutations and inherited single-step ownership transfer
and renunciation. The rights tests describe immediate succession, permanent
administrative freeze after renunciation, and duplicate active enumeration after
removal/re-registration. They are V1 regression evidence, not V2 verification;
their historical execution results are not a new test run for this draft.

V1 `getBuilderCount()` counts registration entries, including repeated wallets.
Removal retains metadata and list entries. `getActiveBuilders()` scans that
history twice and can return the same currently active wallet more than once.
The `BuilderRegistered` event omits URL. V1 bounds neither name nor URL size.

**Immutable V1 cannot be upgraded through Governance or this proposal.** A V2
would require a separately reviewed new contract deployment and explicit consumer
migration. V1 data, logs, ownership powers and flaws would remain at the old
address. No proxy, upgrade hook, fund custody, reward allocation, self-service
registration or new privileged role is proposed here. Registration alone must
not be presented as a funded PartnerVault entitlement or Telegram access grant;
the review identifies separate authorization/configuration boundaries.

This draft does not attest current chain state, owner, delay, builder counts,
deployment addresses or consumer configuration. Historical authority and compiler
records retain the qualifications in the linked review.

## Proposed two-step ownership

Proposed ownership follows an explicitly constrained two-step pattern, subject
to review against the exact dependency version selected for a future V2.

| Proposed operation | Proposed authorization and effect |
| --- | --- |
| Constructor with initial owner | Reject zero; set the explicit initial owner and leave `pendingOwner()` zero. The deployer gains no implicit right. This is initial assignment, not a pending transfer. |
| `transferOwnership(newOwner)` | Current owner only. Reject zero and the current owner. Set or replace the pending nominee; do not change `owner()` or registry data. Emit `OwnershipTransferStarted(owner, newOwner)`. |
| `acceptOwnership()` | Only the current nonzero pending nominee. Atomically set the owner to that caller, clear pending state, and emit `OwnershipTransferred(previousOwner, newOwner)`. |
| `cancelOwnershipTransfer()` | Current owner only, with an existing pending nominee. Clear pending state and emit proposed `OwnershipTransferCancelled(owner, cancelledPendingOwner)`. Do not change the owner. |
| `renounceOwnership()` | Proposed disabled selector: revert with an explicit disabled-operation error and leave owner, pending state and registry data unchanged. See the unapproved policy below. |

The existing owner retains all registry administration until acceptance; the
nominee has no registration, update, removal, cancellation or nomination right
merely by being pending. A replaced or cancelled nominee cannot accept. After
acceptance the former owner loses its rights, and a second acceptance fails.
Proposed pending transfers have no automatic expiry: cancellation or replacement
is explicit, so a timelocked successor is not silently timed out.

`transferOwnership(address(0))` must not be an implicit cancellation or renounce
path in the proposed API. Do not assume an unmodified two-step dependency rejects
zero; review/override that behavior explicitly. No public bypass to an internal
ownership setter is proposed. Cancellation and acceptance racing are ordered by
execution: whichever succeeds first makes the conflicting operation fail.

Nonzero checks and proof of acceptance do not establish Governance identity or
timelock protection. An EOA or arbitrary contract able to accept could become
owner under this proposal. A separate owner-approved successor policy and
verification of its callable execution path are required before any handover;
no code-length check is claimed to prove governance safety.

### Proposed Governance handover: two registry calls

A handover from Governance A to Governance B requires two distinct registry
calls, not an immediate owner change or two calls sent by Governance A:

1. Governance A, as current registry owner, executes its separately authorized
   proposal targeting registry `transferOwnership(B)`, after its applicable
   approval and delay. The resulting state is owner A, pending owner B.
2. Governance B executes its separately authorized proposal targeting registry
   `acceptOwnership()`, after its own applicable approval and delay. The registry
   must observe B as the immediate caller. Only then is B owner and pending zero.

These are two successful registry mutations, not a claim that only two total
governance/Safe transactions are needed. The Safe controlling B, its signers, A,
and a guardian cannot accept on B's behalf through a direct registry call. B must
support the target-call path before it is nominated. A can still cancel or
replace a nomination while it remains owner. Cancelling an upstream proposal is
not the same as calling registry cancellation after nomination has executed.

Do not assume the governance systems share a Safe, delay, guardian or proposal
model, or that current repository Governance matches deployed V1. Any future
rehearsal must use the intended controllers' exact behavior. Two-step ownership
adds acceptance, not a registry-enforced timelock or a recovery authority.

### Explicit renunciation proposal, not owner approval

**Proposed recommendation: disable V2 renunciation permanently. This has not been
approved by the registry owner or Gio.** Preserving a callable selector that
always reverts is a compatibility aid, not preservation of V1 renounce behavior.
This also means a pending nominee cannot obtain ownership by a renounce shortcut.

An alternative irreversible freeze/renounce mechanism would need a separate,
explicitly ratified specification, confirmation/recovery analysis and tests;
ordinary transfer-to-zero must not supply it accidentally. Nothing in this draft
disables V1's inherited `renounceOwnership()` or closes CWA-16.

## Proposed unique lifetime enumeration and active counts

Proposed storage distinguishes lifetime inclusion from present membership:

- A monotonic `everRegistered(wallet)` flag and append-only unique wallet list
  record first inclusion. Never append an address already included, even after
  many removal/re-registration cycles. Reject the zero wallet.
- `isBuilder(wallet)` remains current membership and always equals
  `builders(wallet).active`. Never-active/default records remain inactive.
- Proposed `getBuilderCount()` returns the unique lifetime list length, including
  inactive wallets. This is an intentional semantic change from V1's entry count.
- Proposed `getActiveBuilderCount()` returns a maintained count of unique active
  wallets. It is not the lifetime count or number of registration events.
- `getBuilderAt(index)` returns the stable first-inclusion order; removal does
  not prune or reorder it. An out-of-range index reverts.

| Proposed lifecycle transition | Unique lifetime count | Active count | Metadata and order |
| --- | --- | --- | --- |
| Register a never-seen wallet | Increment once | Increment once | Append once; store validated metadata; set `registeredAt` to this block timestamp. |
| Register an already active wallet | Revert unchanged | Revert unchanged | Preserve `AlreadyRegistered(wallet)` behavior. |
| Remove an active wallet | Unchanged | Decrement once | Retain metadata, timestamp and list position; clear both active indicators. |
| Remove/update an inactive or unknown wallet | Revert unchanged | Revert unchanged | Preserve `NotRegistered(wallet)` behavior. |
| Re-register an inactive known wallet | Unchanged | Increment once | Replace validated metadata; reset `registeredAt` to this activation timestamp; retain original list position. |
| Update an active wallet | Unchanged | Unchanged | Change metadata only; preserve `registeredAt`, membership and order. |

Proposed `registeredAt` retains V1's most-recent-registration meaning, not the
first-ever time and not removal time. First inclusion and earlier metadata stay
in event history; no additional timestamp getter or registration-event counter
is proposed. An immutable unique index is not a proof of continuous membership.
Removal is deactivation, never an erasure promise.

## Proposed metadata bounds and content policy

All values in this table are **proposed**, not owner-selected production limits.
Apply identical checks to registration and update before any state change/event.

| Field | Proposed storage rule |
| --- | --- |
| Name | Valid UTF-8; 1 through 128 bytes inclusive, measured as `bytes(name).length`; reject an ASCII-space-only value and leading/trailing ASCII space. |
| URL | Empty is allowed, as in V1; otherwise at most 512 bytes, with the proposed URI policy below. |
| Category | Preserve exactly `creator`, `integration`, `tooling`, `dao`, case-sensitive ASCII; no new categories or whitespace variants. |

Byte lengths are not character, JavaScript string-length or grapheme limits.
Reject oversized input, never silently truncate, trim, normalize or rewrite it.
Validate UTF-8 strictly: reject invalid continuation sequences, truncated
sequences, overlong encodings, surrogate code points and values above U+10FFFF.
Solidity `string` and a byte-length check alone do not validate UTF-8.

Proposed disallowed scalars in stored text are U+0000 through U+001F, U+007F
through U+009F, U+2028/U+2029, and bidirectional controls U+061C, U+200E/U+200F,
U+202A through U+202E and U+2066 through U+2069. This includes NUL, tabs, CR/LF
and DEL. Reject them rather than removing them. The exact set and validator gas
cost need review; this is not a general guarantee against Unicode spoofing.
Other invisible-only names, confusables and normalization differences still need
governance/consumer review. Store accepted bytes verbatim; do not claim uniqueness
of names or ownership of a displayed brand.

Proposed on-chain URI checks deliberately have a bounded, narrow scope:

- A nonempty URL must start with literal lowercase `https://` or `ipfs://` and
  have a nonempty suffix. Reject other schemes, relative links and bare hosts,
  including `http:`, `javascript:`, `data:` and `file:`.
- Nonempty URLs use printable ASCII U+0021 through U+007E only, excluding
  backslash. Thus raw whitespace, controls and non-ASCII URL bytes are rejected;
  internationalized hosts/paths need an explicitly reviewed encoded form.
- This is a scheme/byte policy, not a complete URI, host, CID, reachability,
  authenticity or content-safety validator. Percent escapes are not decoded by
  the contract. A permitted prefix cannot make an arbitrary suffix trustworthy.

Proposed consumers must parse before linking, require a valid nonempty HTTPS host
without userinfo or a supported IPFS identifier/path, and reject malformed
escapes, decoded controls and parser-confusing backslashes. They must reject
disallowed redirect targets and never reinterpret an allowed URL as executable
content. Gateways, encoded internationalized forms and display normalization
need a separately reviewed policy. Render metadata as escaped text, never raw
HTML; safe link handling remains necessary even for owner-supplied values.
Do not automatically fetch metadata from privileged servers; any future fetcher
requires independent SSRF, redirect and resource controls. No consumer code or
new network request is part of this draft.

## Proposed bounded reads and pagination

Direct membership, count and single-record reads remain available without a
registry-wide scan. Proposed pages return addresses, not arrays of metadata:

- `getBuildersPage(cursor, limit)` returns `(wallets, nextCursor, total)` over
  the unique lifetime list, including inactive records.
- `getActiveBuildersPage(cursor, limit)` has the same return shape and cursor
  domain, but returns only currently active wallets in the examined list window.
- Proposed `MAX_PAGE_SIZE` is **100 historical slots**, not 100 active matches.
  Both endpoints reject `limit == 0` and `limit > MAX_PAGE_SIZE` before looping.

For both endpoints, `total` is the lifetime unique count at the read block.
Require `cursor <= total`; a larger cursor reverts. Compute the examined window
as `min(limit, total - cursor)` to avoid unchecked `cursor + limit` overflow.
`nextCursor` is cursor plus that window. At `cursor == total`, return an empty
page with `nextCursor == total`. Active pages may be empty before the end, but
must advance over the examined slots; never scan ahead until enough matches are
found. Every successful page examines at most `limit` slots and returns at most
`limit` unique addresses, independent of lifetime history size.

The active page does not return an active-only offset or active total: use the
separate active-count getter. Stop on `nextCursor == total`, not an empty active
result. Fetch every page, count and metadata read against the same block tag/hash
for a consistent snapshot; append, remove, re-register, update and chain reorgs
can otherwise mix states. RPC finality and block availability remain client
concerns. Do not use enumeration as an authorization check when `isBuilder`
provides the direct answer.

Proposed V2 omits V1's unbounded `getActiveBuilders()` rather than retaining an
unbounded compatibility wrapper. This is an explicit ABI break requiring caller
migration. No administrative mutation may loop over the lifetime list, and no
unbounded migration/import loop is proposed. Final page-size/gas limits remain
subject to measurement and owner approval.

## Proposed event and API compatibility

Proposed compatibility preserves the three registry mutation signatures,
`owner()`, `isBuilder(address)`, the field order/types of `builders(address)` and
`getBuilderInfo(address)`, and indexed-wallet layouts of existing builder events:

- Keep `BuilderRegistered(address,string,string,uint256)`,
  `BuilderRemoved(address,uint256)` and
  `BuilderUpdated(address,string,string,string)` with their existing argument
  order and wallet indexing. Re-registration still emits registration.
- To make a V2 log-only metadata mirror complete, emit `BuilderUpdated` with
  full name/URL/category immediately after `BuilderRegistered` in every successful
  registration/re-registration. Ordinary updates still emit it once. This
  proposed additional log is intentional; do not silently change a legacy event
  signature to add URL or invent an unannounced event order.
- Keep `OwnershipTransferred` for initial assignment and completed succession,
  not nomination/cancellation. Add the proposed start/cancel events above, with
  both address arguments indexed, plus `pendingOwner()` and acceptance/cancel
  selectors. Final error names/selectors need an explicit reviewed ABI diff.

Preserve existing validation error selectors where their conditions still apply;
add explicit errors for bounds, malformed text/URI, page arguments and ownership
state. Clients must accommodate stricter metadata rejection. Selector preservation
does not preserve semantics: `transferOwnership` becomes nomination,
`renounceOwnership` would revert, and `getBuilderCount` changes meaning.
`getBuilderAt` now refers to a unique lifetime index, not a V1 registration entry.
Removing `getActiveBuilders()` is deliberately not drop-in compatible.

Indexers must key records by chain ID, registry address and wallet; identify logs
by block hash/transaction hash/log index with reorg rollback. A V2 registration
followed by `BuilderUpdated` is one membership activation with two logs, not two
registrations or rewards. Ownership monitoring must distinguish nomination,
cancellation and completion. V1 consumers still need deduplication and historical
state/transaction evidence for registration URL; V2 logs cannot repair V1 history.

## Proposed migration and release boundaries

Any future adoption would require a separate owner-approved migration plan:

1. Identify V1 and candidate V2 by chain/address/version and verified provenance;
   pin the V1 snapshot block number/hash and finality. Deduplicate lifetime wallets
   while deriving current active status from authoritative state, not event count.
2. Specify whether only active or all historical wallets should be copied, who
   authorizes each record, and how concurrent V1 changes are reconciled. Review
   every oversized or newly invalid value; never silently truncate metadata or
   claim the old owner approved replacement values.
3. Re-registering into a fresh V2 would produce V2 timestamps and events. This
   draft adds no import setter to backdate `registeredAt`, preserve V1 array
   indices or inject history. Retain V1 history with its own provenance instead;
   a privileged importer would require its own design and review.
4. Inventory actual consumers and any hardcoded contract references, pagination,
   ABI, ownership tooling and indexer assumptions. Select one authoritative
   registry per consumer/cutover block; do not union V1/V2 memberships or counts
   without an explicitly reviewed policy. Some immutable consumers may not support
   a registry-address switch at all.
5. Rehearse snapshot/reconciliation, consumer rollback and indexer replay in an
   isolated local/test environment. Rolling back a consumer is not an on-chain
   rollback, cannot undo V1 history and may restore different membership state.
   Require separate action-specific authorization for deployment, handover and
   production configuration changes; this document grants none.

## Proposed testing and acceptance gates

These are future implementation/release requirements, **not tests passed by this
docs-only draft**. Keep V1 rights tests unchanged as evidence of immutable V1.

| Proposed gate | Proposed acceptance evidence |
| --- | --- |
| Ownership authorization/state machine | Constructor and transfer reject zero; self-nomination rejected; non-owners rejected; pending nominee cannot administer; only nominee accepts; replacement/cancellation invalidate the old nominee; acceptance clears pending state and revokes former-owner rights; exact events and unchanged state on failure. |
| Governance two-call path | Exercise distinct local A/B controllers and their actual propose/delay/execute paths; reject direct Safe/signer/guardian acceptance; prove nomination leaves A in control and only execution from B completes succession; test cancellation, stale acceptance proposals and execution ordering. Do not substitute repository-source tests for deployed-controller parity. |
| Renounce policy | Obtain explicit owner decision first. For the proposed disabled policy, owner and non-owner calls revert without changing owner, pending state or records; zero-transfer and other entry points cannot bypass it. |
| Lifecycle/count invariants | Repeated register/remove/re-register sequences never duplicate lifetime wallets; active count equals the unique active set and remains between zero and lifetime count; both membership flags agree. Test multiple wallets, failed/repeated removals, updates, retained metadata and activation timestamps. |
| UTF-8 and byte boundaries | Name lengths 0/1/127/128/129 and URL lengths 0/511/512/513; multibyte scalars across boundaries; malformed/overlong/truncated encodings, surrogates and out-of-range scalars; all prohibited controls/bidi markers, ASCII-space edge cases and exact categories on both registration and update. Failed writes emit no logs. |
| URI/consumer policy | Allowed empty/HTTPS/IPFS cases and rejected schemes, empty suffix, whitespace/backslash and non-ASCII cases; consumer malformed/credentialed hosts, invalid identifiers, encoded controls, escapes, redirect and output-encoding cases. Prove stored bytes are not silently transformed. |
| Pagination bounds | Empty registry, cursor at/beyond total, zero/over-cap/maximum-integer limits, exact/partial windows, sparse and all-inactive windows; concatenate pinned-block pages into the expected unique list/subset; verify empty active pages still progress and all loops obey the scan cap. |
| Events/compatibility/indexer | Reviewed ABI/error/event diff; exact event order and arguments; reconstruct full V2 metadata and membership from logs including re-registration; test two-log activation, removed records, chain/address separation, replay and reorg rollback. Update all identified callers of changed/removed APIs. |
| Resource behavior | Benchmark worst-case accepted metadata and page size with the pinned compiler/dependencies/EVM settings; prove mutations and direct reads do not grow with lifetime list size and page work grows only with the cap. Publish agreed numeric gas/response budgets before approval. |
| Migration/reproducibility | Approved pinned snapshot and reconciliation policy; explicit handling of invalid V1 metadata, timestamps and unmigratable consumers; local rehearsal and rollback evidence; complete compiler input, dependency versions, constructor arguments and artifact provenance for any candidate. |
| Independent review and release authorization | Review authorization, Unicode/URI validation, count invariants and migration/consumer risks; retain exact-source focused/full test evidence appropriate to the eventual diff. Obtain separate owner ratification and Gio's action-specific approval before any deployment or transaction. |

Open decisions include renunciation policy, successor restrictions, proposed
128/512-byte bounds, Unicode/URI policy, proposed 100-slot cap and measured budgets,
ABI/event changes, migration scope and consumer authority/cutover. No acceptance
gate or issue is closed by writing this draft. CWA-16 remains governance/owner
gated, JUL-21 remains accepted/monitored, and CWA-56 remains informational/no
action, as qualified by the existing review. Parent review/integration of this
document is not ratification, a security certification or a deployment decision.
