/**
 * Core financial statements (trial balance, P&L, balance sheet, cash flow,
 * general ledger, cash accounts). One implementation serves every report
 * endpoint (R11-05).
 *
 * Policy: statements are correct by computation, not by closing entries.
 *  - Retained earnings brought forward = cumulative income - expenses before
 *    the fiscal year containing the as-of date, plus any balance on the
 *    retained-earnings account (3020).
 *  - Current year earnings = P&L from fiscal-year start to the as-of date.
 *  - Closing / year-end entries are excluded from every query
 *    (CLOSING_ENTRY_SQL), so a posted year-end close never zeroes the P&L and
 *    is never double counted by the roll-forward.
 */
import { DomainError } from "../errors";
import { pool } from "../db";
import { DEFAULT_BASE_CURRENCY } from "../ledger/currency";
import {
  addDays,
  addMonths,
  buckets,
  daysBetween,
  fiscalYearStart,
  type Granularity,
  type IsoDate,
} from "./dates";
import {
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  accountTotals,
  accountTotalsByBucket,
  aed,
  ledgerLines,
  loadAccounts,
  loadCompany,
  naturalBalance,
  netIncomeOf,
  reportCurrencyOf,
  type AccountTotals,
  type Fils,
  type Queryable,
  type ReportAccount,
} from "./ledger-query";
import {
  isCashAccount,
  isContraAsset,
  isGratuityProvisionAccount,
  isNonCurrent,
  isRetainedEarningsAccount,
  isRevaluationReserveAccount,
  plSection,
  type CashFlowActivity,
  type PlSection,
} from "./classify";
import { gratuityCurrentPortionFils, otherComprehensiveIncome } from "./ifrs-adjustments";
import {
  classifyCashFlows,
  classifyCashFlowsByBucket,
  type ClassifiedCashFlows,
} from "./cash-flow-classify";

/**
 * @deprecated W5-C (R14-19): statements are labelled in the company's base (functional)
 * currency — see `reportCurrencyOf`. This is only the schema default.
 */
export const REPORT_CURRENCY = DEFAULT_BASE_CURRENCY;

export interface StatementLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountNameAr?: string | null;
  amount: number;
}

export interface StatementSection {
  total: number;
  lines: StatementLine[];
}

function line(a: ReportAccount, fils: Fils): StatementLine {
  return {
    accountId: a.id,
    accountCode: a.code,
    accountName: a.nameEn,
    accountNameAr: a.nameAr,
    amount: aed(fils),
  };
}

function section(items: Array<[ReportAccount, Fils]>, keepZero = false): StatementSection {
  const kept = items.filter(([, f]) => keepZero || f !== 0);
  return {
    total: aed(kept.reduce((s, [, f]) => s + f, 0)),
    lines: kept.map(([a, f]) => line(a, f)),
  };
}

// ─── Trial balance ──────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  accountId: string;
  accountName: string;
  accountNameAr?: string | null;
  accountCode: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  balance: number;
  debitBalance: number;
  creditBalance: number;
  hasForeignLines: boolean;
  synthetic?: boolean;
}

export interface TrialBalance {
  reportCurrency: string;
  from: IsoDate | null;
  to: IsoDate;
  rows: TrialBalanceRow[];
  retainedEarningsBroughtForward: number;
  totals: {
    sumDebits: number;
    sumCredits: number;
    difference: number;
    sumDebitBalances: number;
    sumCreditBalances: number;
  };
  isBalanced: boolean;
}

export const RETAINED_EARNINGS_BF_ID = "retained-earnings-brought-forward";
export const CURRENT_YEAR_EARNINGS_ID = "current-year-earnings";
export const RETAINED_EARNINGS_MOVEMENTS_ID = "retained-earnings-current-year-movements";

/**
 * Balance-sheet accounts carry their cumulative totals through `to`; income
 * and expense accounts carry [from, to] activity only. The P&L before `from`
 * is rolled into a synthetic "Retained earnings brought forward" row, so
 * debits equal credits for every range (R11-02).
 */
export async function trialBalance(
  args: { companyId: string; from?: IsoDate | null; to: IsoDate },
  q: Queryable = pool
): Promise<TrialBalance> {
  const { companyId, to } = args;
  const from = args.from ?? null;
  const [accounts, cumulative, period, prior] = await Promise.all([
    loadAccounts(companyId, q),
    accountTotals(companyId, { to }, q),
    from ? accountTotals(companyId, { from, to }, q) : Promise.resolve(null),
    from ? accountTotals(companyId, { to: addDays(from, -1) }, q) : Promise.resolve(null),
  ]);
  const rows: TrialBalanceRow[] = [];
  let sumD = 0;
  let sumC = 0;
  let sumDB = 0;
  let sumCB = 0;
  for (const a of accounts) {
    const isBs = a.type === "asset" || a.type === "liability" || a.type === "equity";
    const t: AccountTotals = (isBs ? cumulative : (period ?? cumulative)).get(a.id) ?? {
      debit: 0,
      credit: 0,
    };
    const net = t.debit - t.credit;
    sumD += t.debit;
    sumC += t.credit;
    if (net > 0) sumDB += net;
    else sumCB += -net;
    rows.push({
      accountId: a.id,
      accountName: a.nameEn,
      accountNameAr: a.nameAr,
      accountCode: a.code,
      accountType: a.type,
      totalDebit: aed(t.debit),
      totalCredit: aed(t.credit),
      balance: aed(naturalBalance(a.type, t)),
      debitBalance: aed(net > 0 ? net : 0),
      creditBalance: aed(net < 0 ? -net : 0),
      hasForeignLines: t.hasForeign === true,
    });
  }
  const reBf = prior ? netIncomeOf(accounts, prior) : 0;
  if (from) {
    const d = reBf < 0 ? -reBf : 0;
    const c = reBf > 0 ? reBf : 0;
    sumD += d;
    sumC += c;
    sumDB += d;
    sumCB += c;
    rows.push({
      accountId: RETAINED_EARNINGS_BF_ID,
      accountName: "Retained earnings brought forward",
      accountNameAr: "الأرباح المحتجزة المرحلة",
      accountCode: "",
      accountType: "equity",
      totalDebit: aed(d),
      totalCredit: aed(c),
      balance: aed(reBf),
      debitBalance: aed(d),
      creditBalance: aed(c),
      hasForeignLines: false,
      synthetic: true,
    });
  }
  return {
    reportCurrency: await reportCurrencyOf(companyId, q),
    from,
    to,
    rows,
    retainedEarningsBroughtForward: aed(reBf),
    totals: {
      sumDebits: aed(sumD),
      sumCredits: aed(sumC),
      difference: aed(Math.abs(sumD - sumC)),
      sumDebitBalances: aed(sumDB),
      sumCreditBalances: aed(sumCB),
    },
    isBalanced: sumD === sumC && sumDB === sumCB,
  };
}

// ─── Profit and loss ────────────────────────────────────────────────────────

export interface PlTotals {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  operatingExpenses: number;
  /** Revenue − cost of sales − operating expenses (before other items and income tax). */
  operatingProfit: number;
  otherIncome: number;
  otherExpenses: number;
  /** A3 (H3): operating profit + other income − other expenses (IAS 1.82(d)). */
  profitBeforeTax: number;
  /** A3 (H3): corporate / income tax expense, presented after profit before tax (IAS 12.77). */
  incomeTaxExpense: number;
  totalIncome: number;
  /** Every expense including income tax, so totalIncome − totalExpenses = netProfit. */
  totalExpenses: number;
  /** Profit for the period (after tax). */
  netProfit: number;
  /** A3 (H11): other comprehensive income (revaluation surplus movements, IAS 1.81A). */
  otherComprehensiveIncome: number;
  /** A3 (H11): netProfit + otherComprehensiveIncome. */
  totalComprehensiveIncome: number;
}

export interface ProfitAndLoss extends PlTotals {
  reportCurrency: string;
  from: IsoDate | null;
  to: IsoDate;
  sections: {
    revenue: StatementSection;
    costOfSales: StatementSection;
    operatingExpenses: StatementSection;
    otherIncome: StatementSection;
    otherExpenses: StatementSection;
    /** A3 (H3): income tax expense (5200 or an income-tax sub_type). */
    incomeTax: StatementSection;
    /** A3 (H11): items of other comprehensive income (revaluation reserve movements). */
    otherComprehensiveIncome: StatementSection;
  };
  columns?: Array<
    PlTotals & { label: string; from: IsoDate; to: IsoDate; byAccount: Record<string, number> }
  >;
  comparison?: {
    basis: PlCompareTo;
    label: string;
    from: IsoDate | null;
    to: IsoDate;
    budgetId?: string;
    totals: PlTotals;
    byAccount: Record<string, number>;
    variance: PlTotals;
  };
}

export type PlCompareTo = "prior_period" | "prior_year" | "budget";
export type PlColumns = "total" | "monthly" | "quarterly";

/** Signed P&L amount of an account (fils): income credit-normal, expense debit-normal. */
function plAmount(a: ReportAccount, t: AccountTotals | undefined): Fils {
  if (!t) return 0;
  return a.type === "income" ? t.credit - t.debit : t.debit - t.credit;
}

function plFromAmounts(
  accounts: ReportAccount[],
  amountOf: (a: ReportAccount) => Fils,
  oci: Map<string, Fils> = new Map()
) {
  const groups: Record<PlSection, Array<[ReportAccount, Fils]>> = {
    revenue: [],
    cost_of_sales: [],
    operating_expenses: [],
    other_income: [],
    other_expenses: [],
    income_tax: [],
  };
  const ociItems: Array<[ReportAccount, Fils]> = [];
  const byAccount: Record<string, number> = {};
  for (const a of accounts) {
    const s = plSection(a);
    if (!s) continue;
    const f = amountOf(a);
    groups[s].push([a, f]);
    if (f !== 0) byAccount[a.id] = aed(f);
  }
  for (const a of accounts) {
    const f = oci.get(a.id);
    if (f) ociItems.push([a, f]);
  }
  const sum = (k: PlSection) => groups[k].reduce((s, [, f]) => s + f, 0);
  const rev = sum("revenue");
  const cos = sum("cost_of_sales");
  const opex = sum("operating_expenses");
  const oi = sum("other_income");
  const oe = sum("other_expenses");
  const tax = sum("income_tax");
  const ociTotal = ociItems.reduce((s, [, f]) => s + f, 0);
  const pbt = rev - cos - opex + oi - oe;
  const totalsFils = {
    revenue: rev,
    costOfSales: cos,
    grossProfit: rev - cos,
    operatingExpenses: opex,
    operatingProfit: rev - cos - opex,
    otherIncome: oi,
    otherExpenses: oe,
    profitBeforeTax: pbt,
    incomeTaxExpense: tax,
    totalIncome: rev + oi,
    totalExpenses: cos + opex + oe + tax,
    netProfit: pbt - tax,
    otherComprehensiveIncome: ociTotal,
    totalComprehensiveIncome: pbt - tax + ociTotal,
  };
  const totals = Object.fromEntries(
    Object.entries(totalsFils).map(([k, v]) => [k, aed(v)])
  ) as unknown as PlTotals;
  return { groups, ociItems, totals, totalsFils, byAccount };
}

function diffTotals(a: PlTotals, b: PlTotals): PlTotals {
  const out = {} as PlTotals;
  for (const k of Object.keys(a) as Array<keyof PlTotals>) {
    out[k] = aed(Math.round(a[k] * 100) - Math.round(b[k] * 100));
  }
  return out;
}

/** Same-length range immediately before [from, to]. */
export function priorPeriod(from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate } {
  // Whole calendar months shift by months, so Feb compares to Jan, not 28 days.
  if (from.slice(8) === "01" && addDays(to, 1).slice(8) === "01") {
    const months =
      (Number(addDays(to, 1).slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
      (Number(addDays(to, 1).slice(5, 7)) - Number(from.slice(5, 7)));
    return { from: addMonths(from, -months), to: addDays(from, -1) };
  }
  const len = daysBetween(from, to);
  const pTo = addDays(from, -1);
  return { from: addDays(pTo, -len), to: pTo };
}

export function priorYear(
  from: IsoDate | null,
  to: IsoDate
): { from: IsoDate | null; to: IsoDate } {
  return { from: from ? addMonths(from, -12) : null, to: addMonths(to, -12) };
}

async function budgetAmounts(
  companyId: string,
  budgetId: string,
  from: IsoDate,
  to: IsoDate,
  q: Queryable
): Promise<Map<string, Fils>> {
  const plan = await q.query(`SELECT id FROM budget_plans WHERE id = $1 AND company_id = $2`, [
    budgetId,
    companyId,
  ]);
  if (!plan.rows[0]) throw new DomainError("BUDGET_NOT_FOUND", 404);
  const months = buckets(from, to, "month", 240).map((b) => Number(b.from.slice(5, 7)));
  const cols = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const { rows } = await q.query(
    `SELECT account_id, ${cols.map((c) => `ROUND(COALESCE(SUM(${c}),0) * 100)::bigint AS ${c}`).join(", ")}
       FROM budget_lines WHERE budget_id = $1 AND account_id IS NOT NULL GROUP BY account_id`,
    [budgetId]
  );
  const out = new Map<string, Fils>();
  for (const r of rows) {
    let f = 0;
    for (const m of months) f += Number(r[cols[m - 1]]) || 0;
    out.set(r.account_id, f);
  }
  return out;
}

export async function profitAndLoss(
  args: {
    companyId: string;
    from?: IsoDate | null;
    to: IsoDate;
    compareTo?: PlCompareTo | null;
    budgetId?: string | null;
    columns?: PlColumns;
  },
  q: Queryable = pool
): Promise<ProfitAndLoss> {
  const { companyId, to } = args;
  const from = args.from ?? null;
  // PERF-DASH: the reads are independent once the chart is loaded; run them together.
  const accounts = await loadAccounts(companyId, q);
  const [totals, oci, reportCurrency] = await Promise.all([
    accountTotals(companyId, { from, to }, q),
    otherComprehensiveIncome(companyId, accounts, { from, to }, q),
    reportCurrencyOf(companyId, q),
  ]);
  const main = plFromAmounts(accounts, (a) => plAmount(a, totals.get(a.id)), oci);
  const result: ProfitAndLoss = {
    reportCurrency,
    from,
    to,
    ...main.totals,
    sections: {
      revenue: section(main.groups.revenue),
      costOfSales: section(main.groups.cost_of_sales),
      operatingExpenses: section(main.groups.operating_expenses),
      otherIncome: section(main.groups.other_income),
      otherExpenses: section(main.groups.other_expenses),
      incomeTax: section(main.groups.income_tax),
      otherComprehensiveIncome: section(main.ociItems),
    },
  };

  if (args.columns && args.columns !== "total") {
    if (!from) {
      throw new DomainError(
        "REPORT_RANGE_REQUIRED",
        400,
        undefined,
        "from is required for column layouts"
      );
    }
    const gran: Granularity = args.columns === "monthly" ? "month" : "quarter";
    const cols = buckets(from, to, gran);
    result.columns = [];
    for (const b of cols) {
      const t = await accountTotals(companyId, { from: b.from, to: b.to }, q);
      const bo = await otherComprehensiveIncome(companyId, accounts, b, q);
      const p = plFromAmounts(accounts, (a) => plAmount(a, t.get(a.id)), bo);
      result.columns.push({
        label: b.label,
        from: b.from,
        to: b.to,
        ...p.totals,
        byAccount: p.byAccount,
      });
    }
  }

  if (args.compareTo) {
    let cmp: { from: IsoDate | null; to: IsoDate };
    let label: string;
    let amountOf: (a: ReportAccount) => Fils;
    let cmpOci: Map<string, Fils> = new Map();
    if (args.compareTo === "budget") {
      if (!args.budgetId) throw new DomainError("BUDGET_ID_REQUIRED", 400);
      if (!from) throw new DomainError("REPORT_RANGE_REQUIRED", 400);
      const budget = await budgetAmounts(companyId, args.budgetId, from, to, q);
      cmp = { from, to };
      label = "Budget";
      amountOf = (a) => budget.get(a.id) ?? 0;
    } else {
      if (args.compareTo === "prior_period") {
        if (!from) throw new DomainError("REPORT_RANGE_REQUIRED", 400);
        cmp = priorPeriod(from, to);
        label = "Prior period";
      } else {
        cmp = priorYear(from, to);
        label = "Prior year";
      }
      const t = await accountTotals(companyId, cmp, q);
      amountOf = (a) => plAmount(a, t.get(a.id));
      cmpOci = await otherComprehensiveIncome(companyId, accounts, cmp, q);
    }
    const c = plFromAmounts(accounts, amountOf, cmpOci);
    result.comparison = {
      basis: args.compareTo,
      label,
      from: cmp.from,
      to: cmp.to,
      ...(args.budgetId && args.compareTo === "budget" ? { budgetId: args.budgetId } : {}),
      totals: c.totals,
      byAccount: c.byAccount,
      variance: diffTotals(main.totals, c.totals),
    };
  }
  return result;
}

// ─── Balance sheet ──────────────────────────────────────────────────────────

const OVERDRAWN_CASH_ACCOUNTS = "OVERDRAWN_CASH_ACCOUNTS";

export interface BalanceSheet {
  reportCurrency: string;
  asOf: IsoDate;
  fiscalYearStart: IsoDate;
  assets: { current: StatementSection; nonCurrent: StatementSection; total: number };
  liabilities: { current: StatementSection; nonCurrent: StatementSection; total: number };
  equity: {
    capital: StatementSection;
    /** A3 (H11): revaluation / OCI reserves, a separate component of equity (IAS 1.106(d)). */
    reserves: StatementSection;
    retainedEarningsBroughtForward: number;
    /**
     * C2 (NL5): postings to retained earnings in the current fiscal year other than profit
     * (dividends declared, realised revaluation surplus, prior-period corrections). Not part of
     * the balance brought forward (IAS 1.106(d)).
     */
    retainedEarningsMovements: number;
    currentYearEarnings: number;
    total: number;
    /** Capital lines + reserve lines + synthetic retained earnings b/f + current year earnings. */
    lines: StatementLine[];
  };
  warnings?: Array<{ code: typeof OVERDRAWN_CASH_ACCOUNTS; accounts: StatementLine[] }>;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  difference: number;
  comparison?: Omit<BalanceSheet, "comparison"> & { basis: BsCompareTo; label: string };
}

export type BsCompareTo = "prior_year" | "prior_period" | "prior_year_end";

/**
 * C2 (NL5): current-year postings to the retained-earnings account(s) (dividends, transfers,
 * corrections), excluding the go-live opening balance (entry_kind 'opening', which is part of the
 * balance brought forward) and closing entries.
 */
async function retainedEarningsMovementsFils(
  companyId: string,
  reIds: string[],
  fyStart: IsoDate,
  asOf: IsoDate,
  q: Queryable
): Promise<Fils> {
  if (!reIds.length || asOf < fyStart) return 0;
  const { rows } = await q.query(
    `SELECT COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint AS f
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted'
        AND jl.account_id = ANY($2::uuid[])
        AND ${ENTRY_LOCAL_DATE_SQL} >= $3::date AND ${ENTRY_LOCAL_DATE_SQL} <= $4::date
        AND ${NOT_CLOSING_SQL}
        AND COALESCE(je.entry_kind, 'standard') <> 'opening'`,
    [companyId, reIds, fyStart, asOf]
  );
  return Number(rows[0]?.f ?? 0);
}

async function balanceSheetCore(
  companyId: string,
  asOf: IsoDate,
  fsm: number,
  accounts: ReportAccount[],
  q: Queryable
): Promise<Omit<BalanceSheet, "comparison">> {
  const fyStart = fiscalYearStart(asOf, fsm);
  const [cum, preFy] = await Promise.all([
    accountTotals(companyId, { to: asOf }, q),
    accountTotals(companyId, { to: addDays(fyStart, -1) }, q),
  ]);
  const cyTotals = await accountTotals(companyId, { from: fyStart, to: asOf }, q);

  const overdrawnCash: Array<[ReportAccount, Fils]> = [];
  const curA: Array<[ReportAccount, Fils]> = [];
  const nonA: Array<[ReportAccount, Fils]> = [];
  const curL: Array<[ReportAccount, Fils]> = [];
  const nonL: Array<[ReportAccount, Fils]> = [];
  const capital: Array<[ReportAccount, Fils]> = [];
  const reserves: Array<[ReportAccount, Fils]> = [];
  let reAccounts = 0;

  for (const a of accounts) {
    const t = cum.get(a.id);
    if (!t) continue;
    if (a.type === "asset") {
      const net = t.debit - t.credit;
      if (net < 0 && !isContraAsset(a)) {
        if (!isCashAccount(a)) {
          curL.push([a, -net]);
          continue;
        }
        overdrawnCash.push([a, net]);
      }
      (isNonCurrent(a) ? nonA : curA).push([a, net]);
    } else if (a.type === "liability") {
      const net = t.credit - t.debit;
      if (net < 0) curA.push([a, -net]);
      else if (isNonCurrent(a) && isGratuityProvisionAccount(a) && net > 0) {
        // A3 (H10): the end-of-service provision is non-current (IAS 1.69, IAS 19.153); only
        // the provision of known leavers (termination date within 12 months) is current.
        const cur = Math.min(net, await gratuityCurrentPortionFils(companyId, asOf, q));
        if (cur > 0) {
          curL.push([
            {
              ...a,
              id: `${a.id}:current`,
              nameEn: `${a.nameEn} (current portion)`,
              nameAr: a.nameAr ? `${a.nameAr} (الجزء المتداول)` : "الجزء المتداول",
            },
            cur,
          ]);
        }
        nonL.push([a, net - cur]);
      } else (isNonCurrent(a) ? nonL : curL).push([a, net]);
    } else if (a.type === "equity") {
      const net = t.credit - t.debit;
      if (isRetainedEarningsAccount(a)) reAccounts += net;
      else if (isRevaluationReserveAccount(a)) reserves.push([a, net]);
      else capital.push([a, net]);
    }
  }
  const reMovements = await retainedEarningsMovementsFils(
    companyId,
    accounts.filter(isRetainedEarningsAccount).map((a) => a.id),
    fyStart,
    asOf,
    q
  );
  const reBf = netIncomeOf(accounts, preFy) + reAccounts - reMovements;
  const cye = netIncomeOf(accounts, cyTotals);

  const sum = (xs: Array<[ReportAccount, Fils]>) => xs.reduce((s, [, f]) => s + f, 0);
  const totalAssets = sum(curA) + sum(nonA);
  const totalLiabilities = sum(curL) + sum(nonL);
  const totalEquity = sum(capital) + sum(reserves) + reBf + reMovements + cye;
  const diff = totalAssets - totalLiabilities - totalEquity;
  const capitalSection = section(capital);
  const reserveSection = section(reserves);
  return {
    reportCurrency: await reportCurrencyOf(companyId, q),
    asOf,
    fiscalYearStart: fyStart,
    assets: { current: section(curA), nonCurrent: section(nonA), total: aed(totalAssets) },
    liabilities: {
      current: section(curL),
      nonCurrent: section(nonL),
      total: aed(totalLiabilities),
    },
    equity: {
      capital: capitalSection,
      reserves: reserveSection,
      retainedEarningsBroughtForward: aed(reBf),
      retainedEarningsMovements: aed(reMovements),
      currentYearEarnings: aed(cye),
      total: aed(totalEquity),
      lines: [
        ...capitalSection.lines,
        ...reserveSection.lines,
        {
          accountId: RETAINED_EARNINGS_BF_ID,
          accountCode: "",
          accountName: "Retained earnings brought forward",
          accountNameAr: "الأرباح المحتجزة المرحلة",
          amount: aed(reBf),
        },
        ...(reMovements !== 0
          ? [
              {
                accountId: RETAINED_EARNINGS_MOVEMENTS_ID,
                accountCode: "",
                accountName: "Dividends and other movements in retained earnings",
                accountNameAr: "توزيعات الأرباح والحركات الأخرى في الأرباح المحتجزة",
                amount: aed(reMovements),
              },
            ]
          : []),
        {
          accountId: CURRENT_YEAR_EARNINGS_ID,
          accountCode: "",
          accountName: "Current year earnings",
          accountNameAr: "أرباح السنة الحالية",
          amount: aed(cye),
        },
      ],
    },
    ...(overdrawnCash.length
      ? {
          warnings: [{ code: OVERDRAWN_CASH_ACCOUNTS, accounts: section(overdrawnCash).lines }],
        }
      : {}),
    totalAssets: aed(totalAssets),
    totalLiabilities: aed(totalLiabilities),
    totalEquity: aed(totalEquity),
    totalLiabilitiesAndEquity: aed(totalLiabilities + totalEquity),
    isBalanced: diff === 0,
    difference: aed(diff),
  };
}

export async function balanceSheet(
  args: { companyId: string; asOf: IsoDate; compareTo?: BsCompareTo | null },
  q: Queryable = pool
): Promise<BalanceSheet> {
  const company = await loadCompany(args.companyId, q);
  const accounts = await loadAccounts(args.companyId, q);
  const core = await balanceSheetCore(
    args.companyId,
    args.asOf,
    company.fiscalYearStartMonth,
    accounts,
    q
  );
  if (!args.compareTo) return core;
  let cmpDate: IsoDate;
  let label: string;
  if (args.compareTo === "prior_year") {
    cmpDate = addMonths(args.asOf, -12);
    label = "Prior year";
  } else if (args.compareTo === "prior_period") {
    cmpDate = addDays(args.asOf.slice(0, 8) + "01", -1);
    label = "Prior month end";
  } else {
    cmpDate = addDays(fiscalYearStart(args.asOf, company.fiscalYearStartMonth), -1);
    label = "Prior year end";
  }
  const cmp = await balanceSheetCore(
    args.companyId,
    cmpDate,
    company.fiscalYearStartMonth,
    accounts,
    q
  );
  return { ...core, comparison: { ...cmp, basis: args.compareTo, label } };
}

// ─── Cash flow ──────────────────────────────────────────────────────────────

export interface CashFlowLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountNameAr?: string | null;
  amount: number;
  /**
   * A3 (C5): what the line is — net income, a non-cash adjustment (depreciation, impairment,
   * disposal gain/loss, unrealised FX on cash: IAS 7.20), a working-capital or other balance
   * change, or an investing flow derived from the posting (purchases / disposal proceeds of
   * non-current assets: IAS 7.16).
   */
  kind?: "net_income" | "non_cash" | "balance_change" | "purchase" | "proceeds" | "fx_effect";
}

export interface CashFlowStatement {
  reportCurrency: string;
  from: IsoDate | null;
  to: IsoDate;
  method: "indirect" | "direct";
  openingCash: number;
  closingCash: number;
  /** operating + investing + financing + effect of exchange-rate changes. */
  netCashChange: number;
  netIncome: number;
  operating: { total: number; breakdown: CashFlowLine[] };
  investing: { total: number; breakdown: CashFlowLine[] };
  financing: { total: number; breakdown: CashFlowLine[] };
  /** A3 (C5): effect of exchange-rate changes on cash held in foreign currency (IAS 7.28). */
  fxEffect: { total: number; breakdown: CashFlowLine[] };
  /**
   * B2 (NC2): investing and financing transactions that used no cash (an asset bought on credit,
   * a dividend declared but unpaid, a provision charged to equity, a revaluation). Excluded from
   * the statement and disclosed (IAS 7.43).
   */
  nonCashTransactions: Array<{
    entryId: string;
    entryNumber: string | null;
    date: IsoDate;
    memo: string | null;
    source: string | null;
    amount: number;
  }>;
  cashProof: {
    openingCash: number;
    netCashChange: number;
    computedClosingCash: number;
    closingCashPerLedger: number;
    difference: number;
    isBalanced: boolean;
  };
  cashAccounts: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    opening: number;
    closing: number;
  }>;
  /**
   * D1 (N2): go-live opening-balance entries dated inside the period (opening trial balance,
   * opening documents, stock, register and gratuity). They are the opening position, not cash
   * flows (IAS 7.45): their cash is part of `openingCash` and their profit or loss lines (a
   * year-to-date P&L in the opening trial balance) are not in `netIncome`. Null when none.
   */
  openingPosition: { cash: number; netIncome: number } | null;
}

export const NET_INCOME_LINE_ID = "net-income";
export const FX_ON_CASH_LINE_ID = "fx-effect-on-cash";
export const UNREALISED_FX_ON_CASH_LINE_ID = "noncash:fx-unrealised-cash";

type CashFlowKind = NonNullable<CashFlowLine["kind"]>;
type Bucket = Map<string, { fils: Fils; kind: CashFlowKind; account?: ReportAccount }>;
type CashFlowBuckets = Record<CashFlowActivity | "fx", Bucket>;

function addTo(b: Bucket, key: string, fils: Fils, kind: CashFlowKind, account?: ReportAccount) {
  const cur = b.get(key);
  if (cur) cur.fils += fils;
  else b.set(key, { fils, kind, account });
}

const emptyBuckets = (): CashFlowBuckets => ({
  operating: new Map(),
  investing: new Map(),
  financing: new Map(),
  fx: new Map(),
});

/**
 * B2 (NC2, NM1): both methods read the same classified cash flows (cash-flow-classify.ts), so
 * investing, financing and the FX effect are identical and operating is the same total.
 *  - direct: operating cash flows per counter-account;
 *  - indirect: net income + non-cash adjustments (depreciation, impairment, gain / loss on
 *    derecognition, unrealised FX on cash: IAS 7.20) + working-capital changes (each account's
 *    movement less what was classified as investing / financing or excluded as non-cash).
 */
function bucketsFrom(
  c: ClassifiedCashFlows,
  method: "indirect" | "direct",
  byId: Map<string, ReportAccount>,
  netIncome: Fils
): CashFlowBuckets {
  const buckets = emptyBuckets();
  if (method === "indirect") {
    addTo(buckets.operating, NET_INCOME_LINE_ID, netIncome, "net_income");
    for (const [id, f] of Array.from(c.nonCashAdjustments.entries()))
      addTo(buckets.operating, `noncash:${id}`, f, "non_cash", byId.get(id));
    for (const [id, f] of Array.from(c.workingCapital.entries()))
      addTo(buckets.operating, id, f, "balance_change", byId.get(id));
    if (c.fxOnCashFils !== 0)
      addTo(buckets.operating, UNREALISED_FX_ON_CASH_LINE_ID, -c.fxOnCashFils, "non_cash");
  } else {
    for (const [id, v] of Array.from(c.operatingDirect.entries()))
      addTo(buckets.operating, id, v.fils, "balance_change", byId.get(id));
  }
  for (const inv of c.investing)
    addTo(
      buckets.investing,
      `${inv.kind}:${inv.accountId}`,
      inv.fils,
      inv.kind,
      byId.get(inv.accountId)
    );
  for (const [id, v] of Array.from(c.financing.entries()))
    addTo(buckets.financing, id, v.fils, "balance_change", byId.get(id));
  if (c.fxOnCashFils !== 0) addTo(buckets.fx, FX_ON_CASH_LINE_ID, c.fxOnCashFils, "fx_effect");
  return buckets;
}

const CASH_FLOW_LABELS: Record<string, { en: string; ar: string }> = {
  [NET_INCOME_LINE_ID]: { en: "Net income", ar: "صافي الدخل" },
  [UNREALISED_FX_ON_CASH_LINE_ID]: {
    en: "Unrealised exchange differences on cash",
    ar: "فروق صرف غير محققة على النقد",
  },
  [FX_ON_CASH_LINE_ID]: {
    en: "Effect of exchange-rate changes on cash",
    ar: "أثر تغيرات أسعار الصرف على النقد",
  },
};

const KIND_ORDER: Record<CashFlowKind, number> = {
  net_income: 0,
  non_cash: 1,
  balance_change: 2,
  purchase: 3,
  proceeds: 4,
  fx_effect: 5,
};

function cashFlowLine(
  key: string,
  v: { fils: Fils; kind: CashFlowKind; account?: ReportAccount }
): CashFlowLine {
  const fixed = CASH_FLOW_LABELS[key];
  const a = v.account;
  if (fixed || !a) {
    return {
      accountId: key,
      accountCode: "",
      accountName: fixed?.en ?? "Unclassified",
      accountNameAr: fixed?.ar ?? null,
      amount: aed(v.fils),
      kind: v.kind,
    };
  }
  if (v.kind === "purchase" || v.kind === "proceeds") {
    const purchase = v.kind === "purchase";
    return {
      accountId: key,
      accountCode: a.code,
      accountName: `${purchase ? "Purchase of" : "Proceeds from disposal of"} ${a.nameEn}`,
      accountNameAr: `${purchase ? "شراء" : "متحصلات استبعاد"} ${a.nameAr ?? a.nameEn}`,
      amount: aed(v.fils),
      kind: v.kind,
    };
  }
  return {
    accountId: v.kind === "non_cash" ? key : a.id,
    accountCode: a.code,
    accountName: a.nameEn,
    accountNameAr: a?.nameAr ?? null,
    amount: aed(v.fils),
    kind: v.kind,
  };
}

export async function cashFlow(
  args: { companyId: string; from?: IsoDate | null; to: IsoDate; method?: "indirect" | "direct" },
  q: Queryable = pool
): Promise<CashFlowStatement> {
  const { companyId, to } = args;
  const from = args.from ?? null;
  const method = args.method ?? "indirect";
  const accounts = await loadAccounts(companyId, q);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cashIds = new Set(accounts.filter(isCashAccount).map((a) => a.id));
  // D1 (N2): the go-live opening entries in range are the opening position, not flows.
  const [range, opening, openingEntries] = await Promise.all([
    accountTotals(companyId, { from, to, opening: "exclude" }, q),
    from ? accountTotals(companyId, { to: addDays(from, -1) }, q) : Promise.resolve(new Map()),
    accountTotals(companyId, { from, to, opening: "only" }, q),
  ]);

  let openFils = 0;
  let moveFils = 0;
  let openingEntryCash = 0;
  const cashAccounts: CashFlowStatement["cashAccounts"] = [];
  for (const id of Array.from(cashIds)) {
    const a = byId.get(id)!;
    const o = opening.get(id);
    const r = range.get(id);
    const oe = openingEntries.get(id);
    const oeFils = oe ? oe.debit - oe.credit : 0;
    openingEntryCash += oeFils;
    const of = (o ? o.debit - o.credit : 0) + oeFils;
    const mv = r ? r.debit - r.credit : 0;
    openFils += of;
    moveFils += mv;
    if (of !== 0 || mv !== 0)
      cashAccounts.push({
        accountId: id,
        accountCode: a.code,
        accountName: a.nameEn,
        opening: aed(of),
        closing: aed(of + mv),
      });
  }

  const netIncome = netIncomeOf(accounts, range);
  const classified = await classifyCashFlows(companyId, { from, to }, accounts, q);
  const buckets = bucketsFrom(classified, method, byId, netIncome);

  const build = (act: CashFlowActivity | "fx") => {
    const breakdown: CashFlowLine[] = [];
    let total = 0;
    for (const [key, v] of Array.from(buckets[act].entries())) {
      total += v.fils;
      if (v.fils === 0 && v.kind !== "net_income") continue;
      breakdown.push(cashFlowLine(key, v));
    }
    breakdown.sort(
      (x, y) =>
        KIND_ORDER[x.kind ?? "balance_change"] - KIND_ORDER[y.kind ?? "balance_change"] ||
        x.accountCode.localeCompare(y.accountCode) ||
        x.accountName.localeCompare(y.accountName)
    );
    return { total, section: { total: aed(total), breakdown } };
  };
  const op = build("operating");
  const inv = build("investing");
  const fin = build("financing");
  const fx = build("fx");
  const computedNet = op.total + inv.total + fin.total + fx.total;
  return {
    reportCurrency: await reportCurrencyOf(companyId, q),
    from,
    to,
    method,
    openingCash: aed(openFils),
    closingCash: aed(openFils + moveFils),
    netCashChange: aed(computedNet),
    netIncome: aed(netIncome),
    operating: op.section,
    investing: inv.section,
    financing: fin.section,
    fxEffect: fx.section,
    nonCashTransactions: classified.nonCashTransactions.map((t) => ({
      entryId: t.entryId,
      entryNumber: t.entryNumber,
      date: t.date,
      memo: t.memo,
      source: t.source,
      amount: aed(t.amountFils),
    })),
    cashProof: {
      openingCash: aed(openFils),
      netCashChange: aed(computedNet),
      computedClosingCash: aed(openFils + computedNet),
      closingCashPerLedger: aed(openFils + moveFils),
      difference: aed(openFils + moveFils - (openFils + computedNet)),
      isBalanced: moveFils === computedNet,
    },
    cashAccounts,
    openingPosition: openingEntries.size
      ? { cash: aed(openingEntryCash), netIncome: aed(netIncomeOf(accounts, openingEntries)) }
      : null,
  };
}

/**
 * Bucketed direct-method cash movement (inflow/outflow per activity) for the
 * legacy /api/reports/:companyId/cash-flow/:period endpoint.
 */
export async function cashFlowBuckets(
  args: { companyId: string; from: IsoDate; to: IsoDate; granularity: Granularity },
  q: Queryable = pool
) {
  const { companyId, from, to } = args;
  const accounts = await loadAccounts(companyId, q);
  const cashIds = new Set(accounts.filter(isCashAccount).map((a) => a.id));
  const periods = buckets(from, to, args.granularity);
  // PERF-DASH: no bucket's reads depend on the running balance, so every bucket is read at once
  // (classification and go-live opening totals grouped by bucket in SQL), then the running
  // balance is folded in bucket order: the same figures as reading bucket by bucket.
  const ranges = periods.map((b) => ({ from: b.from, to: b.to }));
  const [opening, classified, openingOnly] = await Promise.all([
    accountTotals(companyId, { to: addDays(from, -1) }, q),
    classifyCashFlowsByBucket(companyId, ranges, accounts, q),
    accountTotalsByBucket(companyId, ranges, { opening: "only" }, q),
  ]);
  let running = 0;
  for (const id of Array.from(cashIds)) {
    const t = opening.get(id);
    if (t) running += t.debit - t.credit;
  }
  const openingCash = running;
  const out = [];
  // B2 (NC2): each bucket classifies its cash legs exactly as the cash-flow statement does.
  for (let i = 0; i < periods.length; i++) {
    const b = periods[i];
    const c = classified[i];
    const oe = openingOnly[i];
    // D1 (N2): go-live opening entries in the bucket move the balance, not the flows.
    let openingBalanceFils = 0;
    for (const id of Array.from(cashIds)) {
      const t = oe.get(id);
      if (t) openingBalanceFils += t.debit - t.credit;
    }
    const flows = { operating: [0, 0], investing: [0, 0], financing: [0, 0] } as Record<
      CashFlowActivity,
      [number, number]
    >;
    for (const v of Array.from(c.operatingDirect.values())) {
      flows.operating[0] += v.inFils;
      flows.operating[1] -= v.outFils;
    }
    // The FX revaluation of cash has no column of its own here; it moves the running balance.
    if (c.fxOnCashFils > 0) flows.operating[0] += c.fxOnCashFils;
    else flows.operating[1] -= c.fxOnCashFils;
    for (const inv of c.investing) {
      if (inv.fils > 0) flows.investing[0] += inv.fils;
      else flows.investing[1] -= inv.fils;
    }
    for (const v of Array.from(c.financing.values())) {
      flows.financing[0] += v.inFils;
      flows.financing[1] -= v.outFils;
    }
    const net =
      flows.operating[0] -
      flows.operating[1] +
      flows.investing[0] -
      flows.investing[1] +
      flows.financing[0] -
      flows.financing[1];
    running += openingBalanceFils + net;
    out.push({
      period: b.label,
      from: b.from,
      to: b.to,
      operatingInflow: aed(flows.operating[0]),
      operatingOutflow: aed(flows.operating[1]),
      investingInflow: aed(flows.investing[0]),
      investingOutflow: aed(flows.investing[1]),
      financingInflow: aed(flows.financing[0]),
      financingOutflow: aed(flows.financing[1]),
      netCashFlow: aed(net),
      openingBalanceCash: aed(openingBalanceFils),
      endingBalance: aed(running),
    });
  }
  return { openingCash: aed(openingCash), buckets: out };
}

// ─── General ledger ─────────────────────────────────────────────────────────

export interface GeneralLedgerAccount {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Arabic account name when the chart has one (Arabic statement PDFs, P15). */
  accountNameAr?: string | null;
  accountType: string;
  openingBalance: number;
  debitTotal: number;
  creditTotal: number;
  closingBalance: number;
  lines: Array<{
    date: IsoDate;
    entryId: string;
    entryNumber: string;
    memo: string | null;
    memoKey?: string | null;
    memoParams?: Record<string, string> | null;
    description: string | null;
    /** Stored key + params of the line's own description (migration 0132). */
    lineKey?: string | null;
    lineParams?: Record<string, string> | null;
    source: string;
    debit: number;
    credit: number;
    balance: number;
    isClosingEntry: boolean;
  }>;
}

export interface GeneralLedger {
  reportCurrency: string;
  from: IsoDate | null;
  to: IsoDate;
  accounts: GeneralLedgerAccount[];
  totals: { debit: number; credit: number };
  truncated: boolean;
}

const GL_LINE_LIMIT = 50_000;

/**
 * General ledger across all (or selected) accounts. Balance-sheet accounts
 * open with their cumulative balance; income/expense accounts open with the
 * fiscal-year-to-date balance before `from` (they reset each fiscal year).
 */
export async function generalLedger(
  args: {
    companyId: string;
    from?: IsoDate | null;
    to: IsoDate;
    accountIds?: string[] | null;
    includeClosing?: boolean;
    includeEmpty?: boolean;
  },
  q: Queryable = pool
): Promise<GeneralLedger> {
  const { companyId, to } = args;
  const from = args.from ?? null;
  const company = await loadCompany(companyId, q);
  let accounts = await loadAccounts(companyId, q);
  if (args.accountIds?.length) {
    const want = new Set(args.accountIds);
    accounts = accounts.filter((a) => want.has(a.id));
    if (!accounts.length) throw new DomainError("ACCOUNT_NOT_FOUND", 404);
  }
  const ids = accounts.map((a) => a.id);
  const fyStart = from ? fiscalYearStart(from, company.fiscalYearStartMonth) : null;
  const [bsOpen, plOpen, lines] = await Promise.all([
    from
      ? accountTotals(companyId, { to: addDays(from, -1), includeClosing: args.includeClosing }, q)
      : Promise.resolve(new Map()),
    from && fyStart && fyStart < from
      ? accountTotals(
          companyId,
          { from: fyStart, to: addDays(from, -1), includeClosing: args.includeClosing },
          q
        )
      : Promise.resolve(new Map()),
    ledgerLines(
      companyId,
      { from, to, accountIds: ids, includeClosing: args.includeClosing, limit: GL_LINE_LIMIT + 1 },
      q
    ),
  ]);
  const truncated = lines.length > GL_LINE_LIMIT;
  const linesByAccount = new Map<string, typeof lines>();
  for (const l of lines.slice(0, GL_LINE_LIMIT)) {
    const list = linesByAccount.get(l.accountId) ?? [];
    list.push(l);
    linesByAccount.set(l.accountId, list);
  }
  let totD = 0;
  let totC = 0;
  const out: GeneralLedgerAccount[] = [];
  for (const a of accounts) {
    const isBs = a.type === "asset" || a.type === "liability" || a.type === "equity";
    const openT = (isBs ? bsOpen : plOpen).get(a.id) as AccountTotals | undefined;
    const open = naturalBalance(a.type, openT);
    const own = linesByAccount.get(a.id) ?? [];
    if (!own.length && open === 0 && !args.includeEmpty) continue;
    const debitNormal = a.type === "asset" || a.type === "expense";
    let bal = open;
    let d = 0;
    let c = 0;
    const rows = own.map((l) => {
      bal += debitNormal ? l.debit - l.credit : l.credit - l.debit;
      d += l.debit;
      c += l.credit;
      return {
        date: l.date,
        entryId: l.entryId,
        entryNumber: l.entryNumber,
        memo: l.memo,
        memoKey: l.memoKey,
        memoParams: l.memoParams,
        description: l.description,
        lineKey: l.lineKey,
        lineParams: l.lineParams,
        source: l.source,
        debit: aed(l.debit),
        credit: aed(l.credit),
        balance: aed(bal),
        isClosingEntry: l.isClosingEntry,
      };
    });
    totD += d;
    totC += c;
    out.push({
      accountId: a.id,
      accountCode: a.code,
      accountName: a.nameEn,
      accountNameAr: a.nameAr,
      accountType: a.type,
      openingBalance: aed(open),
      debitTotal: aed(d),
      creditTotal: aed(c),
      closingBalance: aed(bal),
      lines: rows,
    });
  }
  return {
    reportCurrency: await reportCurrencyOf(companyId, q),
    from,
    to,
    accounts: out,
    totals: { debit: aed(totD), credit: aed(totC) },
    truncated,
  };
}

// ─── Cash accounts ──────────────────────────────────────────────────────────

export async function cashAccounts(
  companyId: string,
  asOf?: IsoDate | null,
  q: Queryable = pool
): Promise<
  Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    subType: string | null;
    balance: number;
  }>
> {
  const accounts = (await loadAccounts(companyId, q)).filter(isCashAccount);
  const totals = await accountTotals(companyId, { to: asOf ?? null }, q);
  return accounts.map((a) => ({
    accountId: a.id,
    accountCode: a.code,
    accountName: a.nameEn,
    subType: a.subType,
    balance: aed(naturalBalance("asset", totals.get(a.id))),
  }));
}
