#!/usr/bin/env node
/* global process, console */
// Rehearsal helper: apply the pending migrations ONE FILE PER TRANSACTION, timing each file
// and recording the rows it inserted / updated / deleted per table (pg_stat_xact_user_tables,
// read inside the file's own transaction just before COMMIT). Records the same ledger row
// drizzle's migrator would (hash, created_at), so the result is a normally migrated database.
//
// `npm run db:migrate` applies every pending file in ONE transaction and only prints a total;
// use this on a CLONE of the rehearsal snapshot for the per-file table, and the real command
// on the snapshot itself for the end-to-end timing (see rehearse.sh).
//
// Usage: DATABASE_URL=... node docs/release/rehearsal/time-migrations.mjs [--json out.json]
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const outIdx = process.argv.indexOf("--json");
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;
const migrationsFolder = path.resolve(process.cwd(), "migrations");
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")
);
const files = readMigrationFiles({ migrationsFolder });

const client = new pg.Client({ connectionString: url });
client.on("notice", (n) => notices.push(n.message));
let notices = [];
await client.connect();
await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
await client.query(
  `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`
);
const last = await client.query(
  `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`
);
const lastMillis = last.rows[0] ? Number(last.rows[0].created_at) : -1;

const results = [];
let failed = false;
for (let i = 0; i < files.length; i++) {
  const m = files[i];
  if (m.folderMillis <= lastMillis) continue;
  const tag = journal.entries[i].tag;
  // Flush the backend's pending table stats so pg_stat_xact_user_tables inside the next
  // transaction counts only this file's rows (PG15+ keeps unflushed counts across commits).
  await client.query("SELECT pg_stat_force_next_flush()");
  await client.query("SELECT 1");
  notices = [];
  const t0 = process.hrtime.bigint();
  try {
    await client.query("BEGIN");
    for (const stmt of m.sql) {
      if (stmt.trim()) await client.query(stmt);
    }
    const stats = await client.query(
      `SELECT relname, n_tup_ins::int AS ins, n_tup_upd::int AS upd, n_tup_del::int AS del
         FROM pg_stat_xact_user_tables
        WHERE schemaname = 'public' AND (n_tup_ins + n_tup_upd + n_tup_del) > 0
        ORDER BY (n_tup_ins + n_tup_upd + n_tup_del) DESC`
    );
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      [m.hash, m.folderMillis]
    );
    await client.query("COMMIT");
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    results.push({ tag, ms: Math.round(ms), rows: stats.rows, notices: [...notices] });
    console.log(
      `${tag.padEnd(40)} ${ms.toFixed(0).padStart(7)} ms  ${stats.rows.length} table(s) touched`
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    results.push({
      tag,
      ms: Math.round(ms),
      error: String(err?.message ?? err),
      notices: [...notices],
    });
    console.error(`${tag} FAILED after ${ms.toFixed(0)} ms: ${err?.message ?? err}`);
    failed = true;
    break;
  }
}
await client.end();
const total = results.reduce((s, r) => s + r.ms, 0);
console.log(`applied ${results.filter((r) => !r.error).length} file(s), total ${total} ms`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ total, results }, null, 2));
process.exit(failed ? 1 : 0);
