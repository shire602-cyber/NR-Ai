// Cash-flow forecast from real due dates. No posting; everything is read.
//
//   opening   ledger balance of the company's bank and cash accounts today (AED)
//   invoices  open receivable (AED) at the due date (issue + 30 days when none), + receipt delay, x collection rate; overdue -> today
//   bills     approved / part-paid / pending bills, outstanding (AED) at the due date + payment delay; overdue -> today
//   recurring active templates: each run date + 30 days (the invoice it will produce, due 30 days later)
//   payroll   the latest approved run's net pay, on the pay day of each month
//   scenario  one-off amounts
// The month-by-month history report keeps its own aggregate query.

import { dubaiDaySql, dubaiDayTextSql } from "./vat-dubai-day";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "../db";
import { cashflowForecastScenarios, type CashflowForecastScenario } from "../../shared/schema";
import { ACCOUNT_CODES } from "../constants";
import { storage } from "../storage";
import { totalsOfLines } from "../../shared/sales-line-math";
import { uaeYmdParts } from "../utils/date";
import { outstandingSql, openReceivableSql } from "./invoice-outstanding.db";
import { billOutstandingAsOfSql } from "./aging-as-of.service";
import { resolveDocumentExchangeRate } from "./document-fx-rate";
import {
  DEFAULT_SCENARIO,
  addDays,
  applyCollectionRate,
  buildInsights,
  buildWeeks,
  expectedDate,
  payrollDates,
  recurringRunDates,
  type ForecastItem,
  type ForecastScenario,
  type ForecastWeek,
  type Insight,
} from "./cashflow-forecast-math";

const DEFAULT_TERMS_DAYS = 30;
const num = (v: unknown): number => Number(v) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ForecastResult {
  asOf: string;
  currency: "AED";
  openingBalance: number;
  /** legacy alias of openingBalance */
  currentBalance: number;
  scenario: ForecastScenario;
  weeks: ForecastWeek[];
  projections: Array<{ week: number; weekStart: string; weekEnd: string; expectedInflows: number; expectedOutflows: number; projectedBalance: number }>;
  items: ForecastItem[];
  insights: Insight[];
}

export const todayInDubai = (): string => {
  const p = uaeYmdParts(new Date());
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/** Ledger balance of the bank and cash accounts (managed bank GL accounts, 1010, 1020), AED, up to today. */
export async function openingBankBalance(companyId: string, today: string): Promise<number> {
  const banks = await storage.getBankAccountsByCompanyId(companyId);
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const ids = new Set<string>(banks.map((b) => b.glAccountId).filter((v): v is string => !!v));
  for (const a of accounts) if (a.type === "asset" && (a.code === ACCOUNT_CODES.CASH || a.code === ACCOUNT_CODES.BANK)) ids.add(a.id);
  if (ids.size === 0) return 0;
  const res = await pool.query(
    `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS bal
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = ANY($2::uuid[]) AND ${dubaiDaySql("je.date")} <= $3::date`,
    [companyId, Array.from(ids), today]
  );
  return round2(num(res.rows[0]?.bal));
}

async function invoiceItems(companyId: string, s: ForecastScenario, today: string): Promise<{ items: ForecastItem[]; overdue: { amount: number; count: number } }> {
  const res = await pool.query(
    `SELECT i.id, i.number, i.customer_name, ${dubaiDayTextSql("i.date")} AS date_s, ${dubaiDayTextSql("i.due_date")} AS due_s,
            (${outstandingSql("i")} * COALESCE(NULLIF(i.exchange_rate, 0), 1))::float8 AS open_aed
       FROM invoices i WHERE i.company_id = $1 AND ${openReceivableSql("i")}`,
    [companyId]
  );
  const items: ForecastItem[] = [];
  let overdueAmount = 0;
  let overdueCount = 0;
  for (const r of res.rows as any[]) {
    const open = num(r.open_aed);
    if (open <= 0.005) continue;
    const due = r.due_s ? r.due_s : addDays(r.date_s, DEFAULT_TERMS_DAYS);
    if (due < today) {
      overdueAmount += open;
      overdueCount++;
    }
    const amount = applyCollectionRate(open, s.collectionRatePct);
    if (amount <= 0) continue;
    items.push({ date: expectedDate(due, s.receiptDelayDays, today), type: "invoice", sourceId: r.id, label: `${r.number}${r.customer_name ? ` · ${r.customer_name}` : ""}`, amount, originalDate: due });
  }
  return { items, overdue: { amount: overdueAmount, count: overdueCount } };
}

async function billItems(companyId: string, s: ForecastScenario, today: string): Promise<ForecastItem[]> {
  // billOutstandingAsOfSql takes the as-of day as $2 (date) and $3 (timestamp)
  const res = await pool.query(
    `SELECT b.id, b.bill_number, b.vendor_name, ${dubaiDayTextSql("b.bill_date")} AS date_s, ${dubaiDayTextSql("b.due_date")} AS due_s,
            (${billOutstandingAsOfSql("b")} * COALESCE(NULLIF(b.exchange_rate, 0), 1))::float8 AS open_aed
       FROM vendor_bills b
      WHERE b.company_id = $1 AND b.status IN ('approved', 'partial', 'pending')`,
    [companyId, today, `${today}T23:59:59.999`]
  );
  const items: ForecastItem[] = [];
  for (const r of res.rows as any[]) {
    const open = num(r.open_aed);
    if (open <= 0.005) continue;
    const due = r.due_s ? r.due_s : addDays(r.date_s, DEFAULT_TERMS_DAYS);
    items.push({ date: expectedDate(due, s.paymentDelayDays, today), type: "bill", sourceId: r.id, label: `${r.bill_number ?? ""}${r.vendor_name ? ` · ${r.vendor_name}` : ""}`.trim(), amount: -round2(open), originalDate: due });
  }
  return items;
}

async function recurringItems(companyId: string, s: ForecastScenario, today: string, horizonEnd: string): Promise<ForecastItem[]> {
  const res = await pool.query(
    `SELECT id, customer_name, currency, frequency, ${dubaiDayTextSql("next_run_date")} AS next_s, ${dubaiDayTextSql("end_date")} AS end_s, lines_json
       FROM recurring_invoices WHERE company_id = $1 AND is_active = true`,
    [companyId]
  );
  const items: ForecastItem[] = [];
  for (const r of res.rows as any[]) {
    let lines: Array<{ quantity: number; unitPrice: number; vatRate?: number }>;
    try {
      lines = JSON.parse(r.lines_json);
    } catch {
      continue;
    }
    if (!Array.isArray(lines) || lines.length === 0) continue;
    const total = totalsOfLines(lines.map((l) => ({ quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0, vatRate: l.vatRate ?? 0 }))).total;
    let rate = 1;
    if ((r.currency || "AED") !== "AED") {
      const fx = await resolveDocumentExchangeRate({ currency: r.currency, date: new Date(`${today}T00:00:00Z`), companyId });
      if (!fx.ok) continue;
      rate = fx.rate;
    }
    const amount = applyCollectionRate(round2(total * rate), s.collectionRatePct);
    if (amount <= 0) continue;
    const runs = recurringRunDates({ nextRunDate: r.next_s, frequency: r.frequency, endDate: r.end_s ?? null, until: addDays(horizonEnd, -DEFAULT_TERMS_DAYS) });
    for (const run of runs) {
      const due = addDays(run, DEFAULT_TERMS_DAYS);
      items.push({ date: expectedDate(due, s.receiptDelayDays, today), type: "recurring", sourceId: r.id, label: r.customer_name, amount, originalDate: due });
    }
  }
  return items;
}

async function payrollItems(companyId: string, s: ForecastScenario, today: string, horizonEnd: string): Promise<ForecastItem[]> {
  const res = await pool.query(
    `SELECT id, total_net::float8 AS net FROM payroll_runs WHERE company_id = $1 AND status = 'approved'
      ORDER BY period_year DESC, period_month DESC LIMIT 1`,
    [companyId]
  );
  const run = res.rows[0] as { id: string; net: number } | undefined;
  if (!run || num(run.net) <= 0) return [];
  return payrollDates(today, horizonEnd, s.payrollPayDay).map((d) => ({ date: d, type: "payroll" as const, sourceId: run.id, label: "Payroll", amount: -round2(num(run.net)), originalDate: d }));
}

export async function generateCashFlowForecast(
  companyId: string,
  days = 90,
  scenarioInput: Partial<ForecastScenario> = {},
  scenarioMeta?: { id: string; name: string } | null
): Promise<ForecastResult & { scenarioMeta?: { id: string; name: string } | null }> {
  const horizon = Math.min(Math.max(Math.floor(days) || 90, 7), 365);
  const scenario: ForecastScenario = { ...DEFAULT_SCENARIO, ...scenarioInput };
  const today = todayInDubai();
  const weekCount = Math.ceil(horizon / 7);
  const horizonEnd = addDays(today, weekCount * 7 - 1);

  const [opening, inv, bills, recurring, payroll] = await Promise.all([
    openingBankBalance(companyId, today),
    invoiceItems(companyId, scenario, today),
    billItems(companyId, scenario, today),
    scenario.includeRecurring ? recurringItems(companyId, scenario, today, horizonEnd) : Promise.resolve([] as ForecastItem[]),
    scenario.includePayroll ? payrollItems(companyId, scenario, today, horizonEnd) : Promise.resolve([] as ForecastItem[]),
  ]);
  const adjustments: ForecastItem[] = scenario.adjustments.map((a) => ({
    date: a.date < today ? today : a.date,
    type: "adjustment",
    sourceId: null,
    label: a.label,
    amount: a.amount,
    originalDate: a.date,
  }));

  const { weeks, items } = buildWeeks({ today, days: horizon, openingBalance: opening, items: [...inv.items, ...bills, ...recurring, ...payroll, ...adjustments] });
  const receivable = items.filter((i) => i.type === "invoice").reduce((s, i) => s + i.amount, 0);
  const payable = items.filter((i) => i.type === "bill").reduce((s, i) => s + Math.abs(i.amount), 0);

  return {
    asOf: today,
    currency: "AED",
    openingBalance: opening,
    currentBalance: opening,
    scenario,
    scenarioMeta: scenarioMeta ?? null,
    weeks,
    projections: weeks.map((w, i) => ({ week: i + 1, weekStart: w.weekStart, weekEnd: w.weekEnd, expectedInflows: w.inflows, expectedOutflows: w.outflows, projectedBalance: w.closingBalance })),
    items,
    insights: buildInsights({ openingBalance: opening, weeks, overdueAmount: inv.overdue.amount, overdueCount: inv.overdue.count, receivable, payable, itemCount: items.length }),
  };
}

// ─── saved scenarios ───────────────────────────────────────────────────────

export function scenarioFromRow(row: CashflowForecastScenario): ForecastScenario {
  return {
    receiptDelayDays: row.receiptDelayDays,
    paymentDelayDays: row.paymentDelayDays,
    collectionRatePct: Number(row.collectionRatePct),
    includeRecurring: row.includeRecurring,
    includePayroll: row.includePayroll,
    payrollPayDay: row.payrollPayDay,
    adjustments: Array.isArray(row.adjustments) ? (row.adjustments as ForecastScenario["adjustments"]) : [],
  };
}

export async function listScenarios(companyId: string): Promise<CashflowForecastScenario[]> {
  return await db.select().from(cashflowForecastScenarios).where(eq(cashflowForecastScenarios.companyId, companyId)).orderBy(desc(cashflowForecastScenarios.isDefault), cashflowForecastScenarios.name);
}

export async function getScenario(companyId: string, id: string): Promise<CashflowForecastScenario | undefined> {
  const [row] = await db.select().from(cashflowForecastScenarios).where(and(eq(cashflowForecastScenarios.id, id), eq(cashflowForecastScenarios.companyId, companyId)));
  return row;
}

export async function defaultScenario(companyId: string): Promise<CashflowForecastScenario | undefined> {
  const [row] = await db.select().from(cashflowForecastScenarios).where(and(eq(cashflowForecastScenarios.companyId, companyId), eq(cashflowForecastScenarios.isDefault, true)));
  return row;
}

/** Create or update a scenario; making it the default clears the flag on the others in the same transaction. */
export async function saveScenario(args: { companyId: string; userId: string; id?: string; values: Partial<ForecastScenario> & { name?: string; isDefault?: boolean } }): Promise<CashflowForecastScenario | undefined> {
  const { values } = args;
  return await db.transaction(async (tx: typeof db) => {
    if (values.isDefault) {
      await tx.update(cashflowForecastScenarios).set({ isDefault: false }).where(and(eq(cashflowForecastScenarios.companyId, args.companyId), eq(cashflowForecastScenarios.isDefault, true)));
    }
    const columns: Record<string, unknown> = {
      ...(values.name !== undefined && { name: values.name }),
      ...(values.isDefault !== undefined && { isDefault: values.isDefault }),
      ...(values.receiptDelayDays !== undefined && { receiptDelayDays: values.receiptDelayDays }),
      ...(values.paymentDelayDays !== undefined && { paymentDelayDays: values.paymentDelayDays }),
      ...(values.collectionRatePct !== undefined && { collectionRatePct: values.collectionRatePct }),
      ...(values.includeRecurring !== undefined && { includeRecurring: values.includeRecurring }),
      ...(values.includePayroll !== undefined && { includePayroll: values.includePayroll }),
      ...(values.payrollPayDay !== undefined && { payrollPayDay: values.payrollPayDay }),
      ...(values.adjustments !== undefined && { adjustments: values.adjustments }),
    };
    if (args.id) {
      const [row] = await tx
        .update(cashflowForecastScenarios)
        .set({ ...columns, updatedAt: new Date() })
        .where(and(eq(cashflowForecastScenarios.id, args.id), eq(cashflowForecastScenarios.companyId, args.companyId)))
        .returning();
      return row;
    }
    const [row] = await tx.insert(cashflowForecastScenarios).values({ ...columns, companyId: args.companyId, createdBy: args.userId } as any).returning();
    return row;
  });
}

export async function deleteScenario(companyId: string, id: string): Promise<boolean> {
  const rows = await db.delete(cashflowForecastScenarios).where(and(eq(cashflowForecastScenarios.id, id), eq(cashflowForecastScenarios.companyId, companyId))).returning({ id: cashflowForecastScenarios.id });
  return rows.length > 0;
}

// ─── history ───────────────────────────────────────────────────────────────

export interface MonthlyCashHistory {
  month: string;
  year: number;
  monthNum: number;
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Income credited and expense debited per month (posted entries, closing entries left out), in one query. */
export async function getCashFlowHistory(companyId: string, months = 6): Promise<MonthlyCashHistory[]> {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const res = await pool.query(
    `SELECT EXTRACT(YEAR FROM je.date)::int AS y, EXTRACT(MONTH FROM je.date)::int AS m,
            COALESCE(SUM(CASE WHEN a.type = 'income' THEN jl.credit ELSE 0 END), 0)::float8 AS inflow,
            COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jl.debit ELSE 0 END), 0)::float8 AS outflow
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND je.source NOT IN ('year_end_close', 'year_end_close_reversal') AND je.date >= $2
      GROUP BY 1, 2`,
    [companyId, first]
  );
  const byKey = new Map<string, { inflow: number; outflow: number }>(res.rows.map((r: any) => [`${r.y}-${r.m}`, { inflow: num(r.inflow), outflow: num(r.outflow) }]));
  const out: MonthlyCashHistory[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const v = byKey.get(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`) ?? { inflow: 0, outflow: 0 };
    out.push({ month: MONTH_NAMES[d.getUTCMonth()], year: d.getUTCFullYear(), monthNum: d.getUTCMonth() + 1, totalInflows: round2(v.inflow), totalOutflows: round2(v.outflow), netCashFlow: round2(v.inflow - v.outflow) });
  }
  return out;
}
