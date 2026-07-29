FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npx tsc && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json prisma.config.ts ./
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
RUN addgroup -g 1001 -S points && \
    adduser -S points -u 1001 -G points && \
    mkdir -p /data && \
    chown -R points:points /app /data
USER points
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3004/health 2>/dev/null | grep -q ok || exit 1
EXPOSE 3004
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
