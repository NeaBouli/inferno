# IFR Listing Recovery Pack - 2026-09-02

Status: prepared for review; no external message in this file has been sent.

## Verified Current State

| Surface | Current state | Next action |
| --- | --- | --- |
| Etherscan | Exact IFR contract is live with the official icon and `Neutral` reputation. | Monitor; no duplicate request. |
| GeckoTerminal | Exact IFR/WETH pool is live. | Keep as market evidence. |
| CoinGecko | Existing application was submitted; exact-contract API still returns `coin not found`. | Follow up the existing request. Do not submit a duplicate. |
| CoinMarketCap | Existing ticket `1390230`; DexScan recognizes IFR but marks it unverified. | Follow up ticket `1390230`. Do not submit a duplicate. |
| Zerion | Exact token identity and official icon are live; price tracking is currently unavailable. | Continue the existing support conversation. |
| MetaMask | PR #1858 is open, review required, with three visible successful checks. | Wait for code-owner review; add only material new evidence. |
| Uniswap | Issue #2509 is open without a maintainer response. | Add only a confirmed CoinGecko/CMC listing or requested evidence. |
| ethereum-lists | PR #1036 was closed unmerged by the stale bot on 2026-08-27. | Ask for reopening; use one replacement only if reopening is unavailable. |
| Phantom | No direct verification form; recognition depends on trusted market-data sources. | Retest after CoinGecko or CMC is confirmed. |
| Trust Wallet | IFR does not meet the published holder/activity and CMC prerequisites. | Do not submit or pay yet. |

## External Action Order

1. Ask ethereum-lists to reopen PR #1036.
2. Follow up the existing CoinGecko application.
3. Follow up CoinMarketCap ticket `1390230`.
4. Report Zerion's missing price tracking through the existing conversation.
5. After a confirmed CoinGecko or CMC listing, retest Phantom and provide that
   new evidence to Uniswap #2509 and MetaMask #1858 only if useful.
6. Keep Trust Wallet deferred until its published prerequisites are met.

## ethereum-lists PR #1036 Draft

```text
Hello maintainers,

PR #1036 was closed automatically as stale on 2026-08-27, but the token
metadata remains current and the change is still needed. Could you please
reopen the PR for review, or confirm whether you prefer a fresh replacement?

Canonical Ethereum contract:
0x77e99917Eca8539c62F509ED1193ac36580A6e7B

Current evidence:
- Etherscan reputation: Neutral
- Official token list: https://ifrunit.tech/token-list.json
- Well-known token list: https://ifrunit.tech/.well-known/token-list.json
- Official icon: https://ifrunit.tech/assets/ifr_icon_256.png
- GeckoTerminal pool: https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0

We will avoid opening a duplicate while reopening remains possible. Thank you.
```

## CoinGecko Follow-up Draft

Use the complete reviewed evidence and text in
`docs/COINGECKO_FOLLOWUP_PACK_20260716.md`. The request must refer to the
existing application and ask for its status or a specific missing requirement.
CoinGecko's current verification guidance also requires a public post from an
official social account that states the listing/update intent and includes the
GeckoTerminal URL; reuse the existing public proof only if it satisfies those
exact conditions.

## CoinMarketCap Follow-up Draft

Use the 2026-09-02 follow-up in `docs/COINMARKETCAP_SUBMISSION.md` and reference
ticket `1390230`. Do not open another listing request.

## Zerion Follow-up Draft

Use the 2026-09-02 regression message in
`docs/ZERION_SUBMISSION_PACK_20260730.md`. The request concerns missing price
tracking; the identity and icon are already present.

## Deferred Updates

Do not comment on MetaMask #1858 or Uniswap #2509 merely to repeat existing
evidence. A confirmed CoinGecko or CoinMarketCap page is material new evidence
and is the preferred next update. MetaMask's contract-metadata PR can add the
icon and metadata but does not guarantee the separate Portfolio verification
badge.

## Canonical Links

- Contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Etherscan: https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- Token list: https://ifrunit.tech/token-list.json
- Well-known token list: https://ifrunit.tech/.well-known/token-list.json
- Icon: https://ifrunit.tech/assets/ifr_icon_256.png
- Pool: https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0
- MetaMask: https://github.com/MetaMask/contract-metadata/pull/1858
- Uniswap: https://github.com/Uniswap/default-token-list/issues/2509
- ethereum-lists: https://github.com/ethereum-lists/tokens/pull/1036
