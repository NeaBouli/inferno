# Wallet Icon Distribution Status

Last verified: 2026-07-30. The filename is retained because this status record
was originally created on 2026-07-08.

This note records where IFR token metadata and icon visibility can realistically be pushed next.

## Canonical IFR Metadata

- Token: Inferno
- On-chain symbol: `IFR`
- Social cashtag: `$IFRp`
- Chain: Ethereum Mainnet, `chainId: 1`
- Contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Decimals: `9`
- Website: `https://ifrunit.tech/`
- Token list: `https://ifrunit.tech/token-list.json`
- Well-known token list: `https://ifrunit.tech/.well-known/token-list.json`
- PNG icon: `https://ifrunit.tech/assets/ifr_icon_256.png`
- Etherscan SVG icon: `https://etherscan.io/token/images/infernoprotocol_ifr.svg`
- GeckoTerminal pool: `https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`

## Submitted / Updated

| Surface | Status | Link |
| --- | --- | --- |
| Etherscan | Live, reputation `Neutral` | `https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| Uniswap Default Token List | Open; no maintainer comment; last activity is the project evidence update from 2026-07-08 | `https://github.com/Uniswap/default-token-list/issues/2509` |
| MetaMask contract metadata | Open; `REVIEW_REQUIRED`; `MERGEABLE` but `BLOCKED`; no submitted review or maintainer activity since 2026-07-08; three visible reported checks successful | `https://github.com/MetaMask/contract-metadata/pull/1858` |
| ethereum-lists | Open, `MERGEABLE` but `BLOCKED`; no submitted review, reported check, or maintainer comment since the project follow-up on 2026-07-08 | `https://github.com/ethereum-lists/tokens/pull/1036` |

## Wallet-Specific Reality Check

### Phantom

Phantom's official documentation says verified-token status is derived from
trusted third-party data sources such as CoinGecko and Jupiter. Phantom does
not publish specific verification criteria and explicitly says there is no
email address or form for token-verification requests. Listing on a source
does not guarantee verification or provide a timeline.

Practical route for IFR:

1. Keep Etherscan metadata/reputation clean.
2. Keep Blockaid/DEX safety clean.
3. Keep official Token Lists live.
4. Obtain a real CoinGecko coin listing and market-data coverage.
5. Improve sustained liquidity and trading activity so Phantom can obtain
   reliable pricing.
6. Do not send a verification request: Phantom has no such form. Support is
   relevant only for a rare incorrect spam/flagging review, not ordinary
   verification.

Verified 2026-07-30:

- CoinGecko exact-contract endpoint: `coin not found`.
- CoinGecko search for `Inferno IFR`: empty `coins` array.
- GeckoTerminal visibility is live but is not a standalone CoinGecko coin
  listing.
- Official sources:
  - `https://help.phantom.com/hc/en-us/articles/38425812822419-About-verified-and-unverified-tokens-in-Phantom`
  - `https://help.phantom.com/hc/en-us/articles/48230217309587-A-token-I-created-is-flagged-as-spam-in-Phantom`
  - `https://help.phantom.com/hc/en-us/articles/4406389241107-Why-a-token-doesn-t-show-a-price-in-Phantom`

### Trust Wallet

Trust Wallet has an official `trustwallet/assets` path, but it is not a good immediate live submission for IFR yet.

Relevant blockers:

- A non-refundable fee of `500 TWT` or `2.5 BNB` is required per PR; payment
  does not guarantee acceptance.
- A completed full audit by a reputable security firm is required.
- CoinMarketCap price tracking with detailed token information is required.
- Acceptance guidelines currently require at least 10,000 holders and 15,000
  transactions, excluding airdrops, subject to case-by-case adjustment.
- The official repository currently has no IFR asset directory.

Action: do not submit or pay. Re-evaluate only after CMC, professional audit
and activity criteria are met.

Suggested Trust Wallet path when ready:

```text
blockchains/ethereum/assets/0x77e99917Eca8539c62F509ED1193ac36580A6e7B/logo.png
blockchains/ethereum/assets/0x77e99917Eca8539c62F509ED1193ac36580A6e7B/info.json
```

Use `docs/assets/ifr_icon_256.png` as `logo.png`.
It is already compliant at `256x256`, `33,884` bytes, PNG, under the current
100 kB limit.

Official sources:

- `https://developer.trustwallet.com/developer/new-asset/requirements`
- `https://developer.trustwallet.com/developer/listing-new-assets/new-asset`
- `https://developer.trustwallet.com/developer/listing-new-assets/pr-fee`

### Rainbow

Rainbow's current open-source UI says a verified badge means a token has
appeared on at least three outside token lists. The app bundles a curated
Rainbow token list that is refreshed from a backend URL supplied through
Rainbow's private environment; no public direct token-submission route is
documented. IFR is not present in the currently bundled list.

Practical route:

1. Land ethereum-lists PR #1036.
2. Obtain CoinGecko and CoinMarketCap listings.
3. Keep the official IFR token lists and explorer metadata consistent.
4. Do not open an unsupported Rainbow-only PR.

Official source evidence:

- `https://github.com/rainbow-me/rainbow/blob/develop/src/languages/en_US.json`
- `https://github.com/rainbow-me/rainbow/blob/develop/scripts/update-token-list.sh`
- `https://github.com/rainbow-me/rainbow/blob/develop/src/references/rainbow-token-list/rainbow-token-list.json`

### Zerion

Zerion has an official in-app asset report flow for missing or incorrect token logos. It requires searching the token in `https://app.zerion.io/`, opening the asset report, selecting logo correction, and uploading a `128x128` logo.

Action: first confirm interactively that IFR or its logo is missing. A manual
submission then requires explicit approval and a prepared `128x128` PNG; no
submission was made in this task.

Official source:

- `https://help.zerion.io/en/articles/9800573-how-to-request-the-addition-or-correction-of-a-token-logo`

### Coinbase/Base Wallet, Rabby, OKX

No stable public ERC-20 icon PR path was confirmed for these wallets. Treat them as indirect-indexing surfaces:

- Etherscan token profile and reputation
- token lists
- CoinGecko / CoinMarketCap
- GeckoTerminal / DEX data
- direct wallet support only if IFR remains missing after the above are mature

## Open Watchlist

1. MetaMask PR #1858 maintainer response.
2. Uniswap issue #2509 maintainer response.
3. ethereum-lists PR #1036 maintainer response.
4. CoinGecko application response; exact-contract API still says
   `coin not found`.
5. CMC status once a local `CMC_API_KEY` is available.
6. Zerion interactive presence/logo check before any approved report.
