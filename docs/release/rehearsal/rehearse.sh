#!/usr/bin/env bash
# Migration rehearsal driver (docs/release/DEPLOY-RUNBOOK.md sections 1, 2, 7).
#
# SNAPSHOT_DB must be a scratch database holding a restored production snapshot (or the
# production-like seed, see MIGRATION-REHEARSAL.md). NEVER point this at production: it
# migrates SNAPSHOT_DB and creates/drops <SNAPSHOT_DB>_timing, _restorecheck, _rollback.
#
# Usage (from the repo root, on the release branch):
#   PGURL=postgres://user:pass@host:5432 SNAPSHOT_DB=rehearsal OUT=/tmp/rehearsal \
#     bash docs/release/rehearsal/rehearse.sh
set -uo pipefail

: "${PGURL:?PGURL (server URL without database) is required}"
: "${SNAPSHOT_DB:?SNAPSHOT_DB is required}"
OUT="${OUT:-./rehearsal-out}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$OUT"
SNAP="$PGURL/$SNAPSHOT_DB"
psqlq() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
step() { echo; echo "### $*" | tee -a "$OUT/steps.log"; }
ms() { date +%s%3N; }

step "1. backup: pg_dump -Fc"
T0=$(ms)
pg_dump "$SNAP" -Fc -f "$OUT/pre-0089.dump"
echo "dump_ms=$(($(ms) - T0)) size_bytes=$(stat -c %s "$OUT/pre-0089.dump") sha256=$(sha256sum "$OUT/pre-0089.dump" | cut -d' ' -f1)" | tee -a "$OUT/steps.log"
pg_restore --list "$OUT/pre-0089.dump" | head -5 >> "$OUT/steps.log"
psqlq "$PGURL/postgres" -c "DROP DATABASE IF EXISTS ${SNAPSHOT_DB}_restorecheck" -c "CREATE DATABASE ${SNAPSHOT_DB}_restorecheck"
T0=$(ms)
pg_restore --no-owner -d "$PGURL/${SNAPSHOT_DB}_restorecheck" "$OUT/pre-0089.dump" 2> "$OUT/restorecheck.err"
echo "restore_ms=$(($(ms) - T0)) restore_errors=$(grep -c . "$OUT/restorecheck.err")" | tee -a "$OUT/steps.log"
COUNTS="SELECT (SELECT count(*) FROM companies)||'/'||(SELECT count(*) FROM users)||'/'||(SELECT count(*) FROM company_users)||'/'||(SELECT count(*) FROM journal_entries)||'/'||(SELECT count(*) FROM invoices)"
echo "counts companies/users/company_users/journal_entries/invoices: snapshot=$(psql -XtAc "$COUNTS" "$SNAP") restored=$(psql -XtAc "$COUNTS" "$PGURL/${SNAPSHOT_DB}_restorecheck")" | tee -a "$OUT/steps.log"

step "2a. pre-state counts"
psql -X -v ON_ERROR_STOP=0 -f "$HERE/pre-counts.sql" "$SNAP" > "$OUT/pre-counts.txt" 2>&1
psql -X -f scripts/qa/find-header-posting-accounts.sql "$SNAP" > "$OUT/pre-header-posting.txt" 2>&1

step "2. per-file timing on a clone (one transaction per file)"
psqlq "$PGURL/postgres" -c "DROP DATABASE IF EXISTS ${SNAPSHOT_DB}_timing" -c "CREATE DATABASE ${SNAPSHOT_DB}_timing TEMPLATE $SNAPSHOT_DB"
DATABASE_URL="$PGURL/${SNAPSHOT_DB}_timing" node "$HERE/time-migrations.mjs" --json "$OUT/per-file.json" > "$OUT/per-file.txt" 2>&1
echo "per-file exit=$?" | tee -a "$OUT/steps.log"

step "2. real migrate on the snapshot: npm run db:migrate (one transaction)"
T0=$(ms)
DATABASE_URL="$SNAP" npm run --silent db:migrate > "$OUT/db-migrate.log" 2>&1
RC=$?
echo "db_migrate_exit=$RC db_migrate_ms=$(($(ms) - T0))" | tee -a "$OUT/steps.log"

step "2. schema equivalence: drizzle-kit migrate vs per-file runner"
pg_dump -s "$SNAP" | grep -v '^--' | sed '/^$/d' > "$OUT/schema-snapshot.sql"
pg_dump -s "$PGURL/${SNAPSHOT_DB}_timing" | grep -v '^--' | sed '/^$/d' > "$OUT/schema-timing.sql"
diff "$OUT/schema-snapshot.sql" "$OUT/schema-timing.sql" > "$OUT/schema.diff"; echo "schema_diff_lines=$(wc -l < "$OUT/schema.diff")" | tee -a "$OUT/steps.log"

step "2b/2d. post-state counts"
psql -X -v ON_ERROR_STOP=0 -f "$HERE/post-counts.sql" "$SNAP" > "$OUT/post-counts.txt" 2>&1

step "2c. read-only QA scripts"
DATABASE_URL="$SNAP" node scripts/qa/find-bad-closing-entries.mjs --json > "$OUT/findings-closing.json" 2>&1; echo "closing exit=$?" | tee -a "$OUT/steps.log"
DATABASE_URL="$SNAP" node scripts/qa/find-inverted-rates.mjs > "$OUT/findings-rates.txt" 2>&1; echo "rates exit=$?" | tee -a "$OUT/steps.log"
DATABASE_URL="$SNAP" node scripts/qa/find-sales-ledger-drift.mjs > "$OUT/findings-sales.txt" 2>&1; echo "sales exit=$?" | tee -a "$OUT/steps.log"
DATABASE_URL="$SNAP" node scripts/qa/find-purchases-ledger-drift.mjs > "$OUT/findings-purchases.txt" 2>&1; echo "purchases exit=$?" | tee -a "$OUT/steps.log"
DATABASE_URL="$SNAP" npx tsx scripts/qa/repair-misposted-payments.ts --json > "$OUT/findings-payment-accounts.json" 2>&1; echo "payments exit=$?" | tee -a "$OUT/steps.log"
psql -X -f scripts/qa/find-header-posting-accounts.sql "$SNAP" > "$OUT/post-header-posting.txt" 2>&1

step "idempotency: second db:migrate is a no-op; every 0089+ file re-run by hand"
BEFORE=$(psql -XtAc "SELECT count(*) FROM drizzle.__drizzle_migrations" "$SNAP")
DATABASE_URL="$SNAP" npm run --silent db:migrate > "$OUT/db-migrate-2.log" 2>&1
echo "second_migrate_exit=$? ledger_before=$BEFORE ledger_after=$(psql -XtAc "SELECT count(*) FROM drizzle.__drizzle_migrations" "$SNAP")" | tee -a "$OUT/steps.log"
psqlq "$PGURL/postgres" -c "DROP DATABASE IF EXISTS ${SNAPSHOT_DB}_rerun" -c "CREATE DATABASE ${SNAPSHOT_DB}_rerun TEMPLATE $SNAPSHOT_DB"
: > "$OUT/rerun.txt"
for f in $(ls migrations/*.sql | awk -F/ '{ if (substr($NF, 1, 4) + 0 >= 89) print }'); do
  T0=$(ms)
  if psql -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$f" "$PGURL/${SNAPSHOT_DB}_rerun" > /dev/null 2> "$OUT/rerun.err"; then
    echo "$(basename "$f") rerun_ok $(($(ms) - T0))ms" >> "$OUT/rerun.txt"
  else
    echo "$(basename "$f") RERUN_FAILED $(head -c 300 "$OUT/rerun.err" | tr '\n' ' ')" >> "$OUT/rerun.txt"
  fi
done
grep -c rerun_ok "$OUT/rerun.txt" | sed 's/^/rerun_ok_files=/' | tee -a "$OUT/steps.log"
grep RERUN_FAILED "$OUT/rerun.txt" | tee -a "$OUT/steps.log"

step "7. rollback: restore the pre-0089 dump into a fresh database"
psqlq "$PGURL/postgres" -c "DROP DATABASE IF EXISTS ${SNAPSHOT_DB}_rollback" -c "CREATE DATABASE ${SNAPSHOT_DB}_rollback"
T0=$(ms)
pg_restore --no-owner -d "$PGURL/${SNAPSHOT_DB}_rollback" "$OUT/pre-0089.dump" 2> "$OUT/rollback.err"
echo "rollback_restore_ms=$(($(ms) - T0)) errors=$(grep -c . "$OUT/rollback.err") counts=$(psql -XtAc "$COUNTS" "$PGURL/${SNAPSHOT_DB}_rollback") ledger_rows=$(psql -XtAc "SELECT count(*) FROM drizzle.__drizzle_migrations" "$PGURL/${SNAPSHOT_DB}_rollback") has_0089_tables=$(psql -XtAc "SELECT to_regclass('ledger_repair_findings') IS NOT NULL" "$PGURL/${SNAPSHOT_DB}_rollback")" | tee -a "$OUT/steps.log"

echo; echo "done: results in $OUT"
