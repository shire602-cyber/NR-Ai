#!/usr/bin/env node
// Fails if any migration .sql file is not registered in meta/_journal.json.
//
// Drizzle's migrator only runs migrations listed in the journal. A .sql file
// that is missing from the journal never executes — which is exactly how
// 0015_fix_monetary_types silently never ran, leaving 56 VAT columns as floats.
// This guard makes that class of drift a red build.
//
// Usage: node scripts/check-migration-journal.mjs
// Exit 0 = every .sql is journaled, exit 1 = orphans found.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");

const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
const journaled = new Set(journal.entries.map((e) => e.tag));

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""));

const orphans = files.filter((f) => !journaled.has(f)).sort();

if (orphans.length) {
  console.error(`✗ ${orphans.length} migration file(s) not in meta/_journal.json (they will never run):\n  ` + orphans.join("\n  "));
  console.error("\n  Either journal them (after verifying they apply cleanly) or move them out of migrations/.");
  process.exit(1);
}
console.log(`✓ migration-journal: all ${files.length} migration files are journaled`);
