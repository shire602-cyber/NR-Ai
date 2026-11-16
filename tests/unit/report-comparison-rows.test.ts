/**
 * R20-09: the Reports period-comparison rows are a pure builder (reports/comparisons) instead of a
 * 2,900-line memo inside useReportsPage. These tests pin its behaviour: one row per metric in the
 * original order, every preset metric present, and values read from the memo's tracked inputs.
 */
import { describe, expect, it } from "vitest";
import { reportComparisonPresets } from "../../client/src/lib/reportCatalog";
import {
  buildComparisonRows,
  type ComparisonRowsInput,
} from "../../client/src/pages/reports/comparisons/buildComparisonRows";

const currentRange = { from: new Date(2026, 3, 1), to: new Date(2026, 5, 30, 23, 59, 59) };
const previousRange = { from: new Date(2026, 0, 1), to: new Date(2026, 2, 31, 23, 59, 59) };

function invoice(id: string, date: string, total: number, status = "sent") {
  return {
    id,
    number: id,
    customerName: "Customer " + id,
    date,
    dueDate: date,
    currency: "AED",
    baseCurrencyAmount: total,
    total,
    status,
    reminderCount: 0,
    lastReminderSentAt: null,
    invoiceType: "invoice",
  };
}

function input(overrides: Partial<ComparisonRowsInput> = {}): ComparisonRowsInput {
  return {
    comparisonCurrentProfitLoss: { netProfit: 900, totalExpenses: 4100, totalRevenue: 5000 },
    comparisonCurrentBalanceSheet: {
      totalAssets: 10000,
      totalEquity: 6000,
      totalLiabilities: 4000,
    },
    comparisonCurrentCostCenterProfitability: { totals: { netIncome: 300, totalExpenses: 700 } },
    comparisonCurrentRange: currentRange,
    comparisonCurrentSalesProductService: { totals: { topProductServiceShare: 42.5 } },
    comparisonCurrentVat: { netVATPayable: 250 },
    comparisonPreviousCostCenterProfitability: { totals: { netIncome: 200, totalExpenses: 650 } },
    comparisonPreviousCorporateTaxEstimate: { taxPayable: 120 },
    comparisonPreviousProfitLoss: { netProfit: -100, totalExpenses: 3100, totalRevenue: 3000 },
    comparisonPreviousBalanceSheet: {
      totalAssets: 9000,
      totalEquity: 5000,
      totalLiabilities: 4000,
    },
    comparisonPreviousRange: previousRange,
    comparisonPreviousSalesProductService: { totals: { topProductServiceShare: 38 } },
    comparisonPreviousVat: { netVATPayable: 180 },
    consolidatedStatementsReport: {
      currentComparisonExpenses: 100,
      currentComparisonNetProfit: 50,
      currentComparisonRevenue: 150,
      previousExpenses: 90,
      previousNetProfit: 40,
      previousRevenue: 130,
      reviewCount: 2,
    },
    serverGroupConsolidation: null,
    activityLogs: [],
    bankTransactions: [],
    cashFlowForecast: { currentBalance: undefined, projections: undefined },
    cashFlowStatement: [],
    corporateTaxEstimate: { taxPayable: 300 },
    depreciationScheduleReport: { readyToPostCount: 2, reviewCount: 1, reviewValueAed: 400 },
    expenseClaims: [],
    fixedAssetRegisterReport: { activeRows: [], reviewCount: 1, reviewValueAed: 900 },
    fxGainsLosses: { totalUnrealizedGain: 20, totalUnrealizedLoss: -35 },
    invoices: [
      invoice("a", "2026-04-10", 1000),
      invoice("b", "2026-05-02", 500, "paid"),
      invoice("c", "2026-02-15", 700),
      invoice("d", "2026-05-20", 999, "void"),
    ],
    inventoryMovements: [],
    inventoryValuationReport: { activeProductCount: 4, reviewCount: 1, reviewValueAed: 75 },
    journalEntries: [],
    monthEndCloseStatus: { checklist: undefined },
    payrollRuns: [],
    receipts: [],
    varianceReport: { varianceLines: undefined },
    vendorBills: [],
    ...overrides,
  };
}

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
