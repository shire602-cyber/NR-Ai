#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { gunzipSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const migrationsFolder = path.join(root, "migrations");
const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"));
const baseline = "0088_emirate_no_default";
const banking = "0097_w3c_banking";
const historicalTail = "0137_combine_portal_invitations_and_settlement_indexes";
const previousBankRepair = "0138_repair_bank_gl_links";
const previousBankAudit = "0139_audit_bank_match_links";
const previousReceiptRepair = "0140_repair_bank_receipt_provenance";
// Preserve the exact versions from a5e75c2104c846ed5eae71dd0b247161413057b7 so an
// already-applied database carries the original hashes even in a shallow checkout.
const historicalPurchases = "0127_wq2_purchases";
const postCsvPurchasesHash = "7046a6fedb2a4deaf36016a88a9cbe6ecd9664fe3794441592aa3981c530c861";
const historicalHashes = {
  [historicalPurchases]: "107cfd37aac37b878018ca0c5ef1d2f964bb982436e5f0771a11ca3d1b73dcde",
  "0089_platform_foundation": "3da08352369f0ec61e21f218165042af1e762b2092a56d60461623593ab2c011",
  [banking]: "fc545f83c7470e6624251c1d4492a9f6f6a842d2fd20b4afb94fb28e0fbdc7be",
  "0130_cash_sale_numbering": "e4b974423afc431ded0b306efec71f046109ff6dc57d1142f4d41047f8acd8ef",
};
const baselineCount = journal.entries.findIndex(({ tag }) => tag === baseline) + 1;
const bankingCount = journal.entries.findIndex(({ tag }) => tag === banking) + 1;
const historicalCount = journal.entries.findIndex(({ tag }) => tag === historicalTail) + 1;
const previewEntries = [
  ...journal.entries.slice(0, historicalCount),
  ...JSON.parse(readFileSync(path.join(here, "historical/preview-journal-tail.json"), "utf8")),
];
const previousBankRepairCount =
  previewEntries.findIndex(({ tag }) => tag === previousBankRepair) + 1;
const previousBankAuditCount = previewEntries.findIndex(({ tag }) => tag === previousBankAudit) + 1;
const previousReceiptRepairCount =
  previewEntries.findIndex(({ tag }) => tag === previousReceiptRepair) + 1;
// Digest each published journal prefix as timestamp:file hash lines. The listed
// overrides replace edited SQL and the digest verifies every reused file.
const recordedBankHeads = [
  {
    ref: "1c266ae5",
    count: previousBankRepairCount,
    digest: "700535bbb001a66ba8b0f7b3bc2940c1b8dc8d948c045dc4b37caadd2267ba5c",
    historical: {
      [banking]: "1c266ae5/" + banking,
      [previousBankRepair]: previousBankRepair,
    },
    priorReceiptFlags: [true, false, true],
    currentReceiptFlags: [true, false, true],
  },
  {
    ref: "29e9a1fa",
    count: previousBankAuditCount,
    digest: "9351fff057d35a11459c280c6c7ccdc076e805ebe0ae0f70375f00babe6cd8ed",
    historical: {
      [banking]: "29e9a1fa/" + banking,
      [previousBankAudit]: "29e9a1fa/" + previousBankAudit,
    },
    priorReceiptFlags: [false, false, false],
    currentReceiptFlags: [true, false, false],
  },
];
const recordedInvoiceHead = {
  ref: "48b878ba",
  count: previousReceiptRepairCount,
  digest: "f97665143a3edfdd658e7768d4e9934bd397c5ba8756ffab3aedfaec6de732b3",
  historical: {
    [banking]: "48b878ba/" + banking,
    [previousBankAudit]: "48b878ba/" + previousBankAudit,
  },
};
const receiptBankLine = "nr-rehearsal:receipt-provenance:transaction:bank-created";
const invoiceBankLine = "nr-rehearsal:bank-invoice-provenance:bank-created-line";
const currentInvoiceProvenance = [
  [true, false],
  [false, true],
];
const files = readMigrationFiles({ migrationsFolder });
const image = "postgres:16-bookworm";
const name = "nr-migration-rehearsal-" + randomBytes(8).toString("hex");
const password = randomBytes(24).toString("hex");
const archive = "/tmp/rehearsal.dump";
const ledgerSequence = '"drizzle"."__drizzle_migrations_id_seq"';
const env = { PATH: process.env.PATH, LANG: "C", TZ: "UTC" };
// Keep local Docker configuration available without inheriting DOCKER_HOST or app/PG variables.
const dockerEnv = { ...env, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let port;
let scratch;
let containerStarted = false;

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
    ...options,
  });
  if (result.error) throw new Error(command + " could not complete", { cause: result.error });
  return result;
}

function output(result, label) {
  if (result.status !== 0) {
    throw new Error(
      label + " exited " + (result.status ?? result.signal) + "\n" + result.stdout + result.stderr
    );
  }
  return result.stdout.trim();
}

function docker(args, options) {
  return capture("docker", ["--context", "default", ...args], { env: dockerEnv, ...options });
}

function inPostgres(args, options) {
  return output(docker(["exec", "-i", name, ...args], options), args[0]);
}

function psql(database, sql) {
  return inPostgres(["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], {
    input: sql,
  });
}

function url(database) {
  return (
    "postgres://postgres:" + password + "@127.0.0.1:" + port + "/" + database + "?sslmode=disable"
  );
}

async function withClient(database, fn) {
  const client = new pg.Client({ connectionString: url(database), connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end();
  }
}

function app(database, args) {
  return capture(process.execPath, args, {
    env: {
      ...env,
      DATABASE_URL: url(database),
      DOTENV_CONFIG_PATH: path.join(scratch, "intentionally-absent.env"),
      NODE_ENV: "production",
      SESSION_SECRET: "rehearsal-only-session-" + password,
      JWT_SECRET: "rehearsal-only-jwt-" + password,
    },
  });
}

function release(database) {
  return app(database, ["--import", "tsx", "server/migrate.ts"]);
}

function applyRelease(database) {
  const logs = output(release(database), "Release migration for " + database);
  // The release entrypoint logs schema guard errors without changing its exit code.
  const guard = logs
    .split("\n")
    .find((line) => line.includes('"msg":"Critical schema guard completed"'));
  assert.equal(guard && JSON.parse(guard).failed, 0, logs);
}

async function timed(label, action) {
  const start = performance.now();
  const result = await action();
  console.log(label + " " + Math.round(performance.now() - start) + " ms");
  return result;
}

async function startPostgres() {
  const result = docker([
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_PASSWORD=" + password,
    image,
  ]);
  output(result, "Start local PostgreSQL container");
  containerStarted = true;

  const published = output(docker(["port", name, "5432/tcp"]), "Find the local PostgreSQL port");
  const binding = /^127\.0\.0\.1:(\d+)$/.exec(published);
  assert.ok(binding, "Expected a PostgreSQL port bound only to IPv4 loopback");
  port = Number(binding[1]);
  // Check TCP inside the container so the entrypoint's temporary socket-only
  // server cannot report readiness before the permanent server is running.
  for (let i = 0; i < 60; i++) {
    if (docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]).status === 0) {
      const identitySql =
        "SELECT current_setting('server_version'), system_identifier::text FROM pg_control_system()";
      const expected = psql("postgres", identitySql);
      const actual = await withClient(
        "postgres",
        async (client) => (await client.query(identitySql)).rows[0]
      );
      assert.equal(
        actual.current_setting + "|" + actual.system_identifier,
        expected,
        "Expected the disposable PostgreSQL cluster"
      );
      assert.match(actual.current_setting, /^16\./);
      console.log("PostgreSQL " + actual.current_setting);
      return;
    }
    await delay(500);
  }
  throw new Error(
    "Timed out waiting for the local PostgreSQL container\n" +
      output(docker(["logs", name]), "Read PostgreSQL logs")
  );
}

async function verifyLedger(database, expectedFiles = files) {
  const expected = expectedFiles.map(({ folderMillis, hash }) => ({
    created_at: String(folderMillis),
    hash,
  }));
  const rows = await withClient(
    database,
    async (client) =>
      (await client.query("SELECT created_at, hash FROM drizzle.__drizzle_migrations ORDER BY id"))
        .rows
  );
  assert.deepEqual(rows, expected, database + " ledger differs from journal order or file hashes");
}

function createDatabase(database, template = "template0") {
  // All database names and templates are script constants within this container.
  psql("postgres", "CREATE DATABASE " + database + " TEMPLATE " + template);
}

function fixture(database, filename) {
  return psql(database, readFileSync(path.join(here, filename), "utf8"));
}

function schema(database) {
  return inPostgres([
    "pg_dump",
    "-U",
    "postgres",
    "-s",
    "--no-owner",
    "--no-privileges",
    database,
  ]).replace(/^\\(?:un)?restrict .*(?:\r?\n|$)/gm, "");
}

function qualifiedName(namespace, object) {
  return [namespace, object].map((part) => '"' + part.replaceAll('"', '""') + '"').join(".");
}

async function databaseState(database, normalizeCreatedJournalFor = null) {
  const schemaHash = createHash("sha256").update(schema(database)).digest("hex");
  return withClient(database, async (client) => {
    const data = {};
    const { rows: tables } = await client.query(
      "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'drizzle') ORDER BY 1, 2"
    );
    for (const { schemaname, tablename } of tables) {
      const name = qualifiedName(schemaname, tablename);
      // The historical upgrade asserts the expected flag separately and
      // fingerprints every other field, including all other allocation flags.
      const normalizeFlag =
        normalizeCreatedJournalFor && name === qualifiedName("public", "bank_transaction_matches");
      const row = normalizeFlag
        ? "CASE WHEN row_data.bank_transaction_id = md5($1)::uuid THEN to_jsonb(row_data) - 'created_journal' ELSE to_jsonb(row_data) END"
        : "to_jsonb(row_data)";
      const { rows } = await client.query(
        "SELECT count(*)::int AS count, md5(COALESCE(string_agg(body, E'\\n' ORDER BY body COLLATE \"C\"), '')) AS hash " +
          "FROM (SELECT (" +
          row +
          ")::text AS body FROM " +
          name +
          " row_data) ordered",
        normalizeFlag ? [normalizeCreatedJournalFor] : []
      );
      data[name] = rows[0];
    }
    const { rows: sequences } = await client.query(
      "SELECT schemaname, sequencename FROM pg_sequences WHERE schemaname IN ('public', 'drizzle') ORDER BY 1, 2"
    );
    for (const { schemaname, sequencename } of sequences) {
      const name = qualifiedName(schemaname, sequencename);
      const { rows } = await client.query("SELECT last_value, is_called FROM " + name);
      data[name] = rows[0];
    }
    return { schemaHash, data };
  });
}

function verifyState(actual, expected, label) {
  assert.equal(actual.schemaHash, expected.schemaHash, label + " changed schema");
  const keys = new Set([...Object.keys(actual.data), ...Object.keys(expected.data)]);
  const changed = [...keys].filter(
    (key) => !isDeepStrictEqual(actual.data[key], expected.data[key])
  );
  assert.deepEqual(changed, [], label + " changed these tables or sequences");
}

function stageMigrations(
  name,
  count,
  historical = {},
  knownHashes = {},
  entries = journal.entries.slice(0, count)
) {
  const folder = path.join(scratch, name);
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const { tag } of entries) {
    const file = tag + ".sql";
    const destination = path.join(folder, file);
    if (historical[tag]) {
      const source = path.join(here, "historical", historical[tag] + ".sql");
      const sql = tag === banking || tag === historicalPurchases
        ? gunzipSync(readFileSync(source + ".gz"))
        : readFileSync(source);
      if (knownHashes[tag]) {
        assert.equal(
          createHash("sha256").update(sql).digest("hex"),
          knownHashes[tag],
          "Historical SQL hash changed for " + tag
        );
      }
      writeFileSync(destination, sql);
    } else {
      copyFileSync(path.join(migrationsFolder, file), destination);
    }
  }
  return folder;
}

async function applyStagedMigrations(database, folder) {
  await withClient(database, (client) => migrate(drizzle(client), { migrationsFolder: folder }));
}

async function prepareBaseline() {
  const folder = stageMigrations("baseline", baselineCount);
  createDatabase("seed");
  await applyStagedMigrations("seed", folder);
  await verifyLedger("seed", files.slice(0, baselineCount));
  fixture("seed", "seed.sql");
}

async function restore(database) {
  createDatabase(database);
  await timed("Restore " + database, () =>
    inPostgres([
      "pg_restore",
      "-U",
      "postgres",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "-d",
      database,
      archive,
    ])
  );
}

async function checkTrackedReplay(database, expectedFiles = files) {
  const before = await databaseState(database);
  await timed("Tracked rerun " + database, () => applyRelease(database));
  await verifyLedger(database, expectedFiles);
  verifyState(await databaseState(database), before, database + " tracked rerun");
}

async function verifyRollback() {
  psql(
    "upgrade",
    "INSERT INTO subscription_plans (name, price_monthly) VALUES ('Legacy rehearsal price', 125)"
  );
  const before = await databaseState("upgrade");
  await timed("Guarded migration failure", () => {
    const result = release("upgrade");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /0134: subscription_plans holds 1 row/);
  });
  await verifyLedger("upgrade", files.slice(0, baselineCount));
  const after = await databaseState("upgrade");
  // PostgreSQL nextval is nontransactional, even when all ledger inserts roll back.
  assert.ok(
    BigInt(after.data[ledgerSequence].last_value) > BigInt(before.data[ledgerSequence].last_value)
  );
  delete before.data[ledgerSequence];
  delete after.data[ledgerSequence];
  verifyState(after, before, "Failed upgrade");
  console.log("Transaction rollback verified at 0134");
  psql("postgres", "DROP DATABASE upgrade");
}

async function timePendingFiles(expectedFixture) {
  createDatabase("file_timing", "upgrade");
  const reportPath = path.join(scratch, "per-file.json");
  const text = await timed("Per-file migration pass", () =>
    output(
      app("file_timing", ["docs/release/rehearsal/time-migrations.mjs", "--json", reportPath]),
      "Per-file migration pass"
    )
  );
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.deepEqual(
    report.results.map(({ tag }) => tag),
    journal.entries.slice(baselineCount).map(({ tag }) => tag)
  );
  await verifyLedger("file_timing");
  assert.equal(
    fixture("file_timing", "snapshot.sql"),
    expectedFixture,
    "Timed pass changed business data"
  );
  console.log(text);

  createDatabase("drizzle_kit", "upgrade");
  await timed("Seeded Drizzle Kit migration", () =>
    output(
      app("drizzle_kit", ["node_modules/drizzle-kit/bin.cjs", "migrate"]),
      "Seeded Drizzle Kit migration"
    )
  );
  await verifyLedger("drizzle_kit");
  assert.equal(
    fixture("drizzle_kit", "snapshot.sql"),
    expectedFixture,
    "Drizzle Kit changed business data"
  );
  assert.equal(
    schema("drizzle_kit"),
    schema("file_timing"),
    "Timing pass and Drizzle Kit produced different schemas"
  );
  console.log("Timing pass and Drizzle Kit schemas match");
}

async function checkBankingGuards() {
  const database = "banking_guard";
  createDatabase(database, "upgrade");
  fixture(database, "seed-bank-payment-links.sql");
  fixture(database, "seed-bank-gl-edges.sql");
  fixture(database, "seed-bank-receipt-provenance.sql");
  fixture(database, "seed-bank-duplicate-legacy-claims.sql");
  fixture(database, "seed-bank-invoice-provenance.sql");
  fixture(database, "seed-bank-legacy-payment-paths.sql");
  const folder = stageMigrations("banking-guard", bankingCount);
  await timed("Banking migration through " + banking, () =>
    applyStagedMigrations(database, folder)
  );
  await verifyLedger(database, files.slice(0, bankingCount));
  fixture(database, "assert-0097.sql");
  fixture(database, "assert-bank-payment-links.sql");
  fixture(database, "assert-bank-gl-edges.sql");
  fixture(database, "assert-bank-duplicate-legacy-claims.sql");
  assert.deepEqual(
    JSON.parse(fixture(database, "bank-invoice-provenance.sql")),
    currentInvoiceProvenance
  );
  assert.deepEqual(JSON.parse(fixture(database, "bank-receipt-provenance.sql")), [
    true,
    false,
    false,
  ]);
  fixture(database, "seed-bank-competing-claims.sql");
  console.log("0097 tenant guards verified before forward repair");
  console.log("Shared posting links and ambiguous payment candidate verified");
  console.log("0097 competing unallocated legacy lines retain NULL payment IDs");
  console.log("0097 distinguishes a linked payment from a bank-created invoice journal");

  await applyRelease(database);
  await verifyLedger(database);
  fixture(database, "assert-bank-payment-findings.sql");
  fixture(database, "assert-bank-gl-eligibility-findings.sql");
  fixture(database, "assert-bank-competing-claims.sql");
  fixture(database, "assert-bank-legacy-payment-paths.sql");
  verifyInvoiceJournalFindings(database, "0");
  const before = await databaseState(database);
  await timed("Ordered SQL replay with banking edge cases", () =>
    replaySql(database, baselineCount)
  );
  verifyState(await databaseState(database), before, "Ordered SQL replay with banking edge cases");
  console.log(
    "Legacy payment and already-paid match audit evidence preserved through ordered replay"
  );
}

async function stageReleaseSchema(database) {
  // Stage unrelated release changes before taking the bank repair baseline.
  for (const tag of [
    "0138_secure_portal_invitations",
    "0139_bind_portal_invite_and_verification_lifecycle",
    "0140_preserve_reminder_language",
    "0141_firm_membership_provenance",
    "0142_recover_firm_membership_provenance",
    "0143_preserve_firm_grant_review",
    "0144_receipt_invoice_number",
    "0145_receipt_rate_and_capture",
    "0154_postmerge_buyer_billing_payroll",
    "0155_cash_sale_buyer_and_checkout_reservation",
    "0156_request_throttle_buckets",
    "0157_preserve_period_locks_and_repair_cash_sale_numbering",
  ]) {
    psql(database, readFileSync(path.join(migrationsFolder, tag + ".sql"), "utf8"));
  }
}

async function applyPublishedBankHead(
  database,
  { ref, count, digest, historical, entries = previewEntries.slice(0, count), usesPostCsvPurchases }
) {
  const purchases = usesPostCsvPurchases ? "post-csv/" + historicalPurchases : historicalPurchases;
  const purchasesHash = usesPostCsvPurchases ? postCsvPurchasesHash : historicalHashes[historicalPurchases];
  const folder = stageMigrations(
    database,
    count,
    { [historicalPurchases]: purchases, ...historical },
    { [historicalPurchases]: purchasesHash },
    entries
  );
  const originalFiles = readMigrationFiles({ migrationsFolder: folder });
  const hash = createHash("sha256");
  for (const { folderMillis, hash: fileHash } of originalFiles) {
    hash.update(folderMillis + ":" + fileHash + "\n");
  }
  assert.equal(hash.digest("hex"), digest, ref + " historical migration ledger fingerprint");
  await timed("Apply exact migrations from " + ref, () => applyStagedMigrations(database, folder));
  await verifyLedger(database, originalFiles);
  console.log("Exact " + ref + " ledger verified (" + count + " entries)");
  return originalFiles;
}

async function checkRecordedBankAudit({
  ref,
  count,
  digest,
  historical,
  priorReceiptFlags,
  currentReceiptFlags,
}) {
  const database = "recorded_bank_" + ref;
  await restore(database);
  fixture(database, "seed-bank-payment-links.sql");
  fixture(database, "seed-bank-receipt-provenance.sql");
  const originalFiles = await applyPublishedBankHead(database, { ref, count, digest, historical });
  assert.deepEqual(JSON.parse(fixture(database, "bank-receipt-provenance.sql")), priorReceiptFlags);
  fixture(database, "seed-bank-competing-claims.sql");
  assert.equal(
    psql(
      database,
      "SELECT count(*) FROM bank_transaction_matches WHERE id = md5('nr-rehearsal:bank-competing-claim:pending-match')::uuid AND payment_id IS NULL"
    ),
    "1",
    "The recorded competing claim must have a NULL payment ID before forward repair"
  );

  const mismatchedLinks = Number(
    psql(
      database,
      [
        "SELECT count(*) FROM bank_transaction_matches m",
        "JOIN invoice_payments p ON p.id = m.payment_id",
        "WHERE m.bank_transaction_id IN (md5('nr-rehearsal:bank-payment:line:shared-a')::uuid,",
        "md5('nr-rehearsal:bank-payment:line:shared-b')::uuid) AND p.invoice_id <> m.target_id",
      ].join(" ")
    )
  );
  assert.equal(
    mismatchedLinks,
    ref === "1c266ae5" ? 1 : 0,
    "Historical shared-journal payment link count"
  );

  await stageReleaseSchema(database);
  const repairedFlag = priorReceiptFlags[0] !== currentReceiptFlags[0] ? receiptBankLine : null;
  const before = await databaseState(database, repairedFlag);
  await timed("Apply forward bank migrations from " + ref, () =>
    applyStagedMigrations(database, migrationsFolder)
  );
  const expectedFiles = [
    ...originalFiles,
    ...files.filter((file) => file.folderMillis > originalFiles.at(-1).folderMillis),
  ];
  await verifyLedger(database, expectedFiles);
  fixture(database, "assert-bank-payment-findings.sql");
  fixture(database, "assert-bank-competing-claims.sql");
  assert.deepEqual(
    JSON.parse(fixture(database, "bank-receipt-provenance.sql")),
    currentReceiptFlags
  );
  assert.equal(
    Number(
      psql(
        database,
        [
          "SELECT count(*) FROM bank_gl_migration_findings f",
          "CROSS JOIN LATERAL jsonb_array_elements(f.details->'allocations') a(data)",
          "WHERE f.kind = 'invoice_payment_link_review' AND (a.data->'problems') ? 'payment_link_mismatch'",
          "AND f.bank_transaction_id IN (md5('nr-rehearsal:bank-payment:line:shared-a')::uuid,",
          "md5('nr-rehearsal:bank-payment:line:shared-b')::uuid)",
        ].join(" ")
      )
    ),
    mismatchedLinks,
    "Record every historically mislinked payment"
  );

  const after = await databaseState(database, repairedFlag);
  const auditChanges = [
    qualifiedName("public", "bank_gl_migration_findings"),
    qualifiedName("drizzle", "__drizzle_migrations"),
    ledgerSequence,
  ];
  const unchangedBefore = { ...before, data: { ...before.data } };
  const unchangedAfter = { ...after, data: { ...after.data } };
  for (const key of auditChanges) {
    assert.notDeepEqual(
      unchangedBefore.data[key],
      unchangedAfter.data[key],
      "Audit must change " + key
    );
    delete unchangedBefore.data[key];
    delete unchangedAfter.data[key];
  }
  verifyState(unchangedAfter, unchangedBefore, "Audit of recorded bank matches");
  const migrated = await databaseState(database);
  await timed("Replay forward bank migrations from " + ref, () =>
    replaySql(database, historicalCount)
  );
  verifyState(
    await databaseState(database),
    migrated,
    "Replay forward bank migrations from " + ref
  );
  console.log("Forward bank provenance and competing-claim findings verified from " + ref);
}

function verifyInvoiceJournalFindings(database, expectedCount) {
  assert.equal(
    psql(
      database,
      "SELECT count(*) FROM bank_gl_migration_findings WHERE bank_transaction_id = md5('nr-rehearsal:bank-invoice-provenance:bank-created-line')::uuid AND kind = 'invoice_payment_link_review'"
    ),
    expectedCount,
    "Unexpected payment-link finding count for the bank-created invoice journal"
  );
}

async function checkPreviewUpgrade(head) {
  const { ref } = head;
  const database = "preview_" + ref;
  await restore(database);
  const originalFiles = await applyPublishedBankHead(database, head);
  const before = fixture(database, "snapshot.sql");
  await timed("Apply release migrations from " + ref, () => applyRelease(database));
  await verifyLedger(database, [
    ...originalFiles,
    ...files.filter((file) => file.folderMillis > originalFiles.at(-1).folderMillis),
  ]);
  assert.ok(schema(database) === schema("clean"), "Preview upgrade schema differs");
  assert.equal(fixture(database, "snapshot.sql"), before, "Preview upgrade changed business data");
  console.log("Preview catch-up verified from " + ref);
}

async function checkRecordedInvoiceProvenance() {
  const { ref } = recordedInvoiceHead;
  const database = "recorded_bank_" + ref;
  await restore(database);
  fixture(database, "seed-bank-invoice-provenance.sql");
  const originalFiles = await applyPublishedBankHead(database, recordedInvoiceHead);
  assert.deepEqual(JSON.parse(fixture(database, "bank-invoice-provenance.sql")), [
    [true, false],
    [false, false],
  ]);
  verifyInvoiceJournalFindings(database, "1");
  await stageReleaseSchema(database);
  const before = await databaseState(database, invoiceBankLine);

  await timed("Apply forward bank migrations from " + ref, () =>
    applyStagedMigrations(database, migrationsFolder)
  );
  await verifyLedger(database, [
    ...originalFiles,
    ...files.filter((file) => file.folderMillis > originalFiles.at(-1).folderMillis),
  ]);
  assert.deepEqual(
    JSON.parse(fixture(database, "bank-invoice-provenance.sql")),
    currentInvoiceProvenance
  );
  const after = await databaseState(database, invoiceBankLine);
  for (const key of [qualifiedName("drizzle", "__drizzle_migrations"), ledgerSequence]) {
    assert.notDeepEqual(before.data[key], after.data[key], "Forward repair must change " + key);
    delete before.data[key];
    delete after.data[key];
  }
  verifyState(after, before, "Invoice provenance repair of recorded bank matches");

  const migrated = await databaseState(database);
  await timed("Replay forward bank migrations from " + ref, () =>
    replaySql(database, historicalCount)
  );
  verifyState(
    await databaseState(database),
    migrated,
    "Replay forward bank migrations from " + ref
  );
  await timed("Ordered SQL replay of invoice provenance from " + ref, () =>
    replaySql(database, baselineCount)
  );
  verifyState(
    await databaseState(database),
    migrated,
    "Ordered SQL replay of invoice provenance from " + ref
  );
  console.log("Forward invoice journal provenance and linked payment verified from " + ref);
}

async function checkHistoricalUpgrade() {
  const database = "historical_upgrade";
  await restore(database);
  fixture(database, "seed-bank-invoice-provenance.sql");
  fixture(database, "seed-bank-legacy-payment-paths.sql");
  const folder = stageMigrations(
    "historical",
    historicalCount,
    Object.fromEntries(Object.keys(historicalHashes).map((tag) => [tag, tag])),
    historicalHashes
  );
  await timed("Apply original base through " + historicalTail, () =>
    applyStagedMigrations(database, folder)
  );
  const originalFiles = readMigrationFiles({ migrationsFolder: folder });
  await verifyLedger(database, originalFiles);
  fixture(database, "assert-upgraded.sql");
  fixture(database, "assert-historical-bank.sql");
  console.log("Original 0097 hash and incorrect legacy GL link verified");
  fixture(database, "seed-forward-bank.sql");
  fixture(database, "seed-bank-gl-edges.sql");
  const preserved = fixture(database, "snapshot.sql");

  await timed("Base-to-head release migration", () => applyRelease(database));
  const expectedFiles = [...originalFiles, ...files.slice(historicalCount)];
  await verifyLedger(database, expectedFiles);
  assert.equal(
    fixture(database, "snapshot.sql"),
    preserved,
    "Base-to-head upgrade changed preserved business data"
  );
  fixture(database, "assert-upgraded.sql");
  fixture(database, "assert-0097.sql");
  fixture(database, "assert-bank-findings.sql");
  fixture(database, "assert-forward-bank.sql");
  fixture(database, "assert-bank-gl-edges.sql");
  fixture(database, "assert-bank-gl-eligibility-findings.sql");
  fixture(database, "assert-bank-legacy-payment-paths.sql");
  assert.deepEqual(
    JSON.parse(fixture(database, "bank-invoice-provenance.sql")),
    currentInvoiceProvenance
  );
  verifyInvoiceJournalFindings(database, "0");
  console.log(
    "Base-to-head ledger added " +
      journal.entries
        .slice(historicalCount)
        .map(({ tag }) => tag)
        .join(", ")
  );
  console.log("Forward GL repair and tenant mismatch findings verified");
  await checkTrackedReplay(database, expectedFiles);
  const before = await databaseState(database);
  await timed("Base-to-head direct SQL replay", () => replaySql(database, historicalCount));
  verifyState(await databaseState(database), before, "Base-to-head direct SQL replay");
  await timed("Ordered SQL replay with live allocations", () => replaySql(database, baselineCount));
  verifyState(await databaseState(database), before, "Ordered SQL replay with live allocations");
  fixture(database, "assert-forward-bank.sql");
  fixture(database, "assert-bank-gl-edges.sql");
  console.log("Live allocation state and GL links preserved");
}

async function replaySql(database, start) {
  await withClient(database, async (client) => {
    await client.query("BEGIN");
    for (let i = start; i < files.length; i++) {
      try {
        for (const statement of files[i].sql) {
          if (statement.trim()) await client.query(statement);
        }
      } catch (error) {
        throw new Error("SQL replay failed at " + journal.entries[i].tag, { cause: error });
      }
    }
    await client.query("COMMIT");
  });
}

async function checkRawReplay() {
  createDatabase("raw_replay", "upgrade");
  fixture("raw_replay", "seed-replay-bank.sql");
  const before = await databaseState("raw_replay");
  await timed("Ordered SQL replay " + String(files.length - baselineCount) + " files", () =>
    replaySql("raw_replay", baselineCount)
  );
  verifyState(await databaseState("raw_replay"), before, "Ordered SQL replay");
  fixture("raw_replay", "assert-upgraded.sql");
}

function cleanup() {
  try {
    if (containerStarted) output(docker(["rm", "-f", "-v", name]), "Remove rehearsal container");
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

async function rehearse() {
  assert.equal(process.argv.length, 2, "The migration rehearsal takes no database arguments");
  // node-postgres reads optional settings from PG* even with a connection string.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("PG")) delete process.env[key];
  }
  assert.ok(
    baselineCount > 0 &&
      baselineCount < bankingCount &&
      bankingCount < historicalCount &&
      historicalCount < previousBankRepairCount &&
      previousBankRepairCount < previousBankAuditCount &&
      previousBankAuditCount < previousReceiptRepairCount &&
      previousReceiptRepairCount < files.length,
    "Expected ordered baseline, banking, and historical release entries in the journal"
  );
  output(
    capture(process.execPath, ["scripts/check-migration-journal.mjs"]),
    "Check migration journal"
  );
  journal.entries.forEach(({ idx, when }, index) => {
    assert.equal(idx, index, "Journal indices must follow file order");
    if (index > 0)
      assert.ok(when > journal.entries[index - 1].when, "Journal timestamps must increase");
  });

  scratch = mkdtempSync(path.join(tmpdir(), "nr-migration-rehearsal-"));
  await startPostgres();
  createDatabase("clean");
  await timed("Clean release migration", () => applyRelease("clean"));
  await verifyLedger("clean");
  console.log("Clean ledger " + files.length + " files in journal order");
  await checkTrackedReplay("clean");

  await timed("Baseline and seed through " + baseline, prepareBaseline);
  const seedState = await databaseState("seed");
  const businessData = fixture("seed", "snapshot.sql");
  const seeded = JSON.parse(businessData);
  const fixtureCounts = {
    companies: 4,
    engagements: 2,
    invoices: 48,
    invoice_lines: 96,
    bills: 32,
    bill_lines: 64,
    vat_returns: 4,
    bank_accounts: 5,
    bank_transactions: 18,
  };
  for (const [table, count] of Object.entries(fixtureCounts)) {
    assert.equal(seeded[table]?.length, count, "Unexpected rehearsal fixture size for " + table);
  }
  console.log(
    "Seed rows " +
      Object.entries(fixtureCounts)
        .map(([table, count]) => table + "=" + count)
        .join(" ")
  );
  await timed("Create custom-format backup", () =>
    inPostgres(["pg_dump", "-U", "postgres", "-Fc", "-f", archive, "seed"])
  );
  const archiveCatalog = inPostgres(["pg_restore", "--list", archive]);
  assert.match(archiveCatalog, /TABLE DATA public invoices/);
  console.log("Backup bytes " + inPostgres(["stat", "-c", "%s", archive]));
  console.log("Backup SHA-256 " + inPostgres(["sha256sum", archive]).split(" ")[0]);

  await restore("upgrade");
  await verifyLedger("upgrade", files.slice(0, baselineCount));
  verifyState(await databaseState("upgrade"), seedState, "Backup restore");
  console.log("Backup restore verified");
  await checkBankingGuards();
  await timePendingFiles(businessData);

  await verifyRollback();
  await restore("upgrade");
  await verifyLedger("upgrade", files.slice(0, baselineCount));
  verifyState(await databaseState("upgrade"), seedState, "Rollback restore");
  console.log("Rollback restore verified");

  await timed("Seeded release migration", () => applyRelease("upgrade"));
  await verifyLedger("upgrade");
  assert.equal(
    fixture("upgrade", "snapshot.sql"),
    businessData,
    "Upgrade changed preserved business data"
  );
  fixture("upgrade", "assert-upgraded.sql");
  fixture("upgrade", "assert-0097.sql");
  fixture("upgrade", "assert-bank-findings.sql");
  console.log("Seeded preservation and backfills verified");
  assert.ok(schema("upgrade") === schema("clean"), "Clean and upgraded release schemas differ");
  console.log("Clean and upgraded release schemas match");
  await checkTrackedReplay("upgrade");
  await checkRawReplay();
  await checkHistoricalUpgrade();
  for (const head of recordedBankHeads) {
    await checkRecordedBankAudit(head);
  }
  await checkRecordedInvoiceProvenance();
  await checkPreviewUpgrade({
    ref: "d6d0c35c",
    count: previewEntries.length,
    digest: "48a48a671e6a85d310c3e94c4feb4bc6e9e7a8c4b222ba5f4b4d7e8243faad2e",
    historical: {},
  });
  const preFirmEntries = [
    ...journal.entries.slice(0, historicalCount),
    ...JSON.parse(readFileSync(path.join(here, "historical/pre-firm-release-journal-tail.json"), "utf8")),
  ];
  await checkPreviewUpgrade({
    ref: "0be21c6d",
    count: preFirmEntries.length,
    digest: "b621b62018b637563e8c43d0989f16a14c6abefd2c194e0415d785fb88194ab3",
    historical: {},
    entries: preFirmEntries,
    usesPostCsvPurchases: true,
  });
  const preReceiptEntries = [
    ...journal.entries.slice(0, historicalCount),
    ...JSON.parse(readFileSync(path.join(here, "historical/pre-receipt-release-journal-tail.json"), "utf8")),
  ];
  await checkPreviewUpgrade({
    ref: "a3eb9a2a",
    count: preReceiptEntries.length,
    digest: "8e1bce2e2a94da442afb51da31c9eac06fd45265255b28577ab4883c078d4b1b",
    historical: {},
    entries: preReceiptEntries,
    usesPostCsvPurchases: true,
  });
  console.log("Migration rehearsal passed");
}

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => {
    cleanup();
    process.exit(exitCode);
  });
}

try {
  await rehearse();
} finally {
  cleanup();
}
