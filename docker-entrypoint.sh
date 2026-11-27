#!/bin/sh
set -e

DB_HOST="${DATABASE_HOST:-postgres}"
DB_PORT="${DATABASE_PORT:-5432}"

echo "[Docker Entrypoint] Waiting for PostgreSQL at $DB_HOST:$DB_PORT to be ready..."

# Wait up to 60 seconds for PostgreSQL port to accept TCP connections
MAX_RETRIES=60
RETRY_COUNT=0

until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "[Docker Entrypoint] Timeout waiting for PostgreSQL after ${MAX_RETRIES}s. Exiting."
    exit 1
  fi
  sleep 1
done

echo "[Docker Entrypoint] PostgreSQL is accepting connections. Waiting 2s for engine initialization..."
sleep 2

echo "[Docker Entrypoint] Running database push (non-interactive)..."
# Piping yes to prevent TTY prompt error on schema creations/alterations
printf 'yes\n' | bunx drizzle-kit push --force

echo "[Docker Entrypoint] Database schema synchronized. Starting application..."
exec bun run src/index.ts
