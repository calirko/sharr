# Build context is the repo root (see docker-compose.yml)
FROM oven/bun:1.4-alpine AS web
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile
COPY apps/web apps/web
RUN cd apps/web && bun run build

FROM oven/bun:1.4-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production --filter server

FROM oven/bun:1.4-alpine
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY apps/server apps/server
COPY --from=web /app/apps/web/dist apps/web/dist
WORKDIR /app/apps/server
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]
