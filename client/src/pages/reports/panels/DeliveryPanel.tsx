// Reports > delivery workspace panel.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { SiGooglesheets } from "react-icons/si";
import { T } from "@/components/layout/T";
import { Money } from "@/components/ui/money";
import { reportWorkspaceHref } from "@/lib/reportCatalog";
import { useReportsPageContext } from "../context";
import { DeliverySubscriptionsSection } from "./sections/DeliverySubscriptionsSection";

export default function DeliveryPanel() {
  const {
    handleExportWorkspacePackToSheets,
    isExporting,
    navigate,
    personaScopeDescription,
    reportAccountantHandoffSummaries,
    reportAutomationOperationsNeedingReview,
    reportPackReviewCount,
    reportWorkspacePanelClass,
    selectedCompanyId,
    visibleReportAutomationHealthTrends,
    visibleReportPackAutomation,
    visibleReportPackReadiness,
  } = useReportsPageContext();
  return (
    <>
      <section
        className={reportWorkspacePanelClass("delivery", "space-y-4")}
        aria-labelledby="report-accountant-handoff-title"
        data-testid="report-accountant-handoff"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-accountant-handoff-title" className="text-xl font-semibold">
              <T k="reportCenter.accountantHandoff" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Share role-specific report context, readiness status, and the next automation action
              without rebuilding the workspace view.
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {reportAutomationOperationsNeedingReview > 0
              ? `${reportAutomationOperationsNeedingReview} handoffs need action`
              : "Handoffs ready"}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {reportAccountantHandoffSummaries.map((item) => (
            <Card
              key={item.workspace.persona}
              data-testid={`report-accountant-handoff-${item.workspace.persona}`}
            >
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base font-semibold">
                      {item.workspace.navLabel}
                    </CardTitle>
                    <CardDescription>{item.workspace.automationOutcome}</CardDescription>
                  </div>
                  <Badge variant={item.statusVariant} dot>
                    {item.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">
                      <T k="reportCenter.reports" />
                    </div>
                    <div className="mt-1 tabular-nums font-semibold text-foreground">
                      {item.readyReportCount}/{item.reportCount}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">
                      <T k="reportCenter.rules" />
                    </div>
                    <div className="mt-1 tabular-nums font-semibold text-foreground">
                      {item.readyRuleCount}/{item.automationRuleCount}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">
                      <T k="reportCenter.delivery" />
                    </div>
                    <div className="mt-1 tabular-nums font-semibold text-foreground">
                      {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                    </div>
                  </div>
                </div>

                <div className="rounded-md bg-muted/30 p-3 text-xs leading-relaxed">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{item.priorityGapLabel}</span>
                    <Badge variant={item.nextAction.badgeVariant}>{item.nextAction.badge}</Badge>
                  </div>
                  <p className="mt-2 text-muted-foreground">{item.nextAction.detail}</p>
                  <div className="mt-2 text-muted-foreground">
                    Amount at risk:{" "}
                    <span className="tabular-nums text-foreground">
                      <Money amount={item.amountAtRisk} currency={"AED"} />
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={item.shareHref}
                      data-testid={`report-accountant-handoff-share-${item.workspace.persona}`}
                    >
                      <T k="reportCenter.openSharedView" />
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={item.gapHref}
                      data-testid={`report-accountant-handoff-gap-${item.workspace.persona}`}
                    >
                      {item.priorityGap ? "Review gap" : "Open finder"}
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="text-accent">
                    <Link
                      href={item.nextAction.href}
                      data-testid={`report-accountant-handoff-action-${item.workspace.persona}`}
                    >
                      <T k="pages.nextAction" />
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <DeliverySubscriptionsSection />
      <section
        className={reportWorkspacePanelClass("delivery", "space-y-4")}
        aria-labelledby="report-pack-readiness-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-readiness-title" className="text-xl font-semibold">
              <T k="reportCenter.reportPackReadiness" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Delivery checks for scheduled packs before they reach owners, freelancers, or
              accountants. {personaScopeDescription}
            </p>
          </div>
          <Badge
            variant={
              visibleReportPackReadiness.some((item) => item.reviewCount > 0)
                ? "warning"
                : "success"
            }
            dot
          >
            {visibleReportPackReadiness.reduce((sum, item) => sum + item.reviewCount, 0)} review
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportPackReadiness.map((item) => {
            const workspace = item.workspace;
            const WorkspaceIcon = workspace.icon;
            const healthTrend = visibleReportAutomationHealthTrends.find(
              (entry) => entry.workspace.persona === workspace.persona
            )?.trend;

            return (
              <Card key={workspace.persona} data-testid={`pack-readiness-${workspace.persona}`}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{workspace.title}</CardTitle>
                        <CardDescription>{workspace.packSchedule.delivery}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={item.reviewCount > 0 ? "warning" : "success"} dot>
                      {item.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div
                    className="rounded-md border p-3"
                    data-testid={`pack-automation-health-${workspace.persona}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">
                          <T k="reportCenter.automationHealth" />
                        </div>
                        <div className="mt-1 tabular-nums text-2xl font-semibold">
                          {item.automationHealth.score}
                          <span className="text-xs font-normal text-muted-foreground">/100</span>
                        </div>
                      </div>
                      <Badge variant={item.automationHealth.variant} dot>
                        {item.automationHealth.label}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Pack</div>
                        <div className="tabular-nums font-semibold">
                          {item.automationHealth.readinessScore}%
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">
                          <T k="reportCenter.lanes" />
                        </div>
                        <div className="tabular-nums font-semibold">
                          {item.automationHealth.automationLaneScore}%
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">
                          <T k="reportCenter.review" />
                        </div>
                        <div className="tabular-nums font-semibold">
                          {item.automationHealth.reviewSignals}
                        </div>
                      </div>
                    </div>
                    {healthTrend ? (
                      <div
                        className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 p-2"
                        data-testid={`automation-health-trend-${item.workspace.persona}`}
                      >
                        <div>
                          <div className="text-xs font-medium">
                            <T k="reportCenter.healthTrend" />
                          </div>
                          <div className="text-xs text-muted-foreground">{healthTrend.detail}</div>
                        </div>
                        <Badge variant={healthTrend.variant} dot>
                          {healthTrend.label}
                        </Badge>
                      </div>
                    ) : null}
                  </div>

                  {item.checks.map((check) => (
                    <div
                      key={check.id}
                      className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="text-sm font-medium">{check.label}</div>
                        <div className="text-xs text-muted-foreground">{check.detail}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={check.status === "Ready" ? "success" : "warning"} dot>
                          {check.status}
                        </Badge>
                        <Button asChild size="sm" variant="outline">
                          <Link href={check.workflow}>Open</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
      <section
        className={reportWorkspacePanelClass("delivery", "space-y-4")}
        aria-labelledby="report-pack-automation-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-automation-title" className="text-xl font-semibold">
              <T k="reportCenter.reportPackAutomation" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Scheduled workspace packs with live report signals before delivery.{" "}
              {personaScopeDescription}
            </p>
          </div>
          <Badge variant={reportPackReviewCount > 0 ? "warning" : "success"} dot>
            {reportPackReviewCount} need review
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportPackAutomation.map((item) => {
            const workspace = item.workspace;
            const WorkspaceIcon = workspace.icon;
            const readiness = visibleReportPackReadiness.find(
              (entry) => entry.workspace.persona === workspace.persona
            );
            const automationHealth = readiness?.automationHealth;

            return (
              <Card key={workspace.persona}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{workspace.title}</CardTitle>
                        <CardDescription>{workspace.packSchedule.cadence}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={(readiness?.reviewCount ?? 0) > 0 ? "warning" : "success"} dot>
                      {readiness?.status ?? item.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.health" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {automationHealth?.score ?? 0}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.openSignals" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {item.openSignalCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.workItems" />
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {item.openWorkItemCount}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.amount" />
                      </div>
                      <div className="truncate tabular-nums text-sm font-semibold">
                        <Money amount={item.amountAtRisk} currency={"AED"} />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border p-3 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">Delivery:</span>{" "}
                      {workspace.packSchedule.delivery}
                    </div>
                    <div className="mt-1">
                      <span className="font-medium text-foreground">Recipients:</span>{" "}
                      {workspace.packSchedule.recipients}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.reportPackReadiness" />
                    </div>
                    {readiness?.checks.slice(0, 4).map((check) => (
                      <div
                        key={check.id}
                        className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{check.label}</div>
                          <div className="text-xs text-muted-foreground">{check.detail}</div>
                        </div>
                        <Badge variant={check.status === "Ready" ? "success" : "warning"} dot>
                          {check.status}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.liveSignals" />
                    </div>
                    {item.signals.slice(0, 3).map((signal) => (
                      <div
                        key={signal.id}
                        className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">{signal.title}</div>
                          <div className="text-xs text-muted-foreground">{signal.detail}</div>
                        </div>
                        <Badge variant={signal.count > 0 ? "warning" : "success"} dot>
                          {signal.count > 0 ? signal.count : "Clear"}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(reportWorkspaceHref(workspace))}
                    >
                      <T k="reportCenter.openWorkspace" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isExporting || !selectedCompanyId}
                      onClick={() => handleExportWorkspacePackToSheets(workspace)}
                    >
                      <SiGooglesheets className="me-2 h-4 w-4" />
                      <T k="reportCenter.sendPack" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
