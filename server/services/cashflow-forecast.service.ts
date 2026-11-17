/**
 * Cash forecast v2 (W3-E: R13-01, R13-06, R13-23, R13-24, R13-25, R12-04).
 *
 * Document driven, never extrapolated:
 *   - opening cash = cash/bank accounts through the reporting kernel;
 *   - inflows = remaining balances of sent/partial invoices on their due date
 *     (overdue ones on an assumed recovery date), plus due recurring invoices;
 *   - outflows = remaining balances of approved vendor bills on their due
 *     date, payroll, VAT and corporate-tax due amounts, and manual scheduled
 *     items (loan repayments, one-offs);
 *   - what-if: delay receipts, add one-off adjustments, pick bank accounts.
 * With no open documents and no scheduled items the forecast says so
 * ("insufficient data") instead of inventing weekly averages.
 */
import { pool } from "../db";
import { DomainError } from "../errors";
import { cashForecastCopy, type CopyDescriptor } from "../../shared/server-copy";
import {
  accountTotals,
  addDays,
  addMonths,
  agedPayables,
  agedReceivables,
  aed,
  cashAccounts,
  fiscalYearStart,
  loadAccounts,
  loadCompany,
  monthEnd,
  monthStart,
  naturalBalance,
  profitAndLoss,
  uaeToday,
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  type IsoDate,
  type Queryable,
} from "../reporting";
import { computeCtLiability } from "../../shared/ct-workpaper";
import { UAE_CT_EXEMPTION_THRESHOLD } from "../constants";
import type { CashFlowForecast } from "../../shared/schema";

const db: Queryable = pool as unknown as Queryable;

export type ForecastScenario = "base" | "conservative" | "optimistic";
export type ForecastItemKind =
  | "receivable"
  | "payable"
  | "recurring_invoice"
  | "payroll"
  | "vat"
  | "corporate_tax"
  | "loan_repayment"
  | "one_off_inflow"
  | "one_off_outflow"
  | "what_if";

export interface ForecastItem {
  kind: ForecastItemKind;
  date: IsoDate;
  /** Signed AED: inflow positive, outflow negative. */
  amount: number;
  description: string;
  sourceId?: string;
  /** Present when the date is an assumption (overdue recovery, delayed receipt). */
  note?: string;
}

export interface ForecastAdjustment {
  date: IsoDate;
  /** Positive AED amount. */
  amount: number;
  direction: "inflow" | "outflow";
  description: string;
}

export interface ForecastOptions {
  days?: number;
  scenario?: ForecastScenario;
  /** GL cash account ids and/or bank_accounts ids; empty = every cash/bank account. */
  accountIds?: string[];
  delayReceiptsDays?: number;
  adjustments?: ForecastAdjustment[];
}

export interface WeeklyProjection {
  week: number;
  weekStart: string;
  weekEnd: string;
  expectedInflows: number;
  expectedOutflows: number;
  projectedBalance: number;
  components: Partial<Record<ForecastItemKind, number>>;
}

export interface CashFlowForecastResult {
  asOf: IsoDate;
  horizonDays: number;
  scenario: ForecastScenario;
  currentBalance: number;
  accounts: Array<{ accountId: string; accountCode: string; accountName: string; balance: number }>;
  projections: WeeklyProjection[];
  items: ForecastItem[];
  insights: string[];
  /** Same sentences as `insights` as stable message keys + params (client localises). */
  insightMessages: CopyDescriptor[];
  insufficientData: boolean;
  assumptions: string[];
  assumptionMessages: CopyDescriptor[];
  summary: {
    receivablesOpen: number;
    receivablesOverdue: number;
    payablesOpen: number;
    minProjectedBalance: number;
    minProjectedWeek: number | null;
    projectedShortfall: number;
  };
}

const fils = (n: number) => Math.round(n * 100);

export function stepDate(date: IsoDate, frequency: string): IsoDate | null {
  switch (frequency) {
    case "weekly":
      return addDays(date, 7);
    case "fortnightly":
    case "biweekly":
      return addDays(date, 14);
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "half_yearly":
    case "semiannual":
      return addMonths(date, 6);
    case "yearly":
    case "annually":
      return addMonths(date, 12);
    default:
      return null;
  }
}

const localDate = (col: string) => `((${col} + interval '4 hours')::date)::text`;

async function loadScheduledItems(companyId: string, from: IsoDate, to: IsoDate) {
  const { rows } = await db.query(
    `SELECT id, kind, description, amount, due_date::text AS due_date, repeat_months,
            occurrences, bank_account_id
       FROM cash_forecast_items
      WHERE company_id = $1 AND is_active = true`,
    [companyId]
  );
  const out: ForecastItem[] = [];
  for (const r of rows) {
    const n = Math.max(1, Number(r.occurrences) || 1);
    const step = Math.max(0, Number(r.repeat_months) || 0);
    for (let i = 0; i < n; i++) {
      const date = step > 0 ? addMonths(String(r.due_date), step * i) : String(r.due_date);
      if (date < from || date > to) continue;
      const inflow = r.kind === "one_off_inflow";
      out.push({
        kind: r.kind as ForecastItemKind,
        date,
        amount: inflow ? Number(r.amount) : -Number(r.amount),
        description: String(r.description),
        sourceId: String(r.id),
      });
      if (step === 0) break;
    }
  }
  return out;
}

async function loadRecurringInvoices(companyId: string, today: IsoDate, to: IsoDate) {
  const { rows } = await db.query(
    `SELECT id, customer_name, frequency, ${localDate("next_run_date")} AS next_run,
            ${localDate("end_date")} AS ends, lines_json
       FROM recurring_invoices WHERE company_id = $1 AND is_active = true`,
    [companyId]
  );
  const out: ForecastItem[] = [];
  for (const r of rows) {
    let lines: Array<{ quantity?: number; unitPrice?: number; vatRate?: number }> = [];
    try {
      lines = JSON.parse(String(r.lines_json));
    } catch {
      continue;
    }
    if (!Array.isArray(lines)) continue;
    let gross = 0;
    for (const l of lines) {
      const net = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      gross += net * (1 + (l.vatRate ?? 0.05));
    }
    gross = aed(fils(gross));
    if (gross <= 0) continue;
    let run: IsoDate | null = String(r.next_run);
    let guard = 0;
    while (run && run <= to && guard++ < 60) {
      if (r.ends && run > String(r.ends)) break;
      // Invoice issued on the run date and, on net-30 terms, collected 30 days later.
      const collect = addDays(run, 30);
      if (collect >= today && collect <= to) {
        out.push({
          kind: "recurring_invoice",
          date: collect,
          amount: gross,
          description: `Recurring invoice – ${r.customer_name}`,
          sourceId: String(r.id),
          note: "Assumes net-30 collection after the run date",
        });
      }
      run = stepDate(run, String(r.frequency));
    }
  }
  return out;
}

async function loadPayroll(companyId: string, today: IsoDate, to: IsoDate) {
  const { rows } = await db.query(
    `SELECT period_year, period_month, total_net, status
       FROM payroll_runs WHERE company_id = $1
      ORDER BY period_year DESC, period_month DESC LIMIT 12`,
    [companyId]
  );
  if (rows.length === 0) return [] as ForecastItem[];
  const latest = rows[0];
  const monthlyNet = Number(latest.total_net) || 0;
  if (monthlyNet <= 0) return [];
  const have = new Set(
    rows.map((r) => `${r.period_year}-${String(r.period_month).padStart(2, "0")}`)
  );
  const out: ForecastItem[] = [];
  let cursor = monthStart(today);
  for (let i = 0; i < 14 && cursor <= to; i++) {
    const key = cursor.slice(0, 7);
    const payDate = monthEnd(cursor);
    const run = rows.find(
      (r) => `${r.period_year}-${String(r.period_month).padStart(2, "0")}` === key
    );
    if (payDate >= today && payDate <= to) {
      if (!have.has(key) || (run && run.status !== "paid")) {
        out.push({
          kind: "payroll",
          date: payDate,
          amount: -(run ? Number(run.total_net) : monthlyNet),
          description: `Payroll ${key}`,
          note: run ? undefined : "Estimated from the latest payroll run",
        });
      }
    }
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/**
 * X4 (J3): known payroll liabilities that are not a monthly run: posted-but-unpaid final
 * settlements (Salaries Payable, due 14 days after termination — Art. 53 reading) and the
 * GPSSA contribution balance (2032 Pension Payable, assumed due on the 15th of next month).
 */
async function loadPayrollLiabilities(companyId: string, today: IsoDate, to: IsoDate) {
  const out: ForecastItem[] = [];
  const { rows } = await db.query(
    `SELECT s.id, s.net_amount, to_char(s.termination_date, 'YYYY-MM-DD') AS term, e.full_name
       FROM payroll_settlements s JOIN employees e ON e.id = s.employee_id
      WHERE s.company_id = $1 AND s.status = 'posted' AND s.net_amount > 0`,
    [companyId]
  );
  for (const r of rows) {
    const due = addDays(String(r.term), 14);
    const date = due < today ? today : due;
    if (date > to) continue;
    out.push({
      kind: "payroll",
      date,
      amount: -(Number(r.net_amount) || 0),
      description: `Final settlement – ${r.full_name}`,
      sourceId: String(r.id),
      note: due < today ? "Past the 14-day settlement deadline; assumed paid today" : undefined,
    });
  }
  const [accounts, totals] = await Promise.all([
    loadAccounts(companyId),
    accountTotals(companyId, { to: today }),
  ]);
  const pension = accounts.find((a) => a.code === "2032" && a.type === "liability");
  if (pension) {
    const balanceFils = naturalBalance("liability", totals.get(pension.id));
    if (balanceFils > 0) {
      const date = addDays(monthEnd(today), 15);
      if (date <= to) {
        out.push({
          kind: "payroll",
          date,
          amount: -aed(balanceFils),
          description: "GPSSA pension contributions payable",
          sourceId: pension.id,
          note: "Amount = 2032 Pension Payable balance; due date assumed (15th of next month)",
        });
      }
    }
  }
  return out;
}

async function loadTaxDues(companyId: string, today: IsoDate, to: IsoDate) {
  const out: ForecastItem[] = [];
  const [accounts, totals, fy] = await Promise.all([
    loadAccounts(companyId),
    accountTotals(companyId, { to: today }),
    loadCompany(companyId),
  ]);
  let vatNet = 0; // fils
  for (const a of accounts) {
    if (!/\bvat\b|value added/i.test(a.nameEn)) continue;
    const t = totals.get(a.id);
    if (a.type === "liability") vatNet += naturalBalance("liability", t);
    else if (a.type === "asset") vatNet -= naturalBalance("asset", t);
  }
  const calendar = await db.query(
    `SELECT id, event_type, description, ${localDate("event_date")} AS d, status,
            period_start::text AS period_start, period_end::text AS period_end
       FROM compliance_calendar
      WHERE company_id = $1 AND status <> 'completed'
        AND event_date::date BETWEEN $2::date AND $3::date`,
    [companyId, today, to]
  );
  const vatRows = calendar.rows.filter((r) => /vat/i.test(String(r.event_type)));
  const ctRows = calendar.rows.filter((r) => /corporate|\bct\b/i.test(String(r.event_type)));

  if (vatNet > 0) {
    if (vatRows.length > 0) {
      const r = vatRows[0];
      out.push({
        kind: "vat",
        date: String(r.d),
        amount: -aed(vatNet),
        // X4 (J3): a template sentence (localised in the UI), never the calendar's free text.
        description:
          r.period_start && r.period_end
            ? `VAT return payment ${String(r.period_start).slice(0, 10)} to ${String(r.period_end).slice(0, 10)}`
            : "VAT return payment",
        sourceId: String(r.id),
        note: "Amount = current VAT payable balance in the ledger",
      });
    } else {
      const draft = await db.query(
        `SELECT id, ${localDate("due_date")} AS d, box14_payable_tax
           FROM vat_returns
          WHERE company_id = $1 AND status = 'draft'
          ORDER BY period_end DESC LIMIT 1`,
        [companyId]
      );
      const r = draft.rows[0];
      if (r && String(r.d) >= today && String(r.d) <= to) {
        const amount = Number(r.box14_payable_tax) || aed(vatNet);
        out.push({
          kind: "vat",
          date: String(r.d),
          amount: -aed(fils(amount)),
          description: "VAT return payment (latest draft return)",
          sourceId: String(r.id),
        });
      }
    }
  }

  if (ctRows.length > 0) {
    const ytdFrom = fiscalYearStart(today, fy.fiscalYearStartMonth);
    const pl = await profitAndLoss({ companyId, from: ytdFrom, to: today });
    const ct = computeCtLiability({
      totalRevenue: Math.max(0, pl.totalIncome),
      totalExpenses: Math.max(0, pl.totalExpenses),
      totalDeductions: 0,
      exemptionThreshold: UAE_CT_EXEMPTION_THRESHOLD,
      taxRate: 0.09,
    });
    if (ct.taxPayable > 0) {
      const r = ctRows[0];
      out.push({
        kind: "corporate_tax",
        date: String(r.d),
        amount: -aed(fils(ct.taxPayable)),
        description:
          r.period_start && r.period_end
            ? `Corporate tax payment ${String(r.period_start).slice(0, 10)} to ${String(r.period_end).slice(0, 10)}`
            : "Corporate tax payment",
        sourceId: String(r.id),
        note: "Estimate from fiscal-year-to-date ledger profit",
      });
    }
  }
  return out;
}

async function resolveCashAccounts(companyId: string, today: IsoDate, accountIds: string[]) {
  const cash = await cashAccounts(companyId, today);
  if (accountIds.length === 0) return cash;
  const { rows } = await db.query(
    `SELECT id, gl_account_id FROM bank_accounts WHERE company_id = $1`,
    [companyId]
  );
  const glFromBank = new Map(rows.map((r) => [String(r.id), r.gl_account_id as string | null]));
  const wanted = new Set<string>();
  for (const id of accountIds) {
    wanted.add(id);
    const gl = glFromBank.get(id);
    if (gl) wanted.add(gl);
  }
  const picked = cash.filter((c) => wanted.has(c.accountId));
  if (picked.length === 0) {
    throw new DomainError(
      "FORECAST_ACCOUNT_NOT_FOUND",
      400,
      { accountIds },
      "None of the selected accounts is a cash or bank account of this company"
    );
  }
  return picked;
}

export async function generateCashFlowForecast(
  companyId: string,
  options: ForecastOptions | number = {}
): Promise<CashFlowForecastResult> {
  const opts: ForecastOptions = typeof options === "number" ? { days: options } : options;
  const days = Math.min(Math.max(Math.trunc(opts.days ?? 90), 7), 365);
  const scenario: ForecastScenario = opts.scenario ?? "base";
  const today = uaeToday();
  const horizonEnd = addDays(today, days - 1);

  const delay =
    opts.delayReceiptsDays !== undefined
      ? Math.max(0, Math.min(Math.trunc(opts.delayReceiptsDays), 180))
      : scenario === "conservative"
        ? 14
        : 0;
  const overdueRecoveryDays = scenario === "optimistic" ? 3 : scenario === "conservative" ? 30 : 7;

  const assumptionCopy = [
    cashForecastCopy("cashForecast.assumeOpeningBalance"),
    cashForecastCopy("cashForecast.assumeInvoices", { days: overdueRecoveryDays }),
    cashForecastCopy("cashForecast.assumeBills"),
    cashForecastCopy("cashForecast.assumeNoExtrapolation"),
  ];
  if (delay > 0) assumptionCopy.push(cashForecastCopy("cashForecast.assumeDelay", { days: delay }));
  const assumptions = assumptionCopy.map((c) => c.text);

  const [accts, ar, ap, scheduled, recurring, payroll, taxes, payrollLiabilities] =
    await Promise.all([
      resolveCashAccounts(companyId, today, opts.accountIds ?? []),
      agedReceivables({ companyId, asOf: today }),
      agedPayables({ companyId, asOf: today }),
      loadScheduledItems(companyId, today, horizonEnd),
      loadRecurringInvoices(companyId, today, horizonEnd),
      loadPayroll(companyId, today, horizonEnd),
      loadTaxDues(companyId, today, horizonEnd),
      loadPayrollLiabilities(companyId, today, horizonEnd),
    ]);

  const openingFils = accts.reduce((s, a) => s + fils(a.balance), 0);
  const items: ForecastItem[] = [];

  let receivablesOverdue = 0;
  for (const d of ar.documents) {
    if (d.open <= 0) continue;
    const overdue = d.dueDate < today;
    let date = overdue ? addDays(today, overdueRecoveryDays) : d.dueDate;
    if (overdue) receivablesOverdue += fils(d.open);
    let note: string | undefined = overdue
      ? `Overdue by ${d.daysPastDue} day(s); recovery date is an assumption`
      : undefined;
    if (delay > 0) {
      date = addDays(date, delay);
      note = `${note ? note + "; " : ""}delayed ${delay} day(s)`;
    }
    items.push({
      kind: "receivable",
      date,
      amount: d.open,
      description: `Invoice ${d.number ?? ""} – ${d.name}`.trim(),
      sourceId: d.documentId,
      note,
    });
  }
  for (const d of ap.documents) {
    if (d.open <= 0) continue;
    const date = d.dueDate < today ? today : d.dueDate;
    items.push({
      kind: "payable",
      date,
      amount: -d.open,
      description: `Bill ${d.number ?? ""} – ${d.name}`.trim(),
      sourceId: d.documentId,
      note:
        d.dueDate < today ? `Overdue by ${d.daysPastDue} day(s); assumed paid today` : undefined,
    });
  }
  for (const r of recurring) {
    const date = delay > 0 ? addDays(r.date, delay) : r.date;
    if (date <= horizonEnd) items.push({ ...r, date });
  }
  items.push(...scheduled, ...payroll, ...payrollLiabilities, ...taxes);
  for (const a of opts.adjustments ?? []) {
    items.push({
      kind: "what_if",
      date: a.date < today ? today : a.date,
      amount: a.direction === "inflow" ? a.amount : -a.amount,
      description: a.description,
    });
  }

  const inHorizon = items
    .filter((i) => i.date >= today && i.date <= horizonEnd)
    .sort((a, b) => a.date.localeCompare(b.date));

  const weeks = Math.ceil(days / 7);
  const projections: WeeklyProjection[] = [];
  let running = openingFils;
  let minBalance = openingFils;
  let minWeek: number | null = null;
  for (let w = 1; w <= weeks; w++) {
    const weekStart = addDays(today, (w - 1) * 7);
    const weekEnd = addDays(weekStart, 6);
    let inflow = 0;
    let outflow = 0;
    const components: Partial<Record<ForecastItemKind, number>> = {};
    for (const it of inHorizon) {
      if (it.date < weekStart || it.date > weekEnd) continue;
      const f = fils(it.amount);
      if (f >= 0) inflow += f;
      else outflow += -f;
      components[it.kind] = aed(fils(components[it.kind] ?? 0) + f);
    }
    running += inflow - outflow;
    if (running < minBalance) {
      minBalance = running;
      minWeek = w;
    }
    projections.push({
      week: w,
      weekStart,
      weekEnd: weekEnd > horizonEnd ? horizonEnd : weekEnd,
      expectedInflows: aed(inflow),
      expectedOutflows: aed(outflow),
      projectedBalance: aed(running),
      components,
    });
  }

  const insightCopy: Array<{ text: string; message: CopyDescriptor }> = [];
  const insufficientData = inHorizon.length === 0;
  const fmt = (n: number) =>
    n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (insufficientData) {
    insightCopy.push(cashForecastCopy("cashForecast.insufficientData"));
  }
  const negative = projections.find((p) => p.projectedBalance < 0);
  if (negative) {
    insightCopy.push(
      cashForecastCopy("cashForecast.negativeBalance", {
        amount: fmt(Math.abs(negative.projectedBalance)),
        week: negative.week,
        weekStart: negative.weekStart,
      })
    );
  } else {
    const low = projections.find((p) => p.projectedBalance < 10000);
    if (low && !insufficientData) {
      insightCopy.push(
        cashForecastCopy("cashForecast.lowCash", { week: low.week, weekStart: low.weekStart })
      );
    }
  }
  if (receivablesOverdue > 0) {
    const overdueCount = ar.documents.filter((d) => d.dueDate < today && d.open > 0).length;
    insightCopy.push(
      cashForecastCopy("cashForecast.overdueReceivables", {
        amount: fmt(aed(receivablesOverdue)),
        count: overdueCount,
        days: overdueRecoveryDays,
      })
    );
  }
  if (ap.totals.total > 0) {
    insightCopy.push(
      cashForecastCopy("cashForecast.openPayables", { amount: fmt(ap.totals.total) })
    );
  }
  const insights = insightCopy.map((c) => c.text);

  return {
    asOf: today,
    horizonDays: days,
    scenario,
    currentBalance: aed(openingFils),
    accounts: accts.map((a) => ({
      accountId: a.accountId,
      accountCode: a.accountCode,
      accountName: a.accountName,
      balance: a.balance,
    })),
    projections,
    items: inHorizon,
    insights,
    insightMessages: insightCopy.map((c) => c.message),
    insufficientData,
    assumptions,
    assumptionMessages: assumptionCopy.map((c) => c.message),
    summary: {
      receivablesOpen: ar.totals.total,
      receivablesOverdue: aed(receivablesOverdue),
      payablesOpen: ap.totals.total,
      minProjectedBalance: aed(minBalance),
      minProjectedWeek: minWeek,
      projectedShortfall: aed(Math.max(0, -minBalance)),
    },
  };
}

export interface MonthlyCashHistory {
  month: string;
  year: number;
  monthNum: number;
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Actual monthly income/expense history from the posted ledger (SQL, UAE
 * calendar months). Kept under its legacy route name; the figures are
 * accrual income/expense, not bank cash — see the cash-in/out chart on the
 * dashboard for bank movement.
 */
export async function getCashFlowHistory(
  companyId: string,
  months: number = 6
): Promise<MonthlyCashHistory[]> {
  const today = uaeToday();
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const keys: Array<{ year: number; month: number }> = [];
  for (let i = 0; i < months; i++) {
    keys.unshift({ year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const first = `${keys[0].year}-${String(keys[0].month).padStart(2, "0")}-01`;
  const { rows } = await db.query(
    `SELECT to_char(${ENTRY_LOCAL_DATE_SQL}, 'YYYY-MM') AS ym,
            COALESCE(SUM(CASE WHEN a.type = 'income' THEN ROUND((jl.credit - jl.debit) * 100) ELSE 0 END), 0)::bigint AS inflow,
            COALESCE(SUM(CASE WHEN a.type = 'expense' THEN ROUND((jl.debit - jl.credit) * 100) ELSE 0 END), 0)::bigint AS outflow
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted'
        AND ${ENTRY_LOCAL_DATE_SQL} >= $2::date AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date
        AND ${NOT_CLOSING_SQL} AND a.type IN ('income', 'expense')
      GROUP BY 1`,
    [companyId, first, monthEnd(today)]
  );
  const byKey = new Map(rows.map((r) => [r.ym as string, r]));
  return keys.map(({ year, month }) => {
    const r = byKey.get(`${year}-${String(month).padStart(2, "0")}`);
    const inflow = r ? Number(r.inflow) : 0;
    const outflow = r ? Number(r.outflow) : 0;
    return {
      month: MONTH_NAMES[month - 1],
      year,
      monthNum: month,
      totalInflows: aed(inflow),
      totalOutflows: aed(outflow),
      netCashFlow: aed(inflow - outflow),
    };
  });
}

// ─── Stored monthly forecast snapshots (cash_flow_forecasts, S3) ──────────────

/** `basis` of rows written by the document-driven generator below. */
export const STORED_FORECAST_BASIS = "documents_and_scheduled_items";

export interface StoredForecastResult {
  forecasts: CashFlowForecast[];
  insufficientData: boolean;
  insights: string[];
  insightMessages: CopyDescriptor[];
}

/**
 * Replace the company's stored monthly forecast with a snapshot of the document-driven forecast.
 * With no open documents or scheduled items nothing is stored (insufficientData) — never
 * extrapolated or model-predicted figures.
 */
export async function regenerateStoredForecast(
  companyId: string,
  opts: { months?: number } = {}
): Promise<StoredForecastResult> {
  const { storage } = await import("../storage");
  const months = Math.min(Math.max(Math.trunc(opts.months ?? 3), 1), 12);
  const forecast = await generateCashFlowForecast(companyId, {
    days: Math.min(months * 30, 365),
  });
  await storage.deleteCashFlowForecastsByCompanyId(companyId);
  if (forecast.insufficientData) {
    return {
      forecasts: [],
      insufficientData: true,
      insights: forecast.insights,
      insightMessages: forecast.insightMessages,
    };
  }
  const byMonth = new Map<string, { inflowFils: number; outflowFils: number; balance: number }>();
  for (const p of forecast.projections) {
    const key = p.weekStart.slice(0, 7);
    const cur = byMonth.get(key) ?? { inflowFils: 0, outflowFils: 0, balance: 0 };
    cur.inflowFils += fils(p.expectedInflows);
    cur.outflowFils += fils(p.expectedOutflows);
    cur.balance = p.projectedBalance;
    byMonth.set(key, cur);
  }
  const forecasts: CashFlowForecast[] = [];
  for (const [key, v] of byMonth) {
    forecasts.push(
      await storage.createCashFlowForecast({
        companyId,
        forecastDate: new Date(`${key}-01T00:00:00.000Z`),
        forecastType: "monthly",
        predictedInflow: v.inflowFils / 100,
        predictedOutflow: v.outflowFils / 100,
        predictedBalance: v.balance,
        confidenceLevel: null,
        factors: JSON.stringify({ basis: STORED_FORECAST_BASIS }),
        basis: STORED_FORECAST_BASIS,
      })
    );
  }
  return {
    forecasts,
    insufficientData: false,
    insights: forecast.insights,
    insightMessages: forecast.insightMessages,
  };
}

/**
 * Stored monthly forecast for display. Rows from the pre-0112 model (basis `legacy_model`, or
 * anything not written by the document-driven generator) are discarded and regenerated on read,
 * so fabricated figures are never served again.
 */
export async function readStoredForecast(companyId: string): Promise<CashFlowForecast[]> {
  const { storage } = await import("../storage");
  const rows = await storage.getCashFlowForecastsByCompanyId(companyId);
  if (rows.every((r) => r.basis === STORED_FORECAST_BASIS)) return rows;
  return (await regenerateStoredForecast(companyId)).forecasts;
}
