#!/usr/bin/env bash
# Migration rehearsal driver (docs/release/DEPLOY-RUNBOOK.md sections 1, 2, 7).
#
# Run from the repo root after building the release. SNAPSHOT_DB must be a scratch
# database holding a restored snapshot or production-like seed. This migrates it
# and creates/drops its _restorecheck, _timing, _rerun and _rollback databases.
#
# PGURL=postgres://user:pass@host:5432 SNAPSHOT_DB=rehearsal OUT=/tmp/rehearsal \
#   bash docs/release/rehearsal/rehearse.sh
set -uo pipefail

: "${PGURL:?PGURL (server URL without database) is required}"
: "${SNAPSHOT_DB:?SNAPSHOT_DB is required}"
OUT="${OUT:-./rehearsal-out}"
HERE="$(cd "$(dirname "$0")" && pwd)" || exit 1
mkdir -p "$OUT" || exit 1
case "$SNAPSHOT_DB" in
  [!a-z_]*|*[!a-z0-9_]*) echo "SNAPSHOT_DB must be a lowercase PostgreSQL identifier" >&2; exit 1 ;;
esac
if [ "${#SNAPSHOT_DB}" -gt 50 ]; then
  echo "SNAPSHOT_DB is too long for the rehearsal database suffixes" >&2
  exit 1
fi

SNAP="$PGURL/$SNAPSHOT_DB"
ARCHIVE="$OUT/pre-0089.dump"
failed=0
psqlq() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
log() { echo "$*" | tee -a "$OUT/steps.log"; }
step() { echo; log "### $*"; }
ms() { date +%s%3N; }
gate() {
  local name=$1 rc=$2
  log "${name}_exit=$rc"
  if [ "$rc" -ne 0 ]; then
    failed=1
    return 1
  fi
}
create_db() {
  local db="${SNAPSHOT_DB}_$1"
  psqlq "$PGURL/postgres" -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db ${2:-}"
}
ledger_rows() {
  psqlq -Atc "SELECT count(*) FROM drizzle.__drizzle_migrations" "$1"
}

COUNTS="SELECT (SELECT count(*) FROM companies)||'/'||(SELECT count(*) FROM users)||'/'||(SELECT count(*) FROM company_users)||'/'||(SELECT count(*) FROM journal_entries)||'/'||(SELECT count(*) FROM invoices)"
# Match the source even if it already contains some candidate migrations.
restore_state() {
  psqlq -At -F ' ' "$1" -c "SELECT ($COUNTS),
    (SELECT count(*) FROM drizzle.__drizzle_migrations),
    to_regclass('public.ledger_repair_findings') IS NOT NULL"
}
restore_check() {
  local name=$1 t0 state rc
  t0=$(ms)
  create_db "$name" > "$OUT/$name.err" 2>&1 &&
    pg_restore --exit-on-error --no-owner -d "$PGURL/${SNAPSHOT_DB}_$name" "$ARCHIVE" 2>> "$OUT/$name.err"
  rc=$?
  log "${name}_restore_ms=$(($(ms) - t0)) errors=$(grep -ci 'error:' "$OUT/$name.err")"
  gate "$name" "$rc" || return 1
  state=$(restore_state "$PGURL/${SNAPSHOT_DB}_$name" 2>> "$OUT/$name.err")
  gate "${name}_queries" "$?" || return 1
  log "$name counts/ledger_rows/has_0089_tables: $state"
  [ "$state" = "$source_state" ]
  gate "${name}_matches_snapshot" "$?"
}

step "1. backup: pg_dump -Fc"
T0=$(ms)
pg_dump "$SNAP" -Fc -f "$ARCHIVE" > "$OUT/backup.err" 2>&1
gate backup "$?" || exit 1
log "dump_ms=$(($(ms) - T0)) size_bytes=$(stat -c %s "$ARCHIVE") sha256=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
pg_restore --list "$ARCHIVE" > "$OUT/archive.list" 2>> "$OUT/backup.err"
gate archive_list "$?" || exit 1
head -5 "$OUT/archive.list" >> "$OUT/steps.log"
source_state=$(restore_state "$SNAP" 2>> "$OUT/backup.err")
gate snapshot_queries "$?" || exit 1
log "snapshot counts companies/users/company_users/journal_entries/invoices, ledger_rows, has_0089_tables: $source_state"
restore_check restorecheck

step "2a. pre-state counts"
psqlq -f "$HERE/pre-counts.sql" "$SNAP" > "$OUT/pre-counts.txt" 2>&1
gate pre_counts "$?"
# The pre-0093 snapshot has no accounts.parent_id. Keep this output for review.
psqlq -f scripts/qa/find-header-posting-accounts.sql "$SNAP" > "$OUT/pre-header-posting.txt" 2>&1

step "2. per-file timing on a clone (one transaction per file)"
if create_db timing "TEMPLATE $SNAPSHOT_DB" > "$OUT/timing-clone.log" 2>&1; then
  DATABASE_URL="$PGURL/${SNAPSHOT_DB}_timing" node "$HERE/time-migrations.mjs" --json "$OUT/per-file.json" > "$OUT/per-file.txt" 2>&1
  gate per_file "$?"
else
  gate timing_clone "$?"
fi

step "2. real migrate on the snapshot: npm run db:migrate (one transaction)"
T0=$(ms)
DATABASE_URL="$SNAP" npm run --silent db:migrate > "$OUT/db-migrate.log" 2>&1
migrate_rc=$?
log "db_migrate_ms=$(($(ms) - T0))"
gate db_migrate "$migrate_rc"

step "2. schema equivalence: drizzle-kit migrate vs per-file runner"
dump_schema() {
  # pg_dump generates a random restrict key per dump on supported versions.
  pg_dump -s "$1" | sed -e '/^--/d' -e '/^$/d' -e '/^\\restrict /d' -e '/^\\unrestrict /d' > "$2"
}
dump_schema "$SNAP" "$OUT/schema-snapshot.sql" 2> "$OUT/schema-snapshot.err"
snapshot_schema_rc=$?
gate schema_snapshot "$snapshot_schema_rc"
dump_schema "$PGURL/${SNAPSHOT_DB}_timing" "$OUT/schema-timing.sql" 2> "$OUT/schema-timing.err"
timing_schema_rc=$?
gate schema_timing "$timing_schema_rc"
if [ "$snapshot_schema_rc" -eq 0 ] && [ "$timing_schema_rc" -eq 0 ]; then
  diff -u "$OUT/schema-snapshot.sql" "$OUT/schema-timing.sql" > "$OUT/schema.diff" 2> "$OUT/schema-diff.err"
  gate schema_diff "$?"
  log "schema_diff_lines=$(wc -l < "$OUT/schema.diff")"
fi

step "2b/2d. post-state counts and required schema checks"
if [ "$migrate_rc" -eq 0 ]; then
  psqlq -f "$HERE/post-counts.sql" "$SNAP" > "$OUT/post-counts.txt" 2>&1
  gate post_checks "$?"
else
  # Collect all of the available counts after a failed migration.
  psql -X -v ON_ERROR_STOP=0 -f "$HERE/post-counts.sql" "$SNAP" > "$OUT/post-counts.txt" 2>&1
fi

step "2c. read-only QA scripts"
qa() {
  local name=$1 output=$2
  shift 2
  DATABASE_URL="$SNAP" "$@" > "$OUT/$output" 2>&1
  gate "$name" "$?"
}
qa closing findings-closing.json node scripts/qa/find-bad-closing-entries.mjs --json
qa rates findings-rates.txt node scripts/qa/find-inverted-rates.mjs
qa sales findings-sales.txt node scripts/qa/find-sales-ledger-drift.mjs
qa purchases findings-purchases.txt node scripts/qa/find-purchases-ledger-drift.mjs
qa payments findings-payment-accounts.json npx --no-install tsx scripts/qa/repair-misposted-payments.ts --json
psqlq -f scripts/qa/find-header-posting-accounts.sql "$SNAP" > "$OUT/post-header-posting.txt" 2>&1
gate post_header_posting "$?"

step "idempotency: second db:migrate is a no-op; every candidate file re-run in journal order"
if [ "$migrate_rc" -eq 0 ]; then
  BEFORE=$(ledger_rows "$SNAP" 2> "$OUT/idempotency.err")
  gate ledger_before "$?"
  DATABASE_URL="$SNAP" npm run --silent db:migrate > "$OUT/db-migrate-2.log" 2>&1
  gate second_migrate "$?"
  AFTER=$(ledger_rows "$SNAP" 2>> "$OUT/idempotency.err")
  gate ledger_after "$?"
  log "ledger_before=$BEFORE ledger_after=$AFTER"
  [ -n "$BEFORE" ] && [ "$BEFORE" = "$AFTER" ]
  gate ledger_noop "$?"

  create_db rerun "TEMPLATE $SNAPSHOT_DB" > "$OUT/rerun-clone.log" 2>&1
  clone_rc=$?
  gate rerun_clone "$clone_rc"
  node "$HERE/time-migrations.mjs" --list-candidates > "$OUT/rerun-files.txt" 2> "$OUT/rerun-list.err"
  list_rc=$?
  gate rerun_list "$list_rc"
  if [ "$clone_rc" -eq 0 ] && [ "$list_rc" -eq 0 ]; then
    : > "$OUT/rerun.txt"
    : > "$OUT/rerun.err"
    rerun_failed=0
    while IFS= read -r f; do
      T0=$(ms)
      printf '\n### %s\n' "$f" >> "$OUT/rerun.err"
      if psqlq --single-transaction -f "$f" "$PGURL/${SNAPSHOT_DB}_rerun" > /dev/null 2>> "$OUT/rerun.err"; then
        echo "$(basename "$f") rerun_ok $(($(ms) - T0))ms" >> "$OUT/rerun.txt"
      else
        echo "$(basename "$f") RERUN_FAILED (see rerun.err)" >> "$OUT/rerun.txt"
        rerun_failed=1
      fi
    done < "$OUT/rerun-files.txt"
    log "rerun_ok_files=$(grep -c rerun_ok "$OUT/rerun.txt")"
    grep RERUN_FAILED "$OUT/rerun.txt" | tee -a "$OUT/steps.log"
    gate rerun "$rerun_failed"
  fi
else
  log "idempotency skipped: snapshot migration failed"
fi

step "7. rollback: restore the pre-0089 dump into a fresh database"
restore_check rollback

step "2. release schema guard and boot readiness"
if [ "$migrate_rc" -eq 0 ]; then
  DATABASE_URL="$SNAP" NODE_ENV=production LOG_LEVEL=info node dist/migrate.js > "$OUT/release-migrate.log" 2>&1
  if gate release_migrate "$?"; then
    # Like scripts/rehearsal/run.mjs, check guard steps that only report failures in the log.
    grep -F '"msg":"Critical schema guard completed"' "$OUT/release-migrate.log" > "$OUT/schema-guard.log"
    if grep -Fq '"failed":0,' "$OUT/schema-guard.log"; then
      gate schema_guard 0
      DATABASE_URL="$SNAP" NODE_ENV=production AUTO_MIGRATE_ON_BOOT=false node "$HERE/boot-check.mjs" > "$OUT/boot.log" 2>&1
      gate boot "$?"
    else
      gate schema_guard 1
    fi
  fi
else
  log "release schema guard and boot skipped: snapshot migration failed"
fi

if [ "$failed" -ne 0 ]; then
  log "FAILED: results in $OUT"
  exit 1
fi
log "done: results in $OUT"
