import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  JournalEntryReportRow,
  ReceiptReportRow,
} from "../../client/src/pages/reports/model/reportTypes";
import { collectInvoiceExportRows } from "../../client/src/lib/invoice-filters";
import { describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "../../client/src/lib/csrf";
import { loadLocale, translateNow, useI18n } from "../../client/src/lib/i18n";
import {
  reportAutomationStarters,
  reportPersonaWorkspaces,
} from "../../client/src/lib/reportCatalog";
import {
  downloadOcrExcel,
  downloadReceiptsExcel,
  exportToExcel,
  prepareAgingReportsForExport,
  prepareAuditTrailForExport,
  prepareBalanceSummaryReportsForExport,
  prepareCashFlowStatementForExport,
  prepareConsolidatedStatementsForExport,
  prepareCostCenterProfitabilityForExport,
  prepareExpenseReportsForExport,
  prepareFxGainsLossesForExport,
  prepareLedgerReportsForExport,
  preparePayrollReportsForExport,
  preparePeriodComparisonForExport,
  preparePlanningReportsForExport,
} from "../../client/src/lib/export";
import { useReportsWorkspacePack } from "../../client/src/pages/reports/hooks/useReportsWorkspacePack";
import { localizeExportSheets } from "../../client/src/lib/export-localize";
import { EXCEL_EXPORT_LIMITS, supportsExcelWorkbookSize } from "../../shared/excel-export";

describe("report export helpers", () => {
  it("collects all status-filtered pages and exports only invoices in the date range", async () => {
    const november = Array.from({ length: 51 }, (_, id) => ({
      id,
      date: "2026-11-10",
      status: id === 50 ? "sent" : "draft",
    }));
    const source = [
      ...november.slice(0, 48),
      { id: 51, date: "2021-01-01", status: "draft" },
      { id: 52, date: "2021-01-02", status: "draft" },
      ...november.slice(48),
    ];
    const range = { from: new Date(2026, 10, 1), to: new Date(2026, 10, 30) };
    const downloadRows = (status?: string) =>
      collectInvoiceExportRows(async (cursor) => {
        const filtered = source.filter((row) => !status || row.status === status);
        const offset = Number(cursor ?? 0);
        return {
          items: filtered.slice(offset, offset + 50),
          nextCursor: filtered.length > offset + 50 ? String(offset + 50) : null,
        };
      }, range);
    expect(await downloadRows()).toEqual(november);
    expect(await downloadRows("draft")).toEqual(november.slice(0, 50));
  });

  it.each([
    [
      "en",
      "Automation Starters",
      "Setup Steps",
      "Review invoices and upload a CSV bank statement",
      "Launch cash autopilot",
    ],
    [
      "ar",
      "بدايات الأتمتة",
      "خطوات الإعداد",
      "راجع الفواتير وارفع كشف حساب بنكي بصيغة CSV",
      "إطلاق الأتمتة الذاتية للنقد",
    ],
  ] as const)(
    "exports the %s owner automation checklist in the workbook",
    async (locale, name, setupHeader, step, action) => {
      const previous = useI18n.getState().locale;
      await loadLocale(locale);
      useI18n.getState().setLocale(locale);
      try {
        const workspace = {
          ...reportPersonaWorkspaces.find((item) => item.persona === "owner"),
          reports: [],
          readyReports: 0,
        };
        const starter = reportAutomationStarters.find(
          (item) => item.id === "owner-cash-control-autopilot"
        );
        const { buildWorkspaceReportPack } = useReportsWorkspacePack({
          dateRange: {},
          vatReturns: [],
          automationQueue: [],
          comparisonRows: [],
          personaReportRecommendations: [],
          reportAccountantHandoffSummaries: [],
          reportAutomationOperationSummaries: [],
          reportAutomationRules: [],
          reportAutomationStarterSummaries: [
            {
              ...starter,
              reports: [],
              playbooks: [],
              queueSignals: [],
              readyCount: 0,
              openWorkItemCount: 0,
              amountAtRisk: 0,
            },
          ],
          reportAutomationTriggerRuleSummaries: [],
          reportComparisonPresetSummaries: [],
          reportDecisionShortcutSummaries: [],
          reportDeliverySubscriptionSummaries: [],
          reportPackDeliveryReadiness: [],
          reportPackTemplateSummaries: [],
          reportRoadmap: [],
        } as Parameters<typeof useReportsWorkspacePack>[0]);
        const sheets = buildWorkspaceReportPack(
          workspace as Parameters<typeof buildWorkspaceReportPack>[0]
        );
        const starters = (await localizeExportSheets(sheets, undefined, true)).find(
          (sheet) => sheet.sheetName === name
        );
        expect(starters?.columns).toContainEqual(
          expect.objectContaining({ key: "setupSteps", header: setupHeader })
        );
        expect(String(starters?.rows[0]?.setupSteps).split(" | ")[0]).toBe(step);
        expect(starters?.rows[0]?.primaryAction).toBe(action);
      } finally {
        useI18n.getState().setLocale(previous);
      }
    }
  );

  it("includes headers and empty cells in the shared workbook budget", () => {
    const columns = Array(EXCEL_EXPORT_LIMITS.columnsPerWorksheet).fill({});
    const rowsAtLimit = EXCEL_EXPORT_LIMITS.renderedCells / columns.length - 1;
    expect(supportsExcelWorkbookSize([{ columns, rows: Array(rowsAtLimit).fill({}) }])).toBe(true);
    expect(supportsExcelWorkbookSize([{ columns, rows: Array(rowsAtLimit + 1).fill({}) }])).toBe(
      false
    );
  });

  it("blocks an over-limit UTF-8 workbook before sending an export request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const value = "€".repeat(Math.ceil(EXCEL_EXPORT_LIMITS.requestBytes / 3));
      const sheets = [{ columns: [{ header: "Value", key: "value" }], rows: [{ value }] }];
      expect(JSON.stringify(sheets).length).toBeLessThan(EXCEL_EXPORT_LIMITS.requestBytes);
      await expect(exportToExcel(sheets, "test_workbook")).rejects.toThrow(
        translateNow("toasts.excelExportTooLarge")
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rechecks the active company after the workbook response and before downloading", async () => {
    clearCsrfToken();
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ csrfToken: "test-token" }))
      .mockResolvedValueOnce(new Response("workbook"));
    vi.stubGlobal("fetch", request);
    const download = vi.spyOn(URL, "createObjectURL");
    const assertActive = vi.fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error("Company changed"); });

    try {
      const sheets = [{ columns: [{ header: "Value", key: "value" }], rows: [{ value: 10 }] }];
      await expect(exportToExcel(sheets, "workbook", { assertActive })).rejects.toThrow(
        "Company changed"
      );
      expect(request).toHaveBeenCalledTimes(2);
      expect(assertActive).toHaveBeenCalledTimes(2);
      expect(download).not.toHaveBeenCalled();
    } finally {
      clearCsrfToken();
      download.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it.each([
    {
      label: "a selected receipt",
      run: () => downloadReceiptsExcel("company", { ids: ["receipt"] }),
      path: "/api/companies/company/receipts/export-excel",
      body: { ids: ["receipt"] },
      disposition: "attachment; filename*=UTF-8''June%20receipts.xlsx",
      name: "June receipts.xlsx",
    },
    {
      label: "all receipts",
      run: () => downloadReceiptsExcel("company"),
      path: "/api/companies/company/receipts/export-excel",
      body: {},
      disposition: "attachment",
      name: "muhasib-receipts.xlsx",
    },
    {
      label: "OCR rows",
      run: () => downloadOcrExcel([], { filename: "June" }),
      path: "/api/ocr/export-excel",
      body: { rows: [], filename: "June" },
      disposition: null,
      name: "muhasib-ocr-receipts.xlsx",
    },
    {
      label: "an untitled OCR export",
      run: () => downloadOcrExcel([]),
      path: "/api/ocr/export-excel",
      body: { rows: [] },
      disposition: null,
      name: "muhasib-ocr-receipts.xlsx",
    },
    {
      label: "an Arabic receipts export",
      run: () => downloadReceiptsExcel("company", { ids: ["receipt"], locale: "ar" }),
      path: "/api/companies/company/receipts/export-excel",
      body: { ids: ["receipt"], locale: "ar" },
      disposition: null,
      name: "muhasib-receipts.xlsx",
    },
    {
      label: "an Arabic OCR export",
      run: () => downloadOcrExcel([], { locale: "ar" }),
      path: "/api/ocr/export-excel",
      body: { rows: [], locale: "ar" },
      disposition: null,
      name: "muhasib-ocr-receipts.xlsx",
    },
    {
      label: "a standard workbook",
      run: () => exportToExcel([{ columns: [{ header: "Value", key: "value" }], rows: [] }], "ledger"),
      path: "/api/export/excel",
      body: { sheets: [{ columns: [{ header: "Value", key: "value" }], rows: [] }], filename: "ledger" },
      disposition: 'attachment; filename="ledger-export.xlsx"',
      name: "ledger-export.xlsx",
    },
  ])("downloads $label from the expected endpoint", async ({ run, path, body, disposition, name }) => {
    clearCsrfToken();
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ csrfToken: "test-token" }))
      .mockResolvedValueOnce(new Response("workbook", {
        headers: disposition ? { "Content-Disposition": disposition } : {},
      }));
    const anchor = { href: "", download: "", click: vi.fn() };
    const revoke = vi.spyOn(URL, "revokeObjectURL");

    vi.stubGlobal("fetch", request);
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    try {
      await run();
      expect(request).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(path),
        expect.objectContaining({ method: "POST", body: JSON.stringify(body) })
      );
      expect(anchor.download).toBe(name);
      expect(anchor.click).toHaveBeenCalledOnce();
      expect(revoke).toHaveBeenCalledWith(anchor.href);
    } finally {
      clearCsrfToken();
      revoke.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [() => Response.json({ error: "Workbook unavailable" }, { status: 422 }), "Workbook unavailable"],
    [() => Response.json({ message: "Try another workbook" }, { status: 422 }), "Try another workbook"],
    [() => Response.json({}, { status: 418, statusText: "Unavailable" }), "418 Unavailable"],
    [() => new Response("unavailable", { status: 418, statusText: "Unavailable" }), "418 Unavailable"],
  ] as const)("reports a rejected workbook response without downloading", async (response, message) => {
    clearCsrfToken();
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ csrfToken: "test-token" }))
      .mockResolvedValueOnce(response());
    const download = vi.spyOn(URL, "createObjectURL");
    vi.stubGlobal("fetch", request);

    try {
      await expect(downloadReceiptsExcel("company")).rejects.toThrow(message);
      expect(download).not.toHaveBeenCalled();
    } finally {
      clearCsrfToken();
      download.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("builds workbook sheets for advanced cash, aging, comparison, and FX reports", () => {
    const cashSheets = prepareCashFlowStatementForExport([
      {
        period: "Q2 2026",
        operatingInflow: 12000,
        operatingOutflow: 7000,
        investingInflow: 0,
        investingOutflow: 1500,
        financingInflow: 2000,
        financingOutflow: 500,
        netCashFlow: 5000,
        endingBalance: 25000,
      },
    ]);
    const agingSheets = prepareAgingReportsForExport({
      receivables: [
        {
          name: "Acme LLC",
          type: "receivable",
          current: 1000,
          days30: 250,
          days60: 0,
          days90: 0,
          over90: 50,
          total: 1300,
        },
      ],
      payables: {
        current: { amount: 400, count: 1 },
        days_1_30: { amount: 200, count: 1 },
        days_31_60: { amount: 0, count: 0 },
        days_61_90: { amount: 0, count: 0 },
        days_90_plus: { amount: 25, count: 1 },
      },
    });
    const comparisonSheet = preparePeriodComparisonForExport([
      {
        label: "Revenue",
        current: 12000,
        previous: 10000,
        delta: 2000,
        percentChange: 20,
        signal: "Growth",
      },
    ]);
    const fxSheets = prepareFxGainsLossesForExport({
      asOf: "2026-06-17T00:00:00.000Z",
      baseCurrency: "AED",
      receivables: [
        {
          entityType: "invoice",
          entityNumber: "INV-1",
          counterparty: "Acme LLC",
          currency: "USD",
          foreignAmount: 1000,
          transactionRate: 0.27,
          currentRate: 0.26,
          bookValueAed: 3703.7,
          currentValueAed: 3846.15,
          unrealizedGainLoss: 142.45,
        },
      ],
      payables: [],
      totalUnrealizedGain: 142.45,
      totalUnrealizedLoss: 0,
      netUnrealizedGainLoss: 142.45,
    });

    expect(cashSheets.map((sheet) => sheet.sheetName)).toEqual([
      "Cash Flow Statement",
      "Cash Flow Detail",
    ]);
    expect(agingSheets.map((sheet) => sheet.sheetName)).toEqual(["A/R Aging", "A/P Aging"]);
    expect(comparisonSheet.sheetName).toBe("Period Comparison");
    expect(fxSheets.map((sheet) => sheet.sheetName)).toEqual([
      "FX Gains and Losses",
      "FX Exposure Detail",
    ]);
    expect(agingSheets[1].rows).toContainEqual({
      bucket: "90+",
      count: 1,
      amount: "25.00",
    });
  });

  it("builds buyer-friendly audit trail workbook sheets", () => {
    const sheets = prepareAuditTrailForExport({
      logCount: 2,
      highRiskCount: 1,
      mediumRiskCount: 1,
      postingActionCount: 1,
      userCount: 1,
      latestLog: {
        createdAt: "2026-06-16T10:00:00.000Z",
      },
      actionRows: [
        {
          key: "delete",
          label: "delete",
          count: 1,
          latestAt: "2026-06-16T10:00:00.000Z",
        },
      ],
      entityRows: [
        {
          key: "invoice",
          label: "invoice",
          count: 2,
          latestAt: "2026-06-16T10:00:00.000Z",
        },
      ],
      rows: [
        {
          createdAt: "2026-06-16T10:00:00.000Z",
          actionLabel: "delete",
          entityLabel: "invoice",
          entityId: "INV-1",
          riskLevel: "High",
          description: "Deleted draft invoice INV-1",
          userId: "user-1",
          metadata: '{"changes":["status"]}',
        },
      ],
    });

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      "Audit Trail Summary",
      "Audit Actions",
      "Audit Entities",
      "Audit Trail Detail",
    ]);
    expect(sheets[0].rows).toContainEqual({ metric: "High-risk events", value: 1 });
    expect(sheets[1].rows[0]).toMatchObject({ action: "delete", count: 1 });
    expect(sheets[2].rows[0]).toMatchObject({ entity: "invoice", count: 2 });
    expect(sheets[3].rows[0]).toMatchObject({
      action: "delete",
      entity: "invoice",
      risk: "High",
      description: "Deleted draft invoice INV-1",
    });
  });

  it("builds a cost center P&L workbook sheet", () => {
    const sheet = prepareCostCenterProfitabilityForExport({
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      costCenters: [
        {
          costCenterId: "cc-1",
          code: "OPS",
          name: "Operations",
          isActive: true,
          totalIncome: 15000,
          totalExpenses: 9000,
          netIncome: 6000,
          lineCount: 8,
        },
      ],
      totals: {
        costCenterCount: 1,
        activeCostCenterCount: 1,
        allocatedLineCount: 8,
        totalIncome: 15000,
        totalExpenses: 9000,
        netIncome: 6000,
      },
    });

    expect(sheet.sheetName).toBe("Cost Center P&L");
    expect(sheet.columns.map((column) => column.header)).toEqual([
      "Code",
      "Cost Center",
      "Status",
      "Income (AED)",
      "Expenses (AED)",
      "Net Income (AED)",
      "Allocated Lines",
    ]);
    expect(sheet.rows[0]).toMatchObject({
      code: "OPS",
      costCenter: "Operations",
      status: "Active",
      totalIncome: "15000.00",
      totalExpenses: "9000.00",
      netIncome: "6000.00",
      lineCount: 8,
    });
    expect(sheet.rows.at(-1)).toMatchObject({
      costCenter: "TOTAL",
      totalIncome: "15000.00",
      netIncome: "6000.00",
    });
  });

  it("builds buyer-friendly consolidated statement workbook sheets", () => {
    const sheets = prepareConsolidatedStatementsForExport({
      periodLabel: "Jun 01, 2026 - Jun 30, 2026",
      currency: "AED",
      consolidationBasis: "Accessible company roll-up; no eliminations applied.",
      entityCount: 2,
      loadedEntityCount: 2,
      failedEntityCount: 0,
      unbalancedEntityCount: 1,
      multiCurrencyEntityCount: 1,
      reviewCount: 2,
      totalRevenue: 125000,
      totalExpenses: 77000,
      netProfit: 48000,
      previousNetProfit: 41000,
      totalAssets: 310000,
      totalLiabilities: 120000,
      totalEquity: 189000,
      balanceDifference: 1000,
      eliminationsApplied: 0,
      statusLabel: "Review before delivery",
      rows: [
        {
          companyName: "North Ridge Trading LLC",
          companyType: "customer",
          baseCurrency: "AED",
          revenue: 95000,
          expenses: 61000,
          netProfit: 34000,
          previousNetProfit: 28000,
          assets: 220000,
          liabilities: 85000,
          equity: 135000,
          balanceDifference: 0,
          status: "included",
          statusLabel: "Included",
          reviewReason: "",
          workflow: "/financial-statements",
        },
        {
          companyName: "NR Advisory FZE",
          companyType: "client",
          baseCurrency: "USD",
          revenue: 30000,
          expenses: 16000,
          netProfit: 14000,
          previousNetProfit: 13000,
          assets: 90000,
          liabilities: 35000,
          equity: 54000,
          balanceDifference: 1000,
          status: "unbalanced",
          statusLabel: "Balance review",
          reviewReason: "AED 1000.00 balance difference. USD needs FX translation review.",
          workflow: "/financial-statements",
        },
      ],
    });

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      "Management Roll-up Summary",
      "Management Roll-up Entities",
      "Consolidation Review",
    ]);
    expect(sheets[0].rows).toContainEqual({ metric: "Net profit (AED)", value: "48000.00" });
    expect(sheets[0].rows).toContainEqual({ metric: "Eliminations applied", value: 0 });
    expect(sheets[1].rows[1]).toMatchObject({
      companyName: "NR Advisory FZE",
      baseCurrency: "USD",
      netProfit: "14000.00",
      statusLabel: "Balance review",
    });
    expect(sheets[2].rows[0]).toMatchObject({
      companyName: "NR Advisory FZE",
      reviewReason: "AED 1000.00 balance difference. USD needs FX translation review.",
      workflow: "/financial-statements",
    });
  });

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

  it("builds buyer-friendly expense workbook sheets with claim approval queues", () => {
    const sheets = prepareExpenseReportsForExport({
      receiptCount: 2,
      autoPostedReceipts: 1,
      unpostedReceipts: 1,
      subtotalAed: 1900,
      receiptVat: 95,
      totalAed: 1995,
      debitAed: 1900,
      creditAed: 0,
      lineCount: 2,
      entryCount: 1,
      basis: "Posted journal lines where the linked chart-of-account type is expense.",
      receiptSpend: 1995,
      byVendor: [
        {
          label: "Travel Desk LLC",
          entryCount: 1,
          lineCount: 2,
          debitAed: 1900,
          creditAed: 0,
          netExpenseAed: 1900,
        },
      ],
      byCategory: [
        {
          label: "Travel",
          entryCount: 1,
          lineCount: 2,
          debitAed: 1900,
          creditAed: 0,
          netExpenseAed: 1900,
        },
      ],
      claims: {
        claimCount: 2,
        totalAmount: 3150,
        submittedCount: 1,
        submittedAmount: 2100,
        approvedUnpaidCount: 1,
        approvedUnpaidAmount: 1050,
        paidCount: 0,
        thisMonthTotal: 3150,
        claims: [
          {
            claim_number: "EXP-0007",
            title: "Client site travel",
            status: "submitted",
            created_at: "2026-06-14T08:30:00.000Z",
            submitted_at: "2026-06-15T09:00:00.000Z",
            reviewed_at: null,
            paid_at: null,
            currency: "AED",
            total_amount: "2100",
            payment_reference: null,
          },
        ],
      },
      lines: [
        {
          entryNumber: "JE-2026-0007",
          date: "2026-06-15",
          vendor: "Travel Desk LLC",
          accountName: "Travel",
          accountCode: "6100",
          source: "Bill",
          debitAed: 1900,
          creditAed: 0,
          netExpenseAed: 1900,
        },
      ],
    });

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      "Expenses by Vendor",
      "Expenses by Category",
      "Posting Automation",
      "Expense Claims Summary",
      "Expense Claims Detail",
      "Posted Expense Detail",
    ]);
    expect(sheets[3].rows).toContainEqual({ metric: "Claim value (AED)", value: "3150.00" });
    expect(sheets[3].rows).toContainEqual({ metric: "Needs approval", value: 1 });
    expect(sheets[4].rows[0]).toMatchObject({
      claimNumber: "EXP-0007",
      title: "Client site travel",
      status: "submitted",
      submittedAt: "15 Jun 2026",
      amount: "2100.00",
    });
    expect(sheets[5].rows[0]).toMatchObject({
      merchant: "Travel Desk LLC",
      category: "Travel",
      netExpenseAed: "1900.00",
    });
  });

  it("builds buyer-friendly payroll workbook sheets with WPS readiness", () => {
    const sheets = preparePayrollReportsForExport({
      runCount: 2,
      employeeCount: 7,
      totalBasic: 42000,
      totalAllowances: 12000,
      totalDeductions: 1500,
      totalNet: 52500,
      approvalQueueCount: 1,
      draftCount: 0,
      approvedCount: 1,
      calculatedCount: 1,
      sifGeneratedCount: 1,
      wpsReadyCount: 1,
      wpsMissingCount: 1,
      statusRows: [
        {
          status: "approved",
          count: 1,
          employeeCount: 4,
          totalNet: 30000,
        },
        {
          status: "calculated",
          count: 1,
          employeeCount: 3,
          totalNet: 22500,
        },
      ],
      runs: [
        {
          period_month: 6,
          period_year: 2026,
          status: "approved",
          employee_count: 4,
          total_basic: "24000",
          total_allowances: "7000",
          total_deductions: "1000",
          total_net: "30000",
          sif_file_content: "EDR...",
          approved_at: "2026-06-25T09:00:00.000Z",
        },
        {
          period_month: 5,
          period_year: 2026,
          status: "calculated",
          employee_count: 3,
          total_basic: "18000",
          total_allowances: "5000",
          total_deductions: "500",
          total_net: "22500",
          sif_file_content: null,
          approved_at: null,
        },
      ],
    });

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      "Payroll Summary",
      "Payroll by Status",
      "WPS SIF Summary",
      "Payroll Runs",
    ]);
    expect(sheets[0].rows).toContainEqual({
      metric: "Total net payroll (AED)",
      value: "52500.00",
    });
    expect(sheets[1].rows[0]).toMatchObject({
      status: "approved",
      employeeCount: 4,
      totalNet: "30000.00",
    });
    expect(sheets[2].rows).toContainEqual({ metric: "Needs SIF generation", value: 1 });
    expect(sheets[3].rows[0]).toMatchObject({
      period: "01 Jun 2026",
      status: "approved",
      totalNet: "30000.00",
      sifGenerated: "Yes",
      approvedAt: "25 Jun 2026",
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
      inventory: {
        productCount: 1,
        activeProductCount: 1,
        totalUnits: 12,
        totalStockValueAed: 9600,
        lowStockCount: 1,
        negativeStockCount: 0,
        missingCostCount: 0,
        movementCount: 3,
        productMovementCount: 1,
        movementInboundUnits: 5,
        movementOutboundUnits: 2,
        movementAdjustmentUnits: 1,
        totalMovementValueAed: 6400,
        outboundMovementValueAed: 1600,
        reviewCount: 1,
        movementTypeRows: [
          {
            type: "purchase",
            count: 1,
            quantity: 5,
            valueAed: 4000,
          },
          {
            type: "sale",
            count: 1,
            quantity: 2,
            valueAed: 1600,
          },
          {
            type: "adjustment",
            count: 1,
            quantity: 1,
            valueAed: 800,
          },
        ],
        movementRows: [
          {
            createdAt: "2026-06-15T08:00:00.000Z",
            productName: "Router bit set",
            sku: "INV-001",
            type: "purchase",
            quantity: 5,
            unitCost: 800,
            valueAed: 4000,
            reference: "PO-001",
          },
        ],
        rows: [
          {
            name: "Router bit set",
            sku: "INV-001",
            unit: "pcs",
            isActive: true,
            currentStock: 12,
            unitCost: 800,
            stockValueAed: 9600,
            lowStockThreshold: 15,
            movementCount: 3,
            isLowStock: true,
            isNegativeStock: false,
            isMissingCost: false,
          },
        ],
      },
      fixedAssets: {
        totalAssets: 1,
        totalCost: 42000,
        totalAccumulatedDepreciation: 7000,
        totalNetBookValue: 35000,
        disposedAssetCount: 0,
        capitalizationReviewCount: 1,
        depreciationReviewCount: 1,
        depreciation: {
          period: "2026-06",
          assetCount: 1,
          depreciableAssetCount: 1,
          readyToPostCount: 1,
          reviewCount: 0,
          fullyDepreciatedCount: 0,
          nonDepreciableCount: 0,
          periodDepreciationAed: 700,
          annualDepreciationAed: 8400,
          remainingDepreciableAed: 35000,
          rows: [
            {
              assetName: "CNC Router",
              assetNumber: "FA-001",
              category: "Equipment",
              purchaseDate: "2026-01-15",
              method: "straight_line",
              usefulLifeYears: 5,
              purchaseCost: 42000,
              salvageValue: 0,
              accumulatedDepreciation: 7000,
              remainingDepreciable: 35000,
              monthlyDepreciation: 700,
              projectedNetBookValue: 34300,
              statusLabel: "Ready to post",
              reviewReason: "",
            },
          ],
        },
        byCategory: [
          {
            category: "Equipment",
            count: 1,
            totalCost: 42000,
            totalAccumulatedDepreciation: 7000,
            totalNetBookValue: 35000,
          },
        ],
        rows: [
          {
            asset_name: "CNC Router",
            asset_number: "FA-001",
            category: "Equipment",
            purchase_date: "2026-01-15",
            purchaseCost: 42000,
            accumulatedDepreciation: 7000,
            netBookValue: 35000,
            status: "active",
            needs_capitalization_je: true,
          },
        ],
      },
    });

    expect(sheets.map((sheet) => sheet.sheetName)).toEqual([
      "Balance Summary",
      "Inventory Summary",
      "Inventory Valuation",
      "Inventory Movement Summary",
      "Inventory Movement by Type",
      "Inventory Movement Detail",
      "Fixed Asset Summary",
      "Depreciation Schedule Summary",
      "Depreciation Schedule",
      "Fixed Assets by Category",
      "Fixed Asset Register",
      "Customer Balances",
      "Vendor Balances",
    ]);
    expect(sheets[0].rows).toContainEqual({
      metric: "Net receivable less payable (AED)",
      value: "9650.00",
    });
    expect(sheets[1].rows).toContainEqual({
      metric: "Stock value (AED)",
      value: "9600.00",
    });
    expect(sheets[2].rows[0]).toMatchObject({
      name: "Router bit set",
      stockValueAed: "9600.00",
      review: "Low stock",
    });
    expect(sheets[3].rows).toContainEqual({
      metric: "Movement value (AED)",
      value: "6400.00",
    });
    expect(sheets[4].rows[0]).toMatchObject({
      type: "purchase",
      quantity: "5.00",
      valueAed: "4000.00",
    });
    expect(sheets[5].rows[0]).toMatchObject({
      productName: "Router bit set",
      type: "purchase",
      valueAed: "4000.00",
      reference: "PO-001",
    });
    expect(sheets[6].rows).toContainEqual({
      metric: "Net book value (AED)",
      value: "35000.00",
    });
    expect(sheets[6].rows).toContainEqual({
      metric: "Period depreciation estimate (AED)",
      value: "700.00",
    });
    expect(sheets[7].rows).toContainEqual({
      metric: "Period depreciation (AED)",
      value: "700.00",
    });
    expect(sheets[8].rows[0]).toMatchObject({
      assetName: "CNC Router",
      monthlyDepreciation: "700.00",
      projectedNetBookValue: "34300.00",
      status: "Ready to post",
    });
    expect(sheets[9].rows[0]).toMatchObject({
      category: "Equipment",
      totalNetBookValue: "35000.00",
    });
    expect(sheets[10].rows[0]).toMatchObject({
      assetName: "CNC Router",
      netBookValue: "35000.00",
      review: "Capitalization journal review",
    });
    expect(sheets[11].rows[0]).toMatchObject({
      name: "Pearl Trading LLC",
      invoiceCount: 3,
      overdueBalanceAed: "5250.00",
      maxDaysOverdue: 18,
    });
    expect(sheets[12].rows[0]).toMatchObject({
      name: "Office Supplies FZE",
      billCount: 2,
      openBalanceAed: "6100.00",
    });
  });
});

it("exports actual cash spent once and reports VAT separately", async () => {
  const { receiptSpendInBase, receiptVatInBase } =
    await import("../../client/src/pages/reports/model/reportDocuments");
  const reverseCharge = {
    amount: 100,
    vatAmount: 5,
    exchangeRate: 0.9,
    baseCurrencyAmount: 90,
    reverseCharge: true,
    posted: true,
  } as never;
  const regular = {
    amount: 100,
    vatAmount: 5,
    exchangeRate: 0.9,
    baseCurrencyAmount: 94.5,
    posted: true,
  } as never;
  const sheet = prepareExpenseReportsForExport({
    receiptSpend: receiptSpendInBase(reverseCharge) + receiptSpendInBase(regular),
    receiptVat: receiptVatInBase(reverseCharge) + receiptVatInBase(regular),
  }).find((sheet) => sheet.sheetName === "Posting Automation");
  expect(sheet?.rows).toEqual(
    expect.arrayContaining([
      { metric: "Receipt spend captured (AED)", value: "184.50" },
      { metric: "Receipt VAT captured (AED)", value: "9.00" },
    ])
  );
});

it("exports the booked receipt payment and captured VAT in EUR", async () => {
  const { useReportsDerivedReports } =
    await import("../../client/src/pages/reports/hooks/useReportsDerivedReports");
  const receipt: ReceiptReportRow = {
    id: "receipt",
    merchant: "Office supplies",
    date: "2026-11-20",
    amount: 100,
    vatAmount: 5,
    currency: "USD",
    exchangeRate: 0.9,
    baseCurrencyAmount: 94.58,
    journalEntryId: "posted-entry",
    paymentAccountId: "bank",
    category: null,
    posted: true,
    autoPosted: false,
  };
  const entry: JournalEntryReportRow = {
    id: "posted-entry",
    entryNumber: "JE-001",
    date: "2026-11-20",
    source: "receipt",
    status: "posted",
    lines: [
      {
        id: "expense-line",
        entryId: "posted-entry",
        accountId: "expense",
        debit: 90,
        credit: 0,
        account: { id: "expense", type: "expense", code: "5000", nameEn: "Office expense" },
      },
      { id: "vat-line", entryId: "posted-entry", accountId: "vat", debit: 4.5, credit: 0 },
      { id: "payment-line", entryId: "posted-entry", accountId: "bank", debit: 0, credit: 94.5 },
    ],
  };
  const sheets: ReturnType<typeof prepareExpenseReportsForExport> = [];
  type ReportInputs = Parameters<typeof useReportsDerivedReports>[0];
  function ExpenseReportFixture() {
    const { expenseReport } = useReportsDerivedReports({
      agingReport: [],
      balanceSummaries: undefined,
      billAgingReport: undefined,
      consolidatedStatementSources: [],
      dateRange: { from: undefined, to: undefined },
      depreciationPeriodDate: new Date(2026, 10, 1),
      expenseClaimSummary: undefined,
      expenseClaimSummaryLoading: false,
      expenseClaims: [],
      expenseClaimsLoading: false,
      fixedAssetSummary: undefined,
      fixedAssets: [],
      inventoryMovements: [],
      inventoryProducts: [],
      invoices: [],
      invoicesLoading: false,
      journalEntries: [entry],
      journalLoading: false,
      overdueLoading: false,
      overdueReport: undefined,
      payrollRuns: [],
      payrollRunsLoading: false,
      receipts: [receipt],
      receiptsLoading: false,
      salesProductServiceReport: undefined,
      selectedCompany: { id: "company", baseCurrency: "EUR" } as ReportInputs["selectedCompany"],
      trialBalance: undefined,
      vendorBills: [],
    });
    sheets.push(...prepareExpenseReportsForExport(expenseReport));
    return null;
  }
  renderToStaticMarkup(createElement(ExpenseReportFixture));
  const posting = sheets.find((sheet) => sheet.sheetName === "Posting Automation");
  expect(posting?.rows).toEqual(
    expect.arrayContaining([
      { metric: "Receipt spend captured (EUR)", value: "94.50" },
      { metric: "Receipt VAT captured (EUR)", value: "4.50" },
      { metric: "Posted expense debits (EUR)", value: "90.00" },
    ])
  );
  expect(posting?.rows.some(({ metric }) => String(metric).includes("(AED)"))).toBe(false);
  expect(sheets[0].columns).toContainEqual(expect.objectContaining({ header: "Debit (EUR)" }));
});
