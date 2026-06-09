FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY src/ ./src/
COPY server/ ./server/
RUN addgroup -g 1001 -S copilot && \
    adduser -S copilot -u 1001 -G copilot && \
    chown -R copilot:copilot /app
USER copilot
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3003/api/health 2>/dev/null | grep -q ok || exit 1
EXPOSE 3003
ENTRYPOINT ["dumb-init", "--"]
CMD ["node_modules/.bin/tsx", "server/index.ts"]
