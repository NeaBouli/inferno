# Wallet Icon Distribution Status - 2026-07-08

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
| Uniswap Default Token List | Open, updated with Neutral/Icon/List evidence | `https://github.com/Uniswap/default-token-list/issues/2509` |
| MetaMask contract metadata | PR opened after Neutral reputation cleared the old blocker; polite follow-up posted because review is still required | `https://github.com/MetaMask/contract-metadata/pull/1858` |
| ethereum-lists | PR open; polite follow-up posted after no maintainer response | `https://github.com/ethereum-lists/tokens/pull/1036` |

## Wallet-Specific Reality Check

### Phantom

Phantom supports Ethereum, but its public token-display documentation is mainly explicit for Solana metadata and says token visibility is also affected by automated trust and safety signals. There is no confirmed public Ethereum ERC-20 logo PR path comparable to Trust Wallet or MetaMask.

Practical route for IFR:

1. Keep Etherscan metadata/reputation clean.
2. Keep Blockaid/DEX safety clean.
3. Keep official Token Lists live.
4. Land CoinGecko/CoinMarketCap when eligible.
5. If IFR is still hidden or unlabeled in Phantom after those steps, use Phantom's integration/support request form with the canonical metadata above.

### Trust Wallet

Trust Wallet has an official `trustwallet/assets` path, but it is not a good immediate live submission for IFR yet.

Relevant blockers:

- A non-refundable processing fee is required.
- Official requirements include CMC price tracking.
- Official acceptance guidelines currently mention high on-chain activity thresholds.
- IFR currently has low holder count compared with those thresholds.

Action: prepare the payload, but do not submit/pay until CMC and activity improve.

Suggested Trust Wallet path when ready:

```text
blockchains/ethereum/assets/0x77e99917Eca8539c62F509ED1193ac36580A6e7B/logo.png
blockchains/ethereum/assets/0x77e99917Eca8539c62F509ED1193ac36580A6e7B/info.json
```

Use `docs/assets/ifr_icon_256.png` as `logo.png`.

### Rainbow

Rainbow's token list is generated from multiple upstream sources, including `ethereum-lists/tokens`, token-list providers, and market-data providers. IFR should flow better after:

1. ethereum-lists PR #1036 lands;
2. CoinGecko/CoinMarketCap pages exist;
3. IFR appears in upstream token-list providers.

Do not add a weak Rainbow-only override just to force an unverified entry without icon support.

### Zerion

Zerion has an official in-app asset report flow for missing or incorrect token logos. It requires searching the token in `https://app.zerion.io/`, opening the asset report, selecting logo correction, and uploading a `128x128` logo.

Action: manual browser submission if IFR is missing in Zerion after market-data indexing.

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
4. CMC status once a local `CMC_API_KEY` is available.
5. CoinGecko/CoinMarketCap eligibility and profile availability.
