import { describe, expect, it, vi } from "vitest";
import {
  buildGroundedContext,
  renderFiguresBlock,
  verifyCitations,
  INSUFFICIENT_DATA_ANSWER,
  type GroundingDeps,
} from "../../server/services/ai/grounding";

type Row = Record<string, any>;

function fakeDeps(opts: {
  pnl?: Row[];
  balances?: Row[];
  invoices?: Row;
  receipts?: Row;
}): GroundingDeps & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (/FROM companies/.test(sql)) return { rows: [{ name: "Acme LLC" }] };
      if (/e\.date >= \$2/.test(sql)) return { rows: opts.pnl ?? [] };
      if (/e\.date < \$2/.test(sql)) return { rows: opts.balances ?? [] };
      if (/FROM invoices/.test(sql)) return { rows: [opts.invoices ?? { n: 0, total: 0 }] };
      if (/FROM receipts/.test(sql))
        return { rows: [opts.receipts ?? { n: 0, posted: 0, unposted_value: 0 }] };
      return { rows: [] };
    }),
  };
}

const ASOF = new Date("2026-11-15T10:00:00Z");

describe("R05-09 / R05-26 grounding", () => {
  it("R05-09 computes revenue/expenses/profit from posted-ledger aggregates", async () => {
    const deps = fakeDeps({
      pnl: [
        { type: "income", debit: 500, credit: 125500, entries: 12 },
        { type: "expense", debit: 80200, credit: 200, entries: 20 },
      ],
      balances: [
        { type: "asset", debit: 300000, credit: 50000 },
        { type: "liability", debit: 1000, credit: 41000 },
      ],
      invoices: { n: 3, total: 4200 },
      receipts: { n: 10, posted: 7, unposted_value: 315 },
    });
    const g = await buildGroundedContext("co-1", { asOf: ASOF, deps });
    const byLabel = Object.fromEntries(g.figures.map((f) => [f.label, f.value]));
    expect(byLabel["Revenue (year to date)"]).toBe(125000);
    expect(byLabel["Expenses (year to date)"]).toBe(80000);
    expect(byLabel["Net profit (year to date)"]).toBe(45000);
    expect(byLabel["Total assets"]).toBe(250000);
    expect(byLabel["Total liabilities"]).toBe(40000);
    expect(byLabel["Open invoices count"]).toBe(3);
    expect(g.insufficientData).toBe(false);
    expect(g.period).toEqual({ start: "2026-01-01", end: "2026-11-15" });
    // ids are stable and sequential for citations
    expect(g.figures.map((f) => f.id)).toEqual(g.figures.map((_, i) => `F${i + 1}`));
  });

  it("R05-26 uses a fixed number of set-based queries (no per-row loading)", async () => {
    const deps = fakeDeps({
      pnl: [{ type: "income", debit: 0, credit: 10, entries: 1 }],
    });
    await buildGroundedContext("co-1", { asOf: ASOF, deps });
    expect(deps.queries).toHaveLength(5);
    for (const q of deps.queries.filter((s) => /journal_lines/.test(s))) {
      expect(q).toMatch(/SUM\(/);
      expect(q).toMatch(/GROUP BY/);
      expect(q).toMatch(/e\.status = 'posted'/); // posted entries only
    }
  });

  it("R05-25 reports insufficient data when there is no posted activity", async () => {
    const g = await buildGroundedContext("co-1", { asOf: ASOF, deps: fakeDeps({}) });
    expect(g.insufficientData).toBe(true);
    expect(g.missing.join(" ")).toMatch(/No posted journal entries/);
    expect(INSUFFICIENT_DATA_ANSWER).toMatch(/insufficient data/i);
    expect(renderFiguresBlock(g)).toMatch(/MISSING/);
  });

  it("R05-25 verifies citations against the figure set", async () => {
    const g = await buildGroundedContext("co-1", {
      asOf: ASOF,
      deps: fakeDeps({ pnl: [{ type: "income", debit: 0, credit: 100, entries: 1 }] }),
    });
    expect(verifyCitations("Revenue is AED 100 [F1].", g)).toMatchObject({
      grounded: true,
      unknown: [],
    });
    expect(verifyCitations("Revenue is AED 100 [F1] and [F99].", g).unknown).toEqual(["F99"]);
    expect(verifyCitations("Revenue is AED 100.", g).grounded).toBe(false); // uncited numbers
    expect(verifyCitations("Insufficient data to answer.", g).grounded).toBe(true);
  });
});
