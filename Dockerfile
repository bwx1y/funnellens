FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/log && chown -R bun:bun /app

USER bun
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
