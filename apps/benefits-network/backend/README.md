# IFR Benefits Network — Backend

Verification backend for the IFR Benefits Network. Enables any business to verify customer IFR lock status on-chain and grant discounts/premium access.

## Quick Start

```bash
npm install
cp .env.example .env   # edit with your values
npx prisma generate && npx prisma migrate dev
npm run dev            # http://localhost:3001
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHAIN_ID` | Ethereum chain ID | `11155111` (Sepolia) |
| `RPC_URL` | JSON-RPC endpoint | required |
| `IFR_TOKEN_ADDRESS` | Expected IFR token address used for bytecode and vault-token identity checks | required |
| `IFRLOCK_ADDRESS` | IFRLock contract address used by `ifrlock` and `either` rules | required |
| `COMMITMENT_VAULT_ADDRESS` | CommitmentVault address used only for active `TIME_ONLY` tranches | required |
| `PARTNER_VAULT_ADDRESS` | Optional PartnerVault address for read-only M4 verification | unset |
| `BUILDER_REGISTRY_ADDRESS` | Optional BuilderRegistry address for read-only M4 verification | unset |
| `REWARD_CALLER_ADDRESS` | Optional public caller address checked with `authorizedCaller`; never a private key | unset |
| `ADMIN_SECRET` | Bearer token for `/api/admin/*`; minimum 32 characters and no documented placeholder | required |
| `DATABASE_URL` | Prisma database URL | `file:./dev.db` |
| `PORT` | Server port | `3001` |
| `MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET` | Anti-spam cap for active wallet-owned seller profiles | `5` |
| `MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET` | Lifetime cap for wallet-owned seller profiles, including inactive profiles | `25` |
| `RATE_LIMIT_STORE` | `memory` for one replica or `redis` for a shared rate-limit store | `memory` |
| `RATE_LIMIT_REDIS_URL` | Redis/Rediss URL; required only when `RATE_LIMIT_STORE=redis` | unset |
| `BACKEND_REPLICA_COUNT` | Declared backend replica count used by the startup safety guard | `1` |

The default SQLite and in-memory configuration is intentionally single-replica. Before scaling
above one backend replica, migrate the application database away from SQLite, configure a shared
Redis rate-limit store, and set `BACKEND_REPLICA_COUNT` to the real replica count. Startup fails
closed if multiple replicas are declared with SQLite or process-local limits. Redis is connected
and pinged before the HTTP listener starts, and `/ready` becomes unavailable if the shared store
is not ready.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/businesses` | Admin | Create business |
| PATCH | `/api/admin/businesses/:id` | Admin | Update business |
| GET | `/api/admin/businesses/:id/rules` | Admin | List all benefit rules for a business |
| POST | `/api/admin/businesses/:id/rules` | Admin | Create a benefit rule |
| PATCH | `/api/admin/rules/:id` | Admin | Update or pause a benefit rule |
| DELETE | `/api/admin/rules/:id` | Admin | Archive a benefit rule while preserving checkout history |
| POST | `/api/admin/businesses/:id/rewards/verify` | Admin | Verify a requested PartnerVault/BuilderRegistry link from live contract state |
| POST | `/api/admin/businesses/:id/rewards/revoke` | Admin | Revoke a local seller reward link |
| POST | `/api/admin/businesses/:id/rewards/queue` | Admin | Reconcile pending reward outbox rows without submitting a transaction |
| GET | `/api/seller/auth-message` | Public | Issue server-time wallet message for seller actions |
| POST | `/api/seller/businesses` | Seller wallet signature | Create wallet-owned seller business |
| GET | `/api/seller/businesses` | Seller wallet signature | Privately list active and inactive seller businesses owned by the wallet |
| PATCH | `/api/seller/businesses/:id/slug` | Owner wallet signature | Claim the business's permanent public seller URL |
| DELETE | `/api/seller/businesses/:id` | Seller wallet signature | Soft-deactivate an owned seller business and pause products, rules and checkout operators |
| POST | `/api/seller/businesses/:id/reactivate` | Owner wallet signature | Reactivate only the owned seller profile; products, rules and checkout operators remain paused |
| GET | `/api/seller/businesses/:id/rules` | Seller wallet signature | List owned benefit rules |
| GET | `/api/seller/businesses/:id/products` | Owner wallet signature | List owned catalog items, including archived ones |
| POST | `/api/seller/businesses/:id/products` | Owner wallet signature | Create a product or service |
| PATCH | `/api/seller/products/:id` | Owner wallet signature | Update or archive a product/service |
| DELETE | `/api/seller/products/:id` | Owner wallet signature | Soft-archive a product and pause linked rules |
| GET | `/api/seller/businesses/:id/sessions?limit=50&cursor=...&snapshot=...` | Seller wallet signature | Snapshot-anchored cursor pagination for an owned seller business; maximum 50 rows per request |
| POST | `/api/seller/businesses/:id/rewards/apply` | Owner wallet signature | Apply for governance review; does not create an on-chain partner |
| POST | `/api/seller/businesses/:id/rewards/disable` | Owner wallet signature | Disable rewards: blocks new outbox rows and queue progression until a fresh application |
| POST | `/api/seller/businesses/:id/rewards/reward-wallet` | Owner + reward wallet signatures | Confirm or clear a separate reward payout wallet; any change invalidates verification |
| GET | `/api/seller/businesses/:id/rewards` | Owner wallet signature | Read local reward events and live PartnerVault vesting/claim status |
| GET | `/api/seller/businesses/:id/operator-status` | Owner/operator wallet signature | Confirm checkout role for the connected wallet |
| GET | `/api/seller/businesses/:id/operators` | Owner wallet signature | List checkout operators |
| POST | `/api/seller/businesses/:id/operators` | Owner wallet signature | Add or reactivate a checkout operator |
| DELETE | `/api/seller/operators/:id` | Owner wallet signature | Revoke checkout access immediately |
| POST | `/api/seller/businesses/:id/rules` | Seller wallet signature | Create owned benefit rule |
| PATCH | `/api/seller/rules/:id` | Seller wallet signature | Update or pause owned benefit rule |
| DELETE | `/api/seller/rules/:id` | Seller wallet signature | Archive owned benefit rule while preserving checkout history |
| GET | `/api/businesses/:idOrSlug` | Public | Get business info by legacy ID or permanent public slug |
| GET | `/api/businesses/:idOrSlug/rules` | Public | List active public benefit rules |
| GET | `/api/businesses/:idOrSlug/products` | Public | List active products/services with active benefits |
| POST | `/api/sessions` | Owner/operator wallet signature | Start verification session, optionally bound to a seller benefit rule |
| GET | `/api/sessions/:id` | Public | Poll minimal, non-cacheable session status; no customer address or detailed rejection data |
| POST | `/api/sessions/:id/challenge` | Public, rate limited | Body `{walletAddress}`; return the exact checkout-proof text for that wallet (nothing stored). `GET` returns 410 so no address appears in a URL |
| POST | `/api/attest` | Customer wallet signature | Body `{sessionId, walletAddress, signature}`; verify signer, fresh eligibility and seller authority, then redeem the checkout once |
| POST | `/api/sessions/:id/redeem` | - | Retired: always 410 (the customer proof redeems) |
| any | `/api/customer/history*` | - | Retired: 410 `{storage: 'device-local'}`; customer history is kept only in the browser |
| POST | `/api/passes/challenge` | - | Retired: always 410 |
| POST | `/api/passes` | Public, rate limited | Empty body; create an opaque short-lived pass plus control token (no wallet) |
| GET | `/api/passes/:id` | Public, rate limited | Return only generic availability and expiry; no wallet, rule or session |
| GET | `/api/passes/:id/control` | Customer pass control token | Return the exact seller/rule checkout to the originating customer tab |
| POST | `/api/passes/:id/bind` | Owner/operator wallet signature | Atomically bind one active seller rule to one open pass |
| POST | `/api/passes/:id/challenge` | Customer pass control token | Body `{walletAddress}`; return the exact linked checkout-proof text |
| POST | `/api/passes/:id/confirm` | Customer pass control token + wallet signature | Body `{walletAddress, signature}`; same checks as `/api/attest`, redeems the checkout once |
| POST | `/api/passes/:id/cancel` | Customer pass control token | Cancel an open or still-pending checkout pass |

Public offer discovery accepts an optional exact `serviceArea` filter and returns the available
`serviceAreas` represented by active sellers with active visible offers. Seller owners can publish
a broad city, region or `Online` label as part of their signed profile update. The value is bounded
to 80 characters and is stored and returned publicly exactly as normalized. The first-party UI
requires sellers to confirm that they entered no private or street address. The service never asks
customers for location or coordinates. Legacy profiles without a service area remain visible under
`All areas`.

Wallet-owned businesses may also carry one immutable public `slug`. Creation signatures bind the
exact requested slug as their one-time scope; existing businesses claim it with the separate
`business:slug` action. Slugs use 3-48 lowercase ASCII letters, numbers and single hyphens.
Reserved routes and CUID-shaped values are rejected, and uniqueness checks cover both existing
slugs and internal IDs. Public profile, rule, product and discovery reads accept either reference,
but every seller mutation, session and database relation continues to use the immutable internal
Business ID. Existing ID links therefore remain valid without weakening checkout authorization.

## Session Flow

Recommended customer-presented flow:

1. Customer creates a short-lived `/p/:passId` QR with an empty request; no wallet is involved. It contains no wallet or reusable proof.
2. Seller selects a rule and signs `passes:bind` scoped to `passId:benefitRuleId`; backend claims the pass and creates its immutable session in one transaction, recording the seller wallet and role that opened it.
3. Customer reviews the exact seller/rule through a random control token, requests the checkout-proof text for its wallet and signs it.
4. On confirm, the backend checks recovered signer == claimed wallet, reads eligibility fresh on-chain, re-checks that the opening seller is still owner or an active operator and, in one transaction, moves the checkout `PENDING` -> `REDEEMED` exactly once. Seller sees `REDEEMED`. Public legacy challenge/attest routes cannot operate on the linked session.

Compatible seller-issued flow:

1. Merchant selects a seller rule or falls back to the business default.
2. Owner or active checkout operator requests and signs a one-time `sessions:create` challenge bound to wallet, business and selected rule. The backend atomically consumes it, rechecks current checkout access and creates the QR. Benefit text, discount, required lock and TTL are frozen into that session.
3. Customer scans QR → connects wallet → requests the checkout-proof text (`POST /api/sessions/:id/challenge`) → signs it.
4. Backend checks recovered signer == claimed wallet → checks the rule's immutable `ifrlock`,
   `commitment_time_only` or `either` source in a fresh read at one Ethereum block. `either`
   requires the full threshold in one source.
5. If the wallet is not eligible yet, the customer response is `REJECTED` but the stored session stays `PENDING` and unchanged (no attempt consumed), so the customer can lock more IFR and retry the same QR while it is valid. An RPC failure returns 503 and also changes nothing.
6. If eligible and the opening seller is still authorized, one database transaction moves the checkout `PENDING` -> `REDEEMED` exactly once. There is no `APPROVED` step and no separate seller redeem call.

The checkout-proof text (EIP-191, version `ifr-benefits/checkout-proof/2`) binds purpose, the
full claimed wallet, the configured audience domain (`SELLER_AUTH_DOMAIN`), chain ID, shop,
checkout ID, nonce, expiry and the offer terms plus a terms digest. The backend does not derive the
audience from a request Host header. A signature over an older, foreign-domain or altered text
recovers a different signer and is refused (403) without changing the checkout.

The backend stores no customer wallet address, hash or fingerprint of it, signature or signed text,
lock/balance amounts, block numbers, payment transaction hashes or customer history. It keeps the
merchant checkout record (random checkout ID, shop, offer terms, status, timestamps, lock source,
self-redemption flag, the seller wallet that opened it) and seller-side audit events, so checkouts
are not anonymous.

## Customer Benefits History

Customer history is device-local only. The frontend keeps a signed receipt (checkout, shop,
terms, status, signed proof text and signature) in the browser so the customer can verify locally
what they signed. The former server history (`/api/customer/history`, `/challenge`, `/authorize`)
returns 410 `{storage: 'device-local'}`; its challenge and access-token tables were removed.
Losing the browser data loses this history.

## Benefit Rules

Benefit rules are persisted seller offers tied to a business. A QR session can
now be bound to one active rule by passing `benefitRuleId` to `POST /api/sessions`.
If no rule is passed, the legacy business-level discount remains the fallback so
old QR sessions stay compatible.

Seller-owned rules may also carry `productId`. The backend accepts only an active product
from the same business and copies its current name/category into the rule. Product edits do
not rewrite old rule or session snapshots. Archiving a product soft-deactivates its linked
active rules while preserving sessions and audit history.

```json
{
  "productId": "optional-product-cuid",
  "label": "Bronze",
  "category": "Coffee",
  "productName": "Premium customer discount",
  "discountPercent": 10,
  "requiredLockIFR": 1000,
  "minIFRHeld": 250,
  "lockSource": "commitment_time_only",
  "ttlSeconds": 90,
  "active": true
}
```

`requiredLockIFR` is mandatory. `lockSource` defaults to `ifrlock`; it may be
`commitment_time_only` or `either`. Commitment eligibility sums only non-unlocked `TIME_ONLY`
tranches. `PRICE_ONLY`, `TIME_OR_PRICE` and `TIME_AND_PRICE` never qualify. `either` does not add
partial balances across vaults. `minIFRHeld` is an optional nonnegative whole-IFR amount; `0` or
omission disables the free-wallet balance gate. For a positive value, redemption additionally
requires the ERC-20 wallet threshold. The backend verifies deployed bytecode and each selected
vault's token against `IFR_TOKEN_ADDRESS`, pins all reads to one block, compares exact 9-decimal
base units with `bigint`, and fails closed on identity, ABI or RPC errors.

```json
{
  "businessId": "business_cuid",
  "benefitRuleId": "optional_active_rule_cuid"
}
```

## Seller Wallet Ownership

Normal seller actions can be authorized without sharing the global admin secret.

Admin requests are rate-limited by resolved client IP before authentication.
Missing, malformed and invalid bearer credentials return the same `401` challenge.
Successful admin mutations and mutating conflict outcomes write an `AdminAuditLog`
record before the response. Audit rows contain only route/action metadata plus
SHA-256 role and client digests; request bodies, bearer values, secrets and raw
IP addresses are never stored.

The audit table has no automatic SQLite TTL. The manual phase-one retention
tool provides an authenticated count report and an explicitly confirmed,
bounded CLI prune for old admin audit rows and expired unlinked auth artifacts.
It never runs at startup and deliberately excludes Session, session AuditLog,
RewardEvent, and linked CustomerPass records. See
`../../../docs/BENEFITS_RETENTION_RUNBOOK.md`. The actual retention windows and
production schedule still require approval. Reward verification reads chain
state before its database transaction, and reward queue reconciliation updates
individual events before its final summary audit; those external/iterative
boundaries cannot be made one atomic database operation.
The frontend first requests `/api/seller/auth-message` so the timestamp is issued
by the backend, then the seller signs that short-lived EIP-191 message. Every seller
action receives a random server-issued nonce bound to the recovered wallet, action,
business and scope (the exact resource for mutations, the fixed `read` scope for
read-only actions); the nonce is consumed once, so reads need a fresh challenge per
request. The message names `SELLER_AUTH_DOMAIN`, `CHAIN_ID` and an explicit expiry;
production startup refuses to run unless both are set explicitly. The backend
also checks the recovered address against `Business.ownerAddress` before owner-only
management actions. Active, unexpired checkout operators may create and redeem QR
sessions but cannot perform owner-only mutations.

The private owner profile list returns active and inactive profiles separately with
`Cache-Control: private, no-store`. Deactivation preserves history and the permanent
slug while pausing active products, rules and checkout operators. A fresh, one-time
`business:reactivate` authorization can restore only the profile, subject to the
active-profile cap; products and rules must be reviewed and reactivated individually,
and each checkout operator requires a fresh owner authorization.

Seller session history uses the same headers with `Action: sessions:list` and the
business id as `Business`. Each snapshot/cursor page is clamped from 1 to 50 rows.
Responses include the session status, `customerProof` (`verified` or `null`), `selfRedemption`,
`verifiedLockSource`, rejection reason, redeem timestamp and attached rule/default benefit fields.
They contain no customer wallet, lock or balance amount or block number, because none is stored.
The frontend builds the full paginated CSV locally without creating a server-side export file.

The separate public `GET /api/sessions/:id` projection is intentionally smaller. It is
served with `Cache-Control: private, no-store`, never returns a customer
address or exact lock/rejection details, and exposes only a generic terminal reason.
Seller operational fields remain available only through the owner-signed history API.

Seller write requests use these headers:

```http
x-ifr-wallet: 0xSellerWallet
x-ifr-signature: 0xSignature
x-ifr-timestamp: 1784210000000
x-ifr-nonce: 64-character-server-nonce
```

The signed message format is deterministic:

```text
IFR Benefits Network - Seller Authorization
Action: rules:create
Business: business_cuid
Timestamp: 1784210000000
Scope: business_cuid
Nonce: 64-character-server-nonce
Only sign this message inside shop.ifrunit.tech.
```

The nonce and scope lines are present only for mutations. Read-only actions use
the same deterministic prefix without those lines. Opening a checkout
(`sessions:create`, `passes:bind`) is the seller's single-use authorization; the
seller wallet and role are recorded on the checkout and re-checked when the
customer proof redeems it. The former seller `sessions:redeem` step is retired
(`POST /api/sessions/:id/redeem` returns 410). This keeps the customer QR public
and prevents a captured seller mutation signature from being replayed.

## Checkout Operators

The owner can delegate checkout-only access to up to ten active wallets per
business. Each operator may have a label and expiry. Operators can sign
`operators:status`, `sessions:create` and `passes:bind`; they cannot list history, manage
profiles or rules, or add/revoke other operators. Revocation is effective on
the next server request, including for checkouts the operator already opened:
the redeeming transaction re-checks the opening seller and refuses (409) a
revoked or expired operator. `REDEEMED` audit payloads record the opening seller's
wallet and `OWNER`/`OPERATOR` role, never a signature or customer wallet.

Deactivating a seller profile also deactivates every checkout operator in the same
database transaction and invalidates every unused `operators:create` challenge for that
business. Reactivating the profile does not restore delegated authority: the owner must
issue a fresh `operators:create` authorization for each staff wallet that should regain
checkout access.

Every seller mutation requires a resource-bound single-use nonce in `x-ifr-nonce`
in addition to the wallet, signature and timestamp headers. Session creation
consumes the nonce atomically with the current owner/operator recheck and session
insert. All owner-management mutations reject replayed, expired or wrong-scope
nonces before changing state. POS helpers receive only public
integration code; they never embed a seller private key or reusable seller secret.

## Rate-limit identities

Public and pre-authenticated endpoints use the client IP resolved through trusted
private/loopback proxy hops only. Client-supplied business IDs and wallet headers
are never used as pre-auth limiter keys. After a seller signature is recovered,
an additional process-local fixed-window budget is charged to the recovered wallet.
The production backend currently runs as one instance; a shared external store is
required before horizontal scaling.

## Per-customer redemption limits (not IFR-hosted)

Because the backend stores no customer wallet or identity, IFR does not enforce
per-customer redemption limits. Rule create/update with a non-zero
`dailyRedemptionLimit` or `monthlyRedemptionLimit` returns 400. Opening a
checkout (`POST /api/sessions` or pass bind) for a legacy rule that still carries
a non-zero limit returns 409 with guidance, so no limit is silently dropped. A
merchant that needs per-customer limits enforces them in its own systems. The
columns remain for data compatibility only.

## Immutable eligibility snapshots

New rule-bound sessions snapshot `requiredLockIFR`, `minIFRHeld` and `lockSource` with the seller,
product, discount, price and redemption terms. Later rule edits cannot change an issued checkout.
Snapshot version 5 includes the lock source; versions 0-4 remain `ifrlock`, and versions 0-3
interpret the held threshold as `0`. Version-5 challenges include the source without changing old
challenge text. Observed lock and balance amounts are used only within the proof request and are
not stored; public proof status and seller history do not expose customer inventory.

## Verified Seller Rewards Foundation

M4 reward support is governance-gated and fail-closed. Seller registration never
enables rewards: without a `SellerRewardLink` rewards stay off. A seller owner
may submit a separate owner-signed application, but only the admin verification
route can bind a `bytes32` PartnerVault ID. The admin route cannot create an
application and rejects a seller change that races its chain read. Verification reads the configured
chain and requires deployed contract bytecode, matching BuilderRegistry owner /
PartnerVault admin, an active BuilderRegistry entry for the seller owner, an
active PartnerVault partner and a beneficiary equal to the effective reward
wallet.

The effective reward wallet is the link's confirmed `rewardWallet`, falling back
to the seller owner wallet when it is `null` (the pre-existing behavior).
BuilderRegistry membership always remains bound to the seller owner wallet.
Setting a separate reward wallet requires dual authorization: a fresh
single-use owner signature plus a fresh single-use signature by the proposed
reward wallet itself, both over server-issued challenges bound to the business
and scoped to the exact proposed address. An address is never accepted without
proof of control, the reward wallet must differ from the owner wallet, and
signatures are never stored, logged or returned. Any reward wallet change or
clearing resets the link to `APPLIED`, clears the partner/governance
verification state and moves actionable outbox events to `BLOCKED_GOVERNANCE`
until governance re-verifies the new beneficiary; `CONFIRMED` events stay
untouched historical records. Queue reconciliation only advances events whose
stored PartnerVault ID still matches the currently verified link. If governance
replaces the partner ID instead of updating its beneficiary, older events remain
blocked until an explicit operator migration or cancellation policy is approved.
The current proof uses EIP-191 recovery and therefore supports standard EVM
accounts; EIP-1271 smart-contract wallet proof needs a separate reviewed flow.

The owner can also sign `rewards:disable` at any time. A `DISABLED` link blocks
new reward outbox rows on redeem, blocks queue reconciliation, and cannot be
verified by the admin route; a fresh owner-signed application returns it to
`APPLIED` with verification state cleared.
Disabling does not erase a previously confirmed payout-wallet preference; a
later application continues to use it unless the owner explicitly clears or
replaces it before governance verification.

A successful redemption creates one reward outbox row per checkout in the same
SQLite transaction only for a locally verified link. Since storage-free customer
sessions it is created as non-payable `BLOCKED_POLICY`; a self-redemption (owner,
any checkout operator, reward or builder wallet) creates no row and is audited as
`REWARD_SKIPPED_POLICY`. The lock-reward path needs a customer wallet and cannot
run: the admin `rewards:queue` lock path moves open events (`PENDING`, `READY`,
`BLOCKED_CALLER`, `BLOCKED_GOVERNANCE`) to `BLOCKED_POLICY` and reports
`submissionReady: false`. The Model B export always adds blocker
`CUSTOMER_DEDUP_UNAVAILABLE_OWNER_B` and is diagnostic only until a new reward
policy is accepted. The backend never signs or broadcasts `recordLockReward`.

`REWARD_CALLER_ADDRESS` is only a public address used for the read-only
`authorizedCaller` check. No private key, mnemonic or transaction signer belongs
in this backend. `READY` means contract preconditions were observed; it does not
mean submitted, confirmed, vested or paid. Reward amounts remain dynamic until an
authorized transaction executes.

Admin routes remain available for operator setup and recovery, but the public
seller UX should prefer wallet-owned businesses.

Public seller creation is intentionally capped per wallet. The defaults are five
active and 25 total seller profiles per owner wallet; inactive businesses count toward
the total cap. Existing wallets above a newly lowered total cap can still list,
deactivate and reactivate existing profiles but cannot create another profile.
Deactivated seller profiles are also blocked from seller-owned rule writes,
even if the original owner wallet signs the request.

## Tests

```bash
npm test   # resets local SQLite test DB, then runs signature, expiry, replay, redeem, threshold and seller-auth tests
npm run test:migration-upgrade   # upgrades a populated prior database and verifies data/schema/FKs
```

## Seller Wallet Smoke

Use the current seller-wallet path instead of the legacy admin-secret E2E script
when checking `shop.ifrunit.tech` or a local backend.

```bash
node scripts/seller-wallet-smoke.js
MUTATE=true node scripts/seller-wallet-smoke.js
CUSTOMER_PRIVATE_KEY=0x... MUTATE=true node scripts/seller-wallet-smoke.js
BENEFITS_BASE_URL=http://localhost:3001 MUTATE=true node scripts/seller-wallet-smoke.js
```

Default mode is read-only: health, server-issued seller auth and signed owned
profile listing with a throwaway wallet. `MUTATE=true` creates a wallet-owned
seller profile, reloads it, creates a benefit rule, lists the rule and deletes
the smoke rule again. It also creates a QR session for that rule, requests and
signs the customer checkout proof and submits `/api/attest`. Without
`CUSTOMER_PRIVATE_KEY` the customer wallet is throwaway and should receive a
rejected response from the live IFRLock check while the checkout stays `PENDING`;
the retired seller redeem route is expected to answer 410. With
`CUSTOMER_PRIVATE_KEY`, use a real eligible customer wallet to verify that the
proof redeems the checkout (`REDEEMED`). The script then soft-deactivates the smoke seller
profile so it no longer appears in owned active profile reloads. Seller private
keys are generated in memory. The optional customer private key is never printed.

## Production Deploy

Use the repo-level deploy helper for `shop.ifrunit.tech`:

```bash
scripts/deploy-benefits-network.sh backend
```

`backend` rebuilds/recreates `inferno-benefits-backend`, waits through Compose
health dependencies, then rebuilds the frontend with `--no-deps` so the public
shop uses the current API surface. For UI-only changes, use
`scripts/deploy-benefits-network.sh frontend` instead; this avoids the repeated
unnecessary backend rebuild that can push the production volume to 99-100%
usage during deployments.

## Security

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full threat model.
