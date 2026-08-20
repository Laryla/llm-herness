#!/usr/bin/env bash

set -euo pipefail

SERVER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$SERVER_ROOT/test/integration/docker-compose.yml"
MYSQL_URL="mysql://root:harness_test@127.0.0.1:33306/llm_harness"
POSTGRESQL_URL="postgresql://postgres:harness_test@127.0.0.1:35432/llm_harness"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --volumes
}

trap cleanup EXIT
docker compose -f "$COMPOSE_FILE" up --detach --wait

DATABASE_URL="$MYSQL_URL" yarn prisma migrate deploy --config prisma/mysql/prisma.config.ts
TEST_DATABASE_PROVIDER=mysql TEST_DATABASE_URL="$MYSQL_URL" \
  yarn exec vitest run test/database.integration.test.ts

DATABASE_URL="$POSTGRESQL_URL" yarn prisma migrate deploy --config prisma/postgresql/prisma.config.ts
TEST_DATABASE_PROVIDER=postgresql TEST_DATABASE_URL="$POSTGRESQL_URL" \
  yarn exec vitest run test/database.integration.test.ts
