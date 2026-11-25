// @vitest-environment jsdom
/**
 * Step 1 / F2: every report tab reads fully Arabic in Arabic mode. Each tab is rendered with a
 * realistic payload (machine codes as the API and the report models send them: journal sources,
 * tax categories, statuses, movement types) whose user data is Arabic, so any Latin word left on
 * the screen outside `translate="no"` is UI copy that was not localised.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishLine } from "../e2e/lib/latin-text.mjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const tabs = import.meta.glob("../../client/src/pages/reports/tabs/*.tsx");

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      const body = url.includes("/api/csrf-token") ? { csrfToken: "x" } : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

/** Visible text nodes outside translate="no" (brands, codes the user types). */
function englishLines(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? "").replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!text || !el || el.closest("[translate=no]")) continue;
    if (isEnglishLine(text)) out.push(text);
  }
  return out;
}

async function renderTab(tabModule: string, extra: Record<string, unknown>) {
  const i18n = await import("../../client/src/lib/i18n");
  await act(async () => i18n.useI18n.getState().setLocale("ar"));
  const { ReportsPageContext } = await import("../../client/src/pages/reports/context");
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  const loadTab = tabs[`../../client/src/pages/reports/tabs/${tabModule}.tsx`];
  const { default: Tab } = (await loadTab()) as { default: () => ReturnType<typeof createElement> };
  const t = new Proxy({}, { get: (_o, key: string) => i18n.translateNow(key) });
  const state = new Proxy(
    {
      t,
      locale: "ar",
      selectedCompanyId: "c-1",
      dateRange: { from: new Date("2026-11-01T00:00:00"), to: new Date("2026-11-19T00:00:00") },
      reportSectionClass: (_ids: string[], base?: string) => base ?? "",
      reportLoadErrors: { pl: null, bs: null, vat: null },
      ...extra,
    } as Record<string, unknown>,
    {
      get: (target, key: string) =>
        key in target ? target[key] : /Loading$/.test(key) ? false : undefined,
    }
  );
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ReportsPageContext.Provider, { value: state as never }, createElement(Tab))
      )
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const account = (over: Record<string, unknown> = {}) => ({
  accountId: "a1",
  accountCode: "5100",
  accountName: "مصروف الإيجار",
  accountType: "expense",
  ...over,
});

describe("Reports in Arabic: no English UI text", () => {
  it.each([
    ["ProfitLossTab", "pl", "report-pl-load-error"],
    ["BalanceSheetTab", "bs", "report-bs-load-error"],
    ["VatTab", "vat", "report-vat-load-error"],
  ])(
    "%s: a failed fetch is an Arabic error with retry, not a zero statement",
    async (tab, key, id) => {
      const retry = vi.fn();
      await renderTab(tab, {
        reportLoadErrors: {
          pl: null,
          bs: null,
          vat: null,
          [key]: { error: new Error("x"), retry },
        },
      });
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
      expect(englishLines()).toEqual([]);
      expect(container.textContent).toContain("أعد المحاولة");
      expect(container.textContent).not.toMatch(/0\.00|٠٫٠٠/);
      const button = container.querySelector(`[data-testid="${id}"] button`) as HTMLButtonElement;
      await act(async () => button.click());
      expect(retry).toHaveBeenCalledTimes(1);
    }
  );

  it("VAT summary", async () => {
    await renderTab("VatTab", {
      dateRange: { from: undefined, to: undefined },
      vatSummary: {
        salesSubtotal: 1000,
        salesVAT: 50,
        purchasesSubtotal: 400,
        purchasesVAT: 20,
        netVATPayable: -30,
      },
    });
    expect(englishLines()).toEqual([]);
    expect(container.textContent).toContain("ضريبة المخرجات");
  });

  it("general ledger: codes become labels, memos and dates are Arabic", async () => {
    const lines = [
      {
        id: "l1",
        entryId: "e1",
        entryNumber: "JE-1",
        date: "2026-11-13",
        memo: "Payment received for Invoice INV-2026-00001 - bank_reconciliation",
        source: "bill payment",
        ...account(),
        debit: 100,
        credit: 0,
        hasForeignCurrency: true,
      },
      {
        id: "l2",
        entryId: "e2",
        entryNumber: "JE-2",
        date: "2026-11-05",
        memo: "Inventory sale - AUTO-KIT-1",
        source: "Manual / no source",
        ...account({ accountId: "a2", accountType: "income" }),
        debit: 0,
        credit: 100,
        hasForeignCurrency: false,
      },
    ];
    await renderTab("LedgerTab", {
      accountActivity: [
        { ...account(), lineCount: 2, debit: 100, credit: 0, netActivity: 100 },
        {
          ...account({ accountId: "a2", accountType: "income" }),
          lineCount: 1,
          debit: 0,
          credit: 100,
          netActivity: -100,
        },
      ],
      ledgerDetailCurrentPage: 1,
      ledgerDetailPageCount: 1,
      ledgerDetailPageLines: lines,
      ledgerDetailStartIndex: 0,
      ledgerLines: lines,
      ledgerReport: {
        entryCount: 2,
        difference: 0,
        accountCount: 2,
        reviewEntries: 1,
        foreignCurrencyLines: 1,
      },
      ledgerSourceRows: [
        { source: "bill payment", entryCount: 1, lineCount: 1, amountAed: 100, needsReview: false },
        {
          source: "Manual / no source",
          entryCount: 1,
          lineCount: 1,
          amountAed: 100,
          needsReview: true,
        },
      ],
      setLedgerDetailPage: () => {},
    });
    expect(englishLines()).toEqual([]);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Nov \d|bank_reconciliation|manual/);
    expect(text).toContain("13 نوفمبر 2026");
  });

  it("corporate tax estimate", async () => {
    const { corporateTaxEstimateStatus } =
      await import("../../client/src/pages/reports/model/reportDocuments");
    const i18n = await import("../../client/src/lib/i18n");
    await act(async () => i18n.useI18n.getState().setLocale("ar"));
    const estimate = {
      periodStart: "2026-11-01",
      periodEnd: "2026-11-19",
      taxableIncome: 100,
      taxPayable: 0,
      taxRate: 0.09,
      taxableAmount: 0,
      journalEntriesProcessed: 4,
    };
    const status = corporateTaxEstimateStatus(estimate as never);
    await renderTab("CorporateTaxTab", {
      corporateTaxEstimate: estimate,
      corporateTaxStatus: status,
      corporateTaxPeriodLabel: "",
      corporateTaxBridgeRows: [
        {
          metric: i18n.translateNow("reportCenter.text.ctRevenue"),
          amount: 100,
          note: status.detail,
        },
      ],
    });
    expect(englishLines()).toEqual([]);
    expect(container.textContent?.replace(/\p{Bidi_Control}/gu, "")).toContain("1–19 نوفمبر 2026");
  });

  it("month-end close and audit trail: checks from the catalog, no raw ids", async () => {
    const consolidated = {
      periodLabel: "كل الحركات المرحّلة",
      consolidationBasis: "تجميع إداري",
      statusLabel: "جاهز للحزمة",
      reviewCount: 0,
      loadedEntityCount: 1,
      entityCount: 1,
      totalRevenue: 0,
      netProfit: 0,
      totalAssets: 0,
      rows: [
        {
          companyId: "c1",
          companyName: "شركة الواحة",
          companyType: "customer",
          baseCurrency: "AED",
          revenue: 1,
          netProfit: 1,
          assets: 1,
          status: "included",
          statusLabel: "مضمّنة",
          reviewReason: "",
        },
      ],
    };
    const log = (over: Record<string, unknown>) => ({
      id: Math.random().toString(),
      userId: "u1",
      action: "journal.create_posted",
      entityType: "journal",
      entityId: "6d1f3c3e-86c2-4a6e-9a1c-0f0f0f0f0f0f",
      description: "Journal entry JE-1 posted on journal 6d1f3c3e-86c2-4a6e-9a1c-0f0f0f0f0f0f",
      createdAt: "2026-11-19T08:00:00.000Z",
      riskLevel: "Medium",
      actionLabel: "journal create posted",
      entityLabel: "journal",
      ...over,
    });
    const rows = [
      log({}),
      log({
        action: "invoice.status_change",
        entityType: "invoice",
        description: "Invoice INV-1 status changed",
        riskLevel: "Low",
      }),
    ];
    await renderTab("CloseTab", {
      auditTrailPeriodLabel: "آخر 200 حدث نشاط",
      auditTrailReport: {
        logCount: 2,
        highRiskCount: 0,
        postingActionCount: 1,
        userCount: 1,
        actionRows: [
          {
            key: "journal.create_posted",
            label: "journal create posted",
            count: 1,
            latestAt: rows[0].createdAt,
          },
        ],
        entityRows: [{ key: "journal", label: "journal", count: 1, latestAt: rows[0].createdAt }],
        rows,
      },
      consolidatedStatementsReport: consolidated,
      dateRange: { from: new Date("2026-11-01T00:00:00"), to: new Date("2026-11-30T00:00:00") },
      monthEndChecklist: [
        {
          id: 1,
          key: "bank",
          title: "Bank reconciliation complete",
          description: "All bank transactions for the period are reconciled",
          status: "incomplete",
          details: "2/4 reconciled (2 remaining)",
        },
        {
          id: 2,
          key: "vat",
          title: "VAT return prepared",
          description: "VAT 201 return has been prepared or filed for the period",
          status: "complete",
          details: "No VAT return due this month: the VAT period ends 2026-12-31",
        },
      ],
      monthEndCloseStatus: { periodStart: "2026-11-01", periodEnd: "2026-11-30", checklist: [] },
      monthEndCompletedChecks: 1,
      monthEndPeriod: "2026-11",
      monthEndPeriodLabel: "نوفمبر 2026",
      monthEndReadinessPercent: 50,
      monthEndReviewChecks: 1,
    });
    expect(englishLines()).toEqual([]);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(text).toContain("2/4");
    expect(text).toContain("31 ديسمبر 2026");
  });

  it("sales by product, overdue chasing and invoice status", async () => {
    await renderTab("SalesTab", {
      customerRevenue: [],
      invoiceStatusReport: {
        invoiceValueAed: 1,
        activeInvoiceCount: 1,
        unpaidCount: 1,
        overdueCurrency: "AED",
        overdueOutstanding: 1,
      },
      overdueCustomerRows: [
        {
          customerName: "شركة النور",
          currency: "AED",
          invoiceCount: 2,
          outstanding: 100,
          maxDaysOverdue: 12,
          recommendedLevel: 2,
        },
      ],
      productServiceSalesRows: [
        {
          productService: "[Credit] مراجعة التصميم",
          invoiceCount: 1,
          lineCount: 3,
          quantity: 3,
          amountAed: 100,
          vatAed: 5,
          averageUnitPriceAed: 33,
          supplyTypes: ["zero_rated", "standard_rated"],
        },
      ],
      productServiceTopShare: 28.4,
      receivableAgingRows: [],
      receivableAgingSummary: { current: 0, overdue: 0, over90: 0, total: 0 },
      reportInvoices: [
        {
          id: "i1",
          number: "INV-1",
          customerName: "شركة النور",
          date: "2026-11-18",
          dueDate: "2026-12-18",
          status: "sent",
          total: 100,
          currency: "AED",
        },
      ],
      statusSummary: [{ status: "sent", count: 1, amountAed: 100 }],
    });
    expect(englishLines()).toEqual([]);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/zero_rated|standard_rated|Nov|Dec/);
    expect(text).toContain("18 ديسمبر 2026");
  });

  it("expenses by vendor and category, claims", async () => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    await act(async () => useI18n.getState().setLocale("ar"));
    const { reportText } = await import("../../client/src/pages/reports/model/reportLabels");
    const line = {
      id: "x1",
      date: "2026-11-18",
      entryNumber: "JE-9",
      vendor: "اليد الذهبية",
      accountName: "مستلزمات المكتب",
      accountCode: "5200",
      source: "expense claim",
      debitAed: 50,
      creditAed: 0,
      netExpenseAed: 50,
    };
    const summary = [
      {
        label: "مستلزمات المكتب",
        entryCount: 1,
        lineCount: 1,
        debitAed: 50,
        creditAed: 0,
        netExpenseAed: 50,
      },
    ];
    await renderTab("ExpensesTab", {
      expenseReport: {
        basis: reportText("expenseBasis", "Posted journal lines ..."),
        totalAed: 50,
        subtotalAed: 50,
        vatAed: 0,
        unpostedReceipts: 1,
        autoPostedReceipts: 3,
        byVendor: summary,
        byCategory: summary,
        lines: [line],
        receiptCount: 1,
      },
      expenseClaimReport: {
        claimCount: 2,
        totalAmount: 100,
        submittedCount: 1,
        approvedUnpaidCount: 1,
        reviewCount: 2,
        statusRows: [
          { status: "submitted", count: 1, totalAmount: 50 },
          { status: "approved", count: 1, totalAmount: 50 },
        ],
        claims: [
          {
            id: "k1",
            title: "تدريب",
            claim_number: "EXP-1",
            status: "approved",
            created_at: "2026-11-19T08:00:00Z",
            submitted_at: "2026-11-19T08:00:00Z",
            total_amount: "50",
            currency: "AED",
          },
        ],
      },
    });
    expect(englishLines()).toEqual([]);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/expense claim|auto-posted|claims|submitted|approved|Nov/);
  });

  it("payroll summary", async () => {
    await renderTab("PayrollTab", {
      payrollReport: {
        runCount: 3,
        totalNet: 100,
        wpsReadyCount: 1,
        wpsMissingCount: 0,
        sifGeneratedCount: 1,
        approvedCount: 1,
        approvalQueueCount: 0,
        latestRun: { period_month: 11, period_year: 2026, approved_at: "2026-11-19T08:00:00Z" },
        statusRows: [{ status: "calculated", count: 2, employeeCount: 4, totalNet: 100 }],
        runs: [
          {
            id: "r1",
            period_month: 11,
            period_year: 2026,
            status: "paid",
            employee_count: 2,
            total_basic: "100",
            total_allowances: "0",
            total_deductions: "0",
            total_net: "100",
          },
        ],
      },
    });
    expect(englishLines()).toEqual([]);
    expect(container.textContent).not.toMatch(/Nov 2026|runs|employees|calculated|paid/);
  });

  it("budget vs actual and cash-flow forecast", async () => {
    await renderTab("PlanningTab", {
      planningReport: {
        budget: { name: "موازنة 2026", fiscalYear: 2026 },
        budgetTotal: 100,
        actualTotal: 90,
        variance: 10,
        variancePercent: 10,
        overBudgetLines: 0,
        largestVarianceLines: [],
        projections: [
          {
            week: 1,
            weekStart: "2026-11-23",
            weekEnd: "2026-11-29",
            expectedInflows: 1,
            expectedOutflows: 1,
            projectedBalance: 5,
          },
        ],
        projectedEndingBalance: 5,
        cashMovement: 0,
        cashWarning: "",
        insights: [],
      },
    });
    expect(englishLines()).toEqual([]);
    expect(container.textContent).not.toMatch(/Week|Nov/);
  });

  it("inventory, fixed assets and depreciation", async () => {
    const { calculateDepreciationScheduleRow } =
      await import("../../client/src/pages/reports/model/reportDocuments");
    const i18n = await import("../../client/src/lib/i18n");
    await act(async () => i18n.useI18n.getState().setLocale("ar"));
    const asset = {
      id: "f1",
      asset_name: "أجهزة المكتب",
      asset_number: "FA-1",
      serial_number: "",
      category: "الحواسيب",
      purchase_date: "2026-10-06",
      purchaseCost: 1200,
      salvageValue: 0,
      accumulatedDepreciation: 0,
      netBookValue: 1200,
      useful_life_years: 3,
      depreciation_method: "straight_line",
      status: "active",
    };
    const scheduleRow = calculateDepreciationScheduleRow(asset as never, new Date(2026, 10, 1));
    await renderTab("BalancesTab", {
      balanceReport: {
        customers: [],
        vendors: [],
        overdueCustomerCount: 0,
        overdueVendorCount: 0,
        customerOpenAed: 0,
        vendorOpenAed: 0,
        customerOverdueAed: 0,
        netBalanceAed: 0,
        generatedAt: "2026-11-19T08:00:00Z",
      },
      depreciationPeriodDate: new Date(2026, 10, 1),
      depreciationScheduleReport: {
        rows: [scheduleRow],
        reviewCount: 0,
        readyToPostCount: 1,
        periodDepreciationAed: 33,
        annualDepreciationAed: 400,
      },
      fixedAssetRegisterReport: {
        rows: [asset],
        totalAssets: 1,
        totalCost: 1200,
        totalNetBookValue: 1200,
        reviewCount: 0,
        byCategory: [{ category: "الحواسيب", count: 1, totalNetBookValue: 1200 }],
      },
      inventoryMovementReport: {
        movementCount: 2,
        inboundUnits: 3,
        outboundUnits: 1,
        totalMovementValueAed: 10,
        typeRows: [
          { type: "purchase", count: 1, quantity: 3, valueAed: 6 },
          { type: "stock count", count: 1, quantity: 1, valueAed: 4 },
        ],
        rows: [
          {
            id: "m1",
            createdAt: "2026-11-19T08:00:00Z",
            productName: "حزمة البداية",
            sku: "KIT-1",
            unit: "حبة",
            type: "sale",
            quantity: -1,
            unitCost: 4,
            valueAed: 4,
            reference: "Opening stock",
          },
        ],
      },
      inventoryValuationReport: {
        rows: [],
        totalStockValueAed: 0,
        reviewCount: 0,
        missingCostCount: 0,
        lowStockCount: 0,
        activeProductCount: 0,
      },
      payableAgingBuckets: [],
      payableAgingSummary: { billCount: 0 },
    });
    expect(englishLines()).toEqual([]);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(
      /movements|units|assets|straight line|active|Nov|Oct|Estimated depreciation/
    );
  });
});
