# CoinMarketCap Submission Pack — Inferno (IFR)

Updated: 2026-07-02

## Status

- CoinGecko / GeckoTerminal: done per project status; verified pool URL available.
- CoinMarketCap: ready to submit through the official request form.
- Official request URL: https://coinmarketcap.com/request/
- Direct CMC support URL: https://support.coinmarketcap.com/hc/en-us/requests/new?ticket_form_id=360000493112
- Required form choice: `1 - [New Listing] Add cryptoasset`
- Submission attempt note, 2026-07-02: automated/browser-agent submission is blocked by CoinMarketCap Cloudflare human verification. Final submission must be completed by Gio in a normal browser session with the official project account/email.

CoinMarketCap states that the online submission form is the only official way to request listings or updates. Do not use third-party listing agents or unofficial contacts.
CoinMarketCap also discourages duplicate requests. Submit once, then wait for the CMC response.

## Copy/Paste Submission

### Subject

Add cryptoasset: Inferno (IFR)

### Project / Token

- Project name: Inferno
- Token name: Inferno
- On-chain symbol: IFR
- Social cashtag: $IFRp (social communication only; not the on-chain token symbol)
- Network: Ethereum Mainnet
- Token standard: ERC-20
- Contract address: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Decimals: `9`
- Contract verified: yes
- Etherscan token page: https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- Etherscan contract page: https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code

### Official Links

- Website: https://ifrunit.tech
- Documentation: https://ifrunit.tech/wiki/
- GitHub: https://github.com/NeaBouli/inferno
- Whitepaper: https://ifrunit.tech/wiki/one-pager.html
- Security / audit docs: https://ifrunit.tech/wiki/security.html
- Token list: https://ifrunit.tech/token-list.json
- Well-known token list: https://ifrunit.tech/.well-known/token-list.json
- Logo: https://ifrunit.tech/assets/ifr_icon_256.png

### Market / Exchange

- Exchange: Uniswap V2 on Ethereum
- Pair: IFR/WETH
- Pair address: `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`
- Uniswap swap URL: https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- GeckoTerminal pool: https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0

If CoinMarketCap does not yet treat the Uniswap V2 pair as sufficient for a tracked listing, request an untracked/preview listing first and ask CMC to monitor the DEXScan/on-chain market data.

### Token Description

Inferno (IFR) is a deflationary Ethereum ERC-20 utility token for the IFR Protocol ecosystem. IFR is designed around irreversible supply reduction and on-chain access/utility flows. The token has no mint function; supply can only decrease. Non-exempt transfers apply a 2.5% burn of the transferred amount and a 1% protocol pool fee, with a hard-coded maximum fee cap. Governance is controlled by a 48-hour timelock Governance contract owned by the Treasury Safe.

Ticker clarity: `IFR` is the on-chain token symbol used by the contract, token lists, wallets, and DEX pools. `$IFRp` is used only as the project social cashtag to avoid unrelated ticker collisions on social platforms.

### Tokenomics / Supply

- Initial supply: `1,000,000,000` IFR
- Current total supply at block `25440410`: `997,769,355.2754488` IFR
- Burned since genesis: `2,230,644.724551201` IFR
- Minting: no mint function
- Deflation: yes, supply only decreases
- Transfer mechanics on non-exempt transfers:
  - `senderBurnBps = 200` (2.0%)
  - `recipientBurnBps = 50` (0.5%)
  - `poolFeeBps = 100` (1.0%)
  - total default fee: 3.5%
- Uniswap V2 pair is fee-exempt: swaps work without IFR transfer-fee distortion at the pair level.
- Governance owner: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`

### On-chain Verification Snapshot

Checked on Ethereum Mainnet at block `25440410`:

- Token name: `Inferno`
- Symbol: `IFR`
- Decimals: `9`
- Total supply: `997,769,355.2754488`
- Owner: `0xc43d48E7FDA576C5022d0670B652A622E8caD041`
- Uniswap pair fee-exempt: `true`
- Pool ETH reserve: `0.143261656128757442`
- Pool IFR reserve: `21,028,676.626442057`

### Additional Context

- Bootstrap finalised on 2026-06-05.
- Uniswap V2 LP is live at `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`.
- LP token fee exemption was executed through governance.
- P0 was set on CommitmentVault through governance.
- CommitmentVault and LendingVault are live on Ethereum Mainnet.
- Current live protocol locks/offers:
  - IFRLock locked: `2,000` IFR
  - CommitmentVault locked: `47,942,976.87179437` IFR
  - LendingVault available: `20,156,940.952845655` IFR
- Token list and logo are hosted on the official domain.
- The codebase, contracts, docs, and deployment references are public in the GitHub repo.

### Suggested Message Body

Hello CoinMarketCap team,

We would like to submit Inferno (IFR) for a new cryptoasset listing.

Inferno is an Ethereum Mainnet ERC-20 token deployed at `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`. The contract is verified on Etherscan, has 9 decimals, and has no mint function. IFR is deflationary: non-exempt transfers burn 2.5% of the transferred amount and route a 1% protocol pool fee, with a hard fee cap.

IFR is publicly tradable on Uniswap V2 through the IFR/WETH pair `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`. The pair is fee-exempt at the token-contract level so swaps work correctly. Official token metadata is available at `https://ifrunit.tech/token-list.json` and `https://ifrunit.tech/.well-known/token-list.json`, with logo at `https://ifrunit.tech/assets/ifr_icon_256.png`.

Ticker clarification: `IFR` is the on-chain symbol used by the contract, token lists, wallets, and DEX pools. `$IFRp` is used only as the project social cashtag to avoid unrelated ticker collisions on social platforms.

Official links:
- Website: https://ifrunit.tech
- Documentation: https://ifrunit.tech/wiki/
- GitHub: https://github.com/NeaBouli/inferno
- Etherscan token: https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- Uniswap swap: https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B
- GeckoTerminal pool: https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0

If IFR does not yet qualify for a tracked listing due to current DEX-only volume/liquidity, please consider creating an untracked/preview listing first and monitoring the on-chain Uniswap V2 market through DEXScan.

Thank you.

## Form Field Map

Use these values in the official request form:

- Request type: `1 - [New Listing] Add cryptoasset`
- Subject: `Add cryptoasset: Inferno (IFR)`
- Requester email/account: use the official project email/account controlled by Gio.
- Project name / asset name: `Inferno`
- Symbol / ticker: `IFR`
- Social cashtag / note field if available: `$IFRp is social-only; IFR is the on-chain symbol`
- Chain: `Ethereum`
- Token standard: `ERC-20`
- Contract: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Decimals: `9`
- Website: `https://ifrunit.tech`
- Explorer: `https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Source code: `https://github.com/NeaBouli/inferno`
- Whitepaper / docs: `https://ifrunit.tech/wiki/one-pager.html`
- Logo: `https://ifrunit.tech/assets/ifr_icon_256.png`
- Market pair: `IFR/WETH`
- Exchange / DEX: `Uniswap V2`
- Pool URL: `https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`
- Swap URL: `https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B`

## Submission Notes

- Submit only once. CoinMarketCap explicitly discourages duplicate requests.
- Use an official project email/account where possible.
- Do not contact CMC through unofficial channels.
- Do not use paid third-party listing intermediaries.
