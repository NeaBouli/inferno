# Benefits Network — Test Guide

## Quick Start (Local)

```bash
# Start backend
cd apps/benefits-network/backend
cp .env.example .env
npm install && npm run dev

# Start frontend (new terminal)
cd apps/benefits-network/frontend
npm install && npm run dev

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
6. If the wallet needs more locked IFR, the customer can lock more IFR and retry the same QR session while it is still valid and attempts remain
7. Optional: "Redeem" -> Status changes to REDEEMED

## E2E Test Script

The script (`apps/benefits-network/backend/scripts/e2e-test.sh`) runs automatically:

1. Health Check (`GET /health`)
2. Create Business (`POST /api/admin/businesses`)
3. Start QR Session (`POST /api/sessions`)
4. Get Challenge (`GET /api/sessions/:id/challenge`)
5. Submit Attest (`POST /api/attest`)
6. Check Session Status (`GET /api/sessions/:id`)

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
- Desktop and iPad rendering for landing, guide, seller mode, seller scanner shell and customer proof shell
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
behavior. Do not record private keys, seed phrases or personal wallet data in
the checklist.

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

## Backend HTTP Smoke

The Benefits Network CI also starts the built backend locally and runs the
seller wallet smoke in read-only mode:

```bash
cd apps/benefits-network/backend
npm run build
npm run smoke:http
```

This verifies the real Express HTTP surface for `/api/health`, `/api/ready`,
`/api/seller/auth-message` and signed seller profile listing with a throwaway
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
- repeated redeem -> HTTP 409

This proves the backend redeem route is seller-owned and one-time at the HTTP
boundary. A live `APPROVED -> REDEEMED` run with a real locked customer wallet
is still a separate device acceptance item.

Current service coverage also verifies retryable failed attestations:

- insufficient locked IFR returns `REJECTED` to the customer response, but keeps
  the stored session `PENDING` until the three-attempt limit is exhausted
- invalid signatures behave the same way, so a customer can recover from a bad
  wallet prompt without forcing the seller to create a new QR immediately
- after the third failed attempt the session becomes terminal `REJECTED`

## Lock Tiers

| Tier | Minimum Lock | Typical Discount |
|------|-------------|-----------------|
| Bronze | 1,000 IFR | 5-10% |
| Silver | 5,000 IFR | 10-15% |
| Gold | 25,000 IFR | 15-25% |
| Diamond | 100,000 IFR | 25%+ |

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
| GET | `/api/businesses/:id` | - | Public business info |
| GET | `/api/businesses/:id/rules` | - | Active public rules |
| POST | `/api/sessions` | - | Start QR session, optionally with `benefitRuleId` |
| GET | `/api/sessions/:id` | - | Session status |
| GET | `/api/sessions/:id/challenge` | - | Signature challenge |
| POST | `/api/attest` | - | Verify wallet + signature |
| POST | `/api/sessions/:id/redeem` | Seller wallet signature | Redeem approved session |

---
*As of: July 2026 | Version 1.1*
