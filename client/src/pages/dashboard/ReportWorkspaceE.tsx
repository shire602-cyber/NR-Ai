import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import {
  reportAutomationPlaybookHref,
  reportPersonaHref,
  reportSectionHref,
  reportWorkspaceHref,
  setPreferredReportWorkflowGapFilter,
} from "@/lib/reportCatalog";
import { ArrowRight, ArrowUpRight, X } from "lucide-react";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";
import {
  formatDashboardComparisonPercent,
  dashboardComparisonBadgeVariant,
} from "./workspaceHelpers";

export function ReportWorkspacePartE({ m }: { m: DashboardModel }) {
  const {
    locale,
    setReportWorkflowPreferenceRevision,
    preferredReportWorkspace,
    preferredReportWorkflowSearch,
    clearDashboardReportWorkflowContext,
    preferredWorkspaceReports,
    preferredReportPackReadiness,
    dashboardComparisonRows,
    preferredReportWorkflowGapLinks,
    preferredReportWorkflowGapLabel,
    hasDashboardReportWorkflowContext,
    dashboardReportWorkflowContextHref,
  } = m;
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] divide-y lg:divide-y-0 lg:divide-x divide-border/60">
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-caption font-medium text-muted-foreground">
                <T k="pageLabels.workspaceFocus" />
              </div>
              <p className="mt-2 text-[13.5px] text-muted-foreground leading-relaxed">
                {preferredReportWorkspace.focus}
              </p>
              <div className="mt-3 rounded-md border border-border/70 p-3 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Automation outcome:</span>{" "}
                {preferredReportWorkspace.automationOutcome}
              </div>
              <div
                className="mt-3 rounded-md border border-border/70 bg-muted/20 p-3"
                data-testid="dashboard-report-context-summary"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-caption font-medium text-muted-foreground">
                      <T k="reportCenter.savedReportingContext" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="info" data-testid="dashboard-report-role-context">
                        Role: {preferredReportWorkspace.navLabel}
                      </Badge>
                      {preferredReportWorkflowSearch ? (
                        <Badge variant="outline" data-testid="dashboard-report-search-context">
                          <span className="max-w-[12rem] truncate">
                            Search: {preferredReportWorkflowSearch}
                          </span>
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <T k="reportCenter.noSavedSearch" />
                        </Badge>
                      )}
                      {preferredReportWorkflowGapLabel ? (
                        <Badge variant="outline" data-testid="dashboard-report-gap-context">
                          Gap: {preferredReportWorkflowGapLabel}
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <T k="reportCenter.noGapFilter" />
                        </Badge>
                      )}
                    </div>
                  </div>
                  {hasDashboardReportWorkflowContext ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link href={dashboardReportWorkflowContextHref}>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="button-open-dashboard-report-context-link"
                        >
                          <T k="reportCenter.openSharedView" />
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={clearDashboardReportWorkflowContext}
                        data-testid="button-clear-dashboard-report-context"
                      >
                        <X className="h-3.5 w-3.5" />
                        <T k="pageLabels.clearSavedFilters" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Badge variant="info" dot>
                {preferredWorkspaceReports.length} ready reports
              </Badge>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {preferredWorkspaceReports.map((report) => (
              <Link
                key={report.id}
                href={
                  reportPersonaHref(report, preferredReportWorkspace.persona) ??
                  reportWorkspaceHref(preferredReportWorkspace)
                }
              >
                <div className="rounded-md border border-border/70 p-3 hover:border-accent hover:bg-muted/60 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{report.name}</div>
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {report.comparison} · {report.automation}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div
            className="mt-5 rounded-md border border-border/70 p-4"
            data-testid="dashboard-comparison-snapshot"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-caption font-medium text-muted-foreground">
                  <T k="pageLabels.comparisonSnapshot" />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  <T k="pageLabels.currentVsPriorMonthForThisWorkspace" />
                </div>
              </div>
              <Badge variant="outline">
                <T k="pageLabels.currentVsPrior" />
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {dashboardComparisonRows.map((row) => (
                <Link key={row.id} href={row.href}>
                  <div className="rounded-md bg-muted/30 p-3 transition-colors hover:bg-muted/60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-foreground">{row.label}</div>
                      <Badge variant={dashboardComparisonBadgeVariant(row)}>
                        {formatDashboardComparisonPercent(row.percentChange)}
                      </Badge>
                    </div>
                    <div className="mt-2 font-mono text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(row.current, "AED", locale)}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-caption text-muted-foreground">
                      <span>Prior {formatCurrency(row.previous, "AED", locale)}</span>
                      <span className="inline-flex items-center gap-1 text-accent">
                        <T k="firm.statusOpen" />
                        <ArrowUpRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="text-caption font-medium text-muted-foreground">
            <T k="pageLabels.automationLanes" />
          </div>
          <div className="mt-3 divide-y divide-border/50">
            {preferredReportWorkspace.automations.map((playbook) => (
              <div key={playbook.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{playbook.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {playbook.trigger}
                    </div>
                  </div>
                  <Link
                    href={reportAutomationPlaybookHref(playbook, preferredReportWorkspace.persona)}
                  >
                    <Button variant="outline" size="sm" className="shrink-0">
                      {playbook.cta}
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 p-5" data-testid="dashboard-report-pack-readiness">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="reportCenter.reportPackReadiness" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums tabular-nums text-foreground">
              {preferredReportPackReadiness.readinessPercent}%
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {preferredReportPackReadiness.readyReports} of{" "}
              {preferredReportPackReadiness.totalReports} workspace reports are ready/API backed.{" "}
              {preferredReportPackReadiness.plannedReports} planned report
              {preferredReportPackReadiness.plannedReports === 1 ? "" : "s"} need review before
              fully automated sending.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[420px]">
            <div className="rounded-md border border-border/70 p-3">
              <div className="text-caption font-medium text-muted-foreground">
                <T k="reportCenter.cadence" />
              </div>
              <div className="mt-1 text-xs leading-relaxed text-foreground">
                {preferredReportWorkspace.packSchedule.cadence}
              </div>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <div className="text-caption font-medium text-muted-foreground">
                <T k="reportCenter.delivery" />
              </div>
              <div className="mt-1 text-xs leading-relaxed text-foreground">
                {preferredReportWorkspace.packSchedule.delivery}
              </div>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <div className="text-caption font-medium text-muted-foreground">
                <T k="reportCenter.automations" />
              </div>
              <div className="mt-1 text-xs leading-relaxed text-foreground">
                {preferredReportPackReadiness.automationLanes} lanes ·{" "}
                {preferredReportWorkspace.packSchedule.automation}
              </div>
            </div>
          </div>
        </div>

        <div
          className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
          data-testid="dashboard-report-workflow-gap-filters"
        >
          {preferredReportWorkflowGapLinks.map((link) => (
            <Link key={link.gap} href={link.href}>
              <Button
                variant={link.isPreferred ? "default" : "outline"}
                size="sm"
                className="h-auto w-full justify-between gap-2 px-3 py-2 text-left"
                onClick={() => {
                  setPreferredReportWorkflowGapFilter(preferredReportWorkspace.persona, link.gap);
                  setReportWorkflowPreferenceRevision((revision) => revision + 1);
                }}
                data-testid={`dashboard-report-workflow-gap-${link.gap}`}
              >
                <span className="truncate">{link.label}</span>
                <Badge variant={link.count > 0 ? "warning" : "success"}>{link.count}</Badge>
              </Button>
            </Link>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={reportSectionHref(preferredReportWorkspace, "pack-readiness")}>
            <Button variant="outline" size="sm">
              <T k="pageLabels.reviewPackReadiness" />
            </Button>
          </Link>
          <Link href={reportSectionHref(preferredReportWorkspace, "automation-rules")}>
            <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
              <T k="pageLabels.openAutomationRules" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
          <Link href={reportSectionHref(preferredReportWorkspace, "pack-automation")}>
            <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
              <T k="pageLabels.openPackAutomation" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </>
  );
}
