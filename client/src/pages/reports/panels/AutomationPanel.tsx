// Reports > automation workspace panel.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { formatMessage, useTranslation } from "@/lib/i18n";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { Money } from "@/components/ui/money";
import { formatDeliveryRunTimestamp } from "../shared";
import { reportSectionHref } from "@/lib/reportCatalog";
import { useReportsPageContext } from "../context";
import { AutomationRuleSections } from "./sections/AutomationRuleSections";

export default function AutomationPanel() {
  const { t } = useTranslation();
  const {
    applyReportWorkflowGapFilter,
    automationLoading,
    latestReportDeliverySchedulerScan,
    personaFilter,
    personaScopeDescription,
    reportAutomationImpactTotals,
    reportAutomationOperationsLoading,
    reportAutomationOperationsNeedingReview,
    reportDeliverySchedulerGuardrailSkips,
    reportDeliverySchedulerHandoffReviews,
    reportDeliverySchedulerHandoffSkipCount,
    reportWorkflowGapFilter,
    reportWorkspacePanelClass,
    setReportPersonaFilter,
    visibleReportAutomationImpactSummaries,
    visibleReportAutomationOperations,
    visibleReportAutomationStarters,
    visibleReportDecisionShortcuts,
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
              {t["automationPanel.roleSpecificCoverageGapsBefore"]}
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {reportAutomationOperationsNeedingReview > 0
              ? formatMessage(t["reportCenter.needReview"], {
                  n: reportAutomationOperationsNeedingReview,
                })
              : t["automationPanel.readyByRole"]}
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
                    {formatMessage(t["reportCenter.readyReportsOfTotal"], {
                      ready: item.readyReportCount,
                      total: item.reportCount,
                    })}
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
                  <div className="mt-1 tabular-nums text-base font-semibold">
                    {item.automationScore}%
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.rules" />
                  </div>
                  <div className="mt-1 tabular-nums text-base font-semibold">
                    {item.readyRuleCount}/{item.automationRuleCount}
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.delivery" />
                  </div>
                  <div className="mt-1 tabular-nums text-base font-semibold">
                    {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                  </div>
                </div>
              </div>

              <div
                className="mt-3 text-xs text-muted-foreground"
                data-testid={`report-workflow-readiness-gap-${item.workspace.persona}`}
              >
                {formatMessage(t["reportCenter.aoGaps"], {
                  reports: item.reportGapCount,
                  rules: item.automationRuleGapCount,
                  deliveries: item.deliveryGapCount,
                })}
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
              {formatMessage(t["reportCenter.aoIntro"], { scope: personaScopeDescription })}
            </p>
          </div>
          <Badge variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"} dot>
            {formatMessage(t["reportCenter.needAction"], {
              n: reportAutomationOperationsNeedingReview,
            })}
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
                          <span className="tabular-nums text-lg font-semibold">
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
                        <div className="mt-1 tabular-nums text-lg font-semibold">
                          {item.readyReportCount}/{item.reportCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {formatMessage(t["reportCenter.nRecommendedActions"], {
                            n: item.recommendationCount,
                          })}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.autoSendRules" />
                        </div>
                        <div className="mt-1 tabular-nums text-lg font-semibold">
                          {item.readyRuleCount}/{item.automationRuleCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {formatMessage(t["reportCenter.nOpenWorkItems"], {
                            n: item.openWorkItemCount,
                          })}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.deliveriesReady" />
                        </div>
                        <div className="mt-1 tabular-nums text-lg font-semibold">
                          {item.readyDeliveryCount}/{item.deliverySubscriptionCount}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {formatMessage(t["reportCenter.nFailedRuns"], { n: item.failedRunCount })}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium text-muted-foreground">
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
                        <div className="mt-1 truncate tabular-nums font-semibold text-foreground">
                          <Money amount={item.amountAtRisk} currency={"AED"} />
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/30 p-2">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.comparisonWarnings" />
                        </div>
                        <div className="mt-1 tabular-nums font-semibold text-foreground">
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
              {formatMessage(t["reportCenter.aoImpactIntro"], { scope: personaScopeDescription })}
            </p>
          </div>
          <Badge
            variant={reportAutomationImpactTotals.reviewItemCount > 0 ? "warning" : "success"}
            dot
          >
            {formatMessage(t["reportCenter.hrsSavedPerMonth"], {
              n: reportAutomationImpactTotals.estimatedMonthlyHoursSaved,
            })}
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
                        <div className="mt-1 tabular-nums text-lg font-semibold">
                          {item.estimate.estimatedMonthlyHoursSaved}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {t["reportCenter.estimatedPerMonth"]}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.automatedItems" />
                        </div>
                        <div className="mt-1 tabular-nums text-lg font-semibold">
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
                        <div className="mt-1 tabular-nums text-lg font-semibold">
                          {item.estimate.coverageScore}%
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {formatMessage(t["reportCenter.nTriggerRules"], {
                            n: item.triggerRules.length,
                          })}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.amountWatched" />
                        </div>
                        <div className="mt-1 truncate tabular-nums text-sm font-semibold">
                          <Money amount={item.estimate.amountAtRisk} currency={"AED"} />
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {formatMessage(t["reportCenter.nReviewItems"], {
                            n: item.estimate.reviewItemCount,
                          })}
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
                      <div className="text-xs font-medium text-muted-foreground">
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
                            {formatMessage(t["reportCenter.missingCounter"], {
                              value: signal.missingCounter,
                            })}
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
              {formatMessage(t["reportCenter.aoShortcutsIntro"], {
                scope: personaScopeDescription,
              })}
            </p>
          </div>
          <Badge variant="info" dot>
            {formatMessage(t["reportCenter.nQuestions"], {
              n: visibleReportDecisionShortcuts.length,
            })}
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
                      {t[
                        `reportCenter.persona${shortcut.persona.charAt(0).toUpperCase()}${shortcut.persona.slice(1)}`
                      ] ?? shortcut.persona}
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
                      <div className="mt-1 tabular-nums text-base font-semibold">
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
                        <span className="font-medium text-foreground">
                          {t["reportCenter.labelComparison"]}
                        </span>{" "}
                        {shortcut.comparisonPreset.title}
                      </div>
                    ) : null}
                    {shortcut.automationStarter ? (
                      <div>
                        <span className="font-medium text-foreground">
                          {t["reportCenter.labelAutomation"]}
                        </span>{" "}
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
              {formatMessage(t["reportCenter.aoStartersIntro"], { scope: personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot>
            {formatMessage(t["reportCenter.nStarters"], {
              n: visibleReportAutomationStarters.length,
            })}
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
                {latestReportDeliverySchedulerScan?.status
                  ? (t[
                      `reportCenter.scanStatus${latestReportDeliverySchedulerScan.status.charAt(0).toUpperCase()}${latestReportDeliverySchedulerScan.status.slice(1)}`
                    ] ?? latestReportDeliverySchedulerScan.status)
                  : t["reportCenter.scanPending"]}
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
            <div className="mt-1 tabular-nums text-base font-semibold">
              {latestReportDeliverySchedulerScan?.queuedRuns ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.guardrailSkips" />
            </div>
            <div className="mt-1 tabular-nums text-base font-semibold">
              {reportDeliverySchedulerGuardrailSkips}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.handoffSkips" />
            </div>
            <div className="mt-1 tabular-nums text-base font-semibold">
              {reportDeliverySchedulerHandoffSkipCount}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.actorSkips" />
            </div>
            <div className="mt-1 tabular-nums text-base font-semibold">
              {latestReportDeliverySchedulerScan?.skippedNoActor ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground">
              <T k="reportCenter.scanErrors" />
            </div>
            <div className="mt-1 tabular-nums text-base font-semibold">
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
                  {t["automationPanel.theseDueReportPacksWere"]}
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
                          ? formatMessage(t["reportCenter.nOpen"], { n: starter.openWorkItemCount })
                          : t["reportCenter.ready"]}
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
                        <div className="tabular-nums text-base font-semibold">
                          {starter.readyCount}/{starter.reports.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.playbooks" />
                        </div>
                        <div className="tabular-nums text-base font-semibold">
                          {starter.playbooks.length}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.atRisk" />
                        </div>
                        <div className="truncate tabular-nums text-sm font-semibold">
                          <Money amount={starter.amountAtRisk} currency={"AED"} />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {t["reportCenter.labelTrigger"]}
                      </span>{" "}
                      {starter.trigger}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">
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
      <AutomationRuleSections />
    </>
  );
}
