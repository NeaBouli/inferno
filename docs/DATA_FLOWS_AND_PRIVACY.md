# Data Flows and Privacy

Repository review: 22 October 2026. This describes the checked-in code, not
observed production traffic or a legal privacy notice. No network requests
were made for this review. Environment-selected endpoints, provider retention,
hosting access logs and backup lifetimes are unknown unless stated below.

## RPC recipients

RPC requests include the chain, method and parameters: contract addresses,
wallet addresses encoded in read calldata, block identifiers and log filters.
Read-only calls can disclose a wallet without a signature or transaction.
Browser RPC connections expose the browser's network address to the endpoint;
server RPC calls originate from the server. Wallet-managed transaction
submission uses the wallet's configured provider, which this repository cannot
identify. RPC-provider logging and deletion policies are unknown here.

| Caller | Configured recipients and data | Source |
| --- | --- | --- |
| Landing/Wiki and Web3 wallet cores | Mainnet reads through `https://ethereum-rpc.publicnode.com`, `https://eth.drpc.org`, `https://1rpc.io/eth`; chain checks and fallback can contact multiple endpoints. WalletConnect's explicit Mainnet `rpcMap` uses the first URL. Balance, lock, tranche and other contract reads contain queried addresses. | [docs/assets/wallet-core.js](assets/wallet-core.js), [docs/web3-wallet-core.js](web3-wallet-core.js), [docs/assets/ifr-state.js](assets/ifr-state.js) |
| Benefits frontend | `NEXT_PUBLIC_ETHEREUM_RPC_URL` when it is HTTPS and matches the selected chain; otherwise `https://ethereum-rpc.publicnode.com` or `https://ethereum-sepolia-rpc.publicnode.com`. Public chain reads can contain the connected wallet. | [wagmi.ts](../apps/benefits-network/frontend/src/lib/wagmi.ts) |
| Benefits backend | Required `RPC_URL` (actual recipient unknown). Eligibility reads send the customer's wallet in IFRLock, token-balance and CommitmentVault calls. Reward verification sends seller-owner wallets, partner identifiers and the configured reward-caller address in chain reads; the expected reward beneficiary is compared locally. | [config.ts](../apps/benefits-network/backend/src/config.ts), [ifrLockService.ts](../apps/benefits-network/backend/src/services/ifrLockService.ts), [rewardService.ts](../apps/benefits-network/backend/src/services/rewardService.ts) |
| Protocol Data API | HTTPS `MAINNET_RPC_URL`, if configured, plus public fallback endpoints `https://ethereum-rpc.publicnode.com`, `https://eth.drpc.org`, `https://mainnet.gateway.tenderly.co`, `https://eth-mainnet.public.blastapi.io`. User-supplied addresses in access, builder, loan and tranche queries become RPC calldata; protocol statistics also use contract reads. | [rpc.ts](../apps/data-api/server/rpc.ts), [index.ts](../apps/data-api/server/index.ts) |
| Telegram wallet verification | `ALCHEMY_RPC_URL`, then `RPC_URL`, otherwise `https://eth.llamarpc.com`. Safe owner reads, IFRLock wallet reads and optional BuilderRegistry membership checks. The bootstrap listener separately defaults to `https://ethereum-rpc.publicnode.com`. | [onChainReader.js](../apps/telegram/telegram-bot/src/services/onChainReader.js), [bootstrapListener.js](../apps/telegram/telegram-bot/src/services/bootstrapListener.js) |
| Points backend | Configured `RPC_URL`; production requires configuration. Lock-proof reads include the authenticated wallet; fee reads query FeeRouter. | [security.ts](../apps/points-backend/src/config/security.ts), [lockProof.ts](../apps/points-backend/src/middleware/lockProof.ts), [fee-router-fee.ts](../apps/points-backend/src/services/fee-router-fee.ts) |
| SDK and reference verifier | SDK defaults to `https://ethereum-rpc.publicnode.com` unless overridden. The verifier accepts an explicit HTTPS URL or EIP-1193 provider. Wallet eligibility checks reach that recipient. | [SDK](../apps/sdk/src/index.ts), [reference verifier](../apps/benefits-verify/src/index.ts) |
| Repository dashboards/prototype | Dashboard: `VITE_SEPOLIA_RPC_URL` or `https://rpc.sepolia.org`; governance dashboard: configured RPC or `https://eth-sepolia.g.alchemy.com/v2/demo`. The embedded-wallet prototype uses Sepolia `http()` defaults from its chain library; the resolved URL is not explicit in its config. These packages do not establish production deployment. | [dashboard](../apps/dashboard/src/hooks/useContracts.js), [governance dashboard](../apps/governance-dashboard/src/hooks/useContracts.ts), [prototype](../apps/benefits-wallet-prototype/src/wallet/config.ts) |

## WalletConnect and wallet providers

The static wallet cores load the same-origin, pinned
[`walletconnect-ethereum-provider-2.25.0.esm.js`](assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js).
[Build inputs and integrity](../infra/web3/walletconnect-provider/README.md)
identify the bundle. Self-hosting the JavaScript does not remove its network
services.

- The bundled relay default is `wss://relay.walletconnect.org`. Its connection
  URL carries a project ID, authentication token and SDK/protocol user-agent
  information. Relay publish/subscribe messages carry topics and encrypted
  session payloads, with transport fields such as TTL and message tags. The
  relay also sees connection metadata and the connecting network address.
- The bundle encodes session requests through `core.crypto.encode` before
  publishing them. The paired wallet receives proposal metadata (app name,
  description, URL and icons), requested chains/methods/events, and subsequent
  signing or transaction requests. Session responses contain approved accounts.
  A relay payload is not evidence that the relay receives plaintext signatures
  or wallet addresses; those fields are inside the session protocol.
- The artifact also contains `https://rpc.walletconnect.org` fallback RPC,
  WalletConnect Verify endpoints (`verify.walletconnect.com` and
  `verify.walletconnect.org`), modal APIs (`api.web3modal.org`) and a conditional
  event client posting to `https://pulse.walletconnect.org/batch`. Its event
  records include event IDs, timestamps, topic/trace information and app domain;
  its request includes project/SDK identifiers. Which optional services execute
  in a particular connection has not been measured. Endpoint strings alone do
  not prove a request occurred.
- The static cores supply app metadata and a Mainnet RPC map; they do not set
  an explicit `telemetryEnabled` value. Benefits explicitly sets
  `telemetryEnabled: false` for WalletConnect and `telemetry: false` for
  Coinbase Wallet. Its SDK connectors initialize only when selected. These
  switches do not disable relay traffic or wallet RPC requests.
- The SDK bundle contains browser storage for pairing/session state; the
  static cores also store the connected wallet address under
  `ifr_wallet_connected` in localStorage for reconnect.
  Browser storage is separate from backend persistence. Wallet applications
  and extensions control their own storage and recipients; those policies
  are unknown here. Benefits wallet-launch links pass the destination URL to
  the selected wallet's link handler.

Sources: the artifact above; [landing core](assets/wallet-core.js),
[Web3 core](web3-wallet-core.js), [Benefits wallet config](../apps/benefits-network/frontend/src/lib/wagmi.ts),
[deferred connector](../apps/benefits-network/frontend/src/lib/deferredWalletConnector.mjs),
[wallet-launch links](../apps/benefits-network/frontend/src/lib/walletLaunch.ts).

## Etherscan proxy in the Data API

[`esApiFetchDirect`](../apps/data-api/server/index.ts) constructs requests to
`https://api.etherscan.io/v2/api` with `chainid=1`, module/action, contract and
queried address, block/topic filters, pagination and an optional server-side
`ETHERSCAN_API_KEY`. Calls cover token balances/supply, protocol-wallet
transactions and lock event logs. The API caches responses in memory (the
Etherscan cache TTL is 125 seconds); this is not a provider deletion policy.
The fetch code does not forward the browser's IP or request headers. Etherscan
receives the server connection and query, including its API key. Wallet-specific
access checks use RPC separately. Proxy/hosting log retention is unknown.

## Telegram wallet verification

1. A private `/verify` command supplies the bot with Telegram user ID and
   username (first name fallback). A one-use nonce is held in memory for ten
   minutes; a new code replaces that account's previous code.
2. The [verification page](wiki/verify.html) sends `{ nonce, signature, wallet }`
   to `https://verify-api.ifrunit.tech/api/verify`. The bot recovers the signer,
   checks the claimed wallet and derives the access tier via the RPC path above.
3. [`verificationStore.js`](../apps/telegram/telegram-bot/src/services/verificationStore.js)
   persists a JSON mapping keyed by Telegram user ID, with
   `{ wallet, savedAt }`, at `WALLET_MAP_PATH` (default
   `/data/verify/wallet-map.json`, file mode `0600`). It saves on binding and
   every five minutes. Tier and verification timestamp are kept in the
   in-memory `verifiedUsers` map and recomputed after restart/periodically.
   The nonce store and wallet-map writer do not persist signatures or usernames.
4. Telegram receives a success DM with tier and a shortened wallet. Signer or
   Council bindings also post a notice to the Core Dev topic containing
   Telegram ID, username/name fallback, tier and shortened wallet. This is a
   separate disclosure from the local mapping.
5. `/unverify` removes the in-memory verification and persisted mapping. No
   automatic age-based deletion of the mapping is implemented. Tier refresh
   is not deletion. Telegram's message retention and operator backups/log
   retention are unknown.

Sources: [nonce store](../apps/telegram/telegram-bot/src/services/nonceStore.js),
[/verify and /unverify](../apps/telegram/telegram-bot/src/commands/verify.js),
[API handler](../apps/telegram/telegram-bot/src/index.js),
[privileged notice](../apps/telegram/telegram-bot/src/services/privilegedLinkNotice.js).

## Benefits persistence and minimum partner records

The backend uses SQLite through Prisma. Customer wallet and signature inputs
are processed during proof verification, including RPC reads; avoiding storage
does not prevent this in-request disclosure. The current
[schema](../apps/benefits-network/backend/prisma/schema.prisma) stores:

| Table | Wallet-related data and purpose |
| --- | --- |
| `Business` | Seller `ownerAddress`, public seller profile and commercial defaults. |
| `CheckoutOperator` | Seller/operator `walletAddress`, business, label, active/expiry state. |
| `Session` | Seller `confirmedByWallet`, role/operator reference, immutable offer terms, nonce, expiry, result/status, attempts and redemption timestamp. No raw customer wallet, signature, balance or verification block. |
| `SellerRewardLink` | Partner ID, `builderWallet`, `rewardWallet`, confirmation/verification timestamps, governance reference, status/reason. Seller profile creation alone does not activate rewards. |
| `RewardEvent` | Business/session/partner references, chain, status, reason and optional transaction hash. Eligible Model B pilot events can contain `rewardPeriod` and a wallet-derived HMAC `rewardDedupKey`, scoped to chain/vault/partner/month; this is a pseudonym, not absence of customer-derived data. It is conditional on pilot policy and dedup configuration. |
| `AuditLog` | Session event type, timestamp and JSON payload; session creation can include the seller wallet/role/operator. Customer-proof paths store outcome information, not the raw customer proof. |
| `AdminAuditLog` | Action, route, target, status, constant actor digest and SHA-256 client-IP digest. No raw wallet column. |
| `SellerAuthorizationChallenge`, `CustomerPass` | Nonce/action/business/scope/expiry/consumption or pass control hash/status/timestamps; no wallet field. Product and benefit-rule tables hold offer data. |

[`retention.ts`](../apps/benefits-network/backend/src/services/retention.ts) and
the [retention CLI](../apps/benefits-network/backend/src/retentionCli.ts) require
an operator-selected cutoff (`--older-than-days`) and explicit apply
confirmation. Bounded deletion covers old admin logs, expired seller
challenges and expired unlinked passes. Sessions, session audit logs, reward
events and linked passes are protected from that prune; seller/business,
operator and reward-link rows are outside its deletion set. No automatic
fixed retention period for those rows is established by this code. A session
TTL is not a database deletion deadline. Session-status and controlled-pass GET
derive expiry without writing the pass, session or its audit log; existing
POST challenge/confirmation/cancellation paths persist pass expiry as needed.

Rate limiting can additionally store client-IP keys and seller-wallet keys
in configured Redis with window expiry, or in process memory. The actual
Redis operator and persistence/backups are deployment-dependent. General
backend error logging and hosting logs have no deletion schedule established
by the cited retention routine.

A partner's independent order/customer records are outside these backend
tables; their contents and retention cannot be established from this code.

Sources: [session service](../apps/benefits-network/backend/src/services/sessionService.ts),
[pass service](../apps/benefits-network/backend/src/services/customerPassService.ts),
[Model B pseudonyms](../apps/benefits-network/backend/src/services/modelBDedup.ts),
[admin audit](../apps/benefits-network/backend/src/services/adminAudit.ts),
[authenticated limits](../apps/benefits-network/backend/src/services/authenticatedRateLimiter.ts),
[public limits](../apps/benefits-network/backend/src/middleware/rateLimiter.ts),
[Redis infrastructure](../apps/benefits-network/backend/src/services/rateLimitInfrastructure.ts).

## Points backend

The [SQLite schema](../apps/points-backend/prisma/schema.prisma) differs from
Benefits: `Wallet` stores the normalized wallet address, points total and
timestamps. `PointEvent` links it to event type, points, optional `proofRef`
and time. `Voucher` links it to nonce, discount, usage counters, expiry and
timestamps. No age-based deletion job for these tables appears in the Points
source. Voucher expiry limits use; it does not delete the record.

[SIWE authentication](../apps/points-backend/src/routes/auth.ts) receives the
signed message/signature, verifies it and upserts the wallet. Nonces live in
memory for five minutes; the issued [JWT](../apps/points-backend/src/middleware/auth.ts)
contains the wallet and expires after 24 hours. The shown database writes do
not store the SIWE signature. [Points events](../apps/points-backend/src/routes/points.ts)
persist caller-supplied proof references; [voucher issuance](../apps/points-backend/src/routes/voucher.ts)
persists voucher/event records and returns a locally signed EIP-712 voucher.
Error categories and the issuance log avoid raw wallet/signature/nonce fields.

When configured, [Turnstile verification](../apps/points-backend/src/middleware/captcha.ts)
posts the captcha response token and server secret to
`https://challenges.cloudflare.com/turnstile/v0/siteverify`; this request body
does not include the wallet or client IP. Cloudflare receives the server
connection. Wallet lock checks separately reach the configured RPC and use a
five-minute memory cache. Hosting, database backups, wallet-provider retention
and third-party browser behavior remain unknown.
