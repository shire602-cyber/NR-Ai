// Reports workflow-gap filter helpers plus automation-queue, comparison and coverage types.
// Split from shared.tsx (R20-09); shared.tsx re-exports this module.
import type { LucideIcon } from "lucide-react";
import type { ReportCatalogItem, ReportPersona, ReportTab } from "@/lib/reportCatalog";
import type {
  ReportWorkflowCoverageCue,
  ReportWorkflowCoverageCueId,
  ReportWorkflowFinderGapFilter,
  ReportWorkflowFinderResult,
} from "./reportTypes";

export function reportWorkflowCue(
  result: ReportWorkflowFinderResult,
  cueId: ReportWorkflowCoverageCueId
): ReportWorkflowCoverageCue | undefined {
  return result.coverageCues.find((cue) => cue.id === cueId);
}

export function matchesReportWorkflowGapFilter(
  result: ReportWorkflowFinderResult,
  filterType: ReportWorkflowFinderGapFilter
): boolean {
  if (filterType === "all") return true;

  if (filterType === "report-gaps") {
    return (
      result.type === "Report" &&
      (result.badgeVariant !== "success" ||
        result.coverageCues.some((cue) => cue.label.startsWith("No ")))
    );
  }

  if (filterType === "rule-gaps") {
    const alertCue = reportWorkflowCue(result, "alert");
    return (
      alertCue?.label === "No alert" ||
      (result.type === "Automation" && result.badgeVariant === "warning")
    );
  }

  const scheduleCue = reportWorkflowCue(result, "schedule");
  const deliveryCue = reportWorkflowCue(result, "delivery");
  return (
    scheduleCue?.label === "No schedule" ||
    deliveryCue?.label === "No delivery" ||
    (deliveryCue?.id === "delivery" && deliveryCue.variant !== "success")
  );
}

export interface AutomationQueueItem {
  id: string;
  title: string;
  signal: string;
  detail: string;
  count: number;
  amount?: number;
  currency?: string;
  personas: ReportPersona[];
  icon: LucideIcon;
  actionLabel: string;
  tab?: ReportTab;
  href?: string;
}

export interface ComparisonRange {
  from: Date;
  to: Date;
}

export interface ComparisonMetricRow {
  id: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
  currentLabel?: string;
  previousLabel?: string;
  currency: string;
  signal: string;
  favorable: "increase" | "decrease" | "neutral";
  personas: ReportPersona[];
  tab: ReportTab;
}

export interface ReportCoverageCategory {
  category: string;
  reports: ReportCatalogItem[];
  liveCount: number;
  apiReadyCount: number;
  plannedCount: number;
  workbookCount: number;
  comparisonTypes: string[];
  automationHooks: string[];
  personas: ReportPersona[];
}
