import { describe, expect, it } from "vitest";
import {
  addMonths,
  buckets,
  fiscalYearEnd,
  fiscalYearStart,
  readRange,
} from "../../server/reporting/dates";
import { isNonCurrent, plSection } from "../../server/reporting/classify";
import { normalizeGenericCell } from "../../server/services/excel-export.service";
import { coerceExportCell, coerceExportSheets } from "../../client/src/lib/export";

describe("reporting kernel dates", () => {
  it("[R11-01] fiscal year containing a date honours the company start month", () => {
    expect(fiscalYearStart("2026-06-30", 1)).toBe("2026-01-01");
    expect(fiscalYearStart("2026-03-31", 4)).toBe("2025-04-01");
    expect(fiscalYearStart("2026-04-01", 4)).toBe("2026-04-01");
    expect(fiscalYearEnd("2026-04-01", 4)).toBe("2027-03-31");
    expect(fiscalYearEnd("2025-02-10", 1)).toBe("2025-12-31");
  });

  it("[R12-05] readRange accepts from/to, startDate/endDate and periodStart/periodEnd", () => {
    expect(readRange({ from: "2026-01-01", to: "2026-01-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(readRange({ startDate: "2026-01-01", endDate: "2026-01-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(readRange({ periodStart: "2026-01-01", periodEnd: "2026-01-31" }).from).toBe(
      "2026-01-01"
    );
    expect(() => readRange({ from: "2026-13-01" })).toThrow(/YYYY-MM-DD/);
    expect(() => readRange({ from: "2026-02-01", to: "2026-01-01" })).toThrow(/on or before/);
  });

  it("[R11-17] monthly / quarterly buckets are clipped to the range", () => {
    expect(buckets("2026-01-15", "2026-03-10", "month").map((b) => [b.from, b.to])).toEqual([
      ["2026-01-15", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-10"],
    ]);
    expect(buckets("2026-02-01", "2026-12-31", "quarter").map((b) => b.label)).toEqual([
      "Q1 2026",
      "Q2 2026",
      "Q3 2026",
      "Q4 2026",
    ]);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("statement classification", () => {
  const acct = (code: string, type: string, nameEn = "x", subType: string | null = null) => ({
    code,
    type,
    nameEn,
    subType,
  });

  it("[R11-11] FX gain and similar are other income; cost of sales is its own section", () => {
    expect(plSection(acct("4090", "income", "Foreign Exchange Gain"))).toBe("other_income");
    expect(plSection(acct("4040", "income", "Interest Income"))).toBe("other_income");
    expect(plSection(acct("4020", "income", "Service Revenue"))).toBe("revenue");
    expect(plSection(acct("5500", "expense", "Cost of Goods Sold"))).toBe("cost_of_sales");
    expect(plSection(acct("5600", "expense", "Purchases", "cost_of_sales"))).toBe("cost_of_sales");
    expect(plSection(acct("5140", "expense", "Foreign Exchange Loss"))).toBe("other_expenses");
    expect(plSection(acct("5010", "expense", "Rent"))).toBe("operating_expenses");
  });

  it("[R11-17] current vs non-current from sub_type then chart code", () => {
    expect(isNonCurrent(acct("1210", "asset", "Equipment", "fixed_asset"))).toBe(true);
    expect(isNonCurrent(acct("1040", "asset", "AR", "current_asset"))).toBe(false);
    expect(isNonCurrent(acct("2210", "liability", "Loan", "long_term_liability"))).toBe(true);
    expect(isNonCurrent(acct("2230", "liability", "Other LT", null))).toBe(true);
    expect(isNonCurrent(acct("2010", "liability", "AP", null))).toBe(false);
  });
});

describe("numeric export cells", () => {
  it("[R11-10] money strings become numbers; codes and percentages stay text", () => {
    expect(normalizeGenericCell("112200.00")).toBe(112_200);
    expect(normalizeGenericCell("-148.98")).toBe(-148.98);
    expect(normalizeGenericCell("1020")).toBe("1020");
    expect(normalizeGenericCell("0012")).toBe("0012");
    expect(normalizeGenericCell("12.50%")).toBe("12.50%");
    expect(normalizeGenericCell("1,200.00")).toBe("1,200.00");
    expect(coerceExportCell("8873.38")).toBe(8873.38);
    expect(coerceExportCell("INV-001")).toBe("INV-001");
    const [sheet] = coerceExportSheets([
      { columns: [{ header: "A", key: "amount" }], rows: [{ amount: "5.00", code: "4090" }] },
    ]);
    expect(sheet.rows[0]).toEqual({ amount: 5, code: "4090" });
  });
});
