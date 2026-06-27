#!/usr/bin/env bash
# Fail CI if migration or source files contain seed credentials or password
# material. Historical cleanup migrations are allow-listed because deployed
# migrations are immutable; new secrets are not allowed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ALLOWLIST_REGEX='/(0023_seed_test_firm_owner|0024_fix_test_firm_owner_role|0028_fix_test_credentials|0051_revoke_test_backdoor_accounts)\.sql:|tools/check-migrations-no-secrets\.sh:|server/routes/auth\.routes\.ts:|tests/.*\.test\.(ts|tsx|js):'
SCAN_PATHS=("$ROOT/migrations" "$ROOT/server" "$ROOT/shared" "$ROOT/tests" "$ROOT/tools")
PATTERNS=(
  '\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]'
  'INSERT[[:space:]]+INTO[[:space:]]+users[^a-zA-Z]'
)

violations=0
INCLUDES=(--include='*.sql' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.sh')

for pattern in "${PATTERNS[@]}"; do
  matches=$(grep -RIEn "${INCLUDES[@]}" "$pattern" "${SCAN_PATHS[@]}" 2>/dev/null \
    | grep -vE "$ALLOWLIST_REGEX" \
    || true)
  if [[ -n "$matches" ]]; then
    echo "FAIL: pattern '$pattern' matched outside allowlist:" >&2
    echo "$matches" >&2
    echo >&2
    violations=$((violations + 1))
  fi
done

if [[ $violations -gt 0 ]]; then
  echo "check-migrations-no-secrets: $violations pattern(s) violated." >&2
  echo "Source must not contain bcrypt hash literals or INSERT INTO users statements." >&2
  exit 1
fi

echo "check-migrations-no-secrets: OK (scanned ${#SCAN_PATHS[@]} dirs)"
