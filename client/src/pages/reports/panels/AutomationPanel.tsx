// Reports > automation workspace panel.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { formatCurrency } from "@/lib/format";
import { formatDeliveryRunTimestamp, triggerSeverityMeta } from "../shared";
import { reportSectionHref, reportWorkspaceHref } from "@/lib/reportCatalog";
import { useReportsPageContext } from "../context";

export default function AutomationPanel() {
  const {
    applyReportWorkflowGapFilter,
    automationLoading,
    automationQueueCount,
    comparisonLoading,
    latestReportDeliverySchedulerScan,
    locale,
    navigate,
    personaFilter,
    personaScopeDescription,
    reportAutomationCommandCenter,
    reportAutomationImpactTotals,
    reportAutomationOperationsLoading,
    reportAutomationOperationsNeedingReview,
    reportAutomationRuleReviewCount,
    reportDeliverySchedulerGuardrailSkips,
    reportDeliverySchedulerHandoffReviews,
    reportDeliverySchedulerHandoffSkipCount,
    reportWorkflowGapFilter,
    reportWorkspacePanelClass,
    setActiveTab,
    setReportPersonaFilter,
    visibleAutomationCoverage,
    visibleAutomationQueue,
    visibleReportAutomationImpactSummaries,
    visibleReportAutomationOperations,
    visibleReportAutomationRules,
    visibleReportAutomationStarters,
    visibleReportAutomationTriggerRules,
    visibleReportDecisionShortcuts,
    visibleReportPackReadiness,
  } = useReportsPageContext();
  return (
    <>
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="report-workflow-readiness-title"
        data-testid="report-workflow-readiness"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-workflow-readiness-title" className="text-xl font-semibold">
              <T k="reportCenter.automationReadiness" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Role-specific coverage gaps before report packs, alerts, and delivery automations run.
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {reportAutomationOperationsNeedingReview > 0
              ? `${reportAutomationOperationsNeedingReview} need review`
              : "Ready by role"}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {visibleReportAutomationOperations.map((item) => (
            <div
              key={item.workspace.persona}
              className="rounded-md border border-border/70 p-4"
              data-testid={`report-workflow-readiness-${item.workspace.persona}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {item.workspace.navLabel}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.readyReportCount}/{item.reportCount} reports ready
                  </div>
                </div>
                <Badge variant={item.statusVariant} dot>
                  {item.status}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.score" />
                  </div>
                  <div className="mt-1 font-mono text-base font-semibold">
                    {item.automationScore}%
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.rules" />
                  </div>
                  <div className="mt-1 font-mono text-base font-semibold">
                    {item.readyRuleCount}/{item.automationRuleCount}
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.delivery" />
                  </div>
                  <div className="mt-1 font-mono text-base font-semibold">
                    {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                  </div>
                </div>
              </div>

              <div
                className="mt-3 text-xs text-muted-foreground"
                data-testid={`report-workflow-readiness-gap-${item.workspace.persona}`}
              >
                {item.reportGapCount} report gaps · {item.automationRuleGapCount} rule gaps ·{" "}
                {item.deliveryGapCount} delivery gaps
              </div>

              <div
                className="mt-3 flex flex-wrap gap-2"
                data-testid={`report-workflow-readiness-filters-${item.workspace.persona}`}
              >
                <Button
                  type="button"
                  size="sm"
                  variant={
                    reportWorkflowGapFilter.type === "report-gaps" &&
                    reportWorkflowGapFilter.persona === item.workspace.persona
                      ? "default"
                      : "outline"
                  }
                  className="h-7 px-2"
                  disabled={item.reportGapCount === 0}
                  onClick={() =>
                    applyReportWorkflowGapFilter("report-gaps", item.workspace.persona)
                  }
                  data-testid={`report-workflow-filter-report-gaps-${item.workspace.persona}`}
                >
                  <T k="reportCenter.reportGaps" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    reportWorkflowGapFilter.type === "rule-gaps" &&
                    reportWorkflowGapFilter.persona === item.workspace.persona
                      ? "default"
                      : "outline"
                  }
                  className="h-7 px-2"
                  disabled={item.automationRuleGapCount === 0}
                  onClick={() => applyReportWorkflowGapFilter("rule-gaps", item.workspace.persona)}
                  data-testid={`report-workflow-filter-rule-gaps-${item.workspace.persona}`}
                >
                  <T k="reportCenter.ruleGaps" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    reportWorkflowGapFilter.type === "delivery-gaps" &&
                    reportWorkflowGapFilter.persona === item.workspace.persona
                      ? "default"
                      : "outline"
                  }
                  className="h-7 px-2"
                  disabled={item.deliveryGapCount === 0}
                  onClick={() =>
                    applyReportWorkflowGapFilter("delivery-gaps", item.workspace.persona)
                  }
                  data-testid={`report-workflow-filter-delivery-gaps-${item.workspace.persona}`}
                >
                  <T k="reportCenter.deliveryGaps" />
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Badge variant={item.nextAction.badgeVariant}>{item.nextAction.badge}</Badge>
                <Button asChild size="sm" variant="outline" className="h-7 px-2">
                  <Link
                    href={item.nextAction.href}
                    data-testid={`report-workflow-readiness-action-${item.workspace.persona}`}
                  >
                    {item.nextAction.label}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="report-automation-operations-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-automation-operations-title" className="text-xl font-semibold">
              <T k="reportCenter.reportAutomationOperations" />
            </h2>
            <p className="text-sm text-muted-foreground">
              One operating view for report readiness, auto-send rules, delivery recovery, and next
              actions across owner, freelancer, and accountant workspaces. {personaScopeDescription}
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {reportAutomationOperationsNeedingReview} need action
          </Badge>
        </div>

        {reportAutomationOperationsLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {visibleReportAutomationOperations.map((item) => {
              const workspace = item.workspace;
              const WorkspaceIcon = workspace.icon;

              return (
                <Card
                  key={workspace.persona}
                  data-testid={`report-automation-operations-${workspace.persona}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {workspace.title}
                          </CardTitle>
                          <CardDescription>{workspace.automationOutcome}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={item.statusVariant} dot>
                        {item.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.health" />
                        </div>
                        <div className="mt-1 flex items-baseline gap-1">
                          <span className="font-mono text-lg font-semibold">
                            {item.automationScore}
                          </span>
                          <span className="text-xs text-muted-foreground">/100</span>
                        </div>
                        <Badge variant={item.automationHealthVariant} dot className="mt-2">
                          <T k="reportCenter.automation" />
                        </Badge>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.reportsReady" />
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.readyReportCount}/{item.reportCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {item.recommendationCount} recommended actions
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.autoSendRules" />
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.readyRuleCount}/{item.automationRuleCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {item.openWorkItemCount} open work items
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.deliveriesReady" />
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {item.failedRunCount} failed runs
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium uppercase text-muted-foreground">
                          <T k="pages.nextAction" />
                        </div>
                        <Badge variant={item.nextAction.badgeVariant} dot>
                          {item.nextAction.badge}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {item.nextAction.label}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.nextAction.detail}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={item.nextAction.href}>
                            <T k="reportCenter.openAction" />
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={personaFilter === workspace.persona ? "default" : "ghost"}
                          onClick={() => setReportPersonaFilter(workspace.persona)}
                        >
                          <T k="reportCenter.setFocus" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.amountAtRisk" />
                        </div>
                        <div className="mt-1 truncate font-mono font-semibold text-foreground">
                          {formatCurrency(item.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.comparisonWarnings" />
                        </div>
                        <div className="mt-1 font-mono font-semibold text-foreground">
                          {item.comparisonWarnings}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={reportSectionHref(workspace, "automation-command-center")}>
                          <T k="reportCenter.openCommandCenter" />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={reportSectionHref(workspace, "delivery-subscriptions")}>
                          <T k="reportCenter.openDelivery" />
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
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="report-automation-impact-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-automation-impact-title" className="text-xl font-semibold">
              <T k="reportCenter.automationImpact" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Estimated monthly work removed by ready report rules, scheduled packs, and linked
              automation starters. {personaScopeDescription}
            </p>
          </div>
          <Badge
            variant={reportAutomationImpactTotals.reviewItemCount > 0 ? "warning" : "success"}
            dot
          >
            {reportAutomationImpactTotals.estimatedMonthlyHoursSaved} hrs saved/mo
          </Badge>
        </div>

        {reportAutomationOperationsLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div
            className="grid grid-cols-1 gap-3 xl:grid-cols-3"
            data-testid="report-automation-impact"
          >
            {visibleReportAutomationImpactSummaries.map((item) => {
              const workspace = item.workspace;
              const WorkspaceIcon = workspace.icon;
              const impactVariant =
                item.estimate.status === "compounding"
                  ? "success"
                  : item.estimate.status === "review"
                    ? "warning"
                    : "neutral";

              return (
                <Card
                  key={workspace.persona}
                  data-testid={`report-automation-impact-${workspace.persona}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {item.profile.title}
                          </CardTitle>
                          <CardDescription>{item.profile.outcome}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={impactVariant} dot>
                        {item.estimate.statusLabel}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.hoursSaved" />
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.estimate.estimatedMonthlyHoursSaved}
                        </div>
                        <div className="mt-1 text-muted-foreground">estimated / month</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.automatedItems" />
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.estimate.estimatedAutomatedItemCount}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {item.profile.itemUnitLabel}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.coverage" />
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold">
                          {item.estimate.coverageScore}%
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {item.triggerRules.length} trigger rules
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.amountWatched" />
                        </div>
                        <div className="mt-1 truncate font-mono text-sm font-semibold">
                          {formatCurrency(item.estimate.amountAtRisk, "AED", locale)}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {item.estimate.reviewItemCount} review items
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs">
                      <div className="font-medium text-foreground">
                        {item.profile.manualWorkLabel}
                      </div>
                      <p className="mt-1 text-muted-foreground">{item.estimate.summary}</p>
                    </div>

                    <div className="space-y-2">
                      {item.profile.evidence.map((evidence) => (
                        <div key={evidence.label} className="rounded-md bg-muted/30 p-2 text-xs">
                          <div className="font-medium text-foreground">{evidence.label}</div>
                          <div className="mt-1 text-muted-foreground">{evidence.detail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        <T k="reportCenter.outcomeSignals" />
                      </div>
                      {item.profile.outcomeSignals.map((signal) => (
                        <div
                          key={signal.id}
                          className="rounded-md border p-2 text-xs"
                          data-testid={`report-automation-outcome-signal-${signal.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-foreground">{signal.label}</div>
                            <Badge variant="info">
                              <T k="reportCenter.proxy" />
                            </Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">{signal.currentProxy}</div>
                          <div className="mt-2 rounded-md bg-secondary/40 p-2 text-muted-foreground">
                            Missing counter: {signal.missingCounter}
                          </div>
                          <div className="mt-1 text-muted-foreground">{signal.guardrail}</div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {item.reports.slice(0, 4).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {item.reports.length > 4 ? (
                        <Badge variant="neutral">+{item.reports.length - 4}</Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={item.commandCenterHref}>
                          <T k="reportCenter.openCommandCenter" />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={item.starterHref}>
                          <T k="reportCenter.openAutopilot" />
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
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="decision-shortcuts-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="decision-shortcuts-title" className="text-xl font-semibold">
              <T k="reportCenter.decisionShortcuts" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Business questions that route owners, freelancers, and accountants to the right
              reports, comparisons, and automation starter. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visibleReportDecisionShortcuts.length} questions
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {visibleReportDecisionShortcuts.map((shortcut) => {
            const WorkspaceIcon = shortcut.workspace.icon;

            return (
              <Card
                key={shortcut.id}
                id={`report-decision-shortcut-${shortcut.id}`}
                data-testid={`report-decision-shortcut-${shortcut.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">
                          {shortcut.question}
                        </CardTitle>
                        <CardDescription>{shortcut.workspace.title}</CardDescription>
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {shortcut.persona}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{shortcut.answer}</p>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.primaryReport" />
                      </div>
                      <div className="mt-1 font-medium text-foreground">
                        {shortcut.primaryReport.name}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.reportBundle" />
                      </div>
                      <div className="mt-1 font-mono text-base font-semibold">
                        {shortcut.reports.length}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {shortcut.reports.slice(0, 4).map((report) => (
                      <Badge key={report.id} variant="outline">
                        {report.name}
                      </Badge>
                    ))}
                    {shortcut.reports.length > 4 ? (
                      <Badge variant="neutral">+{shortcut.reports.length - 4}</Badge>
                    ) : null}
                  </div>

                  <div className="space-y-2 text-xs text-muted-foreground">
                    {shortcut.comparisonPreset ? (
                      <div>
                        <span className="font-medium text-foreground">Comparison:</span>{" "}
                        {shortcut.comparisonPreset.title}
                      </div>
                    ) : null}
                    {shortcut.automationStarter ? (
                      <div>
                        <span className="font-medium text-foreground">Automation:</span>{" "}
                        {shortcut.automationStarter.title}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={shortcut.primaryReportHref}>
                        <T k="reportCenter.openReport" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={shortcut.comparisonHref}>
                        <T k="reportCenter.openComparison" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={shortcut.workflowHref}
                        data-testid={`report-decision-shortcut-automation-${shortcut.id}`}
                      >
                        <T k="reportCenter.openAutomation" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="automation-starters-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-starters-title" className="text-xl font-semibold">
              <T k="reportCenter.automationStarters" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Persona-specific setup paths for turning report packs, comparisons, and open queues
              into automated workflows. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visibleReportAutomationStarters.length} starters
          </Badge>
        </div>

        <div
          className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-6"
          data-testid="report-delivery-scheduler-health"
        >
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-muted-foreground">
                <T k="reportCenter.lastScan" />
              </div>
              <Badge
                variant={
                  latestReportDeliverySchedulerScan?.status === "error"
                    ? "danger"
                    : latestReportDeliverySchedulerScan
                      ? "success"
                      : "neutral"
                }
                dot
              >
                {latestReportDeliverySchedulerScan?.status ?? "pending"}
              </Badge>
            </div>
            <div className="mt-1 font-medium text-foreground">
              {formatDeliveryRunTimestamp(latestReportDeliverySchedulerScan?.finishedAt)}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.queuedByScan" />
            </div>
            <div className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.queuedRuns ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.guardrailSkips" />
            </div>
            <div className="mt-1 font-mono text-base font-semibold">
              {reportDeliverySchedulerGuardrailSkips}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.handoffSkips" />
            </div>
            <div className="mt-1 font-mono text-base font-semibold">
              {reportDeliverySchedulerHandoffSkipCount}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.actorSkips" />
            </div>
            <div className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.skippedNoActor ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.scanErrors" />
            </div>
            <div className="mt-1 font-mono text-base font-semibold">
              {latestReportDeliverySchedulerScan?.errors ?? 0}
            </div>
          </div>
        </div>

        {reportDeliverySchedulerHandoffReviews.length > 0 ? (
          <div
            className="rounded-md border border-warning/40 bg-warning/5 p-3"
            data-testid="report-delivery-scheduler-handoff-skips"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  <T k="reportCenter.scheduledSendsHeldForHandoff" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  These due report packs were not auto-sent because the latest scheduler scan found
                  unresolved handoff gaps.
                </p>
              </div>
              <Badge variant="warning" dot>
                {reportDeliverySchedulerHandoffReviews.length} held
              </Badge>
            </div>
            <div className="mt-3 grid gap-2">
              {reportDeliverySchedulerHandoffReviews.slice(0, 3).map((review) => (
                <div
                  key={`${review.subscriptionId}-${review.latestRunId ?? review.gap}`}
                  className="flex flex-col gap-2 rounded-md bg-background/70 p-2 text-xs sm:flex-row sm:items-start sm:justify-between"
                  data-testid={`report-delivery-scheduler-handoff-${review.subscriptionId}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{review.title}</span>
                      <Badge variant="warning">{review.gapLabel}</Badge>
                    </div>
                    <div className="mt-1 text-muted-foreground">{review.detail}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline" className="h-7 px-2">
                      <Link href={review.href}>
                        <T k="reportCenter.openHandoff" /> <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                      <Link href={review.subscriptionHref}>
                        <T k="reportCenter.openDelivery" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportAutomationStarters.map((starter) => {
              const WorkspaceIcon = starter.workspace.icon;

              return (
                <Card
                  key={starter.id}
                  id={`report-automation-starter-${starter.id}`}
                  data-testid={`report-automation-starter-${starter.id}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">{starter.title}</CardTitle>
                          <CardDescription>{starter.audience}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={starter.openWorkItemCount > 0 ? "warning" : "success"} dot>
                        {starter.openWorkItemCount > 0
                          ? `${starter.openWorkItemCount} open`
                          : "Ready"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{starter.outcome}</p>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.setup" />
                        </div>
                        <div className="font-medium text-foreground">{starter.setupTime}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.readyReports" />
                        </div>
                        <div className="font-mono text-base font-semibold">
                          {starter.readyCount}/{starter.reports.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.playbooks" />
                        </div>
                        <div className="font-mono text-base font-semibold">
                          {starter.playbooks.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.atRisk" />
                        </div>
                        <div className="truncate font-mono text-sm font-semibold">
                          {formatCurrency(starter.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Trigger:</span>{" "}
                      {starter.trigger}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        <T k="reportCenter.setupChecklist" />
                      </div>
                      {starter.setupSteps.map((step) => (
                        <div key={step} className="flex gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {starter.reports.slice(0, 4).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {starter.reports.length > 4 ? (
                        <Badge variant="neutral">+{starter.reports.length - 4}</Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={starter.href}>{starter.primaryAction}</Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setReportPersonaFilter(starter.persona)}
                      >
                        <T k="reportCenter.filterWorkspace" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="trigger-rules-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="trigger-rules-title" className="text-xl font-semibold">
              <T k="reportCenter.triggerRules" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Report-driven thresholds that route cash, tax, close, and advisory signals into
              automation. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visibleReportAutomationTriggerRules.length} rules
          </Badge>
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportAutomationTriggerRules.map((rule) => {
              const WorkspaceIcon = rule.workspace.icon;
              const severity = triggerSeverityMeta[rule.severity];

              return (
                <Card
                  key={rule.id}
                  id={`report-trigger-rule-${rule.id}`}
                  data-testid={`report-trigger-rule-${rule.id}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">{rule.title}</CardTitle>
                          <CardDescription>{rule.workspace.title}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={severity.variant} dot>
                        {severity.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>{rule.condition}</p>
                      <div className="rounded-md border p-3 text-xs">
                        <span className="font-medium text-foreground">Threshold:</span>{" "}
                        {rule.threshold}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.cadence" />
                        </div>
                        <div className="mt-1 font-medium text-foreground">{rule.cadence}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.openWork" />
                        </div>
                        <div className="mt-1 font-mono text-base font-semibold">
                          {rule.openWorkItemCount}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {rule.reports.slice(0, 4).map((report) => (
                        <Badge key={report.id} variant="outline">
                          {report.name}
                        </Badge>
                      ))}
                      {rule.reports.length > 4 ? (
                        <Badge variant="neutral">+{rule.reports.length - 4}</Badge>
                      ) : null}
                    </div>

                    <div className="space-y-2 text-xs text-muted-foreground">
                      {rule.decisionShortcut ? (
                        <div>
                          <span className="font-medium text-foreground">Question:</span>{" "}
                          {rule.decisionShortcut.question}
                        </div>
                      ) : null}
                      {rule.automationStarter ? (
                        <div>
                          <span className="font-medium text-foreground">Automation:</span>{" "}
                          {rule.automationStarter.title}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href={rule.primaryReportHref}>{rule.actionLabel}</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={rule.decisionShortcutHref}>
                          <T k="reportCenter.openQuestion" />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={rule.automationStarterHref}>
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
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="automation-queues-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-queues-title" className="text-xl font-semibold">
              <T k="reportCenter.automationQueues" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Live report signals routed to the next workflow. {personaScopeDescription}
            </p>
          </div>
          <Badge variant={automationQueueCount > 0 ? "warning" : "success"} dot>
            {automationQueueCount} open
          </Badge>
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {visibleAutomationQueue.map((item) => {
              const Icon = item.icon;
              const hasAction = item.count > 0;
              return (
                <Card key={item.id}>
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">{item.title}</CardTitle>
                          <CardDescription>{item.detail}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={hasAction ? "warning" : "success"} dot>
                        {hasAction ? "Review" : "Clear"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{item.signal}</div>
                        <div className="font-mono text-2xl font-semibold">{item.count}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.amount" />
                        </div>
                        <div className="font-mono text-lg font-semibold">
                          {typeof item.amount === "number"
                            ? formatCurrency(item.amount, item.currency ?? "AED", locale)
                            : "-"}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {item.personas.map((persona) => (
                        <Badge key={persona} variant="outline" className="capitalize">
                          {persona}
                        </Badge>
                      ))}
                    </div>

                    {item.href ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={item.href}>{item.actionLabel}</Link>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => item.tab && setActiveTab(item.tab)}
                      >
                        {item.actionLabel}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="automation-coverage-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-coverage-title" className="text-xl font-semibold">
              <T k="reportCenter.automationCoverage" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Role coverage across live reports, comparison lenses, workflow links, and pack
              cadence. {personaScopeDescription}
            </p>
          </div>
          <Badge variant="info" dot>
            {visibleAutomationCoverage.length} role views
          </Badge>
        </div>

        {automationLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {visibleAutomationCoverage.map((item) => {
              const workspace = item.workspace;
              const WorkspaceIcon = workspace.icon;

              return (
                <Card
                  key={workspace.persona}
                  data-testid={`automation-coverage-${workspace.persona}`}
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {workspace.title}
                          </CardTitle>
                          <CardDescription>{workspace.focus}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={item.openSignalCount > 0 ? "warning" : "success"} dot>
                        {item.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.liveReports" />
                        </div>
                        <div className="font-mono text-lg font-semibold">
                          {item.liveReportCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.automations" />
                        </div>
                        <div className="font-mono text-lg font-semibold">
                          {item.automatedSignalCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.comparisons" />
                        </div>
                        <div className="font-mono text-lg font-semibold">
                          {item.comparisonTypeCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.workflows" />
                        </div>
                        <div className="font-mono text-lg font-semibold">
                          {item.workflowReportCount}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium uppercase text-muted-foreground">
                          <T k="reportCenter.openWork" />
                        </span>
                        <span className="font-mono">
                          {item.openWorkItemCount} items -{" "}
                          {formatCurrency(item.amountAtRisk, "AED", locale)}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        <T k="reportCenter.signalCoverage" />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {item.topSignals.map((signal) => (
                          <Badge key={signal} variant="outline">
                            {signal}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">Pack cadence:</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">Pack automation:</span>{" "}
                        {workspace.packSchedule.automation}
                      </div>
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
                      <Badge variant="outline">{item.playbookCount} playbooks</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="automation-command-center-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="automation-command-center-title" className="text-xl font-semibold">
              <T k="reportCenter.automationCommandCenter" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Auto-send readiness across report rules, blocker queues, and pack delivery.{" "}
              {personaScopeDescription}
            </p>
          </div>
          <Badge
            variant={
              reportAutomationCommandCenter.reviewRuleCount +
                reportAutomationCommandCenter.setupRuleCount >
              0
                ? "warning"
                : "success"
            }
            dot
          >
            {reportAutomationCommandCenter.autoSendCoveragePercent}% auto-send coverage
          </Badge>
        </div>

        {automationLoading || comparisonLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card data-testid="automation-command-center">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">
                    <T k="reportCenter.autoSendReadiness" />
                  </CardTitle>
                  <CardDescription>
                    Rule coverage and open work before scheduled report packs are sent.
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    reportAutomationCommandCenter.reviewRuleCount +
                      reportAutomationCommandCenter.setupRuleCount >
                    0
                      ? "warning"
                      : "success"
                  }
                  dot
                >
                  {reportAutomationCommandCenter.readyRuleCount}/
                  {reportAutomationCommandCenter.ruleCount} rules ready
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
                {[
                  {
                    label: "Automation rules",
                    value: reportAutomationCommandCenter.ruleCount,
                  },
                  {
                    label: "Ready auto-send",
                    value: reportAutomationCommandCenter.readyRuleCount,
                  },
                  {
                    label: "Need review",
                    value: reportAutomationCommandCenter.reviewRuleCount,
                  },
                  {
                    label: "Setup needed",
                    value: reportAutomationCommandCenter.setupRuleCount,
                  },
                  {
                    label: "Open work",
                    value: reportAutomationCommandCenter.openWorkItemCount,
                  },
                  {
                    label: "Amount at risk",
                    value: formatCurrency(
                      reportAutomationCommandCenter.amountAtRisk,
                      "AED",
                      locale
                    ),
                    className: "text-sm",
                  },
                  {
                    label: "Comparisons linked",
                    value: reportAutomationCommandCenter.comparisonMetricCount,
                  },
                  {
                    label: "Report bundle",
                    value: reportAutomationCommandCenter.reportBundleCount,
                  },
                  {
                    label: "Packs ready",
                    value: reportAutomationCommandCenter.readyPackCount,
                  },
                  {
                    label: "Packs in review",
                    value: reportAutomationCommandCenter.reviewPackCount,
                  },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{metric.label}</div>
                    <div
                      className={`truncate font-mono text-lg font-semibold ${
                        metric.className ?? ""
                      }`}
                    >
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    <T k="reportCenter.topBlockers" />
                  </div>
                  {reportAutomationCommandCenter.topReviewRules.length ? (
                    reportAutomationCommandCenter.topReviewRules.map((rule) => (
                      <div
                        key={rule.id}
                        data-testid={`automation-command-center-blocker-${rule.id}`}
                        className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium">{rule.playbook.title}</div>
                            <Badge variant={rule.statusVariant} dot>
                              {rule.status}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {rule.workspace.title} - {rule.openWorkItemCount} open work items -{" "}
                            {formatCurrency(rule.amountAtRisk, "AED", locale)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {rule.liveReportCount}/{rule.reportCount} reports live with{" "}
                            {rule.comparisonMetricCount} linked comparisons.
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link href={rule.targetWorkflow}>{rule.playbook.cta}</Link>
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border p-3 text-sm text-muted-foreground">
                      All visible rules are ready for auto-send when pack delivery runs.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    <T k="reportCenter.packDeliveryReadiness" />
                  </div>
                  {visibleReportPackReadiness.map((item) => (
                    <div
                      key={item.workspace.persona}
                      data-testid={`automation-command-center-pack-${item.workspace.persona}`}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{item.workspace.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.reviewCount} checks need review - health{" "}
                          {item.automationHealth.score}/100
                        </div>
                      </div>
                      <Badge variant={item.reviewCount > 0 ? "warning" : "success"} dot>
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
      <section
        className={reportWorkspacePanelClass("automation", "space-y-4")}
        aria-labelledby="report-automation-rules-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-automation-rules-title" className="text-xl font-semibold">
              <T k="reportCenter.reportAutomationRules" />
            </h2>
            <p className="text-sm text-muted-foreground">
              Role-specific pack rules that connect triggers, reports, recipients, and next
              workflows. {personaScopeDescription}
            </p>
          </div>
          <Badge variant={reportAutomationRuleReviewCount > 0 ? "warning" : "success"} dot>
            {reportAutomationRuleReviewCount} need review
          </Badge>
        </div>

        {automationLoading || comparisonLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            {visibleReportAutomationRules.map((rule) => {
              const workspace = rule.workspace;
              const WorkspaceIcon = workspace.icon;

              return (
                <Card key={rule.id} data-testid={`automation-rule-${rule.id}`}>
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                          <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-base font-semibold">
                            {rule.playbook.title}
                          </CardTitle>
                          <CardDescription>{workspace.title}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={rule.statusVariant} dot>
                        {rule.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.reports" />
                        </div>
                        <div className="font-mono text-lg font-semibold">
                          {rule.liveReportCount}/{rule.reportCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.comparisons" />
                        </div>
                        <div className="font-mono text-lg font-semibold">
                          {rule.comparisonMetricCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.openWork" />
                        </div>
                        <div className="font-mono text-lg font-semibold">
                          {rule.openWorkItemCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.amount" />
                        </div>
                        <div className="truncate font-mono text-sm font-semibold">
                          {formatCurrency(rule.amountAtRisk, "AED", locale)}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <div>
                        <span className="font-medium text-foreground">Trigger:</span>{" "}
                        {rule.playbook.trigger}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">Cadence:</span>{" "}
                        {workspace.packSchedule.cadence}
                      </div>
                      <div className="mt-1">
                        <span className="font-medium text-foreground">Recipients:</span>{" "}
                        {workspace.packSchedule.recipients}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        <T k="reportCenter.reportBundle" />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {rule.linkedReports.slice(0, 5).map((report) => (
                          <Badge key={report.id} variant="outline">
                            {report.name}
                          </Badge>
                        ))}
                        {rule.linkedReports.length > 5 ? (
                          <Badge variant="outline">+{rule.linkedReports.length - 5}</Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        <T k="reportCenter.ruleSignals" />
                      </div>
                      {rule.matchingSignals.length ? (
                        rule.matchingSignals.slice(0, 3).map((signal) => (
                          <div
                            key={signal.id}
                            className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                          >
                            <div className="min-w-0">
                              <div className="font-medium">{signal.title}</div>
                              <div className="text-xs text-muted-foreground">{signal.signal}</div>
                            </div>
                            <Badge variant={signal.count > 0 ? "warning" : "success"} dot>
                              {signal.count > 0 ? signal.count : "Clear"}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border p-3 text-sm text-muted-foreground">
                          <T k="reportCenter.noLiveExceptionsCurrentlyMapToThis" />
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        <T k="reportCenter.automationRunbook" />
                      </div>
                      {rule.runbookSteps.map((step, index) => (
                        <div
                          key={step.id}
                          className="rounded-md border p-3"
                          data-testid={`automation-rule-runbook-${rule.id}-${step.phase}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-foreground">
                                    {step.title}
                                  </div>
                                  <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                    {step.outcome}
                                  </div>
                                </div>
                                <Badge variant="outline">{step.phase}</Badge>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="outline">{step.reportIds.length} reports</Badge>
                                <Badge variant="outline">{step.triggerRuleIds.length} rules</Badge>
                                <Badge variant="outline">
                                  {step.deliverySubscriptionIds.length} deliveries
                                </Badge>
                              </div>
                              <Button asChild size="sm" variant="outline">
                                <Link href={step.href}>
                                  {step.actionLabel} <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <Button asChild size="sm" variant="outline">
                      <Link href={rule.targetWorkflow}>{rule.playbook.cta}</Link>
                    </Button>
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
