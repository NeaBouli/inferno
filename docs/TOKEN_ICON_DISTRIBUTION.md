# IFR Token Icon Distribution

Last checked: 2026-09-28

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
| Uniswap Default Token List | Open / waiting | Request exists: https://github.com/Uniswap/default-token-list/issues/2509. Open with no maintainer response; last activity remains the 2026-07-08 project update with Etherscan Neutral, token-list URLs, icon URLs, and GeckoTerminal pool. Do not add another comment. |
| Uniswap Custom Token List | Ready | Hosted at `https://ifrunit.tech/token-list.json`. |
| MetaMask Registry | PR open / review required | Retry submitted after Etherscan moved to `Neutral`: https://github.com/MetaMask/contract-metadata/pull/1858. Open and unmerged with zero reviews and a requested reviewer; no maintainer activity has appeared since the 2026-07-08 follow-up. Three checks pass and the public API reports mergeable state `clean`. This is not icon-registry acceptance. |
| MetaMask `wallet_watchAsset` | Implemented | Landing page can request MetaMask to add IFR with the official icon URL. |
| ethereum-lists | Replacement open / review pending | PR #1049 is open and mergeable with state `unstable`: https://github.com/ethereum-lists/tokens/pull/1049. It has zero reviews, zero comments and zero check-runs; it is not merged or accepted. Original PR #1036 was stale-closed and points to this single replacement. |
| Trust Wallet Assets | Not eligible / do not pay | Official path requires 500 TWT or 2.5 BNB non-refundable fee, reputable full audit, CMC tracking, and guideline thresholds of 10,000 holders / 15,000 transactions. IFR is absent from the repository; the prepared 256x256 PNG is technically compliant, but submission is not justified. |
| Rainbow | Token page live / icon missing | Rainbow resolves the exact Ethereum contract to Inferno (IFR) and displays a live price at https://rainbow.me/token/ethereum/0x77e99917eca8539c62f509ed1193ac36580a6e7b. No token image is rendered, and no public direct icon-submission path is documented. |
| Zerion | Live / verified | Human support added the canonical IFR logo and enabled tracking on 2026-07-31. The live page shows the IFR icon, Inferno name, price and supply data: https://app.zerion.io/tokens/IFR-8f9ccb3d-2e3b-4c3c-bda1-5040d80548f6?inputChain=ethereum&inputFungibleId=eth |
| Phantom | External-data path / no verification form | Phantom uses trusted sources such as CoinGecko and does not provide a verification form or timeline. IFR's CoinGecko exact-contract endpoint still returns `coin not found`; GeckoTerminal verification/icon is not a CoinGecko listing, wallet verification, Uniswap icon or price coverage. |
| Coinbase/Base Wallet | Indirect | No public ERC-20 logo PR path found; wallet visibility generally follows indexed market/explorer metadata and manual custom-token support. |
| Rabby / OKX Wallet | Indirect | No stable public ERC-20 icon PR path confirmed. Track through Etherscan, token lists, market-data providers, and wallet support channels if IFR is missing after listings mature. |

## Next Actions

1. Watch MetaMask PR #1858 and answer maintainer feedback quickly.
2. Update Uniswap issue #2509 only after a standalone CoinGecko/CMC listing or
   other material new evidence goes live. CMC DexScan visibility alone is not
   a standalone listing and does not trigger another reminder.
3. Keep ethereum-lists replacement PR #1049 under watch.
   No external bump or duplicate submission without material new evidence.
4. Do not pay/submit a Trust Wallet PR until CMC, professional audit and activity criteria are met.
5. Zerion is resolved; monitor only for a token-page, metadata or icon
   regression.
6. Rainbow discovery is resolved; monitor the missing icon and upstream
   metadata only, without opening an unsupported Rainbow-only request.
7. Keep monitoring Etherscan reputation for movement from `Neutral` to `OK`.
8. Keep `docs/token-list.json` and `docs/.well-known/token-list.json` in sync when metadata changes.
9. CoinGecko request `CL0309260050` was submitted on 2026-09-04 and rejected
   in early September 2026 for insufficient organic attention. No
   reapplication is confirmed. Improve evidence/traction first, then make a
   deliberate reapplication decision; do not submit a duplicate.
10. CoinMarketCap follow-up ticket `1453378` remains in free review with no
   promised timeline. `https://coinmarketcap.com/currencies/inferno/` is an
   unrelated `INF` asset and must never be linked as IFR.
11. LBank due diligence is incomplete; Biconomy has no verified intake record.
   Neither is an IFR listing.
12. Run `npm run check:listing-status` for a reproducible read-only snapshot
   before preparing any external follow-up.
