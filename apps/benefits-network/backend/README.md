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
| `ADMIN_SECRET` | Bearer token for /api/admin/* | required |
| `DATABASE_URL` | Prisma database URL | `file:./dev.db` |
| `PORT` | Server port | `3001` |
| `MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET` | Anti-spam cap for active wallet-owned seller profiles | `5` |
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
| GET | `/api/seller/businesses` | Seller wallet signature | List active seller businesses owned by the wallet |
| PATCH | `/api/seller/businesses/:id/slug` | Owner wallet signature | Claim the business's permanent public seller URL |
| DELETE | `/api/seller/businesses/:id` | Seller wallet signature | Soft-deactivate owned seller business and active rules |
| GET | `/api/seller/businesses/:id/rules` | Seller wallet signature | List owned benefit rules |
| GET | `/api/seller/businesses/:id/products` | Owner wallet signature | List owned catalog items, including archived ones |
| POST | `/api/seller/businesses/:id/products` | Owner wallet signature | Create a product or service |
| PATCH | `/api/seller/products/:id` | Owner wallet signature | Update or archive a product/service |
| DELETE | `/api/seller/products/:id` | Owner wallet signature | Soft-archive a product and pause linked rules |
| GET | `/api/seller/businesses/:id/sessions?limit=50&cursor=...&snapshot=...` | Seller wallet signature | Snapshot-anchored cursor pagination for an owned seller business; maximum 50 rows per request |
| POST | `/api/seller/businesses/:id/rewards/apply` | Owner wallet signature | Apply for governance review; does not create an on-chain partner |
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
| GET | `/api/sessions/:id/challenge` | Public | Get signature challenge |
| POST | `/api/attest` | Public | Submit signature + verify |
| POST | `/api/sessions/:id/redeem` | Owner/operator wallet signature | Mark an approved session as redeemed |
| POST | `/api/customer/history/challenge` | Public, rate limited | Issue a wallet-bound one-time message for customer history |
| POST | `/api/customer/history/authorize` | Customer wallet signature | Exchange the signed one-time challenge for a ten-minute read token |
| GET | `/api/customer/history?limit=20&cursor=...&snapshot=...` | Customer history read token | Return only the signer's verified benefit history, maximum 50 rows per page |
| POST | `/api/passes/challenge` | Public, rate limited | Issue a wallet-bound one-time customer-pass creation message |
| POST | `/api/passes` | Customer wallet signature | Consume challenge and create an opaque short-lived pass plus control token |
| GET | `/api/passes/:id` | Public, rate limited | Return only generic availability and expiry; no wallet, rule or session |
| GET | `/api/passes/:id/control` | Customer pass control token | Return the exact seller/rule checkout to the originating customer tab |
| POST | `/api/passes/:id/bind` | Owner/operator wallet signature | Atomically bind one active seller rule to one open pass |
| POST | `/api/passes/:id/challenge` | Customer pass control token | Return the exact linked checkout challenge |
| POST | `/api/passes/:id/confirm` | Customer pass control token + wallet signature | Verify the original pass wallet against the snapshotted lock source |
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

1. Customer creates a signed short-lived `/p/:passId` QR. It contains no wallet or reusable proof.
2. Seller selects a rule and signs `passes:bind` scoped to `passId:benefitRuleId`; backend claims the pass and creates its immutable session in one transaction.
3. Customer reviews the exact seller/rule through a random control token, signs the linked challenge, and backend requires the same wallet that created the pass.
4. Seller sees `APPROVED` and redeems once. Public legacy challenge/attest routes cannot operate on the linked session.

Compatible seller-issued flow:

1. Merchant selects a seller rule or falls back to the business default.
2. Owner or active checkout operator requests and signs a one-time `sessions:create` challenge bound to wallet, business and selected rule. The backend atomically consumes it, rechecks current checkout access and creates the QR. Benefit text, discount, required lock and TTL are frozen into that session.
3. Customer scans QR → connects wallet → signs challenge with the selected benefit details.
4. Backend verifies signature → checks the rule's immutable `ifrlock`, `commitment_time_only` or
   `either` source at one Ethereum block. `either` requires the full threshold in one source.
5. If the wallet is not eligible yet, the customer response is `REJECTED` but the stored session stays `PENDING` until the three-attempt limit is exhausted, so the customer can lock more IFR and retry the same QR while it is valid.
6. Merchant sees APPROVED → owner or active checkout operator signs Redeem → backend atomically marks the session as redeemed once.

Customer signatures are bound to the fixed canonical domain
`shop.ifrunit.tech` as well as the selected business/rule snapshot, session,
nonce, expiry and chain ID. The backend does not derive this boundary from a
request Host header. A signature over an older or foreign-domain challenge
therefore does not authenticate the same wallet against the current challenge.

## Customer Benefits History

Customer history is not authorized by a wallet query parameter. The customer first requests a
server-time, random one-time challenge and signs its canonical `shop.ifrunit.tech` message. A
successful exchange atomically consumes the challenge and returns a random ten-minute read token.
Only its SHA-256 hash is stored; the frontend keeps the bearer token in memory and never writes it
to local storage.

The history endpoint is signer-bound and snapshot/cursor-paginated with a maximum of 50 rows per
request. It returns seller identity, immutable benefit snapshots, status and timestamps for the
signer's own verified sessions. It excludes recovered wallet addresses, signatures, challenge
nonces, authorization tokens, audit logs, lock balances and seller-only data.

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
omission disables the free-wallet balance gate. For a positive value, approval additionally
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
The frontend first requests `/api/seller/auth-message` so the timestamp is issued
by the backend, then the seller signs that short-lived EIP-191 message. Read-only
actions remain timestamp-bound and do not create authorization rows. Every seller
mutation receives a random server-issued nonce bound to the recovered wallet,
action, business and exact resource scope; the nonce is consumed once. The backend
also checks the recovered address against `Business.ownerAddress` before owner-only
management actions. Active, unexpired checkout operators may create and redeem QR
sessions but cannot perform owner-only mutations.

Seller session history uses the same headers with `Action: sessions:list` and the
business id as `Business`. Each snapshot/cursor page is clamped from 1 to 50 rows.
Responses include the session status, recovered customer wallet, locked amount, any verified
free-wallet IFR balance, rejection reason, redeem timestamp and attached rule/default benefit fields. The
frontend masks wallets and builds the full paginated CSV locally without exposing
customer signatures or creating a server-side export file.

The separate public `GET /api/sessions/:id` projection is intentionally smaller. It is
served with `Cache-Control: private, no-store`, never returns the recovered customer
address or exact lock/rejection details, and exposes only a generic terminal reason.
Detailed operational fields remain available only through the owner-signed history API.

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
the same deterministic prefix without those lines. Redeem signs
`Action: sessions:redeem` with the session id as both `Business` and `Scope`.
This keeps the customer QR public while making redemption seller-owned and
prevents a captured seller mutation signature from being replayed.

## Checkout Operators

The owner can delegate checkout-only access to up to ten active wallets per
business. Each operator may have a label and expiry. Operators can sign
`operators:status`, `sessions:create` and `sessions:redeem`; they cannot list history, manage
profiles or rules, or add/revoke other operators. Revocation is effective on
the next server request. Redemption audit payloads record the actor wallet and
`OWNER`/`OPERATOR` role, never the wallet signature.

Every seller mutation requires a resource-bound single-use nonce in `x-ifr-nonce`
in addition to the wallet, signature and timestamp headers. Session creation
consumes the nonce atomically with the current owner/operator recheck and session
insert. Redemption and all owner-management mutations reject replayed, expired or
wrong-scope nonces before changing state. POS helpers receive only public
integration code; they never embed a seller private key or reusable seller secret.

## Rate-limit identities

Public and pre-authenticated endpoints use the client IP resolved through trusted
private/loopback proxy hops only. Client-supplied business IDs and wallet headers
are never used as pre-auth limiter keys. After a seller signature is recovered,
an additional process-local fixed-window budget is charged to the recovered wallet.
The production backend currently runs as one instance; a shared external store is
required before horizontal scaling.

## Per-wallet redemption limits

Each benefit rule can set `dailyRedemptionLimit` and `monthlyRedemptionLimit`.
Both use UTC calendar boundaries and `0` means unlimited. New QR sessions copy
the two values into immutable session snapshots, so editing a rule does not
change an already issued checkout. Legacy sessions without these fields remain
unlimited.

Redeem acquires the SQLite writer lock before counting successful redemptions
for the same business, benefit rule and customer wallet. A concurrent checkout
therefore cannot exceed the configured cap. A denied session becomes
`REJECTED`, returns HTTP `429`, and records `REDEEM_DENIED_LIMIT` without storing
wallet signatures.

## Immutable eligibility snapshots

New rule-bound sessions snapshot `requiredLockIFR`, `minIFRHeld` and `lockSource` with the seller,
product, discount, price and redemption terms. Later rule edits cannot change an issued checkout.
Snapshot version 5 includes the lock source; versions 0-4 remain `ifrlock`, and versions 0-3
interpret the held threshold as `0`. Version-5 challenges include the source without changing old
challenge text. A positive held threshold stores the exact observed ERC-20 balance only in
seller-authorized operational history; public proof status does not expose customer inventory.

## Verified Seller Rewards Foundation

M4 reward support is governance-gated and fail-closed. A seller owner may submit
an application, but only the admin verification route can bind a `bytes32`
PartnerVault ID. Verification reads the configured chain and requires deployed
contract bytecode, matching BuilderRegistry owner / PartnerVault admin, an active
BuilderRegistry entry, an active PartnerVault partner and a beneficiary equal to
the seller owner wallet.

A successful redeem creates a `PENDING` reward outbox row in the same SQLite
transaction only for a locally verified link. Seller owner and active checkout
operator wallets are excluded from reward eligibility. The admin reconciliation
route repeats all live governance checks, checks PartnerVault anti-double-count
state and moves the event to `READY`, `BLOCKED_CALLER` or `CONFIRMED`. It never
signs or broadcasts `recordLockReward`.

`REWARD_CALLER_ADDRESS` is only a public address used for the read-only
`authorizedCaller` check. No private key, mnemonic or transaction signer belongs
in this backend. `READY` means contract preconditions were observed; it does not
mean submitted, confirmed, vested or paid. Reward amounts remain dynamic until an
authorized transaction executes.

Admin routes remain available for operator setup and recovery, but the public
seller UX should prefer wallet-owned businesses.

Public seller creation is intentionally capped per wallet. The default is five
active seller profiles per owner wallet; inactive businesses do not count.
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
the smoke rule again. It also creates a QR session for that rule, signs the
customer challenge, submits `/api/attest` and signs the seller-owned redeem
attempt. Without `CUSTOMER_PRIVATE_KEY` the customer wallet is throwaway and
should receive a retryable rejected attest response from the live IFRLock check;
signed redeem is expected to be blocked because the session is not approved.
With `CUSTOMER_PRIVATE_KEY`, use a real eligible customer wallet to verify the
approved-and-redeemed path. The script then soft-deactivates the smoke seller
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
