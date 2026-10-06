# Model B Price Evidence — Generation and Chain-Reproduction Verification

Operator runbook for the Lane 4 Model B settlement price evidence: how to generate the
7-day TWAP + ETH/EUR evidence JSON and how to re-derive it from chain state via an RPC
provider before it is attached to any settlement export or Safe proposal.

**Trust limit:** both commands trust the JSON-RPC responses they receive. They do not
verify Merkle state proofs or header chains, so a dishonest or compromised provider can
return fabricated but self-consistent data. The checks below detect inconsistent, reorged,
unpinned or non-matching responses; they do not authenticate the provider.

Status: review finding **F3** (T-275 security review: evidence is only schema-checked by
`validatePriceEvidence` in `apps/benefits-network/backend/src/services/modelBSettlement.ts`)
**remains OPEN**. This tool is the proposed operator-side chain check for F3; F3 is only
closed after the Codex review of this tool and an independently reproduced evidence
artifact are accepted. A schema-valid JSON file or a source label is not price-source
approval. **Pilot activation, the price-benchmark/end-block policy and any settlement remain
separate owner gates** — this tool does not activate anything, does not sign, and never
sends a transaction.

Tool: `scripts/model-b-price-evidence.mjs` (read-only, ethers v6 from the repo root
dependencies). Tests: `npm run test:model-b-price-evidence` (`scripts/test-model-b-price-evidence.mjs`, run
in CI by `.github/workflows/contracts.yml`) and
`apps/benefits-network/backend/tests/modelBPriceEvidence.test.ts`.

## Price source (owner decision 2026-10-06)

- **IFR price**: Uniswap V2 IFR/WETH pair TWAP over 7 days (the only IFR market). The
  cumulative price at each boundary block is derived exactly like
  `UniswapV2OracleLibrary.currentCumulativePrices`: `price0CumulativeLast` plus the
  counterfactual accrual from `blockTimestampLast` to the block timestamp, with the
  on-chain semantics: elapsed time is uint32 (mod 2^32), the UQ112x112 quotient is a
  uint224 value and the accumulator is uint256 (mod 2^256).
- **ETH/EUR**: on-chain Chainlink ETH/USD and EUR/USD aggregators read at the **same
  settlement end block**; `eth/eur = floor(ethUsdAnswer * 10^8 / eurUsdAnswer)`
  (explicit decimals, rounding floor).

## Pinned mainnet constants

| Constant | Value |
| --- | --- |
| IFR/WETH pair (`pair`) | `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` |
| Uniswap V2 factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` (`getPair(IFR, WETH)` must return the pair) |
| IFR token (`token0`) | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` (9 decimals) |
| WETH (`token1`) | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (18 decimals) |
| Chainlink ETH/USD proxy | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` (8 decimals, heartbeat 3600 s) |
| Chainlink EUR/USD proxy | `0xb49f677943BC038e9857d61E7d053CaA2C1734C1` (8 decimals, heartbeat 86400 s) |
| `reviewedSourceId` | `uniswap-v2-twap:chainlink-eth-usd:eur-usd` |

Feed addresses are worker-attributed from Chainlink's data-feeds registry (Codex did not
independently fetch the registry), the data source behind the [price feed contract addresses page](https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1):
[feeds-mainnet.json](https://reference-data-directory.vercel.app/feeds-mainnet.json)
(entries `eth-usd` and `eur-usd`, heartbeat 3600 s / 86400 s), and cross-checked on-chain
on 2026-10-06 (`description()` = "ETH / USD" / "EUR / USD", `decimals()` = 8). The tool
re-pins this identity on every run at the pinned block hashes: code present at the pair,
factory, both tokens, both feed proxies and their current aggregators; pair `factory()`,
factory `getPair(IFR, WETH)`, `token0`/`token1`, token decimals, feed `decimals()` and
`description()`.

The `reviewedSourceId` uses `:` separators because the pilot policy parser
(`modelBPolicy.ts`) restricts reviewed source ids to `^[A-Za-z0-9._:-]{1,80}$`; the id
must be added to `reviewedPriceSourceIds` in the pilot policy by the policy owner for the
settlement export to accept the evidence.

## Prerequisites

- Node.js >= 22.13 and `npm ci` at the repository root (provides ethers 6.17.0).
- An **archive-capable Ethereum mainnet RPC with EIP-1898 support**: every `eth_call` and
  `eth_getCode` is pinned with `{ blockHash, requireCanonical: true }` at blocks 7+ days
  old. The tool first sends one probe read pinned to a nonexistent block hash; an endpoint
  that answers it (i.e. visibly ignores the pin) fails with `PINNING_UNSUPPORTED`. A passed
  probe only shows that the endpoint rejected that request; it does not prove the endpoint
  honours `requireCanonical` on every later read or that its data is honest. The final
  number -> hash re-check is the tool's own canonicality check. Pruned state
  fails with `ARCHIVE_UNAVAILABLE`. Both blocks must be **finalized**.
- Pass the endpoint via `MODEL_B_EVIDENCE_RPC_URL` (preferred; keeps it out of the process
  list) or `--rpc`. URL userinfo is sent as a Basic `Authorization` header; redirects are
  refused.
- No keys, no `.env`, no signing. The RPC URL, argument values and raw RPC/HTTP error text
  are never printed: failures are reported as a constant category (for example
  `Error [RPC_HTTP_ERROR]: eth_call: HTTP status 403`) with details built only from pinned
  constants and validated chain values.

## Step 1 — Choose the settlement end block

The end block must satisfy, for period `YYYY-MM` (whole UTC calendar months, half-open
`[start, end)`):

- `endBlock.timestamp >= period end` (first block at or after the month boundary is the
  natural choice), and
- `endBlock.timestamp <= period end + 72 hours` (`SETTLEMENT_MAX_LAG_SECONDS`).

The tool enforces both bounds and refuses blocks outside them, and refuses blocks that are
not yet finalized. Which block inside the 72 h window is the settlement benchmark is a
**separate first-pilot policy decision**; this tool does not grant the operator discretion
over it.

## Step 2 — Generate

```bash
export MODEL_B_EVIDENCE_RPC_URL=<archive-mainnet-rpc-url>
node scripts/model-b-price-evidence.mjs generate \
  --period 2026-09 \
  --end-block 26100000 \
  --out evidence-2026-09.json \
  --receipt evidence-2026-09.receipt.json
```

The generator (output files are never overwritten):

1. requires chain id 1 (as reported by the RPC), runs the EIP-1898 pinning probe, and requires the end block to
   be finalized,
2. selects the start block **deterministically** as the latest canonical block with
   `timestamp <= endBlock.timestamp - 604800` and checks the boundary against the RPC-reported header of
   the next block (whose `parentHash` must be the start hash); the window must stay within
   `[7d, 7d + 1h]`,
3. binds both headers by number and by hash, then reads every value pinned to the two
   block hashes with `requireCanonical: true`: pair/factory/token/feed identity, reserves,
   `price0CumulativeLast` and both Chainlink rounds **at the end block**,
4. rejects rounds with `roundId` or `answeredInRound` zero, `answeredInRound < roundId`,
   zero or later-than-`updatedAt` `startedAt`, zero or future `updatedAt`, answers older
   than the feed heartbeat (3600 s / 86400 s) and non-positive answers,
5. re-reads the number -> hash mapping of both blocks and the finalized head **after the
   final state read**; any change fails with `REORG_DETECTED` and no evidence,
6. checks every consumer bound of `validatePriceEvidence` for the period and emits the
   evidence JSON exactly in the shape of `priceEvidenceSchema` (`rounding: "floor"`,
   lowercase addresses/hashes, decimal-string integers),
7. writes the optional companion **receipt**: block hashes/timestamps, start-selection
   proof, feed round IDs/answers/decimals/aggregators, and every read as
   `{ blockHash, requireCanonical, target, selector, function, result }`. It contains no
   RPC URL or credentials. Its `evidenceDigest` is the canonical **data** digest
   (key-order independent, equal to `canonicalDigest` in `modelBSettlement.ts`);
   `evidenceFileSha256` is the digest of the **exact file bytes**.

`ethEur.publishedAt` is the older of the two feeds' `updatedAt` timestamps: the composite
reference is only as fresh as its stalest leg. `ethEur.rate` carries 8 explicit decimals
(`241505369862` = 2415.05369862 EUR per ETH).

## Step 3 — Verify by re-derivation

```bash
export MODEL_B_EVIDENCE_RPC_URL=<second-archive-mainnet-rpc-url>
node scripts/model-b-price-evidence.mjs verify \
  --period 2026-09 \
  --file evidence-2026-09.json \
  --receipt evidence-2026-09.verify-receipt.json
```

`--period` (the period the operator **expects** the evidence to settle) is mandatory. The
verifier distrusts every supplied field:

- strict `priceEvidenceSchema` shape (no extra fields),
- every consumer bound of `validatePriceEvidence` for the expected period (window, end
  block within `[period end, period end + 72h]`, ETH/EUR skew and period binding, positive
  rate and cumulative delta, pinned `reviewedSourceId`/`pair`/`token0`/`rounding`),
- then a complete fresh canonical snapshot at the stated end block (same rules as
  generation, including the deterministic start block) — every field must match exactly.
  A truthful but different start block (even inside the 1 h tolerance), a reorged block,
  altered round data, decimals, prices, source labels or period all fail and **all**
  mismatches are listed.

**Operator rule:** run `verify` at least once against an RPC provider operated
independently from the provider used for generation (a different URL of the same provider
is not a different trust domain). This reduces endpoint risk, but does not authenticate
RPC responses or eliminate the risk of fabricated evidence. Independent acceptance needs a
reproduction by a second party with its own provider. Evidence that fails verification
must never reach a settlement export, a Safe proposal, or a reviewer.

Exit codes: `0` success, `1` generation/verification failure, `2` usage error.

## Step 4 — Attach to the settlement export

Only evidence that passed step 3 is supplied as `priceEvidence` to the Model B settlement
export. The backend re-validates schema, policy binding (pair, token0, reviewed source
id), window, period bounds, cumulative delta and ETH/EUR skew itself
(`validatePriceEvidence`); the on-chain reproduction guarantee comes from step 3. The
export's `evidenceDigest` is a canonical **data** digest (key-sorted JSON), not a digest of
the exact file bytes; the receipt records both.

## Troubleshooting

- `ARCHIVE_UNAVAILABLE` / `RPC_HTTP_ERROR ... 403`: the RPC is not archive-capable or
  gates historical state. Use an archive endpoint; do not retry with a full node.
- `PINNING_UNSUPPORTED`: the endpoint rejects or ignores EIP-1898 block-hash pinning. Use
  another endpoint; evidence is never produced with unpinned reads.
- `REORG_DETECTED` / `BLOCK_UNAVAILABLE`: a pinned block stopped being canonical or known
  during the snapshot. Re-run once the block is finalized; never reuse partial output.
- `NOT_FINALIZED`: wait until the end block is finalized.
- `FEED_ROUND_REJECTED`: the feed round at the end block is stale, malformed or incomplete.
  Choosing a different end block is a benchmark-policy question, not an operator choice.
- `IDENTITY_MISMATCH`: pair, factory, token or feed identity differs from the pinned
  constants. Stop and escalate.
- `PAIR_STATE_REJECTED`: e.g. zero reserves (pair did not exist at a boundary block).
- `WRONG_CHAIN`: the tool is fail-closed to chain id 1.
- `VERIFICATION_MISMATCH`: the file does not reproduce; it must not be used.

## Notes

- All arithmetic is integer (`bigint`); IFR uses 9 decimals and price/rate values are
  never routed through JavaScript `number`.
- Floor rounding is deliberate: it never overstates the IFR amount per EUR.
- The TWAP/period/skew bounds are mirrored from `modelBSettlement.ts`; the backend module
  is the authoritative copy and re-validates every bound on import.
- Read-only smoke checks (public RPC) are recorded in the task report
  `.fleet/reports/T-290-model-b-price-evidence-tool.md`; they are not independent financial
  or security acceptance.
