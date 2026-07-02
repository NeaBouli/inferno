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

## Exact CMC Form Values

Use these values for the current CoinMarketCap form.

### Identity / Request

- Your email address: `kaspartisan@proton.me`
- Subject Field: `Inferno - IFR - Add cryptoasset`
- Terms & Conditions: check / accept.
- Relationship with the Project: `Founder / core developer / official representative of Inferno Protocol.`
- Project Launch Date: `05/03/2026 - Inferno token deployed on Ethereum Mainnet. Evidence: https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code`
- Project Name: `Inferno`
- Project Ticker/Symbol: `IFR`

### Categories

Suggested Cryptoasset Tags:

- `DeFi`
- `Ethereum Ecosystem`
- `DAO`
- `Governance`
- `DApp`

If the form has stricter choices, prioritize `DeFi`, `Ethereum Ecosystem`, and `Governance`.

### Descriptions

One-liner description:

```text
Inferno is a deflationary Ethereum utility token for lock-to-access products, commitment locks, and IFR-backed lending flows.
```

Detailed Project Description:

```text
Launched on 05/03/2026, Inferno is an Ethereum Mainnet ERC-20 utility token for the IFR Protocol ecosystem. The token's on-chain symbol is IFR. The project uses $IFRp only as a social cashtag to avoid unrelated ticker collisions on social platforms.

Inferno is designed around deflationary token mechanics and on-chain utility flows. The token has a fixed genesis supply of 1,000,000,000 IFR, uses 9 decimals, and has no mint function. Supply can only decrease. Non-exempt transfers burn 2.5% of the transferred amount and route a 1% protocol pool fee. Certain protocol contracts and the Uniswap V2 pair are fee-exempt where required for correct operation.

The core utility model is lock-to-access. Users can lock IFR in IFRLock to prove on-chain access status for premium features and ecosystem products. The protocol also includes CommitmentVault, where users can create time- or price-conditioned token lock tranches, and LendingVault, where lenders can offer available IFR and borrowers can use ETH collateral in the protocol's lending flow.

Inferno was launched without a presale, VC round, private sale, or IDO. The Bootstrap event finalized on 05/06/2026 and created the live Uniswap V2 IFR/WETH pool. The token contract, governance contract, vaults, and related protocol contracts are verified on Etherscan. Governance actions are controlled by a 48-hour timelock Governance contract owned by the Treasury Safe.

The project maintains public documentation, token metadata, security documentation, live transparency pages, and open-source code. Official resources include the website at https://ifrunit.tech, documentation at https://ifrunit.tech/wiki/, source code at https://github.com/NeaBouli/inferno, and the verified token contract at https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B.
```

### Chain / Contract

- Platform: `Ethereum`
- Chain Fork: `NA`
- Link to Logo: `https://ifrunit.tech/assets/ifr_icon_256.png`
- Website 1: `https://ifrunit.tech`
- Website 2: `https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0`
- Platform of Contract Address 1: `Ethereum`
- Contract Address 1: `0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Number of Decimals: `9`
- Block Explorer 1: `https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B`
- Add Contract Address 2: leave unchecked / `NA`.
- Block Explorer(s) 2, 3, 4, 5: `NA`

### Links / Socials

- Source Code: `https://github.com/NeaBouli/inferno`
- Whitepaper / Technical Documentation: `https://ifrunit.tech/wiki/one-pager.html`
- Announcement: `https://t.me/IFRtoken`
- Message Board 1: `https://ifrunit.tech/wiki/`
- Message Board(s) 2, 3, 4, 5: `https://paragraph.com/@0x6b36687b0cd4386fb14cf565b67d7862110fed67/the-ifr-fair-launch-story-%E2%80%94-from-code-to-community`
- Twitter: `https://twitter.com/IFRtoken`
- Reddit: `NA`
- Facebook: `NA`
- LinkedIn: `NA`
- Chat 1: `https://t.me/IFRtoken`
- Chat(s) 2, 3, 4, 5: `https://t.me/IFR_token`
- Video Channel: `NA`
- Mobile App 1: `NA`
- Mobile App(s) 2, 3, 4, 5: `NA`

### Supply

- Circulating Supply: `997769355.2754488`
- Total Supply: `997769355.2754488`
- Max Supply: `1000000000`
- Total Supply API endpoint: `NA`
- Circulating Supply API endpoint: `NA`

Supply note for proof/supporting evidence:

```text
Live total supply is available through the official project API at https://copilot-api.ifrunit.tech/api/ifr/supply, but the endpoint returns a JSON object rather than only a raw numerical value. Therefore the CMC supply endpoint field is marked NA, and the exact live supply is provided in the form and proof section.
```

### Markets / Priority

- List of CMC-supported exchanges:

```text
Uniswap V2 IFR/WETH pool: https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0, Uniswap swap URL: https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B
```

- CMC Priority (CMCP): `No` unless Gio explicitly wants paid priority.

### Optional / Required Project Details

- Media Coverage/Awards: `NA`
- Country of Origin: `Greece` if accurate; otherwise replace before submitting.
- Team/Backers/Investors:

```text
Inferno is an open-source, community-driven project. It launched with no presale, no VC round, no private sale, and no IDO. Core development and protocol documentation are maintained publicly through the GitHub repository. Governance is controlled by the verified Governance contract with a 48-hour timelock and Treasury Safe ownership.
```

- Traction/Adoption/Partnerships/MVPs/Apps:

```text
Inferno has verified Ethereum Mainnet contracts, a live Uniswap V2 IFR/WETH pool, live IFRLock access locks, live CommitmentVault locks, and an active LendingVault offer flow. Current live protocol values include 2,000 IFR locked in IFRLock, 47,942,976.87179437 IFR locked in CommitmentVault, and 20,156,940.952845655 IFR available in LendingVault. The project also operates public documentation, token lists, a transparency page, AI Copilot context, and social automation for the official @IFRtoken account.
```

- Annex A - Rich List & Reserve Addresses: `NA` for initial submission unless Gio prepares the CMC Google Sheet.
- Emission/release schedule: `NA` for initial submission unless Gio prepares Annex M. Note in proof that max supply is fixed and no mint function exists.
- Hashing/Consensus Algorithm: `Ethereum Proof-of-Stake`
- ICO/IEO Start Date: `NA`
- ICO/IEO End Date: `NA`
- ICO/IEO/Launch Price: `NA`
- Dofollow linkbacks to CMC: `Yes` if Gio is willing to add the footer/linkback later; otherwise `No`.
- Marketing consent: Gio preference.
- SRD Application: `Yes` if Gio wants official representative onboarding after application; otherwise `No`.
- Interested in CMC Boost: `No` unless Gio explicitly wants paid visibility.

### Public Verification Post

Actual public verification post from the official X account:

- Ticket: `1390230`
- URL: `https://x.com/IFRtoken/status/2072445000961474600`

Posted text:

```text
CMC verification for Inferno.

Ticket: 1390230
Token: Inferno
On-chain symbol: IFR
Social cashtag: $IFRp

Official site:
https://ifrunit.tech

Contract, metadata, docs, and explorer proof are on the official site and in the CMC ticket.

CMC DexScan: not available yet
```

Note: X rejected a version containing the raw Ethereum address with `Crypto addresses are prohibited for the first 7 days after authentication.` The CMC email reply should therefore include the public post URL plus the official website, Etherscan token URL, verified source URL, token metadata, and Uniswap/GeckoTerminal links as proof.

### Proof / Supporting Evidence

```text
Official website and ticker clarity:
https://ifrunit.tech

The landing page states that IFR is the on-chain token symbol and $IFRp is used only as the social cashtag. Technical token metadata, wallets, token lists, and DEX pools use IFR.

Verified Ethereum token contract:
https://etherscan.io/token/0x77e99917Eca8539c62F509ED1193ac36580A6e7B

Verified source code:
https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code

Official token metadata:
https://ifrunit.tech/token-list.json
https://ifrunit.tech/.well-known/token-list.json

Official logo:
https://ifrunit.tech/assets/ifr_icon_256.png

Official documentation:
https://ifrunit.tech/wiki/
https://ifrunit.tech/wiki/one-pager.html
https://ifrunit.tech/wiki/security.html
https://ifrunit.tech/wiki/transparency.html

Open-source repository:
https://github.com/NeaBouli/inferno

Live Uniswap V2 pool:
https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0

Live supply API:
https://copilot-api.ifrunit.tech/api/ifr/supply

Current live supply snapshot at block 25440410:
Total supply: 997,769,355.2754488 IFR
Burned since genesis: 2,230,644.724551201 IFR

Protocol utility snapshot:
IFRLock locked: 2,000 IFR
CommitmentVault locked: 47,942,976.87179437 IFR
LendingVault available: 20,156,940.952845655 IFR
```

- Privacy Notice: check / accept.
- Attachments: optional. If needed, attach logo PNG and screenshots of website/token page.

## Submission Notes

- Submit only once. CoinMarketCap explicitly discourages duplicate requests.
- Use an official project email/account where possible.
- Do not contact CMC through unofficial channels.
- Do not use paid third-party listing intermediaries.
