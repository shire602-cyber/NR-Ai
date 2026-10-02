// Dashboard KPIs (Phase 8 D4), defined once in docs/KPI_DEFINITIONS.md and computed in SQL over the shared ledger layer:
// revenue and expenses are the SELECTED period (never all-time) and come from the same periodProfit() the P&L uses;
// receivables and payables come from the as-of ageing SQL (so they tie to accounts 1040 and 2010); payables are POSTED
// vendor bills only. Everything is AED and read in one snapshot.

import { pool } from "../db";
import { AppError } from "../errors";
import { createLogger } from "../config/logger";
import {
  asOfParams,
  payableAgingAsOfSql,
  receivableAgingAsOfSql,
} from "../services/aging-as-of.service";
import { round2 } from "../services/financial-statements";
import { currentVatPeriodForCompany } from "../services/firm-clients.service";
import { computeVatReturnForPeriod } from "../services/vat-return-compute.service";
import { openReceivableSql } from "../services/invoice-outstanding.db";
import { addDays, addMonthsKeepEnd, dayEndTs, dayStartTs, daysBetween, fiscalYearStart, isYmd, startOfMonth, todayYmd } from "./dates";
import { KPI_EXCLUDED_SOURCES, SqlParams, cashBalance, ledgerLinesSql, money, type PeriodProfit, type Queryable } from "./ledger";
import { MAX_RANGE_DAYS } from "./params";

const log = createLogger("dashboard-kpis");

/** Depreciation (5100) and corporate tax (5150) are not operating cash burn; irrecoverable VAT (5160) is real cash and stays in. */
export const BURN_EXCLUDED_CODES = ["5100", "5150"] as const;

export type DashboardPeriodKind = "month" | "ytd" | "custom";

export interface DashboardPeriod {
  kind: DashboardPeriodKind;
  from: string;
  to: string;
}

export interface AgingBuckets {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
}

export type VatDueNext =
  | { amount: number; periodEnd: string; dueDate: string }
  | { amount: null; periodEnd: null; dueDate: null; reason: "NO_TRN" | "EMIRATE_NOT_SET" | "UNAVAILABLE" };

/** Resolve the `period` query (month default, ytd, custom with from/to). There is no all-time option: 422 INVALID_PERIOD. */
export function resolveDashboardPeriod(
  query: { period?: unknown; from?: unknown; to?: unknown },
  fiscalStartMonth: number,
  now: Date = new Date()
): DashboardPeriod {
  const invalid = (message: string) => new AppError({ message, statusCode: 422, code: "INVALID_PERIOD" });
  const today = todayYmd(now);
  const kind = query.period === undefined || query.period === "" ? "month" : query.period;
  if (kind === "month") return { kind: "month", from: startOfMonth(today), to: today };
  if (kind === "ytd") return { kind: "ytd", from: fiscalYearStart(today, fiscalStartMonth), to: today };
  if (kind === "custom") {
    const { from, to } = query;
    if (!isYmd(from) || !isYmd(to)) throw invalid("A custom period needs from and to as YYYY-MM-DD.");
    if (from > to) throw invalid("from must be on or before to.");
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw invalid("The period cannot be longer than five years.");
    return { kind: "custom", from, to };
  }
  throw invalid("period must be month, ytd or custom. There is no all-time view.");
}

const sumAging = (rows: any[]): AgingBuckets => {
  const t = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
  for (const r of rows) {
    t.current += money(r.current_balance);
    t.days1to30 += money(r.days_30);
    t.days31to60 += money(r.days_60);
    t.days61to90 += money(r.days_90);
    t.days90plus += money(r.over_90);
  }
  return {
    current: round2(t.current),
    days1to30: round2(t.days1to30),
    days31to60: round2(t.days31to60),
    days61to90: round2(t.days61to90),
    days90plus: round2(t.days90plus),
  };
};
const agingTotal = (a: AgingBuckets) => round2(a.current + a.days1to30 + a.days31to60 + a.days61to90 + a.days90plus);

// "VAT due next" runs the whole VAT 201 computation, the heaviest part of the dashboard. It changes only when books of a past
// period change or a return is generated or filed, so it is kept per company for five minutes and dropped on those events
// (vat.routes generate, vat-filing recordVatFiling). Per process: another instance catches up within the five minutes.
const VAT_DUE_TTL_MS = 5 * 60_000;
const vatDueCache = new Map<string, { at: number; value: VatDueNext }>();

export function invalidateVatDueNext(companyId: string): void {
  vatDueCache.delete(companyId);
}

async function vatDueNext(companyId: string, now: Date): Promise<VatDueNext> {
  const cached = vatDueCache.get(companyId);
  if (cached && now.getTime() - cached.at < VAT_DUE_TTL_MS) return cached.value;
  const value = await computeVatDueNext(companyId, now);
  // An unavailable result is not worth remembering: try again on the next load.
  if (!("reason" in value) || value.reason !== "UNAVAILABLE") vatDueCache.set(companyId, { at: now.getTime(), value });
  return value;
}

async function computeVatDueNext(companyId: string, now: Date): Promise<VatDueNext> {
  const { rows } = await pool.query(
    `SELECT trn_vat_number, emirate, vat_period_start_month, vat_filing_frequency FROM companies WHERE id = $1`,
    [companyId]
  );
  const c = rows[0];
  if (!c?.trn_vat_number) return { amount: null, periodEnd: null, dueDate: null, reason: "NO_TRN" };
  if (!c.emirate) return { amount: null, periodEnd: null, dueDate: null, reason: "EMIRATE_NOT_SET" };
  try {
    let period = currentVatPeriodForCompany(now, c.vat_period_start_month, c.vat_filing_frequency);
    const endYmd = period.periodEnd.toISOString().slice(0, 10);
    const filed = await pool.query(
      `SELECT 1 FROM vat_returns WHERE company_id = $1 AND period_end::date = $2::date AND status IN ('filed', 'submitted') AND COALESCE(is_amendment, false) = false LIMIT 1`,
      [companyId, endYmd]
    );
    let periodStart = period.periodStart.toISOString().slice(0, 10);
    let periodEnd = endYmd;
    if (filed.rows.length > 0) {
      // That return is in: the next one due is the following period.
      const frequency = String(c.vat_filing_frequency ?? "quarterly").toLowerCase();
      const length = frequency === "monthly" ? 1 : frequency === "annually" ? 12 : 3;
      periodStart = addDays(periodEnd, 1);
      periodEnd = addMonthsKeepEnd(periodEnd, length);
    }
    const { returnValues } = await computeVatReturnForPeriod({ companyId, userId: "", periodStart, periodEnd });
    return { amount: round2(Number((returnValues as any).box14PayableTax) || 0), periodEnd, dueDate: addDays(periodEnd, 28) };
  } catch (err: any) {
    if (err?.code === "NO_TRN" || err?.code === "EMIRATE_NOT_SET") return { amount: null, periodEnd: null, dueDate: null, reason: err.code };
    log.warn({ err: err?.message, companyId }, "VAT due next unavailable");
    return { amount: null, periodEnd: null, dueDate: null, reason: "UNAVAILABLE" };
  }
}

export async function computeDashboardKpis(companyId: string, period: DashboardPeriod, now: Date = new Date()) {
  const today = todayYmd(now);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const q: Queryable = client;
    const agingParamsToday = asOfParams(companyId, { ymd: today, dayEnd: dayEndTs(today) });

    // ONE pass over the P&L lines of the ledger (KPI exclusions) gives the selected period, this month, last month, the three-month
    // burn and the top categories: five scans of 50,000 lines became one. Same formulas as periodProfit (revenue = credit - debit
    // of income accounts, expenses = debit - credit of expense accounts), so the dashboard and the P&L agree.
    const monthStart = startOfMonth(today);
    const prevEnd = addDays(monthStart, -1);
    const prevStart = startOfMonth(prevEnd);
    const burnFrom = addMonthsKeepEnd(monthStart, -3);
    const earliest = [period.from, prevStart, burnFrom].sort()[0];
    const latest = [period.to, today].sort().reverse()[0];
    const pb = new SqlParams();
    const win = (from: string, to: string) => `l.entry_date >= ${pb.p(dayStartTs(from))}::timestamp AND l.entry_date <= ${pb.p(dayEndTs(to))}::timestamp`;
    const amount = `CASE WHEN a.type = 'income' THEN l.credit - l.debit ELSE l.debit - l.credit END`;
    const plQuery = q.query(
      `WITH ${ledgerLinesSql(pb, companyId, { from: earliest, to: latest, excludeSources: KPI_EXCLUDED_SOURCES })}
       SELECT a.id, a.name_en, a.type,
              COALESCE(SUM(${amount}) FILTER (WHERE ${win(period.from, period.to)}), 0)::text AS period_amt,
              COALESCE(SUM(${amount}) FILTER (WHERE ${win(monthStart, today)}), 0)::text AS month_amt,
              COALESCE(SUM(${amount}) FILTER (WHERE ${win(prevStart, prevEnd)}), 0)::text AS last_amt,
              COALESCE(SUM(l.debit - l.credit) FILTER (WHERE a.type = 'expense' AND a.code <> ALL(${pb.p([...BURN_EXCLUDED_CODES])}::text[]) AND ${win(burnFrom, prevEnd)}), 0)::text AS burn_amt
         FROM ledger l JOIN accounts a ON a.id = l.account_id AND a.company_id = ${pb.p(companyId)}
        WHERE a.type IN ('income', 'expense') GROUP BY a.id, a.name_en, a.type`,
      pb.values
    );

    const [plRows, cash, arRows, apRows, counts, missing] = await Promise.all([
      plQuery,
      cashBalance(q, companyId),
      q.query(receivableAgingAsOfSql(), agingParamsToday),
      q.query(payableAgingAsOfSql(), agingParamsToday),
      q.query(
        `SELECT (SELECT COUNT(*) FROM invoices WHERE company_id = $1)::int AS invoices,
                (SELECT COUNT(*) FROM journal_entries WHERE company_id = $1 AND status = 'posted')::int AS entries`,
        [companyId]
      ),
      q.query(`SELECT COUNT(*)::int AS receivables FROM invoices i WHERE i.company_id = $1 AND i.due_date IS NULL AND ${openReceivableSql("i")}`, [companyId]),
    ]);

    const sum = (type: string, key: string) =>
      round2(plRows.rows.filter((r: any) => r.type === type).reduce((acc: number, r: any) => acc + money(r[key]), 0));
    const profit = { revenue: sum("income", "period_amt"), expenses: sum("expense", "period_amt") } as PeriodProfit;
    profit.net = round2(profit.revenue - profit.expenses);
    const thisMonth = { revenue: sum("income", "month_amt"), expenses: sum("expense", "month_amt") };
    const lastMonth = { revenue: sum("income", "last_amt"), expenses: sum("expense", "last_amt") };
    const burn = round2(sum("expense", "burn_amt") / 3);
    const topExpenseCategories = plRows.rows
      .filter((r: any) => r.type === "expense")
      .map((r: any) => ({ name: String(r.name_en), value: money(r.period_amt) }))
      .filter((r: { value: number }) => r.value > 0)
      .sort((x: { value: number }, y: { value: number }) => y.value - x.value)
      .slice(0, 5);

    await client.query("COMMIT");

    const arAging = sumAging(arRows.rows);
    const apAging = sumAging(apRows.rows);
    const outstanding = agingTotal(arAging);
    const overdueReceivables = round2(arAging.days1to30 + arAging.days31to60 + arAging.days61to90 + arAging.days90plus);
    const growth = (cur: number, prev: number) => (prev > 0 ? round2(((cur - prev) / prev) * 100) : null);

    const vat = await vatDueNext(companyId, now);
    return {
      period,
      revenue: profit.revenue,
      expenses: profit.expenses,
      netProfit: profit.net,
      outstanding,
      overdueReceivables,
      receivablesMissingDueDate: Number(missing.rows[0]?.receivables ?? 0),
      payablesOutstanding: agingTotal(apAging),
      totalInvoices: Number(counts.rows[0]?.invoices ?? 0),
      totalEntries: Number(counts.rows[0]?.entries ?? 0),
      cashPosition: cash,
      monthlyBurnRate: burn,
      cashRunway: burn > 0 ? round2(cash / burn) : null,
      arAging,
      apAging,
      revenueGrowth: growth(thisMonth.revenue, lastMonth.revenue),
      expenseGrowth: growth(thisMonth.expenses, lastMonth.expenses),
      topExpenseCategories,
      vatDueNext: vat,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* released below */
    }
    throw err;
  } finally {
    client.release();
  }
}

