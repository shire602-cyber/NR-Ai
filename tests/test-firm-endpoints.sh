#!/usr/bin/env bash
# ============================================================
# NRA Management Center — full endpoint smoke test
# Usage: bash tests/test-firm-endpoints.sh
# Pre-req: migration 0023 deployed (nra.test.owner@testmail.com exists)
# ============================================================

BASE="https://nr-ai-production.up.railway.app/api"
EMAIL="nra.test.owner@testmail.com"
PASS="NRAtest2024!"

echo "=========================================="
echo "  NRA Management Center — Endpoint Tests"
echo "=========================================="
echo ""

# ── Step 1: Login ─────────────────────────────────────────────────────────────
echo "[1/14] POST /auth/login"
LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")

TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "  FAIL — could not obtain JWT. Response:"
  echo "  $LOGIN_RESP"
  exit 1
fi

USER_ID=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('id',''))" 2>/dev/null)
echo "  OK — JWT obtained (user id: $USER_ID)"
echo ""

AUTH="-H \"Authorization: Bearer $TOKEN\""

call() {
  local LABEL="$1"
  local METHOD="$2"
  local PATH="$3"
  local DATA="$4"

  echo "[$LABEL] $METHOD $PATH"
  if [ -n "$DATA" ]; then
    RESP=$(curl -s -o /tmp/resp_body -w "%{http_code}" -X "$METHOD" "$BASE$PATH" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$DATA")
  else
    RESP=$(curl -s -o /tmp/resp_body -w "%{http_code}" -X "$METHOD" "$BASE$PATH" \
      -H "Authorization: Bearer $TOKEN")
  fi

  BODY=$(cat /tmp/resp_body)
  if [ "$RESP" -ge 200 ] && [ "$RESP" -lt 300 ]; then
    echo "  STATUS: $RESP OK"
  else
    echo "  STATUS: $RESP *** UNEXPECTED ***"
    echo "  BODY: $BODY"
  fi
  echo ""
}

# ── Step 2: Firm endpoints ─────────────────────────────────────────────────────
call " 2/14" GET  /firm/clients
call " 3/14" GET  /firm/staff
call " 4/14" GET  /firm/health
call " 5/14" GET  /firm/health/deadlines
call " 6/14" GET  /firm/comms/log
call " 7/14" GET  /firm/comms/templates
call " 8/14" GET  /firm/bulk/bank-import-status
call " 9/14" GET  /firm/analytics/revenue
call "10/14" GET  /firm/analytics/utilization
call "11/14" GET  /firm/pipeline/leads
call "12/14" GET  /firm/pipeline/saas-prospects

# ── Step 3: Create a test client company ──────────────────────────────────────
call "13/14" POST /firm/clients '{"name":"Smoke Test Client Co","baseCurrency":"AED","locale":"en"}'

echo "=========================================="
echo "  Done. All requests completed."
echo "=========================================="
