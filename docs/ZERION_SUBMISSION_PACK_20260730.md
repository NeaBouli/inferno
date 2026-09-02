# Zerion Missing-Asset Support Pack - Inferno (IFR)

Prepared: 2026-07-30
Status: resolved and live 2026-07-31

## Verified State

- Zerion exact-contract search for
  `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` returns
  `Nothing was found`.
- Zerion's documented logo flow requires opening an existing token page and
  selecting `Report asset`. That path is unavailable while IFR itself is
  missing.
- Canonical upload asset:
  `docs/assets/ifr_icon_128.png` (`128x128`, PNG, 10,766 bytes).

## Official Token Data

- Project: Inferno Protocol
- Token: Inferno
- On-chain symbol: `IFR`
- Social cashtag: `$IFRp`
- Network: Ethereum Mainnet
- Contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Decimals: `9`
- Website: `https://ifrunit.tech/`
- Etherscan:
  `https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Token list: `https://ifrunit.tech/token-list.json`
- Well-known token list:
  `https://ifrunit.tech/.well-known/token-list.json`
- GeckoTerminal:
  `https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`

## Draft Support Message

Subject:

```text
Missing Ethereum asset: Inferno (IFR)
```

Message:

```text
Hello Zerion team,

Inferno (IFR) is not returned when searching Zerion by its exact Ethereum
contract address:

0x77e99917Eca8539c62F509ED1193ac36580A6e7B

Could you please add the asset and its official logo?

Network: Ethereum Mainnet
Token name: Inferno
On-chain symbol: IFR
Decimals: 9
Website: https://ifrunit.tech/
Etherscan: https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B
Token list: https://ifrunit.tech/token-list.json
Well-known token list: https://ifrunit.tech/.well-known/token-list.json

The attached logo is the canonical 128x128 PNG. The project uses $IFRp only
as its social cashtag; IFR remains the on-chain token symbol.

Thank you.
```

## Submission Record

- The message above was reviewed and explicitly approved immediately before
  submission.
- It was sent through the official Zerion Intercom support chat.
- `docs/assets/ifr_icon_128.png` was uploaded and appeared as a separate
  visible user attachment in the conversation.
- `Zer AI Agent` confirmed that the request will be connected to a human
  agent and reported that support will be back online tomorrow.
- No human ticket/reference number or review result is available yet.

## Resolution Record

- On 2026-07-31, human support agent Sebastien confirmed that the IFR logo was
  added and the token should now be tracked correctly.
- Canonical Zerion token page:
  `https://app.zerion.io/tokens/IFR-8f9ccb3d-2e3b-4c3c-bda1-5040d80548f6?inputChain=ethereum&inputFungibleId=eth`
- A read-only check confirmed the official IFR icon, `Inferno Price (IFR)`,
  price data and circulating/total supply data.
- After explicit review and approval, a thank-you response was sent to
  Sebastien and appeared as a visible user message.

## Price-Tracking Regression - 2026-09-02

- The canonical token page and official IFR icon remain visible.
- The page now says: `We don't track the price of this asset.`
- This is a price-tracking regression or eligibility change, not a missing
  token/logo submission. Continue the existing support conversation instead
  of creating a duplicate asset request.

Draft follow-up, not sent:

```text
Hello Zerion team,

Thank you again for adding the canonical Inferno (IFR) identity and logo. The
token page and official icon are still visible, but the page now says that
Zerion does not track the price of this asset:

https://app.zerion.io/tokens/IFR-8f9ccb3d-2e3b-4c3c-bda1-5040d80548f6?inputChain=ethereum&inputFungibleId=eth

Exact Ethereum contract:
0x77e99917Eca8539c62F509ED1193ac36580A6e7B

Live IFR/WETH market:
https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0

Could you please confirm whether price tracking can be restored, or which
market-data or liquidity requirement is currently missing? This is a follow-up
to the existing IFR support case, not a duplicate token request.

Thank you.
```
