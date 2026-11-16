// Reports > delivery: subscriptions, delivery settings, previews and run history.
// Split out of DeliveryPanel.tsx (R20-09); state comes from useReportsPage via context.
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  ListFilter,
  Pencil,
  Pin,
  RotateCcw,
  Save,
  Send,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeliveryRunFiles } from "../../DeliveryRunFiles";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { ReportLaunchPicker } from "@/components/reports/ReportLaunchPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { Textarea } from "@/components/ui/textarea";
import {
  deliveryPreviewCheckVariant,
  deliveryRunStatusVariant,
  formatDeliveryRunTimestamp,
  normalizeDeliverySetting,
  reportDeliveryAutomationCommandCardClass,
  reportDeliveryAutomationCommandLabels,
  reportDeliveryRunStatusFilters,
  triggerSeverityMeta,
} from "../../shared";
import { useReportsPageContext } from "../../context";

export function DeliverySubscriptionsSection() {
  const {
    activeReportWorkspaceTab,
    automationLoading,
    commandQueueSubscriptionRequiresHandoffAcknowledgement,
    editingReportDeliverySubscriptionId,
    isReportDeliveryHandoffAcknowledged,
    personaFilterLabel,
    personaScopeDescription,
    pinReportDeliveryAutomationCommand,
    pinnedReportDeliveryAutomationCommand,
    queueReportDeliverySubscription,
    queueReportDeliverySubscriptionWithHandoffGuard,
    reportDeliveryAutomationCommandTargets,
    reportDeliveryHandoffPreviewByPersona,
    reportDeliveryLauncherPersona,
    reportDeliveryLauncherPreviewById,
    reportDeliveryRecoverySummary,
    reportDeliveryRunStatusCounts,
    reportDeliveryRunStatusFilter,
    reportDeliveryRunTimelineRows,
    reportDeliverySettingsDraft,
    reportWorkspacePanelClass,
    retryReportDeliveryRun,
    saveReportDeliverySubscriptionSettings,
    selectedCompanyId,
    setEditingReportDeliverySubscriptionId,
    setReportDeliveryRunStatusFilter,
    startEditingReportDeliverySubscription,
    updateReportDeliverySettingsDraft,
    visibleReportDeliverySubscriptions,
  } = useReportsPageContext();
  return (
    <>
      <section
        className={reportWorkspacePanelClass("delivery", "space-y-4")}
        aria-labelledby="report-delivery-subscriptions-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-delivery-subscriptions-title" className="text-xl font-semibold">
              <T k="reportCenter.deliverySubscriptions" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Scheduled report packs that define cadence, recipients, channel, and guardrails before
              auto-send. {personaScopeDescription}
            </p>
          </div>
          <Badge
            variant={
              visibleReportDeliverySubscriptions.some(
                (subscription) => subscription.status !== "Ready to send"
              )
                ? "warning"
                : "success"
            }
            dot
          >
            {visibleReportDeliverySubscriptions.length} subscriptions
          </Badge>
        </div>

        <ReportLaunchPicker
          persona={reportDeliveryLauncherPersona}
          mode="delivery"
          onQueueDeliverySubscription={(subscriptionId) =>
            queueReportDeliverySubscriptionWithHandoffGuard(subscriptionId)
          }
          onRetryDeliveryRun={(runId) => retryReportDeliveryRun.mutate(runId)}
          queueingDeliverySubscriptionId={
            queueReportDeliverySubscription.isPending
              ? (queueReportDeliverySubscription.variables?.subscriptionId ?? null)
              : null
          }
          retryingDeliveryRunId={
            retryReportDeliveryRun.isPending ? (retryReportDeliveryRun.variables ?? null) : null
          }
          deliveryQueueDisabled={!selectedCompanyId || queueReportDeliverySubscription.isPending}
          deliveryRetryDisabled={!selectedCompanyId || retryReportDeliveryRun.isPending}
          deliverySubscriptionPreviewById={reportDeliveryLauncherPreviewById}
          preferredDeliveryAutomationCommand={pinnedReportDeliveryAutomationCommand}
          loadDeliveryAutomationPreferences={activeReportWorkspaceTab === "delivery"}
          companyId={selectedCompanyId}
          className="shadow-none"
        />

        <div
          className="rounded-md border border-border/70 p-3"
          data-testid="report-delivery-recovery-summary"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <T k="reportCenter.automationRecovery" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Failed delivery recovery and review queue for the current{" "}
                {personaFilterLabel.toLowerCase()} reporting view.
              </p>
            </div>
            <Badge variant={reportDeliveryRecoverySummary.nextAction.badgeVariant} dot>
              {reportDeliveryRecoverySummary.nextAction.badge}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
            <div
              className="rounded-md bg-secondary/40 p-2"
              data-testid="report-delivery-recovery-failed-runs"
            >
              <div className="text-muted-foreground">
                <T k="reportCenter.failedRuns" />
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-foreground">
                {reportDeliveryRecoverySummary.failedRunCount}
              </div>
            </div>
            <div
              className="rounded-md bg-secondary/40 p-2"
              data-testid="report-delivery-recovery-retryable-subscriptions"
            >
              <div className="text-muted-foreground">
                <T k="reportCenter.retryableSubscriptions" />
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-foreground">
                {reportDeliveryRecoverySummary.retryableSubscriptionCount}
              </div>
            </div>
            <div
              className="rounded-md bg-secondary/40 p-2"
              data-testid="report-delivery-recovery-review-subscriptions"
            >
              <div className="text-muted-foreground">
                <T k="reportCenter.needsReview" />
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-foreground">
                {reportDeliveryRecoverySummary.reviewSubscriptionCount}
              </div>
            </div>
          </div>

          <div
            className="mt-3 flex flex-col gap-2 rounded-md bg-secondary/40 p-2 text-xs sm:flex-row sm:items-center sm:justify-between"
            data-testid="report-delivery-recovery-next-action"
          >
            <div>
              <div className="font-medium text-foreground">
                {reportDeliveryRecoverySummary.nextAction.label}
              </div>
              <div className="mt-1 text-muted-foreground">
                {reportDeliveryRecoverySummary.nextAction.detail}
              </div>
            </div>
            {reportDeliveryRecoverySummary.nextAction.kind === "retry" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!selectedCompanyId || retryReportDeliveryRun.isPending}
                onClick={() => {
                  const runId = reportDeliveryRecoverySummary.nextAction.runId;
                  if (!runId) return;
                  retryReportDeliveryRun.mutate(runId);
                }}
                data-testid="report-delivery-recovery-retry-latest"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <T k="reportCenter.retryLatest" />
              </Button>
            ) : reportDeliveryRecoverySummary.nextAction.kind === "open" ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={reportDeliveryRecoverySummary.nextAction.href}
                  data-testid="report-delivery-recovery-open-review"
                >
                  <T k="reportCenter.openReview" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div
          className="rounded-md border border-border/70 p-3"
          data-testid="report-delivery-command-strip"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">
                <T k="reportCenter.automationCommandStrip" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                One-click recovery, guardrail review, delivery queueing, and comparison paths for{" "}
                {personaFilterLabel.toLowerCase()} workflows.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={pinnedReportDeliveryAutomationCommand ? "success" : "neutral"}
                dot
                data-testid="report-delivery-command-pinned"
              >
                {pinnedReportDeliveryAutomationCommand
                  ? `Pinned: ${reportDeliveryAutomationCommandLabels[pinnedReportDeliveryAutomationCommand]}`
                  : "No pinned command"}
              </Badge>
              <Badge variant="info" dot>
                {personaFilterLabel}
              </Badge>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
            <div
              className={reportDeliveryAutomationCommandCardClass(
                "retry",
                pinnedReportDeliveryAutomationCommand
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                  <T k="reportCenter.retryRecovery" />
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={pinnedReportDeliveryAutomationCommand === "retry" ? "default" : "ghost"}
                  aria-pressed={pinnedReportDeliveryAutomationCommand === "retry"}
                  onClick={() => pinReportDeliveryAutomationCommand("retry")}
                  data-testid="report-delivery-command-pin-retry"
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                <T k="reportCenter.requeueTheLatestFailedScheduledReportPack" />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={
                  !selectedCompanyId ||
                  retryReportDeliveryRun.isPending ||
                  !reportDeliveryAutomationCommandTargets.retryRunId
                }
                onClick={() => {
                  const runId = reportDeliveryAutomationCommandTargets.retryRunId;
                  if (!runId) return;
                  retryReportDeliveryRun.mutate(runId);
                }}
                data-testid="report-delivery-command-retry"
              >
                <T k="reportCenter.retryNow" />
              </Button>
            </div>

            <div
              className={reportDeliveryAutomationCommandCardClass(
                "review",
                pinnedReportDeliveryAutomationCommand
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  <T k="reportCenter.reviewGuardrails" />
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={pinnedReportDeliveryAutomationCommand === "review" ? "default" : "ghost"}
                  aria-pressed={pinnedReportDeliveryAutomationCommand === "review"}
                  onClick={() => pinReportDeliveryAutomationCommand("review")}
                  data-testid="report-delivery-command-pin-review"
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                <T k="reportCenter.openTheFirstDeliveryNeedingSetupEnablement" />
              </div>
              {reportDeliveryAutomationCommandTargets.reviewSubscription ? (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link
                    href={reportDeliveryAutomationCommandTargets.reviewSubscription.href}
                    data-testid="report-delivery-command-review"
                  >
                    <T k="reportCenter.openReview" />
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled
                  data-testid="report-delivery-command-review"
                >
                  <T k="reportCenter.noReview" />
                </Button>
              )}
            </div>

            <div
              className={reportDeliveryAutomationCommandCardClass(
                "queue",
                pinnedReportDeliveryAutomationCommand
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Send className="h-3.5 w-3.5 text-muted-foreground" />
                  <T k="reportCenter.queueNextPack" />
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={pinnedReportDeliveryAutomationCommand === "queue" ? "default" : "ghost"}
                  aria-pressed={pinnedReportDeliveryAutomationCommand === "queue"}
                  onClick={() => pinReportDeliveryAutomationCommand("queue")}
                  data-testid="report-delivery-command-pin-queue"
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                <T k="reportCenter.queueTheNextEnabledDeliverySubscriptionFor" />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={
                  !selectedCompanyId ||
                  queueReportDeliverySubscription.isPending ||
                  !reportDeliveryAutomationCommandTargets.queueSubscription
                }
                onClick={() => {
                  const subscriptionId =
                    reportDeliveryAutomationCommandTargets.queueSubscription?.id;
                  if (!subscriptionId) return;
                  queueReportDeliverySubscriptionWithHandoffGuard(subscriptionId);
                }}
                data-testid="report-delivery-command-queue"
              >
                {commandQueueSubscriptionRequiresHandoffAcknowledgement
                  ? "Acknowledge handoff"
                  : "Queue pack"}
              </Button>
            </div>

            <div
              className={reportDeliveryAutomationCommandCardClass(
                "comparison",
                pinnedReportDeliveryAutomationCommand
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                  <T k="reportCenter.openComparison" />
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={
                    pinnedReportDeliveryAutomationCommand === "comparison" ? "default" : "ghost"
                  }
                  aria-pressed={pinnedReportDeliveryAutomationCommand === "comparison"}
                  onClick={() => pinReportDeliveryAutomationCommand("comparison")}
                  data-testid="report-delivery-command-pin-comparison"
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 text-muted-foreground">
                <T k="reportCenter.reviewTheHighestPriorityComparisonPackFor" />
              </div>
              {reportDeliveryAutomationCommandTargets.comparisonPreset ? (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link
                    href={reportDeliveryAutomationCommandTargets.comparisonPreset.href}
                    data-testid="report-delivery-command-comparison"
                  >
                    <T k="reportCenter.openComparison" />
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled
                  data-testid="report-delivery-command-comparison"
                >
                  <T k="reportCenter.noComparison" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <div
          className="rounded-md border border-border/70 p-3"
          data-testid="report-delivery-run-timeline"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ListFilter className="h-4 w-4 text-muted-foreground" />
                <T k="reportCenter.deliveryRunTimeline" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Filter queued, sent, and failed report-pack automations within the current{" "}
                {personaFilterLabel.toLowerCase()} view.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Delivery run status">
              {reportDeliveryRunStatusFilters.map((filter) => (
                <Button
                  key={filter.id}
                  type="button"
                  size="sm"
                  variant={reportDeliveryRunStatusFilter === filter.id ? "default" : "outline"}
                  onClick={() => setReportDeliveryRunStatusFilter(filter.id)}
                  data-testid={`report-delivery-run-filter-${filter.id}`}
                >
                  {filter.label}
                  <span className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px]">
                    {reportDeliveryRunStatusCounts[filter.id]}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {reportDeliveryRunTimelineRows.length > 0 ? (
            <div
              className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2"
              data-testid="report-delivery-run-timeline-rows"
            >
              {reportDeliveryRunTimelineRows.map((run) => (
                <div
                  key={run.id}
                  className="rounded-md bg-secondary/40 p-2 text-xs"
                  data-testid={`report-delivery-run-timeline-${run.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={deliveryRunStatusVariant(run.status)} dot>
                        {run.status}
                      </Badge>
                      <span className="font-medium text-foreground">
                        {formatDeliveryRunTimestamp(run.createdAt)}
                      </span>
                    </div>
                    <Badge variant="outline">{run.workspaceLabel}</Badge>
                  </div>
                  <div className="mt-2 font-medium text-foreground">{run.subscriptionTitle}</div>
                  <div className="mt-1 text-muted-foreground">
                    Scheduled {formatDeliveryRunTimestamp(run.scheduledFor)} -{" "}
                    {run.readyReportCount}/{run.reportCount} reports - {run.channel}
                  </div>
                  {run.errorMessage ? (
                    <div className="mt-1 text-destructive">{run.errorMessage}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={run.subscriptionHref}>
                        <T k="reportCenter.openSubscription" />
                      </Link>
                    </Button>
                    {run.status === "failed" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!selectedCompanyId || retryReportDeliveryRun.isPending}
                        onClick={() => retryReportDeliveryRun.mutate(run.id)}
                        data-testid={`report-delivery-run-timeline-retry-${run.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <T k="reportCenter.retryDelivery" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="mt-3 rounded-md bg-secondary/40 p-3 text-xs text-muted-foreground"
              data-testid="report-delivery-run-timeline-empty"
            >
              {reportDeliveryRunStatusFilter === "all"
                ? `No delivery runs match this ${personaFilterLabel.toLowerCase()} view yet.`
                : `No ${reportDeliveryRunStatusFilter} delivery runs match this ${personaFilterLabel.toLowerCase()} view yet.`}
            </div>
          )}
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportDeliverySubscriptions.map((subscription) => {
              const WorkspaceIcon = subscription.workspace.icon;
              const subscriptionHandoffRows =
                reportDeliveryHandoffPreviewByPersona[subscription.persona] ??
                subscription.preview.handoffRows ??
                [];
              const subscriptionRequiresHandoffAcknowledgement =
                subscriptionHandoffRows.some((row) => row.status === "review") &&
                !isReportDeliveryHandoffAcknowledged(subscription.id);
              const isEditingDeliverySettings =
                editingReportDeliverySubscriptionId === subscription.id;
              const isSavingThisDeliverySubscription =
                saveReportDeliverySubscriptionSettings.isPending &&
                saveReportDeliverySubscriptionSettings.variables?.subscriptionId ===
                  subscription.id;

              return (
                <Card
                  key={subscription.id}
                  id={`report-delivery-subscription-${subscription.id}`}
                  data-testid={`report-delivery-subscription-${subscription.id}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {subscription.title}
                          </CardTitle>
                          <CardDescription>{subscription.audience}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={subscription.statusVariant} dot>
                        {subscription.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.cadence" />
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.cadence}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.channel" />
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.channel}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.readyReports" />
                        </div>
                        <div className="mt-1 font-mono text-base font-semibold">
                          {subscription.readyCount}/{subscription.reports.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.openWork" />
                        </div>
                        <div className="mt-1 font-mono text-base font-semibold">
                          {subscription.openWorkItemCount}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.nextDelivery" />
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.enabled
                            ? subscription.nextRunLabel || "Calculated on queue"
                            : "Paused"}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.settings" />
                        </div>
                        <div className="mt-1 font-medium capitalize text-foreground">
                          {subscription.settingsSource}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.suite" />
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {subscription.reportSuites[0]?.title ?? "Not linked"}
                        </div>
                      </div>
                    </div>

                    {isEditingDeliverySettings ? (
                      <div
                        className="rounded-md border p-3"
                        data-testid={`report-delivery-settings-editor-${subscription.id}`}
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`report-delivery-cadence-${subscription.id}`}
                              className="text-xs"
                            >
                              <T k="reportCenter.cadence" />
                            </Label>
                            <Input
                              id={`report-delivery-cadence-${subscription.id}`}
                              data-testid={`report-delivery-cadence-${subscription.id}`}
                              maxLength={500}
                              value={reportDeliverySettingsDraft.cadence}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft("cadence", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`report-delivery-channel-${subscription.id}`}
                              className="text-xs"
                            >
                              <T k="reportCenter.channel" />
                            </Label>
                            <Input
                              id={`report-delivery-channel-${subscription.id}`}
                              data-testid={`report-delivery-channel-${subscription.id}`}
                              maxLength={500}
                              value={reportDeliverySettingsDraft.channel}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft("channel", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`report-delivery-format-${subscription.id}`}
                              className="text-xs"
                            >
                              <T k="reportCenter.format" />
                            </Label>
                            <Input
                              id={`report-delivery-format-${subscription.id}`}
                              data-testid={`report-delivery-format-${subscription.id}`}
                              maxLength={500}
                              value={reportDeliverySettingsDraft.format}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft("format", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor={`report-delivery-recipients-${subscription.id}`}
                              className="text-xs"
                            >
                              <T k="reportCenter.recipients" />
                            </Label>
                            <Input
                              id={`report-delivery-recipients-${subscription.id}`}
                              data-testid={`report-delivery-recipients-${subscription.id}`}
                              maxLength={500}
                              value={reportDeliverySettingsDraft.recipients}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft("recipients", event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label
                              htmlFor={`report-delivery-guardrail-${subscription.id}`}
                              className="text-xs"
                            >
                              <T k="reportCenter.guardrail" />
                            </Label>
                            <Textarea
                              id={`report-delivery-guardrail-${subscription.id}`}
                              data-testid={`report-delivery-guardrail-${subscription.id}`}
                              maxLength={500}
                              rows={3}
                              value={reportDeliverySettingsDraft.deliveryGuardrail}
                              onChange={(event) =>
                                updateReportDeliverySettingsDraft(
                                  "deliveryGuardrail",
                                  event.target.value
                                )
                              }
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={!selectedCompanyId || isSavingThisDeliverySubscription}
                            onClick={() =>
                              saveReportDeliverySubscriptionSettings.mutate({
                                subscriptionId: subscription.id,
                                enabled: subscription.enabled,
                                cadence: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.cadence
                                ),
                                channel: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.channel
                                ),
                                format: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.format
                                ),
                                recipients: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.recipients
                                ),
                                deliveryGuardrail: normalizeDeliverySetting(
                                  reportDeliverySettingsDraft.deliveryGuardrail
                                ),
                              })
                            }
                          >
                            <Save className="h-4 w-4" />
                            <T k="reportCenter.saveDeliverySettings" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isSavingThisDeliverySubscription}
                            onClick={() => setEditingReportDeliverySubscriptionId(null)}
                          >
                            <X className="h-4 w-4" />
                            <T k="pages.cancel" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border p-3 text-xs text-muted-foreground">
                        <div>
                          <span className="font-medium text-foreground">Format:</span>{" "}
                          {subscription.format}
                        </div>
                        <div className="mt-1">
                          <span className="font-medium text-foreground">Recipients:</span>{" "}
                          {subscription.recipients}
                        </div>
                        <div className="mt-1">
                          <span className="font-medium text-foreground">Guardrail:</span>{" "}
                          {subscription.deliveryGuardrail}
                        </div>
                      </div>
                    )}

                    <div
                      className="rounded-md border p-3 text-xs"
                      data-testid={`report-delivery-preview-${subscription.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-foreground">
                            <T k="reportCenter.packPreview" />
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            {subscription.preview.summary}
                          </p>
                        </div>
                        <Badge
                          variant={
                            subscription.preview.readinessLabel === "Ready for queue"
                              ? "success"
                              : subscription.preview.readinessLabel === "Paused"
                                ? "neutral"
                                : "warning"
                          }
                        >
                          {subscription.preview.readinessLabel}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {subscription.preview.reportNames.slice(0, 4).map((reportName) => (
                          <Badge key={reportName} variant="outline">
                            {reportName}
                          </Badge>
                        ))}
                        {subscription.preview.reportNames.length > 4 ? (
                          <Badge variant="neutral">
                            +{subscription.preview.reportNames.length - 4}
                          </Badge>
                        ) : null}
                      </div>
                      {subscription.preview.suiteTitles.length > 0 ? (
                        <div
                          className="mt-3 flex flex-wrap gap-1"
                          data-testid={`report-delivery-preview-suites-${subscription.id}`}
                        >
                          {subscription.preview.suiteTitles.map((suiteTitle) => (
                            <Badge key={suiteTitle} variant="info">
                              {suiteTitle}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 grid gap-2">
                        {subscription.preview.checklist.slice(0, 3).map((check) => (
                          <div
                            key={check.label}
                            className="flex items-start justify-between gap-2 rounded-md bg-secondary/40 p-2"
                          >
                            <div>
                              <div className="font-medium text-foreground">{check.label}</div>
                              <div className="mt-0.5 text-muted-foreground">{check.detail}</div>
                            </div>
                            <Badge variant={deliveryPreviewCheckVariant(check.status)}>
                              {check.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                      {subscriptionHandoffRows.length ? (
                        <div
                          className="mt-3 grid gap-2"
                          data-testid={`report-delivery-preview-handoff-${subscription.id}`}
                        >
                          {subscriptionHandoffRows.slice(0, 3).map((row) => (
                            <div
                              key={row.label}
                              className="flex items-start justify-between gap-2 rounded-md bg-muted/30 p-2"
                            >
                              <div>
                                <div className="font-medium text-foreground">{row.label}</div>
                                <div className="mt-0.5 text-muted-foreground">
                                  {row.value} - {row.detail}
                                </div>
                              </div>
                              <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                                <Link href={row.href}>Open</Link>
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {subscriptionRequiresHandoffAcknowledgement ? (
                        <Badge
                          variant="warning"
                          data-testid={`report-delivery-handoff-acknowledgement-${subscription.id}`}
                        >
                          <T k="reportCenter.acknowledgeHandoffGapsBeforeQueueing" />
                        </Badge>
                      ) : null}
                    </div>

                    <div
                      className="rounded-md border p-3 text-xs"
                      data-testid={`report-delivery-run-history-${subscription.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-foreground">
                          <T k="reportCenter.recentDeliveryRuns" />
                        </div>
                        <Badge variant="neutral">{subscription.deliveryRuns.length}</Badge>
                      </div>
                      {subscription.latestDeliveryRun ? (
                        <div className="mt-3 space-y-2">
                          {subscription.deliveryRuns.slice(0, 2).map((run) => (
                            <div
                              key={run.id}
                              className="flex flex-col gap-2 rounded-md bg-secondary/40 p-2 sm:flex-row sm:items-start sm:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1">
                                  <Badge variant={deliveryRunStatusVariant(run.status)} dot>
                                    {run.status}
                                  </Badge>
                                  <span className="font-medium text-foreground">
                                    {formatDeliveryRunTimestamp(run.createdAt)}
                                  </span>
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  Scheduled {formatDeliveryRunTimestamp(run.scheduledFor)} -{" "}
                                  {run.readyReportCount}/{run.reportCount} reports - {run.channel}
                                </div>
                                {run.status === "failed" || run.status === "blocked" ? (
                                  <div className="mt-1 text-destructive">
                                    {run.errorMessage ??
                                      "Retry after fixing delivery settings or guardrails."}
                                  </div>
                                ) : null}
                                <DeliveryRunFiles
                                  companyId={selectedCompanyId}
                                  runId={run.id}
                                  artifactCount={run.artifactCount}
                                />
                                {run.retriedFromRunId ? (
                                  <div className="mt-1 text-muted-foreground">
                                    <T k="reportCenter.requeuedFromAFailedDeliveryRun" />
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                                <Badge
                                  variant={
                                    run.readinessStatus === "ready"
                                      ? "success"
                                      : run.readinessStatus === "paused"
                                        ? "neutral"
                                        : "warning"
                                  }
                                >
                                  {run.readinessStatus}
                                </Badge>
                                {run.status === "failed" || run.status === "blocked" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      !selectedCompanyId || retryReportDeliveryRun.isPending
                                    }
                                    onClick={() => retryReportDeliveryRun.mutate(run.id)}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    <T k="reportCenter.retryDelivery" />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-md bg-secondary/40 p-2 text-muted-foreground">
                          <T k="reportCenter.noQueuedDeliveryRunsYet" />
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        <T k="reportCenter.triggerRules" />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {subscription.triggerRules.map((rule) => (
                          <Badge key={rule.id} variant={triggerSeverityMeta[rule.severity].variant}>
                            {rule.title}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {subscription.reports.slice(0, 5).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {subscription.reports.length > 5 ? (
                        <Badge variant="neutral">+{subscription.reports.length - 5}</Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={subscription.href}>
                          <T k="reportCenter.openSubscription" />
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          !selectedCompanyId ||
                          !subscription.enabled ||
                          queueReportDeliverySubscription.isPending
                        }
                        onClick={() =>
                          queueReportDeliverySubscriptionWithHandoffGuard(subscription.id)
                        }
                      >
                        {subscriptionRequiresHandoffAcknowledgement
                          ? "Acknowledge handoff"
                          : "Queue delivery"}
                      </Button>
                      {!isEditingDeliverySettings ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            !selectedCompanyId || saveReportDeliverySubscriptionSettings.isPending
                          }
                          onClick={() => startEditingReportDeliverySubscription(subscription)}
                        >
                          <Pencil className="h-4 w-4" />
                          <T k="reportCenter.editSettings" />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          !selectedCompanyId || saveReportDeliverySubscriptionSettings.isPending
                        }
                        onClick={() =>
                          saveReportDeliverySubscriptionSettings.mutate({
                            subscriptionId: subscription.id,
                            enabled: !subscription.enabled,
                          })
                        }
                      >
                        {subscription.enabled ? "Pause delivery" : "Enable delivery"}
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={subscription.packTemplateHref}>
                          <T k="reportCenter.openPack" />
                        </Link>
                      </Button>
                      {subscription.reportSuites[0] ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={subscription.reportSuites[0].href}>
                            <T k="reportCenter.openSuite" />
                          </Link>
                        </Button>
                      ) : null}
                      <Button asChild size="sm" variant="outline">
                        <Link href={subscription.automationStarterHref}>
                          <T k="reportCenter.openAutomation" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
