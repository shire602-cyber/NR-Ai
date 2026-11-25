import type { ComparisonRowsInput } from "../../../client/src/pages/reports/comparisons/buildComparisonRows";

const currentRange = { from: new Date(2026, 3, 1), to: new Date(2026, 5, 30, 23, 59, 59) };
const previousRange = { from: new Date(2026, 0, 1), to: new Date(2026, 2, 31, 23, 59, 59) };

export function invoice(id: string, date: string, total: number, status = "sent") {
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

export function buildComparisonRowsFixture(
  overrides: Partial<ComparisonRowsInput> = {}
): ComparisonRowsInput {
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
