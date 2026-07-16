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
| `IFRLOCK_ADDRESS` | IFRLock contract address | required |
| `ADMIN_SECRET` | Bearer token for /api/admin/* | required |
| `DATABASE_URL` | Prisma database URL | `file:./dev.db` |
| `PORT` | Server port | `3001` |
| `MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET` | Anti-spam cap for active wallet-owned seller profiles | `5` |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/businesses` | Admin | Create business |
| PATCH | `/api/admin/businesses/:id` | Admin | Update business |
| GET | `/api/admin/businesses/:id/rules` | Admin | List all benefit rules for a business |
| POST | `/api/admin/businesses/:id/rules` | Admin | Create a benefit rule |
| PATCH | `/api/admin/rules/:id` | Admin | Update or pause a benefit rule |
| DELETE | `/api/admin/rules/:id` | Admin | Delete a benefit rule |
| GET | `/api/seller/auth-message` | Public | Issue server-time wallet message for seller actions |
| POST | `/api/seller/businesses` | Seller wallet signature | Create wallet-owned seller business |
| GET | `/api/seller/businesses` | Seller wallet signature | List active seller businesses owned by the wallet |
| DELETE | `/api/seller/businesses/:id` | Seller wallet signature | Soft-deactivate owned seller business and active rules |
| GET | `/api/seller/businesses/:id/rules` | Seller wallet signature | List owned benefit rules |
| POST | `/api/seller/businesses/:id/rules` | Seller wallet signature | Create owned benefit rule |
| PATCH | `/api/seller/rules/:id` | Seller wallet signature | Update or pause owned benefit rule |
| DELETE | `/api/seller/rules/:id` | Seller wallet signature | Delete owned benefit rule |
| GET | `/api/businesses/:id` | Public | Get business info |
| GET | `/api/businesses/:id/rules` | Public | List active public benefit rules |
| POST | `/api/sessions` | Public | Start verification session, optionally bound to a seller benefit rule |
| GET | `/api/sessions/:id` | Public | Poll session status |
| GET | `/api/sessions/:id/challenge` | Public | Get signature challenge |
| POST | `/api/attest` | Public | Submit signature + verify |
| POST | `/api/sessions/:id/redeem` | Public | Mark session as redeemed |

## Session Flow

1. Merchant selects a seller rule or falls back to the business default.
2. Merchant creates session → gets QR code URL.
3. Customer scans QR → connects wallet → signs challenge with the selected benefit details.
4. Backend verifies signature → checks IFRLock on-chain against that rule's required IFR amount.
5. Merchant sees APPROVED → presses Redeem (one-time).

## Benefit Rules

Benefit rules are persisted seller offers tied to a business. A QR session can
now be bound to one active rule by passing `benefitRuleId` to `POST /api/sessions`.
If no rule is passed, the legacy business-level discount remains the fallback so
old QR sessions stay compatible.

```json
{
  "label": "Bronze",
  "category": "Coffee",
  "productName": "Premium customer discount",
  "discountPercent": 10,
  "requiredLockIFR": 1000,
  "ttlSeconds": 90,
  "active": true
}
```

```json
{
  "businessId": "business_cuid",
  "benefitRuleId": "optional_active_rule_cuid"
}
```

## Seller Wallet Ownership

Normal seller actions can be authorized without sharing the global admin secret.
The frontend first requests `/api/seller/auth-message` so the timestamp is issued
by the backend, then the seller signs that short-lived EIP-191 message with the
wallet that owns the business. The backend checks the recovered address against
`Business.ownerAddress` before listing, creating, updating or deleting rules.

Seller write requests use these headers:

```http
x-ifr-wallet: 0xSellerWallet
x-ifr-signature: 0xSignature
x-ifr-timestamp: 1784210000000
```

The signed message format is deterministic:

```text
IFR Benefits Network - Seller Authorization
Action: rules:create
Business: business_cuid
Timestamp: 1784210000000
Only sign this message inside shop.ifrunit.tech.
```

Admin routes remain available for operator setup and recovery, but the public
seller UX should prefer wallet-owned businesses.

Public seller creation is intentionally capped per wallet. The default is five
active seller profiles per owner wallet; inactive businesses do not count.

## Tests

```bash
npm test   # resets local SQLite test DB, then runs signature, expiry, replay, redeem, threshold and seller-auth tests
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
customer challenge and submits `/api/attest`. Without `CUSTOMER_PRIVATE_KEY` the
customer wallet is throwaway and should be rejected by the live IFRLock check;
redeem is expected to be blocked. With `CUSTOMER_PRIVATE_KEY`, use a real
eligible customer wallet to verify the approved-and-redeemed path. The script
then soft-deactivates the smoke seller profile so it no longer appears in owned
active profile reloads. Seller private keys are generated in memory. The optional
customer private key is never printed.

## Security

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full threat model.
