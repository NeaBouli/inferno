# Zerion Missing-Asset Support Pack - Inferno (IFR)

Prepared: 2026-07-30
Status: draft only, not sent

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

## Submission Gate

Do not send this draft or upload the icon without explicit approval at
action time. Verify the destination is official Zerion support and recheck the
contract address before submission.
