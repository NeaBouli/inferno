# IFR External Listing Monitor

Read-only monitor for IFR token metadata invariants and external listing
surfaces. Implemented in `scripts/check-token-listing-status.js` with
deterministic mocked tests in `scripts/test-token-listing-status.cjs`.

## Usage

```bash
node scripts/check-token-listing-status.js
# or
npm run check:listing-status
```

Run the offline deterministic tests (no network):

```bash
node scripts/test-token-listing-status.cjs
# or
npm run test:listing-monitor
```

The monitor performs only HTTP GET requests against public endpoints. It
needs no secrets, API keys, authentication, or environment variables. Every
request carries the user-agent
`inferno-listing-monitor/1.0 (+https://github.com/NeaBouli/inferno)`, a 15
second timeout, and a 2 MiB response body cap. No raw HTML or response
bodies are printed — output is structured JSON only.

## Output

A single JSON document on stdout:

- `monitor`, `version`, `generatedAt` — report identity.
- `token` — canonical IFR metadata the invariants are checked against:
  address `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`, chainId 1, symbol
  `IFR`, name `Inferno`, decimals `9`, icon
  `https://ifrunit.tech/assets/ifr_icon_256.png`.
- `invariants.ok` — result of the project-controlled checks (below).
- `external` — status objects for each third-party surface.
- `ok` / `exitCode` — `0` when all invariants hold, `1` otherwise.

## Invariants (fail the command, exit 1)

These surfaces are project-controlled, so any violation or unavailability
fails closed:

- `https://ifrunit.tech/token-list.json`
- `https://ifrunit.tech/.well-known/token-list.json`

Each must return HTTP 200 with valid JSON containing a `chainId: 1` entry
for the exact IFR address (compared case-insensitively) with symbol `IFR`,
name `Inferno`, decimals `9`, and the official icon URL. Malformed JSON,
missing/duplicate entries, wrong metadata, HTTP errors, and fetch failures
all exit 1.

## External gates (status-only, never fail the command)

All of the following are reported as statuses; pending, open, missing,
rate-limited, or unreachable states do **not** affect the exit code:

- **GitHub public API**
  - MetaMask `contract-metadata` PR 1858 — `state`, `merged`, `draft`,
    `mergeable`, `mergeableState`, `updatedAt`, comment counts and `title`.
  - Uniswap `default-token-list` issue 2509 — `state`, `stateReason`,
    `comments`, `updatedAt`, `title`.
  - ethereum-lists `tokens` PR 1036 — `state`, `merged`, `draft`,
    `mergeable`, `mergeableState`, `updatedAt`, comment counts and `title`.
  - Statuses: `ok`, `rate_limited` (HTTP 403/429), `unreachable`.
- **CoinGecko** (no API key; anonymous rate limits apply)
  - Exact-contract endpoint
    `coins/ethereum/contract/0x77e9...6e7B` — `listed` (with `id`,
    `symbol`, `name`), `not_found` (404), `rate_limited`, `unreachable`.
  - Simple token-price endpoint — `priced` (with `usd`), `no_price`,
    `rate_limited`, `unreachable`.
- **CoinMarketCap DexScan** exact-contract token page — `reachable` with
  `verification: unverified | unverified_label_absent` and
  `contractReferenced`, or `unreachable`. Cloudflare blocks (403) and other
  non-200 responses report `unreachable` with the HTTP status.
- **Rainbow** exact-contract token page — `live_with_identity` when the
  body contains `Inferno` (case-insensitive), the `IFR` symbol and the exact
  IFR contract address,
  `live_identity_unclear` when reachable without that evidence, or
  `unreachable`.

## Exit codes

- `0` — official IFR metadata invariants hold. External listings may be in
  any state.
- `1` — an invariant failed (wrong/malformed/unreachable official metadata)
  or the monitor itself malfunctioned.

## Limitations

- External checks are point-in-time snapshots; they do not replace reading
  the linked PRs/issues for maintainer comments or review feedback.
- GitHub anonymous API rate limit is 60 requests/hour per IP; the monitor
  uses 3 requests per run. CoinGecko anonymous limits are stricter and vary.
- DexScan and Rainbow checks rely on page-body markers (`not verified`,
  `Inferno`, `IFR`, the contract address). Layout or wording changes on
  those sites can flip `verification`/`identity` readings without any real
  listing change — treat unexpected transitions as a prompt for manual
  review, not as proof.
- DexScan may be behind Cloudflare challenges for datacenter IPs; 403 is
  reported as `unreachable`, not as a listing regression.
- The monitor reads only; it cannot submit, comment, vote, or modify any
  external listing state.
- Tracking docs such as `docs/TOKEN_ICON_DISTRIBUTION.md` and
  `docs/COINMARKETCAP_SUBMISSION.md` remain the human-curated source of
  truth; this monitor automates the reachability/identity portion only.
