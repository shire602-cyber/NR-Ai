#!/usr/bin/env node
/*
 * Seeds a throwaway company with load-test volume straight into a LOCAL database:
 * 10,000 invoices and 50,000 journal lines by default. The report-stress fixture
 * goes through the public API with a write throttle, which would take hours at
 * this size; direct SQL takes seconds and the API reads are what get measured.
 *
 *   BASE_URL=http://localhost:5079 DATABASE_URL=postgresql://...localhost... node scripts/load/seed-load-data.mjs
 *
 * Refuses to run against a database that is not on localhost. Prints one JSON line
 * with the credentials and ids that run-load.mjs needs (and writes it to
 * scripts/load/.last-seed.json, which is git-ignored output).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
const DB_URL = process.env.DATABASE_URL || "";
const INVOICES = Number(process.env.LOAD_INVOICES || 10_000);
const JOURNAL_ENTRIES = Number(process.env.LOAD_JOURNAL_ENTRIES || 25_000); // two lines each
if (!BASE || !DB_URL) {
  console.error("BASE_URL and DATABASE_URL are required");
  process.exit(1);
}
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL)) {
  console.error("Refusing to seed a database that is not on localhost");
  process.exit(1);
}

const stamp = Math.random().toString(36).slice(2, 8);
const email = `load_${stamp}@example.com`;
const password = "Password123!";

const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Load Test", email, password }),
});
const registered = await reg.json();
if (!registered.token) throw new Error("register failed: " + JSON.stringify(registered));
const companyId = registered.company.id;
const userId = registered.user.id;

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const t0 = Date.now();
try {
  const accounts = (await db.query(`SELECT id, code FROM accounts WHERE company_id = $1`, [companyId])).rows;
  const byCode = (c) => accounts.find((a) => a.code === c)?.id;
  const cash = byCode("1010");
  const revenue = byCode("4010");
  if (!cash || !revenue) throw new Error("default accounts missing");

  await db.query(
    `INSERT INTO invoices (company_id, number, customer_name, date, due_date, subtotal, vat_amount, total, base_currency_amount, status, created_at)
     SELECT $1, 'LOAD-' || g, 'Customer ' || (g % 250), (current_date - (g % 700))::timestamp, (current_date - (g % 700) + 30)::timestamp,
            100 + (g % 900), (100 + (g % 900)) * 0.05, (100 + (g % 900)) * 1.05, (100 + (g % 900)) * 1.05,
            CASE WHEN g % 5 = 0 THEN 'paid' WHEN g % 7 = 0 THEN 'draft' ELSE 'sent' END,
            now() - (g || ' minutes')::interval
       FROM generate_series(1, $2) g`,
    [companyId, INVOICES]
  );
  await db.query(
    `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, vat_rate)
     SELECT id, 'Load line', 1, subtotal, 0.05 FROM invoices WHERE company_id = $1 AND number LIKE 'LOAD-%'`,
    [companyId]
  );
  await db.query(
    `INSERT INTO journal_entries (company_id, entry_number, date, memo, status, source, created_by, created_at)
     SELECT $1, 'LOAD-JE-' || g, (current_date - (g % 700))::timestamp, 'Load entry', 'posted', 'manual', $2, now() - (g || ' minutes')::interval
       FROM generate_series(1, $3) g`,
    [companyId, userId, JOURNAL_ENTRIES]
  );
  await db.query(
    `WITH e AS (SELECT id, (abs(hashtext(id::text)) % 500000) / 100.0 + 1 AS amt FROM journal_entries WHERE company_id = $1 AND entry_number LIKE 'LOAD-JE-%')
     INSERT INTO journal_lines (entry_id, account_id, debit, credit, description)
     SELECT e.id, $2::uuid, e.amt, 0, 'Load debit' FROM e
     UNION ALL SELECT e.id, $3::uuid, 0, e.amt, 'Load credit' FROM e`,
    [companyId, cash, revenue]
  );
  await db.query(`ANALYZE invoices; ANALYZE journal_lines; ANALYZE journal_entries;`);
  const counts = {
    invoices: (await db.query(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [companyId])).rows[0].n,
    journalLines: (await db.query(`SELECT count(*)::int AS n FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.company_id = $1`, [companyId])).rows[0].n,
  };
  const out = { baseUrl: BASE, email, password, companyId, userId, counts, seededInMs: Date.now() - t0 };
  fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), ".last-seed.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
} finally {
  await db.end();
}
