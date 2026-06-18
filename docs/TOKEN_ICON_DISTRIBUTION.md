# IFR Token Icon Distribution

Last checked: 2026-06-18

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
| Etherscan | Live | Token page uses `infernoprotocol_ifr.svg`. Reputation still shows `Unknown`. |
| Uniswap Default Token List | Open | Request exists: https://github.com/Uniswap/default-token-list/issues/2509 |
| Uniswap Custom Token List | Ready | Hosted at `https://ifrunit.tech/token-list.json`. |
| MetaMask Registry | Blocked | `MetaMask/contract-metadata` is effectively frozen for new tokens and requires Etherscan `NEUTRAL` or `OK` reputation for Ethereum assets. IFR currently shows `Unknown`. |
| MetaMask `wallet_watchAsset` | Implemented | Landing page can request MetaMask to add IFR with the official icon URL. |

## Next Actions

1. Keep Uniswap issue #2509 updated after any CoinGecko/CoinMarketCap page goes live.
2. Request Etherscan reputation review from `Unknown` to `Neutral` or `OK`.
3. Re-check MetaMask registry only after Etherscan reputation changes.
4. Keep `docs/token-list.json` and `docs/.well-known/token-list.json` in sync when metadata changes.
