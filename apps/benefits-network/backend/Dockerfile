FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS prod-deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat openssl
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Run as the image's unprivileged node user (external audit IFR-DEV-06). Application files stay
# root-owned and read-only for it; the SQLite volume (/data) must be owned by uid 1000 before this
# image starts (see docs/BENEFITS_CAPACITY_RUNBOOK.md, non-root backend).
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O- http://127.0.0.1:3001/ready | grep -q '"status":"ready"' || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
