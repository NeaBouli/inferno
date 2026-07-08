# IFR Token Icon Distribution

Last checked: 2026-07-08

## Canonical Token Metadata

- Token: Inferno (IFR)
- Chain: Ethereum Mainnet (`chainId: 1`)
- Contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Decimals: `9`
- Icon PNG: `https://ifrunit.tech/assets/ifr_icon_256.png`
- Icon SVG on Etherscan: `https://etherscan.io/token/images/infernoprotocol_ifr.svg`
- Token list: `https://ifrunit.tech/token-list.json`
- Well-known token list: `https://ifrunit.tech/.well-known/token-list.json`

## Status By Surface

| Surface | Status | Notes |
| --- | --- | --- |
| Etherscan | Live | Token page uses `infernoprotocol_ifr.svg`. Reputation now shows `Neutral`. |
| Uniswap Default Token List | Open / updated | Request exists: https://github.com/Uniswap/default-token-list/issues/2509. Latest follow-up posted with Etherscan Neutral, token-list URLs, icon URLs, and GeckoTerminal pool. |
| Uniswap Custom Token List | Ready | Hosted at `https://ifrunit.tech/token-list.json`. |
| MetaMask Registry | PR open / followed up | Retry submitted after Etherscan moved to `Neutral`: https://github.com/MetaMask/contract-metadata/pull/1858. Follow-up comment posted: https://github.com/MetaMask/contract-metadata/pull/1858#issuecomment-4912859782. MetaMask still requires code-owner review, so merge is not guaranteed. |
| MetaMask `wallet_watchAsset` | Implemented | Landing page can request MetaMask to add IFR with the official icon URL. |
| ethereum-lists | Open / followed up | Token definition PR remains open: https://github.com/ethereum-lists/tokens/pull/1036. Follow-up comment posted: https://github.com/ethereum-lists/tokens/pull/1036#issuecomment-4912862731 |
| Trust Wallet Assets | Not yet eligible / prepared | Official path is a `trustwallet/assets` PR plus fee, but Trust requirements currently include CMC price tracking and high holder/transaction thresholds. Prepare, but do not submit fee PR until CMC/on-chain activity improves. |
| Rainbow Token List | Waiting on upstream sources | Rainbow builds from ethereum-lists, CoinGecko/CMC/token lists and overrides. Best path is to land ethereum-lists and market-data listings first. |
| Zerion | Manual form path | Official path is Zerion app asset report / Typeform with 128x128 logo. Requires interactive web submission. |
| Phantom | Indirect / trust-signal path | Phantom supports Ethereum, but token visibility relies on metadata and trust/safety signals rather than a public ERC-20 logo PR. Keep Etherscan, token lists, GeckoTerminal, CoinGecko/CMC, and Blockaid clean. |
| Coinbase/Base Wallet | Indirect | No public ERC-20 logo PR path found; wallet visibility generally follows indexed market/explorer metadata and manual custom-token support. |
| Rabby / OKX Wallet | Indirect | No stable public ERC-20 icon PR path confirmed. Track through Etherscan, token lists, market-data providers, and wallet support channels if IFR is missing after listings mature. |

## Next Actions

1. Watch MetaMask PR #1858 and answer maintainer feedback quickly.
2. Keep Uniswap issue #2509 updated after any CoinGecko/CoinMarketCap page goes live.
3. Keep ethereum-lists PR #1036 under watch.
4. Do not pay/submit Trust Wallet fee PR until CMC and activity thresholds are closer to acceptance.
5. Run Zerion's asset report manually if IFR is missing in Zerion after market-data indexing.
6. Keep monitoring Etherscan reputation for movement from `Neutral` to `OK`.
7. Keep `docs/token-list.json` and `docs/.well-known/token-list.json` in sync when metadata changes.
