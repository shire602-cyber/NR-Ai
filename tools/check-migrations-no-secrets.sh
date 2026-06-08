#!/usr/bin/env bash
# Fail CI if any migration file or source file contains seed credentials or
# password material. Backstops a real incident: migrations 0023, 0024, 0028
# seeded firm_owner accounts with bcrypt hashes for cleartext passwords that
# were also committed to tests/test-firm-endpoints.sh, producing a full
# cross-tenant compromise vector. The same hash also lived in server/db.ts
# as a "dev seed". See migrations/0051_revoke_test_backdoor_accounts.sql.
#
# This guard scans BOTH migrations/* AND server/* + tests/* + tools/* +
# shared/* for bcrypt-hash patterns and INSERT-into-users statements.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Allow-list for files that may legitimately reference these patterns:
#   - the cleanup migration itself (writes a sentinel, not a real hash)
#   - the original backdoor migrations (already applied; can't be deleted;
#     blocked from re-use by 0037)
#   - this script
#   - the auth route file (calls bcrypt.hash with a runtime variable, not a
#     literal hash)
#   - tests that mock bcrypt or test the format of hashes
ALLOWLIST_REGEX='/(0023_seed_test_firm_owner|0024_fix_test_firm_owner_role|0028_fix_test_credentials|0051_revoke_test_backdoor_accounts)\.sql:|tools/check-migrations-no-secrets\.sh:|server/routes/auth\.routes\.ts:|tests/.*\.test\.(ts|tsx|js):'

# Patterns that should never appear:
#   - bcrypt hash literals ($2a$, $2b$, $2y$ followed by cost)
#   - INSERT ... INTO users with password_hash column listed
#   - UPDATE users SET password_hash = '<literal>'
SCAN_PATHS=("$ROOT/migrations" "$ROOT/server" "$ROOT/shared" "$ROOT/tests" "$ROOT/tools")

PATTERNS=(
  '\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]'              # bcrypt hash literal (cost+salt prefix)
  'INSERT[[:space:]]+INTO[[:space:]]+users[^a-zA-Z]' # row-seed into users in any source
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
  echo "If you need a test account, create it via the registration API in a test fixture." >&2
  exit 1
fi

ROOT_FOR_NODE="$ROOT" node <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.env.ROOT_FOR_NODE;
const migrationDir = path.join(root, 'migrations');
const journalPath = path.join(migrationDir, 'meta', '_journal.json');
const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

const topLevelSqlTags = new Set(
  fs.readdirSync(migrationDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .map((name) => name.replace(/\.sql$/u, '')),
);
const journalTags = new Set(journal.entries.map((entry) => entry.tag));

const unjournaled = [...topLevelSqlTags].filter((tag) => !journalTags.has(tag)).sort();
const missingSql = [...journalTags].filter((tag) => !topLevelSqlTags.has(tag)).sort();

if (unjournaled.length || missingSql.length) {
  if (unjournaled.length) {
    console.error('FAIL: top-level migration SQL files missing from migrations/meta/_journal.json:');
    for (const tag of unjournaled) console.error(`  - ${tag}.sql`);
  }
  if (missingSql.length) {
    console.error('FAIL: journal entries missing matching top-level migration SQL files:');
    for (const tag of missingSql) console.error(`  - ${tag}.sql`);
  }
  process.exit(1);
}
NODE

echo "check-migrations-no-secrets: OK (scanned ${#SCAN_PATHS[@]} dirs)"
