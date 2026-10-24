# Build context is the repo root (see docker-compose.yml)
FROM oven/bun:1.4-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4-alpine
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY apps/server apps/server
WORKDIR /app/apps/server
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]
