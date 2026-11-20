import { describe, expect, it, vi } from "vitest";
import {
  buildGroundedContext,
  renderFiguresBlock,
  verifyCitations,
  INSUFFICIENT_DATA_ANSWER,
  type GroundingDeps,
} from "../../server/services/ai/grounding";

type Row = Record<string, any>;
const line = (amount: number) => ({
  accountId: "a",
  accountCode: "0000",
  accountName: "x",
  amount,
});
const sec = (amounts: number[] = []) => ({
  total: amounts.reduce((s, a) => s + a, 0),
  lines: amounts.map(line),
});

function fakeDeps(opts: {
  pl?: { income: number; expenses: number } | null;
  bs?: { assets: number; liabilities: number } | null;
  ar?: { total: number; docs: number };
  receipts?: Row;
  fiscalYearStart?: string;
}): GroundingDeps & { queries: string[]; calls: Record<string, any[]> } {
  const queries: string[] = [];
  const calls: Record<string, any[]> = { pl: [], bs: [], ar: [] };
  return {
    queries,
    calls,
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (/FROM companies/.test(sql)) return { rows: [{ name: "Acme LLC" }] };
      if (/FROM receipts/.test(sql))
        return { rows: [opts.receipts ?? { n: 0, posted: 0, unposted_value: 0 }] };
      return { rows: [] };
    }),
    profitAndLoss: vi.fn(async (args: any) => {
      calls.pl.push(args);
      const p = opts.pl;
      return {
        totalIncome: p?.income ?? 0,
        totalExpenses: p?.expenses ?? 0,
        netProfit: (p?.income ?? 0) - (p?.expenses ?? 0),
        sections: {
          revenue: sec(p ? [p.income] : []),
          costOfSales: sec(),
          operatingExpenses: sec(p ? [p.expenses] : []),
          otherIncome: sec(),
          otherExpenses: sec(),
        },
      } as any;
    }),
    balanceSheet: vi.fn(async (args: any) => {
      calls.bs.push(args);
      const b = opts.bs;
      return {
        asOf: args.asOf,
        fiscalYearStart: opts.fiscalYearStart ?? "2026-01-01",
        assets: { current: sec(b ? [b.assets] : []), nonCurrent: sec(), total: b?.assets ?? 0 },
        liabilities: {
          current: sec(b ? [b.liabilities] : []),
          nonCurrent: sec(),
          total: b?.liabilities ?? 0,
        },
        totalAssets: b?.assets ?? 0,
        totalLiabilities: b?.liabilities ?? 0,
      } as any;
    }),
    agedReceivables: vi.fn(async (args: any) => {
      calls.ar.push(args);
      const docs = Array.from({ length: opts.ar?.docs ?? 0 }, (_, i) => ({ documentId: `d${i}` }));
      return { documents: docs, totals: { total: opts.ar?.total ?? 0 } } as any;
    }),
  };
}

const ASOF = new Date("2026-11-15T10:00:00Z");

describe("R05-09 / R05-26 / S3-06 grounding", () => {
  it("[S3-06] ledger figures come from the reporting kernel P&L, balance sheet and aging", async () => {
    const deps = fakeDeps({
      pl: { income: 125000, expenses: 80000 },
      bs: { assets: 250000, liabilities: 40000 },
      ar: { total: 4200, docs: 3 },
      receipts: { n: 10, posted: 7, unposted_value: 315 },
    });
    const g = await buildGroundedContext("co-1", { asOf: ASOF, deps });
    const byLabel = Object.fromEntries(g.figures.map((f) => [f.label, f.value]));
    expect(byLabel["Revenue (fiscal year to date)"]).toBe(125000);
    expect(byLabel["Expenses (fiscal year to date)"]).toBe(80000);
    expect(byLabel["Net profit (fiscal year to date)"]).toBe(45000);
    expect(byLabel["Total assets"]).toBe(250000);
    expect(byLabel["Total liabilities"]).toBe(40000);
    expect(byLabel["Open receivables (AED)"]).toBe(4200);
    expect(byLabel["Open invoices count"]).toBe(3);
    expect(g.insufficientData).toBe(false);
    expect(g.period).toEqual({ start: "2026-01-01", end: "2026-11-15" });
    expect(deps.calls.pl[0]).toEqual({ companyId: "co-1", from: "2026-01-01", to: "2026-11-15" });
    expect(deps.calls.bs[0]).toEqual({ companyId: "co-1", asOf: "2026-11-15" });
    // ids are stable and sequential for citations
    expect(g.figures.map((f) => f.id)).toEqual(g.figures.map((_, i) => `F${i + 1}`));
  });

  it("[S3-06] the period follows the company fiscal year and no SQL sums journal lines", async () => {
    const deps = fakeDeps({ pl: { income: 10, expenses: 0 }, fiscalYearStart: "2026-04-01" });
    const g = await buildGroundedContext("co-1", { asOf: ASOF, deps });
    expect(g.period.start).toBe("2026-04-01");
    expect(deps.calls.pl[0].from).toBe("2026-04-01");
    for (const q of deps.queries) expect(q).not.toMatch(/journal_lines|journal_entries/);
  });

  it("[S3-06] a UAE-evening instant is grounded on the UAE calendar date", async () => {
    const deps = fakeDeps({});
    const g = await buildGroundedContext("co-1", {
      asOf: new Date("2026-12-31T21:30:00Z"), // 01:30 on 1 Jan 2027 in Dubai
      deps,
    });
    expect(g.period.end).toBe("2027-01-01");
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
      deps: fakeDeps({ pl: { income: 100, expenses: 0 } }),
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
