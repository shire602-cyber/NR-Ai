/**
 * R20-09: the Reports period-comparison rows are a pure builder (reports/comparisons) instead of a
 * 2,900-line memo inside useReportsPage. These tests pin its behaviour: one row per metric in the
 * original order, every preset metric present, and values read from the memo's tracked inputs.
 */
import { describe, expect, it } from "vitest";
import * as fx from "./helpers/comparison-rows-fixture";
import { reportComparisonPresets } from "../../client/src/lib/reportCatalog";
import { buildComparisonRows } from "../../client/src/pages/reports/comparisons/buildComparisonRows";

const input = fx.buildComparisonRowsFixture;

const row = (rows: ReturnType<typeof buildComparisonRows>, id: string) => {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`missing comparison row ${id}`);
  return found;
};

describe("buildComparisonRows (R20-09)", () => {
  it("emits one uniquely identified row per metric, covering every comparison preset", () => {
    const rows = buildComparisonRows(input());
    expect(rows).toHaveLength(152);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows[0].id).toBe("revenue");
    expect(rows[rows.length - 1].id).toBe("ledger-activity");
    const ids = new Set(rows.map((r) => r.id));
    for (const preset of reportComparisonPresets) {
      for (const metricId of preset.metricIds) expect(ids.has(metricId)).toBe(true);
    }
  });

  it("reads statement, document and snapshot inputs into the matching rows", () => {
    const rows = buildComparisonRows(input());
    expect(row(rows, "revenue")).toMatchObject({ current: 5000, previous: 3000, delta: 2000 });
    expect(row(rows, "net-profit")).toMatchObject({ current: 900, previous: -100 });
    expect(row(rows, "vat-due")).toMatchObject({ current: 250, previous: 180 });
    // Active (non-void) invoices by document date: a + b in the current range, c in the previous.
    expect(row(rows, "invoice-value")).toMatchObject({ current: 1500, previous: 700 });
    expect(row(rows, "invoice-count")).toMatchObject({ current: 2, previous: 1 });
    expect(row(rows, "fx-unrealized-exposure").current).toBe(55);
    expect(row(rows, "consolidation-review-items").current).toBe(2);
  });

  it("treats missing statements (undefined member paths) as zero, like the original memo", () => {
    const rows = buildComparisonRows(
      input({
        comparisonCurrentProfitLoss: {
          netProfit: undefined,
          totalExpenses: undefined,
          totalRevenue: undefined,
        },
        comparisonCurrentVat: { netVATPayable: undefined },
      })
    );
    expect(row(rows, "revenue").current).toBe(0);
    expect(row(rows, "vat-due").current).toBe(0);
    expect(rows.every((r) => Number.isFinite(r.current) && Number.isFinite(r.previous))).toBe(true);
  });
});
