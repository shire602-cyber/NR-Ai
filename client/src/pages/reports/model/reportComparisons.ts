// URL search parsing, report coverage map, comparison ranges/math and delivery-run formatting.
// Split from shared.tsx (R20-09); shared.tsx re-exports this module.
import type { BadgeProps } from "@/components/ui/badge";
import type { DateRange } from "@/components/DateRangeFilter";
import {
  type ReportCatalogItem,
  type ReportDeliveryAutomationCommand,
  type ReportPersona,
  type ReportTab,
  getPreferredReportWorkflowGapFilter,
  normalizeReportWorkflowSearch,
  parseReportPersona,
  parseReportWorkflowGapFilter,
  readyReportCatalog,
  reportPersonas,
  reportTabs,
} from "@/lib/reportCatalog";
import { formatMessage, translateNow, useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";
import type {
  PersonaFilter,
  ReportDeliveryPlanPreview,
  ReportDeliveryRunStatusFilter,
  ReportWorkflowGapFilterState,
  VarianceLine,
} from "./reportTypes";
import type {
  ComparisonMetricRow,
  ComparisonRange,
  ReportCoverageCategory,
} from "./reportWorkflowFilters";

export function reportTabFromSearch(search: string): ReportTab {
  const tab = new URLSearchParams(search).get("tab");
  return reportTabs.includes(tab as ReportTab) ? (tab as ReportTab) : "pl";
}

export function reportIdFromSearch(search: string): string | null {
  const reportId = new URLSearchParams(search).get("report");
  return readyReportCatalog.some((report) => report.id === reportId) ? reportId : null;
}

export function personaFilterFromSearch(
  search: string,
  fallbackPersona: ReportPersona | null = null
): PersonaFilter {
  const persona = new URLSearchParams(search).get("persona");
  if (persona === "all") return "all";
  return reportPersonas.includes(persona as ReportPersona)
    ? (persona as ReportPersona)
    : (fallbackPersona ?? "all");
}

export function reportWorkflowSearchFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("workflowSearch");
  return value === null ? null : normalizeReportWorkflowSearch(value);
}

export function reportWorkflowGapFilterFromSearch(
  search: string,
  fallbackPersona: PersonaFilter
): ReportWorkflowGapFilterState {
  const params = new URLSearchParams(search);
  const type = parseReportWorkflowGapFilter(params.get("workflowGap"));
  const persona =
    parseReportPersona(params.get("workflowGapPersona")) ??
    (fallbackPersona === "all" ? null : fallbackPersona);

  if (!persona) {
    return { type: "all", persona: null };
  }

  const preferredType = type ?? getPreferredReportWorkflowGapFilter(persona);
  return preferredType ? { type: preferredType, persona } : { type: "all", persona: null };
}

export function matchesReportPersona(personas: ReportPersona[], persona: PersonaFilter): boolean {
  return persona === "all" || personas.includes(persona);
}

export function uniqueSorted<T extends string>(values: Iterable<T>): T[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function buildReportCoverageMap(
  reports: readonly ReportCatalogItem[],
  workbookReportIds: ReadonlySet<string> = new Set<string>()
): ReportCoverageCategory[] {
  const byCategory = new Map<
    string,
    {
      category: string;
      reports: ReportCatalogItem[];
      liveCount: number;
      apiReadyCount: number;
      plannedCount: number;
      workbookCount: number;
      comparisonTypes: Set<string>;
      automationHooks: Set<string>;
      personas: Set<ReportPersona>;
    }
  >();

  for (const report of reports) {
    const bucket = byCategory.get(report.category) ?? {
      category: report.category,
      reports: [],
      liveCount: 0,
      apiReadyCount: 0,
      plannedCount: 0,
      workbookCount: 0,
      comparisonTypes: new Set<string>(),
      automationHooks: new Set<string>(),
      personas: new Set<ReportPersona>(),
    };

    bucket.reports.push(report);
    if (report.status === "live") bucket.liveCount += 1;
    if (report.status === "api") bucket.apiReadyCount += 1;
    if (report.status === "planned") bucket.plannedCount += 1;
    if (workbookReportIds.has(report.id)) bucket.workbookCount += 1;
    bucket.comparisonTypes.add(report.comparison);
    bucket.automationHooks.add(report.automation);
    report.personas.forEach((persona) => bucket.personas.add(persona));
    byCategory.set(report.category, bucket);
  }

  return Array.from(byCategory.values())
    .map((bucket) => ({
      category: bucket.category,
      reports: bucket.reports,
      liveCount: bucket.liveCount,
      apiReadyCount: bucket.apiReadyCount,
      plannedCount: bucket.plannedCount,
      workbookCount: bucket.workbookCount,
      comparisonTypes: uniqueSorted(bucket.comparisonTypes),
      automationHooks: uniqueSorted(bucket.automationHooks),
      personas: uniqueSorted(bucket.personas),
    }))
    .sort(
      (a, b) =>
        b.reports.length - a.reports.length ||
        b.workbookCount - a.workbookCount ||
        a.category.localeCompare(b.category)
    );
}

export function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function inclusiveDayCount(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(
    1,
    Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / msPerDay) + 1
  );
}

export function averageDaysOverdue<T>(
  rows: T[],
  dueDateForRow: (row: T) => string | null,
  range: ComparisonRange
): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const rangeEnd = startOfLocalDay(range.to);
  const overdueDays = rows
    .map((row) => {
      const dueDateValue = dueDateForRow(row);
      if (!dueDateValue) return null;
      const dueDate = new Date(dueDateValue);
      if (Number.isNaN(dueDate.getTime())) return null;
      return Math.max(
        0,
        Math.floor((rangeEnd.getTime() - startOfLocalDay(dueDate).getTime()) / msPerDay)
      );
    })
    .filter((days): days is number => typeof days === "number");

  if (overdueDays.length === 0) return 0;

  return (
    Math.round((overdueDays.reduce((sum, days) => sum + days, 0) / overdueDays.length) * 10) / 10
  );
}

export function dueWithinDaysAfterRangeEnd<T>(
  rows: T[],
  dueDateForRow: (row: T) => string | null,
  range: ComparisonRange,
  daysAfterRangeEnd = 7
): T[] {
  const rangeEnd = startOfLocalDay(range.to);
  const dueSoonEnd = addDays(rangeEnd, daysAfterRangeEnd);

  return rows.filter((row) => {
    const dueDateValue = dueDateForRow(row);
    if (!dueDateValue) return false;
    const dueDate = new Date(dueDateValue);
    if (Number.isNaN(dueDate.getTime())) return false;
    const dueDay = startOfLocalDay(dueDate);
    return dueDay > rangeEnd && dueDay <= dueSoonEnd;
  });
}

export function buildComparisonRanges(dateRange: DateRange): {
  current: ComparisonRange;
  previous: ComparisonRange;
  isCustom: boolean;
} {
  const today = startOfLocalDay(new Date());
  const currentFrom =
    dateRange.from && dateRange.to
      ? startOfLocalDay(dateRange.from)
      : new Date(today.getFullYear(), today.getMonth(), 1);
  const currentTo = dateRange.from && dateRange.to ? startOfLocalDay(dateRange.to) : today;
  const days = inclusiveDayCount(currentFrom, currentTo);
  const previousTo = addDays(currentFrom, -1);
  const previousFrom = addDays(previousTo, -days + 1);

  return {
    current: { from: currentFrom, to: currentTo },
    previous: { from: previousFrom, to: previousTo },
    isCustom: Boolean(dateRange.from && dateRange.to),
  };
}

export function comparisonParams(range: ComparisonRange): string {
  return `?startDate=${format(range.from, "yyyy-MM-dd")}&endDate=${format(range.to, "yyyy-MM-dd")}`;
}

export function percentageChange(current: number, previous: number): number | null {
  if (Math.abs(previous) < 0.005) return Math.abs(current) < 0.005 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function normalizeMonthlyBurn(
  totalRevenue: number,
  totalExpenses: number,
  days: number
): number {
  const dailyBurn = Math.max(0, totalExpenses - totalRevenue) / Math.max(1, days);
  return Math.round(dailyBurn * 30 * 100) / 100;
}

export function runwayCoverageDays(
  cashBalance: number,
  monthlyBurn: number,
  horizonDays = 90
): number {
  if (monthlyBurn <= 0.005) return horizonDays;
  if (cashBalance <= 0) return 0;
  const dailyBurn = monthlyBurn / 30;
  return Math.round(Math.min(horizonDays, cashBalance / dailyBurn) * 10) / 10;
}

export function ratioPercent(numerator: number, denominator: number): number {
  if (Math.abs(denominator) <= 0.005) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function averageAvailablePercent(values: Array<number | null | undefined>): number {
  const available = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (available.length === 0) return 0;

  return (
    Math.round((available.reduce((sum, value) => sum + value, 0) / available.length) * 100) / 100
  );
}

export function formatComparisonPercent(value: number | null): string {
  if (value === null) return translateNow("reportCenter.comparisonNew");
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatComparisonValue(
  row: ComparisonMetricRow,
  value: number,
  locale: string
): string {
  if (row.currency === "%") return `${value.toFixed(1)}%`;
  if (row.currency === "days") {
    return formatMessage(translateNow("reportCenter.nDaysValue"), { n: value.toFixed(1) });
  }
  if (row.currency === "count") {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  }
  return formatCurrency(value, row.currency, locale);
}

export function formatComparisonExportValue(row: ComparisonMetricRow, value: number): string {
  if (row.currency === "%") return `${value.toFixed(1)}%`;
  if (row.currency === "days") return `${value.toFixed(1)} days`;
  if (row.currency === "count") return `${Math.round(value)}`;
  return `${row.currency} ${value.toFixed(2)}`;
}

export function comparisonBadgeVariant(row: ComparisonMetricRow): BadgeProps["variant"] {
  if (Math.abs(row.delta) < 0.005) return "neutral";
  if (row.favorable === "neutral") return row.delta >= 0 ? "info" : "neutral";
  const improved = row.favorable === "increase" ? row.delta > 0 : row.delta < 0;
  return improved ? "success" : "warning";
}

/** A spend (non-income) line whose actual exceeds its budget (R13 / W3-E sign convention). */
export function isOverBudgetLine(line: Pick<VarianceLine, "accountType" | "totals">): boolean {
  return line.accountType !== "income" && line.totals.actual > line.totals.budget;
}

export function makeComparisonMetric(
  input: Omit<ComparisonMetricRow, "delta" | "percentChange">
): ComparisonMetricRow {
  const delta = input.current - input.previous;
  return {
    ...input,
    delta,
    percentChange: percentageChange(input.current, input.previous),
  };
}

export function normalizeDeliverySetting(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatDeliveryRunTimestamp(value: string | null | undefined): string {
  if (!value) return translateNow("reportCenter.noRunsYet");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (useI18n.getState().locale === "ar") {
    return `${formatDate(date, "ar").replace(/\s*\d{4}$/, "")} ${format(date, "HH:mm")}`;
  }
  return format(date, "MMM d, HH:mm");
}

export function deliveryRunStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "sent") return "success";
  if (status === "failed" || status === "cancelled") return "destructive";
  if (status === "blocked") return "warning";
  return "info";
}

export function matchesReportDeliveryRunStatusFilter(
  status: string,
  filter: ReportDeliveryRunStatusFilter
): boolean {
  if (filter === "all") return true;
  return status === filter;
}

export function reportDeliveryAutomationCommandCardClass(
  command: ReportDeliveryAutomationCommand,
  pinnedCommand: ReportDeliveryAutomationCommand | null
): string {
  return [
    "rounded-md border p-2",
    command === pinnedCommand ? "border-accent bg-accent/5" : "border-transparent bg-secondary/40",
  ].join(" ");
}

export function deliveryPreviewCheckVariant(
  status: ReportDeliveryPlanPreview["checklist"][number]["status"]
): BadgeProps["variant"] {
  if (status === "ready") return "success";
  if (status === "paused") return "neutral";
  return "warning";
}
