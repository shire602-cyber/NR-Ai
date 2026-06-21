#!/usr/bin/env bash
# scripts/qa/bootstrap-e2e.sh
#
# One-command bootstrap for the Muhasib.ai end-to-end QA test
# (docs/qa/2026-06-09-e2e-accountant-cfo-prompt.md).
#
# What it does (idempotent — safe to re-run):
#   1. Starts a containerised Postgres 16 on port 5499.
#   2. Writes a fresh .env (only if one doesn't already exist) with random
#      SESSION_SECRET / JWT_SECRET, BCRYPT_COST=12, AUTO_MIGRATE_ON_BOOT=true.
#   3. Runs `npm ci` if node_modules is missing.
#   4. Runs migrations against the local DB.
#   5. Starts `npm run dev` in the background (logs -> .e2e-server.log,
#      PID -> .e2e-server.pid).
#   6. Waits for /health to return 200.
#   7. Registers the E2E customer "Sara Accountant"
#      (sara@e2e.test / E2eTestPassword!2026), or logs in if it already
#      exists. Saves JWT -> .e2e-token, company id -> .e2e-company-id.
#
# Exit codes:
#   0  ready to run E2E
#   1  prerequisite missing (docker / npm / curl / jq / openssl)
#   2  Postgres failed to start
#   3  app failed to come up healthy
#   4  registration & login both failed
#
# To reset everything:
#   bash scripts/qa/bootstrap-e2e.sh --clean
#   (or: kill $(cat .e2e-server.pid); docker rm -f muhasib-e2e-pg;
#        rm -f .env .e2e-token .e2e-company-id .e2e-server.log .e2e-server.pid)
set -euo pipefail

PG_CONTAINER="muhasib-e2e-pg"
PG_PORT=5499
PG_USER="muhasib"
PG_PASS="e2e_local_only_2026"
PG_DB="muhasib_e2e"
DB_URL="postgresql://${PG_USER}:${PG_PASS}@localhost:${PG_PORT}/${PG_DB}"
APP_PORT=5000
E2E_EMAIL="sara@e2e.test"
E2E_PASSWORD="E2eTestPassword!2026"
E2E_NAME="Sara Accountant"

log()  { printf '[bootstrap-e2e] %s\n' "$*"; }
die()  { printf '[bootstrap-e2e ERROR] %s\n' "$*" >&2; exit "${2:-1}"; }

if [ "${1:-}" = "--clean" ]; then
  log "Resetting previous E2E environment..."
  if [ -f .e2e-server.pid ]; then
    kill "$(cat .e2e-server.pid)" 2>/dev/null || true
  fi
  docker rm -f "${PG_CONTAINER}" 2>/dev/null || true
  rm -f .env .e2e-token .e2e-company-id .e2e-server.log .e2e-server.pid
  log "Reset complete. Re-run without --clean to bootstrap fresh."
  exit 0
fi

# 1. Prereqs
for cmd in docker npm curl jq openssl; do
  command -v "$cmd" >/dev/null 2>&1 || die "Missing prerequisite: $cmd"
done

# 2. Postgres container
log "Checking Postgres container..."
if ! docker ps -a --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  log "Creating fresh Postgres container on port ${PG_PORT}..."
  docker run -d \
    --name "${PG_CONTAINER}" \
    -e "POSTGRES_PASSWORD=${PG_PASS}" \
    -e "POSTGRES_USER=${PG_USER}" \
    -e "POSTGRES_DB=${PG_DB}" \
    -p "${PG_PORT}:5432" \
    postgres:16-alpine >/dev/null
elif ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  log "Restarting existing Postgres container..."
  docker start "${PG_CONTAINER}" >/dev/null
fi

log "Waiting for Postgres to accept connections..."
for _ in $(seq 1 30); do
  if docker exec "${PG_CONTAINER}" pg_isready -U "${PG_USER}" -d "${PG_DB}" >/dev/null 2>&1; then
    log "Postgres ready on localhost:${PG_PORT}."
    break
  fi
  sleep 1
done
docker exec "${PG_CONTAINER}" pg_isready -U "${PG_USER}" -d "${PG_DB}" >/dev/null 2>&1 \
  || die "Postgres failed to start within 30 s." 2

# 3. .env
if [ -f .env ]; then
  log ".env already exists — leaving it. (Verify it points at port ${PG_PORT}.)"
else
  log "Writing .env with fresh secrets..."
  cat > .env <<EOF
NODE_ENV=development
PORT=${APP_PORT}
DATABASE_URL=${DB_URL}
SESSION_SECRET=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 24)
FRONTEND_URL=http://localhost:5173
LOG_LEVEL=info
BCRYPT_COST=12
AUTO_MIGRATE_ON_BOOT=true
EOF
fi

# 4. Dependencies
if [ ! -d node_modules ]; then
  log "Installing dependencies (npm ci)..."
  npm ci
fi

# 5. Migrations
log "Running migrations..."
npm run db:migrate

# 6. Dev server (background)
if [ -f .e2e-server.pid ] && kill -0 "$(cat .e2e-server.pid)" 2>/dev/null; then
  log "Stopping previous dev server (PID $(cat .e2e-server.pid))..."
  kill "$(cat .e2e-server.pid)" 2>/dev/null || true
  sleep 1
fi
log "Starting dev server in background (logs: .e2e-server.log)..."
nohup npm run dev > .e2e-server.log 2>&1 &
echo $! > .e2e-server.pid

log "Waiting for /health on port ${APP_PORT}..."
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${APP_PORT}/health" >/dev/null 2>&1; then
    log "Server healthy."
    break
  fi
  sleep 1
done
curl -fsS "http://localhost:${APP_PORT}/health" >/dev/null 2>&1 \
  || { log "Last 30 lines of server log:"; tail -30 .e2e-server.log; die "Server failed to come up. See .e2e-server.log." 3; }

# 7. E2E customer
log "Registering E2E customer ${E2E_EMAIL}..."
REGISTER_BODY=$(printf '{"name":"%s","email":"%s","password":"%s"}' \
  "${E2E_NAME}" "${E2E_EMAIL}" "${E2E_PASSWORD}")

RESPONSE=$(curl -sS -o /tmp/e2e-bootstrap-register.json -w '%{http_code}' \
  -X POST "http://localhost:${APP_PORT}/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "${REGISTER_BODY}" || true)

if [ "${RESPONSE}" != "200" ]; then
  log "Register returned HTTP ${RESPONSE} — attempting login (user may already exist)..."
  LOGIN_BODY=$(printf '{"email":"%s","password":"%s"}' "${E2E_EMAIL}" "${E2E_PASSWORD}")
  RESPONSE=$(curl -sS -o /tmp/e2e-bootstrap-register.json -w '%{http_code}' \
    -X POST "http://localhost:${APP_PORT}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "${LOGIN_BODY}" || true)
fi

if [ "${RESPONSE}" != "200" ]; then
  log "Auth response body:"
  cat /tmp/e2e-bootstrap-register.json || true
  die "Register and login both failed (HTTP ${RESPONSE}). Check .e2e-server.log." 4
fi

TOKEN=$(jq -r '.token // empty' /tmp/e2e-bootstrap-register.json)
COMPANY_ID=$(jq -r '.company.id // empty' /tmp/e2e-bootstrap-register.json)

# Login response may not include .company.id — fall back to /api/companies.
if [ -z "${COMPANY_ID}" ] && [ -n "${TOKEN}" ]; then
  COMPANY_ID=$(curl -fsS "http://localhost:${APP_PORT}/api/companies" \
    -H "Authorization: Bearer ${TOKEN}" | jq -r '.[0].id // empty')
fi

[ -n "${TOKEN}" ]      || die "Auth succeeded but no JWT returned." 4
[ -n "${COMPANY_ID}" ] || die "Auth succeeded but no company id resolvable." 4

printf '%s' "${TOKEN}"      > .e2e-token
printf '%s' "${COMPANY_ID}" > .e2e-company-id
chmod 600 .e2e-token

cat <<EOF

======================================
Bootstrap complete — ready for E2E run
======================================

  Local app:    http://localhost:${APP_PORT}
  Postgres:     ${DB_URL}
  E2E user:     ${E2E_EMAIL}  /  ${E2E_PASSWORD}
  JWT:          saved to .e2e-token (chmod 600)
  Company ID:   $(cat .e2e-company-id)
  Server log:   .e2e-server.log
  Server PID:   $(cat .e2e-server.pid)

Use the JWT for every API call:
  curl -H "Authorization: Bearer \$(cat .e2e-token)" \\
       http://localhost:${APP_PORT}/api/...

To stop the dev server:    kill \$(cat .e2e-server.pid)
To wipe everything:        bash scripts/qa/bootstrap-e2e.sh --clean

Next: proceed with Phase 1 of
  docs/qa/2026-06-09-e2e-accountant-cfo-prompt.md
The bootstrap creates Sara's default company ("Sara Accountant's Company (<ts>)").
First action in Phase 1 is to PATCH /api/companies/\$(cat .e2e-company-id)
to rename it "Al Habib Trading LLC" and set TRN/emirate/etc.

EOF
