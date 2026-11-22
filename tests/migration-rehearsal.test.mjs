import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/rehearsal/run.mjs", import.meta.url));

test("rejects a database argument before provisioning PostgreSQL", () => {
  const result = spawnSync(
    process.execPath,
    [script, "postgres://unused:unused@production.invalid:5432/unused"],
    { encoding: "utf8", timeout: 10_000 }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /takes no database arguments/);
});

test("rehearses the journal and rollback entirely on disposable PostgreSQL", () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 240_000,
    env: {
      ...process.env,
      DATABASE_URL: "postgres://unused:unused@production.invalid:5432/unused",
      TEST_DATABASE_ADMIN_URL: "postgres://unused:unused@staging.invalid:5432/unused",
      PGHOST: "production.invalid",
      PGOPTIONS: "-c nonexistent_rehearsal_option=1",
      PGSSLMODE: "verify-full",
      DOCKER_HOST: "tcp://production.invalid:2376",
    },
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Clean ledger \d+ files in journal order/);
  assert.match(result.stdout, /Backup restore verified/);
  assert.match(result.stdout, /0097 tenant guards verified before forward repair/);
  assert.match(result.stdout, /Shared posting links and ambiguous payment candidate verified/);
  assert.match(result.stdout, /0097 competing unallocated legacy lines retain NULL payment IDs/);
  assert.match(
    result.stdout,
    /0097 distinguishes a linked payment from a bank-created invoice journal/
  );
  assert.match(result.stdout, /Ordered SQL replay with banking edge cases \d+ ms/);
  assert.match(
    result.stdout,
    /Legacy payment and already-paid match audit evidence preserved through ordered replay/
  );
  assert.match(result.stdout, /Timing pass and Drizzle Kit schemas match/);
  assert.match(result.stdout, /Transaction rollback verified at 0134/);
  assert.match(result.stdout, /Rollback restore verified/);
  assert.match(result.stdout, /Seeded preservation and backfills verified/);
  assert.match(result.stdout, /Ordered SQL replay \d+ files \d+ ms/);
  assert.match(result.stdout, /Original 0097 hash and incorrect legacy GL link verified/);
  assert.match(
    result.stdout,
    /Base-to-head ledger added 0138_secure_portal_invitations, 0139_bind_portal_invite_and_verification_lifecycle, 0140_preserve_reminder_language, 0141_firm_membership_provenance, 0142_recover_firm_membership_provenance, 0143_preserve_firm_grant_review, 0138_repair_bank_gl_links, 0139_audit_bank_match_links, 0140_repair_bank_receipt_provenance, 0141_restore_legacy_invoice_bank_provenance/
  );
  assert.match(result.stdout, /Forward GL repair and tenant mismatch findings verified/);
  assert.match(result.stdout, /Tracked rerun historical_upgrade \d+ ms/);
  assert.match(result.stdout, /Base-to-head direct SQL replay \d+ ms/);
  assert.match(result.stdout, /Ordered SQL replay with live allocations \d+ ms/);
  assert.match(result.stdout, /Live allocation state and GL links preserved/);
  assert.match(result.stdout, /Exact 1c266ae5 ledger verified \(138 entries\)/);
  assert.match(result.stdout, /Exact 29e9a1fa ledger verified \(139 entries\)/);
  assert.match(result.stdout, /Exact 48b878ba ledger verified \(140 entries\)/);
  assert.match(
    result.stdout,
    /Forward bank provenance and competing-claim findings verified from 1c266ae5/
  );
  assert.match(
    result.stdout,
    /Forward bank provenance and competing-claim findings verified from 29e9a1fa/
  );
  assert.match(
    result.stdout,
    /Forward invoice journal provenance and linked payment verified from 48b878ba/
  );
  assert.match(result.stdout, /Preview catch-up verified from 0be21c6d/);
  assert.match(result.stdout, /Migration rehearsal passed/);
});
