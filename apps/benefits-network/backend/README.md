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

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/businesses` | Admin | Create business |
| PATCH | `/api/admin/businesses/:id` | Admin | Update business |
| GET | `/api/admin/businesses/:id/rules` | Admin | List all benefit rules for a business |
| POST | `/api/admin/businesses/:id/rules` | Admin | Create a benefit rule |
| PATCH | `/api/admin/rules/:id` | Admin | Update or pause a benefit rule |
| DELETE | `/api/admin/rules/:id` | Admin | Delete a benefit rule |
| GET | `/api/businesses/:id` | Public | Get business info |
| GET | `/api/businesses/:id/rules` | Public | List active public benefit rules |
| POST | `/api/sessions` | Public | Start verification session |
| GET | `/api/sessions/:id` | Public | Poll session status |
| GET | `/api/sessions/:id/challenge` | Public | Get signature challenge |
| POST | `/api/attest` | Public | Submit signature + verify |
| POST | `/api/sessions/:id/redeem` | Public | Mark session as redeemed |

## Session Flow

1. Merchant creates session → gets QR code URL
2. Customer scans QR → connects wallet → signs challenge
3. Backend verifies signature → checks IFRLock on-chain
4. Merchant sees APPROVED → presses Redeem (one-time)

## Benefit Rules

Benefit rules are persisted seller offers tied to a business. They currently sit
beside the legacy business-level discount so old QR sessions remain compatible.

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

## Tests

```bash
npm test   # 8 tests: signature, expiry, replay, redeem, threshold, rate-limit
```

## Security

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full threat model.
