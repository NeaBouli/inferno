# Points Backend — Deployment Guide

## Railway (empfohlen)

1. https://railway.app → New Project → Deploy from GitHub
2. Repo: `NeaBouli/inferno`
3. Root Directory: `apps/points-backend`
4. Environment Variables setzen:
   ```
   DATABASE_URL=file:./prod.db
   JWT_SECRET=<random 32 chars>
   VOUCHER_SIGNER_PRIVATE_KEY=<deployer key>
   FEE_ROUTER_ADDRESS=0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4
   CHAIN_ID=11155111
   PORT=3004
   ADMIN_SECRET=<secure secret>
   ```
5. Deploy → URL notieren (z.B. `https://ifr-points.railway.app`)
6. URL in `apps/ai-copilot/.env`: `POINTS_BACKEND_URL=https://ifr-points.railway.app`

## Render (Alternative)

1. https://render.com → New Web Service
2. Connect GitHub → `NeaBouli/inferno`
3. Root Directory: `apps/points-backend`
4. Build Command: `npm install && npx prisma generate && npm run build`
5. Start Command: `npx prisma migrate deploy && npm run start`
6. Environment Variables wie oben

## Health Check

```bash
curl https://<your-url>/health
# → { "status": "ok" }
```

## Nach dem Deploy

1. AI Copilot `.env` aktualisieren:
   ```
   POINTS_BACKEND_URL=https://ifr-points.railway.app
   ```
2. Testen:
   ```bash
   curl https://ifr-points.railway.app/auth/siwe/nonce
   ```
