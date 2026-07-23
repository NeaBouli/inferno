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

## Quick Start (Local)

```bash
# Start backend
cd apps/benefits-network/backend
cp .env.example .env
npm ci && npm run dev

# Start frontend (new terminal)
cd apps/benefits-network/frontend
npm ci && npm run dev

# Run E2E test (new terminal)
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
4. Wallet app -> Scan QR -> Sign
5. Merchant screen shows: APPROVED, pending retry guidance, or terminal REJECTED
6. If the wallet needs more locked IFR or a configured free-wallet IFR minimum, the customer can
   correct that exact condition and retry the same QR session while it is still valid and attempts
   remain
7. Optional: "Redeem" -> Status changes to REDEEMED

## E2E Test Script

The script (`apps/benefits-network/backend/scripts/e2e-test.sh`) runs automatically:

1. Health Check (`GET /health`)
2. Create Business (`POST /api/admin/businesses`)
3. Start QR Session (`POST /api/sessions`)
4. Get Challenge (`GET /api/sessions/:id/challenge`)
5. Submit Attest (`POST /api/attest`)
6. Check Session Status (`GET /api/sessions/:id`)

The browser contract test covers the complete recommended two-phase UI flow with isolated
customer and seller wallet providers and deterministic no-Mainnet API fixtures:

```bash
npm run test:benefits-pass-ui
```

It asserts pass creation, seller/rule binding, exact-offer customer confirmation, seller-auth
headers, `APPROVED`, one-time `REDEEMED`, and the disabled replay action. It complements rather
than replaces backend route/race tests or the physical device acceptance matrix.

The customer wallet transaction contract test runs the actual Shop controls against an isolated
EIP-1193 wallet and deterministic JSON-RPC state:

```bash
npm run test:benefits-wallet-ui
```

It verifies exact 9-decimal approval calldata, IFRLock spender and contract addresses, receipt-
driven allowance/balance refresh, the `1,000 IFR` access transition, full simple-lock unlock and
restored balances. No Mainnet transaction or external wallet is used.

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

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3001` | Backend URL |
| `ADMIN_SECRET` | from `.env` | Admin token for business creation |

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
For the full approved-and-redeemed path, run that seller smoke with
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
  --note "iPadOS Safari install guidance visible; copy/share wallet entry readable."
```

The required matrix covers iPad/iPhone, Android, desktop extension wallets,
MetaMask, Coinbase Wallet, Trust Wallet, OKX Wallet and Phantom fallback
behavior. Automated browser smokes validate the official MetaMask, Trust, OKX
and Phantom launch domains on emulated iPad and Android, but this does not
replace a real installed-wallet connection, signature and transaction test.
Do not record private keys, seed phrases or personal wallet data in the checklist.

Customer QR pages also write a redacted local browser history entry after a
session loads or refreshes. The home page shows this as `Recent customer proofs`
so a customer can reopen the proof on the same device. The local entry excludes
private keys, seed phrases, signatures and full wallet inventories; it is not a
server-side evidence record and does not replace the device checklist.

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
check their checkout role and redeem approved sessions; owner-only profile, rule, history
and team-management routes reject them. Redemption is atomic under concurrent requests,
and the audit payload records actor wallet/role without storing the signature.

Seller owners can create, edit and archive products/services, then bind rules to active
catalog items. `tests/catalogRoutes.test.ts` covers owner authorization, cross-business
binding rejection, public active-only reads, archive behavior and immutable session terms.
The public customer catalog is available at `/s/{businessId}`. Run
`npm run test:migration-upgrade` to verify a populated prior database keeps its business,
rule, session and audit rows while adding the catalog, snapshot and reward-ledger schema.

`tests/rewardRoutes.test.ts` covers the M4 reward foundation: owner-only application,
admin-only live verification, fail-closed governance changes, atomic redeem/outbox creation,
one reward event per wallet/partner, 9-decimal base-unit conversion, owner self-dealing
exclusion and owner-only reward visibility. The production backend does not contain a
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
the stateless read-only `/api/seller/auth-message` path and signed seller profile listing with a throwaway
wallet. `/api/ready` runs a database probe so CI catches a backend that can
listen on HTTP but cannot serve sessions. It does not mutate production or
require secrets. `MUTATE=true` remains manual-only for
create/rule/session/redeem path checks.

## Backend Route Tests

Backend Jest tests include service-level and HTTP-route coverage:

```bash
cd apps/benefits-network/backend
npm test
```

Current route coverage includes `POST /api/sessions/:id/redeem` authorization:

- missing seller signature -> HTTP 401
- wrong seller wallet -> HTTP 403
- owning seller wallet -> HTTP 200 and `REDEEMED`
- replaying the same redeem nonce -> HTTP 401

This proves the backend redeem route is seller-owned and one-time at the HTTP
boundary. A live `APPROVED -> REDEEMED` run with a real locked customer wallet
is still a separate device acceptance item.

Mutation-route coverage also requests server-issued challenges for business,
operator, product, rule, reward, session-create and session-redeem actions. Tests
assert exact resource scope, single-use replay rejection, wrong-owner denial,
concurrency behavior and that read-only authorization requests create no challenge rows.

Current service coverage also verifies retryable failed attestations:

- insufficient locked IFR returns `REJECTED` to the customer response, but keeps
  the stored session `PENDING` until the three-attempt limit is exhausted
- invalid signatures behave the same way, so a customer can recover from a bad
  wallet prompt without forcing the seller to create a new QR immediately
- after the third failed attempt the session becomes terminal `REJECTED`

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
| GET | `/api/seller/auth-message` | - | Issue a server-time seller wallet challenge |
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
| GET | `/api/businesses/:id` | - | Public business info |
| GET | `/api/businesses/:id/rules` | - | Active public rules |
| POST | `/api/sessions` | Owner/operator one-time signature | Start QR session, optionally with `benefitRuleId` |
| GET | `/api/sessions/:id` | - | Session status |
| GET | `/api/sessions/:id/challenge` | - | Signature challenge |
| POST | `/api/attest` | - | Verify wallet + signature |
| POST | `/api/sessions/:id/redeem` | Owner/operator signature | Atomically redeem approved session |

---
*As of: July 2026 | Version 1.1*
