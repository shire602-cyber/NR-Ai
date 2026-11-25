/**
 * Dashboard statistics (W3-E: R13-01/02/05/09/16/19/20/21/22/37).
 *
 * One basis for every figure: the posted ledger through the reporting kernel
 * (server/reporting — closing entries excluded, UAE dates, fils) and open
 * documents with remaining balances (agedReceivables / agedPayables). Nothing
 * here loads journal lines into Node memory; every aggregate is SQL.
 */
import { pool } from "../db";
import type { Queryable } from "../reporting";
import { DomainError } from "../errors";
import {
  accountBalanceInCurrency,
  accountTotals,
  addDays,
  addMonths,
  agedPayables,
  agedReceivables,
  aed,
  cashAccounts,
  cashFlowBuckets,
  daysBetween,
  fiscalYearStart,
  loadAccounts,
  loadCompany,
  memoQueryable,
  monthEnd,
  monthStart,
  naturalBalance,
  parseReportDate,
  priorPeriod,
  priorYear,
  plSection,
  profitAndLoss,
  reportCurrencyOf,
  uaeToday,
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  type IsoDate,
  type PlTotals,
} from "../reporting";
import { computeCtLiability } from "../../shared/ct-workpaper";
import { UAE_CT_EXEMPTION_THRESHOLD } from "../constants";

export type DashboardPreset = "month" | "quarter" | "ytd" | "custom";

export interface DashboardPeriod {
  preset: DashboardPreset;
  from: IsoDate;
  to: IsoDate;
  label: string;
}

const PRESETS: DashboardPreset[] = ["month", "quarter", "ytd", "custom"];
const db: Queryable = pool as unknown as Queryable;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Resolve the dashboard period. `today` is the UAE calendar date; quarters are
 * calendar quarters, year-to-date follows the company fiscal year.
 */
export function resolveDashboardPeriod(
  input: { preset?: unknown; from?: unknown; to?: unknown },
  today: IsoDate,
  fiscalYearStartMonth = 1
): DashboardPeriod {
  const raw = typeof input.preset === "string" && input.preset ? input.preset : "month";
  if (!PRESETS.includes(raw as DashboardPreset)) {
    throw new DomainError(
      "INVALID_PERIOD_PRESET",
      400,
      { preset: raw },
      "preset must be month, quarter, ytd or custom"
    );
  }
  const preset = raw as DashboardPreset;
  if (preset === "custom") {
    const from = parseReportDate(input.from, "from");
    const to = parseReportDate(input.to, "to");
    if (!from || !to) {
      throw new DomainError(
        "REPORT_RANGE_REQUIRED",
        400,
        undefined,
        "custom period needs from and to (YYYY-MM-DD)"
      );
    }
    if (from > to) {
      throw new DomainError(
        "INVALID_REPORT_RANGE",
        400,
        { from, to },
        "from must be on or before to"
      );
    }
    return { preset, from, to, label: `${from} – ${to}` };
  }
  if (preset === "month") {
    return { preset, from: monthStart(today), to: today, label: "This month" };
  }
  if (preset === "quarter") {
    const m = Number(today.slice(5, 7));
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    const from = `${today.slice(0, 4)}-${String(qStartMonth).padStart(2, "0")}-01`;
    return { preset, from, to: today, label: "This quarter" };
  }
  return {
    preset,
    from: fiscalYearStart(today, fiscalYearStartMonth),
    to: today,
    label: "Year to date",
  };
}

/** Last `count` UAE calendar months ending at `today`, built from year/month integers. */
export function lastMonthKeys(
  today: IsoDate,
  count: number
): Array<{ key: string; label: string }> {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < count; i++) {
    out.unshift({ key: `${y}-${String(m).padStart(2, "0")}`, label: MONTH_SHORT[m - 1] });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export interface MonthlyTrendPoint {
  key: string;
  month: string;
  revenue: number;
  /** B2 (NM4): other income (interest, disposal and FX gains), not revenue. */
  otherIncome: number;
  expenses: number;
  netProfit: number;
}

/** Revenue and expenses per UAE month from the posted ledger (one basis for both series). */
export async function getMonthlyTrends(
  companyId: string,
  today: IsoDate = uaeToday(),
  count = 6,
  q: Queryable = db
): Promise<MonthlyTrendPoint[]> {
  const keys = lastMonthKeys(today, count);
  const from = `${keys[0].key}-01`;
  // B2 (NM4): revenue is the P&L revenue section only (IFRS 15); other income (interest,
  // disposal gains, realised and unrealised FX gains) is its own series, as on the P&L.
  const [accounts, { rows }] = await Promise.all([
    loadAccounts(companyId, q),
    q.query(
      `SELECT to_char(${ENTRY_LOCAL_DATE_SQL}, 'YYYY-MM') AS ym, a.id AS account_id, a.type,
            COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint AS cr
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted'
        AND ${ENTRY_LOCAL_DATE_SQL} >= $2::date AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date
        AND ${NOT_CLOSING_SQL}
        AND a.type IN ('income', 'expense')
      GROUP BY 1, 2, 3`,
      [companyId, from, monthEnd(today)]
    ),
  ]);
  const sectionOf = new Map(accounts.map((a) => [a.id, plSection(a)]));
  const byKey = new Map<string, { rev: number; oi: number; exp: number }>();
  for (const r of rows) {
    const cur = byKey.get(r.ym) ?? { rev: 0, oi: 0, exp: 0 };
    const cr = Number(r.cr);
    if (r.type === "income") {
      if (sectionOf.get(r.account_id) === "other_income") cur.oi += cr;
      else cur.rev += cr;
    } else cur.exp -= cr;
    byKey.set(r.ym, cur);
  }
  return keys.map(({ key, label }) => {
    const r = byKey.get(key) ?? { rev: 0, oi: 0, exp: 0 };
    return {
      key,
      month: label,
      revenue: aed(r.rev),
      otherIncome: aed(r.oi),
      expenses: aed(r.exp),
      netProfit: aed(r.rev + r.oi - r.exp),
    };
  });
}

function pct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function summarise(pl: PlTotals, from: IsoDate | null, to: IsoDate) {
  // B2 (NM4): revenue is the P&L revenue section (IFRS 15); other income (interest, disposal
  // and FX gains) is reported beside it, never inside it. revenue + otherIncome − expenses = net.
  const margin = pl.revenue > 0 ? Math.round((pl.netProfit / pl.revenue) * 1000) / 10 : null;
  return {
    from,
    to,
    revenue: pl.revenue,
    otherIncome: pl.otherIncome,
    expenses: pl.totalExpenses,
    netProfit: pl.netProfit,
    margin,
  };
}

/** Per-account bank statement balance versus the linked GL account (R13-20). */
/**
 * X5 (J1 D5): the statement's closing balance, chosen deterministically. Statement lines that
 * share a date (one import) carry no reliable order, so the closing row is the one on the last
 * statement date that no other same-day row follows in the running-balance chain
 * (next.balance - next.amount = this.balance). When the chain does not single one out (or the
 * file had no balance column) the balance is the opening balance plus every line on the
 * statement. Deleted lines are not part of the statement.
 */
export function statementClosingFils(
  openingFils: number,
  lines: Array<{ date: string; amountFils: number; balanceFils: number | null }>
): { fils: number; date: string | null } {
  if (lines.length === 0) return { fils: openingFils, date: null };
  const lastDate = lines.reduce((m, l) => (l.date > m ? l.date : m), lines[0].date);
  const sameDay = lines.filter((l) => l.date === lastDate && l.balanceFils !== null);
  const ends = sameDay.filter(
    (r, i) =>
      !sameDay.some((s, j) => j !== i && (s.balanceFils as number) - s.amountFils === r.balanceFils)
  );
  if (ends.length === 1) return { fils: ends[0].balanceFils as number, date: lastDate };
  const sum = lines.reduce((s, l) => s + l.amountFils, 0);
  return { fils: openingFils + sum, date: lastDate };
}

/** One bank account on the dashboard's bank-vs-GL card. Amounts are in `currency`. */
export interface BankVsGlItem {
  bankAccountId: string;
  name: string;
  bankName: string;
  currency: string;
  isForeign: boolean;
  glAccountId: string | null;
  /** False when no statement line was imported: nothing to compare, no difference. */
  hasStatement: boolean;
  statementDate: string | null;
  statementBalance: number | null;
  glBalance: number | null;
  difference: number | null;
}

async function bankVersusGl(
  companyId: string,
  today: IsoDate,
  q: Queryable = db
): Promise<BankVsGlItem[]> {
  const [{ rows }, { rows: lineRows }, accounts, reportCurrency] = await Promise.all([
    q.query(
      `SELECT ba.id, ba.name_en, ba.bank_name, ba.currency, ba.gl_account_id,
              ROUND(COALESCE(ba.opening_balance, 0) * 100)::bigint AS opening_fils
         FROM bank_accounts ba
        WHERE ba.company_id = $1 AND ba.is_active = true
        ORDER BY ba.created_at`,
      [companyId]
    ),
    q.query(
      `SELECT bt.bank_statement_account_id AS account_id,
              to_char(bt.transaction_date, 'YYYY-MM-DD') AS date,
              ROUND(bt.amount * 100)::bigint AS amount_fils,
              CASE WHEN bt.balance IS NULL THEN NULL ELSE ROUND(bt.balance * 100)::bigint END
                AS balance_fils
         FROM bank_transactions bt
         JOIN bank_accounts ba ON ba.id = bt.bank_statement_account_id
        WHERE ba.company_id = $1 AND ba.is_active = true AND bt.deleted_at IS NULL`,
      [companyId]
    ),
    loadAccounts(companyId, q),
    reportCurrencyOf(companyId, q),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const linesByAccount = new Map<
    string,
    Array<{ date: string; amountFils: number; balanceFils: number | null }>
  >();
  for (const l of lineRows) {
    const list = linesByAccount.get(l.account_id) ?? [];
    list.push({
      date: String(l.date),
      amountFils: Number(l.amount_fils),
      balanceFils: l.balance_fils === null ? null : Number(l.balance_fils),
    });
    linesByAccount.set(l.account_id, list);
  }
  // Like for like: the GL is read as at the statement's closing date, in the bank account's own
  // currency (a USD account compares USD statement lines with the USD amounts on its GL lines).
  // X6a (council REQUIRED 7): with no statement imported there is nothing to compare, so no
  // statement balance and no difference are reported ("no statement imported").
  const baseCurrency = reportCurrency.toUpperCase();
  const totalsAt = new Map<string, ReturnType<typeof accountTotals>>();
  const glAt = (date: IsoDate) => {
    let totals = totalsAt.get(date);
    if (!totals) {
      totals = accountTotals(companyId, { to: date }, q);
      totalsAt.set(date, totals);
    }
    return totals;
  };
  // PERF-DASH: the accounts are read together (no query per account in turn); order is kept.
  return Promise.all(
    rows.map(async (r): Promise<BankVsGlItem> => {
      const statementLines = linesByAccount.get(r.id as string) ?? [];
      const currency = String(r.currency || baseCurrency).toUpperCase();
      const isForeign = currency !== baseCurrency;
      const closing = statementClosingFils(Number(r.opening_fils), statementLines);
      const hasStatement = statementLines.length > 0;
      const asOf = (closing.date && closing.date < today ? closing.date : today) as IsoDate;
      const gl = r.gl_account_id ? accountById.get(r.gl_account_id) : undefined;
      let glFils: number | null = null;
      if (gl) {
        glFils = isForeign
          ? await accountBalanceInCurrency({ companyId, accountId: gl.id, currency, to: asOf }, q)
          : naturalBalance("asset", (await glAt(asOf)).get(gl.id));
      }
      return {
        bankAccountId: r.id as string,
        name: r.name_en as string,
        bankName: r.bank_name as string,
        currency,
        isForeign,
        glAccountId: (r.gl_account_id as string | null) ?? null,
        hasStatement,
        statementDate: hasStatement ? closing.date : null,
        statementBalance: hasStatement ? aed(closing.fils) : null,
        glBalance: glFils === null ? null : aed(glFils),
        difference: hasStatement && glFils !== null ? aed(closing.fils - glFils) : null,
      };
    })
  );
}

/** Output / input VAT from the ledger VAT accounts (as of today). */
async function vatWidget(companyId: string, today: IsoDate, q: Queryable = db) {
  const [accounts, totals] = await Promise.all([
    loadAccounts(companyId, q),
    accountTotals(companyId, { to: today }, q),
  ]);
  let output = 0;
  let input = 0;
  for (const a of accounts) {
    if (!/\bvat\b|value added/i.test(a.nameEn)) continue;
    const t = totals.get(a.id);
    if (a.type === "liability") output += naturalBalance("liability", t);
    else if (a.type === "asset") input += naturalBalance("asset", t);
  }
  return {
    source: "ledger" as const,
    outputVat: aed(output),
    inputVat: aed(input),
    netPayable: aed(output - input),
  };
}

export interface DashboardStatsInput {
  preset?: unknown;
  from?: unknown;
  to?: unknown;
}

export async function getDashboardStats(companyId: string, input: DashboardStatsInput = {}) {
  const today = uaeToday();
  // PERF-DASH: one request-scoped read cache for every widget below. The widgets each load the
  // chart, the company and the as-of-today trial balance; through `q` each runs once.
  const q = memoQueryable(db);
  const company = await loadCompany(companyId, q);
  const period = resolveDashboardPeriod(input, today, company.fiscalYearStartMonth);
  const prior = priorPeriod(period.from, period.to);
  const prevYear = priorYear(period.from, period.to);
  const ytdFrom = fiscalYearStart(today, company.fiscalYearStartMonth);
  const thisMonthFrom = monthStart(today);
  const trailingFrom = addDays(today, -89);

  const [
    plCurrent,
    plPrior,
    plPriorYear,
    plThisMonth,
    plYtd,
    plTrailing,
    ar,
    ap,
    cash,
    trends,
    buckets,
    bank,
    vat,
    counts,
  ] = await Promise.all([
    profitAndLoss({ companyId, from: period.from, to: period.to }, q),
    profitAndLoss({ companyId, from: prior.from, to: prior.to }, q),
    profitAndLoss({ companyId, from: prevYear.from, to: prevYear.to }, q),
    profitAndLoss({ companyId, from: thisMonthFrom, to: today }, q),
    profitAndLoss({ companyId, from: ytdFrom, to: today }, q),
    profitAndLoss({ companyId, from: trailingFrom, to: today }, q),
    agedReceivables({ companyId, asOf: today }, q),
    agedPayables({ companyId, asOf: today }, q),
    cashAccounts(companyId, today, q),
    getMonthlyTrends(companyId, today, 6, q),
    cashFlowBuckets(
      {
        companyId,
        from: addMonths(monthStart(today), -5),
        to: monthEnd(today),
        granularity: "month",
      },
      q
    ),
    bankVersusGl(companyId, today, q),
    vatWidget(companyId, today, q),
    q.query(
      `SELECT
         (SELECT COUNT(*) FROM invoices WHERE company_id = $1)::int AS invoices,
         (SELECT COUNT(*) FROM journal_entries WHERE company_id = $1 AND status = 'posted')::int AS entries,
         EXISTS (SELECT 1 FROM vendor_bills vb WHERE vb.company_id = $1 AND vb.status = 'paid')
           AS has_bill_payments`,
      [companyId]
    ),
  ]);

  const cashPosition = aed(cash.reduce((s, c) => s + Math.round(c.balance * 100), 0));

  // Burn: average expenses of the last three completed months (series is oldest-first,
  // last element is the current month).
  const completed = trends.slice(-4, -1);
  const monthlyBurnRate = completed.length
    ? Math.round((completed.reduce((s, t) => s + t.expenses, 0) / completed.length) * 100) / 100
    : 0;
  const cashRunway =
    monthlyBurnRate > 0 ? Math.round((cashPosition / monthlyBurnRate) * 10) / 10 : null;

  const expenseLines = [
    ...plCurrent.sections.costOfSales.lines,
    ...plCurrent.sections.operatingExpenses.lines,
    ...plCurrent.sections.otherExpenses.lines,
  ];
  const topExpenseCategories = expenseLines
    .filter((l) => l.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((l) => ({
      name: l.accountName,
      nameAr: l.accountNameAr ?? null,
      value: l.amount,
      accountId: l.accountId,
    }));

  const dso =
    plTrailing.revenue > 0
      ? Math.round((ar.totals.total / plTrailing.revenue) * 90 * 10) / 10
      : null;
  // X3 (J2): days-payable is an average payment period; with no fully paid bill on record (E1)
  // it would be a number with nothing behind it, so it stays null ("—" in the UI).
  const dpo =
    plTrailing.totalExpenses > 0 && counts.rows[0].has_bill_payments
      ? Math.round((ap.totals.total / plTrailing.totalExpenses) * 90 * 10) / 10
      : null;

  const overdue = (docs: typeof ar.documents) =>
    docs
      .filter((d) => d.daysPastDue > 0)
      .sort((a, b) => b.open - a.open)
      .slice(0, 5);

  const current = summarise(plCurrent, period.from, period.to);
  const previous = summarise(plPrior, prior.from, prior.to);
  const previousYear = summarise(plPriorYear, prevYear.from, prevYear.to);

  const ctRevenue = Math.max(0, plYtd.totalIncome);
  // Estimate on profit before tax (A3 H3, IAS 12): a posted corporate-tax provision is the
  // estimate's own result, so deducting it would understate the tax (as the executive summary).
  const ctExpenses = Math.max(0, plYtd.totalExpenses - (plYtd.incomeTaxExpense ?? 0));
  const ct = computeCtLiability({
    totalRevenue: ctRevenue,
    totalExpenses: ctExpenses,
    totalDeductions: 0,
    exemptionThreshold: UAE_CT_EXEMPTION_THRESHOLD,
    taxRate: 0.09,
  });

  return {
    reportCurrency: "AED",
    asOf: today,
    period,
    // Period-scoped hero figures (the label always names the selected period).
    revenue: current.revenue,
    // B2 (NM4): other income sits beside revenue (revenue + otherIncome − expenses = net).
    otherIncome: current.otherIncome,
    expenses: current.expenses,
    netProfit: current.netProfit,
    margin: current.margin,
    current,
    prior: previous,
    priorYear: previousYear,
    thisMonth: summarise(plThisMonth, thisMonthFrom, today),
    changes: {
      vsPrior: {
        revenue: pct(current.revenue, previous.revenue),
        expenses: pct(current.expenses, previous.expenses),
        netProfit: pct(current.netProfit, previous.netProfit),
      },
      vsPriorYear: {
        revenue: pct(current.revenue, previousYear.revenue),
        expenses: pct(current.expenses, previousYear.expenses),
        netProfit: pct(current.netProfit, previousYear.netProfit),
      },
    },
    revenueGrowth: pct(current.revenue, previous.revenue),
    expenseGrowth: pct(current.expenses, previous.expenses),
    // Net of unapplied credits so it equals the GL control balance (D5c).
    outstanding: ar.netTotal,
    outstandingPayables: ap.netTotal,
    totalInvoices: counts.rows[0].invoices,
    totalEntries: counts.rows[0].entries,
    cashPosition,
    cashAccounts: cash,
    monthlyBurnRate,
    cashRunway,
    arAging: {
      current: ar.totals.current,
      days0to30: ar.totals.days30,
      days31to60: ar.totals.days60,
      days61to90: ar.totals.days90,
      days90plus: ar.totals.over90,
    },
    apAging: {
      current: ap.totals.current,
      days0to30: ap.totals.days30,
      days31to60: ap.totals.days60,
      days61to90: ap.totals.days90,
      days90plus: ap.totals.over90,
    },
    arReconciliation: ar.reconciliation,
    apReconciliation: ap.reconciliation,
    topExpenseCategories,
    cashInOut: buckets.buckets.map((b) => ({
      period: b.period,
      from: b.from,
      to: b.to,
      inflow: aed(Math.round((b.operatingInflow + b.investingInflow + b.financingInflow) * 100)),
      outflow: aed(
        Math.round((b.operatingOutflow + b.investingOutflow + b.financingOutflow) * 100)
      ),
      net: b.netCashFlow,
      endingBalance: b.endingBalance,
    })),
    bankVsGl: {
      accounts: bank,
      glCashTotal: cashPosition,
      // Base-currency accounts with an imported statement only (amounts in other currencies
      // do not add up with the base currency).
      statementTotal: aed(
        bank.reduce(
          (s, b) =>
            !b.isForeign && b.statementBalance !== null
              ? s + Math.round(b.statementBalance * 100)
              : s,
          0
        )
      ),
    },
    dso,
    dpo,
    topOverdue: {
      receivables: overdue(ar.documents),
      payables: overdue(ap.documents),
    },
    monthlyTrends: trends,
    vat,
    corporateTax: {
      source: "ledger" as const,
      periodFrom: ytdFrom,
      periodTo: today,
      revenue: ctRevenue,
      expenses: ctExpenses,
      taxableIncome: ct.taxableIncome,
      estimatedLiability: ct.taxPayable,
      daysIntoPeriod: daysBetween(ytdFrom, today),
    },
    // Drill-through targets: every tile links to a filtered list (R13-21).
    links: {
      revenue: `/reports?report=profit-loss&from=${period.from}&to=${period.to}`,
      expenses: `/reports?report=profit-loss&from=${period.from}&to=${period.to}`,
      netProfit: `/reports?report=profit-loss&from=${period.from}&to=${period.to}`,
      outstanding: `/invoices?status=open`,
      overdue: `/invoices?status=overdue`,
      payables: `/bill-pay?tab=bills&status=open`,
      cash: `/reports?report=balance-sheet&asOf=${today}`,
      vat: `/vat-filing`,
      corporateTax: `/corporate-tax`,
      journal: `/journal?from=${period.from}&to=${period.to}`,
    },
  };
}

/** Top expense accounts for the selected period (P&L basis, same as the stats tile). */
export async function getExpenseBreakdown(companyId: string, input: DashboardStatsInput = {}) {
  const company = await loadCompany(companyId);
  const period = resolveDashboardPeriod(input, uaeToday(), company.fiscalYearStartMonth);
  const pl = await profitAndLoss({ companyId, from: period.from, to: period.to });
  return [
    ...pl.sections.costOfSales.lines,
    ...pl.sections.operatingExpenses.lines,
    ...pl.sections.otherExpenses.lines,
  ]
    .filter((l) => l.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((l) => ({
      name: l.accountName,
      nameAr: l.accountNameAr ?? null,
      value: l.amount,
      accountId: l.accountId,
    }));
}
