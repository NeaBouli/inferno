# RPC, WalletConnect and Benefits Data Flows

Review date: 2026-10-23. Source revision:
`0c80df349bda926639a960d76927bde23778d7ac` (clean worktree before this report).

This is an offline, source-based privacy boundary review of `docs/assets/`
wallet/RPC code, the adjacent Web3 wallet runtime,
`infra/web3/walletconnect-provider`, `apps/data-api`, and Benefits partner/customer
persistence. It describes implemented paths, not verified production behavior.
No environment files, environment values, databases, backups, credentials or
external services were inspected. No application code was changed. Recommendations
below are proposals only; no deletion, migration or on-chain operation was run.

## Evidence and interpretation

- [Classic wallet runtime](../assets/wallet-core.js),
  [wallet state reads](../assets/ifr-state.js),
  [pool reader/calculator](../assets/liquidity-calculator.mjs),
  [liquidity gauge](../assets/liquidity-gauge.mjs), and
  [recent votes reader](../assets/recent-votes.js).
- [Web3 wallet runtime](../web3-wallet-core.js),
  [Web3 page](../web3/index.html),
  [Web3 service worker](../web3-sw.js), and
  [Web3 header configuration](../../infra/web3/web3-security-headers.conf).
- [WalletConnect build inputs and provenance](../../infra/web3/walletconnect-provider/README.md)
  and the committed
  [2.25.0 provider bundle](../assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js).
  Bundle observations below use identifiable functions/string literals rather
  than unstable line numbers in generated, minified code. The retained 2.17.3
  artifact is not the import selected by either current docs wallet runtime.
- [Data API routes](../../apps/data-api/server/index.ts),
  [RPC forwarding](../../apps/data-api/server/rpc.ts), and
  [request guards/cache](../../apps/data-api/server/request-guard.ts).
- [Benefits schema](../../apps/benefits-network/backend/prisma/schema.prisma),
  [checkout verification](../../apps/benefits-network/backend/src/services/sessionService.ts),
  [pass service](../../apps/benefits-network/backend/src/services/customerPassService.ts),
  [Model B deduplication](../../apps/benefits-network/backend/src/services/modelBDedup.ts),
  [retention implementation](../../apps/benefits-network/backend/src/services/retention.ts),
  and [retention runbook](../BENEFITS_RETENTION_RUNBOOK.md).

Wallet addresses are public-chain identifiers, but an association between an
address, a visitor IP, a shop and a checkout time is additional information.
Hashes, HMACs, opaque pass/session identifiers and outcome flags are not proof of
anonymity. This report does not make a legal compliance determination.

"Unknown" retention means source does not establish the duration or deletion
policy. A request timeout, HTTP cache lifetime, session expiry or Redis TTL is
not a promise that an operator or third party deletes logs, replicas or backups.

## Network envelope shared by the flows

| Connection | Recipient can observe | Limits on that observation |
| --- | --- | --- |
| Browser to an HTTPS endpoint | Visitor's network egress IP, time, requested host/path/query, browser HTTP user agent and applicable browser headers; request body if sent | VPNs/proxies may change the visible IP. Origin and Referer depend on request type and policy. URL fragments are not in ordinary HTTP request targets. |
| Browser to a WebSocket relay | Visitor's egress IP, handshake headers including Origin/user agent where supplied, URL/query, timing, subscriptions and message envelopes | WalletConnect encrypts session payloads between peers. Transport metadata remains visible to the relay. |
| Backend to RPC/explorer | Backend egress IP, server HTTP/client headers, request content and any configured provider credential | The inspected forwarding code does not copy the visitor's IP, browser user agent, signature or forwarded headers into these upstream calls. Timing and calldata still reveal which address was queried. |
| Browser to an injected wallet | Site origin, requested accounts/methods, message/transaction parameters; account and signature results return to the page | The extension/app chooses its own backend/RPC, telemetry and retention. The repository cannot inventory a user's wallet settings. No private wallet key is requested by these app paths. |

Benefits responses and the supplied Web3 nginx configuration set
`Referrer-Policy: no-referrer`; the Data API sets it on its JSON responses.
These are repository configurations, not observed response headers. The latter
does not control the referrer of the browser page that called the API. The apex
GitHub Pages surface cannot be assumed to inherit nginx headers. An explicit
JSON field containing `window.location.href` bypasses HTTP referrer minimization.

## Browser and third-party flows

| ID / trigger | Origin -> destination | Data sent or exposed | Retention / deletion visible in source |
| --- | --- | --- | --- |
| F01: page, script or PWA load | Visitor -> site hosting/CDN for `ifrunit.tech` or the selected Web3 host | Page/asset paths, IP, browser headers; no wallet address is required for static assets. Ethers and WalletConnect executable bundles are fetched from same-origin `/assets/vendor/`. | Browser HTTP caches and the Web3 `ifr-web3-*` CacheStorage persist assets until replacement/eviction/site-data clearing. Hosting/CDN log retention is unknown. Same-origin hosting removes a runtime JavaScript CDN fetch, not the SDK's own network calls. |
| F02: public and connected-wallet reads | Docs page -> `ethereum-rpc.publicnode.com`, `eth.drpc.org`, `1rpc.io/eth` | `eth_chainId`, block synchronization and public contract reads; for a connected address, `eth_getBalance` and calldata for `balanceOf`, `contributions`, `claimed`, `lockedBalance`, and page-specific contract reads. The recipient can associate the queried full address with the browser IP/time. | `ifr-state.js` keeps its result, including address and balances, in page memory and refreshes connected state every 60 seconds. Provider-side storage/log retention is unknown. Fallback synchronization contacts multiple endpoints; stalled requests can send the same lookup to additional providers. This is not a first-party-only RPC path. |
| F03: pool calculator/gauge mounted or refreshed | Browser -> `ethereum-rpc.publicnode.com` | Chain/block checks, fixed pool/token/feed addresses, reserve/fee-exemption and Chainlink contract calls. Entered IFR/ETH amounts are calculated locally against that snapshot, not included in `readPool` requests. No customer wallet or signature is needed. | Snapshot is in memory, with a 180-second freshness check. No calculator-input persistence is implemented in these modules. RPC retention is unknown. The feed is read through Ethereum RPC, not by contacting `data.chain.link`. |
| F04: extension connect, signing or transaction | Docs page -> injected EIP-1193 wallet -> wallet-selected services / Ethereum, when a transaction is broadcast | `eth_requestAccounts` / `eth_accounts`, chain switching, account selection; signing/transaction parameters from callers. `wallet_watchAsset` supplies public token metadata and an IFR icon URL, which the wallet may fetch. Page receives selected addresses, signatures or transaction hashes. | Classic wallet writes the full selected address to `ifr_wallet_connected` in localStorage without time expiry; reconnect migrates its legacy sessionStorage key. Disconnect removes that local key and clears page state. Web3 uses its separate session key and also removes its legacy sessionStorage key. Wallet storage/permissions are separate. A broadcast transaction and its recovered sender/data are public-chain records with no app deletion path. An off-chain signature alone is not a blockchain transaction. |
| F05: explicit WalletConnect connect, or saved-session recovery | Browser and chosen wallet -> `wss://relay.walletconnect.org` -> each other | Public project identifier, SDK/protocol user-agent marker, relay authentication JWT, client identity, topics/subscriptions, encrypted pairing/session/request envelopes and timing. Peers exchange app metadata (name, description, URL/icon), approved account addresses, chain/method permissions, messages, signatures and transaction results inside the session. | Browser SDK persists pairing/session/key material and history in its storage adapter (IndexedDB/localStorage paths are bundled). The SDK contains session/protocol expiry logic, including a seven-day session default; this is not a relay log-retention guarantee. App disconnect asks the provider to terminate the session; it does not establish erasure of every SDK key or relay log. Relay retention is unknown. |
| F06: WalletConnect origin verification | SDK/browser -> `verify.walletconnect.org` / `verify.walletconnect.com`, subject to browser/CSP and protocol path | Attestation requests contain project ID, page origin and message-derived IDs (`id`/`decryptedId`); iframe/fetch traffic exposes IP and browser headers. The inspected request builder does not send a raw signing message or signature in these attestation query parameters. | Unknown third-party retention. The supplied Web3 enforced CSP allows only the `.com` verify iframe; its report-only policy lists both domains. A bundled URL is not proof that every path succeeds. |
| F07: WalletConnect modal/catalog and optional chain helpers | Browser SDK -> `api.web3modal.org`, `rpc.walletconnect.org`, and modal assets/fonts at `fonts.reown.com` | Project ID, SDK type/version, chains, wallet search/filter parameters, requested wallet/asset image IDs and network metadata; helper RPC/address features can include an address if invoked. Font/image requests expose IP/user agent. `rpcMap` selects PublicNode for the docs Ethereum provider, but the bundled AppKit also has its own network/helper URLs. | Vendor/CDN retention is unknown; browser asset caches may persist. Do not assume every bundled auth/onramp/IPFS URL is exercised: no app-owned call site enabling those features was established. Reown fonts can be blocked by the supplied Web3 enforced font policy despite being present in its report-only policy. |
| F08: WalletConnect/Core telemetry and AppKit events | Browser SDK -> `https://pulse.walletconnect.org/batch` | Core event code constructs project/SDK identifiers, client ID, domain, SDK user-agent marker, event time and pairing topic/trace data. Separate AppKit events contain the full `window.location.href`, hostname, event properties and, for some connection events, the account address/chain. Its error path can include error message/stack. IP/user agent accompany the transport. These are distinct from encrypted peer session payloads. | Core event queue storage and submission paths are bundled; AppKit queues events and flushes via `sendBeacon`, including visibility/freeze triggers. Neither docs initializer sets `telemetryEnabled: false`; Core defaults it to true and the modal converter does not disable AppKit analytics. Vendor retention is unknown. Actual delivery, remote feature settings and exact event selection were not measured offline. See P1. |
| F09: font stylesheet/page load | Landing/wiki/Web3 HTML -> `fonts.googleapis.com` -> `fonts.gstatic.com` | CSS/font request, chosen font families, visitor IP and browser headers, and any referrer allowed by the containing page's policy. The HTML includes preconnects before wallet interaction. No app-added address/signature payload is present in these font URLs. | Third-party and browser-cache retention unknown. No Google Analytics tag was found in the reviewed assets/consumer pages; Google Fonts requests still exist. |
| F10: recent public vote rendering | Docs browser -> same-origin `../data/recent-votes.json` | Static request, IP/headers at the hosting boundary. Fetch uses `cache: no-store`, `credentials: omit`. Evidence/archive links contact GitHub only when followed. | No wallet-dependent browser state in this module. Host logs and GitHub retention are unknown. The static JSON request does not contact the Data API vote archive. |
| F11: mobile wallet handoff / external navigation | Visitor action -> `metamask.app.link`, `link.trustwallet.com`, `go.cb-w.com`, or external explorer/swap site | Web3 builds links containing the WalletConnect URI or destination dapp URL. A pairing URI includes session capability/key material and must not enter support logs or analytics. The wallet chooser can copy it to the OS clipboard. Explorer/swap links carry the selected public address/token parameters. | Link-service, wallet, clipboard and browser-history retention are outside app control. URI creation alone does not establish an HTTP request; opening a universal link may expose its URL to the handling service. Do not publish actual pairing URIs. The legacy `getDeepLink()` helper includes the current URL. |

F02 and F04 are separate: `ifr-state.js` deliberately uses `getReadProvider()`
even when a wallet is connected. Displaying a connected wallet's balances can
therefore disclose that wallet to the public RPC providers independently of the
wallet application's chosen RPC. The simple navigation/collapse modules and
`liquidity-depth.mjs` introduce no additional network destinations.

The project identifier in the docs initializers is public routing/configuration
metadata, not a wallet key. Its value is deliberately omitted here. Provider
URL values from environment configuration were not read or inferred.

## Data API: request, forwarding and persistence boundaries

The landing page names `https://copilot-api.ifrunit.tech` as its proxy base.
`apps/data-api` implements typed HTTP routes backed by RPC/explorer reads; it
does not mount a general client-controlled JSON-RPC proxy. HTTP callers can be
browser pages, SDKs or third-party integrations. Public data endpoints do not
require proof that the caller owns a queried address.

| Endpoint family | Caller -> Data API content | Data API -> downstream / returned content | Retention visible in code |
| --- | --- | --- | --- |
| `/api/health`, `/api/health/rpc`, `/` | Path and network/browser metadata; no wallet needed | RPC health sends `eth_chainId` to every configured/public endpoint. Output contains endpoint labels/booleans, not configured URLs or provider credentials. | Health RPC response is `no-store`. No request-history DB is implemented. |
| `/api/ifr/balances`, `/supply`, `/vault`, `/price` | Public aggregate request; no caller wallet needed | Fixed protocol address/token/pool reads through shared RPC; Etherscan queries supply, balances, logs or vault state as required. Response can contain protocol wallets, totals and public-chain values. | Aggregate process cache: 125 seconds of serving validity; old entries are not erased by a timer. These routes send `Cache-Control: no-store` to clients despite that internal cache. Background prewarming/refresh also causes upstream traffic without a visitor request. |
| `/api/ifr/txfeed`, `/transactions` | Page/limit parameters | Etherscan `txlist`/`tokentx` for a fixed set of protocol wallets, not a visitor-supplied wallet. Response contains transaction hashes, timestamps and amounts. | Parameter-keyed cache: 60 seconds fresh, up to 10 minutes stale on error, bounded to 200 entries. Old entries can remain resident until replacement/eviction/process exit. HTTP response: public, 30 seconds. |
| `/api/locks/events` | Page/limit/type and optional search `q`, which may itself be a wallet address | Etherscan gets fixed contract/event queries; `q` filtering occurs locally and is not inserted into the upstream URL. Results contain event wallets, amounts, hashes, block numbers and times. | Cache keys retain normalized `q`; 60-second freshness / 10-minute stale serving window, 500-entry bound. No timed physical purge. Public HTTP caching: 30 seconds. |
| `/api/builders/check/:address`, `/api/builders/count` | Full address in the check URL; endpoints depend on configuration | `isBuilder(address)` calldata through shared RPC; count is a constant-selector read. Response returns address/status or count. | No dedicated wallet-result process cache in the route; infrastructure logs unknown. |
| `/api/commitment/tranches/:address`, `/status/:address` | Full wallet in URL | Address-specific `getTranches`, `lockedBalance`, `hasActiveLock` and related public contract reads. Returns address, amounts and lock details. | `no-store` response; address still appears in the incoming request target and RPC calldata. No dedicated wallet-result process cache in these routes. |
| `/api/commitment/p0`, `/leaderboard` | Public request | Shared-RPC contract state. Leaderboard returns an empty individual list in this source, not a stored customer ranking. | P0 uses `no-store`; leaderboard advertises public caching for 60 seconds. No ranking database here. |
| `/api/lending/stats`, `/offers`, `/health/:loanId` | Public request or loan ID | Shared RPC reads protocol state/offers/loans; results can include public lender/borrower addresses and loan health. Loan ID is linkable to chain activity. | All three send `no-store`. No customer database; error/stdout and infrastructure retention unknown. |
| `/api/lending/loans/:address`, `/lender/:address` | Full wallet in URL | Lender lookup embeds the address in calldata. Loans route reads a bounded set of loans and filters borrower locally; that route does not put the visitor address into its upstream loan-read arguments. | Both wallet routes use `no-store`; URL/access-log exposure still applies. |
| `/api/ifr/check?wallet=...&required=...` | Full wallet and eligibility threshold in query | `balanceOf(wallet)` and `lockedBalance(wallet)` through RPC; returns balances, total and access tier. | Explicit `Cache-Control: public, max-age=30`; no route-owned DB persistence. Caches and logs can associate the lookup with visitor metadata. See P5. |
| `POST /api/builder/generate` | Product name/URL and access configuration in JSON | Local template generation/configuration scoring; returns submitted config, generated contract/SDK text. No LLM or external generation call in this handler. | Request memory only in application logic; log/proxy retention unknown. Avoid putting personal data or credentials into product fields. |
| `POST /api/chat`, `POST /api/bootstrap/vote` | Legacy requests | Stable 410 tombstones; no active chat-provider or vote-write flow in this app. | Does not create chat/vote records. |
| `GET /api/bootstrap/votes` | Public archive request | Loads historical address-keyed vote records into process memory from a configured encoded input or `ifr_bootstrap_votes.json`; publishes the latest ten truncated wallets, vote, ETH weight and timestamp plus totals. | Original source records contain full wallet map keys. No automatic expiry or archive deletion endpoint is implemented. Truncating output is not deletion of the stored input. Neither configured inputs nor archive contents were read. |

The shared upstream RPC list in `server/rpc.ts` consists of an optional
operator-configured HTTPS endpoint followed by:

- `https://ethereum-rpc.publicnode.com`
- `https://eth.drpc.org`
- `https://mainnet.gateway.tenderly.co`
- `https://eth-mainnet.public.blastapi.io`

Initial synchronization checks multiple endpoints, and fallback can repeat a
lookup after its stall timeout. Public fallbacks remain in the list even with a
configured endpoint; that endpoint alone is not the whole recipient set. RPC
providers receive contract addresses, method selectors/arguments, address-bearing
calldata and block/log parameters as applicable, under unknown retention.

The explorer destination is `https://api.etherscan.io/v2/api`. The backend adds
chain/query parameters and, if configured, its provider credential. Those calls
use the server IP/client headers; no forwarding of browser headers or customer
signatures was found. No vendor retention policy was consulted offline.

`SlidingWindowLimiter` holds client IPv4 addresses or IPv6 /64 prefixes and hit
timestamps in memory for feed throttling (60-second window, default maximum
50,000 keys). Expired keys are reclaimed on capacity pressure/reuse, not by a
background deletion timer. Process exit clears these maps. The app has no
general access logger, but raw `console.error(..., err)` calls exist in
wallet-reading handlers and can serialize provider error details/calldata. See
P5. Deployment/proxy/stdout log settings were not inspected live.

## Benefits: transient requests and additional recipients

| Flow | Origin -> destination / data | Stored versus transient |
| --- | --- | --- |
| Offer discovery | Browser/integrator -> `/api/businesses` and profile/rule/product routes; filters can include search/service area/category | Public profile/catalog results deliberately exclude owner wallets in the inspected discovery selects. Public discovery allows GET/HEAD CORS from any origin; these published fields are not private account data. Filters and visitor metadata still reach hosting/backend. |
| Customer proof | Customer browser -> `POST /api/sessions/:id/challenge`, `POST /api/attest`, or pass challenge/confirm routes | Claimed full wallet, signature, session/pass reference and signed offer context are processed. Wallet/signature travel in JSON bodies, not these URLs. Pass control token travels as Bearer authorization, not in the QR URL. Signature recovery is local. No raw customer signature, signed text, balance/lock amount, customer verification block or raw customer wallet is written by the current checkout service. |
| Eligibility RPC | Benefits backend -> provider selected by `RPC_URL` in `ifrLockService.ts` | Full customer wallet is an argument in IFRLock, CommitmentVault and token balance reads, depending on required eligibility sources. Backend IP/client headers accompany it. Signature and pass token are not forwarded. Backend initialization is a separate provider path from the Data API fallback list. Configured recipient and retention are unknown because configuration values were not read. |
| Seller/operator actions | Browser -> `/api/seller`, session creation/pass binding and authorized seller reads | Wallet, signature, timestamp and challenge nonce are sent via `x-ifr-*` headers or action JSON bodies. Target operator/reward wallets are in signed target/body fields. Auth-message requests are wallet-free; stored challenge scopes accept constrained IDs/slugs/fixed labels. Persisted seller identity is intentional, unlike transient customer proof identity. |
| Admin actions | Authorized operator -> `/api/admin` | Admin Bearer credential is verified; action/target/status and pseudonymous client metadata are recorded for audited writes. No admin credential, signature or full request body is part of `AdminAuditLog`. |
| Rewards/settlement verification | Benefits backend -> configured RPC; authorized operator -> settlement export | Seller owner/builder/beneficiary wallets, partner IDs, contract/code/governance reads and settlement state can reach RPC. Model B customer dedup is local HMAC, not an on-chain customer claim. Export loader reads seller confirmation audits and scoped customer keys; export hashing commits to keys without exporting the raw keys. Operator export includes reconciliation details; only `publicSummary` is intended as the aggregate public subset. No payment/broadcast was executed by this review. |
| Browser chain reads / connection | Benefits browser -> configured HTTPS public RPC or default PublicNode Mainnet/Sepolia endpoint; injected wallet, Coinbase or WalletConnect | [Wagmi configuration](../../apps/benefits-network/frontend/src/lib/wagmi.ts) explicitly sets `telemetryEnabled: false` for WalletConnect Core and Coinbase `preference.telemetry: false`. SDK connectors are deferred until selection or restoration of their saved active session by [deferUntilChosen](../../apps/benefits-network/frontend/src/lib/deferredWalletConnector.mjs). These controls do not prove all upstream AppKit initialization events are disabled after SDK activation. Coinbase connection services include walletlink/its wallet RPC domains in the configured policy; exact wallet-side traffic/retention is unknown. |
| API hosting hop | Benefits browser -> same-origin `/api` rewrite -> backend, or configured API base | [API client](../../apps/benefits-network/frontend/src/lib/api.ts) and [Next configuration](../../apps/benefits-network/frontend/next.config.js) support either path. Frontend/proxy/backend may observe headers, body and IP. No assumption about an actual configured host or log duration is made. The detailed connect/font policy in Next is report-only; it is not an enforced block of omitted telemetry hosts. |
| Seller logo load | Browser -> arbitrary HTTPS `Business.logoUrl` destination | [BusinessLogo](../../apps/benefits-network/frontend/src/components/BusinessLogo.tsx) uses a normal image request with `referrerPolicy="no-referrer"`. Recipient sees visitor IP/user agent, resource path/query and any browser-permitted cookies. No wallet is explicitly appended. HTTPS/no-credentials validation does not make the logo host a first party or remove tracking potential. |

### Browser-local Benefits data

[Customer proof history](../../apps/benefits-network/frontend/src/lib/customerHistory.ts)
keeps at most 12 receipts under `ifr.shop.customerProofHistory.v1`: checkout and
business references, offer/outcome/time metadata, signed message containing the
full wallet, and signature. There is no time-based deletion; replacement, clear
history, local-data controls or browser site-data removal deletes the local copy.
It is not uploaded as customer history: the old server history/challenge/access
routes return 410. Signing/proof submission itself still sends the signature to
the backend for the current request.

An active customer pass ID/control token is kept in this tab's sessionStorage
under `ifr.shop.activeCustomerPass`; ending/clearing the pass or closing the tab
removes that copy. Role, last business and recent checkout references also use
`ifr.shop.*` storage. [LocalDataControls](../../apps/benefits-network/frontend/src/components/LocalDataControls.tsx)
clears that prefix and `ifr-benefits-*` caches. It intentionally does not erase
Wagmi/WalletConnect/provider storage, disconnect wallet permissions, or erase
server/on-chain data. Receipt signatures, pass tokens and pairing URIs must not
be pasted into analytics/support exports.

## Benefits database field inventory and minimality

This inventory covers every current Prisma model and scalar field. Relation
properties/indices are not additional stored copies. Fields without a direct
identifier can still become personal or commercially sensitive when joined to a
seller wallet, checkout, public chain event or physical visit. No schema field
requires a customer name, email, phone, postal address, IP or user agent; optional
free text can nevertheless contain such information.

Retention codes used below:

- **R1:** No hard-delete/anonymization path or duration in the reviewed app.
  Seller DELETE actions set `active=false` for businesses/operators/products/
  rules; they preserve rows and dependent history. Profile fields can be edited,
  but that is not guaranteed erasure from backups or prior snapshots.
- **R2:** Sessions, session audits, reward events and linked passes are explicitly
  protected by `retention.ts`. Expiry/redemption/cancellation ends authority or
  changes status; it does not delete the record. No approved duration in code.
- **R3:** Eligible for manual retention CLI after the operator-selected cutoff.
  No automatic schedule or fixed retention days. Admin report is count-only;
  apply requires explicit confirmation and bounded batches (default 1,000,
  maximum 10,000 per table per invocation).
- **R4:** Expired seller challenges can also be pruned opportunistically on new
  issuance (up to 100); otherwise R3. Consumption stamps the row, not deletion.

"Necessary" below means a concrete current function uses the field, not that
unlimited retention is justified. "Optional" means it is not needed for a basic
wallet eligibility check. **Beyond minimum** identifies an additional privacy
purpose or excess lifetime that needs a bounded justification.

| Model and exact fields | Personal/wallet association and purpose | Minimality; retention/deletion |
| --- | --- | --- |
| `Business.ownerAddress` | Full seller owner wallet: ownership authorization, seller limits, reward verification and seller-controlled-wallet detection. | Necessary for wallet-managed seller accounts; R1. Not a customer wallet field. |
| `Business.id`, `slug`, `createdAt` | Stable seller/profile references and onboarding time, joinable to owner wallet; slug is also a public directory URL. | ID needed; slug useful for routing; timestamp supports operations. R1; publishing a name-bearing slug is optional identity exposure. |
| `Business.name`, `description`, `website`, `logoUrl`, `serviceArea`, `serviceAreaKey`, `categoriesJson` | Public directory identity/profile, location-like service-area text and its normalized search key, categories and external resource URLs. A sole trader's name/website can identify a person. | Name/catalog context is functional; description/website/logo/service area/categories are optional discovery features. **Beyond minimum** for eligibility; avoid contact details, precise home locations, trackers or embedded identifiers. R1; profile edit can replace/null optional values. |
| `Business.discountPercent`, `requiredLockIFR`, `ttlSeconds`, `tierLabel`, `active` | Seller benefit configuration and lifecycle status; label may contain personal text if entered. | Necessary configuration except optional label; R1. `active=false` hides/disables the profile without erasing owner/profile. |
| `Product.id`, `businessId`, `name`, `category`, `description`, `basePriceMinor`, `currency`, `active`, `createdAt`, `updatedAt` | Seller-linked catalog identity/content/price and operational timestamps. Name/description can contain personal text; session snapshots later copy selected product terms. | Necessary for catalog, optional for basic lock verification; description optional. R1; deactivation preserves row and historic session terms. |
| `CheckoutOperator.walletAddress`, `label` | Full staff/operator wallet and optional human-readable staff label. | Wallet necessary for delegated checkout authority. Label is optional and **beyond minimum** if it identifies staff by real name; use role/station labels. R1, including expired/deactivated operators. Historic operator wallets are also used for seller-controlled-wallet detection and settlement confirmation checks. |
| `CheckoutOperator.id`, `businessId`, `active`, `expiresAt`, `createdAt`, `updatedAt` | Join from staff wallet to shop, permission validity and change history/replay guards. | Functional authorization metadata; R1. `expiresAt`/DELETE do not remove wallet or label. |
| `BenefitRule.id`, `businessId`, `productId`, `label`, `category`, `productName`, `createdAt`, `updatedAt` | Seller/product associations and potentially identifying free text copied into checkout snapshots. | Functional offer identity; optional text must remain generic catalog content. R1. Product relation uses `onDelete: SetNull`, not a retention workflow. |
| `BenefitRule.discountPercent`, `requiredLockIFR`, `minIFRHeld`, `lockSource`, `dailyRedemptionLimit`, `monthlyRedemptionLimit`, `ttlSeconds`, `active` | Offer thresholds, qualifying source, lifetime and state, not measured customer balances. Customer limits are constrained to zero by current create/update routes. | Configuration, not a reason to retain customer identity. R1. Do not interpret these schema limit fields as an implemented per-customer history. |
| `Session.confirmedByWallet`, `confirmedByRole`, `confirmedByOperatorId` | Full seller wallet, role and operator reference that authorized session opening/pass binding; rechecked at redemption and used as confirmation evidence. | Necessary seller accountability for current design; R2. **Beyond minimum** to retain full seller attribution forever after the replay/settlement/audit window. |
| `Session.id`, `businessId`, `benefitRuleId`, `nonce`, `customerPassId` | Opaque single-checkout nonce/references, including linkage to a customer-controlled pass. These link checkout records even without a customer wallet column. | Necessary checkout/proof binding; R2. `nonce` is not the customer's signature. Pass linkage is optional to the selected checkout presentation. |
| `Session.benefitSnapshotVersion`, `benefitLabel`, `benefitCategory`, `benefitProductName`, `benefitBasePriceMinor`, `benefitCurrency`, `benefitDiscountPercent`, `benefitRequiredLockIFR`, `benefitMinIFRHeld`, `benefitLockSource`, `benefitTtlSeconds`, `benefitDailyRedemptionLimit`, `benefitMonthlyRedemptionLimit` | Frozen merchant offer terms needed to bind the signed checkout; product/category/price can reveal a purchase context when linked by time/shop/pass. Values are terms, not the customer's measured holdings. | Necessary exact-offer proof data; R2. Optional catalog text increases replicated identity exposure. **Beyond minimum** after a defined merchant dispute/reconciliation period unless a specific purpose remains. |
| `Session.status`, `expiresAt`, `createdAt`, `updatedAt`, `redeemedAt`, `attestAttempts`, `reason` | Checkout lifecycle, timing and outcome; `reason` currently receives controlled lifecycle/cancellation text rather than wallet/balance diagnostics. | Needed for single use and operational history; R2. Precise historical time plus shop/offer can identify a visitor externally. Retention is not bounded by the short checkout TTL. |
| `Session.verifiedLockSource`, `selfRedemption`, `proofVersion` | Successful proof outcome: qualifying source, seller-controlled-wallet boolean, proof format. These are customer-derived facts despite lacking a raw address. | Needed for proof interpretation and reward policy; R2. They are not anonymous aggregate counts. **Beyond minimum** to preserve linked outcomes without a defined audit window. |
| `CustomerPass.id`, `controlHash` | Random pass ID and SHA-256 of a random, high-entropy control token; grants/verifies control of one checkout, not a persistent customer account. | Necessary for the pass capability; no raw token, wallet or signature column. R3 only for expired unlinked passes in OPEN/CANCELLED/EXPIRED state; R2 for all session-linked passes. A linked hash remains after its capability expires. |
| `CustomerPass.status`, `expiresAt`, `boundAt`, `cancelledAt`, `createdAt`, `updatedAt` | Pass/checkout lifecycle and timing, indirectly linkable to a person. Initial validity is five minutes; binding aligns expiry with the checkout. | Necessary lifecycle metadata; same R2/R3 distinction. Expiry is not deletion. |
| `SellerRewardLink.builderWallet`, `rewardWallet`, `rewardWalletConfirmedAt` | Full seller/builder and optional separate payout wallet; confirmation time binds seller intent to beneficiary verification. | Necessary only for the optional rewards feature; **beyond minimum** for a shop that only checks eligibility. R1; reward wallet can be changed/reset by the authorized flow, but no complete reward-link erasure path is present. |
| `SellerRewardLink.id`, `businessId`, `partnerId`, `status`, `requestedAt`, `verifiedAt`, `lastCheckedAt`, `verificationBlock`, `createdAt`, `updatedAt` | Link from shop/wallet to a partner record and verification history; block is seller verification evidence, not a customer eligibility block. | Rewards/reconciliation metadata; R1. Disabling/revoking changes state, not erasure. |
| `SellerRewardLink.governanceReference`, `reason` | Optional governance reference (free text) and verification/policy diagnostic. Can associate public governance and seller identity. | Reference is optional and **beyond minimum** if it includes private notes or identifiers. Reasons should stay controlled and redact upstream details. R1; overwrites do not establish backup erasure. |
| `RewardEvent.rewardDedupKey`, `rewardPeriod` | Customer-wallet-derived, keyed HMAC with chain/vault/partner/month scope and rotation tag; monthly UTC `YYYY-MM` period. Enables one eligible reward per wallet/partner/month, without storing raw customer wallet. | **Beyond the no-customer-derivative baseline**, but functionally needed for the conditional Model B dedup purpose. It is a pseudonym, not anonymous data. Scope prevents direct cross-partner/month equality; a secret holder with candidate wallets can recompute it. R2, with no key/row expiry implemented. |
| `RewardEvent.id`, `businessId`, `sessionId`, `partnerId`, `chainId`, `status`, `reason`, `txHash`, `createdAt`, `updatedAt` | Merchant/customer-checkout-to-reward linkage, reward policy/accounting outcome and optional public settlement transaction link. Current redemption creates an event status/reason and optional dedup fields; presence of `txHash` does not prove current broadcast or stored customer payment. | Necessary only for rewards/accounting. R2; **beyond minimum** for basic eligibility and if retained indefinitely after reconciliation. These fields can associate a pseudonym with shop/checkout details. |
| `AuditLog.id`, `sessionId`, `type`, `payload`, `ts` | Session-linked audit trail. Current payloads include `createdBy.walletAddress`, `createdBy.role`, `createdBy.operatorId`, or `actorWallet`, `actorRole`, `operatorId`, plus business/rule/pass references, redemption time, confirmation mode and proof/source/self-redemption outcomes or fixed reasons. | Necessary confirmation evidence for current settlement checks; R2. JSON has no schema-level whitelist: preserve the current restriction excluding customer wallet/signature/balance/block and avoid arbitrary request/error objects. Seller wallet copies are intentional evidence, but indefinite duplicate retention needs a purpose. |
| `AdminAuditLog.actorDigest`, `clientDigest` | `actorDigest` hashes the fixed primary-admin role marker, not a person/credential. `clientDigest` is unsalted SHA-256 of a fixed prefix plus `request.ip`; it is an IP-derived identifier susceptible to candidate enumeration. CLI pruning uses fixed local-operator markers. | Audit attribution is functional; stable unkeyed client hashing is **beyond minimum** protection against reidentification (P4). R3; no automatic SQLite TTL. |
| `AdminAuditLog.id`, `action`, `method`, `routeTemplate`, `targetType`, `targetId`, `statusCode`, `createdAt` | Administrative action/time linked to resource IDs and therefore seller/checkout records. Route templates avoid ordinary resource IDs in the route field; target IDs preserve intended association. Retention CLI records its cutoff as target ID. | Necessary action audit metadata; R3. Do not insert request bodies, raw credential headers, IPs or unrelated free text into these fields. |
| `SellerAuthorizationChallenge.nonce`, `action`, `businessId`, `scope`, `expiresAt`, `consumedAt`, `createdAt` | Nonce and action/shop/target references, not wallet-derived identity. Scope is constrained to expected IDs/slugs/fixed labels; owner/operator target wallets are bound by the submitted signature, not this row. | Necessary single-use replay control, with a short authorization validity window; R4/R3. A row can still be linked to a seller by business ID. |

There is no current `Customer`, customer-history-access or customer-wallet table.
The privacy migration removes earlier customer columns/tables and scrubs legacy
audit fields. This does not negate the later conditional Model B HMAC fields.
Nor does it establish deletion from historical SQLite pages, WAL/SHM, backups or
exports. [The migration runbook](../BENEFITS_CUSTOMER_PRIVACY_MIGRATION.md)
acknowledges older backups containing customer wallets, amounts and history
tokens and requires owner-controlled expiry. This review did not verify a live
migration, backup inventory, deletion or `VACUUM` result.

### Non-Prisma storage that must accompany a deletion policy

- Benefits public rate limits store IP/IPv6-prefix counters and pass-ID plus
  authorization-digest counters, in process memory or configured Redis.
  [Authenticated seller limits](../../apps/benefits-network/backend/src/services/authenticatedRateLimiter.ts)
  additionally use the normalized full seller wallet as a key. Redis fixed-window
  keys expire after one hour; memory entries can survive expiry until revisited,
  capacity cleanup or process exit. Redis persistence/backup settings are unknown.
- Proxy/hosting logs may contain IP/user agent, paths, pass/session IDs and,
  for the Data API wallet endpoints, queried wallets. Logging authorization
  headers/bodies would also capture proof signatures or pass/admin credentials;
  no such general request logger was found in the reviewed app code, and
  infrastructure behavior remains unverified.
- Seller session CSV/downloads, operator settlement exports, local receipts,
  static-site caches and the Data API vote archive have separate lifecycles.
  Database erasure alone cannot promise their deletion. No copies were opened
  or created during this review.

## Findings and recommendations

Severity here measures the demonstrated source-level privacy impact, not legal
liability. All findings below have source evidence; deployment-specific delivery
and retention questions are listed separately. No High or Critical issue was
established in this bounded review.

### P1 — Medium: wallet SDK analytics add a plaintext identity/context recipient

**Evidence:** Both docs `EthereumProvider.init` calls omit
`telemetryEnabled: false`. In the pinned bundle, Core event-client constructors
default that flag to true. `convertWCMToAppKitOptions` constructs modal features
without an analytics opt-out. AppKit `sendEvent`, `_setPendingEvent` and
`_submitPendingEvents` construct plaintext analytics carrying full page URL,
domain and, for connection events, an address, and submit it to Pulse. This is
an additional identity/context path beyond the encrypted relay session. Even
the bundle's Core INIT method lacks a telemetry flag guard, and AppKit permits
some initialization/connection events independently of its analytics flag.

**Recommendation:** Inventory and disable both optional Core and AppKit analytics,
and avoid placing checkout identifiers/capabilities in SDK event URLs. Do not
claim that one telemetry flag guarantees zero events. Choose a provider/modal
configuration or reviewed version that can enforce the intended boundary, or
explicitly disclose unavoidable events before activating it. Preserve the
Benefits deferred-connector protection. Validate explicit connect, reconnect,
cancel, errors and visibility changes with a local request-capture fixture,
checking that no address, signature, pairing URI or sensitive URL reaches
analytics. Actual successful requests and vendor retention remain unverified.

### P2 — Medium: customer reward pseudonyms and seller checkout records have no end-of-life

**Evidence:** `RewardEvent.rewardDedupKey` is derived from a customer wallet and
joined through `sessionId` to merchant/time/offer data. `retention.ts` protects
all reward events, sessions, session audits and linked passes. Seller and staff
wallet records are soft-deactivated and have no erasure path. This preserves
linkable data beyond minute-long authentication/checkout validity and beyond
the month used to scope reward equality; no maximum duration is implemented.

**Recommendation:** Approve separate replay, merchant dispute, reward
reconciliation and audit windows; then design a bounded expiry/anonymization
path for each protected class, including HMACs and linked pass control hashes.
Keep minimal non-identifying replay/settlement evidence where needed. Include
inactive operator/profile records, exports, SQLite artifacts, Redis persistence
and backups. Define the verification/support process for deletion without
collecting a new permanent customer identity. Do not delete financial evidence
or rotate dedup keys during an active period without a reviewed migration;
`modelBDedup.ts` deliberately blocks a mid-period key change.

### P3 — Low: Benefits privacy statements exclude data the implementation can retain

**Evidence:** `frontend/src/app/privacy/page.tsx` says no wallet hash/fingerprint
is retained and rate limits are never keyed by wallet. The conditional Model B
path persists `rewardDedupKey`; authenticated seller limiting uses the full
seller wallet in memory/Redis. The page also says signatures travel only in
bodies, while seller authorization supports `x-ifr-signature` headers. These are
verifiable source/copy mismatches, independent of current pilot activation.

**Recommendation:** State the customer-versus-seller distinction, the optional
partner/month HMAC purpose, protected-record retention, seller wallet counters,
and body/header transport accurately. Say that ordinary checkout drops the raw
customer address and signature after verification while conditional reward
dedup can retain a scoped pseudonym. Update truth assertions to cover both
branches. This report does not change public copy or infer whether Model B is
enabled in a deployment.

### P4 — Low: an unkeyed admin IP digest is readily recomputable

**Evidence:** `adminAudit.ts` computes
`SHA256("admin-client:" + request.ip)`. A reader of the audit table can enumerate
candidate IPv4 or known office addresses offline and correlate admin actions.
There is no keyed secret or per-period salt in that derivation. The hash should
not be treated as anonymous client data.

**Recommendation:** If network attribution is necessary, use a purpose-scoped,
rotating keyed digest and bounded audit retention, or omit the client value if
the role/action/resource audit is sufficient. Keep the fixed role digest
separate from the client digest. Do not use an unkeyed address hash as a general
substitute for personal-data deletion. No production secret changes are part
of this task.

### P5 — Low: wallet lookup URLs, HTTP caching and raw error logs broaden lookup exposure

**Evidence:** Data API wallet endpoints put addresses in paths or the
`/api/ifr/check` query; lock-event search can carry a wallet in `q` and its cache
key. `/api/ifr/check` advertises public caching for 30 seconds. The queried
chain data is public, but which visitor requested which wallet is not inherent
in the chain. Handlers such as `CV tranches error` and `IFR check error` pass
whole provider errors to stderr; such errors can contain address-bearing
calldata/request objects. Exact production log contents/retention are unknown.

**Recommendation:** Offer a POST/body-based wallet lookup with `private,
no-store` while handling compatibility deliberately; minimize or redact query
targets in proxy logs. Replace raw upstream error objects with fixed operation,
provider-label and safe error-code fields. Never log signatures, full calldata,
credential-bearing URLs or request headers/bodies. The Benefits proof service
already catches eligibility failures and replaces them with fixed error text;
reuse that principle. Changing transport alone cannot hide the address from
the RPC provider that must execute the lookup.

### P6 — Informational: optional presentation and local storage exceed a bare eligibility check

**Evidence:** Google Fonts/preconnects, arbitrary HTTPS seller-logo requests,
public profile free text, indefinite docs wallet localStorage and local signed
customer receipts are additional data surfaces. `BusinessLogo` already sets
`referrerPolicy="no-referrer"`; no missing-policy defect is claimed there.

**Recommendation:** Prefer self-hosted fonts and validated first-party logo
uploads where feasible; describe remaining external requests. Keep profile and
staff labels optional and discourage personal contact/location data. Consider
an expiring remembered-wallet marker and an explicit remember-receipts choice.
Explain that the existing local-data button clears app-prefixed data, while
provider/session storage requires wallet disconnect and/or browser site-data
controls. These are minimization options, not demonstrated account compromise.

## Open validation items and scope limits

The following have no assigned vulnerability severity because the decisive
operational evidence was not available offline:

- Actual configured RPC/API recipients, WalletConnect project restrictions,
  enabled chains/pilot features and deployed bundle versions. Inspect approved
  configuration names/host allowlists with the owner without exporting values.
- Effective response headers, browser permissions/SDK storage backend and exact
  requests on all desktop/mobile connect/reconnect/error paths. Verify in an
  isolated local fixture with synthetic identities; distinguish attempted,
  CSP-blocked and delivered requests. Report-only CSP is not enforcement.
- RPC/WalletConnect/Reown/Google/hosting log retention, locations/subprocessors,
  deletion mechanisms, and wallet-vendor policies. Obtain current provider
  evidence separately; the repository supplies no defensible retention number.
- Production log/header/body capture, Redis persistence, retention job execution,
  migration state, SQLite/WAL copies, old backups and exported CSV/settlement
  copies. Have an authorized operator inventory them and record approved expiry
  and deletion evidence; this report does not authorize that operational work.

Contracts, unrelated applications, deployed authorization controls and legal
compliance were not audited. The findings are a bounded privacy review of the
named source surfaces, not a claim of exhaustive security coverage.
