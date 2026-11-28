// Insights (spec 3.11): pure routing, period and label helpers shared by the views, the Reports
// shell and the legacy /analytics redirect. No React, so unit tests import it directly.
import type { StatDelta } from "@/components/ui/stat-card";
import { formatPercentDelta } from "@/lib/format-money";

export const INSIGHTS_VIEWS = ["cash-flow", "ageing", "comparison", "budget"] as const;
export type InsightsView = (typeof INSIGHTS_VIEWS)[number];

export function insightsViewFromSearch(search: string): InsightsView {
  const view = new URLSearchParams(search).get("view");
  return (INSIGHTS_VIEWS as readonly string[]).includes(view ?? "")
    ? (view as InsightsView)
    : "cash-flow";
}

export function insightsHref(view: InsightsView): string {
  return `/reports?workspace=insights&view=${view}`;
}

export type ReportsMode = "reports" | "insights";

export function reportsModeFromSearch(search: string): ReportsMode {
  return new URLSearchParams(search).get("workspace") === "insights" ? "insights" : "reports";
}

/**
 * /analytics (and, through the App.tsx redirects, /advanced-analytics and /advanced-reports)
 * forwards to the matching Insights view. Usage telemetry ("overview") has no customer view.
 */
export function analyticsRedirectTarget(search: string): string {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const tab = params.get("tab");
  let target: InsightsView = "cash-flow";
  if (view === "advanced" && tab === "budget") target = "budget";
  if (view === "reports" && tab === "aging") target = "ageing";
  if (view === "reports" && tab === "comparison") target = "comparison";
  return insightsHref(target);
}

export type InsightsPeriod = "month" | "quarter" | "year";
export const INSIGHTS_PERIODS: InsightsPeriod[] = ["month", "quarter", "year"];

export interface IsoWindow {
  from: string;
  to: string;
}

function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Current calendar month / quarter / year containing `today` (the server's windows). */
export function periodWindow(period: InsightsPeriod, today: Date = new Date()): IsoWindow {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (period === "month") return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  if (period === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  const q = Math.floor(m / 3) * 3;
  return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
}

export function todayIso(): string {
  return iso(new Date());
}

/** First day of the month eleven months before `today`: the trailing-12-month chart window. */
export function trailingYearStart(today: Date = new Date()): string {
  return iso(new Date(today.getFullYear(), today.getMonth() - 11, 1));
}

export interface ComparisonMetric {
  metric: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
}

/** Server metric names (reports.routes buildComparison) -> catalog keys (G9). */
export const COMPARISON_METRIC_KEYS: Record<string, string> = {
  "Total Revenue": "analytics.metricRevenue",
  "Total Expenses": "analytics.metricExpenses",
  "Net Profit": "analytics.metricNetProfit",
  "Invoice Count": "analytics.metricInvoiceCount",
  "Avg Invoice Value": "analytics.metricAvgInvoice",
};

export const COUNT_METRICS = new Set(["Invoice Count"]);
/** Metrics where an increase is bad news (spec 2.7: expenses up = danger). */
const COST_METRICS = new Set(["Total Expenses"]);

/** Delta pill from the server's change / changePercent; tone by meaning, not by sign. */
export function comparisonDelta(metric: ComparisonMetric, context: string): StatDelta | undefined {
  if (!metric.previous) return undefined;
  const direction = metric.change > 0 ? "up" : metric.change < 0 ? "down" : "flat";
  const good = COST_METRICS.has(metric.metric) ? direction === "down" : direction === "up";
  return {
    label: formatPercentDelta(metric.changePercent),
    direction,
    tone: direction === "flat" ? "neutral" : good ? "positive" : "negative",
    context,
  };
}
