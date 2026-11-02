# ---------- build ----------
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npx prisma generate --schema server/prisma/schema.prisma && npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3333 HOST=0.0.0.0 STORAGE_DIR=/data/storage
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 3333
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema server/prisma/schema.prisma && node server/dist/seed.js && node server/dist/server.js"]
