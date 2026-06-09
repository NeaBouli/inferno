FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src/ ./src/

RUN addgroup -g 1001 -S ifr && \
    adduser -S ifr -u 1001 -G ifr && \
    chown -R ifr:ifr /app

USER ifr

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:${VERIFY_PORT:-3001}/ 2>/dev/null; exit 0

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
