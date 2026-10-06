# IFR Points Backend

Points system for Inferno ($IFR) — SIWE authentication, points events, and EIP-712 signed voucher issuance.

## Features

- **SIWE Authentication**: Sign-In with Ethereum — wallet-based auth, JWT sessions
- **Points Events**: Track user actions (wallet connect, guide completion, builder onboarding)
- **Daily Limits**: Per-event-type daily caps to prevent abuse
- **EIP-712 Vouchers**: Signed discount vouchers redeemable on-chain via FeeRouter; issuance
  atomically consumes the configured points threshold
- **Anti-Sybil**: Rate limiting per IP + per wallet + global daily caps

## Setup

```bash
cd apps/points-backend
npm ci
cp .env.example .env
# Edit .env — set every required mainnet, SIWE and signing value
npx prisma migrate dev --name init
npm run dev
```

Server runs on http://localhost:3004

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/siwe/nonce` | No | Generate SIWE nonce |
| POST | `/auth/siwe/verify` | No | Verify SIWE signature, get JWT |
| POST | `/points/event` | JWT | Record a points event |
| GET | `/points/balance` | JWT | Get wallet balance + event history |
| POST | `/voucher/issue` | JWT + lock proof | Atomically redeem points and issue a signed EIP-712 voucher |
| GET | `/voucher/validate/:nonce` | No | Validate status without disclosing wallet identity |
| GET | `/health` | No | Health check |

## Points Events

| Type | Points | Daily Limit |
|------|--------|-------------|
| `wallet_connect` | 10 | 1 |
| `guide_wallet_setup` | 20 | 1 |
| `guide_add_token` | 20 | 1 |
| `guide_lock` | 30 | 1 |
| `partner_onboarding` | 50 | 1 |

**Voucher threshold:** 100 available points → an EIP-712 signed voucher that waives the FeeRouterV1
protocol (swap) fee, up to the current on-chain `protocolFeeBps` — currently 5 bps (0.05%), so a
5 bps voucher waives that fee entirely. It only reduces the ETH protocol fee charged by the FeeRouter.
Vouchers never affect the IFR token transfer fee or burn.
They are not a swap-price, slippage or shop discount.
Issuance consumes those 100 points, so `pointsTotal` is the wallet's spendable points balance.

For every issuance the backend reads `protocolFeeBps` fresh from `FEE_ROUTER_ADDRESS` over the
chain-pinned `RPC_URL` (no success cache; only concurrent requests share one in-flight read) and signs `min(discountBps, maxDiscountBps, protocolFeeBps)`,
because FeeRouterV1 reverts vouchers above its fee ("Discount exceeds fee"). If the fee cannot be
read, or is 0, issuance fails closed with HTTP 503 and no points are deducted. The signed type is
`DiscountVoucher(address user,uint16 discountBps,uint32 maxUses,uint64 expiry,uint256 nonce)`,
matching `FeeRouterV1.VOUCHER_TYPEHASH`; `test/PointsVoucherParity.test.js` proves acceptance.
With `CHAIN_ID=1` the router must be the canonical FeeRouterV1
`0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a`, or the service refuses to start; production startup
also verifies its bytecode and EIP-712 domain on-chain.

Residual: a signed voucher is immutable. If governance lowers `protocolFeeBps` below a voucher's
`discountBps` before it is redeemed (expiry is 7 days), FeeRouterV1 rejects that voucher; the backend
does not re-sign or refund it. Redemption state is only known on-chain (`usedNonces`).

## Rate Limits

- 60 requests per IP per minute (general; IPv6 keyed per /64)
- 5 SIWE verifies per IP per hour
- 30 SIWE nonces per client per 10 minutes, plus 250 per IPv6 /48 (one /48 holds at most 5% of the 10,000 outstanding-nonce cap); IPv4 stays per address
- 1 voucher per wallet per rolling 24 hours (database-enforced)
- 100 vouchers global daily cap

## Security

- JWT tokens expire after 24h
- SIWE nonces expire after 5 minutes
- SIWE signatures are bound to configured origins and chain ID
- Lock proof startup fails closed if the RPC chain or IFRLock contract is wrong
- EIP-712 voucher signatures are verifiable on-chain
- Voucher signer private key stays server-side (`.env`)
- Rate limiting on all sensitive endpoints

## Tech Stack

- Node.js + Express + TypeScript
- Prisma + SQLite
- ethers.js v6 (EIP-712 signing and lock proof)
- siwe (Sign-In with Ethereum)
- jose (JWT)

## Environment Variables

| Variable | Description |
|----------|-------------|
| DATABASE_URL | Prisma SQLite path (default: `file:./dev.db`) |
| NODE_ENV | Use `production` for deployed instances; omitted values are treated as production-safe |
| JWT_SECRET | Secret for JWT signing |
| VOUCHER_SIGNER_PRIVATE_KEY | Private key for EIP-712 voucher signing |
| FEE_ROUTER_ADDRESS | FeeRouter contract address (for EIP-712 domain) |
| CHAIN_ID | Required chain ID; production accepts Ethereum mainnet (`1`) only |
| RPC_URL | Required RPC endpoint; production startup verifies its chain ID |
| IFR_LOCK_ADDRESS | Required IFRLock address; production accepts the canonical mainnet contract only |
| SIWE_ALLOWED_ORIGINS | Comma-separated exact origins allowed in signed SIWE messages |
| ALLOWED_ORIGINS | Comma-separated HTTP CORS origins |
| PORT | Server port (default: 3004) |
| ADMIN_SECRET | Admin API secret (reserved) |
