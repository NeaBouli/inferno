# Benefits Network — Test Guide

## Runtime Contract

Benefits frontend, backend, CI and production containers use Node.js 22.x. Verify the shared
runtime contract before running the wider suite:

```bash
npm run test:benefits-node-runtime
```

The blocking Benefits CI builds both Alpine Docker images, starts them through their normal
production commands and checks backend migration/readiness plus the Next.js server, guide and
PWA manifest. A version-only image check is not sufficient.

## Release Preflight

Run the same static release-evidence bundle used by the device-checklist CI job:

```bash
npm run preflight:benefits -- --static
```

Before push or deployment, use a clean worktree with installed dependencies and run the full
sequential local battery:

```bash
npm run preflight:benefits
```

The command fails closed on uncommitted files, stale or incomplete acceptance contracts, test
failures, audits, builds and browser gates. A green local preflight does not satisfy the physical
device/wallet matrix, provision a production WalletConnect Project ID, authorize rewards, run
Mainnet transactions, prove exact-head CI or authorize deployment.

### Release order: wallet-free seller challenge (owner decision B)

`GET /api/seller/auth-message` is wallet-free: no wallet in the URL, the response or the challenge
row; a legacy `walletAddress` parameter is ignored and never echoed. Earlier `ifr-sdk` builds
(<= 0.3.0, repository tarballs only; never on npm) require `challenge.walletAddress` in the response and reject every challenge from this
backend, so their seller checkout flows break. Publish and roll out `ifr-sdk` 0.4.0 (wallet-free) first,
then release the backend. The same release still needs the separate owner-B migration gate
(backup, migrate, VACUUM, `node scripts/verify-owner-b-migration.cjs --scan <copy>`), and the edge
access logs must be checked for query strings of old clients.

Receipt context check (fails closed): device receipts verify only when the backend's
`SELLER_AUTH_DOMAIN` equals the frontend host and its `CHAIN_ID` equals the frontend
`NEXT_PUBLIC_CHAIN_ID` as Compose resolves it. Gated release step, from a clean shell (any exported
`SELLER_AUTH_DOMAIN`, `CHAIN_ID` or `NEXT_PUBLIC_CHAIN_ID` fails it, because the shell outranks the
env file in Compose interpolation): `npm run check:benefits-proof-context -- --env <compose env file>
--public-host shop.ifrunit.tech` (no defaults; the frontend chain falls back only to the literal
compose default; values are never printed; CI runs `npm run test:benefits-proof-context`); after a
release `scripts/smoke-benefits-network.js` asserts the live challenge's domain and chain against
the served host and `NEXT_PUBLIC_CHAIN_ID` (default 1).

## Quick Start (Local)

```bash
# Start backend
cd apps/benefits-network/backend
cp .env.example .env
npm ci && npm run dev

# Start frontend (new terminal)
cd apps/benefits-network/frontend
npm ci && npm run dev

# Run the local full-stack E2E gate (starts its own disposable loopback
# servers; does not need the dev servers above)
bash apps/benefits-network/backend/scripts/e2e-test.sh
```

## Sepolia Test Prerequisites

- Sepolia ETH available (for gas)
- At least 1,000 IFR on Sepolia (Bronze Tier)
- IFR Token added to MetaMask:
  - Address: `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`
  - Decimals: **9** (not 18!)
  - Symbol: IFR
- `IFRLOCK_ADDRESS` configured in backend `.env`

## Test Flow (Manual)

1. Start backend + frontend (see Quick Start)
2. Browser: `http://localhost:3000/b/{businessId}` (Merchant Console)
3. "Create QR session" -> QR code appears
4. Wallet app -> Scan QR -> Sign the exact checkout proof
5. A valid, eligible proof redeems the checkout once: merchant screen shows REDEEMED. An
   ineligible or failed proof leaves the checkout open (pending retry guidance) until it expires
   or attempts run out
6. If the wallet needs more locked IFR or a configured free-wallet IFR minimum, the customer can
   correct that exact condition and retry the same QR session while it is still valid and attempts
   remain
7. There is no separate seller "Redeem" step (`POST /api/sessions/:id/redeem` returns 410)

## E2E Test Script

The script (`apps/benefits-network/backend/scripts/e2e-test.sh`) is a safe wrapper around the
canonical local full-stack E2E gate:

```bash
bash apps/benefits-network/backend/scripts/e2e-test.sh
```

It reads no URL, admin secret or wallet input, verifies it is running inside a fully installed
repository (and fails closed otherwise), then delegates to `npm run test:benefits-fullstack`
(described below). The retired `/api/verification/*` route flow no longer exists; QR sessions are
created through `POST /api/sessions` with a seller owner/operator one-time signature, and the
wrapper never creates businesses, sessions or signatures against a configured backend.

The wrapper has no configuration. The old `BASE_URL` and `ADMIN_SECRET` overrides were removed
with the retired route flow.

The browser contract test covers the complete recommended two-phase UI flow with isolated
customer and seller wallet providers and deterministic no-Mainnet API fixtures:

```bash
npm run test:benefits-pass-ui
```

It asserts pass creation, seller/rule binding, exact-offer customer confirmation, seller-auth
headers, one-time `REDEEMED`, and the disabled replay action. Its API fixtures still model the
retired `APPROVED`-then-seller-redeem flow and must be updated to the storage-free customer
session flow, where the customer proof redeems the checkout. It complements rather
than replaces backend route/race tests or the physical device acceptance matrix.

The customer wallet transaction contract test runs the actual Shop controls against an isolated
EIP-1193 wallet and deterministic JSON-RPC state:

```bash
npm run test:benefits-wallet-ui
```

It verifies exact 9-decimal approval calldata, IFRLock spender and contract addresses, receipt-
driven allowance/balance refresh, the `1,000 IFR` access transition, full simple-lock unlock and
restored balances. A dedicated reconnect mode also proves connect -> reload -> restored session
-> disconnect -> reload stays disconnected -> reconnect. No Mainnet transaction or external
wallet is used.

The blocking accessibility gate audits Customer and Seller home modes, guide and QR scanner with
Axe WCAG 2.0/2.1 A/AA rules on desktop, iPad and Android emulation. Build and start the frontend
before running it locally:

```bash
npm run build --prefix apps/benefits-network/frontend
npm start --prefix apps/benefits-network/frontend
BENEFITS_BASE_URL=http://127.0.0.1:3000 npm run test:benefits-a11y
```

It also rejects viewport metadata that disables browser zoom. Automated emulation does not replace
the physical device and wallet acceptance matrix.

The production build also has a role-scoped mobile bundle gate:

```bash
npm run build --prefix apps/benefits-network/frontend
npm run test:benefits-bundle
```

It keeps Seller management out of the default Customer bundle, requires a separate on-demand
Seller chunk, limits the home route chunk to 100,000 raw bytes and caps initial home JavaScript at
240,000 gzip bytes. The budget is a regression guard for mobile entry, not a substitute for
real-device network and interaction measurements.

The same local production server is used for the CSP compatibility gate:

```bash
BENEFITS_BASE_URL=http://127.0.0.1:3000 npm run test:benefits-csp
```

It requires the enforced baseline and the broader Report-Only candidate on the Customer/Seller,
guide, scanner, business, catalog, session and pass route shells; exercises the manifest and
service worker; and fails on browser policy violations. Dynamic routes use a safe nonexistent
resource state, so promotion of the complete candidate policy to enforcement still requires the
production WalletConnect Project ID and physical wallet/device evidence.

The composed full-stack gate validates the production integration boundary without mocks:

```bash
npm run test:benefits-fullstack
```

It applies every SQLite migration to a unique disposable database, builds and starts the real
Express and Next.js production servers on loopback, creates a seller, product and active offer
through signed seller API calls, and verifies public discovery, seller catalog navigation and
selected-offer handoff in Chromium through the real Next.js `/api` rewrite. The wallet and database
are throwaway, cleanup is automatic, RPC points to a closed loopback port, and neither Mainnet nor
production is contacted.

The backend suite includes a local JSON-RPC contract boundary for Ethers 6:

```bash
cd apps/benefits-network/backend
npm test
```

It verifies IFRLock, active `TIME_ONLY` CommitmentVault tranches and optional free-wallet IFR
threshold conversion with native `bigint`, exact 9-decimal boundary comparisons, same-block reads
and balance formatting. It proves that `either` never combines partial balances, price-conditioned
tranches do not qualify, source token mismatches and malformed/oversized tranche data fail closed,
and a Commitment-only rule does not depend on an IFRLock read. It also covers reward contract tuple
decoding, the actual RPC chain ID, zero-beneficiary fail-closed behavior and read-only wallet-reward
checks. The fixture never submits a transaction or contacts Mainnet.
CI also runs `npm run test:ethers-v6-lifecycle` without Jest's `--forceExit`, including an RPC
rejection followed by a successful read to cover provider cleanup on error and success paths.

## Read-only Live Smoke

Use the repo-level live smoke for the current public Shop surface:

```bash
npm run smoke:benefits
BENEFITS_BASE_URL=http://localhost:3000 npm run smoke:benefits
SCREENSHOT_DIR=/Users/gio/Desktop npm run smoke:benefits
```

Default target is `https://shop.ifrunit.tech`. The smoke is read-only and checks:

- `/api/health` on Ethereum Mainnet (`chainId: 1`)
- `/api/ready` with a live database readiness probe
- PWA manifest, icons and service worker
- Server-issued seller auth challenge
- Desktop and iPad rendering for landing, guide, seller mode, seller scanner shell, public seller catalog and customer proof shell
- Wallet-entry fallback with copy/share controls
- Empty-state rendering for local `Recent customer proofs` history

It intentionally does not create businesses, rules or sessions. For signed
seller flows use `apps/benefits-network/backend/scripts/seller-wallet-smoke.js`.
For the full proof-to-redeemed path, run that seller smoke with
`CUSTOMER_PRIVATE_KEY=... MUTATE=true` using a real eligible locked customer
wallet.

## Real Device Wallet Acceptance

Use the dedicated runbook before closing the real wallet/device test gap:

- `docs/runbooks/BENEFITS_DEVICE_WALLET_TEST_RUNBOOK.md`
- `docs/qa/BENEFITS_DEVICE_WALLET_CHECKLIST.json`

Validate the checklist structure before and after recording device evidence:

```bash
npm run qa:benefits-devices
```

Print the current acceptance status without changing evidence:

```bash
npm run qa:benefits-report
```

Record real-device evidence through the safe recorder rather than editing JSON
manually:

```bash
npm run qa:benefits-record -- \
  --id ios-safari-pwa \
  --status pass \
  --source physical-device \
  --note "iPadOS Safari install guidance visible; copy/share wallet entry readable."
```

The required matrix covers iPad/iPhone, Android, desktop extension wallets,
MetaMask, Coinbase Wallet, Trust Wallet, OKX Wallet and Phantom fallback
behavior. Automated browser smokes validate the official MetaMask, Trust, OKX
and Phantom launch domains on emulated iPad and Android. The local discovery
browser test also proves that a Phantom-only `window.phantom.ethereum` provider
is detected once, selected over the universal fallback and receives the account
request. These automated checks do not replace a real installed-wallet
connection, signature and transaction test.
The recorder therefore accepts `pass` only with `--source physical-device`;
emulator or automated evidence cannot close a physical matrix row.
Do not record private keys, seed phrases or personal wallet data in the checklist.

Customer QR pages also write a local browser history entry; after a checkout proof it
keeps a signed receipt (proof text and signature). The home page shows this as `Recent
customer proofs` so a customer can reopen the proof on the same device. This device-local
history is the only customer history (the backend keeps none); it excludes private keys,
seed phrases and full wallet inventories, is not a server-side evidence record and does not
replace the device checklist. Receipt verification on the device binds the proof to this
deployment's audience (page host) and chain and requires a 32-byte nonce; its duplicate check
is local only (the bounded 12-item device history), not global replay prevention. Single
redemption is enforced by the backend.

The landing integration generator also exposes a `pos` mode. Its generated server-side
JavaScript creates a rule-bound session and returns a full `customerUrl` for the seller's
QR renderer. Business IDs are URL-encoded in links and JSON-serialized in API snippets.

The seller session-history response is protected by the owner-wallet signature and also
returns activity metrics for today's and all-time checks, redemptions, open checks and
approval rate. Today's redemptions use the redemption timestamp, and expired QR sessions
are excluded from open checks and from the approval-rate denominator.

Seller benefit rules support an explicit Edit -> Update / Cancel flow. Updates reuse the
owner-wallet-protected PATCH route and preserve whether the rule was active or paused.

Business owners can add, list and revoke expiring checkout operators. Operators can only
check their checkout role and open checkouts; owner-only profile, rule, history
and team-management routes reject them. The customer proof redeems a checkout atomically and
once under concurrent requests; the operator's authority is re-checked in that transaction and
the `REDEEMED` audit payload records the opening seller's wallet/role without storing any
signature or customer wallet.

Seller owners can create, edit and archive products/services, then bind rules to active
catalog items. `tests/catalogRoutes.test.ts` covers owner authorization, cross-business
binding rejection, public active-only reads, archive behavior and immutable session terms.
The public customer catalog is available at `/s/{businessId}`. Run
`npm run test:migration-upgrade` to verify a populated prior database keeps its business,
rule, session and audit rows while adding the catalog, snapshot and reward-ledger schema.

`tests/rewardRoutes.test.ts` covers the M4 reward foundation: owner-only application,
admin-only live verification, fail-closed governance changes, atomic redeem/outbox creation
(one non-payable `BLOCKED_POLICY` event per checkout; no customer wallet is stored), owner
self-dealing exclusion and owner-only reward visibility. The production backend does not contain a
transaction signer and cannot submit `recordLockReward`.

## Backend HTTP Smoke

The Benefits Network CI also starts the built backend locally and runs the
seller wallet smoke in read-only mode:

```bash
cd apps/benefits-network/backend
npm run build
npm run smoke:http
```

This verifies the real Express HTTP surface for `/api/health`, `/api/ready`,
the wallet-free one-time `/api/seller/auth-message` read challenge and signed seller profile listing with a throwaway
wallet. `/api/ready` runs a database probe so CI catches a backend that can
listen on HTTP but cannot serve sessions. It does not mutate production or
require secrets. `MUTATE=true` remains manual-only for
create/rule/session/proof path checks.

## Backend Route Tests

Backend Jest tests include service-level and HTTP-route coverage:

```bash
cd apps/benefits-network/backend
npm test
```

Current route coverage (`tests/redeemRoutes.test.ts`, `tests/customerSessionPrivacy.test.ts`)
includes:

- `POST /api/sessions/:id/redeem` -> HTTP 410 with or without seller authorization
- opening a checkout requires a current owner/operator one-time signature; replay -> HTTP 401
- a customer proof whose recovered signer differs from the claimed wallet -> HTTP 403, no change
- a valid eligible proof -> `REDEEMED` exactly once; racing proofs redeem only once
- a proof against an `EXPIRED` or `REJECTED` session -> HTTP 409, session unchanged
- an operator revoked or expired after opening the checkout -> HTTP 409, checkout stays open
- non-zero per-customer limits are refused

A live customer-proof-to-`REDEEMED` run with a real locked customer wallet is still a separate
device acceptance item.

Mutation-route coverage also requests server-issued challenges for business,
operator, product, rule, reward, session-create and pass-bind actions. Tests
assert exact resource scope, single-use replay rejection, wrong-owner denial,
concurrency behavior and that read-only authorization requests create no challenge rows.

Current service coverage also verifies retryable failed attestations:

- insufficient locked IFR returns `REJECTED` to the customer response and leaves the
  stored session `PENDING` with no state change (attempts are not consumed)
- invalid signatures behave the same way, so a customer can recover from a bad
  wallet prompt without forcing the seller to create a new QR immediately
- an RPC failure returns HTTP 503 without detail and also leaves the checkout open
- the checkout stays open until it is redeemed once or expires

## Example Lock Tiers

These values are a wallet guidance example, not protocol-wide discount promises. Each seller
publishes the exact IFRLock threshold and benefit for every real offer.

| Example tier | Minimum IFRLock |
|--------------|-----------------|
| Bronze | 1,000 IFR |
| Silver | 2,500 IFR |
| Gold | 5,000 IFR |
| Platinum | 10,000 IFR |

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `isLocked returns false` | IFR not locked | Call `IFRLock.lock(amount)` |
| `Decimals error` | 18 instead of 9 | Use `parseUnits(x, 9)` |
| `Session expired` | >60s elapsed | Start a new session |
| `Invalid signature` | Wrong wallet prompt or malformed signature | Retry the same QR while attempts remain; switch to the configured chain if the wallet is on the wrong network |
| `ADMIN_SECRET mismatch` | `.env` not configured | Set `ADMIN_SECRET` in `.env` |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | - | Health check |
| GET | `/ready` | - | Readiness check with database probe |
| GET | `/api/health` | - | API health check |
| GET | `/api/ready` | - | API readiness check with database probe |
| POST | `/api/admin/businesses` | Admin | Create business |
| PATCH | `/api/admin/businesses/:id` | Admin | Update business |
| GET | `/api/admin/businesses/:id/rules` | Admin | List seller benefit rules |
| POST | `/api/admin/businesses/:id/rules` | Admin | Create seller benefit rule |
| PATCH | `/api/admin/rules/:id` | Admin | Update or pause rule |
| DELETE | `/api/admin/rules/:id` | Admin | Delete rule |
| POST | `/api/admin/businesses/:id/rewards/verify` | Admin | Verify a seller reward application against live governance state |
| POST | `/api/admin/businesses/:id/rewards/revoke` | Admin | Revoke a seller reward link |
| POST | `/api/admin/businesses/:id/rewards/queue` | Admin | Queue eligible reward outbox events for a verified seller |
| GET | `/api/seller/auth-message` | - | Issue a server-time, wallet-free seller challenge (`action`, `businessId`, `scope`; nonce-only state, the signer is recovered from the signature; a legacy `walletAddress` is ignored; a scope or business containing an address is rejected. `operators:create` and `rewards:reward-wallet` use the fixed scopes `operator-wallet` / `reward-wallet` / `owner-wallet`; their target wallet is sent only in the authenticated request body and signed as a final `Target: 0x...` line (lowercase) that the backend rebuilds from the body) |
| POST | `/api/seller/businesses` | Seller owner signature | Create wallet-owned seller profile |
| GET | `/api/seller/businesses` | Seller owner signature | List owned active profiles |
| DELETE | `/api/seller/businesses/:id` | Seller owner signature | Deactivate owned profile |
| GET | `/api/seller/businesses/:id/rules` | Seller owner signature | List owned rules |
| POST | `/api/seller/businesses/:id/rules` | Seller owner signature | Create owned rule |
| PATCH | `/api/seller/rules/:id` | Seller owner signature | Update owned rule |
| DELETE | `/api/seller/rules/:id` | Seller owner signature | Delete owned rule |
| GET | `/api/seller/businesses/:id/sessions` | Seller owner signature | List recent checkout history and metrics |
| GET | `/api/seller/businesses/:id/operator-status` | Owner/operator signature | Confirm checkout role |
| GET | `/api/seller/businesses/:id/operators` | Seller owner signature | List checkout operators |
| POST | `/api/seller/businesses/:id/operators` | Seller owner signature | Add/reactivate checkout operator |
| DELETE | `/api/seller/operators/:id` | Seller owner signature | Revoke checkout operator |
| POST | `/api/seller/businesses/:id/rewards/apply` | Seller owner signature | Apply for seller rewards |
| POST | `/api/seller/businesses/:id/rewards/disable` | Seller owner signature | Disable seller rewards until a fresh application |
| POST | `/api/seller/businesses/:id/rewards/reward-wallet` | Owner + reward wallet signature | Set or clear the reward payout wallet |
| GET | `/api/seller/businesses/:id/rewards` | Seller owner signature | Reward link status, on-chain state and event count |
| GET | `/api/businesses/:id` | - | Public business info |
| GET | `/api/businesses/:id/rules` | - | Active public rules |
| POST | `/api/sessions` | Owner/operator one-time signature | Start QR session, optionally with `benefitRuleId` |
| GET | `/api/sessions/:id` | - | Session status |
| POST | `/api/sessions/:id/challenge` | - | Exact proof text for `{walletAddress}` (GET -> 410) |
| POST | `/api/attest` | Customer signature | `{sessionId, walletAddress, signature}`; redeems the checkout once |
| POST | `/api/sessions/:id/redeem` | - | Retired, always 410 |
| POST | `/api/passes/challenge` | - | Retired, always 410 |
| POST | `/api/passes` | - | Create customer pass (empty body, no wallet) |
| GET | `/api/passes/:id` | - | Public customer pass state |
| GET | `/api/passes/:id/control` | Pass control token | Controlled pass state for the originating tab |
| POST | `/api/passes/:id/bind` | Owner/operator signature | Bind pass to an exact seller offer |
| POST | `/api/passes/:id/challenge` | Pass control token | Exact proof text for `{walletAddress}` |
| POST | `/api/passes/:id/confirm` | Customer signature + control token | `{walletAddress, signature}`; redeems the checkout once (`REDEEMED`/`REJECTED`) |
| POST | `/api/passes/:id/cancel` | Pass control token | Cancel the pass |
| any | `/api/customer/history*` | - | Retired, 410 (`storage: device-local`) |

---
*As of: July 2026 | Version 1.1*
