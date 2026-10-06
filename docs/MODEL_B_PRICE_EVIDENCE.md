# Model B Price Evidence — Generation and Independent Verification

Operator runbook for the Lane 4 Model B settlement price evidence: how to generate the
7-day TWAP + ETH/EUR evidence JSON and how to verify it independently against the chain
before it is attached to any settlement export or Safe proposal.

This procedure closes review finding **F3** (T-275 security review) **procedurally**: the
settlement backend only schema-checks price evidence (`validatePriceEvidence` in
`apps/benefits-network/backend/src/services/modelBSettlement.ts`); the `verify` step below
re-derives every field from chain state, so unverifiable evidence can no longer reach a
Safe proposal unnoticed. **Pilot activation remains a separate owner gate** — this tool
does not activate anything, does not sign, and never sends a transaction.

Tool: `scripts/model-b-price-evidence.mjs` (read-only, ethers v6 from the repo root
dependencies). Tests: `scripts/test-model-b-price-evidence.mjs` and
`apps/benefits-network/backend/tests/modelBPriceEvidence.test.ts`.

## Price source (owner decision 2026-10-06)

- **IFR price**: Uniswap V2 IFR/WETH pair TWAP over 7 days (the only IFR market). The
  cumulative price at each boundary block is derived exactly like
  `UniswapV2OracleLibrary.currentCumulativePrices`: `price0CumulativeLast` plus the
  counterfactual accrual from `blockTimestampLast` to the block timestamp, with the
  on-chain uint32/uint224/uint256 overflow semantics.
- **ETH/EUR**: on-chain Chainlink ETH/USD and EUR/USD aggregators read at the **same
  settlement end block**; `eth/eur = floor(ethUsdAnswer * 10^8 / eurUsdAnswer)`
  (explicit decimals, rounding floor).

## Pinned mainnet constants

| Constant | Value |
| --- | --- |
| IFR/WETH pair (`pair`) | `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` |
| IFR token (`token0`) | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| WETH (`token1`, sanity check) | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| Chainlink ETH/USD proxy | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` (8 decimals, heartbeat 3600 s) |
| Chainlink EUR/USD proxy | `0xb49f677943BC038e9857d61E7d053CaA2C1734C1` (8 decimals, heartbeat 86400 s) |
| `reviewedSourceId` | `uniswap-v2-twap:chainlink-eth-usd:eur-usd` |

Feed addresses were confirmed against Chainlink's official data-feeds registry, the data
source behind the [price feed contract addresses page](https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1):
[feeds-mainnet.json](https://reference-data-directory.vercel.app/feeds-mainnet.json)
(entries `eth-usd` and `eur-usd`, heartbeat 3600 s / 86400 s), and cross-checked on-chain
on 2026-10-06 (`description()` = "ETH / USD" / "EUR / USD", `decimals()` = 8). The pair's
`token0` was read on-chain on 2026-10-06 and equals IFR.

The `reviewedSourceId` uses `:` separators because the pilot policy parser
(`modelBPolicy.ts`) restricts reviewed source ids to `^[A-Za-z0-9._:-]{1,80}$`; the id
must be added to `reviewedPriceSourceIds` in the pilot policy by the policy owner for the
settlement export to accept the evidence.

## Prerequisites

- Node.js >= 22.13 and `npm ci` at the repository root (provides ethers 6.17.0).
- An **archive-capable Ethereum mainnet RPC**: both commands read pair and feed state via
  `eth_call` at historical blocks (7+ days old). Full nodes prune historical state; many
  public endpoints answer such reads with `missing trie node` or a generic `403`. The tool
  detects this and fails with a clear archive error instead of producing wrong evidence.
- No keys, no `.env`, no signing. The RPC URL is never printed (it may contain
  credentials); error messages show only the URL host.

## Step 1 — Choose the settlement end block

The end block must satisfy, for period `YYYY-MM` (whole UTC calendar months, half-open
`[start, end)`):

- `endBlock.timestamp >= period end` (first block at or after the month boundary is the
  natural choice), and
- `endBlock.timestamp <= period end + 72 hours` (`SETTLEMENT_MAX_LAG_SECONDS`).

The tool enforces both bounds and refuses blocks outside them. Block timestamps for a
candidate block can be checked on any block explorer or via a second RPC.

## Step 2 — Generate

```bash
node scripts/model-b-price-evidence.mjs generate \
  --rpc <archive-mainnet-rpc-url> \
  --period 2026-09 \
  --end-block 26100000 \
  --out evidence-2026-09.json
```

The generator:

1. finds the start block as the greatest block with `timestamp <= endBlock.timestamp -
   604800` (binary search; the resulting window must stay within `[7d, 7d + 1h]`),
2. reads `token0`/`token1`, reserves and `price0CumulativeLast` at both boundary blocks
   and rejects the pair if `token0` is not IFR or `token1` is not WETH,
3. computes the counterfactual `price0Cumulative` at both blocks,
4. reads `latestRoundData` on both Chainlink feeds **at the end block** and rejects stale
   answers (older than the feed heartbeat), non-positive answers, incomplete rounds
   (`answeredInRound < roundId`) and future-dated rounds,
5. emits the evidence JSON exactly in the shape of `priceEvidenceSchema`
   (`rounding: "floor"`, lowercase addresses/hashes, decimal-string integers).

`ethEur.publishedAt` is the older of the two feeds' `updatedAt` timestamps: the composite
reference is only as fresh as its stalest leg. `ethEur.rate` carries 8 explicit decimals
(`241505369862` = 2415.05369862 EUR per ETH).

## Step 3 — Verify independently

```bash
node scripts/model-b-price-evidence.mjs verify \
  --rpc <archive-mainnet-rpc-url> \
  --file evidence-2026-09.json
```

The verifier independently re-derives **every** field from chain at the stated block
numbers and exits non-zero listing **all** mismatches if any value does not reproduce:

- block hash and timestamp of both boundary blocks (a reorg between generation and
  verification fails the hash check — regenerate),
- pair `token0`/`token1` at both blocks,
- counterfactual `price0Cumulative` at both blocks,
- the 7-day window bound,
- both Chainlink rounds at the end block (freshness, positivity, completeness, decimals),
- `ethEur.rate` (floor division), `publishedAt`, `decimals`, `source`,
- the 24 h skew bound between `publishedAt` and the end block,
- `reviewedSourceId`, `pair`, `token0`, `rounding` against the pinned constants.

**Operator rule:** run `verify` at least once, preferably against a *different* RPC
endpoint than the one used for generation, so a compromised or broken endpoint cannot
fabricate evidence. Evidence that fails verification must never reach a settlement
export, a Safe proposal, or a reviewer.

Exit codes: `0` success, `1` generation/verification failure, `2` usage error.

## Step 4 — Attach to the settlement export

Only evidence that passed step 3 is supplied as `priceEvidence` to the Model B settlement
export. The backend re-validates schema, policy binding (pair, token0, reviewed source
id), window, period bounds, cumulative delta and ETH/EUR skew itself
(`validatePriceEvidence`); the on-chain reproduction guarantee comes from step 3. The
export's `evidenceDigest` commits the Safe review to the exact evidence bytes.

## Troubleshooting

- `historical state is unavailable or gated`: the RPC is not archive-capable. Use an
  archive endpoint; do not retry with a full node.
- `Chainlink ETH/USD round rejected: stale answer`: the feed had not updated within its
  heartbeat at the end block. Wait for the next round and choose a later end block that
  still satisfies the 72 h lag bound.
- `Pair reserves must be positive`: the pair did not exist at a boundary block; the
  settlement period predates the pair. Such a period cannot be settled with this source.
- `TWAP window is ...`: chain timestamps moved between block selection and reading
  (only possible across a reorg). Re-run generation.
- `RPC is not Ethereum mainnet`: the tool is fail-closed to chain id 1.

## Notes

- All arithmetic is integer (`bigint`); IFR uses 9 decimals and price/rate values are
  never routed through JavaScript `number`.
- Floor rounding is deliberate: it never overstates the IFR amount per EUR.
- The TWAP/period/skew bounds are mirrored from `modelBSettlement.ts`; the backend module
  is the authoritative copy and re-validates every bound on import.
- Live smoke evidence (read-only, public RPC, latest block only) confirming the pinned
  constants and feed freshness on 2026-10-06 is recorded in the task report
  `.fleet/reports/T-290-model-b-price-evidence-tool.md`.
