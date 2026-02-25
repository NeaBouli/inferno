FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3004
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
