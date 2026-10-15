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
- Repeated votes: the **last valid** signed vote per wallet before the close counts.
- Quorum: 10 % of the IFR locked in IFRLock at the snapshot block; abstain counts towards the
  quorum, not towards the result.
- Announcements: only the IFR bot posts ballots and results, in the Telegram Vote topic (23).

## Components

| # | Component | Where | Notes |
| --- | --- | --- | --- |
| 1 | Ballot manifest (frozen) | `apps/telegram/telegram-bot/forum-ballots/<ballotId>.json` + `<ballotId>.md` | Added only by reviewed PR; `proposalHash` = keccak256 of the UTF-8 text; `manifestHash` = keccak256 of the canonical manifest JSON |
| 2 | Ballot core (pure) | `apps/telegram/telegram-bot/src/forum/ballot.js` | manifest validation, EIP-712 domain/types, vote verification, canonical hashing |
| 3 | Collector API | bot Express app (`verify-api.ifrunit.tech`) | `GET /api/forum/ballots/:id`, `POST /api/forum/ballots/:id/votes`, `GET /api/forum/ballots/:id/votes`; append-only store on the bot volume |
| 4 | Tally (CLI) | `apps/telegram/telegram-bot/scripts/forum-tally.js` | reads manifest, published vote set and IFRLock balances at the snapshot block (block-hash pinned); deterministic result JSON with input hashes |
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
  `receiptOrder`, `receivedAt`, wallet, choice, `issuedAt`, normalized signature). No IP
  address, user agent or other metadata is stored. One process owns the store. A per-ballot
  in-memory digest/wallet index, count and wallet counts are hydrated once on first access;
  appends never re-read the file. Records with a different manifest hash fail the ballot
  closed with 503 `Ballot manifest changed`, including after a restart.
- Every append fsyncs the descriptor before closing and returning 201. During hydration,
  only a trailing line without a newline is truncated and fsynced; the log reports only
  the discarded byte count. Any other corruption fails closed without changing the file.
- `FORUM_DATA_DIR` must be absolute and outside the bot application directory (including
  resolved directory aliases). JSONL files are opened with `O_NOFOLLOW` to refuse symlinks.
  Existing data directories owned by another UID are refused with 503 and never chmodded;
  owned directories and vote files retain private modes (0700 and 0600).
- `GET …/votes?after=<receiptOrder>&limit=<1..1000>` returns `{ records, next }`, ordered by
  receiptOrder and strictly after the cursor; defaults are after=0 and limit=1000.
  `next` is the last returned receiptOrder, or null for an empty page. Follow pages until
  null to obtain the complete published set used as tally input.

## Tally rules

- Read `lockedBalance(wallet)` on the weight contract at `snapshot.height` for every voting
  wallet and the contract's `totalLocked` at that height; refuse if the block hash differs
  from the manifest.
- Keep each wallet's vote with the greatest `issuedAt` (receipt order breaks ties); ignore
  wallets with zero weight.
- Quorum: weight(yes + no + abstain) >= 10 % of `totalLocked`. Threshold: weight(yes) >
  50 % of weight(yes + no). Output: totals, quorum and threshold results, input hashes.

## Slices

1. Ballot core + collector API + store, disabled, Sepolia; tests with deterministic keys.
2. Tally CLI with pinned-block reads; fixture tests and a Sepolia dry run.
3. Ballot page (wiki) and announcer; staging ballot with test wallets.
4. Owner acceptance; Mainnet only after a separate recorded owner decision.
