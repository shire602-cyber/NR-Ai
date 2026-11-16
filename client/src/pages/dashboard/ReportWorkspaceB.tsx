import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { reportSectionHref } from "@/lib/reportCatalog";
import { Sparkles, ArrowRight, Clock, BarChart3 } from "lucide-react";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function ReportWorkspacePartB({ m }: { m: DashboardModel }) {
  const { preferredReportWorkspace, preferredReportQuickAccess, preferredReportSavedViews } = m;
  return (
    <>
      <div className="border-b border-border/60 p-5" data-testid="dashboard-report-quick-access">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[11px] uppercase font-semibold text-muted-foreground">
                <T k="reportCenter.quickAccessReports" />
              </div>
              <Badge variant="info" dot>
                {preferredReportQuickAccess.readyReports}/
                {preferredReportQuickAccess.reports.length} ready
              </Badge>
            </div>
            <h3 className="mt-2 text-base font-semibold text-foreground">
              {preferredReportQuickAccess.profile.title}
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
              {preferredReportQuickAccess.profile.outcome}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href={preferredReportQuickAccess.comparisonHref}>
              <Button variant="outline" size="sm">
                <BarChart3 className="w-3.5 h-3.5" />
                <T k="reportCenter.comparison" />
              </Button>
            </Link>
            <Link href={preferredReportQuickAccess.automationHref}>
              <Button variant="outline" size="sm">
                <Sparkles className="w-3.5 h-3.5" />
                <T k="reportCenter.autopilot" />
              </Button>
            </Link>
            <Link href={preferredReportQuickAccess.deliveryHref}>
              <Button variant="outline" size="sm">
                <Clock className="w-3.5 h-3.5" />
                <T k="reportCenter.delivery" />
              </Button>
            </Link>
            <Link href={preferredReportQuickAccess.href}>
              <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                <T k="pageLabels.openBoard" />
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {preferredReportQuickAccess.primaryReports.map(
            ({ report, href, workflowHref, comparisonHref, deliveryHref }) => (
              <div
                key={report.id}
                className="rounded-md border border-border/70 p-3 transition-colors hover:bg-accent/5"
                data-testid={`dashboard-report-quick-access-${report.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {report.name}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {report.category} · {report.comparison}
                    </div>
                  </div>
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={href}>
                    <Button size="sm" variant="outline" className="h-7 px-2">
                      Open
                    </Button>
                  </Link>
                  <Link href={workflowHref}>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      data-testid={`dashboard-report-quick-access-automation-${report.id}`}
                    >
                      <T k="reportCenter.automate" />
                    </Button>
                  </Link>
                  {comparisonHref ? (
                    <Link href={comparisonHref}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        data-testid={`dashboard-report-quick-access-comparison-${report.id}`}
                      >
                        <T k="reportCenter.compare" />
                      </Button>
                    </Link>
                  ) : null}
                  {deliveryHref ? (
                    <Link href={deliveryHref}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        data-testid={`dashboard-report-quick-access-delivery-${report.id}`}
                      >
                        <T k="reportCenter.schedule" />
                      </Button>
                    </Link>
                  ) : null}
                </div>
              </div>
            )
          )}
        </div>

        {preferredReportQuickAccess.additionalReports.length > 0 ? (
          <div
            className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3"
            data-testid="dashboard-report-quick-access-more"
          >
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">
              <T k="reportCenter.moreReports" />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {preferredReportQuickAccess.additionalReports.map(({ report, href }) => (
                <Link key={report.id} href={href}>
                  <Badge variant="outline" className="max-w-[220px] truncate">
                    {report.name}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="border-b border-border/60 p-5" data-testid="dashboard-report-saved-views">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-[11px] uppercase font-semibold text-muted-foreground">
              <T k="reportCenter.savedReportViews" />
            </div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
              Preset views with date range, comparison period, basis, currency, dimension, export
              format, and automation trigger for this workspace.
            </p>
          </div>
          <Link href={reportSectionHref(preferredReportWorkspace, "saved-views")}>
            <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
              <T k="pageLabels.openSavedViews" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {preferredReportSavedViews.map((view) => (
            <div
              key={view.id}
              className="rounded-md border border-border/70 p-3"
              data-testid={`dashboard-report-saved-view-${view.id}`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{view.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {view.dateRangePreset} · {view.comparisonPeriod} · {view.currency}
                  </div>
                </div>
                <Badge variant="outline">{view.dimension}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={view.reportHref}>
                  <Button variant="outline" size="sm">
                    <T k="reportCenter.openReport" />
                  </Button>
                </Link>
                <Link href={view.comparisonHref}>
                  <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                    <T k="reportCenter.comparison" />
                  </Button>
                </Link>
                <Link href={view.workflowHref}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-accent hover:text-accent"
                    data-testid={`dashboard-report-saved-view-automation-${view.id}`}
                  >
                    <T k="reportCenter.automation" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
