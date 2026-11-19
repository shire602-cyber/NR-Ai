#!/usr/bin/env node
// Perf budget (R20-15): p95 latency for the 7 endpoints load-tested in audit
// report 20 §4, with 300 invoices seeded for one tenant. Fails when any
// endpoint's p95 is more than PERF_BUDGET_TOLERANCE (default 50%) above the
// committed baseline in scripts/qa/perf-baseline.json.
//
// Usage (against a running server with raised rate limits, e.g. the CI job):
//   RL_API_MAX=100000 RL_READ_MAX=100000 RL_AUTH_MAX=1000 npm start &
//   BASE_URL=http://127.0.0.1:5000 node scripts/perf-budget.mjs [--update]
//
// Env: PERF_INVOICES (300), PERF_REQUESTS (200 per endpoint),
// PERF_CONCURRENCY (20), PERF_BUDGET_TOLERANCE (0.5), PERF_BUDGET_SCALE (1)
// multiplies every baseline for slower runners. --update rewrites the baseline
// with this run's p95s (commit the result deliberately).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts/qa/perf-baseline.json");
const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const num = (k, d) =>
  Number.isFinite(Number(process.env[k])) && process.env[k] ? Number(process.env[k]) : d;
const INVOICES = num("PERF_INVOICES", 300);
const REQUESTS = num("PERF_REQUESTS", 200);
const CONCURRENCY = num("PERF_CONCURRENCY", 20);
const TOLERANCE = num("PERF_BUDGET_TOLERANCE", 0.5);
const SCALE = num("PERF_BUDGET_SCALE", 1);
const update = process.argv.includes("--update");

export const ENDPOINTS = [
  "/api/companies/:cid/invoices",
  "/api/companies/:cid/dashboard/stats",
  "/api/companies/:cid/dashboard/monthly-trends",
  "/api/companies/:cid/reports/balance-sheet",
  "/api/companies/:cid/reports/trial-balance",
  "/api/companies/:cid/accounts",
  "/api/companies/:cid/bills/aging",
];

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

async function pool(n, concurrency, fn) {
  let next = 0;
  const out = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < n) {
        const i = next++;
        out[i] = await fn(i);
      }
    })
  );
  return out;
}

async function main() {
  const email = `perf_${Date.now().toString(36)}@perf.test`;
  const reg = await api("POST", "/api/auth/register", {
    body: { name: "Perf", email, password: "PerfBudget-Test-Password-123!" },
  });
  // W5-E: registration returns no session (R17-14); sign in, then read the company.
  const login =
    reg.status === 200
      ? await api("POST", "/api/auth/login", {
          body: { email, password: "PerfBudget-Test-Password-123!" },
        })
      : reg;
  if (login.status !== 200 || !login.json?.token) {
    console.error(`perf-budget: registration failed (${login.status}) ${login.text.slice(0, 200)}`);
    process.exit(1);
  }
  const token = login.json.token;
  const cid = (await api("GET", "/api/companies", { token })).json[0].id;
  const today = new Date().toISOString().slice(0, 10);

  const seeded = await pool(INVOICES, 10, (i) =>
    api("POST", `/api/companies/${cid}/invoices`, {
      token,
      body: {
        customerName: `Perf Customer ${i % 25}`,
        date: today,
        lines: [{ description: "Service", quantity: 1, unitPrice: 100 + i, vatRate: 5 }],
      },
    })
  );
  const bad = seeded.filter((r) => r.status !== 200);
  if (bad.length) {
    console.error(
      `perf-budget: ${bad.length}/${INVOICES} invoice seeds failed (first: ${bad[0].status} ${bad[0].text.slice(0, 160)}). ` +
        "Raise RL_API_MAX on the server."
    );
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const results = {};
  let failed = 0;
  for (const ep of ENDPOINTS) {
    const path = ep.replace(":cid", cid);
    const timings = await pool(REQUESTS, CONCURRENCY, async () => {
      const t0 = performance.now();
      const r = await api("GET", path, { token });
      const ms = performance.now() - t0;
      if (r.status >= 400) throw new Error(`${ep} -> ${r.status} ${r.text.slice(0, 160)}`);
      return ms;
    });
    const value = Math.round(p95(timings));
    results[ep] = value;
    const budget = Math.round((baseline.p95Ms[ep] ?? Infinity) * SCALE * (1 + TOLERANCE));
    const ok = value <= budget;
    if (!ok) failed++;
    console.log(
      `${ok ? "ok  " : "FAIL"} p95 ${String(value).padStart(5)} ms  budget ${budget} ms  ${ep}`
    );
  }

  if (update) {
    writeFileSync(
      baselinePath,
      JSON.stringify(
        { ...baseline, p95Ms: results, updatedAt: new Date().toISOString() },
        null,
        2
      ) + "\n"
    );
    console.log(`perf-budget: baseline updated -> ${baselinePath}`);
    return;
  }
  if (failed) {
    console.error(
      `perf-budget: ${failed} endpoint(s) regressed more than ${TOLERANCE * 100}% over baseline`
    );
    process.exit(1);
  }
  console.log(
    `perf-budget: all ${ENDPOINTS.length} endpoints within budget (${INVOICES} invoices)`
  );
}

main().catch((err) => {
  console.error("perf-budget crashed:", err?.message ?? err);
  process.exit(1);
});
