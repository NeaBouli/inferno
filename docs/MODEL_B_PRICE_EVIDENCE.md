# Model B Price Evidence — Generation and Independent Verification

Operator runbook for the Lane 4 Model B settlement price evidence: how to generate the
7-day TWAP + ETH/EUR evidence JSON with its read-proof receipt, and how to verify both
independently against the chain before they are attached to any settlement export or Safe
proposal.

**Status: review finding F3 (T-275 security review) remains OPEN.** The settlement backend
only schema-checks price evidence (`validatePriceEvidence` in
`apps/benefits-network/backend/src/services/modelBSettlement.ts`); the `verify` step below
is the procedural control that re-derives every field from chain state. F3 can only be
closed after a targeted security review of this tool and an independently reproduced
evidence artifact. The following stay **separate gates** and are not granted by this tool
or this document: price-source approval for the pilot policy, the end-block benchmark
policy for the first pilot, acceptance of a reproduced artifact, and pilot activation. The
tool does not activate anything, does not sign and never sends a transaction.

Tool: `scripts/model-b-price-evidence.mjs` (read-only, JSON-RPC over `fetch`, ABI coding via
ethers v6 from the repo root dependencies). Tests: `scripts/test-model-b-price-evidence.mjs`
(run in the `Contract Tests` workflow) and
`apps/benefits-network/backend/tests/modelBPriceEvidence.test.ts` (Benefits Network CI).

## Price source (owner decision 2026-10-06)

- **IFR price**: Uniswap V2 IFR/WETH pair TWAP over 7 days (the only IFR market). The
  cumulative price at each boundary block is derived exactly like
  `UniswapV2OracleLibrary.currentCumulativePrices`: `price0CumulativeLast` plus the
  counterfactual accrual from `blockTimestampLast` to the block timestamp. Accumulators
  are uint256 (mod 2^256), elapsed time is uint32 (mod 2^32); the UQ112x112 quotient of
  uint112 reserves always fits uint224. price0 is raw wei per IFR base unit (IFR 9 /
  WETH 18 decimals); the tool never inverts an average.
- **ETH/EUR**: on-chain Chainlink ETH/USD and EUR/USD aggregators read at the **same
  settlement end block**; `eth/eur = floor(ethUsdAnswer * 10^8 / eurUsdAnswer)`
  (explicit decimals, rounding floor).

## Pinned mainnet identity

| Constant | Value |
| --- | --- |
| IFR/WETH pair (`pair`) | `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` |
| Uniswap V2 factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` (`getPair(IFR, WETH)` must return the pair) |
| IFR token (`token0`) | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` (9 decimals) |
| WETH (`token1`) | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (18 decimals) |
| Chainlink ETH/USD proxy | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` ("ETH / USD", 8 decimals, heartbeat 3600 s) |
| Chainlink EUR/USD proxy | `0xb49f677943BC038e9857d61E7d053CaA2C1734C1` ("EUR / USD", 8 decimals, heartbeat 86400 s) |
| `reviewedSourceId` | `uniswap-v2-twap:chainlink-eth-usd:eur-usd` |

Feed addresses, decimals and heartbeats come from Chainlink's official data-feeds
registry, the data source behind the
[price feed contract addresses page](https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1):
[feeds-mainnet.json](https://reference-data-directory.vercel.app/feeds-mainnet.json)
(entries `eth-usd` and `eur-usd`, re-checked 2026-10-06). The runtime code hashes of all
six contracts are pinned in `MAINNET_CODE_HASHES`; they were read with block-hash pinning
at finalized block 26132402 on 2026-10-06 by the implementing worker and still need an
independent re-read before F3 can close. The aggregator behind each proxy may rotate; it is
recorded in the receipt, not pinned.

The `reviewedSourceId` uses `:` separators because the pilot policy parser
(`modelBPolicy.ts`) restricts reviewed source ids to `^[A-Za-z0-9._:-]{1,80}$`; the id
must be added to `reviewedPriceSourceIds` in the pilot policy by the policy owner for the
settlement export to accept the evidence.

## Prerequisites

- Node.js >= 22.13 and `npm ci` at the repository root.
- An **archive-capable Ethereum mainnet RPC** (chain id 1) that supports **EIP-1898**
  block-hash parameters (`{ "blockHash": ..., "requireCanonical": true }`) on `eth_call`
  and `eth_getCode`. The tool probes this first: an RPC that silently ignores the pinning
  is rejected. Many public endpoints gate historical state; the tool then fails with an
  archive diagnostic instead of producing evidence.
- No keys, no `.env`, no signing. The RPC URL, raw RPC error text and provider payloads
  are never printed; diagnostics carry only the method, a fixed failure kind, a numeric
  JSON-RPC code or an HTTP status. Credentials in the URL userinfo are sent as a Basic
  authorization header and never logged.

## Step 1 — End block

The end block must satisfy, for period `YYYY-MM` (whole UTC calendar months, half-open
`[start, end)`):

- `endBlock.timestamp >= period end` and
- `endBlock.timestamp <= period end + 72 hours` (`SETTLEMENT_MAX_LAG_SECONDS`), and
- the end block is **finalized** at generation and verification time.

The tool enforces these bounds. **Which** block inside the 72 h window is used (the
benchmark policy) is a separate first-pilot decision and is not an operator permission
granted by this runbook.

## Step 2 — Generate

```bash
node scripts/model-b-price-evidence.mjs generate \
  --rpc <archive-mainnet-rpc-url> \
  --period 2026-09 \
  --end-block <finalized-end-block> \
  --out evidence-2026-09.json \
  --receipt evidence-2026-09.receipt.json
```

The generator:

1. requires chain id 1, probes EIP-1898 pinning and requires the end block to be at or
   below the `finalized` head,
2. selects the start block deterministically as the **latest** block with
   `timestamp <= endBlock.timestamp - 604800` and keeps the next block as witness; the
   resulting window must stay within `[7d, 7d + 1h]`,
3. pins every state and code read to the start or end **block hash**
   (`requireCanonical: true`): pair/factory/token/feed code hashes, `factory()`,
   `getPair(IFR, WETH)`, `token0`/`token1`, token decimals, reserves and
   `price0CumulativeLast`, and on both feeds `description()`, `decimals()`,
   `aggregator()`, `latestRoundData()` and `getRoundData(roundId)`,
4. rejects zero or incomplete rounds (`roundId`/`answeredInRound` zero,
   `answeredInRound < roundId`), zero or inconsistent `startedAt`/`updatedAt`,
   non-positive answers, future-dated or stale rounds (older than the registry heartbeat
   at the end block), and a `getRoundData` result that disagrees with `latestRoundData`,
5. applies the consumer-equivalent period bounds to the end block and the ETH/EUR
   reference (24 h skew to the end block, within `[period end - 24h, period end + 72h]`),
6. re-reads every pinned number -> hash mapping in both directions and the finalized head
   **after the final read**; any reorg, vanished hash or inconsistent response fails closed,
7. only then writes the evidence (exact `priceEvidenceSchema` shape) and the receipt;
   existing files are never overwritten and nothing is written on failure.

`ethEur.publishedAt` is the older of the two feeds' `updatedAt` timestamps: the composite
reference is only as fresh as its stalest leg. `ethEur.rate` carries 8 explicit decimals
(`241505369862` = 2415.05369862 EUR per ETH).

### Receipt and digests

The receipt (`ifr-model-b-price-evidence-receipt/1`) holds the credential-free read proofs:
period, chain id, start/witness/end block number, hash, parent hash and timestamp, pinned
identity and code hashes, raw pair reads and, per feed, proxy, code hash, description,
decimals, heartbeat, aggregator, round id, answer, `startedAt`, `updatedAt` and
`answeredInRound`, plus the source URLs. It is bound to the evidence by `evidenceDigest`,
the **canonical data digest** (keccak256 of key-sorted JSON, identical to `canonicalDigest`
in `modelBSettlement.ts` and to the export's `evidenceDigest`). The canonical digest does
not depend on whitespace or key order; it is **not** a hash of the file bytes. Both
commands therefore also print the sha256 of the exact evidence file bytes; record both
values in the review record.

## Step 3 — Verify independently

```bash
node scripts/model-b-price-evidence.mjs verify \
  --rpc <different-archive-mainnet-rpc-url> \
  --period 2026-09 \
  --file evidence-2026-09.json \
  --receipt evidence-2026-09.receipt.json
```

The verifier distrusts every supplied field. It takes only the stated end block number
from the file and the **expected period from the operator**, re-runs the complete
derivation of step 2 against the chain (pinning probe, finality, deterministic start,
identity, rounds, bounds, final canonical recheck) and diffs the result against the
supplied evidence and receipt by JSON path. It exits non-zero listing **all** differences,
including altered blocks, hashes, timestamps, source ids, round ids, decimals, prices,
extra fields, a truthful but non-deterministic older start block and evidence that does
not settle the expected period.

**Operator rule:** verify against a *different* RPC provider than the one used for
generation, so one compromised or broken endpoint cannot fabricate evidence. Evidence
that fails verification must never reach a settlement export, a Safe proposal or a
reviewer. A passing verify is a reproduction check, not financial or security acceptance.

Exit codes: `0` success, `1` generation/verification/RPC failure, `2` usage error.

## Step 4 — Attach to the settlement export

Only evidence that passed step 3 is supplied as `priceEvidence` to the Model B settlement
export, together with its receipt in the review record. The backend re-validates schema,
policy binding (pair, token0, reviewed source id), window, period bounds, cumulative delta
and ETH/EUR skew itself (`validatePriceEvidence`); its `evidenceDigest` must equal the
receipt's `evidenceDigest`. The on-chain reproduction comes from step 3.

## Troubleshooting

- `failed: archive-state-unavailable` or `http-403`: the RPC cannot serve historical
  state. Use an archive endpoint.
- `ignores EIP-1898 block-hash pinning`: the RPC answered a read at an unknown block hash.
  Use a different RPC; never fall back to number-tagged reads.
- `not finalized yet`: wait until the end block is finalized (about 13 minutes) and retry.
- `Reorg detected` / `not currently canonical` (`rpc-error` on `eth_call`): the canonical
  chain changed during the run. Re-run; the end block must be finalized.
- `Chainlink ETH/USD round rejected: stale answer`: the feed had not updated within its
  heartbeat at the end block. The end-block choice is a benchmark-policy question; do not
  pick blocks to suit a price.
- `code at ... has hash ..., expected pinned ...`: the contract at a pinned address is not
  the reviewed code. Stop and escalate; do not edit the pins without review.
- `Pair reserves must be positive`: the pair did not exist at a boundary block.
- `RPC is not Ethereum mainnet`: the tool is fail-closed to chain id 1.

## Notes

- All arithmetic is integer (`bigint`); price and rate values never pass through
  JavaScript `number`.
- Floor rounding is deliberate: it never overstates the IFR amount per EUR.
- The TWAP/period/skew bounds are mirrored from `modelBSettlement.ts`; the backend module
  is the authoritative copy and re-validates every bound on import.
- The committed fixtures under `apps/benefits-network/backend/tests/fixtures/` are mock-chain
  outputs that tie the tool to the real schema; they are not mainnet evidence.
