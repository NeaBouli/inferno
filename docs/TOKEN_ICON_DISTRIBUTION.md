# IFR Token Icon Distribution

Last checked: 2026-07-30

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
| Uniswap Default Token List | Open / waiting | Request exists: https://github.com/Uniswap/default-token-list/issues/2509. No maintainer comment; last activity remains the 2026-07-08 project update with Etherscan Neutral, token-list URLs, icon URLs, and GeckoTerminal pool. |
| Uniswap Custom Token List | Ready | Hosted at `https://ifrunit.tech/token-list.json`. |
| MetaMask Registry | PR open / review required | Retry submitted after Etherscan moved to `Neutral`: https://github.com/MetaMask/contract-metadata/pull/1858. The PR is `MERGEABLE` but `BLOCKED`, with no submitted review or maintainer activity since the 2026-07-08 follow-up. Three visible reported checks are successful; code-owner action is pending. |
| MetaMask `wallet_watchAsset` | Implemented | Landing page can request MetaMask to add IFR with the official icon URL. |
| ethereum-lists | Open / blocked | Token definition PR remains open and `MERGEABLE` but `BLOCKED`: https://github.com/ethereum-lists/tokens/pull/1036. No submitted review, reported check, or maintainer comment since the 2026-07-08 project follow-up. |
| Trust Wallet Assets | Not eligible / do not pay | Official path requires 500 TWT or 2.5 BNB non-refundable fee, reputable full audit, CMC tracking, and guideline thresholds of 10,000 holders / 15,000 transactions. IFR is absent from the repository; the prepared 256x256 PNG is technically compliant, but submission is not justified. |
| Rainbow Token List | Waiting on upstream sources | Rainbow's UI says verification requires appearance on at least three outside token lists. Its bundled list is refreshed from a private backend URL; IFR is absent and no public direct submission path is documented. |
| Zerion | Submitted / awaiting human review | Exact-contract search returns `Nothing was found`. The missing-asset request and canonical 128x128 PNG were submitted through official Zerion Intercom support on 2026-07-30. Zer AI confirmed handoff to a human agent; no ticket/reference number or review result is available yet. |
| Phantom | External-data path / no verification form | Phantom uses trusted sources such as CoinGecko and does not provide a verification form or timeline. IFR's CoinGecko exact-contract endpoint still returns `coin not found`; GeckoTerminal alone is not a CoinGecko coin listing. |
| Coinbase/Base Wallet | Indirect | No public ERC-20 logo PR path found; wallet visibility generally follows indexed market/explorer metadata and manual custom-token support. |
| Rabby / OKX Wallet | Indirect | No stable public ERC-20 icon PR path confirmed. Track through Etherscan, token lists, market-data providers, and wallet support channels if IFR is missing after listings mature. |

## Next Actions

1. Watch MetaMask PR #1858 and answer maintainer feedback quickly.
2. Keep Uniswap issue #2509 updated after any CoinGecko/CoinMarketCap page goes live.
3. Keep ethereum-lists PR #1036 under watch.
4. Do not pay/submit a Trust Wallet PR until CMC, professional audit and activity criteria are met.
5. Wait for Zerion's human support response; do not submit a duplicate or send
   another reminder without new evidence or a reasonable follow-up interval.
6. Keep monitoring Etherscan reputation for movement from `Neutral` to `OK`.
7. Keep `docs/token-list.json` and `docs/.well-known/token-list.json` in sync when metadata changes.
