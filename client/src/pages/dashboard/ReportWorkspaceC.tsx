import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { reportSectionHref } from "@/lib/reportCatalog";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";
import {
  dashboardDeliveryRunReadinessVariant,
  formatDashboardDeliveryRunTime,
} from "./workspaceHelpers";

export function ReportWorkspacePartC({ m }: { m: DashboardModel }) {
  const {
    locale,
    selectedCompanyId,
    preferredReportWorkspace,
    reportCatalogDiscoveryQuery,
    preferredReportPackReadiness,
    queueDashboardReportDeliverySubscription,
    retryDashboardReportDeliveryRun,
    reportAutomationHealth,
    preferredReportAutomationImpact,
    dashboardLatestDeliveryRun,
    dashboardLatestDeliveryRunSubscription,
    dashboardDeliveryRunStatusSummary,
    preferredAutomationNextAction,
    queueDashboardReportDeliverySubscriptionWithHandoffGuard,
    preferredAutomationQueueRequiresHandoffAcknowledgement,
  } = m;
  return (
    <>
      <div
        className="border-b border-border/60 p-5"
        data-testid="dashboard-report-automation-health"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-caption font-medium text-muted-foreground">
                <T k="reportCenter.automationHealth" />
              </div>
              <Badge variant={reportAutomationHealth.variant} dot>
                {reportAutomationHealth.label}
              </Badge>
              <Badge
                variant={reportCatalogDiscoveryQuery.isError ? "warning" : "info"}
                data-testid="dashboard-report-catalog-sync"
              >
                {reportCatalogDiscoveryQuery.isLoading
                  ? "Syncing catalog"
                  : reportCatalogDiscoveryQuery.isError
                    ? "Local catalog"
                    : `${preferredReportPackReadiness.syncedReadyReports} synced reports`}
              </Badge>
              <Badge variant="outline" data-testid="dashboard-report-catalog-pack-count">
                {preferredReportPackReadiness.syncedPackTemplates} packs
              </Badge>
              <Badge variant="outline" data-testid="dashboard-report-catalog-comparison-count">
                {preferredReportPackReadiness.syncedComparisonPresets} comparisons
              </Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
                {reportAutomationHealth.score}
              </span>
              <span className="text-xs text-muted-foreground">/ 100</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Blends pack readiness, automation lanes, and current-vs-prior movement for the
              selected workspace.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 md:min-w-[420px]">
            <div className="rounded-md border border-border/70 p-3">
              <div className="text-caption font-medium text-muted-foreground">Pack</div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {preferredReportPackReadiness.readinessPercent}%
              </div>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <div className="text-caption font-medium text-muted-foreground">
                <T k="reportCenter.lanes" />
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {preferredReportPackReadiness.syncedAutomationLanes}
              </div>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <div className="text-caption font-medium text-muted-foreground">
                <T k="pages.review" />
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums">
                {reportAutomationHealth.reviewSignals}
              </div>
            </div>
          </div>
        </div>

        <div
          className="mt-4 rounded-md border border-border/70 p-4"
          data-testid="dashboard-report-automation-impact"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-caption font-medium text-muted-foreground">
                  <T k="reportCenter.automationImpact" />
                </div>
                <Badge
                  variant={
                    preferredReportAutomationImpact.estimate.status === "compounding"
                      ? "success"
                      : preferredReportAutomationImpact.estimate.status === "review"
                        ? "warning"
                        : "neutral"
                  }
                  dot
                >
                  {preferredReportAutomationImpact.estimate.statusLabel}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {preferredReportAutomationImpact.profile.manualWorkLabel}.{" "}
                {preferredReportAutomationImpact.estimate.summary}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
              <div className="rounded-md bg-muted/30 p-3">
                <div className="text-caption font-medium text-muted-foreground">
                  <T k="reportCenter.hoursSaved" />
                </div>
                <div className="mt-1 font-mono text-lg font-semibold">
                  {preferredReportAutomationImpact.estimate.estimatedMonthlyHoursSaved}
                </div>
              </div>
              <div className="rounded-md bg-muted/30 p-3">
                <div className="text-caption font-medium text-muted-foreground">
                  <T k="pageLabels.itemsHandled" />
                </div>
                <div className="mt-1 font-mono text-lg font-semibold">
                  {preferredReportAutomationImpact.estimate.estimatedAutomatedItemCount}
                </div>
              </div>
              <div className="rounded-md bg-muted/30 p-3">
                <div className="text-caption font-medium text-muted-foreground">
                  <T k="reportCenter.coverage" />
                </div>
                <div className="mt-1 font-mono text-lg font-semibold">
                  {preferredReportAutomationImpact.estimate.coverageScore}%
                </div>
              </div>
              <div className="rounded-md bg-muted/30 p-3">
                <div className="text-caption font-medium text-muted-foreground">
                  <T k="pageLabels.watched" />
                </div>
                <div className="mt-1 truncate font-mono text-sm font-semibold">
                  {formatCurrency(
                    preferredReportAutomationImpact.estimate.amountAtRisk,
                    "AED",
                    locale
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            <Link href={reportSectionHref(preferredReportWorkspace, "automation-operations")}>
              <Button variant="outline" size="sm">
                <T k="pageLabels.openOperations" />
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
            <Link href={reportSectionHref(preferredReportWorkspace, "automation-command-center")}>
              <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                <T k="pageLabels.openAutomationCenter" />
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
            <Link href={preferredReportAutomationImpact.href}>
              <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                <T k="pageLabels.openAutomationImpact" />
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
            <Link href={reportSectionHref(preferredReportWorkspace, "automation-starters")}>
              <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                <T k="pageLabels.openAutomationStarters" />
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
            <Link href={reportSectionHref(preferredReportWorkspace, "delivery-subscriptions")}>
              <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                <T k="pageLabels.openDeliverySubscriptions" />
                <ArrowRight className="w-3.5 h-3.5" />
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
                <T k="pageLabels.reviewAutomationHealth" />
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        <div
          className="mt-4 rounded-md border border-border/70 p-4"
          data-testid="dashboard-next-automation-action"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-caption font-medium text-muted-foreground">
                  <T k="pageLabels.nextAutomationAction" />
                </div>
                <Badge variant={preferredAutomationNextAction.badgeVariant} dot>
                  {preferredAutomationNextAction.badge}
                </Badge>
                {preferredAutomationNextAction.command ? (
                  <Badge
                    variant="outline"
                    data-testid={`dashboard-next-automation-command-${preferredAutomationNextAction.command}`}
                  >
                    <T k="pageLabels.pinnedCommand" />
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2 text-sm font-semibold text-foreground">
                {preferredAutomationNextAction.title}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {preferredAutomationNextAction.detail}
              </p>
              {dashboardDeliveryRunStatusSummary && dashboardLatestDeliveryRun ? (
                <div
                  className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground"
                  data-testid="dashboard-report-delivery-run-feedback"
                >
                  <div
                    className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
                    data-testid="dashboard-next-automation-run-status"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={dashboardDeliveryRunStatusSummary.statusVariant}
                          dot
                          data-testid={`dashboard-next-automation-run-status-${dashboardDeliveryRunStatusSummary.status}`}
                        >
                          {dashboardDeliveryRunStatusSummary.statusLabel}
                        </Badge>
                        <Badge
                          variant={dashboardDeliveryRunReadinessVariant(
                            dashboardLatestDeliveryRun.readinessStatus
                          )}
                          data-testid="dashboard-report-delivery-run-readiness"
                        >
                          {dashboardLatestDeliveryRun.readinessStatus}
                        </Badge>
                      </div>
                      <p className="mt-2 min-w-0 break-words">
                        {dashboardDeliveryRunStatusSummary.detail}
                      </p>
                    </div>
                    <Link
                      href={
                        dashboardLatestDeliveryRunSubscription?.href ??
                        reportSectionHref(preferredReportWorkspace, "delivery-subscriptions")
                      }
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-accent hover:text-accent"
                        data-testid="dashboard-report-delivery-run-open"
                      >
                        <T k="reportCenter.openDelivery" />
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md bg-background/70 p-2">
                      <div className="text-muted-foreground">
                        <T k="pageLabels.scheduled" />
                      </div>
                      <div
                        className="mt-1 font-medium text-foreground"
                        data-testid="dashboard-report-delivery-run-scheduled"
                      >
                        {formatDashboardDeliveryRunTime(
                          dashboardLatestDeliveryRun.scheduledFor,
                          locale
                        )}
                      </div>
                    </div>
                    <div className="rounded-md bg-background/70 p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.reports" />
                      </div>
                      <div
                        className="mt-1 font-semibold tabular-nums text-foreground"
                        data-testid="dashboard-report-delivery-run-report-count"
                      >
                        {dashboardLatestDeliveryRun.readyReportCount}/
                        {dashboardLatestDeliveryRun.reportCount}
                      </div>
                    </div>
                    <div className="rounded-md bg-background/70 p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.channel" />
                      </div>
                      <div
                        className="mt-1 font-medium text-foreground"
                        data-testid="dashboard-report-delivery-run-channel"
                      >
                        {dashboardLatestDeliveryRun.channel}
                      </div>
                    </div>
                  </div>
                  <p
                    className="mt-3 leading-relaxed"
                    data-testid="dashboard-report-delivery-run-guardrail"
                  >
                    {dashboardLatestDeliveryRun.deliveryGuardrail}
                  </p>
                  {dashboardLatestDeliveryRun.errorMessage ? (
                    <p
                      className="mt-2 text-destructive"
                      data-testid="dashboard-report-delivery-run-error"
                    >
                      {dashboardLatestDeliveryRun.errorMessage}
                    </p>
                  ) : null}
                  {dashboardLatestDeliveryRun.retriedFromRunId ? (
                    <p
                      className="mt-2 text-muted-foreground"
                      data-testid="dashboard-report-delivery-run-retried-from"
                    >
                      <T k="reportCenter.requeuedFromAFailedDeliveryRun" />
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {preferredAutomationNextAction.actionType === "queue" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={
                  !selectedCompanyId ||
                  queueDashboardReportDeliverySubscription.isPending ||
                  !preferredAutomationNextAction.subscriptionId
                }
                onClick={() => {
                  const subscriptionId = preferredAutomationNextAction.subscriptionId;
                  if (!subscriptionId) return;
                  queueDashboardReportDeliverySubscriptionWithHandoffGuard(subscriptionId);
                }}
                data-testid="dashboard-next-automation-queue"
              >
                {queueDashboardReportDeliverySubscription.isPending
                  ? "Queueing"
                  : preferredAutomationQueueRequiresHandoffAcknowledgement
                    ? "Acknowledge handoff"
                    : preferredAutomationNextAction.cta}
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            ) : preferredAutomationNextAction.actionType === "retry" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={
                  !selectedCompanyId ||
                  retryDashboardReportDeliveryRun.isPending ||
                  !preferredAutomationNextAction.runId
                }
                onClick={() => {
                  const runId = preferredAutomationNextAction.runId;
                  if (!runId) return;
                  retryDashboardReportDeliveryRun.mutate(runId);
                }}
                data-testid="dashboard-next-automation-retry"
              >
                {retryDashboardReportDeliveryRun.isPending
                  ? "Retrying"
                  : preferredAutomationNextAction.cta}
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Link href={preferredAutomationNextAction.href}>
                <Button variant="outline" size="sm" className="shrink-0">
                  {preferredAutomationNextAction.cta}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
