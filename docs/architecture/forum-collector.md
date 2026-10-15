# Forum Vote Collector (first slice, Sepolia, disabled by default)

Status: **design for the first build slice**, owner decisions of 11 October 2026 (decision
register, Lane 8). Nothing here is live. Forum results are advisory; the Council decides.

## Goal

A member signs a vote for a published, frozen ballot with a wallet; the project collects the
signed votes, publishes the complete vote set, and anyone can recount the result from public
data. The first slice runs on **Sepolia only** and stays **disabled** until the owner accepts it.

## Decided rules (Lane 8)

- Weight: IFR locked in IFRLock at a snapshot block announced before the ballot opens; no
  delegation; one lock is counted once.
- Repeated votes: the valid signed vote per wallet with the greatest `issuedAt` counts;
  ties use the greatest `receiptOrder`. Receipt must be before the close.
- Quorum: 10 % of the IFR locked in IFRLock at the snapshot block; abstain counts towards the
  quorum, not towards the result.
- Announcements: only the IFR bot posts ballots and results, in the Telegram Vote topic (23).

## Components

| # | Component | Where | Notes |
| --- | --- | --- | --- |
| 1 | Ballot manifest (frozen) | `apps/telegram/telegram-bot/forum-ballots/<ballotId>.json` + `<ballotId>.md` | Added only by reviewed PR; `proposalHash` = keccak256 of the UTF-8 text; `manifestHash` = keccak256 of the canonical manifest JSON |
| 2 | Ballot core (pure) | `apps/telegram/telegram-bot/src/forum/ballot.js` | manifest validation, EIP-712 domain/types, vote verification, canonical hashing |
| 3 | Collector API | bot Express app (`verify-api.ifrunit.tech`) | `GET /api/forum/ballots/:id`, `POST /api/forum/ballots/:id/votes`, `GET /api/forum/ballots/:id/votes`; append-only store on the bot volume |
| 4 | Tally (CLI) | `apps/telegram/telegram-bot/scripts/forum-tally.js` | reads manifest, published vote set and IFRLock balances at the snapshot height, checking its hash before and after all weight reads; deterministic result JSON with input hashes |
| 5 | Ballot page | `docs/wiki/forum-ballot.html?ballot=<id>` | shows text and hash, connects a wallet, signs the typed data, submits; banner "Sepolia test ballot" |
| 6 | Announcer | bot scheduler | posts open, close and result in Vote (23) from the manifest schedule and the tally file |

## Manifest (`forum-ballot-v1`)

```json
{
  "schema": "forum-ballot-v1",
  "ballotId": "FB-0001",
  "chainId": 11155111,
  "proposal": { "title": "…", "textFile": "FB-0001.md", "textHash": "0x…" },
  "choices": ["yes", "no", "abstain"],
  "snapshot": { "height": 0, "blockHash": "0x…" },
  "weightSource": { "contract": "<IFRLock address on that chain>", "method": "lockedBalance(address)" },
  "window": { "opensAt": 0, "closesAt": 0 },
  "policy": {
    "selection": "last-valid",
    "quorum": { "numerator": 10, "denominator": 100, "basis": "total-locked-at-snapshot", "comparison": "gte" },
    "threshold": { "numerator": 50, "denominator": 100, "basis": "yes-of-yes-plus-no", "comparison": "gt" },
    "abstain": { "quorum": "include", "threshold": "exclude" },
    "delegation": "disabled"
  }
}
```

The manifest's `policy.selection` has this fixed meaning:
**last-valid = among valid votes of a wallet, greatest issuedAt; ties broken by greatest receiptOrder**.
Validity includes signature verification and receipt within the voting window. An invalid
later vote cannot replace a valid vote. Quorum includes abstain; the strict threshold only
compares yes with yes + no. An empty locked snapshot has no defined quorum.

## Vote (EIP-712)

Domain `{ name: "IFR Forum", version: "1", chainId, salt }` (no verifying contract), where
`salt = keccak256(utf8("ifrunit.tech/forum/v1"))` namespaces signatures to this application. Primary type
`IFRForumVote { bytes32 manifestHash; string ballotId; bytes32 proposalHash; uint256 snapshotHeight; string choice; uint256 issuedAt }`.
The signer is the voting wallet (EOA in this slice; EIP-1271 wallets are a later slice).
`issuedAt` orders a wallet's votes; the collector's receipt order breaks exact ties.

## Collector rules

- Disabled unless `FORUM_ENABLED=1`; only chain IDs in `FORUM_ALLOWED_CHAIN_IDS` (slice 1: `11155111`).
- `POST` accepts only an open ballot (`opensAt <= now < closesAt`), a listed choice,
  `issuedAt` within the window and not more than 5 minutes in the future, and a signature
  that recovers to the submitted wallet over the exact typed data. Signatures are normalized
  with `Signature.from(signature).serialized` before verification and storage. The stored
  `digest = TypedDataEncoder.hash(domain, types, value)` identifies identical typed data
  (including choice and issuedAt) per wallet: repeats return the original receipt (200),
  regardless of signature encoding. Different wallets can sign the same typed data.
- Rate-limited per IP and per wallet; bounded body size. Each rate-limit map holds at most
  50000 keys; when full, expired entries are swept and a new key is rejected with 429 if
  no space is available. A wallet may store at most 20 votes per ballot; additional distinct
  votes return 429 `Wallet vote limit reached`. Duplicates do not consume stored-vote limits.
- Storage: append-only JSONL per ballot (`ballotId`, `chainId`, `manifestHash`, `digest`,
  `prevHash`, `receiptOrder`, `receivedAt`, wallet, choice, `issuedAt`, normalized signature). No IP
  address, user agent or other metadata is stored. One process owns the store. A per-ballot
  in-memory digest/wallet index, count and wallet counts are hydrated once on first access;
  appends never re-read the file. Records with a different manifest hash fail the ballot
  closed with 503 `Ballot manifest changed`, including after a restart.
- Receipt chain: the first record's `prevHash` is the ballot's `manifestHash`. Each later
  `prevHash` is `keccak256(utf8(canonicalJson(previousRecord)))`, using `ballot.js` canonical
  JSON over the **complete stored record**, including its `prevHash` and signature.
  Hydration verifies every link before making any receipt available. Missing links and
  modified complete records fail closed without repairing the file. Pre-chain JSONL files
  are not silently migrated and cannot be loaded. The empty chain's head is `manifestHash`;
  otherwise the head is the hash of the final complete record.
- Every append fsyncs the descriptor before closing and returning 201. During hydration,
  only a trailing line without a newline is truncated and fsynced; the log reports only
  the discarded byte count. Any other corruption fails closed without changing the file.
- `FORUM_DATA_DIR` must be absolute and outside the bot application directory (including
  resolved directory aliases). JSONL files are opened with `O_NOFOLLOW` to refuse symlinks.
  Existing data directories owned by another UID are refused with 503 and never chmodded;
  owned directories and vote files retain private modes (0700 and 0600).
- `GET …/votes?after=<receiptOrder>&limit=<1..1000>` returns `{ records, next, head, count }`, ordered by
  receiptOrder and strictly after the cursor; defaults are after=0 and limit=1000.
  `next` is the last returned receiptOrder, or null for an empty page. Follow pages until
  null to obtain the complete published set used as tally input. `head` and `count` describe
  the entire stored chain, including on empty or intermediate pages. Collection during
  voting can change them between requests; collect a stable complete set after close.
- Implementation trace: `routes.js::createForumRouter` → `store.js::append/read` binds
  signed votes to the frozen ballot and returns receipts plus the full chain head/count.

## Tally rules

- Require exactly these keys on every published record: `ballotId`, `chainId`, `manifestHash`,
  `digest`, `prevHash`, `receiptOrder`, `receivedAt`, `wallet`, `choice`, `issuedAt`, `signature`.
  All numeric fields must be non-negative safe integers; receipts must be contiguous from 1.
  Remaining fields must be strings; `manifestHash`, `digest` and `prevHash` must be bytes32 hashes.
  Bind records to the ballot ID, chain ID and manifest hash, recompute the collector's EIP-712
  `digest` with `voteTypedData` and `TypedDataEncoder.hash`, and compare both hashes
  case-insensitively. Malformed records, digest mismatches and records bound to another
  manifest abort the whole tally with the offending `receiptOrder`, before any RPC reads.
- Verify the entire receipt chain from the manifest hash before any RPC reads or counting.
  Hash each complete canonical record to verify the next link, and publish the last hash as
  `chainHead` (`manifestHash` for an empty vote set). This is separate from `voteSetHash`,
  which hashes the canonical JSON array of all records, including their chain links.
- Verify the RPC chain ID, then read the hash at `snapshot.height` **before and after all
  weight reads**; both hashes must match the manifest's `snapshot.blockHash` case-insensitively.
  Read `totalLocked()` and each selected wallet's `lockedBalance(wallet)` at that height.
  The pinned ethers v6.17.0 does not support EIP-1898 `{ blockHash }` objects in contract-call
  `blockTag` overrides, so the CLI uses `blockTag: snapshot.height` with these before/after
  hash checks. RPC caching is disabled so the second check makes a fresh request. These
  checks detect a changed end hash; they cannot prove consistency of every intermediate read.
- Reverify every signature and vote's validity at its recorded `receivedAt`; invalid votes
  are listed as rejected. Apply **last-valid = among valid votes of a wallet, greatest issuedAt; ties broken by greatest receiptOrder**;
  ignore wallets with zero weight.
- Reject `totalLocked === 0n` with `Empty snapshot: quorum undefined`, and reject participating
  weight greater than `totalLocked` with `Weight source inconsistent`. All weights and quorum
  arithmetic use bigint, without conversion through JavaScript `number`.
- Quorum: weight(yes + no + abstain) >= 10 % of `totalLocked`. Threshold: weight(yes) >
  50 % of weight(yes + no). Output: totals, quorum and threshold results, input hashes and `chainHead`.
- Trust assumptions: the RPC is trusted for historical state at the verified block; use an
  archive node. Results are advisory and re-tallyable by anyone with another RPC.
  `receivedAt` and `receiptOrder` are collector-attested, rather than wallet-signed. The
  chain detects modified links relative to an observed head; it cannot by itself prove
  completeness or prevent the collector from rewriting a chain. Published checkpoint and
  final heads let observers compare the tally against previously observed receipts.

## Announcer rules

- Implementation trace: `index.js` → `announcer.js::startForumAnnouncer` →
  `topicRouter.sendToGroup(telegram, TELEGRAM_GROUP_ID, 'vote', text)`. The entry point
  imports/starts it only when `FORUM_ENABLED === '1'`; its factory also stays inert otherwise.
  No channel posts, RPC reads or tally execution are performed by the announcer.
- Scan the bundled `forum-ballots/` directory, validating each frozen manifest and proposal;
  only `FORUM_ALLOWED_CHAIN_IDS` are eligible (default `11155111`). Poll immediately on start,
  then every 60 seconds, with injectable Unix-second clock and interval timer. Concurrent
  polls share one in-flight check. Every poll hydrates a fresh vote-store index so API
  appends are visible and a corrupt receipt chain prevents announcements for that ballot.
- While `opensAt <= now < closesAt`, announce `open` once: title, ballot ID, page URL
  `https://ifrunit.tech/wiki/forum-ballot.html?ballot=<id>`, proposal hash, snapshot height,
  close time in UTC and `advisory; the Council decides`. The first poll after the opening
  delivers the notice if the bot was offline. Do not post stale opening notices after close.
- Post a `checkpoint` containing count and chain head every `FORUM_CHECKPOINT_HOURS`
  (default 6, positive hours resolving to whole seconds), anchored to `opensAt`, strictly
  before close. Deduplicate by the checkpoint's scheduled timestamp. On a delayed poll,
  announce only the latest due checkpoint; never invent historical counts for missed slots.
- At or after `closesAt`, post `close` once with final count, final chain head and
  `tally follows`. Empty chains publish the manifest hash as their final head.
- After close, a reviewed PR can add bundled `forum-results/<ballotId>.json`. Only a
  `forum-tally-v1` result bound to the ballot ID/chain, matching `manifestHash` and the
  current final `chainHead`, is announced. Missing or mismatched results are not announced;
  later polls can discover a corrected reviewed file. Validate outcome, advisory flag,
  quorum/threshold booleans and vote-set hash; do not recompute the tally in the bot.
  The `result` notice contains outcome, yes/no/abstain totals in IFR with exactly nine
  decimal places, quorum and threshold pass flags, `voteSetHash` and `advisory`. Weight
  formatting uses bigint division/remainder without a JavaScript `number` conversion.
- All messages use plain text with no `parse_mode`. Titles are flattened to one line and
  truncated to 120 Unicode characters. Routing remains the existing Vote category.
- Persist event identities (ballot ID, manifest hash, event/checkpoint timestamp) in
  `FORUM_DATA_DIR/announcements.json`, with mode 0600 in an owned private directory.
  Refuse unsafe storage paths, journal symlinks and malformed journals. Updates use an
  exclusive private temporary file, fsync, atomic rename and parent-directory fsync.
  One bot process owns this journal, as with the vote store.
- Delivery boundary: Telegram and the local journal cannot commit atomically. Reserve an
  event as `pending` durably **before** sending, then persist `sent` after success. Restarts
  never resend either state. Successful events are announced once; an ambiguous transport
  failure or crash between reservation and confirmed persistence can leave a notice missing.
  Pending events require operator reconciliation; there is no automatic delivery retry.
  Poll errors log only fixed messages and ballot IDs, never transport URLs or tokens.

## Slices

1. Ballot core + collector API + store, disabled, Sepolia; tests with deterministic keys.
2. Tally CLI with pinned-block reads; fixture tests and a Sepolia dry run.
3. Ballot page (wiki) and announcer; staging ballot with test wallets.
4. Owner acceptance; Mainnet only after a separate recorded owner decision.
