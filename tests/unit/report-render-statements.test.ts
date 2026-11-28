/**
 * Server report rendering (W5-A, R11-12, R12-09, R12-10) without a database.
 *
 * The reporting kernel and the VAT engine are stubbed with fixed results so each
 * statement builder, the PDF writer, the XLSX writer and the pack/zip builders run end to
 * end in both company languages. The DB suite (tests/db/report-statements-render.test.ts)
 * checks the figures against posted books; this suite checks the layout logic: section
 * rows, balance notes, GL truncation, aging reconciliation notes, coverage sheets and
 * formula-injection guarding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";

const state = vi.hoisted(() => ({
  balanced: true,
  vatThrows: false,
  locale: "en",
  // PDF font embedding is CPU-heavy; only the PDF layout test renders real PDFs, the pack
  // tests use a stub so this file does not starve parallel suites under coverage.
  realPdf: false,
}));

vi.mock("../../server/services/report-render/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/report-render/pdf")>();
  return {
    ...actual,
    buildReportPdf: vi.fn(async (...args: Parameters<typeof actual.buildReportPdf>) =>
      state.realPdf ? actual.buildReportPdf(...args) : Buffer.from("%PDF-stub")
    ),
  };
});

vi.mock("../../server/db", () => ({
  db: {},
  pool: {
    query: vi.fn(async () => ({
      rows: [
        {
          name: "=Acme Trading",
          legal_name: state.locale === "ar" ? null : "Acme Trading LLC",
          trn_vat_number: state.locale === "ar" ? null : "100000000000003",
          business_address: "Dubai",
          locale: state.locale,
        },
      ],
    })),
  },
}));

const section = (total: number) => ({
  total,
  lines: [
    { accountCode: "4000", accountName: "Sales", accountNameAr: "المبيعات", amount: total },
    { accountCode: "4010", accountName: "Other", accountNameAr: null, amount: 0 },
  ],
});

vi.mock("../../server/reporting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/reporting")>();
  const balanceSheet = async () => ({
    assets: { current: section(500), nonCurrent: section(250) },
    liabilities: { current: section(100), nonCurrent: section(50) },
    equity: {
      lines: [
        { accountCode: "3000", accountName: "Capital", accountNameAr: "رأس المال", amount: 400 },
        { accountCode: "3020", accountName: "Retained", accountNameAr: null, amount: 200 },
      ],
      capital: { total: 400 },
      retainedEarningsBroughtForward: 150,
      currentYearEarnings: 50,
      total: 600,
    },
    totalAssets: 750,
    totalLiabilities: 150,
    totalEquity: state.balanced ? 600 : 590,
    totalLiabilitiesAndEquity: 750,
    isBalanced: state.balanced,
    difference: state.balanced ? 0 : 10,
  });
  const aging = async ({ asOf }: { asOf: string }) => ({
    asOf,
    rows: [{ name: "Client", current: 10, days30: 20, days60: 0, days90: 0, over90: 5, total: 35 }],
    totals: { current: 10, days30: 20, days60: 0, days90: 0, over90: 5, total: 35 },
    reconciliation: {
      isReconciled: state.balanced,
      controlAccountCode: state.balanced ? "1200" : null,
      difference: state.balanced ? 0 : 3.5,
    },
    documents: [
      { number: "INV-1", name: "Client", daysPastDue: 40, open: 20 },
      { number: null, name: "Other", daysPastDue: 0, open: 10 },
      { number: "INV-3", name: "Late", daysPastDue: 95, open: 5 },
    ],
  });
  return {
    ...actual,
    loadCompany: vi.fn(async () => ({ fiscalYearStartMonth: 1 })),
    profitAndLoss: vi.fn(async () => ({
      sections: {
        revenue: section(1000),
        costOfSales: section(300),
        operatingExpenses: section(200),
        otherIncome: section(10),
        otherExpenses: section(5),
      },
      revenue: 1000,
      grossProfit: 700,
      operatingProfit: 500,
      netProfit: 505,
      totalIncome: 1010,
      totalExpenses: 505,
    })),
    balanceSheet: vi.fn(balanceSheet),
    trialBalance: vi.fn(async () => ({
      rows: [
        {
          accountCode: "1000",
          accountName: "Cash",
          accountNameAr: "النقد",
          debitBalance: 100,
          creditBalance: 0,
        },
        { accountCode: "4000", accountName: "Sales", debitBalance: 0, creditBalance: 100 },
      ],
      totals: { sumDebitBalances: 100, sumCreditBalances: 100, difference: state.balanced ? 0 : 1 },
      isBalanced: state.balanced,
    })),
    cashFlow: vi.fn(async () => {
      const part = (total: number) => ({
        total,
        breakdown: [{ accountCode: "1100", accountName: "Receivables", amount: total }],
      });
      return {
        openingCash: 100,
        operating: part(50),
        investing: part(-20),
        financing: part(10),
        netCashChange: 40,
        closingCash: 140,
        cashProof: { isBalanced: state.balanced, difference: state.balanced ? 0 : 2 },
        nonCashTransactions: [
          {
            entryId: "e9",
            entryNumber: "JE-9",
            date: "2026-02-17",
            memo: "Vehicle on finance",
            source: "manual",
            amount: 4500,
          },
        ],
      };
    }),
    generalLedger: vi.fn(async () => ({
      truncated: false,
      accounts: [1, 2].map((n) => ({
        accountCode: `100${n}`,
        accountName: `Account ${n}`,
        accountNameAr: n === 1 ? "الحساب الأول" : null,
        openingBalance: 0,
        debitTotal: 30,
        creditTotal: 10,
        closingBalance: 20,
        lines: [
          {
            date: "2026-01-02",
            entryNumber: "JE-1",
            description: "=SUM(A1)",
            debit: 30,
            credit: 0,
            balance: 30,
          },
          {
            date: "2026-01-03",
            entryNumber: "JE-2",
            description: null,
            memo: null,
            debit: 0,
            credit: 10,
            balance: 20,
          },
        ],
      })),
      totals: { debit: 60, credit: 20 },
    })),
    agedReceivables: vi.fn(aging),
    agedPayables: vi.fn(aging),
    cashAccounts: vi.fn(async () => [{ balance: 100.004 }, { balance: 40 }]),
  };
});

vi.mock("../../server/tax/vat-engine", () => ({
  computeVat201: vi.fn(async () => {
    if (state.vatThrows) throw new Error("no VAT setup");
    return {
      complete: state.balanced,
      issues: state.balanced ? [] : [{ code: "MISSING_TRN" }],
      boxes: {
        box1aAbuDhabiAmount: 100,
        box1aAbuDhabiVat: 5,
        box1bDubaiAmount: 200,
        box1bDubaiVat: 10,
        box3ReverseChargeAmount: 0,
        box3ReverseChargeVat: 0,
        box4ZeroRatedAmount: 50,
        box5ExemptAmount: 0,
        box9ExpensesAmount: 80,
        box9ExpensesVat: 4,
        box10ReverseChargeAmount: 0,
        box10ReverseChargeVat: 0,
        box12TotalDueTax: 15,
        box13RecoverableTax: 4,
        box14PayableTax: 11,
      },
    };
  }),
}));

import {
  bilingualDate,
  bilingualMoney,
  formatAmount,
  formatIsoDate,
  formatIsoDateAr,
  bilingualLabel,
  label,
  periodLabel,
} from "../../server/services/report-render/model";
import {
  STATEMENT_KINDS,
  computeChangesInEquity,
  computeExecutiveSummary,
  isStatementKind,
  loadRenderCompany,
  renderGeneralLedger,
  renderStatement,
} from "../../server/services/report-render/statements";
import { buildReportPdf } from "../../server/services/report-render/pdf";
import { generalLedger } from "../../server/reporting";
import { pdfToText } from "./pdf-test-helpers";
import { buildReportWorkbook, guardCell } from "../../server/services/report-render/xlsx";
import {
  CATALOG_STATEMENT_KIND,
  buildDeliveryPack,
  buildSharePackZip,
  buildStatementFile,
  withRenderLang,
  deliveryPeriod,
} from "../../server/services/report-render/pack";

const period = { from: "2026-01-01", to: "2026-03-31" };

beforeEach(() => {
  state.balanced = true;
  state.vatThrows = false;
  state.locale = "en";
  state.realPdf = false;
});

describe("report-render model helpers", () => {
  it("formats dates, periods, amounts and bilingual labels", () => {
    expect(formatIsoDate("2026-03-31")).toBe("31 Mar 2026");
    expect(formatIsoDate("bad")).toBe("bad");
    expect(periodLabel("2026-01-01", "2026-03-31")).toBe("1 Jan 2026 – 31 Mar 2026");
    expect(periodLabel(null, "2026-03-31")).toBe("As of 31 Mar 2026");
    expect(periodLabel("2026-01-01", "2026-03-31", "ar")).toBe("1 يناير 2026 – 31 مارس 2026");
    expect(periodLabel(null, "2026-03-31", "ar")).toBe("كما في 31 مارس 2026");
    expect(formatAmount(-1234.567)).toBe("-1,234.57");
    expect(formatAmount(0)).toBe("0.00");
    const t = { en: "Cash", ar: "النقد" };
    expect(label("en", t)).toBe("Cash");
    expect(label("ar", t)).toBe("النقد");
    expect(bilingualLabel("en", t)).toBe("Cash / النقد");
    expect(bilingualLabel("ar", t)).toBe("النقد / Cash");
  });

  it("formats note dates and money through the shared formatters (B12)", () => {
    expect(formatIsoDateAr("2026-11-18")).toBe("18 نوفمبر 2026");
    expect(bilingualDate("2026-11-17")).toEqual({ en: "17 Nov 2026", ar: "17 نوفمبر 2026" });
    expect(bilingualMoney(381160.85)).toEqual({ en: "AED 381,160.85", ar: "381,160.85 درهم" });
    expect(bilingualMoney(-3.5).en).toBe("-AED 3.50");
  });

  it("guards spreadsheet cells against formula injection", () => {
    expect(guardCell(null)).toBeNull();
    expect(guardCell(undefined)).toBeNull();
    expect(guardCell(12.5)).toBe(12.5);
    expect(guardCell(Number.NaN)).toBeNull();
    expect(guardCell("=1+1")).toBe("'=1+1");
    expect(guardCell("-5")).toBe("'-5");
    expect(guardCell("@cmd")).toBe("'@cmd");
    expect(guardCell("plain")).toBe("plain");
  });

  it("knows its statement kinds and catalog mapping", () => {
    expect(isStatementKind("profit-loss")).toBe(true);
    expect(isStatementKind("nope")).toBe(false);
    expect(isStatementKind(3)).toBe(false);
    for (const kind of Object.values(CATALOG_STATEMENT_KIND)) {
      expect(STATEMENT_KINDS).toContain(kind);
    }
  });

  it("derives delivery periods from cadence", () => {
    const midMonth = new Date("2026-03-15T08:00:00Z");
    expect(deliveryPeriod("weekly", midMonth)).toEqual({ from: "2026-03-01", to: "2026-03-15" });
    expect(deliveryPeriod("Monthly", midMonth)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    const monthEndDay = new Date("2026-03-31T08:00:00Z");
    expect(deliveryPeriod("tax deadline", monthEndDay)).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
  });
});

describe("statement builders", { timeout: 30_000 }, () => {
  for (const locale of ["en", "ar"] as const) {
    for (const balanced of [true, false]) {
      it(`renders every statement kind (${locale}, ${balanced ? "balanced" : "unbalanced"})`, async () => {
        state.balanced = balanced;
        state.locale = locale;
        const company = await loadRenderCompany("c1");
        expect(company.locale).toBe(locale);
        for (const kind of STATEMENT_KINDS) {
          const report = await renderStatement(kind, company, period);
          expect(report.id).toBe(kind);
          expect(report.tables.length).toBeGreaterThan(0);
          expect(report.tables[0].rows.length).toBeGreaterThan(0);
          expect(report.basis).toBe("ledger");
        }
        const pl = await renderStatement("profit-loss", company, period);
        const firstHeading = pl.tables[0].rows[0].cells.account;
        expect(firstHeading).toBe(locale === "ar" ? "الإيرادات" : "Revenue");
        const bs = await renderStatement("balance-sheet", company, period);
        expect(bs.notes[0].en).toMatch(balanced ? /^Balanced/ : /^Not balanced: difference AED 10/);
      });
    }
  }

  it("B12: statement footnotes print formatted dates and grouped money, never ISO or toFixed", async () => {
    const ISO = /\d{4}-\d{2}-\d{2}/;
    const UNGROUPED = /\d{4,}\.\d{2}/;
    for (const balanced of [true, false]) {
      state.balanced = balanced;
      for (const locale of ["en", "ar"] as const) {
        state.locale = locale;
        const company = await loadRenderCompany("c1");
        for (const kind of ["cash-flow", "changes-in-equity", "ar-aging", "ap-aging"] as const) {
          const report = await renderStatement(kind, company, period);
          for (const note of report.notes) {
            for (const text of [note.en, note.ar]) {
              expect(text, `${kind} ${locale}: ${text}`).not.toMatch(ISO);
              expect(text, `${kind} ${locale}: ${text}`).not.toMatch(UNGROUPED);
            }
          }
          if (kind === "changes-in-equity") {
            for (const row of report.tables[0].rows) {
              expect(String(row.cells.account ?? ""), kind).not.toMatch(ISO);
            }
          }
        }
      }
    }
    state.balanced = true;
    const company = await loadRenderCompany("c1");
    const cf = await renderStatement("cash-flow", company, period);
    const nonCash = cf.notes.find((n) => n.en.includes("IAS 7.43"))!;
    expect(nonCash.en).toContain("17 Feb 2026");
    expect(nonCash.en).toContain("AED 4,500.00");
    expect(nonCash.ar).toContain("17 فبراير 2026");
    expect(nonCash.ar).toContain("4,500.00 درهم");
    state.balanced = false;
    const aging = await renderStatement("ar-aging", company, period);
    expect(aging.notes[0].ar).toContain("31 مارس 2026");
    expect(aging.notes[0].en).toContain("AED 3.50");
  });

  it("P15: sentence-case totals, Latin ageing headers, Arabic GL account names", async () => {
    state.balanced = true;
    state.locale = "en";
    let company = await loadRenderCompany("c1");
    const pl = await renderStatement("profit-loss", company, period);
    const accounts = pl.tables[0].rows.map((r) => String(r.cells.account ?? ""));
    expect(accounts).toContain("Total revenue");
    expect(accounts.some((a) => /^Total [A-Z][a-z]/.test(a))).toBe(false);
    state.locale = "ar";
    company = await loadRenderCompany("c1");
    const aging = await renderStatement("ar-aging", company, period);
    const headers = aging.tables[0].columns.map((c) => c.header.ar).join(" ");
    expect(headers).toContain("1–30");
    expect(headers).not.toMatch(/[٠-٩]/);
    const totalRow = aging.tables[0].rows.find((r) => r.style === "total")!;
    expect(totalRow.cells.name).toBe("الإجمالي");
    const gl = await renderGeneralLedger(company, period);
    const glHeadings = gl.tables[0].rows
      .filter((r) => r.style === "heading")
      .map((r) => r.cells.description);
    expect(glHeadings).toEqual(["الحساب الأول", "Account 2"]);
    state.locale = "en";
  });

  it("truncates the general ledger at the PDF line cap", async () => {
    const company = await loadRenderCompany("c1");
    const capped = await renderGeneralLedger(company, period, { lineCap: 1 });
    expect(capped.notes[0].en).toMatch(/truncated/);
    const full = await renderGeneralLedger(company, period);
    expect(full.notes).toEqual([]);
  });

  it("never promises Excel has every line when the source ledger was truncated", async () => {
    const company = await loadRenderCompany("c1");
    const source = await generalLedger({ companyId: "c1", ...period });
    for (const lineCap of [undefined, 1]) {
      vi.mocked(generalLedger).mockResolvedValueOnce({ ...source, truncated: true });
      const { notes } = await renderGeneralLedger(company, period, { lineCap });
      expect(notes[0].en).toMatch(/both PDF and Excel/);
      expect(notes[0].ar).toContain("Excel");
      expect(notes.map((n) => n.en).join(" ")).not.toMatch(/every line\.$|workbook has every line/);
      expect(notes).toHaveLength(lineCap ? 2 : 1);
    }
  });

  it("ties the changes-in-equity statement to the balance sheet", async () => {
    const e = await computeChangesInEquity("c1", period);
    expect(e.closing.total).toBe(600);
    expect(e.profitForPeriod).toBe(505);
    expect(e.otherRetainedEarningsMovements).toBe(-505);
    expect(e.ties).toBe(true);
    state.balanced = false;
    expect((await computeChangesInEquity("c1", period)).ties).toBe(false);
  });

  it("summarises the executive view, including VAT unavailability", async () => {
    const s = await computeExecutiveSummary("c1", period);
    expect(s.cash).toBe(140);
    expect(s.overdueReceivables).toBe(25);
    expect(s.vatPayable).toBe(11);
    expect(s.topOverdue.map((d) => d.number)).toEqual(["INV-1", "INV-3"]);
    expect(s.corporateTaxBasis.from).toBe("2026-01-01");
    state.vatThrows = true;
    const company = await loadRenderCompany("c1");
    const r = await renderStatement("executive-summary", company, period);
    expect(r.notes.map((n) => n.en).join(" ")).toMatch(/VAT position unavailable/);
    state.vatThrows = false;
    state.balanced = false;
    const provisional = await renderStatement("executive-summary", company, period);
    expect(provisional.notes.map((n) => n.en).join(" ")).toMatch(/provisional/);
  });
});

// PDF font embedding and zip generation are CPU-heavy under coverage instrumentation.
describe("PDF, XLSX and packs", { timeout: 60_000 }, () => {
  it("writes a PDF and a workbook with a coverage sheet in both languages", async () => {
    for (const locale of ["en", "ar"] as const) {
      state.locale = locale;
      const company = await loadRenderCompany("c1");
      const reports = [];
      for (const kind of STATEMENT_KINDS)
        reports.push(await renderStatement(kind, company, period));
      state.realPdf = true;
      // Every kind once in English; Arabic only needs the RTL path on a couple of reports.
      const pdf = await buildReportPdf(company, locale === "en" ? reports : reports.slice(0, 2));
      state.realPdf = false;
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      const xlsx = await buildReportWorkbook(company, reports, {
        title: "Pack",
        coverage: [
          { reportId: "a", name: "=Bad", status: "rendered", basis: "ledger", link: null },
          {
            reportId: "b",
            name: "Indicator",
            status: "open_in_app",
            basis: "snapshot_proxy",
            link: "/reports?report=b",
          },
        ],
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx);
      const names = wb.worksheets.map((w) => w.name);
      const coverageName = locale === "ar" ? "التغطية" : "Coverage";
      expect(names).toContain(coverageName);
      expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
      const coverage = wb.getWorksheet(coverageName)!;
      expect(coverage.getRow(2).getCell(1).value).toBe("'=Bad");
      expect(wb.worksheets[0].views[0]?.rightToLeft ?? false).toBe(locale === "ar");
    }
  });

  it("builds statement files, a delivery pack and the accountant share zip", async () => {
    const pdf = await buildStatementFile({
      companyId: "c1",
      kind: "general-ledger",
      period,
      format: "pdf",
    });
    expect(pdf.filename).toBe("general-ledger-2026-03-31.pdf");
    const xlsx = await buildStatementFile({
      companyId: "c1",
      kind: "trial-balance",
      period,
      format: "xlsx",
    });
    expect(xlsx.contentType).toMatch(/spreadsheet/);

    const reportIds = [...Object.keys(CATALOG_STATEMENT_KIND), "not-a-report"];
    const pack = await buildDeliveryPack({
      companyId: "c1",
      title: "Owner pack / March",
      reportIds,
      period,
    });
    expect(pack.statementKinds[0]).toBe("executive-summary");
    expect(pack.files.map((f) => f.filename)).toEqual([
      "Owner-pack-March-2026-03-31.pdf",
      "Owner-pack-March-2026-03-31.xlsx",
    ]);
    expect(pack.coverage.every((c) => c.status === "rendered")).toBe(true);

    const zip = await buildSharePackZip({ companyId: "c1", period });
    expect(zip.entries).toContain("financial-pack.pdf");
    const opened = await JSZip.loadAsync(zip.content);
    expect(Object.keys(opened.files)).toContain("xlsx/profit-loss.xlsx");
  });

  // Step 1 / E3: the reader picks the document language; it defaults to the company's own.
  describe("E3: statement language choice", () => {
    const cells = (report: Awaited<ReturnType<typeof renderStatement>>) =>
      report.tables.flatMap((table) => table.rows.map((row) => row.cells));
    const accounts = async (lang: "en" | "ar", companyLocale: "en" | "ar") => {
      state.locale = companyLocale;
      const company = withRenderLang(await loadRenderCompany("c1"), lang);
      expect(company.locale).toBe(lang);
      const report = await renderStatement("trial-balance", company, period);
      return { report, names: cells(report).map((row) => String(row.account ?? "")) };
    };

    it("renders the same figures in either language, whatever the company's language", async () => {
      const en = await accounts("en", "ar");
      const ar = await accounts("ar", "en");
      expect(ar.names).toContain("النقد");
      expect(en.names).toContain("Cash");
      expect(ar.names).not.toContain("Cash");
      const figures = (report: typeof en.report) =>
        cells(report).map((row) => [row.debit, row.credit, row.balance]);
      expect(figures(ar.report)).toEqual(figures(en.report));
    });

    it("withRenderLang keeps the company when no language is asked for", async () => {
      state.locale = "ar";
      const company = await loadRenderCompany("c1");
      expect(withRenderLang(company)).toBe(company);
      expect(withRenderLang(company, "ar")).toBe(company);
      expect(withRenderLang(company, "en").locale).toBe("en");
    });

    it("an Arabic PDF of an English company has an Arabic-first title and period", async () => {
      state.locale = "en";
      state.realPdf = true;
      const pdf = await buildStatementFile({
        companyId: "c1",
        kind: "profit-loss",
        period,
        format: "pdf",
        lang: "ar",
      });
      state.realPdf = false;
      const text = await pdfToText(pdf.content);
      expect(text).toContain("المبيعات");
      // pdftotext reads an RTL line in pieces, so check the Arabic month names and the absence of
      // the English ones rather than one whole date.
      expect(text).toContain("يناير");
      expect(text).toContain("مارس");
      expect(text).not.toMatch(/\b(Jan|Mar|Revenue)\b/);
    });

    it("an English PDF of an Arabic company reads in English", async () => {
      state.locale = "ar";
      state.realPdf = true;
      const pdf = await buildStatementFile({
        companyId: "c1",
        kind: "profit-loss",
        period,
        format: "pdf",
        lang: "en",
      });
      state.realPdf = false;
      const text = await pdfToText(pdf.content);
      expect(text).toMatch(/Revenue/);
      expect(text).toMatch(/1 Jan 2026/);
    });

    it("the statement XLSX follows the requested language and direction", async () => {
      state.locale = "en";
      const ar = await buildStatementFile({
        companyId: "c1",
        kind: "trial-balance",
        period,
        format: "xlsx",
        lang: "ar",
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(ar.content);
      expect(wb.worksheets[0].views[0]?.rightToLeft).toBe(true);
      expect(wb.worksheets[0].name).toMatch(/[؀-ۿ]/);
      const en = await buildStatementFile({
        companyId: "c1",
        kind: "trial-balance",
        period,
        format: "xlsx",
      });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(en.content);
      expect(wb2.worksheets[0].views[0]?.rightToLeft ?? false).toBe(false);
    });
  });
});
