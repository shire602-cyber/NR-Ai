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
  assert.match(result.stdout, /Timing pass and Drizzle Kit schemas match/);
  assert.match(result.stdout, /Transaction rollback verified at 0134/);
  assert.match(result.stdout, /Rollback restore verified/);
  assert.match(result.stdout, /Seeded preservation and backfills verified/);
  assert.match(result.stdout, /Ordered SQL replay \d+ files \d+ ms/);
  assert.match(result.stdout, /Original 0097 hash and incorrect legacy GL link verified/);
  assert.match(result.stdout, /Base-to-head ledger added 0138_repair_bank_gl_links/);
  assert.match(result.stdout, /Forward GL repair and tenant mismatch findings verified/);
  assert.match(result.stdout, /Tracked rerun historical_upgrade \d+ ms/);
  assert.match(result.stdout, /Base-to-head direct SQL replay \d+ ms/);
  assert.match(result.stdout, /Migration rehearsal passed/);
});
