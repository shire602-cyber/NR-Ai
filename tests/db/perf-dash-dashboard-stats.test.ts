/**
 * PERF-DASH: GET /dashboard/stats got faster (one request-scoped read cache, the cash-flow
 * buckets classified in one pass, the P&L reads run together) with byte-identical output.
 *
 * The golden file was written by the code before the change (commit 4201f89) on the books in
 * ./perf-dash-fixtures.ts; every response here must serialise to exactly the same JSON. Ids
 * (uuids) are replaced by their order of first appearance so the file does not depend on the
 * ids a run happens to generate. Regenerate only for a deliberate output change:
 * PERF_DASH_WRITE_GOLDEN=1 npx vitest run --config tests/db/vitest.config.ts <this file>.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { freezeTime, useHarness, type Tenant } from "./harness";
import { PERF_DASH_NOW, seedPerfDashBooks } from "./perf-dash-fixtures";

const h = useHarness();
const GOLDEN = path.join(__dirname, "golden", "perf-dash-dashboard-stats.golden.json");
const WRITE = process.env.PERF_DASH_WRITE_GOLDEN === "1";
let tenants: { a: Tenant; b: Tenant };
let restore: () => void;

beforeAll(async () => {
  restore = freezeTime(PERF_DASH_NOW);
  tenants = await seedPerfDashBooks(h);
});
afterAll(() => restore());

const QUERIES = [
  "dashboard/stats",
  "dashboard/stats?preset=quarter",
  "dashboard/stats?preset=ytd",
  "dashboard/stats?preset=custom&from=2025-01-01&to=2026-11-15",
  "dashboard/stats?preset=custom&from=2026-02-10&to=2026-05-20",
  "reports/pl?from=2026-01-01&to=2026-11-15",
];
const LEGACY = [
  "cash-flow/month",
  "cash-flow/quarter?from=2025-01-01&to=2026-11-15",
  "cash-flow/month?from=2026-02-10&to=2026-11-15",
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
function normalise(body: unknown): string {
  const ids = new Map<string, string>();
  return JSON.stringify(body).replace(UUID, (id) => {
    if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
    return ids.get(id)!;
  });
}

async function responses(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, t] of Object.entries(tenants)) {
    for (const q of QUERIES) {
      const r = await t.as.get(`/api/companies/${t.company.id}/${q}`);
      expect(r.status, `${name} ${q}: ${r.text}`).toBe(200);
      out[`${name} ${q}`] = normalise(r.body);
    }
    for (const q of LEGACY) {
      const r = await t.as.get(`/api/reports/${t.company.id}/${q}`);
      expect(r.status, `${name} ${q}: ${r.text}`).toBe(200);
      out[`${name} legacy ${q}`] = normalise(r.body);
    }
  }
  return out;
}

describe("PERF-DASH dashboard stats output is unchanged", () => {
  it("every dashboard / P&L / bucketed cash-flow response is byte-identical to the golden file", async () => {
    const got = await responses();
    if (WRITE) {
      fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + "\n");
      return;
    }
    const want = JSON.parse(fs.readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k]);
    // The books exercise the cash-flow paths the bucketed classification has to agree on.
    const b = JSON.parse(want["b legacy cash-flow/month"]) as Array<Record<string, number>>;
    expect(b.some((x) => x.investingOutflow > 0)).toBe(true);
    expect(b.some((x) => x.investingInflow > 0)).toBe(true);
    expect(b.some((x) => x.financingInflow > 0)).toBe(true);
    expect(b.some((x) => x.openingBalanceCash !== 0)).toBe(true);
  });

  it("bucketed classification and opening totals equal the per-range kernel calls", async () => {
    if (WRITE) return;
    const r = {
      ...(await import("../../server/reporting")),
      ...(await import("../../server/reporting/cash-flow-classify")),
    };
    const sorted = <V>(m: Map<string, V>) =>
      Array.from(m.entries()).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    const plain = (c: Awaited<ReturnType<typeof r.classifyCashFlows>>) => ({
      operatingDirect: sorted(c.operatingDirect),
      investing: [...c.investing].sort((x, y) =>
        `${x.kind}:${x.accountId}` < `${y.kind}:${y.accountId}` ? -1 : 1
      ),
      financing: sorted(c.financing),
      nonCashAdjustments: sorted(c.nonCashAdjustments),
      workingCapital: sorted(c.workingCapital),
      fxOnCashFils: c.fxOnCashFils,
      nonCashTransactions: c.nonCashTransactions,
    });
    for (const t of [tenants.a, tenants.b]) {
      const accounts = await r.loadAccounts(t.company.id);
      for (const ranges of [
        r.buckets("2025-01-01", "2026-11-30", "month"),
        r.buckets("2025-02-10", "2026-11-15", "quarter"),
        // Not contiguous: falls back to one call per range.
        [
          { from: "2025-01-01", to: "2025-03-31" },
          { from: "2026-07-01", to: "2026-10-31" },
        ],
      ]) {
        const rs = ranges.map((b) => ({ from: b.from, to: b.to }));
        const [byBucket, openingByBucket] = await Promise.all([
          r.classifyCashFlowsByBucket(t.company.id, rs, accounts),
          r.accountTotalsByBucket(t.company.id, rs, { opening: "only" }),
        ]);
        for (let i = 0; i < rs.length; i++) {
          const one = await r.classifyCashFlows(t.company.id, rs[i], accounts);
          expect(plain(byBucket[i]), `${rs[i].from}`).toEqual(plain(one));
          const oe = await r.accountTotals(t.company.id, { ...rs[i], opening: "only" });
          expect(sorted(openingByBucket[i]), `${rs[i].from}`).toEqual(sorted(oe));
        }
      }
    }
  });

  it("one dashboard request reads the database at most 30 times (was 71)", async () => {
    if (WRITE) return;
    const { pool } = await import("../../server/db");
    const { getDashboardStats } = await import("../../server/services/dashboard-stats.service");
    for (const t of [tenants.a, tenants.b]) {
      const spy = vi.spyOn(pool, "query");
      try {
        await getDashboardStats(t.company.id, {});
        expect(spy.mock.calls.length).toBeLessThanOrEqual(30);
        // No identical query (same SQL and parameters) runs twice in one request.
        const keys = spy.mock.calls.map((c) => `${String(c[0])}|${JSON.stringify(c[1] ?? [])}`);
        expect(new Set(keys).size).toBe(keys.length);
      } finally {
        spy.mockRestore();
      }
    }
  });
});
