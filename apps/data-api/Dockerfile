FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/ ./server/
RUN addgroup -g 1001 -S dataapi && \
    adduser -S dataapi -u 1001 -G dataapi && \
    chown -R dataapi:dataapi /app
USER dataapi
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3003/api/health 2>/dev/null | grep -q ok || exit 1
EXPOSE 3003
ENTRYPOINT ["dumb-init", "--"]
CMD ["node_modules/.bin/tsx", "server/index.ts"]
