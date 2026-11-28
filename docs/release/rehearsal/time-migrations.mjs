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
// The driver provides the verified cluster ID and clone's database name.
// --list-candidates only reads the migration files and needs no database.
import fs from "node:fs";
import path from "node:path";
import { connectScratchTarget } from "./scratch-target.mjs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const migrationsFolder = path.resolve(process.cwd(), "migrations");
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")
);
const files = readMigrationFiles({ migrationsFolder });

if (process.argv.includes("--list-candidates")) {
  const baseline = journal.entries.findIndex(({ tag }) => tag === "0088_emirate_no_default");
  if (baseline < 0 || baseline === files.length - 1) {
    throw new Error("Expected the pre-release baseline followed by candidate migrations");
  }
  console.log(
    journal.entries
      .slice(baseline + 1)
      .map(({ tag }) => `migrations/${tag}.sql`)
      .join("\n")
  );
} else {
  await timePendingMigrations();
}

async function timePendingMigrations() {
  const outIdx = process.argv.indexOf("--json");
  const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;
  if (outIdx > 0 && !outFile) throw new Error("--json requires an output path");

  const client = await connectScratchTarget();
  try {
    let notices = [];
    client.on("notice", (n) => notices.push(n.message));
    const last = await client.query(
      `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`
    );
    const lastMillis = Number(last.rows[0]?.created_at);
    if (
      !files.some((file) => file.folderMillis === lastMillis) ||
      !files.some((file) => file.folderMillis > lastMillis)
    ) {
      throw new Error("Expected a snapshot with a known migration baseline and pending migrations");
    }

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
    const total = results.reduce((s, r) => s + r.ms, 0);
    console.log(`applied ${results.filter((r) => !r.error).length} file(s), total ${total} ms`);
    if (outFile) fs.writeFileSync(outFile, JSON.stringify({ total, results }, null, 2));
    process.exitCode = failed ? 1 : 0;
  } finally {
    await client.end();
  }
}
