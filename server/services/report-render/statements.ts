/**
 * Statement builders (W5-A, R11-12, R12-09): server/reporting results → RenderedReport.
 *
 * Every figure comes from the reporting kernel (server/reporting) or the VAT engine; this
 * file only arranges rows and labels. The statement of changes in equity is built from two
 * balance sheets and the period P&L, so its closing column ties to the balance sheet by
 * construction (and the tie is asserted in tests/db/report-statements-render.test.ts).
 */
import { pool } from "../../db";
import {
  addDays,
  agedPayables,
  agedReceivables,
  balanceSheet,
  cashAccounts,
  cashFlow,
  fiscalYearStart,
  generalLedger,
  loadCompany,
  profitAndLoss,
  trialBalance,
  type AgingReport,
  type BalanceSheet,
  type StatementSection,
} from "../../reporting";
import { computeVat201 } from "../../tax/vat-engine";
import {
  computeCtLiability,
  CT_STANDARD_RATE,
  CT_ZERO_RATE_BAND,
} from "../../../shared/ct-workpaper";
import {
  bilingualDate,
  bilingualMoney,
  formatIsoDate,
  label,
  periodLabel,
  type Bilingual,
  type RenderColumn,
  type RenderCompany,
  type RenderRow,
  type RenderedReport,
} from "./model";

const L = {
  account: { en: "Account", ar: "الحساب" },
  code: { en: "Code", ar: "الرمز" },
  amount: { en: "Amount (AED)", ar: "المبلغ (درهم)" },
  debit: { en: "Debit", ar: "مدين" },
  credit: { en: "Credit", ar: "دائن" },
  balance: { en: "Balance", ar: "الرصيد" },
  date: { en: "Date", ar: "التاريخ" },
  entry: { en: "Entry", ar: "القيد" },
  description: { en: "Description", ar: "البيان" },
  name: { en: "Name", ar: "الاسم" },
  current: { en: "Current", ar: "غير مستحق" },
  // P15: Latin digits, like every amount and date in the document (one digit system).
  d30: { en: "1–30 days", ar: "1–30 يومًا" },
  d60: { en: "31–60 days", ar: "31–60 يومًا" },
  d90: { en: "61–90 days", ar: "61–90 يومًا" },
  over90: { en: "Over 90 days", ar: "أكثر من 90 يومًا" },
  total: { en: "Total", ar: "الإجمالي" },
  item: { en: "Item", ar: "البند" },
  value: { en: "Value", ar: "القيمة" },
} satisfies Record<string, Bilingual>;

export const STATEMENT_TITLES = {
  "profit-loss": { en: "Profit and loss", ar: "قائمة الأرباح والخسائر" },
  "balance-sheet": { en: "Balance sheet", ar: "الميزانية العمومية" },
  "trial-balance": { en: "Trial balance", ar: "ميزان المراجعة" },
  "cash-flow": { en: "Cash flow statement", ar: "قائمة التدفقات النقدية" },
  "general-ledger": { en: "General ledger", ar: "دفتر الأستاذ العام" },
  "ar-aging": { en: "Aged receivables", ar: "أعمار الذمم المدينة" },
  "ap-aging": { en: "Aged payables", ar: "أعمار الذمم الدائنة" },
  "changes-in-equity": {
    en: "Statement of changes in equity",
    ar: "قائمة التغيرات في حقوق الملكية",
  },
  "executive-summary": { en: "Executive summary", ar: "الملخص التنفيذي" },
  "vat-summary": {
    en: "VAT return summary (VAT 201)",
    ar: "ملخص الإقرار الضريبي (ضريبة القيمة المضافة 201)",
  },
} satisfies Record<string, Bilingual>;

export type StatementKind = keyof typeof STATEMENT_TITLES;
export const STATEMENT_KINDS = Object.keys(STATEMENT_TITLES) as StatementKind[];

export function isStatementKind(value: unknown): value is StatementKind {
  return typeof value === "string" && value in STATEMENT_TITLES;
}

export interface StatementPeriod {
  from: string;
  to: string;
}

const amountColumns = (extra: RenderColumn[] = []): RenderColumn[] => [
  { key: "code", header: L.code, weight: 0.6 },
  { key: "account", header: L.account, weight: 2.6 },
  ...extra,
  { key: "amount", header: L.amount, numeric: true, weight: 1.2 },
];

function heading(text: Bilingual, locale: "en" | "ar"): RenderRow {
  return { cells: { account: locale === "ar" ? text.ar : text.en }, style: "heading" };
}

function sectionRows(
  section: StatementSection,
  title: Bilingual,
  locale: "en" | "ar",
  sign = 1
): RenderRow[] {
  return [
    heading(title, locale),
    ...section.lines.map((line) => ({
      cells: {
        code: line.accountCode,
        account: locale === "ar" && line.accountNameAr ? line.accountNameAr : line.accountName,
        amount: sign * line.amount,
      },
    })),
    {
      cells: {
        // P15: sentence case ("Total revenue", "Total current assets"); acronyms ("VAT") stay.
        account: locale === "ar" ? `إجمالي ${title.ar}` : `Total ${lowerFirstWord(title.en)}`,
        amount: sign * section.total,
      },
      style: "subtotal" as const,
    },
  ];
}

/** "Revenue" -> "revenue", "Cost of sales" -> "cost of sales"; "VAT" and "UAE" are kept. */
export function lowerFirstWord(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

function totalRow(text: Bilingual, amount: number, locale: "en" | "ar"): RenderRow {
  return { cells: { account: locale === "ar" ? text.ar : text.en, amount }, style: "total" };
}

function balanceNote(isBalanced: boolean, difference: number): Bilingual {
  return isBalanced
    ? { en: "Balanced.", ar: "متوازن." }
    : {
        en: `Not balanced: difference ${bilingualMoney(difference).en}. Review before relying on it.`,
        ar: `غير متوازن: الفرق ${bilingualMoney(difference).ar}. راجِع قبل الاعتماد عليه.`,
      };
}

export async function loadRenderCompany(companyId: string): Promise<RenderCompany> {
  const { rows } = await pool.query(
    `SELECT id, name, legal_name, trn_vat_number, business_address, locale
       FROM companies WHERE id = $1`,
    [companyId]
  );
  const row = rows[0] ?? {};
  return {
    id: companyId,
    name: row.name ?? "Company",
    legalName: row.legal_name ?? null,
    trn: row.trn_vat_number ?? null,
    address: row.business_address ?? null,
    locale: row.locale === "ar" ? "ar" : "en",
  };
}

export async function renderProfitAndLoss(
  company: RenderCompany,
  p: StatementPeriod
): Promise<RenderedReport> {
  const pl = await profitAndLoss({ companyId: company.id, from: p.from, to: p.to });
  const loc = company.locale;
  const rows: RenderRow[] = [
    ...sectionRows(pl.sections.revenue, { en: "Revenue", ar: "الإيرادات" }, loc),
    ...sectionRows(pl.sections.costOfSales, { en: "Cost of sales", ar: "تكلفة المبيعات" }, loc),
    totalRow({ en: "Gross profit", ar: "مجمل الربح" }, pl.grossProfit, loc),
    ...sectionRows(
      pl.sections.operatingExpenses,
      { en: "Operating expenses", ar: "المصروفات التشغيلية" },
      loc
    ),
    totalRow({ en: "Operating profit", ar: "الربح التشغيلي" }, pl.operatingProfit, loc),
    ...sectionRows(pl.sections.otherIncome, { en: "Other income", ar: "إيرادات أخرى" }, loc),
    ...sectionRows(pl.sections.otherExpenses, { en: "Other expenses", ar: "مصروفات أخرى" }, loc),
    // A3 (H3): profit before tax, then income tax expense (IAS 1.82(d), IAS 12.77).
    totalRow(
      { en: "Profit before tax", ar: "الربح قبل الضريبة" },
      pl.profitBeforeTax ?? pl.netProfit,
      loc
    ),
    ...(pl.sections.incomeTax
      ? sectionRows(
          pl.sections.incomeTax,
          { en: "Income tax expense", ar: "مصروف ضريبة الدخل" },
          loc
        )
      : []),
    totalRow({ en: "Net profit", ar: "صافي الربح" }, pl.netProfit, loc),
    // A3 (H11): other comprehensive income and total comprehensive income (IAS 1.81A).
    ...(pl.sections.otherComprehensiveIncome
      ? sectionRows(
          pl.sections.otherComprehensiveIncome,
          {
            en: "Other comprehensive income (items not reclassified to profit or loss)",
            ar: "الدخل الشامل الآخر (بنود لا يعاد تصنيفها إلى الربح أو الخسارة)",
          },
          loc
        )
      : []),
    totalRow(
      { en: "Total comprehensive income", ar: "إجمالي الدخل الشامل" },
      pl.totalComprehensiveIncome ?? pl.netProfit,
      loc
    ),
  ];
  return {
    id: "profit-loss",
    title: STATEMENT_TITLES["profit-loss"],
    period: periodLabel(p.from, p.to, company.locale),
    basis: "ledger",
    tables: [{ columns: amountColumns(), rows }],
    notes: [],
  };
}

function balanceSheetRows(bs: BalanceSheet, loc: "en" | "ar"): RenderRow[] {
  return [
    ...sectionRows(bs.assets.current, { en: "Current assets", ar: "الأصول المتداولة" }, loc),
    ...sectionRows(
      bs.assets.nonCurrent,
      { en: "Non-current assets", ar: "الأصول غير المتداولة" },
      loc
    ),
    totalRow({ en: "Total assets", ar: "إجمالي الأصول" }, bs.totalAssets, loc),
    ...sectionRows(
      bs.liabilities.current,
      { en: "Current liabilities", ar: "الالتزامات المتداولة" },
      loc
    ),
    ...sectionRows(
      bs.liabilities.nonCurrent,
      { en: "Non-current liabilities", ar: "الالتزامات غير المتداولة" },
      loc
    ),
    totalRow({ en: "Total liabilities", ar: "إجمالي الالتزامات" }, bs.totalLiabilities, loc),
    heading({ en: "Equity", ar: "حقوق الملكية" }, loc),
    ...bs.equity.lines.map((line) => ({
      cells: {
        code: line.accountCode,
        account: loc === "ar" && line.accountNameAr ? line.accountNameAr : line.accountName,
        amount: line.amount,
      },
    })),
    totalRow({ en: "Total equity", ar: "إجمالي حقوق الملكية" }, bs.totalEquity, loc),
    totalRow(
      { en: "Total liabilities and equity", ar: "إجمالي الالتزامات وحقوق الملكية" },
      bs.totalLiabilitiesAndEquity,
      loc
    ),
  ];
}

export async function renderBalanceSheet(
  company: RenderCompany,
  asOf: string
): Promise<RenderedReport> {
  const bs = await balanceSheet({ companyId: company.id, asOf });
  return {
    id: "balance-sheet",
    title: STATEMENT_TITLES["balance-sheet"],
    period: periodLabel(null, asOf, company.locale),
    basis: "ledger",
    tables: [{ columns: amountColumns(), rows: balanceSheetRows(bs, company.locale) }],
    notes: [balanceNote(bs.isBalanced, bs.difference)],
  };
}

export async function renderTrialBalance(
  company: RenderCompany,
  p: StatementPeriod
): Promise<RenderedReport> {
  const tb = await trialBalance({ companyId: company.id, from: p.from, to: p.to });
  const loc = company.locale;
  const rows: RenderRow[] = tb.rows.map((r) => ({
    cells: {
      code: r.accountCode,
      account: loc === "ar" && r.accountNameAr ? r.accountNameAr : r.accountName,
      debit: r.debitBalance,
      credit: r.creditBalance,
    },
  }));
  rows.push({
    cells: {
      account: loc === "ar" ? "الإجمالي" : "Total",
      debit: tb.totals.sumDebitBalances,
      credit: tb.totals.sumCreditBalances,
    },
    style: "total",
  });
  return {
    id: "trial-balance",
    title: STATEMENT_TITLES["trial-balance"],
    period: periodLabel(p.from, p.to, company.locale),
    basis: "ledger",
    tables: [
      {
        columns: [
          { key: "code", header: L.code, weight: 0.6 },
          { key: "account", header: L.account, weight: 2.6 },
          { key: "debit", header: L.debit, numeric: true, weight: 1.1 },
          { key: "credit", header: L.credit, numeric: true, weight: 1.1 },
        ],
        rows,
      },
    ],
    notes: [balanceNote(tb.isBalanced, tb.totals.difference)],
  };
}

export async function renderCashFlow(
  company: RenderCompany,
  p: StatementPeriod
): Promise<RenderedReport> {
  const cf = await cashFlow({ companyId: company.id, from: p.from, to: p.to, method: "indirect" });
  const loc = company.locale;
  const block = (
    title: Bilingual,
    part: { total: number; breakdown: typeof cf.operating.breakdown }
  ) => [
    heading(title, loc),
    ...part.breakdown.map((line) => ({
      cells: {
        code: line.accountCode,
        account: loc === "ar" && line.accountNameAr ? line.accountNameAr : line.accountName,
        amount: line.amount,
      },
    })),
    {
      cells: {
        account: loc === "ar" ? `صافي ${title.ar}` : `Net ${title.en.toLowerCase()}`,
        amount: part.total,
      },
      style: "subtotal" as const,
    },
  ];
  const rows: RenderRow[] = [
    totalRow({ en: "Opening cash", ar: "النقد الافتتاحي" }, cf.openingCash, loc),
    ...block({ en: "Operating activities", ar: "الأنشطة التشغيلية" }, cf.operating),
    ...block({ en: "Investing activities", ar: "الأنشطة الاستثمارية" }, cf.investing),
    ...block({ en: "Financing activities", ar: "الأنشطة التمويلية" }, cf.financing),
    // A3 (C5): IAS 7.28, shown apart from operating, investing and financing.
    totalRow(
      { en: "Effect of exchange-rate changes on cash", ar: "أثر تغيرات أسعار الصرف على النقد" },
      cf.fxEffect?.total ?? 0,
      loc
    ),
    totalRow({ en: "Net change in cash", ar: "صافي التغير في النقد" }, cf.netCashChange, loc),
    totalRow({ en: "Closing cash", ar: "النقد الختامي" }, cf.closingCash, loc),
  ];
  return {
    id: "cash-flow",
    title: STATEMENT_TITLES["cash-flow"],
    period: periodLabel(p.from, p.to, company.locale),
    basis: "ledger",
    tables: [{ columns: amountColumns(), rows }],
    notes: [
      cf.cashProof.isBalanced
        ? {
            en: "Cash proof agrees to the cash and bank accounts.",
            ar: "إثبات النقد يطابق حسابات النقد والبنوك.",
          }
        : {
            en: `Cash proof difference ${bilingualMoney(cf.cashProof.difference).en}.`,
            ar: `فرق إثبات النقد ${bilingualMoney(cf.cashProof.difference).ar}.`,
          },
      // B2 (NC2): IAS 7.43 disclosure of investing / financing transactions that used no cash.
      ...(cf.nonCashTransactions ?? []).map((n) => ({
        en: `Non-cash transaction excluded from the statement (IAS 7.43): ${bilingualDate(n.date).en} ${n.entryNumber ?? ""} ${n.memo ?? ""} ${bilingualMoney(n.amount).en}.`.replace(
          /\s+/g,
          " "
        ),
        ar: `معاملة غير نقدية مستبعدة من القائمة (معيار المحاسبة الدولي 7.43): ${bilingualDate(n.date).ar} ${n.entryNumber ?? ""} ${bilingualMoney(n.amount).ar}.`.replace(
          /\s+/g,
          " "
        ),
      })),
    ],
  };
}

/** PDF output caps the GL at this many lines; the XLSX always has every line. */
export const GL_PDF_LINE_CAP = 4000;

export async function renderGeneralLedger(
  company: RenderCompany,
  p: StatementPeriod,
  opts: { lineCap?: number } = {}
): Promise<RenderedReport> {
  const gl = await generalLedger({ companyId: company.id, from: p.from, to: p.to });
  const cap = opts.lineCap ?? Number.POSITIVE_INFINITY;
  const rows: RenderRow[] = [];
  let lineCount = 0;
  let truncated = gl.truncated;
  for (const account of gl.accounts) {
    rows.push({
      cells: {
        date: account.accountCode,
        // P15: the Arabic general ledger names accounts in Arabic when the chart has a name.
        description:
          company.locale === "ar" && account.accountNameAr
            ? account.accountNameAr
            : account.accountName,
        balance: account.openingBalance,
      },
      style: "heading",
    });
    for (const line of account.lines) {
      if (lineCount >= cap) {
        truncated = true;
        break;
      }
      lineCount += 1;
      rows.push({
        cells: {
          date: line.date,
          entry: line.entryNumber,
          description: line.description ?? line.memo ?? "",
          debit: line.debit,
          credit: line.credit,
          balance: line.balance,
        },
      });
    }
    rows.push({
      cells: {
        description: company.locale === "ar" ? "الرصيد الختامي" : "Closing balance",
        debit: account.debitTotal,
        credit: account.creditTotal,
        balance: account.closingBalance,
      },
      style: "subtotal",
    });
  }
  rows.push({
    cells: {
      description: company.locale === "ar" ? "الإجمالي" : "Total",
      debit: gl.totals.debit,
      credit: gl.totals.credit,
    },
    style: "total",
  });
  return {
    id: "general-ledger",
    title: STATEMENT_TITLES["general-ledger"],
    period: periodLabel(p.from, p.to, company.locale),
    basis: "ledger",
    tables: [
      {
        columns: [
          { key: "date", header: L.date, weight: 0.9 },
          { key: "entry", header: L.entry, weight: 0.9 },
          { key: "description", header: L.description, weight: 2.4 },
          { key: "debit", header: L.debit, numeric: true },
          { key: "credit", header: L.credit, numeric: true },
          { key: "balance", header: L.balance, numeric: true },
        ],
        rows,
      },
    ],
    notes: truncated
      ? [
          {
            en: "Line listing truncated in this PDF; the Excel workbook has every line.",
            ar: "تم اختصار القائمة في ملف PDF؛ يحتوي ملف Excel على جميع البنود.",
          },
        ]
      : [],
  };
}

function agingReport(
  kind: "ar-aging" | "ap-aging",
  report: AgingReport,
  locale: "en" | "ar"
): RenderedReport {
  const rows: RenderRow[] = report.rows.map((r) => ({
    cells: {
      name: r.name,
      current: r.current,
      days30: r.days30,
      days60: r.days60,
      days90: r.days90,
      over90: r.over90,
      total: r.total,
    },
  }));
  rows.push({ cells: { name: label(locale, L.total), ...report.totals }, style: "total" });
  const rec = report.reconciliation;
  // A3 (H6, H1): reconciling items between the document aging and the control account.
  if (report.unappliedCredits) {
    rows.push({
      cells: {
        name: "Less unapplied credits / ناقص الأرصدة الدائنة غير المخصصة",
        total: -report.unappliedCredits,
      },
    });
  }
  for (const item of rec.reconcilingItems ?? []) {
    rows.push({ cells: { name: `${item.label} / ${item.labelAr}`, total: item.amount } });
  }
  rows.push({
    cells: {
      name: `GL ${rec.controlAccountCode ?? ""} balance / رصيد الأستاذ العام`,
      total: rec.glBalance,
    },
    style: "subtotal",
  });
  if (report.allowanceForDoubtfulDebts) {
    rows.push({
      cells: {
        name: "Less allowance for doubtful debts / ناقص مخصص الديون المشكوك في تحصيلها",
        total: -report.allowanceForDoubtfulDebts,
      },
    });
    rows.push({
      cells: {
        name: "Net trade receivables / صافي الذمم المدينة التجارية",
        total: report.netCarryingAmount,
      },
      style: "total",
    });
  }
  return {
    id: kind,
    title: STATEMENT_TITLES[kind],
    period: periodLabel(null, report.asOf, company.locale),
    basis: "ledger",
    tables: [
      {
        columns: [
          { key: "name", header: L.name, weight: 2.2 },
          { key: "current", header: L.current, numeric: true },
          { key: "days30", header: L.d30, numeric: true },
          { key: "days60", header: L.d60, numeric: true },
          { key: "days90", header: L.d90, numeric: true },
          { key: "over90", header: L.over90, numeric: true },
          { key: "total", header: L.total, numeric: true },
        ],
        rows,
      },
    ],
    notes: [
      rec.isReconciled
        ? {
            en: `Reconstructed as of ${formatIsoDate(report.asOf)}; agrees to GL ${rec.controlAccountCode ?? ""}.`,
            ar: `أُعيد بناؤه في ${bilingualDate(report.asOf).ar}؛ يطابق حساب الأستاذ ${rec.controlAccountCode ?? ""}.`,
          }
        : {
            en: `Reconstructed as of ${formatIsoDate(report.asOf)}; differs from GL ${rec.controlAccountCode ?? ""} by ${bilingualMoney(rec.difference).en}.`,
            ar: `أُعيد بناؤه في ${bilingualDate(report.asOf).ar}؛ يختلف عن حساب الأستاذ بمبلغ ${bilingualMoney(rec.difference).ar}.`,
          },
    ],
  };
}

export async function renderAgedReceivables(company: RenderCompany, asOf: string) {
  return agingReport(
    "ar-aging",
    await agedReceivables({ companyId: company.id, asOf }),
    company.locale
  );
}

export async function renderAgedPayables(company: RenderCompany, asOf: string) {
  return agingReport(
    "ap-aging",
    await agedPayables({ companyId: company.id, asOf }),
    company.locale
  );
}

// ─── Statement of changes in equity ──────────────────────────────────────────

export interface EquityComponents {
  capital: number;
  /** A3 (H11): revaluation / OCI reserve, a separate component (IAS 1.106(d)). */
  revaluationReserve: number;
  retainedEarnings: number;
  total: number;
}

export interface ChangesInEquity {
  from: string;
  to: string;
  opening: EquityComponents;
  profitForPeriod: number;
  /** A3 (H11): other comprehensive income for the period (revaluation surplus via OCI). */
  otherComprehensiveIncome: number;
  /** profitForPeriod + otherComprehensiveIncome. */
  totalComprehensiveIncome: number;
  /** Movements in share capital / owner accounts (never the revaluation reserve). */
  capitalMovements: number;
  /** Reserve movements that are not OCI: realised surplus transferred to retained earnings. */
  reserveTransfers: number;
  /** Retained-earnings movements other than profit (dividends, transfers, prior-year items). */
  otherRetainedEarningsMovements: number;
  closing: EquityComponents;
  /** Closing total equity on the balance sheet at `to` (the tie-out). */
  balanceSheetTotalEquity: number;
  ties: boolean;
}

function equityOf(bs: BalanceSheet): EquityComponents {
  const retained =
    bs.equity.retainedEarningsBroughtForward +
    (bs.equity.retainedEarningsMovements ?? 0) +
    bs.equity.currentYearEarnings;
  return {
    capital: round2(bs.equity.capital.total),
    revaluationReserve: round2(bs.equity.reserves?.total ?? 0),
    retainedEarnings: round2(retained),
    total: round2(bs.equity.total),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Opening equity = balance sheet the day before `from`; closing = balance sheet at `to`.
 * Profit for the period comes from the P&L; capital movements are the change in capital
 * accounts; anything else in retained earnings (dividends, postings to 3020, prior-year
 * adjustments) is shown as "other movements" so the statement always reconciles.
 */
export async function computeChangesInEquity(
  companyId: string,
  p: StatementPeriod
): Promise<ChangesInEquity> {
  const [openingBs, closingBs, pl] = await Promise.all([
    balanceSheet({ companyId, asOf: addDays(p.from, -1) }),
    balanceSheet({ companyId, asOf: p.to }),
    profitAndLoss({ companyId, from: p.from, to: p.to }),
  ]);
  const opening = equityOf(openingBs);
  const closing = equityOf(closingBs);
  const profitForPeriod = round2(pl.netProfit);
  const otherComprehensiveIncome = round2(pl.otherComprehensiveIncome ?? 0);
  const capitalMovements = round2(closing.capital - opening.capital);
  // Reserve movements that are not OCI move to retained earnings (IAS 16.41).
  const reserveTransfers = round2(
    closing.revaluationReserve - opening.revaluationReserve - otherComprehensiveIncome
  );
  const otherRetainedEarningsMovements = round2(
    closing.retainedEarnings - opening.retainedEarnings - profitForPeriod
  );
  const recomputed = round2(
    opening.total +
      profitForPeriod +
      otherComprehensiveIncome +
      capitalMovements +
      reserveTransfers +
      otherRetainedEarningsMovements
  );
  return {
    from: p.from,
    to: p.to,
    opening,
    profitForPeriod,
    otherComprehensiveIncome,
    totalComprehensiveIncome: round2(profitForPeriod + otherComprehensiveIncome),
    capitalMovements,
    reserveTransfers,
    otherRetainedEarningsMovements,
    closing,
    balanceSheetTotalEquity: round2(closingBs.totalEquity),
    ties: Math.abs(recomputed - round2(closingBs.totalEquity)) < 0.005,
  };
}

export async function renderChangesInEquity(
  company: RenderCompany,
  p: StatementPeriod
): Promise<RenderedReport> {
  const e = await computeChangesInEquity(company.id, p);
  const loc = company.locale;
  const row = (
    text: Bilingual,
    capital: number,
    reserve: number,
    retained: number,
    style?: RenderRow["style"]
  ): RenderRow => ({
    cells: {
      item: loc === "ar" ? text.ar : text.en,
      capital,
      reserve,
      retained,
      total: round2(capital + reserve + retained),
    },
    style,
  });
  return {
    id: "changes-in-equity",
    title: STATEMENT_TITLES["changes-in-equity"],
    period: periodLabel(p.from, p.to, company.locale),
    basis: "ledger",
    tables: [
      {
        columns: [
          { key: "item", header: L.item, weight: 2.4 },
          { key: "capital", header: { en: "Share capital", ar: "رأس المال" }, numeric: true },
          {
            key: "reserve",
            header: { en: "Revaluation reserve", ar: "احتياطي إعادة التقييم" },
            numeric: true,
          },
          {
            key: "retained",
            header: { en: "Retained earnings", ar: "الأرباح المحتجزة" },
            numeric: true,
          },
          {
            key: "total",
            header: { en: "Total equity", ar: "إجمالي حقوق الملكية" },
            numeric: true,
          },
        ],
        rows: [
          row(
            {
              en: `Balance at ${formatIsoDate(addDays(p.from, -1))}`,
              ar: `الرصيد في ${bilingualDate(addDays(p.from, -1)).ar}`,
            },
            e.opening.capital,
            e.opening.revaluationReserve ?? 0,
            e.opening.retainedEarnings,
            "subtotal"
          ),
          row({ en: "Profit for the period", ar: "ربح الفترة" }, 0, 0, e.profitForPeriod),
          row(
            {
              en: "Other comprehensive income (revaluation surplus)",
              ar: "الدخل الشامل الآخر (فائض إعادة التقييم)",
            },
            0,
            e.otherComprehensiveIncome ?? 0,
            0
          ),
          row(
            { en: "Total comprehensive income", ar: "إجمالي الدخل الشامل" },
            0,
            e.otherComprehensiveIncome ?? 0,
            e.profitForPeriod,
            "subtotal"
          ),
          row(
            { en: "Capital introduced / (withdrawn)", ar: "رأس المال المضاف / (المسحوب)" },
            e.capitalMovements,
            0,
            0
          ),
          row(
            {
              en: "Revaluation surplus realised and transferred",
              ar: "فائض إعادة التقييم المحقق والمحول",
            },
            0,
            e.reserveTransfers ?? 0,
            0
          ),
          row(
            { en: "Other movements in retained earnings", ar: "حركات أخرى في الأرباح المحتجزة" },
            0,
            0,
            e.otherRetainedEarningsMovements
          ),
          row(
            { en: `Balance at ${formatIsoDate(p.to)}`, ar: `الرصيد في ${bilingualDate(p.to).ar}` },
            e.closing.capital,
            e.closing.revaluationReserve ?? 0,
            e.closing.retainedEarnings,
            "total"
          ),
        ],
      },
    ],
    notes: [
      e.ties
        ? {
            en: `Closing equity agrees to the balance sheet (${bilingualMoney(e.balanceSheetTotalEquity).en}).`,
            ar: `حقوق الملكية الختامية تطابق الميزانية العمومية (${bilingualMoney(e.balanceSheetTotalEquity).ar}).`,
          }
        : {
            en: "Closing equity does not agree to the balance sheet; review unbalanced entries.",
            ar: "حقوق الملكية الختامية لا تطابق الميزانية العمومية؛ راجِع القيود غير المتوازنة.",
          },
    ],
  };
}

// ─── VAT 201 summary ─────────────────────────────────────────────────────────

export async function renderVatSummary(
  company: RenderCompany,
  p: StatementPeriod
): Promise<RenderedReport> {
  const vat = await computeVat201({
    companyId: company.id,
    from: p.from,
    to: p.to,
    allowIncomplete: true,
  });
  const b = vat.boxes;
  const sum = (keys: string[]) =>
    keys.reduce((s, k) => s + Number((b as Record<string, number>)[k] ?? 0), 0);
  const box1Amount = sum(Object.keys(b).filter((k) => /^box1[a-g].*Amount$/.test(k)));
  const box1Vat = sum(Object.keys(b).filter((k) => /^box1[a-g].*Vat$/.test(k)));
  const line = (label: Bilingual, amount: number | null, vatAmount: number | null): RenderRow => ({
    cells: { item: company.locale === "ar" ? label.ar : label.en, amount, vat: vatAmount },
  });
  return {
    id: "vat-summary",
    title: STATEMENT_TITLES["vat-summary"],
    period: periodLabel(p.from, p.to, company.locale),
    basis: "ledger",
    tables: [
      {
        columns: [
          { key: "item", header: L.item, weight: 2.6 },
          { key: "amount", header: L.amount, numeric: true },
          { key: "vat", header: { en: "VAT (AED)", ar: "الضريبة (درهم)" }, numeric: true },
        ],
        rows: [
          line(
            {
              en: "Box 1: standard-rated supplies",
              ar: "المربع 1: التوريدات الخاضعة للنسبة الأساسية",
            },
            box1Amount,
            box1Vat
          ),
          line(
            {
              en: "Box 3: reverse charge supplies",
              ar: "المربع 3: التوريدات الخاضعة للاحتساب العكسي",
            },
            b.box3ReverseChargeAmount,
            b.box3ReverseChargeVat
          ),
          line(
            { en: "Box 4: zero-rated supplies", ar: "المربع 4: التوريدات الخاضعة للنسبة الصفرية" },
            b.box4ZeroRatedAmount,
            null
          ),
          line(
            { en: "Box 5: exempt supplies", ar: "المربع 5: التوريدات المعفاة" },
            b.box5ExemptAmount,
            null
          ),
          line(
            {
              en: "Box 9: standard-rated expenses",
              ar: "المربع 9: المصروفات الخاضعة للنسبة الأساسية",
            },
            b.box9ExpensesAmount,
            b.box9ExpensesVat
          ),
          line(
            {
              en: "Box 10: reverse charge recoverable",
              ar: "المربع 10: الاحتساب العكسي القابل للاسترداد",
            },
            b.box10ReverseChargeAmount,
            b.box10ReverseChargeVat
          ),
          {
            cells: {
              item:
                company.locale === "ar"
                  ? "المربع 12: إجمالي الضريبة المستحقة"
                  : "Box 12: total due tax",
              vat: b.box12TotalDueTax,
            },
            style: "subtotal",
          },
          {
            cells: {
              item:
                company.locale === "ar"
                  ? "المربع 13: الضريبة القابلة للاسترداد"
                  : "Box 13: recoverable tax",
              vat: b.box13RecoverableTax,
            },
            style: "subtotal",
          },
          {
            cells: {
              item:
                company.locale === "ar"
                  ? "المربع 14: صافي الضريبة المستحقة"
                  : "Box 14: payable tax",
              vat: b.box14PayableTax,
            },
            style: "total",
          },
        ],
      },
    ],
    notes: [
      vat.complete
        ? {
            en: "Computed by the VAT engine from posted documents.",
            ar: "محسوب بواسطة محرك الضريبة من المستندات المرحّلة.",
          }
        : {
            en: `Incomplete: ${vat.issues.filter((i) => i.severity !== "warning").length} document issue(s) must be fixed before filing.`,
            ar: `غير مكتمل: يجب معالجة ${vat.issues.filter((i) => i.severity !== "warning").length} مشكلة في المستندات قبل التقديم.`,
          },
      {
        en: "Not filed with the FTA from this report.",
        ar: "لم يتم تقديمه إلى الهيئة الاتحادية للضرائب من هذا التقرير.",
      },
    ],
  };
}

// ─── Executive summary ───────────────────────────────────────────────────────

export interface ExecutiveSummary {
  from: string;
  to: string;
  revenue: number;
  netProfit: number;
  cash: number;
  receivables: number;
  overdueReceivables: number;
  payables: number;
  overduePayables: number;
  vatPayable: number | null;
  vatComplete: boolean;
  corporateTaxEstimate: number;
  corporateTaxBasis: { from: string; to: string };
  topOverdue: Array<{ number: string | null; name: string; daysPastDue: number; open: number }>;
}

export async function computeExecutiveSummary(
  companyId: string,
  p: StatementPeriod
): Promise<ExecutiveSummary> {
  const settings = await loadCompany(companyId);
  const fyStart = fiscalYearStart(p.to, settings.fiscalYearStartMonth);
  const [pl, ytd, cash, ar, ap] = await Promise.all([
    profitAndLoss({ companyId, from: p.from, to: p.to }),
    profitAndLoss({ companyId, from: fyStart, to: p.to }),
    cashAccounts(companyId, p.to),
    agedReceivables({ companyId, asOf: p.to }),
    agedPayables({ companyId, asOf: p.to }),
  ]);
  let vatPayable: number | null = null;
  let vatComplete = false;
  try {
    const vat = await computeVat201({ companyId, from: p.from, to: p.to, allowIncomplete: true });
    vatPayable = vat.boxes.box14PayableTax;
    vatComplete = vat.complete;
  } catch {
    vatPayable = null;
  }
  const ct = computeCtLiability({
    totalRevenue: Math.max(0, ytd.totalIncome),
    // A3 (H3): estimate on profit before tax, so a posted CT provision is not deducted.
    totalExpenses: Math.max(0, ytd.totalExpenses - (ytd.incomeTaxExpense ?? 0)),
    exemptionThreshold: CT_ZERO_RATE_BAND,
    taxRate: CT_STANDARD_RATE,
  });
  const overdue = (r: AgingReport) => round2(r.totals.total - r.totals.current);
  return {
    from: p.from,
    to: p.to,
    revenue: pl.revenue,
    netProfit: pl.netProfit,
    cash: round2(cash.reduce((s, a) => s + a.balance, 0)),
    receivables: ar.totals.total,
    overdueReceivables: overdue(ar),
    payables: ap.totals.total,
    overduePayables: overdue(ap),
    vatPayable,
    vatComplete,
    corporateTaxEstimate: ct.taxPayable,
    corporateTaxBasis: { from: fyStart, to: p.to },
    topOverdue: ar.documents
      .filter((d) => d.daysPastDue > 0 && d.open > 0)
      .sort((a, b) => b.open - a.open)
      .slice(0, 5)
      .map((d) => ({ number: d.number, name: d.name, daysPastDue: d.daysPastDue, open: d.open })),
  };
}

export async function renderExecutiveSummary(
  company: RenderCompany,
  p: StatementPeriod
): Promise<RenderedReport> {
  const s = await computeExecutiveSummary(company.id, p);
  const loc = company.locale;
  const kv = (text: Bilingual, value: number | null): RenderRow => ({
    cells: { item: loc === "ar" ? text.ar : text.en, value },
  });
  return {
    id: "executive-summary",
    title: STATEMENT_TITLES["executive-summary"],
    period: periodLabel(p.from, p.to, company.locale),
    basis: "ledger",
    tables: [
      {
        columns: [
          { key: "item", header: L.item, weight: 2.4 },
          { key: "value", header: { en: "AED", ar: "درهم" }, numeric: true },
        ],
        rows: [
          kv({ en: "Revenue", ar: "الإيرادات" }, s.revenue),
          kv({ en: "Net profit", ar: "صافي الربح" }, s.netProfit),
          kv({ en: "Cash and bank", ar: "النقد والبنوك" }, s.cash),
          kv({ en: "Receivables (overdue)", ar: "الذمم المدينة (المتأخرة)" }, s.overdueReceivables),
          kv({ en: "Receivables (total)", ar: "الذمم المدينة (الإجمالي)" }, s.receivables),
          kv({ en: "Payables (overdue)", ar: "الذمم الدائنة (المتأخرة)" }, s.overduePayables),
          kv({ en: "Payables (total)", ar: "الذمم الدائنة (الإجمالي)" }, s.payables),
          kv(
            {
              en: "VAT payable this period (Box 14)",
              ar: "ضريبة القيمة المضافة المستحقة (المربع 14)",
            },
            s.vatPayable
          ),
          kv(
            {
              en: "Corporate tax estimate (fiscal year to date)",
              ar: "تقدير ضريبة الشركات (منذ بداية السنة المالية)",
            },
            s.corporateTaxEstimate
          ),
        ],
      },
      {
        title: { en: "Top overdue invoices", ar: "أكبر الفواتير المتأخرة" },
        columns: [
          { key: "number", header: { en: "Invoice", ar: "الفاتورة" } },
          { key: "name", header: L.name, weight: 2 },
          { key: "days", header: { en: "Days overdue", ar: "أيام التأخير" }, numeric: true },
          { key: "open", header: { en: "Open (AED)", ar: "المتبقي (درهم)" }, numeric: true },
        ],
        rows: s.topOverdue.map((d) => ({
          cells: { number: d.number ?? "", name: d.name, days: d.daysPastDue, open: d.open },
        })),
      },
    ],
    notes: [
      {
        en: "Corporate tax is an estimate at 9% above AED 375,000 before adjustments and reliefs; it is not a filed liability.",
        ar: "ضريبة الشركات تقدير بنسبة 9% فوق 375,000 درهم قبل التعديلات والإعفاءات؛ وليست التزامًا مقدّمًا.",
      },
      ...(s.vatPayable === null
        ? [
            {
              en: "VAT position unavailable for this period.",
              ar: "موقف ضريبة القيمة المضافة غير متاح لهذه الفترة.",
            },
          ]
        : s.vatComplete
          ? []
          : [
              {
                en: "VAT figure is provisional: document issues are open.",
                ar: "رقم الضريبة مبدئي: توجد مشكلات مفتوحة في المستندات.",
              },
            ]),
    ],
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function renderStatement(
  kind: StatementKind,
  company: RenderCompany,
  p: StatementPeriod,
  opts: { glLineCap?: number } = {}
): Promise<RenderedReport> {
  switch (kind) {
    case "profit-loss":
      return renderProfitAndLoss(company, p);
    case "balance-sheet":
      return renderBalanceSheet(company, p.to);
    case "trial-balance":
      return renderTrialBalance(company, p);
    case "cash-flow":
      return renderCashFlow(company, p);
    case "general-ledger":
      return renderGeneralLedger(company, p, { lineCap: opts.glLineCap });
    case "ar-aging":
      return renderAgedReceivables(company, p.to);
    case "ap-aging":
      return renderAgedPayables(company, p.to);
    case "changes-in-equity":
      return renderChangesInEquity(company, p);
    case "executive-summary":
      return renderExecutiveSummary(company, p);
    case "vat-summary":
      return renderVatSummary(company, p);
  }
}
