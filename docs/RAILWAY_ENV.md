# Points Backend — Railway Environment Variables

As of: March 2026

## Required Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./prod.db` | SQLite path (Railway: `file:./prod.db`) |
| `NODE_ENV` | `production` | Enables the production runtime contract |
| `JWT_SECRET` | `<random 32+ chars>` | Signature for SIWE JWT token |
| `VOUCHER_SIGNER_PRIVATE_KEY` | `0x...` | Dedicated EIP-712 voucher signer; never reuse a Safe owner key |
| `FEE_ROUTER_ADDRESS` | `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4` | FeeRouterV1 Contract (Mainnet) |
| `CHAIN_ID` | `1` | Ethereum Mainnet; production rejects other chains |
| `RPC_URL` | `https://<mainnet-rpc>` | Server-managed Ethereum Mainnet RPC endpoint |
| `IFR_LOCK_ADDRESS` | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` | Canonical IFRLock contract on Mainnet |
| `SIWE_ALLOWED_ORIGINS` | `https://ifrunit.tech,https://www.ifrunit.tech` | Exact HTTPS origins accepted in SIWE messages |
| `ALLOWED_ORIGINS` | `https://ifrunit.tech,https://www.ifrunit.tech` | HTTP CORS allowlist |
| `PORT` | `3004` | Server port |
| `ADMIN_SECRET` | `<secure secret>` | Admin API auth |

## Railway Setup

```bash
# 1. Railway CLI
npm i -g @railway/cli && railway login

# 2. Link project
cd apps/points-backend
railway link

# 3. Set env variables
railway variables set DATABASE_URL="file:./prod.db"
railway variables set NODE_ENV="production"
railway variables set JWT_SECRET="$(openssl rand -hex 32)"
railway variables set CHAIN_ID="1"
railway variables set RPC_URL="https://<mainnet-rpc>"
railway variables set IFR_LOCK_ADDRESS="0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb"
railway variables set SIWE_ALLOWED_ORIGINS="https://ifrunit.tech,https://www.ifrunit.tech"
railway variables set ALLOWED_ORIGINS="https://ifrunit.tech,https://www.ifrunit.tech"
railway variables set PORT="3004"
# VOUCHER_SIGNER_PRIVATE_KEY and ADMIN_SECRET must be set manually

# 4. Deploy
railway up
```

## Health Check

```bash
curl https://<railway-url>/health
# -> { "status": "ok" }
```

## Security

- `VOUCHER_SIGNER_PRIVATE_KEY` **NEVER** commit
- `JWT_SECRET` must be unique per environment
- `ADMIN_SECRET` for admin-only endpoints

---
*See also: apps/points-backend/DEPLOY.md*
