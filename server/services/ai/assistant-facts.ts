/**
 * AS1 (A1): the facts the Assistant answers from.
 *
 * The question is read for its topics (VAT, overdue invoices, bills, profit, expenses, customers,
 * receipts, cash, corporate tax) and its period (this month, last month, this quarter, last
 * quarter, this year, last year). For each topic the app's own engines compute the figures, read
 * only and scoped to the company:
 *
 * - VAT 201: `computeVat201` for the VAT period asked for (default: the current and the last
 *   period of the company's own stagger);
 * - open and overdue invoices / bills: the aged receivables / payables of the reporting kernel,
 *   which read open balances through `server/reporting/settlement.ts`;
 * - profit, income, expenses and the biggest expense accounts: the reporting-kernel P&L;
 * - cash and bank: `cashAccounts` (posted ledger balances);
 * - corporate tax: the same ledger preview as GET /corporate-tax/calculate (`ctLedgerPreview`).
 *
 * Every fact carries a stable id (F1, F2, ...) the model cites, a catalog key and params so the
 * client can label it in English and Arabic, and the page it can be checked on. When a topic
 * cannot be answered from the books, a `missing` entry says why and links where to fix it.
 */
import { buildGroundedContext, type GroundingResult } from "./grounding";
import type { AgingReport, IsoDate, ProfitAndLoss } from "../../reporting";
import type { VatComputation, VatCompanyConfig } from "../../tax/vat-engine";
import type { CtLedgerPreview } from "../corporate-tax/ledger-preview";
import type { QueryResultRow } from "pg";

// ─── Topics and periods ─────────────────────────────────────────────────────

export const ASK_TOPICS = [
  "vat",
  "overdue_invoices",
  "invoices",
  "bills",
  "profit",
  "expenses",
  "customers",
  "receipts",
  "cash",
  "corporate_tax",
] as const;
export type AskTopic = (typeof ASK_TOPICS)[number];

export type AskPeriod =
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year"
  | "last_year";

/** Arabic-Indic and Persian digits to Latin, and Arabic letter variants folded (أإآ → ا, ة → ه, ى → ي). */
export function normaliseQuestion(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْـ]/g, "") // tashkeel, tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

const TOPIC_PATTERNS: Array<[AskTopic, RegExp]> = [
  // Corporate tax first: "ضريبه الشركات" also contains the word for tax.
  ["corporate_tax", /corporate tax|\bct\b|income tax|ضريبه (ال)?شركات|ضريبه الدخل/],
  [
    "vat",
    /\bvat\b|\btax(es)?\b|value added|vat ?201|output tax|input tax|قيمه المضافه|ضريبه القيمه|الضريبه|ضريبه|ضريبتي/,
  ],
  [
    "overdue_invoices",
    /overdue|past due|late (invoice|payment)|متاخر|متأخر|فات موعد|تجاوز(ت)? (موعد|تاريخ) الاستحقاق/,
  ],
  ["invoices", /\binvoices?\b|receivable|unpaid invoice|فاتوره|فواتير|ذمم مدينه|المستحق(ه)? لي/],
  ["bills", /\bbills?\b|payable|supplier|vendor|مورد|ذمم دائنه|فواتير الشراء/],
  [
    "profit",
    /profit|loss|earn|made|income|revenue|sales|margin|ربح|أرباح|ارباح|خساره|دخل|ايراد|مبيعات|كسبت/,
  ],
  ["expenses", /expense|spend|spent|spending|cost|مصروف|مصاريف|نفقات|انفقت|صرفت|تكاليف/],
  ["customers", /customer|client|who owes|owe me|عميل|عملاء|زبائن|يدين|مدين لي/],
  ["receipts", /receipts?|not posted|unposted|ايصال|ايصالات|إيصال|غير مرحل|لم (ت|ي)رحل/],
  ["cash", /\bcash\b|bank|balance|money do i have|liquidity|نقد|نقديه|بنك|البنك|رصيد|سيوله/],
];

const PERIOD_PATTERNS: Array<[AskPeriod, RegExp]> = [
  ["last_quarter", /last quarter|previous quarter|prior quarter|الربع (الماضي|السابق|الاخير)/],
  [
    "this_quarter",
    /this quarter|current quarter|quarter to date|qtd|هذا الربع|الربع (الحالي|الجاري)/,
  ],
  ["last_month", /last month|previous month|prior month|الشهر (الماضي|السابق)/],
  ["this_month", /this month|current month|month to date|mtd|هذا الشهر|الشهر (الحالي|الجاري)/],
  ["last_year", /last year|previous year|prior year|(العام|السنه) (الماضي|الماضيه|السابق|السابقه)/],
  [
    "this_year",
    /this year|year to date|ytd|so far this year|current year|هذا العام|هذه السنه|العام (الحالي|الجاري)|السنه (الحاليه|الجاريه)|منذ بدايه (العام|السنه)/,
  ],
];

export interface AskIntent {
  topics: AskTopic[];
  period: AskPeriod | null;
}

export function detectIntent(question: string): AskIntent {
  const q = normaliseQuestion(question);
  const topics = TOPIC_PATTERNS.filter(([, re]) => re.test(q)).map(([t]) => t);
  let list = topics;
  // "Corporate tax" also contains the plain word for tax: drop VAT unless VAT itself is named.
  if (list.includes("corporate_tax") && !/\bvat\b|قيمه المضافه/.test(q)) {
    list = list.filter((t) => t !== "vat");
  }
  // "Overdue bills": overdue is about bills when bills are named and invoices are not.
  if (
    list.includes("overdue_invoices") &&
    list.includes("bills") &&
    !/invoice|فاتوره|فواتير/.test(q)
  ) {
    list = list.filter((t) => t !== "overdue_invoices");
  }
  const period = PERIOD_PATTERNS.find(([, re]) => re.test(q))?.[0] ?? null;
  return { topics: Array.from(new Set(list)), period };
}

// ─── Facts ──────────────────────────────────────────────────────────────────

export type FactSourceKey =
  | "profitLoss"
  | "balanceSheet"
  | "invoices"
  | "bills"
  | "vat"
  | "bank"
  | "receipts"
  | "corporateTax";

export const FACT_SOURCES: Record<FactSourceKey, string> = {
  profitLoss: "/reports?tab=pl&report=profit-loss",
  balanceSheet: "/reports?tab=bs&report=balance-sheet",
  invoices: "/invoices",
  bills: "/bill-pay",
  vat: "/vat-filing",
  bank: "/bank-accounts",
  receipts: "/receipts",
  corporateTax: "/corporate-tax",
};

export type FactParams = Record<string, string | number>;

export interface AssistantFact {
  id: string;
  /** Catalog key suffix: the client renders `assistant.fact.<key>` with `params`. */
  key: string;
  /** English label for the model (never shown as is). */
  label: string;
  value: number;
  unit: "AED" | "count";
  params?: FactParams;
  source: FactSourceKey;
  /** The topic this fact answers; `summary` facts are background for any question. */
  topic: AskTopic | "summary";
}

export type MissingKey =
  | "noEntries"
  | "vatNotSetUp"
  | "vatIncomplete"
  | "noOpenInvoices"
  | "noOpenBills"
  | "noBankAccounts"
  | "noReceipts"
  | "unknownTopic";

export const MISSING_LINKS: Record<MissingKey, string> = {
  noEntries: "/journal",
  vatNotSetUp: "/settings/company",
  vatIncomplete: "/vat-filing",
  noOpenInvoices: "/invoices",
  noOpenBills: "/bill-pay",
  noBankAccounts: "/bank-accounts",
  noReceipts: "/receipts",
  unknownTopic: "/reports",
};

export interface AssistantMissing {
  key: MissingKey;
  /** English description for the model. */
  note: string;
  href: string;
}

export interface AssistantFacts {
  today: IsoDate;
  intent: AskIntent;
  facts: AssistantFact[];
  missing: AssistantMissing[];
  grounding: GroundingResult;
}

export interface AssistantFactDeps {
  grounding(companyId: string, asOf: Date): Promise<GroundingResult>;
  profitAndLoss(args: { companyId: string; from: IsoDate; to: IsoDate }): Promise<ProfitAndLoss>;
  agedReceivables(args: { companyId: string; asOf: IsoDate }): Promise<AgingReport>;
  agedPayables(args: { companyId: string; asOf: IsoDate }): Promise<AgingReport>;
  cashAccounts(
    companyId: string,
    asOf: IsoDate
  ): Promise<Array<{ accountName: string; accountCode: string; balance: number }>>;
  vatCompany(companyId: string): Promise<VatCompanyConfig>;
  computeVat201(input: { companyId: string; from: string; to: string }): Promise<VatComputation>;
  ctPreview(companyId: string, from: IsoDate, to: IsoDate): Promise<CtLedgerPreview>;
  query(sql: string, params: unknown[]): Promise<{ rows: QueryResultRow[] }>;
}

async function defaultDeps(): Promise<AssistantFactDeps> {
  const { pool } = await import("../../db");
  const reporting = await import("../../reporting");
  const vat = await import("../../tax/vat-engine");
  const ct = await import("../corporate-tax/ledger-preview");
  return {
    grounding: (companyId, asOf) => buildGroundedContext(companyId, { asOf }),
    profitAndLoss: (args) => reporting.profitAndLoss(args),
    agedReceivables: (args) => reporting.agedReceivables(args),
    agedPayables: (args) => reporting.agedPayables(args),
    cashAccounts: (companyId, asOf) => reporting.cashAccounts(companyId, asOf),
    vatCompany: (companyId) => vat.loadVatCompany(companyId),
    // Reports mode: blocking issues (missing emirate, rates) are listed, not thrown.
    computeVat201: (input) => vat.computeVat201({ ...input, allowIncomplete: true }),
    ctPreview: (companyId, from, to) => ct.ctLedgerPreview(companyId, from, to),
    query: (sql, params) => pool.query(sql, params),
  };
}

// Date helpers (pure, UAE calendar dates).
function ymd(y: number, m1: number, d: number): IsoDate {
  return new Date(Date.UTC(y, m1 - 1, d)).toISOString().slice(0, 10);
}
const monthStartOf = (iso: IsoDate) => ymd(+iso.slice(0, 4), +iso.slice(5, 7), 1);
const monthEndOf = (iso: IsoDate) => ymd(+iso.slice(0, 4), +iso.slice(5, 7) + 1, 0);
const addDaysIso = (iso: IsoDate, n: number) =>
  ymd(+iso.slice(0, 4), +iso.slice(5, 7), +iso.slice(8, 10) + n);

/** Calendar range of a period word, for the P&L. "This year" is the fiscal year to date. */
export function periodRange(
  period: AskPeriod,
  today: IsoDate,
  fiscalYearStart: IsoDate
): { from: IsoDate; to: IsoDate } {
  const y = +today.slice(0, 4);
  const m = +today.slice(5, 7);
  switch (period) {
    case "this_month":
      return { from: monthStartOf(today), to: monthEndOf(today) };
    case "last_month": {
      const prev = addDaysIso(monthStartOf(today), -1);
      return { from: monthStartOf(prev), to: prev };
    }
    case "this_quarter": {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: ymd(y, q0, 1), to: ymd(y, q0 + 3, 0) };
    }
    case "last_quarter": {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: ymd(y, q0 - 3, 1), to: ymd(y, q0, 0) };
    }
    case "this_year":
      return { from: fiscalYearStart, to: today };
    case "last_year": {
      const end = addDaysIso(fiscalYearStart, -1);
      return {
        from: ymd(+fiscalYearStart.slice(0, 4) - 1, +fiscalYearStart.slice(5, 7), 1),
        to: end,
      };
    }
  }
}

/** The VAT period of the company's stagger that contains `date`. */
export function vatPeriodContaining(
  date: IsoDate,
  frequency: "monthly" | "quarterly",
  startMonth: number
): { from: IsoDate; to: IsoDate } {
  if (frequency === "monthly") return { from: monthStartOf(date), to: monthEndOf(date) };
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7);
  const anchor = ((((startMonth || 1) - 1) % 12) + 12) % 12;
  const since = (((m - 1 - anchor) % 12) + 12) % 12;
  const startAbs = m - (since % 3); // may be <= 0 (previous year)
  return { from: ymd(y, startAbs, 1), to: ymd(y, startAbs + 3, 0) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Legacy grounding labels (grounding.ts) → fact keys. */
const GROUNDING_KEYS: Array<[string, string, FactSourceKey]> = [
  ["Revenue", "income", "profitLoss"],
  ["Expenses", "expenses", "profitLoss"],
  ["Net profit", "netProfit", "profitLoss"],
  ["Total assets", "totalAssets", "balanceSheet"],
  ["Total liabilities", "totalLiabilities", "balanceSheet"],
  ["Open receivables", "openInvoicesTotal", "invoices"],
  ["Open invoices", "openInvoicesCount", "invoices"],
  ["Receipts captured", "receiptsCaptured", "receipts"],
  ["Receipts posted", "receiptsPosted", "receipts"],
  ["Unposted receipt", "receiptsUnpostedTotal", "receipts"],
];

const OVERDUE_LIST_LIMIT = 10;
const TOP_LIMIT = 5;

const SQL_UNPOSTED_RECEIPTS = `
  SELECT id, merchant, (date + interval '4 hours')::date::text AS date,
         COALESCE(base_currency_amount, 0)::float8 AS amount
    FROM receipts
   WHERE company_id = $1 AND posted = false
   ORDER BY date DESC NULLS LAST, created_at DESC
   LIMIT ${OVERDUE_LIST_LIMIT}`;

const SQL_UNPOSTED_RECEIPT_TOTALS = `
  SELECT COUNT(*)::int AS n, COALESCE(SUM(base_currency_amount), 0)::float8 AS total
    FROM receipts WHERE company_id = $1 AND posted = false`;

const SQL_VAT_RETURN_STATUS = `
  SELECT status FROM vat_returns
   WHERE company_id = $1 AND ABS(((period_end + interval '4 hours')::date) - $2::date) <= 1
   ORDER BY created_at DESC LIMIT 1`;

/**
 * Build the facts for one question. Each topic is computed independently: a failure in one
 * engine becomes a `missing` entry for that topic and never fails the whole answer.
 */
export async function buildAssistantFacts(
  companyId: string,
  question: string,
  opts: { now?: Date; deps?: AssistantFactDeps } = {}
): Promise<AssistantFacts> {
  const deps = opts.deps ?? (await defaultDeps());
  const now = opts.now ?? new Date();
  const today = new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  const intent = detectIntent(question);
  const grounding = await deps.grounding(companyId, now);
  const fiscalStart = grounding.period.start;

  const facts: AssistantFact[] = [];
  const missing: AssistantMissing[] = [];
  const add = (f: Omit<AssistantFact, "id">) => {
    facts.push({ ...f, id: `F${facts.length + 1}`, value: round2(f.value) });
  };
  const miss = (key: MissingKey, note: string) => {
    if (!missing.some((m) => m.key === key)) missing.push({ key, note, href: MISSING_LINKS[key] });
  };

  // Background: the year-to-date summary every answer may use (F1.. as before).
  for (const g of grounding.figures) {
    const hit = GROUNDING_KEYS.find(([prefix]) => g.label.startsWith(prefix));
    if (!hit) continue;
    const ytd = hit[2] === "profitLoss" || hit[0].startsWith("Receipts");
    add({
      key: hit[1],
      label: g.label,
      value: g.value,
      unit: g.unit,
      params: ytd ? { from: grounding.period.start, to: grounding.period.end } : { date: today },
      source: hit[2],
      topic: "summary",
    });
  }
  if (grounding.insufficientData) {
    miss("noEntries", `No posted journal entries from ${fiscalStart} to ${today}`);
  }

  const topics = new Set(intent.topics);
  const wants = (t: AskTopic) => topics.has(t);
  const tasks: Array<Promise<void>> = [];
  const guard = (topic: AskTopic, run: () => Promise<void>) =>
    tasks.push(
      run().catch(() => {
        if (topic === "vat") miss("vatIncomplete", "The VAT return could not be computed");
      })
    );

  // P&L for the period asked (profit and expenses questions). "This year" is already in the
  // summary; any other period gets its own figures.
  const plPeriod: AskPeriod = intent.period ?? "this_year";
  if (wants("profit") || wants("expenses")) {
    guard("profit", async () => {
      const range = periodRange(plPeriod, today, fiscalStart);
      const pl = await deps.profitAndLoss({ companyId, from: range.from, to: range.to });
      const params = { from: range.from, to: range.to };
      // The summary already carries the fiscal year to date: no second copy of the same figures.
      const inSummary =
        plPeriod === "this_year" &&
        facts.some((x) => x.topic === "summary" && x.key === "netProfit");
      if (!inSummary) {
        add({
          key: "income",
          label: `Income ${range.from} to ${range.to}`,
          value: pl.totalIncome,
          unit: "AED",
          params,
          source: "profitLoss",
          topic: "profit",
        });
        add({
          key: "expenses",
          label: `Expenses ${range.from} to ${range.to}`,
          value: pl.totalExpenses,
          unit: "AED",
          params,
          source: "profitLoss",
          topic: "profit",
        });
        add({
          key: "netProfit",
          label: `Net profit ${range.from} to ${range.to}`,
          value: pl.netProfit,
          unit: "AED",
          params,
          source: "profitLoss",
          topic: "profit",
        });
      }
      if (wants("expenses")) {
        const lines = [
          ...pl.sections.costOfSales.lines,
          ...pl.sections.operatingExpenses.lines,
          ...pl.sections.otherExpenses.lines,
        ]
          .filter((l) => l.amount > 0)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, TOP_LIMIT);
        for (const l of lines) {
          add({
            key: "expenseAccount",
            label: `Expense account ${l.accountCode} ${l.accountName}, ${range.from} to ${range.to}`,
            value: l.amount,
            unit: "AED",
            params: {
              name: l.accountName,
              nameAr: l.accountNameAr || l.accountName,
              code: l.accountCode,
              ...params,
            },
            source: "profitLoss",
            topic: "expenses",
          });
        }
      }
    });
  }

  if (wants("invoices") || wants("overdue_invoices") || wants("customers")) {
    guard("invoices", async () => {
      const ar = await deps.agedReceivables({ companyId, asOf: today });
      if (ar.documents.length === 0) {
        miss("noOpenInvoices", "No open (unpaid) invoices");
        return;
      }
      const overdue = ar.documents.filter((d) => d.daysPastDue > 0);
      const topic: AskTopic = wants("overdue_invoices")
        ? "overdue_invoices"
        : wants("customers")
          ? "customers"
          : "invoices";
      add({
        key: "openInvoicesTotal",
        label: `Open invoices total as of ${today}`,
        value: ar.totals.total,
        unit: "AED",
        params: { date: today },
        source: "invoices",
        topic,
      });
      add({
        key: "openInvoicesCount",
        label: `Number of open invoices as of ${today}`,
        value: ar.documents.length,
        unit: "count",
        params: { date: today },
        source: "invoices",
        topic,
      });
      add({
        key: "overdueInvoicesTotal",
        label: `Overdue invoices total as of ${today}`,
        value: overdue.reduce((s, d) => s + d.open, 0),
        unit: "AED",
        params: { date: today },
        source: "invoices",
        topic,
      });
      add({
        key: "overdueInvoicesCount",
        label: `Number of overdue invoices as of ${today}`,
        value: overdue.length,
        unit: "count",
        params: { date: today },
        source: "invoices",
        topic,
      });
      if (wants("overdue_invoices") || wants("invoices")) {
        const list = (wants("overdue_invoices") ? overdue : ar.documents)
          .slice()
          .sort((a, b) => b.daysPastDue - a.daysPastDue || b.open - a.open)
          .slice(0, OVERDUE_LIST_LIMIT);
        for (const d of list) {
          add({
            key: d.daysPastDue > 0 ? "invoiceOverdue" : "invoiceOpen",
            label: `Invoice ${d.number ?? "(no number)"} to ${d.name}, due ${d.dueDate}, ${d.daysPastDue > 0 ? `${d.daysPastDue} days overdue` : "not yet due"}, open amount`,
            value: d.open,
            unit: "AED",
            params: { number: d.number ?? "", name: d.name, due: d.dueDate, days: d.daysPastDue },
            source: "invoices",
            topic,
          });
        }
      }
      if (wants("customers")) {
        const rows = ar.rows
          .slice()
          .sort((a, b) => b.total - a.total)
          .slice(0, TOP_LIMIT);
        for (const r of rows) {
          add({
            key: "customerOwes",
            label: `Customer ${r.name} owes (open invoices)`,
            value: r.total,
            unit: "AED",
            params: { name: r.name, overdue: round2(r.total - r.current) },
            source: "invoices",
            topic: "customers",
          });
        }
      }
    });
  }

  if (wants("bills")) {
    guard("bills", async () => {
      const ap = await deps.agedPayables({ companyId, asOf: today });
      if (ap.documents.length === 0) {
        miss("noOpenBills", "No unpaid bills");
        return;
      }
      const overdue = ap.documents.filter((d) => d.daysPastDue > 0);
      add({
        key: "openBillsTotal",
        label: `Unpaid bills total as of ${today}`,
        value: ap.totals.total,
        unit: "AED",
        params: { date: today },
        source: "bills",
        topic: "bills",
      });
      add({
        key: "openBillsCount",
        label: `Number of unpaid bills as of ${today}`,
        value: ap.documents.length,
        unit: "count",
        params: { date: today },
        source: "bills",
        topic: "bills",
      });
      add({
        key: "overdueBillsTotal",
        label: `Overdue bills total as of ${today}`,
        value: overdue.reduce((s, d) => s + d.open, 0),
        unit: "AED",
        params: { date: today },
        source: "bills",
        topic: "bills",
      });
      const list = (overdue.length > 0 && !wants("invoices") ? overdue : ap.documents)
        .slice()
        .sort((a, b) => b.daysPastDue - a.daysPastDue || b.open - a.open)
        .slice(0, OVERDUE_LIST_LIMIT);
      for (const d of list) {
        add({
          key: d.daysPastDue > 0 ? "billOverdue" : "billOpen",
          label: `Bill ${d.number ?? "(no number)"} from ${d.name}, due ${d.dueDate}, ${d.daysPastDue > 0 ? `${d.daysPastDue} days overdue` : "not yet due"}, open amount`,
          value: d.open,
          unit: "AED",
          params: { number: d.number ?? "", name: d.name, due: d.dueDate, days: d.daysPastDue },
          source: "bills",
          topic: "bills",
        });
      }
    });
  }

  if (wants("vat")) {
    guard("vat", async () => {
      const company = await deps.vatCompany(companyId);
      const current = vatPeriodContaining(today, company.frequency, company.startMonth);
      const last = vatPeriodContaining(
        addDaysIso(current.from, -1),
        company.frequency,
        company.startMonth
      );
      const askedLast = intent.period === "last_quarter" || intent.period === "last_month";
      const periods = askedLast ? [last] : [current, last];
      if (!company.trn) {
        miss("vatNotSetUp", "The company has no VAT registration number (TRN) in its settings");
      }
      for (const p of periods) {
        const vat = await deps.computeVat201({ companyId, from: p.from, to: p.to });
        const isCurrent = p.from === current.from;
        const status = isCurrent
          ? null
          : (((await deps.query(SQL_VAT_RETURN_STATUS, [companyId, p.to])).rows[0]?.status as
              | string
              | undefined) ?? "not_filed");
        const params: FactParams = { from: p.from, to: p.to, due: vat.period.dueDate };
        const when = isCurrent
          ? `current VAT period ${p.from} to ${p.to} (so far)`
          : `last VAT period ${p.from} to ${p.to}, return status ${status}`;
        add({
          key: "vatOutput",
          label: `Output VAT (VAT 201 Box 12), ${when}`,
          value: vat.boxes.box12TotalDueTax,
          unit: "AED",
          params,
          source: "vat",
          topic: "vat",
        });
        add({
          key: "vatInput",
          label: `Recoverable input VAT (VAT 201 Box 13), ${when}`,
          value: vat.boxes.box13RecoverableTax,
          unit: "AED",
          params,
          source: "vat",
          topic: "vat",
        });
        add({
          key: vat.boxes.box14PayableTax >= 0 ? "vatNet" : "vatRefund",
          label: `${vat.boxes.box14PayableTax >= 0 ? "Net VAT payable" : "Net VAT refundable"} (VAT 201 Box 14), ${when}, due to the FTA by ${vat.period.dueDate}`,
          value: Math.abs(vat.boxes.box14PayableTax),
          unit: "AED",
          params,
          source: "vat",
          topic: "vat",
        });
        if (!vat.complete) {
          miss(
            "vatIncomplete",
            `The VAT return ${p.from} to ${p.to} has open issues to fix before it can be filed`
          );
        }
      }
    });
  }

  if (wants("cash")) {
    guard("cash", async () => {
      const accounts = await deps.cashAccounts(companyId, today);
      if (accounts.length === 0) {
        miss("noBankAccounts", "No bank or cash accounts");
        return;
      }
      add({
        key: "cashTotal",
        label: `Cash and bank, total balance as of ${today}`,
        value: accounts.reduce((s, a) => s + a.balance, 0),
        unit: "AED",
        params: { date: today },
        source: "bank",
        topic: "cash",
      });
      for (const a of accounts
        .slice()
        .sort((x, y) => y.balance - x.balance)
        .slice(0, TOP_LIMIT)) {
        add({
          key: "cashAccount",
          label: `Balance of ${a.accountCode} ${a.accountName} as of ${today}`,
          value: a.balance,
          unit: "AED",
          params: { name: a.accountName, nameAr: a.accountName, code: a.accountCode, date: today },
          source: "bank",
          topic: "cash",
        });
      }
    });
  }

  if (wants("receipts")) {
    guard("receipts", async () => {
      const [totals, list] = await Promise.all([
        deps.query(SQL_UNPOSTED_RECEIPT_TOTALS, [companyId]),
        deps.query(SQL_UNPOSTED_RECEIPTS, [companyId]),
      ]);
      const n = Number(totals.rows[0]?.n ?? 0);
      if (n === 0) {
        miss("noReceipts", "Every receipt is posted; none is waiting");
        return;
      }
      add({
        key: "unpostedReceiptsCount",
        label: "Receipts not posted yet (all dates)",
        value: n,
        unit: "count",
        source: "receipts",
        topic: "receipts",
      });
      add({
        key: "unpostedReceiptsTotal",
        label: "Value of receipts not posted yet (all dates)",
        value: Number(totals.rows[0]?.total ?? 0),
        unit: "AED",
        source: "receipts",
        topic: "receipts",
      });
      for (const r of list.rows) {
        add({
          key: "unpostedReceipt",
          label: `Unposted receipt from ${r.merchant ?? "(no merchant)"} dated ${r.date ?? "(no date)"}`,
          value: Number(r.amount),
          unit: "AED",
          params: { name: String(r.merchant ?? ""), date: String(r.date ?? "") },
          source: "receipts",
          topic: "receipts",
        });
      }
    });
  }

  if (wants("corporate_tax")) {
    guard("corporate_tax", async () => {
      const ct = await deps.ctPreview(companyId, fiscalStart, today);
      const params = { from: fiscalStart, to: today };
      add({
        key: "ctAccountingProfit",
        label: `Accounting profit for corporate tax, ${fiscalStart} to ${today}`,
        value: ct.liability.accountingProfit,
        unit: "AED",
        params,
        source: "corporateTax",
        topic: "corporate_tax",
      });
      add({
        key: "ctTaxableIncome",
        label: `Taxable income (estimate), ${fiscalStart} to ${today}`,
        value: ct.liability.taxableIncome,
        unit: "AED",
        params,
        source: "corporateTax",
        topic: "corporate_tax",
      });
      add({
        key: "ctEstimate",
        label: `Corporate tax estimate (9% above AED 375,000; before any Small Business Relief election${ct.sbrEligible ? ", which this company may be eligible for" : ""}), ${fiscalStart} to ${today}`,
        value: ct.liability.taxPayable,
        unit: "AED",
        params,
        source: "corporateTax",
        topic: "corporate_tax",
      });
    });
  }

  await Promise.all(tasks);
  // Stable order for ids: tasks finish in any order, so renumber by topic order.
  const order = (f: AssistantFact) => (f.topic === "summary" ? -1 : ASK_TOPICS.indexOf(f.topic));
  const sorted = facts
    .map((f, i) => ({ f, i, n: Number(f.id.slice(1)) }))
    .sort((a, b) => order(a.f) - order(b.f) || a.n - b.n)
    .map(({ f }, i) => ({ ...f, id: `F${i + 1}` }));

  if (intent.topics.length === 0) {
    miss("unknownTopic", "The question did not match a topic with computed figures");
  }
  return { today, intent, facts: sorted, missing, grounding };
}

/** The facts block for the system prompt. */
export function renderFactsBlock(f: AssistantFacts): string {
  const lines = f.facts.map(
    (x) =>
      `[${x.id}] ${x.label}: ${x.unit === "AED" ? `AED ${x.value.toFixed(2)}` : String(x.value)}`
  );
  const missing = f.missing.map((m) => `- NOT AVAILABLE: ${m.note}`);
  return [...lines, ...missing].join("\n") || "(no figures available)";
}

/** Facts to show under an answer: those of the question's topics, plus any the answer cited. */
export function factsToShow(f: AssistantFacts, citedIds: ReadonlySet<string>): AssistantFact[] {
  const topical = new Set(f.intent.topics);
  return f.facts.filter(
    (x) =>
      citedIds.has(x.id) ||
      (x.topic !== "summary" && topical.has(x.topic)) ||
      // "How much profit this year": the summary already holds the year-to-date P&L.
      (x.topic === "summary" &&
        x.source === "profitLoss" &&
        (topical.has("profit") || topical.has("expenses")) &&
        (f.intent.period === null || f.intent.period === "this_year") &&
        !f.facts.some((y) => y.topic === "profit"))
  );
}
