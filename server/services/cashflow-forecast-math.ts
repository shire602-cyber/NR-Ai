// Cash-flow forecast, pure. Dates are UTC calendar days as "YYYY-MM-DD". Amounts are AED, inflow positive.
//
// Sources are turned into dated items elsewhere (cashflow-forecast.service.ts); this module shifts them by the
// scenario (customers pay N days late, a collection rate, suppliers paid N days late), pulls overdue items to today,
// expands recurring templates and payroll into dates, and buckets everything into weeks with a running balance.

import Decimal from "decimal.js";

export type ItemType = "invoice" | "bill" | "recurring" | "payroll" | "adjustment";

export interface ForecastScenario {
  receiptDelayDays: number;
  paymentDelayDays: number;
  collectionRatePct: number;
  includeRecurring: boolean;
  includePayroll: boolean;
  payrollPayDay: number;
  adjustments: Array<{ date: string; amount: number; label: string }>;
}

export const DEFAULT_SCENARIO: ForecastScenario = {
  receiptDelayDays: 0,
  paymentDelayDays: 0,
  collectionRatePct: 100,
  includeRecurring: true,
  includePayroll: true,
  payrollPayDay: 28,
  adjustments: [],
};

export interface ForecastItem {
  date: string;
  type: ItemType;
  sourceId: string | null;
  label: string;
  amount: number;
  originalDate: string;
}

export interface ForecastWeek {
  weekStart: string;
  weekEnd: string;
  inflows: number;
  outflows: number;
  net: number;
  closingBalance: number;
}

const DAY = 86_400_000;
const r2 = (v: Decimal.Value): number => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export const toMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
export const toDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => toDay(toMs(day) + n * DAY);

/** Move a day to its own month with a given day-of-month (clamped to the month's length). */
export function monthDay(year: number, month0: number, dayOfMonth: number): string {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return toDay(Date.UTC(year, month0, Math.min(dayOfMonth, last)));
}

/** Add whole months, keeping the day of month where the target month has it (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: string, n: number): string {
  const d = new Date(toMs(day));
  return monthDay(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
}

/** Where a receipt or payment lands: due date + scenario delay, and anything already late is expected today. */
export function expectedDate(due: string, delayDays: number, today: string): string {
  const shifted = addDays(due, delayDays);
  return shifted < today ? today : shifted;
}

/** Collections: the share of an invoice the scenario expects to be paid at all. */
export const applyCollectionRate = (amount: number, pct: number): number => r2(new Decimal(amount).times(pct).dividedBy(100));

export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export function nextRun(day: string, frequency: string): string {
  switch (frequency) {
    case "weekly":
      return addDays(day, 7);
    case "biweekly":
      return addDays(day, 14);
    case "quarterly":
      return addMonths(day, 3);
    case "yearly":
      return addMonths(day, 12);
    default:
      return addMonths(day, 1);
  }
}

/** Run dates of a recurring template from its next run until `until` (inclusive), never past its end date. */
export function recurringRunDates(args: { nextRunDate: string; frequency: string; endDate?: string | null; until: string }): string[] {
  const out: string[] = [];
  let cur = args.nextRunDate;
  for (let i = 0; i < 400 && cur <= args.until; i++) {
    if (args.endDate && cur > args.endDate) break;
    out.push(cur);
    const nxt = nextRun(cur, args.frequency);
    if (nxt <= cur) break;
    cur = nxt;
  }
  return out;
}

/** Pay days of a monthly payroll between `from` and `to` inclusive. */
export function payrollDates(from: string, to: string, payDay: number): string[] {
  const out: string[] = [];
  const start = new Date(toMs(from));
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m++) {
    const d = monthDay(y, m, payDay);
    if (d > to) break;
    if (d >= from) out.push(d);
    if (out.length > 60) break;
  }
  return out;
}

export interface BuildArgs {
  today: string;
  days: number;
  openingBalance: number;
  items: ForecastItem[];
}

/** Weekly buckets from today; items outside the horizon are dropped. */
export function buildWeeks(args: BuildArgs): { weeks: ForecastWeek[]; items: ForecastItem[] } {
  const weekCount = Math.ceil(args.days / 7);
  const end = addDays(args.today, weekCount * 7 - 1);
  const inRange = args.items.filter((i) => i.date >= args.today && i.date <= end).sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  let balance = new Decimal(args.openingBalance);
  const weeks: ForecastWeek[] = [];
  for (let w = 0; w < weekCount; w++) {
    const weekStart = addDays(args.today, w * 7);
    const weekEnd = addDays(weekStart, 6);
    const inWeek = inRange.filter((i) => i.date >= weekStart && i.date <= weekEnd);
    const inflows = inWeek.filter((i) => i.amount > 0).reduce((s, i) => s.plus(i.amount), new Decimal(0));
    const outflows = inWeek.filter((i) => i.amount < 0).reduce((s, i) => s.plus(Math.abs(i.amount)), new Decimal(0));
    balance = balance.plus(inflows).minus(outflows);
    weeks.push({ weekStart, weekEnd, inflows: r2(inflows), outflows: r2(outflows), net: r2(inflows.minus(outflows)), closingBalance: r2(balance) });
  }
  return { weeks, items: inRange };
}

export interface Insight {
  code: string;
  params: Record<string, number | string>;
}

export function buildInsights(args: { openingBalance: number; weeks: ForecastWeek[]; overdueAmount: number; overdueCount: number; receivable: number; payable: number; itemCount: number }): Insight[] {
  const out: Insight[] = [];
  const negative = args.weeks.findIndex((w) => w.closingBalance < 0);
  const low = args.weeks.findIndex((w) => w.closingBalance < 10_000);
  if (negative >= 0) out.push({ code: "NEGATIVE_BALANCE", params: { week: negative + 1, weekStart: args.weeks[negative].weekStart, amount: Math.abs(args.weeks[negative].closingBalance) } });
  else if (low >= 0) out.push({ code: "LOW_BALANCE", params: { week: low + 1, weekStart: args.weeks[low].weekStart, threshold: 10_000 } });
  if (args.overdueAmount > 0) out.push({ code: "OVERDUE_RECEIVABLES", params: { amount: r2(args.overdueAmount), count: args.overdueCount } });
  if (args.receivable > 0) out.push({ code: "RECEIVABLES_EXPECTED", params: { amount: r2(args.receivable) } });
  if (args.payable > 0) out.push({ code: "PAYABLES_DUE", params: { amount: r2(args.payable) } });
  const last = args.weeks[args.weeks.length - 1];
  if (last && last.closingBalance > args.openingBalance) out.push({ code: "POSITIVE_OUTLOOK", params: { improvement: r2(last.closingBalance - args.openingBalance) } });
  if (args.itemCount === 0) out.push({ code: "NO_ACTIVITY", params: {} });
  return out;
}
