#!/usr/bin/env node
/*
 * Read-path load test: p50 / p95 / p99 per endpoint under a fixed concurrency, against
 * the data seed-load-data.mjs created. Budget: p95 < 500 ms at 10k invoices / 50k journal lines.
 *
 *   BASE_URL=http://localhost:5079 node scripts/load/run-load.mjs [--seed scripts/load/.last-seed.json]
 *     LOAD_CONCURRENCY=8  LOAD_REQUESTS=60  LOAD_BUDGET_P95_MS=500
 *
 * Exits 1 if any endpoint is over budget. Needs the server started with RL_* limits raised
 * (start-p8.sh does this), because the per-user rate limiter would otherwise answer 429.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = process.argv.includes("--seed") ? process.argv[process.argv.indexOf("--seed") + 1] : path.join(here, ".last-seed.json");
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const BASE = (process.env.BASE_URL || seed.baseUrl).replace(/\/$/, "");
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 8);
const REQUESTS = Number(process.env.LOAD_REQUESTS || 60);
const BUDGET = Number(process.env.LOAD_BUDGET_P95_MS || 500);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: seed.email, password: seed.password }),
});
const { token } = await login.json();
if (!token) throw new Error("login failed");
const auth = { Authorization: `Bearer ${token}` };

// A v1 key for the cursor endpoints.
const keyRes = await fetch(`${BASE}/api/companies/${seed.companyId}/api-keys`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...auth },
  body: JSON.stringify({ name: "load", scopes: ["read:invoices", "read:journals", "read:reports"], ratePerMinute: 600, ratePerDay: 200000 }),
});
const apiKey = (await keyRes.json()).key;

const c = seed.companyId;
const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);
const endpoints = [
  { name: "GET accounts-with-balances", path: `/api/companies/${c}/accounts-with-balances`, headers: auth },
  { name: "GET invoices (internal list)", path: `/api/companies/${c}/invoices?limit=100`, headers: auth },
  { name: "GET dashboard stats", path: `/api/companies/${c}/dashboard/stats`, headers: auth },
  { name: "GET dashboard expense breakdown", path: `/api/companies/${c}/dashboard/expense-breakdown`, headers: auth },
  { name: "GET dashboard monthly trends", path: `/api/companies/${c}/dashboard/monthly-trends`, headers: auth },
  { name: "GET trial balance", path: `/api/companies/${c}/reports/trial-balance`, headers: auth },
  { name: "GET profit & loss", path: `/api/companies/${c}/reports/pl?startDate=${year}-01-01&endDate=${today}`, headers: auth },
  { name: "GET balance sheet", path: `/api/companies/${c}/reports/balance-sheet?endDate=${today}`, headers: auth },
  { name: "GET v1 invoices (cursor, 100)", path: `/api/v1/invoices?limit=100`, headers: { Authorization: `Bearer ${apiKey}` } },
  { name: "GET v1 journals (cursor, 100)", path: `/api/v1/journals?limit=100`, headers: { Authorization: `Bearer ${apiKey}` } },
];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const limit = pLimit(CONCURRENCY);
const rows = [];
let failed = false;
for (const ep of endpoints) {
  const times = [];
  const statuses = new Map();
  await Promise.all(
    Array.from({ length: REQUESTS }, () =>
      limit(async () => {
        const t = performance.now();
        const res = await fetch(BASE + ep.path, { headers: ep.headers });
        await res.arrayBuffer();
        times.push(performance.now() - t);
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      })
    )
  );
  times.sort((a, b) => a - b);
  const ok = [...statuses.keys()].every((s) => s === 200);
  const p95 = pct(times, 95);
  const row = { endpoint: ep.name, requests: times.length, p50: +pct(times, 50).toFixed(1), p95: +p95.toFixed(1), p99: +pct(times, 99).toFixed(1), statuses: Object.fromEntries(statuses), withinBudget: ok && p95 < BUDGET };
  if (!row.withinBudget) failed = true;
  rows.push(row);
}
console.table(rows.map(({ endpoint, requests, p50, p95, p99, statuses, withinBudget }) => ({ endpoint, requests, "p50 ms": p50, "p95 ms": p95, "p99 ms": p99, statuses: JSON.stringify(statuses), ok: withinBudget })));
console.log(JSON.stringify({ budgetP95Ms: BUDGET, counts: seed.counts, concurrency: CONCURRENCY, rows }));
process.exit(failed ? 1 : 0);
