import { describe, expect, it } from "vitest";
import {
  prepareBalanceSummaryReportsForExport,
  prepareLedgerReportsForExport,
  preparePlanningReportsForExport,
} from "../../client/src/lib/export";

describe("report export helpers", () => {
  it("builds buyer-friendly general ledger workbook sheets", () => {
    const sheets = prepareLedgerReportsForExport({
      entryCount: 1,
      lineCount: 2,
      accountCount: 2,
      totalDebit: 105,
      totalCredit: 105,
      difference: 0,
      reviewEntries: 1,
      foreignCurrencyLines: 1,
      accountActivity: [
        {
          accountCode: "6100",
          accountName: "Office supplies",
          accountType: "expense",
          lineCount: 1,
          debit: 105,
          credit: 0,
          netActivity: 105,
          lastActivity: "2026-06-15",
        },
      ],
      sourceRows: [
        {
          source: "Manual / no source",
          entryCount: 1,
          lineCount: 2,
          amountAed: 210,
          needsReview: true,
        },
      ],
      lines: [
        {
          date: "2026-06-15",
          entryNumber: "JE-0001",
          accountCode: "6100",
          accountName: "Office supplies",
          accountType: "expense",
          memo: "Printer paper",
          source: "Manual / no source",
          debit: 105,
          credit: 0,
          hasForeignCurrency: true,
        },
      ],
    });

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      "Ledger Summary",
      "Account Activity",
      "Source Review",
      "Ledger Detail",
    ]);
    expect(sheets[0].rows).toContainEqual({ metric: "Balance status", value: "Balanced" });
    expect(sheets[1].rows[0]).toMatchObject({
      accountCode: "6100",
      debit: "105.00",
      netActivity: "105.00",
    });
    expect(sheets[2].rows[0]).toMatchObject({
      source: "Manual / no source",
      needsReview: "Yes",
    });
    expect(sheets[3].rows[0]).toMatchObject({
      entryNumber: "JE-0001",
      foreignCurrency: "Yes",
    });
  });

  it("builds buyer-friendly planning workbook sheets", () => {
    const sheets = preparePlanningReportsForExport({
      budget: {
        name: "FY2026 Operating Budget",
      },
      budgetPlans: [
        {
          name: "FY2026 Operating Budget",
          fiscal_year: 2026,
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          status: "approved",
          total_budget: "120000",
        },
      ],
      budgetTotal: 120000,
      actualTotal: 132000,
      variance: -12000,
      variancePercent: -10,
      overBudgetLines: 1,
      currentBalance: 45000,
      projectedInflows: 30000,
      projectedOutflows: 42000,
      projectedEndingBalance: 33000,
      cashMovement: -12000,
      cashWarning: "Low cash warning",
      lowestProjection: {
        projectedBalance: 28000,
      },
      varianceLines: [
        {
          category: "Marketing",
          description: "Launch ads",
          totals: {
            budget: 10000,
            actual: 14000,
            variance: -4000,
            variancePercent: -40,
          },
        },
      ],
      projections: [
        {
          week: 1,
          weekStart: "2026-06-15",
          weekEnd: "2026-06-21",
          expectedInflows: 5000,
          expectedOutflows: 7000,
          projectedBalance: 43000,
        },
      ],
      insights: ["Marketing is over budget; review campaign pacing."],
    });

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      "Planning Summary",
      "Budget Plans",
      "Budget Variance",
      "Cash Projections",
      "Planning Insights",
    ]);
    expect(sheets[0].rows).toContainEqual({
      metric: "Cash warning",
      value: "Low cash warning",
    });
    expect(sheets[1].rows[0]).toMatchObject({
      name: "FY2026 Operating Budget",
      totalBudget: "120000.00",
    });
    expect(sheets[2].rows[0]).toMatchObject({
      category: "Marketing",
      variance: "-4000.00",
      variancePercent: "-40.00%",
      status: "Over budget",
    });
    expect(sheets[3].rows[0]).toMatchObject({
      week: 1,
      expectedOutflows: "7000.00",
    });
    expect(sheets[4].rows[0]).toMatchObject({
      number: 1,
      insight: "Marketing is over budget; review campaign pacing.",
    });
  });

  it("builds buyer-friendly customer and vendor balance workbook sheets", () => {
    const sheets = prepareBalanceSummaryReportsForExport({
      generatedAt: "2026-06-16T00:00:00.000Z",
      customerOpenAed: 15750,
      customerOverdueAed: 5250,
      customerCount: 2,
      vendorOpenAed: 6100,
      vendorOverdueAed: 2100,
      vendorCount: 1,
      netBalanceAed: 9650,
      customers: [
        {
          name: "Pearl Trading LLC",
          currency: "AED",
          invoiceCount: 3,
          openBalance: 10500,
          openBalanceAed: 10500,
          overdueBalance: 5250,
          overdueBalanceAed: 5250,
          maxDaysOverdue: 18,
        },
      ],
      vendors: [
        {
          name: "Office Supplies FZE",
          currency: "AED",
          billCount: 2,
          openBalance: 6100,
          openBalanceAed: 6100,
          overdueBalance: 2100,
          overdueBalanceAed: 2100,
          maxDaysOverdue: 7,
        },
      ],
    });

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      "Balance Summary",
      "Customer Balances",
      "Vendor Balances",
    ]);
    expect(sheets[0].rows).toContainEqual({
      metric: "Net receivable less payable (AED)",
      value: "9650.00",
    });
    expect(sheets[1].rows[0]).toMatchObject({
      name: "Pearl Trading LLC",
      invoiceCount: 3,
      overdueBalanceAed: "5250.00",
      maxDaysOverdue: 18,
    });
    expect(sheets[2].rows[0]).toMatchObject({
      name: "Office Supplies FZE",
      billCount: 2,
      openBalanceAed: "6100.00",
    });
  });
});
