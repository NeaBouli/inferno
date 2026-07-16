# CoinGecko Follow-up Pack - IFR

Prepared: 2026-07-16 09:13 EEST  
Status: draft only, not sent  
Scope: exact-contract evidence pack for Inferno / IFR on Ethereum Mainnet

## Do Not Send Before Review

This file is a local preparation pack. Do not submit, email, upload, paste into a
support form, or post this text externally until Gio has reviewed and approved
the final wording.

## Token Identity

- Project: Inferno Protocol
- Token name: Inferno
- On-chain symbol: IFR
- Social cashtag: $IFRp
- Chain: Ethereum Mainnet
- Chain ID: 1
- Contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Decimals: 9
- Website: https://ifrunit.tech/
- Uniswap V2 pair: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`
- GeckoTerminal pool: https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0

## Current Public Status Checked

Checked on 2026-07-16:

- CoinGecko exact-contract endpoint:
  - URL: `https://api.coingecko.com/api/v3/coins/ethereum/contract/0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  - Result: HTTP 404, `{"error":"coin not found"}`
- CoinGecko search endpoint:
  - URL: `https://api.coingecko.com/api/v3/search?query=Inferno%20IFR`
  - Result: HTTP 200, empty `coins` array
- GeckoTerminal token endpoint:
  - URL: `https://api.geckoterminal.com/api/v2/networks/eth/tokens/0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
  - Result: HTTP 200
  - Returned token id: `eth_0x77e99917eca8539c62f509ed1193ac36580a6e7b`
  - Returned name/symbol/decimals: `Inferno` / `IFR` / `9`
  - `coingecko_coin_id`: `null`

Interpretation: IFR is visible on GeckoTerminal, but a public standalone
CoinGecko exact-contract coin page is not yet confirmed.

## Evidence Links

- Etherscan token page:
  - https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- Etherscan hosted icon:
  - https://etherscan.io/token/images/infernoprotocol_ifr.svg
  - Checked 2026-07-16: HTTP 200, `content-type: image/svg+xml`
- Project token list:
  - https://ifrunit.tech/token-list.json
  - Checked 2026-07-16: HTTP 200, includes IFR exact contract
- Well-known token list:
  - https://ifrunit.tech/.well-known/token-list.json
  - Checked 2026-07-16: HTTP 200, includes IFR exact contract
- Project hosted 256x256 icon:
  - https://ifrunit.tech/assets/ifr_icon_256.png
  - Checked 2026-07-16: HTTP 200, `content-type: image/png`, CORS `*`
- GeckoTerminal token API:
  - https://api.geckoterminal.com/api/v2/networks/eth/tokens/0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- GeckoTerminal pool:
  - https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0
- MetaMask metadata PR:
  - https://github.com/MetaMask/contract-metadata/pull/1858
  - Checked 2026-07-16: open, mergeable, review required
- Uniswap default token list issue:
  - https://github.com/Uniswap/default-token-list/issues/2509
  - Checked 2026-07-16: open

## Collision Avoidance

Use only the exact Ethereum Mainnet contract above. Do not cite unrelated
CoinGecko pages or tickers.

Known collision risk:

- `Inferium (IFR)` is not this project.
- `INFERNO (INF)` is not this project.
- IFR Protocol / Inferno should distinguish public social references with
  `$IFRp` where ticker collision could confuse users.

## Draft Follow-up Message

Subject: Inferno (IFR) CoinGecko listing status / canonical URL request

Hello CoinGecko team,

I am following up on the Inferno (IFR) Ethereum Mainnet token listing status.

Token details:

- Project: Inferno Protocol
- Token name: Inferno
- Symbol: IFR
- Social cashtag: $IFRp
- Chain: Ethereum Mainnet
- Contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Decimals: 9
- Website: https://ifrunit.tech/
- Uniswap V2 pair: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`
- GeckoTerminal pool: https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0

Current public evidence:

- Etherscan token page:
  https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- Etherscan hosted icon:
  https://etherscan.io/token/images/infernoprotocol_ifr.svg
- Project token list:
  https://ifrunit.tech/token-list.json
- Well-known token list:
  https://ifrunit.tech/.well-known/token-list.json
- Project hosted 256x256 icon:
  https://ifrunit.tech/assets/ifr_icon_256.png
- GeckoTerminal API recognizes the exact token contract:
  `eth_0x77e99917eca8539c62f509ed1193ac36580a6e7b`

As of 2026-07-16, the public CoinGecko contract endpoint still returns `coin
not found` for the exact IFR contract:

`https://api.coingecko.com/api/v3/coins/ethereum/contract/0x77e99917Eca8539c62F509ED1193ac36580A6e7B`

Could you please confirm whether the listing is still pending, whether any
specific action is needed from our side, or whether there is already a canonical
public CoinGecko coin URL for this exact Ethereum contract?

Important distinction: this is not the unrelated `Inferium (IFR)` token and not
the unrelated `INFERNO (INF)` token. Please map only the Ethereum Mainnet
contract `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`.

Thank you.

## Suggested Attachments / Screenshots

Use only if the support channel allows attachments and Gio approves sending:

- Etherscan token profile screenshot showing exact contract.
- Project token list JSON screenshot or raw URL.
- GeckoTerminal pool/token screenshot.
- Icon file from `https://ifrunit.tech/assets/ifr_icon_256.png`.

## After CoinGecko Responds

- If CoinGecko provides a canonical public URL, verify that the page maps to the
  exact contract before using it anywhere.
- If CoinGecko asks for a correction, fix only the named blocker and document
  the proof in `BRIDGE.md`.
- If the exact-contract listing goes live:
  - update Uniswap issue `#2509`,
  - re-check Phantom display/icon behavior,
  - use the canonical URL as new evidence for MetaMask PR `#1858` only if it
    adds material value.
