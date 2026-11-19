/**
 * Step 1 / E1, E2, S5: report Excel exports follow the language of the user who exports.
 *
 * The export builders (client/src/lib/export.ts) run with the app locale set to Arabic and to
 * English; the sheets are then written to a real XLSX through the server's generic workbook
 * service and read back. For an Arabic user every sheet name, heading, label, status code, date
 * and account name is Arabic and the sheet is right-to-left; an English user gets English,
 * left-to-right sheets. Figures never change with the language. User data (customer names,
 * descriptions, document numbers) is left as the user typed it.
 */
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  coerceExportSheets,
  formatDateForExport,
  prepareAgingReportsForExport,
  prepareAuditTrailForExport,
  prepareBalanceSheetForExport,
  prepareBalanceSummaryReportsForExport,
  prepareCashFlowStatementForExport,
  prepareConsolidatedStatementsForExport,
  prepareCorporateTaxEstimateForExport,
  prepareCostCenterProfitabilityForExport,
  prepareExpenseReportsForExport,
  prepareFxGainsLossesForExport,
  prepareInvoiceStatusForExport,
  prepareLedgerReportsForExport,
  prepareMonthEndCloseStatusForExport,
  preparePayrollReportsForExport,
  preparePeriodComparisonForExport,
  preparePlanningReportsForExport,
  prepareProfitLossForExport,
  prepareTrialBalanceForExport,
  prepareVATSummaryForExport,
  type ExportData,
} from "../../client/src/lib/export";
import {
  currentExportLocale,
  localizeExportSheetsWith,
  type ExportLocale,
} from "../../client/src/lib/export-localize";
import { EXPORT_AR } from "../../client/src/lib/export-ar";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { buildGenericWorkbook } from "../../server/services/excel-export.service";

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

const setLocale = (locale: ExportLocale) => useI18n.setState({ locale });

/** Text the user typed: never translated, so it may stay Latin in an Arabic workbook. */
const USER_DATA = new Set([
  "Acme LLC",
  "Sales Desk",
  "Cash at Bank",
  "Mohammed Trading",
  "INV-2026-001",
  "JE-0001",
  "Laptop Pro",
  "Delivery van",
  "Hamdan Supplies",
  "Operations",
  "Annual budget 2026",
  "Group Holdings LLC",
  "Branch One LLC",
  "alice@example.com",
  "user-1",
  "TRN-100",
  "SKU-1",
  "PO-1",
  "Dubai",
  "Claim 1",
  "CLM-1",
  "Bank charge",
  "Office rent",
  "Ledger memo text",
  "Net 30",
  "Bank Transfer",
  "FA-1",
  "AED",
  "USD",
  "ea",
  "straight_line",
  "payload",
  "/financial-statements",
  "Q2",
  "CC1",
  "Vehicles",
  "Rent",
  "Other Income",
  "Capital",
  // Text an unknown server sentence carries unchanged (shown as stored, like the Close tab).
  "Custom check",
  "Payload",
  // Strings the report models hand to the builders already in the user's language (audit labels,
  // consolidation period); in this fixture they are plain English stand-ins.
  "Invoice created",
  "Invoice",
  "June 2026",
]);

/** Technical terms that stay Latin in Arabic text (SIF files, WPS, TRN, SKU). */
const ACRONYMS = /\b(SIF|WPS|TRN|SKU)\b/g;

const latin = /[A-Za-z]{2,}/;
const hasLatin = (text: string) => latin.test(text.replace(ACRONYMS, ""));

function* strings(sheets: ExportData[]): Generator<{ where: string; text: string }> {
  for (const sheet of sheets) {
    if (sheet.sheetName) yield { where: `${sheet.sheetName} / name`, text: sheet.sheetName };
    for (const column of sheet.columns) {
      yield { where: `${sheet.sheetName} / header ${column.key}`, text: column.header };
    }
    for (const row of sheet.rows) {
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "string") yield { where: `${sheet.sheetName} / ${key}`, text: value };
      }
    }
  }
}

const ctx = {
  accounts: {
    revenue: [
      { accountCode: "4000", accountName: "Sales", accountNameAr: "المبيعات", amount: 1000 },
      { accountCode: "4100", accountName: "Other Income", accountNameAr: null, amount: 50 },
    ],
  },
};

function profitLoss() {
  return {
    revenue: ctx.accounts.revenue,
    expenses: [
      { accountCode: "5000", accountName: "Rent", accountNameAr: "الإيجار", amount: 300.5 },
    ],
    totalRevenue: 1050,
    totalExpenses: 300.5,
    netProfit: 749.5,
  };
}

function balanceSheet() {
  return {
    assets: [{ accountCode: "1000", accountName: "Cash", accountNameAr: "النقد", amount: 900 }],
    liabilities: [
      { accountCode: "2000", accountName: "Payables", accountNameAr: "الدائنون", amount: 100 },
    ],
    equity: [
      { accountCode: "3000", accountName: "Capital", accountNameAr: "رأس المال", amount: 800 },
    ],
    totalAssets: 900,
    totalLiabilities: 100,
    totalEquity: 800,
  };
}

function trialBalance() {
  return {
    rows: [
      {
        accountCode: "1000",
        accountName: "Cash",
        accountNameAr: "النقد",
        accountType: "asset",
        totalDebit: 900,
        totalCredit: 0,
        balance: 900,
        hasForeignLines: true,
      },
      {
        accountCode: "3000",
        accountName: "Capital",
        accountNameAr: null,
        accountType: "equity",
        totalDebit: 0,
        totalCredit: 800,
        balance: -800,
        hasForeignLines: false,
      },
    ],
    totals: { sumDebits: 900, sumCredits: 800, difference: 100 },
  };
}

const vatSummary = () => ({
  period: { from: "2026-07-01", to: "2026-09-30" },
  salesSubtotal: 1000,
  salesVAT: 50,
  purchasesSubtotal: 400,
  purchasesVAT: 20,
  netVATPayable: 30,
});

const stamp = "2026-06-16T10:00:00.000Z";

function allSheets(): ExportData[] {
  return [
    prepareProfitLossForExport(profitLoss()),
    prepareBalanceSheetForExport(balanceSheet()),
    prepareTrialBalanceForExport(trialBalance()),
    prepareVATSummaryForExport(vatSummary()),
    prepareCostCenterProfitabilityForExport({
      costCenters: [
        {
          code: "CC1",
          name: "Operations",
          isActive: true,
          totalIncome: 10,
          totalExpenses: 4,
          netIncome: 6,
          lineCount: 2,
        },
      ],
      totals: { activeCostCenterCount: 1, costCenterCount: 2, totalIncome: 10 },
    }),
    ...prepareCorporateTaxEstimateForExport({
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      totalRevenue: 1000,
      totalExpenses: 400,
      taxPayable: 12.5,
      taxableIncome: 600,
      taxRate: 0.09,
    }),
    ...prepareCashFlowStatementForExport([
      { period: "2026-06", operatingInflow: 12000, endingBalance: 25000, netCashFlow: 5000 },
    ]),
    ...prepareAgingReportsForExport({
      receivables: [{ name: "Acme LLC", type: "receivable", current: 100, total: 100 }],
      payables: { current: { amount: 400, count: 1 }, days_90_plus: { amount: 25, count: 1 } },
    }),
    preparePeriodComparisonForExport([
      {
        label: "Revenue",
        current: 12000,
        previous: 10000,
        delta: 2000,
        percentChange: 20,
        signal: "",
      },
    ]),
    ...prepareFxGainsLossesForExport({
      asOf: "2026-06-17",
      receivables: [
        {
          entityType: "invoice",
          entityNumber: "INV-2026-001",
          counterparty: "Acme LLC",
          currency: "USD",
          foreignAmount: 1000,
          unrealizedGainLoss: 142.45,
        },
      ],
      payables: [],
    }),
    ...prepareInvoiceStatusForExport({
      statusSummary: [{ status: "paid", count: 2, amountAed: 500 }],
      customerRevenue: [{ customerName: "Acme LLC", invoiceCount: 2, amountAed: 500 }],
      productServiceRows: [
        {
          productService: "Laptop Pro",
          invoiceCount: 1,
          lineCount: 1,
          quantity: 1,
          amountAed: 500,
          vatAed: 25,
          averageUnitPriceAed: 500,
          supplyTypes: ["standard_rated", "zero_rated"],
        },
      ],
      overdueCustomerRows: [
        {
          customerName: "Acme LLC",
          currency: "AED",
          invoiceCount: 1,
          outstanding: 10,
          maxDaysOverdue: 40,
          recommendedLevel: 2,
        },
      ],
      invoices: [
        {
          number: "INV-2026-001",
          customerName: "Acme LLC",
          date: "2026-06-01",
          dueDate: "2026-07-01",
          status: "overdue",
          currency: "AED",
          total: 105,
        },
      ],
    }),
    ...prepareExpenseReportsForExport({
      byVendor: [{ label: "Hamdan Supplies", entryCount: 1, lineCount: 1, debitAed: 10 }],
      byCategory: [{ label: "Office rent", entryCount: 1, lineCount: 1, debitAed: 10 }],
      basis: "",
      claims: {
        claims: [
          {
            claim_number: "CLM-1",
            title: "Claim 1",
            status: "approved",
            created_at: "2026-06-01",
            total_amount: 10,
          },
        ],
      },
      lines: [
        {
          entryNumber: "JE-0001",
          date: "2026-06-01",
          vendor: "",
          accountName: "Rent",
          accountCode: "5000",
          source: "bill_payment",
          debitAed: 10,
        },
      ],
    }),
    ...preparePayrollReportsForExport({
      statusRows: [{ status: "approved", count: 1, employeeCount: 3, totalNet: 100 }],
      runs: [
        {
          period_month: 6,
          period_year: 2026,
          status: "calculated",
          employee_count: 3,
          sif_file_content: "x",
          approved_at: stamp,
        },
      ],
    }),
    ...prepareLedgerReportsForExport({
      totalDebit: 10,
      totalCredit: 10,
      accountActivity: [
        {
          accountCode: "1000",
          accountName: "النقد",
          accountType: "asset",
          lineCount: 2,
          lastActivity: "2026-06-01",
        },
      ],
      sourceRows: [{ source: "bill_payment", needsReview: true }, {}],
      lines: [
        {
          date: "2026-06-01",
          entryNumber: "JE-0001",
          accountCode: "1000",
          accountName: "النقد",
          accountType: "asset",
          memo: "Ledger memo text",
          source: "invoice",
          debit: 10,
          hasForeignCurrency: true,
        },
      ],
    }),
    ...prepareMonthEndCloseStatusForExport({
      period: "2026-06",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      readinessPercent: 50,
      checklist: [
        {
          id: 1,
          title: "Bank reconciliation complete",
          status: "complete",
          description: "All bank transactions for the period are reconciled",
          details: "",
        },
        { id: 2, title: "Custom check", status: "review", description: "Payload" },
      ],
    }),
    ...prepareAuditTrailForExport({
      latestLog: { createdAt: stamp },
      actionRows: [{ label: "Invoice created", count: 1, latestAt: stamp }],
      entityRows: [{ label: "Invoice", count: 1, latestAt: stamp }],
      rows: [
        {
          createdAt: stamp,
          actionLabel: "Invoice created",
          entityLabel: "Invoice",
          riskLevel: "Medium",
          userId: "user-1",
        },
      ],
    }),
    ...prepareConsolidatedStatementsForExport({
      periodLabel: "June 2026",
      rows: [
        {
          companyName: "Branch One LLC",
          companyType: "customer",
          status: "included",
          statusLabel: "",
          revenue: 10,
        },
      ],
    }),
    ...preparePlanningReportsForExport({
      budget: { name: "Annual budget 2026" },
      cashWarning: "",
      budgetPlans: [
        {
          name: "Annual budget 2026",
          fiscal_year: 2026,
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          status: "approved",
          total_budget: 900000,
        },
      ],
      varianceLines: [
        {
          category: "Payroll",
          description: "",
          totals: { budget: 384000, actual: 83800, variance: 300200, variancePercent: 78.2 },
        },
        {
          category: "Technology",
          description: "",
          totals: { budget: 60000, actual: 14500, variance: -45500, variancePercent: -75.8 },
        },
      ],
      projections: [{ week: 1, weekStart: "2026-06-01", weekEnd: "2026-06-07" }],
      insights: [],
    }),
    ...prepareBalanceSummaryReportsForExport({
      generatedAt: stamp,
      customers: [{ name: "Acme LLC", currency: "AED", invoiceCount: 1 }],
      vendors: [{ name: "Hamdan Supplies", currency: "AED", billCount: 1 }],
      inventory: {
        rows: [
          {
            name: "Laptop Pro",
            sku: "SKU-1",
            unit: "ea",
            isActive: true,
            isNegativeStock: true,
          },
        ],
        movementRows: [
          { createdAt: stamp, productName: "Laptop Pro", sku: "SKU-1", type: "purchase" },
        ],
        movementTypeRows: [{ type: "purchase", count: 1, quantity: 1, valueAed: 1 }],
      },
      fixedAssets: {
        rows: [
          {
            asset_name: "Delivery van",
            asset_number: "FA-1",
            category: "",
            purchase_date: "2026-01-02",
            status: "active",
            needs_capitalization_je: true,
          },
        ],
        byCategory: [{ category: "", count: 1 }],
        depreciation: {
          period: "2026-06",
          rows: [
            {
              assetName: "Delivery van",
              assetNumber: "FA-1",
              category: "Vehicles",
              purchaseDate: "2026-01-02",
              method: "straight_line",
              status: "active",
            },
          ],
        },
      },
    }),
  ];
}

const FIGURE = /^-?\d+(\.\d+)?%?$/;
const figures = (sheets: ExportData[]) =>
  sheets.map((sheet) =>
    sheet.rows.map((row) =>
      Object.entries(row)
        .filter(([, v]) => (typeof v === "number" ? true : typeof v === "string" && FIGURE.test(v)))
        .map(([k, v]) => `${k}=${v}`)
    )
  );

describe("E1: report Excel exports in the exporting user's language", () => {
  it("Arabic user: every label, heading, code and date is Arabic and the sheet is right-to-left", () => {
    setLocale("ar");
    expect(currentExportLocale()).toBe("ar");
    const sheets = localizeExportSheetsWith(allSheets(), "ar", EXPORT_AR);
    const leftovers = [...strings(sheets)].filter(
      ({ text }) => hasLatin(text) && !USER_DATA.has(text)
    );
    expect(leftovers).toEqual([]);
    expect(sheets.every((sheet) => sheet.rtl === true)).toBe(true);
    // Excel allows 31 characters per sheet name.
    expect(sheets.every((sheet) => (sheet.sheetName ?? "").length <= 31)).toBe(true);
    expect(new Set(sheets.map((sheet) => sheet.sheetName)).size).toBe(
      new Set(allSheets().map((sheet) => sheet.sheetName)).size
    );
  });

  it("Arabic ledger export renders the stored memo key (not a text guess) when the line carries one", () => {
    setLocale("ar");
    // A memo text no pattern matcher knows: only the stored key can make it Arabic.
    const ledger = (memoKey: string | null) =>
      prepareLedgerReportsForExport({
        lines: [
          {
            date: "2026-06-01",
            entryNumber: "JE-0002",
            memo: "Custom wording the matcher cannot parse",
            memoKey,
            memoParams: { ref: "INV-7", party: "Acme" },
            source: "invoice",
            debit: 10,
          },
        ],
      }).find((sheet) => sheet.sheetName === "Ledger Detail")!;
    expect(ledger("salesInvoice").rows[0].memo).toBe("فاتورة مبيعات INV-7 - Acme");
    expect(ledger(null).rows[0].memo).toBe("Custom wording the matcher cannot parse");
    setLocale("en");
    expect(ledger("salesInvoice").rows[0].memo).toBe("Custom wording the matcher cannot parse");
  });

  it("English user: English labels, no Arabic, left-to-right", () => {
    setLocale("en");
    const sheets = localizeExportSheetsWith(allSheets(), "en", EXPORT_AR);
    expect(sheets.some((sheet) => sheet.rtl)).toBe(false);
    const arabic = [...strings(sheets)].filter(({ text }) => /[؀-ۿ]/.test(text));
    // Only data the user stored in Arabic (an Arabic account name) may be Arabic.
    expect(arabic.map((entry) => entry.text).filter((text) => text !== "النقد")).toEqual([]);
    expect(sheets[0].sheetName).toBe("Profit & Loss");
    expect(sheets[0].columns.map((c) => c.header)).toEqual(["Account", "Code", "Amount (AED)"]);
  });

  it("figures are identical in both languages", () => {
    setLocale("en");
    const en = figures(allSheets());
    setLocale("ar");
    const ar = figures(localizeExportSheetsWith(allSheets(), "ar", EXPORT_AR));
    expect(ar).toEqual(en);
    expect(en.flat(2).length).toBeGreaterThan(80);
  });

  it("maps codes (equity, asset, paid, source) to catalog labels", () => {
    setLocale("ar");
    const [tb] = localizeExportSheetsWith(
      [prepareTrialBalanceForExport(trialBalance())],
      "ar",
      EXPORT_AR
    );
    const types = tb.rows.map((row) => row.type);
    expect(types[0]).not.toBe("asset");
    expect(types[1]).not.toBe("equity");
    expect(types[0]).toMatch(/[؀-ۿ]/);
    expect(types[1]).toMatch(/[؀-ۿ]/);
    expect(tb.rows[0].foreignCurrency).toBe("نعم");
    expect(tb.columns[0].header).toBe("الرمز");
  });

  it("account names follow the user's language in P&L, balance sheet and trial balance", () => {
    setLocale("ar");
    const pl = prepareProfitLossForExport(profitLoss());
    expect(pl.rows.find((row) => row.code === "4000")?.account).toBe("المبيعات");
    // No Arabic name stored: the English name is kept rather than blanked.
    expect(pl.rows.find((row) => row.code === "4100")?.account).toBe("Other Income");
    expect(
      prepareBalanceSheetForExport(balanceSheet()).rows.find((row) => row.code === "1000")?.account
    ).toBe("النقد");
    expect(prepareTrialBalanceForExport(trialBalance()).rows[0].account).toBe("النقد");
    setLocale("en");
    expect(
      prepareProfitLossForExport(profitLoss()).rows.find((r) => r.code === "4000")?.account
    ).toBe("Sales");
  });

  it("dates are localised and calendar-safe", () => {
    setLocale("en");
    expect(formatDateForExport("2026-11-01")).toBe("01 Nov 2026");
    // A stored period end on the UTC day boundary stays on its own calendar day.
    expect(formatDateForExport("2026-09-30T23:59:59.999Z")).toBe("30 Sep 2026");
    setLocale("ar");
    expect(formatDateForExport("2026-11-01")).toBe("1 نوفمبر 2026");
    expect(formatDateForExport("2026-09-30T23:59:59.999Z")).toBe("30 سبتمبر 2026");
    const [sheet] = localizeExportSheetsWith(
      prepareMonthEndCloseStatusForExport({
        period: "2026-06",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        checklist: [],
      }),
      "ar",
      EXPORT_AR
    );
    const byLabel = Object.fromEntries(sheet.rows.map((row) => [row.metric, row.value]));
    expect(byLabel["بداية الفترة"]).toBe("1 يونيو 2026");
    expect(byLabel["الفترة"]).toBe("يونيو 2026");
  });

  it("month-end checks use the same Arabic sentences as the Close tab", () => {
    setLocale("ar");
    const sheets = localizeExportSheetsWith(
      prepareMonthEndCloseStatusForExport({
        period: "2026-06",
        checklist: [
          {
            id: 1,
            title: "Unreconciled bank transactions",
            status: "review",
            description: "Reconcile bank activity",
            details: "",
          },
        ],
      }),
      "ar",
      EXPORT_AR
    );
    const checklist = sheets.find((sheet) => sheet.rows.length && "title" in sheet.rows[0])!;
    expect(checklist.rows[0].status).toBe("يحتاج إلى مراجعة");
  });

  it("audit trail sheets use the Audit trail screen's Arabic action, record and sentence labels", () => {
    const report = {
      actionRows: [{ key: "invoice.create", label: "invoice create", count: 1, latestAt: stamp }],
      entityRows: [{ key: "invoice", label: "invoice", count: 1, latestAt: stamp }],
      rows: [
        {
          createdAt: stamp,
          action: "invoice.create",
          actionLabel: "invoice create",
          entityType: "invoice",
          entityLabel: "invoice",
          description: "Invoice INV-2026-001 created",
          riskLevel: "Low",
        },
      ],
    };
    setLocale("ar");
    const ar = localizeExportSheetsWith(prepareAuditTrailForExport(report), "ar", EXPORT_AR);
    const byName = Object.fromEntries(ar.map((sheet) => [sheet.sheetName, sheet.rows]));
    expect(byName["إجراءات التدقيق"][0].action).toBe("أُنشئت فاتورة");
    expect(byName["كيانات التدقيق"][0].entity).toBe("فاتورة");
    const detail = byName["تفاصيل سجل التدقيق"][0];
    expect(detail.action).toBe("أُنشئت فاتورة");
    expect(detail.description).toBe("أُنشئت الفاتورة INV-2026-001");
    expect(detail.risk).toBe("منخفض");
    setLocale("en");
    const en = prepareAuditTrailForExport(report);
    expect(en[3].rows[0]).toMatchObject({
      action: "invoice create",
      description: "Invoice INV-2026-001 created",
    });
  });

  it("budget variance status follows the screen rule: an income line under target is not over budget", () => {
    setLocale("en");
    const sheet = preparePlanningReportsForExport({
      varianceLines: [
        { category: "Revenue", accountType: "income", totals: { budget: 100, actual: 40 } },
        { category: "Marketing", accountType: "expense", totals: { budget: 100, actual: 140 } },
        { category: "Rent", accountType: "expense", totals: { budget: 100, actual: 90 } },
      ],
    }).find((s) => s.sheetName === "Budget Variance")!;
    expect(sheet.rows.map((row) => row.status)).toEqual([
      "Within budget",
      "Over budget",
      "Within budget",
    ]);
  });

  it("S5: budget categories are Arabic for an Arabic user and unchanged for others", () => {
    setLocale("ar");
    const planning = preparePlanningReportsForExport({
      varianceLines: [
        { category: "Payroll", totals: { variance: 1 } },
        { category: "Technology", totals: { variance: -1 } },
        { category: "Marketing", totals: { variance: 1 } },
        { category: "Custom: Hospitality", totals: { variance: 1 } },
      ],
    });
    const variance = planning.find((sheet) => sheet.sheetName === "Budget Variance")!;
    expect(variance.rows.map((row) => row.category)).toEqual([
      "الرواتب",
      "التقنية",
      "التسويق",
      "Custom: Hospitality",
    ]);
    setLocale("en");
    const en = preparePlanningReportsForExport({
      varianceLines: [{ category: "Payroll", totals: { variance: 1 } }],
    }).find((sheet) => sheet.sheetName === "Budget Variance")!;
    expect(en.rows[0].category).toBe("Payroll");
  });
});

describe("E2: VAT summary period is text, never [object Object]", () => {
  it("writes the period as a formatted range in both languages", () => {
    setLocale("en");
    const en = prepareVATSummaryForExport(vatSummary());
    expect(en.rows[0]).toEqual({ description: "Period", amount: "1 Jul – 30 Sep 2026" });
    setLocale("ar");
    const ar = prepareVATSummaryForExport(vatSummary());
    expect(ar.rows[0].amount).toBe("1 يوليو – 30 سبتمبر 2026");
    for (const row of [en.rows[0], ar.rows[0]]) expect(String(row.amount)).not.toContain("object");
  });

  it("still accepts a plain string period and an empty one", () => {
    setLocale("en");
    expect(prepareVATSummaryForExport({ period: "Q3 2026" }).rows[0].amount).toBe("Q3 2026");
    expect(prepareVATSummaryForExport({}).rows[0].amount).toBe("");
    expect(prepareVATSummaryForExport({ period: { from: "2026-07-01" } }).rows[0].amount).toBe(
      "1 Jul 2026"
    );
  });
});

describe("E1: the downloaded XLSX", () => {
  const open = async (sheets: ExportData[]) => {
    const buffer = await buildGenericWorkbook(coerceExportSheets(sheets) as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    return wb;
  };

  it("Arabic workbook: Arabic sheet names and headings, right-to-left, numbers stay numbers", async () => {
    setLocale("ar");
    const wb = await open(
      localizeExportSheetsWith(
        [
          prepareProfitLossForExport(profitLoss()),
          prepareVATSummaryForExport(vatSummary()),
          prepareTrialBalanceForExport(trialBalance()),
        ],
        "ar",
        EXPORT_AR
      )
    );
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual([
      "الأرباح والخسائر",
      "ملخص ضريبة القيمة المضافة",
      "ميزان المراجعة",
    ]);
    for (const sheet of wb.worksheets) expect(sheet.views[0]?.rightToLeft).toBe(true);
    const pl = wb.worksheets[0];
    expect(pl.getRow(1).values).toEqual([undefined, "الحساب", "الرمز", "المبلغ (درهم)"]);
    const texts: string[] = [];
    pl.eachRow((row) => row.eachCell((cell) => texts.push(String(cell.value))));
    expect(texts).toContain("المبيعات");
    expect(texts).toContain("إجمالي الإيرادات");
    expect(pl.getRow(3).getCell(3).value).toBe(1000);
    const vat = wb.worksheets[1];
    expect(vat.getRow(2).getCell(2).value).toBe("1 يوليو – 30 سبتمبر 2026");
  });

  it("English workbook: English, left-to-right, same figures", async () => {
    setLocale("en");
    const wb = await open([
      prepareProfitLossForExport(profitLoss()),
      prepareVATSummaryForExport(vatSummary()),
    ]);
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual(["Profit & Loss", "VAT Summary"]);
    for (const sheet of wb.worksheets) expect(sheet.views[0]?.rightToLeft).toBeFalsy();
    expect(wb.worksheets[0].getRow(3).getCell(3).value).toBe(1000);
    expect(wb.worksheets[1].getRow(2).getCell(2).value).toBe("1 Jul – 30 Sep 2026");
  });
});
