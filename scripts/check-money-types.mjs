#!/usr/bin/env node
// Fails if any money-like column is stored as a float type.
//
// Postgres `real`/`double precision` are IEEE-754 binary floats: they cannot
// represent decimal money exactly (AED 9,999,999.99 becomes 10,000,000). Every
// amount, VAT box, balance and rate must be `numeric`. This guard is static —
// it scans the migration SQL for the *resulting* column types so it runs in CI
// without a database.
//
// Usage: node scripts/check-money-types.mjs
// Exit 0 = clean, exit 1 = a money column is float.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "migrations");

// Column-name fragments that denote money / rates. Deliberately broad.
const MONEY = /(amount|total|balance|debit|credit|vat|subtotal|paid|price|salary|net_tax|output_tax|input_tax|due_tax|recoverable_tax|payable_tax|base_currency)/i;
// Quantities and confidences are legitimately non-money; exclude them.
const NOT_MONEY = /(quantity|confidence|rate_limit|conversion_rate|error_rate|change_percent)/i;

// Track the latest declared type of every table.column across all migrations,
// in journal order, so a later ALTER ... TYPE numeric supersedes an earlier real.
const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
const orderedTags = journal.entries.map((e) => e.tag);

const colType = new Map(); // "table.col" -> type

function record(table, col, type) {
  if (!table || !col) return;
  colType.set(`${table.toLowerCase()}.${col.toLowerCase()}`, type.toLowerCase());
}

for (const tag of orderedTags) {
  let sql;
  try { sql = readFileSync(join(migrationsDir, `${tag}.sql`), "utf8"); } catch { continue; }

  // Split into statements so a multi-column ALTER TABLE is handled as a unit.
  for (const raw of sql.split(";")) {
    const stmt = raw.replace(/--.*$/gm, "").trim();
    if (!stmt) continue;

    // CREATE TABLE "t" ( "c" type, ... )
    const create = stmt.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s*\(([\s\S]*)\)/i);
    if (create) {
      const table = create[1];
      for (const line of create[2].split(",")) {
        const c = line.trim().match(/^"?(\w+)"?\s+(real|double precision|numeric|integer|bigint|text|uuid|boolean|timestamp|date|jsonb)/i);
        if (c) record(table, c[1], c[2]);
      }
      continue;
    }

    // ALTER TABLE t <one or more clauses> — capture every ALTER/ADD COLUMN in it.
    const alter = stmt.match(/alter\s+table\s+"?(\w+)"?\s([\s\S]*)/i);
    if (alter) {
      const table = alter[1];
      const body = alter[2];
      // ALTER COLUMN c ... TYPE type   (each occurrence)
      for (const m of body.matchAll(/alter\s+column\s+"?(\w+)"?[\s\S]*?(?:set\s+data\s+)?type\s+(real|double precision|numeric[^\s,;()]*(?:\([^)]*\))?|integer|bigint)/gi)) {
        record(table, m[1], m[2]);
      }
      // ADD COLUMN [IF NOT EXISTS] c type   (each occurrence)
      for (const m of body.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+(real|double precision|numeric[^\s,;()]*(?:\([^)]*\))?|integer|bigint)/gi)) {
        record(table, m[1], m[2]);
      }
    }
  }
}

const offenders = [];
for (const [key, type] of colType) {
  const col = key.split(".")[1];
  if ((type === "real" || type === "double precision") && MONEY.test(col) && !NOT_MONEY.test(col)) {
    offenders.push(`${key}  ->  ${type}`);
  }
}

if (offenders.length) {
  console.error(`✗ ${offenders.length} money column(s) stored as float (must be numeric):\n  ` + offenders.join("\n  "));
  process.exit(1);
}
console.log("✓ money-types: no float money columns");
