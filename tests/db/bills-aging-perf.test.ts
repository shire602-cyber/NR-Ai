/**
 * O03 — Bills aging p95 performance probe.
 *
 * Seeds a fixed dataset (50 vendor bills spanning four aging buckets) and
 * measures the wall-clock time of GET /api/companies/:cid/bills/aging over
 * 20 consecutive requests. Records p50 and p95; asserts against a budget that
 * accounts for PGlite single-connection overhead.
 *
 * Postgres budget (baseline from scripts/qa/perf-baseline.json): 67 ms p95.
 * PGlite budget: 800 ms p95 (single-connection in-process; not an SLA, only
 * a regression signal for gross regressions in the aging SQL).
 *
 * Dataset: 50 bills, as_of = 2026-11-01.
 *   current   (not yet due):  10 bills × AED 500   = AED 5,000
 *   days_1_30 (1-30 days):    15 bills × AED 1,000 = AED 15,000
 *   days_31_60 (31-60 days):  15 bills × AED 1,500 = AED 22,500
 *   days_90_plus (>90 days):  10 bills × AED 2,000 = AED 20,000
 *
 * This is smaller than the production baseline (300 invoices with concurrency);
 * its purpose is a no-regression signal on the SQL path, not a load test.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const AS_OF = "2026-11-01";

function billDate(daysBeforeAsOf: number): string {
  const d = new Date("2026-11-01");
  d.setDate(d.getDate() - daysBeforeAsOf);
  return d.toISOString().slice(0, 10);
}

function dueDate(daysBeforeAsOf: number): string {
  return billDate(daysBeforeAsOf);
}

function p95(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

function p50(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe("O03 bills-aging p95 performance probe", () => {
  it("returns aging buckets for a 50-bill dataset within the latency budget", async () => {
    const t = await h.createTenant();
    const base = `/api/companies/${t.company.id}`;

    // ── Seed 50 bills ───────────────────────────────────────────────────────
    const seeds: Array<{ due: string; amount: number; desc: string }> = [];

    // current (due in 10 days → not yet overdue on 2026-11-01)
    for (let i = 0; i < 10; i++) {
      seeds.push({ due: "2026-11-11", amount: 500, desc: "current" });
    }
    // days_1_30 (due 1–30 days ago)
    for (let i = 1; i <= 15; i++) {
      seeds.push({ due: dueDate(i), amount: 1000, desc: "d30" });
    }
    // days_31_60 (due 31–60 days ago)
    for (let i = 31; i <= 45; i++) {
      seeds.push({ due: dueDate(i), amount: 1500, desc: "d60" });
    }
    // days_90_plus (due >90 days ago)
    for (let i = 91; i <= 100; i++) {
      seeds.push({ due: dueDate(i), amount: 2000, desc: "d90plus" });
    }

    let seeded = 0;
    for (const s of seeds) {
      const r = await t.as.post(`${base}/bills`, {
        vendor_name: "Perf Vendor",
        bill_number: `PF-${String(seeded).padStart(4, "0")}`,
        bill_date: billDate(5),
        due_date: s.due,
        currency: "AED",
        line_items: [{ description: s.desc, quantity: 1, unit_price: s.amount, vat_rate: 0 }],
      });
      if (r.status !== 200) {
        throw new Error(`Bill seed failed (${r.status}): ${r.text}`);
      }
      // Aging reads posted journal lines, so a draft bill would not appear in any bucket.
      const ap = await t.as.post(`/api/bills/${r.body.id}/approve`, {});
      if (ap.status !== 200) {
        throw new Error(`Bill approve failed (${ap.status}): ${ap.text}`);
      }
      seeded++;
    }
    expect(seeded).toBe(50);

    // ── Warm-up: 2 requests (not counted in timing) ─────────────────────────
    for (let i = 0; i < 2; i++) {
      const r = await t.as.get(`${base}/bills/aging?as_of=${AS_OF}`);
      expect(r.status, r.text).toBe(200);
    }

    // ── Measured run: 20 requests ───────────────────────────────────────────
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = Date.now();
      const r = await t.as.get(`${base}/bills/aging?as_of=${AS_OF}`);
      const elapsed = Date.now() - start;
      expect(r.status, `run ${i}: ${r.text}`).toBe(200);
      // Spot-check the response shape on the first run.
      if (i === 0) {
        expect(r.body).toHaveProperty("current");
        expect(r.body).toHaveProperty("days_1_30");
        expect(r.body).toHaveProperty("days_31_60");
        expect(r.body).toHaveProperty("days_90_plus");
        // Some overdue bills should exist (days_1_30 + days_31_60 + days_90_plus)
        expect(
          r.body.days_1_30.count + r.body.days_31_60.count + r.body.days_90_plus.count
        ).toBeGreaterThan(0);
      }
      times.push(elapsed);
    }

    const measured_p50 = p50(times);
    const measured_p95 = p95(times);
    const mode = process.env.HARNESS_MODE ?? "unknown";
    const budget = mode === "postgres" ? 101 : 800;

    console.info(
      `[O03] bills/aging 50-bill dataset (${mode}) — ` +
        `p50=${measured_p50}ms p95=${measured_p95}ms budget=${budget}ms`
    );

    expect(
      measured_p95,
      `bills/aging p95 exceeded ${budget}ms budget on ${mode} ` +
        `(p50=${measured_p50}ms p95=${measured_p95}ms). ` +
        `Dataset: 50 bills, as_of=${AS_OF}. ` +
        `Postgres baseline: 67ms p95 (scripts/qa/perf-baseline.json).`
    ).toBeLessThanOrEqual(budget);
  }, // Timeout: 50 bills × ~100ms/request × 22 requests + setup
  120_000);
});
