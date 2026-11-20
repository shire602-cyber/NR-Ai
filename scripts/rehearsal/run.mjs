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

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const migrationsFolder = path.join(root, "migrations");
const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"));
const baseline = "0088_emirate_no_default";
const baselineCount = journal.entries.findIndex(({ tag }) => tag === baseline) + 1;
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

async function verifyLedger(database, count) {
  const expected = files.slice(0, count).map(({ folderMillis, hash }) => ({
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

async function databaseState(database) {
  const schemaHash = createHash("sha256").update(schema(database)).digest("hex");
  return withClient(database, async (client) => {
    const data = {};
    const { rows: tables } = await client.query(
      "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'drizzle') ORDER BY 1, 2"
    );
    for (const { schemaname, tablename } of tables) {
      const name = qualifiedName(schemaname, tablename);
      const { rows } = await client.query(
        "SELECT count(*)::int AS count, md5(COALESCE(string_agg(body, E'\\n' ORDER BY body COLLATE \"C\"), '')) AS hash " +
          "FROM (SELECT to_jsonb(row_data)::text AS body FROM " +
          name +
          " row_data) ordered"
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

async function prepareBaseline() {
  const folder = path.join(scratch, "baseline");
  mkdirSync(path.join(folder, "meta"), { recursive: true });
  const entries = journal.entries.slice(0, baselineCount);
  writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const { tag } of entries) {
    const file = tag + ".sql";
    copyFileSync(path.join(migrationsFolder, file), path.join(folder, file));
  }
  createDatabase("seed");
  await withClient("seed", (client) => migrate(drizzle(client), { migrationsFolder: folder }));
  await verifyLedger("seed", baselineCount);
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

async function checkTrackedReplay(database) {
  const before = await databaseState(database);
  await timed("Tracked rerun " + database, () => applyRelease(database));
  await verifyLedger(database, files.length);
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
  await verifyLedger("upgrade", baselineCount);
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
  await verifyLedger("file_timing", files.length);
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
  await verifyLedger("drizzle_kit", files.length);
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

async function checkRawReplay() {
  createDatabase("raw_replay", "upgrade");
  const before = await databaseState("raw_replay");
  await timed("Ordered SQL replay " + String(files.length - baselineCount) + " files", () =>
    withClient("raw_replay", async (client) => {
      await client.query("BEGIN");
      for (let i = baselineCount; i < files.length; i++) {
        try {
          for (const statement of files[i].sql) {
            if (statement.trim()) await client.query(statement);
          }
        } catch (error) {
          throw new Error("SQL replay failed at " + journal.entries[i].tag, { cause: error });
        }
      }
      await client.query("COMMIT");
    })
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
    baselineCount > 0 && baselineCount < files.length,
    "The migration baseline must be in the journal"
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
  await verifyLedger("clean", files.length);
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
    bank_accounts: 4,
    bank_transactions: 16,
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
  await verifyLedger("upgrade", baselineCount);
  verifyState(await databaseState("upgrade"), seedState, "Backup restore");
  console.log("Backup restore verified");
  await timePendingFiles(businessData);

  await verifyRollback();
  await restore("upgrade");
  await verifyLedger("upgrade", baselineCount);
  verifyState(await databaseState("upgrade"), seedState, "Rollback restore");
  console.log("Rollback restore verified");

  await timed("Seeded release migration", () => applyRelease("upgrade"));
  await verifyLedger("upgrade", files.length);
  assert.equal(
    fixture("upgrade", "snapshot.sql"),
    businessData,
    "Upgrade changed preserved business data"
  );
  fixture("upgrade", "assert-upgraded.sql");
  console.log("Seeded preservation and backfills verified");
  assert.ok(schema("upgrade") === schema("clean"), "Clean and upgraded release schemas differ");
  console.log("Clean and upgraded release schemas match");
  await checkTrackedReplay("upgrade");
  await checkRawReplay();
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
