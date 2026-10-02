// Pure helpers behind the cash-flow forecast screen: the weekly chart series, the lowest point, the inline scenario
// query string and the client-side range checks (the server re-checks everything).

import type { ForecastScenarioFields, ForecastWeek } from "@/lib/banking-api-types";
import { isIsoDay } from "@/lib/statement-review";

export const DEFAULT_SCENARIO: ForecastScenarioFields = {
  receiptDelayDays: 0,
  paymentDelayDays: 0,
  collectionRatePct: 100,
  includeRecurring: true,
  includePayroll: true,
  payrollPayDay: 28,
  adjustments: [],
};

export const MAX_ADJUSTMENTS = 50;

export interface ChartPoint {
  weekStart: string;
  label: string;
  inflows: number;
  /** Negative, so the bars hang below the axis. */
  outflows: number;
  net: number;
  balance: number;
  negative: boolean;
}

/** "2 Oct" in the active language; the day is a calendar day, so UTC keeps the time zone out of it. */
export function weekLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

export function buildChartData(weeks: ForecastWeek[], locale: string): ChartPoint[] {
  return weeks.map((w) => ({
    weekStart: w.weekStart,
    label: weekLabel(w.weekStart, locale),
    inflows: w.inflows,
    outflows: -w.outflows,
    net: w.net,
    balance: w.closingBalance,
    negative: w.closingBalance < 0,
  }));
}

export function lowestBalance(weeks: ForecastWeek[]): { weekIndex: number; weekStart: string; balance: number } | null {
  if (weeks.length === 0) return null;
  let best = 0;
  for (let i = 1; i < weeks.length; i++) if (weeks[i].closingBalance < weeks[best].closingBalance) best = i;
  return { weekIndex: best, weekStart: weeks[best].weekStart, balance: weeks[best].closingBalance };
}

export function isDefaultScenario(s: ForecastScenarioFields): boolean {
  const d = DEFAULT_SCENARIO;
  return (
    s.receiptDelayDays === d.receiptDelayDays &&
    s.paymentDelayDays === d.paymentDelayDays &&
    s.collectionRatePct === d.collectionRatePct &&
    s.includeRecurring === d.includeRecurring &&
    s.includePayroll === d.includePayroll &&
    s.payrollPayDay === d.payrollPayDay &&
    s.adjustments.length === 0
  );
}

/**
 * Query string for GET /cashflow/forecast: the horizon and every scenario field. Sending all of them (even the defaults)
 * makes the server use exactly what is on screen instead of falling back to the company's saved default scenario.
 */
export function scenarioQuery(days: number, s: ForecastScenarioFields): string {
  return new URLSearchParams({
    days: String(days),
    receiptDelayDays: String(s.receiptDelayDays),
    paymentDelayDays: String(s.paymentDelayDays),
    collectionRatePct: String(s.collectionRatePct),
    includeRecurring: String(s.includeRecurring),
    includePayroll: String(s.includePayroll),
    payrollPayDay: String(s.payrollPayDay),
    adjustments: JSON.stringify(s.adjustments),
  }).toString();
}

export type ScenarioIssue =
  | "RECEIPT_DELAY_RANGE"
  | "PAYMENT_DELAY_RANGE"
  | "COLLECTION_RATE_RANGE"
  | "PAYROLL_DAY_RANGE"
  | "ADJUSTMENT_INVALID"
  | "ADJUSTMENT_LIMIT";

const inRange = (n: number, lo: number, hi: number): boolean => Number.isFinite(n) && n >= lo && n <= hi;

export function scenarioIssues(s: ForecastScenarioFields): ScenarioIssue[] {
  const out: ScenarioIssue[] = [];
  if (!Number.isInteger(s.receiptDelayDays) || !inRange(s.receiptDelayDays, -60, 180)) out.push("RECEIPT_DELAY_RANGE");
  if (!Number.isInteger(s.paymentDelayDays) || !inRange(s.paymentDelayDays, -60, 180)) out.push("PAYMENT_DELAY_RANGE");
  if (!inRange(s.collectionRatePct, 0, 100)) out.push("COLLECTION_RATE_RANGE");
  if (!Number.isInteger(s.payrollPayDay) || !inRange(s.payrollPayDay, 1, 28)) out.push("PAYROLL_DAY_RANGE");
  if (s.adjustments.length > MAX_ADJUSTMENTS) out.push("ADJUSTMENT_LIMIT");
  if (s.adjustments.some((a) => !isIsoDay(a.date) || !Number.isFinite(a.amount) || a.amount === 0 || Math.abs(a.amount) > 1_000_000_000 || !a.label.trim())) {
    out.push("ADJUSTMENT_INVALID");
  }
  return out;
}
