import { describe, it, expect } from "vitest";
import { mergeComparison, mergeTotals, withComparisonColumns } from "../../server/reports/compare";
import { csvCell, renderCsv } from "../../server/reports/render/csv";
import { nextSlot, slotKey } from "../../server/reports/schedule";
import { consolidate } from "../../server/reports/consolidation";
import { sumDetailRows } from "../../server/reports/run";
import { computeCtComputation } from "../../shared/ct-workpaper";
import type { ReportColumn, ReportResult, ReportRow } from "../../shared/report-result";
import type { AccountTotal } from "../../server/reports/ledger";

const cols: ReportColumn[] = [
  { key: "name", label: { en: "Account", ar: "الحساب" }, type: "text" },
  { key: "amount", label: { en: "Amount", ar: "المبلغ" }, type: "money", comparable: true },
];
const r = (key: string, amount: number, kind: ReportRow["kind"] = "detail"): ReportRow => ({ key, kind, cells: { name: key, amount } });

describe("comparison merge", () => {
  it("adds prior, delta and percent for comparable columns", () => {
    const rows = mergeComparison(cols, [r("a", 150)], [r("a", 100)]);
    expect(rows[0].cells).toMatchObject({ amount: 150, amount__cmp: 100, amount__delta: 50, amount__pct: 50 });
  });

  it("percent is null when the prior value is 0, and delta is current minus prior", () => {
    const rows = mergeComparison(cols, [r("a", 80)], [r("a", 0)]);
    expect(rows[0].cells.amount__pct).toBeNull();
    expect(rows[0].cells.amount__delta).toBe(80);
    const neg = mergeComparison(cols, [r("a", 40)], [r("a", -100)]);
    expect(neg[0].cells.amount__pct).toBe(140);
  });

  it("keeps a row only one side has, in its place, with 0 for the missing side", () => {
    const current = [r("section:rev", 0, "section"), r("a", 10), r("subtotal:rev", 10, "subtotal")];
    const prior = [r("section:rev", 0, "section"), r("a", 5), r("b", 7), r("subtotal:rev", 12, "subtotal")];
    const rows = mergeComparison(cols, current, prior);
    expect(rows.map((x) => x.key)).toEqual(["section:rev", "a", "b", "subtotal:rev"]);
    expect(rows[2].cells).toMatchObject({ amount: 0, amount__cmp: 7, amount__delta: -7 });
    const onlyCurrent = mergeComparison(cols, [r("a", 10), r("c", 4)], [r("a", 5)]);
    expect(onlyCurrent[1].cells).toMatchObject({ amount: 4, amount__cmp: 0, amount__delta: 4, amount__pct: null });
  });

  it("merges totals and appends the comparison columns", () => {
    expect(mergeTotals(cols, { amount: 9 }, { amount: 6 })).toMatchObject({ amount__cmp: 6, amount__delta: 3, amount__pct: 50 });
    const out = withComparisonColumns(cols).map((c) => c.key);
    expect(out).toEqual(["name", "amount", "amount__cmp", "amount__delta", "amount__pct"]);
  });

  it("totals of sum columns are exact in fils", () => {
    const rows = [r("a", 0.1), r("b", 0.2), r("c", 0.3), r("s", 99, "subtotal")];
    expect(sumDetailRows([{ key: "amount", sum: true }], rows)).toEqual({ amount: 0.6 });
  });
});

describe("CSV", () => {
  it("neutralises formula starts, quotes commas, quotes and line breaks", () => {
    expect(csvCell("=HYPERLINK(\"x\")", "text")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1", "text")).toBe("'+1");
    expect(csvCell("-1", "text")).toBe("'-1");
    expect(csvCell("@sum", "text")).toBe("'@sum");
    expect(csvCell("a,b", "text")).toBe("\"a,b\"");
    expect(csvCell("a\nb", "text")).toBe("\"a\nb\"");
    expect(csvCell(12.5, "money")).toBe("12.50");
    expect(csvCell(-3, "number")).toBe("-3");
    expect(csvCell(null, "text")).toBe("");
  });

  it("writes a BOM, the language's headers and a totals row", () => {
    const result: ReportResult = {
      reportId: "x",
      title: { en: "X", ar: "س" },
      companyId: "c",
      currency: "AED",
      params: {},
      columns: cols,
      rows: [r("Cash", 10), r("Bank", 5)],
      totals: { amount: 15 },
      generatedAt: new Date().toISOString(),
    };
    const en = renderCsv(result, "en").toString("utf8");
    expect(en.charCodeAt(0)).toBe(0xfeff);
    expect(en.split("\r\n")[0]).toBe("﻿Account,Amount");
    expect(en.split("\r\n")[3]).toBe("Total,15.00");
    expect(renderCsv(result, "ar").toString("utf8")).toContain("الحساب,المبلغ");
  });
});

describe("schedule slots", () => {
  it("daily: today at the Dubai hour if still ahead, else tomorrow", () => {
    // 2026-10-02 05:00 UTC = 09:00 Dubai
    expect(nextSlot(new Date("2026-10-02T05:00:00Z"), { cadence: "daily", hourDubai: 7 }).toISOString()).toBe("2026-10-03T03:00:00.000Z");
    expect(nextSlot(new Date("2026-10-02T02:00:00Z"), { cadence: "daily", hourDubai: 7 }).toISOString()).toBe("2026-10-02T03:00:00.000Z");
    // exactly at the slot: strictly after
    expect(nextSlot(new Date("2026-10-02T03:00:00Z"), { cadence: "daily", hourDubai: 7 }).toISOString()).toBe("2026-10-03T03:00:00.000Z");
  });

  it("daily across Dubai midnight: 21:00 UTC is already the next Dubai day", () => {
    expect(nextSlot(new Date("2026-10-01T21:00:00Z"), { cadence: "daily", hourDubai: 7 }).toISOString()).toBe("2026-10-02T03:00:00.000Z");
    expect(nextSlot(new Date("2026-10-01T21:00:00Z"), { cadence: "daily", hourDubai: 0 }).toISOString()).toBe("2026-10-02T20:00:00.000Z");
  });

  it("weekly: the next requested weekday in Dubai", () => {
    // 2026-10-02 is a Friday
    expect(nextSlot(new Date("2026-10-02T05:00:00Z"), { cadence: "weekly", dayOfWeek: 1, hourDubai: 7 }).toISOString()).toBe("2026-10-05T03:00:00.000Z");
    // same weekday, hour already passed: next week
    expect(nextSlot(new Date("2026-10-02T05:00:00Z"), { cadence: "weekly", dayOfWeek: 5, hourDubai: 7 }).toISOString()).toBe("2026-10-09T03:00:00.000Z");
    expect(nextSlot(new Date("2026-10-02T01:00:00Z"), { cadence: "weekly", dayOfWeek: 5, hourDubai: 7 }).toISOString()).toBe("2026-10-02T03:00:00.000Z");
  });

  it("monthly: the day of this month if ahead, else next month; day 28 is the cap", () => {
    expect(nextSlot(new Date("2026-10-02T05:00:00Z"), { cadence: "monthly", dayOfMonth: 5, hourDubai: 7 }).toISOString()).toBe("2026-10-05T03:00:00.000Z");
    expect(nextSlot(new Date("2026-10-10T05:00:00Z"), { cadence: "monthly", dayOfMonth: 5, hourDubai: 7 }).toISOString()).toBe("2026-11-05T03:00:00.000Z");
    expect(nextSlot(new Date("2026-12-30T05:00:00Z"), { cadence: "monthly", dayOfMonth: 28, hourDubai: 7 }).toISOString()).toBe("2027-01-28T03:00:00.000Z");
  });

  it("the slot key is the Dubai calendar hour", () => {
    expect(slotKey(new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-05T07");
    expect(slotKey(new Date("2026-10-04T20:00:00Z"))).toBe("2026-10-05T00");
  });
});

describe("consolidation", () => {
  const acct = (code: string, type: string, debit: number, credit: number, counterparty: string | null = null): AccountTotal => ({
    accountId: `${code}-${counterparty ?? "x"}`,
    code,
    nameEn: code,
    nameAr: null,
    type,
    subType: null,
    intercompanyCompanyId: counterparty,
    debit,
    credit,
  });

  it("eliminates matching intercompany balances to zero", () => {
    const out = consolidate(
      [
        { id: "A", name: "A", accounts: [acct("1090", "asset", 1000, 0, "B"), acct("1020", "asset", 500, 0)] },
        { id: "B", name: "B", accounts: [acct("2090", "liability", 0, 1000, "A")] },
      ],
      "bs"
    );
    const rec = out.rows.find((x) => x.code === "1090")!;
    const pay = out.rows.find((x) => x.code === "2090")!;
    expect(rec.consolidated).toBe(0);
    expect(pay.consolidated).toBe(0);
    expect(out.eliminationNet).toBe(0);
    expect(out.rows.find((x) => x.code === "1020")!.consolidated).toBe(500);
  });

  it("reports unmatched intercompany balances with the difference and does not eliminate them", () => {
    const out = consolidate(
      [
        { id: "A", name: "A", accounts: [acct("1090", "asset", 1000, 0, "B")] },
        { id: "B", name: "B", accounts: [acct("2090", "liability", 0, 900, "A")] },
      ],
      "bs"
    );
    expect(out.unmatched).toEqual([{ pair: "A|B", difference: 100 }]);
    expect(out.rows.find((x) => x.code === "1090")!.consolidated).toBe(1000);
    expect(out.rows.find((x) => x.code === "1090")!.elimination).toBe(0);
  });

  it("strict refuses unmatched intercompany balances with the difference", () => {
    expect(() =>
      consolidate(
        [
          { id: "A", name: "A", accounts: [acct("1090", "asset", 1000, 0, "B")] },
          { id: "B", name: "B", accounts: [acct("2090", "liability", 0, 900, "A")] },
        ],
        "bs",
        { strict: true }
      )
    ).toThrowError(/do not match/);
    try {
      consolidate(
        [
          { id: "A", name: "A", accounts: [acct("4095", "income", 0, 1000, "B")] },
          { id: "B", name: "B", accounts: [acct("5195", "expense", 900, 0, "A")] },
        ],
        "pl",
        { strict: true }
      );
    } catch (e: any) {
      expect(e.code).toBe("UNMATCHED_INTERCOMPANY");
      expect(e.details.difference).toBe(100);
    }
  });

  it("balance sheet and P&L are checked separately", () => {
    // a P&L mismatch does not block the balance sheet
    const out = consolidate(
      [
        { id: "A", name: "A", accounts: [acct("4095", "income", 0, 1000, "B")] },
        { id: "B", name: "B", accounts: [acct("5195", "expense", 900, 0, "A")] },
      ],
      "bs"
    );
    expect(out.earnings?.consolidated).toBe(100);
  });
});

describe("Small Business Relief sunset (MD 73/2023)", () => {
  const base = { totalRevenue: 2_900_000, totalExpenses: 1_900_000, smallBusinessReliefElected: true };
  it("grants relief for a period ending on or before 31 Dec 2026", () => {
    const c = computeCtComputation({ ...base, taxPeriodEnd: "2026-12-31" });
    expect(c.smallBusinessRelief.applied).toBe(true);
    expect(c.taxPayable).toBe(0);
  });
  it("refuses it for a period ending after, and says why", () => {
    const c = computeCtComputation({ ...base, taxPeriodEnd: "2027-12-31" });
    expect(c.smallBusinessRelief.applied).toBe(false);
    expect(c.smallBusinessRelief.ineligibleReason).toBe("period_after_sunset");
    expect(c.taxPayable).toBe(Math.round((1_000_000 - 375_000) * 0.09 * 100) / 100);
  });
  it("revenue over the cap and a prior breach still refuse it", () => {
    expect(computeCtComputation({ ...base, totalRevenue: 3_100_000, taxPeriodEnd: "2025-12-31" }).smallBusinessRelief.ineligibleReason).toBe("revenue_cap");
    expect(computeCtComputation({ ...base, priorPeriodsExceededRevenueCap: true, taxPeriodEnd: "2025-12-31" }).smallBusinessRelief.ineligibleReason).toBe("prior_period_breach");
  });
  it("without a period end the sunset cannot be checked and is not applied (old callers)", () => {
    expect(computeCtComputation(base).smallBusinessRelief.applied).toBe(true);
  });
});
