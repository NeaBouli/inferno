# points-backend Migration / Self-Hosting Template

## Was ist points-backend?

Loyalty-points-System für IFR-Community-Aktionen. Nutzer verbinden ihr Wallet via
SIWE (Sign-In with Ethereum), sammeln Punkte durch definierte Events und erhalten
EIP-712-signierte Discount-Vouchers ab einem Threshold.

**Port:** 3004  
**Stack:** TypeScript, Express, Prisma ORM, SQLite

## Endpoints

| Route | Auth | Beschreibung |
|-------|------|-------------|
| `POST /auth/siwe/nonce` | — | SIWE-Nonce generieren |
| `POST /auth/siwe/verify` | — | SIWE-Message verifizieren → JWT |
| `POST /points/event` | JWT + Captcha | Punkte-Event aufzeichnen |
| `GET /points/balance` | JWT | Aktuelles Punkte-Guthaben |
| `POST /voucher/issue` | JWT + Lock-Proof | EIP-712-Voucher ausstellen |
| `GET /health` | — | Health-Check |

## Points-Konfiguration

| Event | Punkte | Daily Limit |
|-------|--------|-------------|
| wallet_connect | 10 | 1 |
| guide_wallet_setup | 20 | 1 |
| guide_add_token | 20 | 1 |
| guide_lock | 30 | 1 |
| partner_onboarding | 50 | 1 |

Voucher-Threshold: **100 Punkte** → 5 BPS Discount, 7 Tage gültig. Der
Issuer-Wert entspricht der aktuell deployten `protocolFeeBps`-Grenze; höhere
Discounts werden vom FeeRouterV1 abgelehnt.

## Prisma Schema

```
Wallet        — address (unique), pointsTotal, Events[], Vouchers[]
PointEvent    — walletId, type, points, proofRef, createdAt
Voucher       — walletId, nonce, discountBps, maxUses, expiresAt, used
```

Provider: **SQLite** (`file:./data/production.db`) — kein separater DB-Server nötig.

## Benötigte ENV vars

```env
DATABASE_URL=file:/data/production.db
NODE_ENV=production
JWT_SECRET=<generate: openssl rand -hex 32>
VOUCHER_SIGNER_PRIVATE_KEY=0x<dedicated least-privilege EIP-712 signer>
FEE_ROUTER_ADDRESS=0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4
CHAIN_ID=1
RPC_URL=https://<server-managed-mainnet-rpc>
IFR_LOCK_ADDRESS=0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb
SIWE_ALLOWED_ORIGINS=https://ifrunit.tech,https://www.ifrunit.tech
PORT=3004
ADMIN_SECRET=<generate: openssl rand -hex 32>
ALLOWED_ORIGINS=https://ifrunit.tech,https://www.ifrunit.tech
CAPTCHA_SECRET=<Cloudflare Turnstile Secret — optional, ohne=deaktiviert>
```

`VOUCHER_SIGNER_PRIVATE_KEY` muss außerhalb von Git als eigener Least-Privilege-Key
bereitgestellt werden. Niemals einen Deployer- oder Safe-Owner-Key wiederverwenden.

## Host Setup (Template)

Die konkreten Verbindungsdaten (ssh-Alias, Verzeichnisse, Server-IP) stehen im
privaten Operations-Record. Unten steht `<operator-alias>` für den eigenen
ssh-Zielalias und `<deploy-root>` für das Bereitstellungsverzeichnis auf dem Host.

### 1. Dockerfile prüfen

Das aktuelle Multi-Stage-Dockerfile in `apps/points-backend/Dockerfile` baut so:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated
COPY prisma ./prisma
EXPOSE 3004
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
```

### 2. Verzeichnis auf dem Host anlegen

```bash
ssh <operator-alias> "mkdir -p <deploy-root>/points-backend"
rsync -az --exclude='node_modules' --exclude='dist' \
  apps/points-backend/ <operator-alias>:<deploy-root>/points-backend/
```

### 3. .env.points-backend erstellen

```bash
ssh <operator-alias> "cat > <deploy-root>/.env.points-backend << 'EOF'
DATABASE_URL=file:/data/production.db
NODE_ENV=production
JWT_SECRET=$(openssl rand -hex 32)
VOUCHER_SIGNER_PRIVATE_KEY=0x<key>
FEE_ROUTER_ADDRESS=0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4
CHAIN_ID=1
RPC_URL=https://<server-managed-mainnet-rpc>
IFR_LOCK_ADDRESS=0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb
SIWE_ALLOWED_ORIGINS=https://ifrunit.tech,https://www.ifrunit.tech
PORT=3004
ADMIN_SECRET=$(openssl rand -hex 32)
ALLOWED_ORIGINS=https://ifrunit.tech,https://www.ifrunit.tech
EOF"
```

### 4. docker-compose.yml erweitern

Service `points-backend` in `<deploy-root>/docker-compose.yml` hinzufügen:

```yaml
points-backend:
  build:
    context: ./points-backend
  container_name: inferno-points-backend
  restart: unless-stopped
  env_file:
    - .env.points-backend
  volumes:
    - points-data:/data
  networks:
    - inferno
    - traefik-public
  labels:
    - traefik.enable=true
    - traefik.http.routers.ifr-points.rule=Host(`points-api.ifrunit.tech`)
    - traefik.http.routers.ifr-points.entrypoints=websecure
    - traefik.http.routers.ifr-points.tls.certresolver=letsencrypt
    - traefik.http.services.ifr-points.loadbalancer.server.port=3004
    - traefik.docker.network=traefik-public
```

Volume hinzufügen: `points-data: { name: inferno_points_data }`

### 5. DNS setzen

```
A  points-api  <server-ipv4>  TTL 300
```

### 6. ai-copilot POINTS_BACKEND_URL aktualisieren

In `<deploy-root>/.env.ai-copilot`:
```
POINTS_BACKEND_URL=http://inferno-points-backend:3004
```
(intern via Docker-Netzwerk — kein externen DNS nötig)

### 7. Deploy

```bash
ssh <operator-alias> "cd <deploy-root> && docker compose build points-backend && docker compose up -d points-backend"
```

## Status (historischer Migrationsverlauf)

- [x] Code analysiert — SQLite, kein separater DB-Server nötig
- [x] Dockerfile-Fix: multi-stage build + PRISMA_QUERY_ENGINE_LIBRARY
- [x] VOUCHER_SIGNER_PRIVATE_KEY: neues EOA generiert
- [x] Dockerfile in `apps/points-backend/Dockerfile` ersetzt
- [x] Source auf den Host synchronisiert
- [x] .env.points-backend erstellt
- [x] docker-compose.yml erweitert
- [x] Container deployed + healthy ✅ (2026-06-10)
- [x] DNS: `points-api.ifrunit.tech` auf die Server-IP gesetzt ✅ (10.06.2026)
- [x] ai-copilot POINTS_BACKEND_URL → `http://inferno-points-backend:3004` ✅
