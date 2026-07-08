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
| Uniswap Default Token List | Open | Request exists: https://github.com/Uniswap/default-token-list/issues/2509 |
| Uniswap Custom Token List | Ready | Hosted at `https://ifrunit.tech/token-list.json`. |
| MetaMask Registry | Ready for retry | `MetaMask/contract-metadata` is effectively frozen for new tokens, but the former Etherscan `Unknown` blocker is cleared because IFR now shows `Neutral`. |
| MetaMask `wallet_watchAsset` | Implemented | Landing page can request MetaMask to add IFR with the official icon URL. |

## Next Actions

1. Keep Uniswap issue #2509 updated after any CoinGecko/CoinMarketCap page goes live.
2. Retry MetaMask registry/token metadata follow-up with Etherscan `Neutral` as supporting evidence.
3. Keep monitoring Etherscan reputation for movement from `Neutral` to `OK`.
4. Keep `docs/token-list.json` and `docs/.well-known/token-list.json` in sync when metadata changes.
