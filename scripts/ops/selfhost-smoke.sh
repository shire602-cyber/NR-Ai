#!/usr/bin/env bash
# Go-live smoke for the self-hosted stack: /health, /api/version, then register + login through the proxy.
# Used by the CI job "Self-hosting go-live gate" and runnable by hand after every release.
# Usage: scripts/ops/selfhost-smoke.sh https://app.example.ae   (set CURL_OPTS=-k for a self-signed certificate)
set -euo pipefail

BASE="${1:?base url, e.g. https://localhost}"
read -r -a OPTS <<< "${CURL_OPTS:-}"
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
EMAIL="smoke-$(date +%s)@example.com"
PASSWORD="Smoke-Test-${RANDOM}-Zq7!x"

c() { curl -fsS "${OPTS[@]}" -c "$JAR" -b "$JAR" "$@"; }

c "$BASE/health/live" >/dev/null
c "$BASE/health" | grep -q '"status"'
c "$BASE/api/version"
echo

CSRF=$(c "$BASE/api/csrf-token" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
[ -n "$CSRF" ] || { echo "smoke: no CSRF token" >&2; exit 1; }

c -X POST "$BASE/api/auth/register" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"companyName\":\"Smoke Co\"}" >/dev/null

LOGIN=$(c -X POST "$BASE/api/auth/login" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "smoke: login returned no token: $LOGIN" >&2; exit 1; }

c "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN" | grep -q "$EMAIL"
echo "smoke: ok ($BASE)"
