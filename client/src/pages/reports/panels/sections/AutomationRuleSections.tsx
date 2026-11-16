// Reports > automation: trigger rules, automation queues, coverage, command center and rules.
// Split out of AutomationPanel.tsx (R20-09); state comes from useReportsPage via context.
import { useTranslation } from "@/lib/i18n";
import { ArrowRight } from "lucide-react";
import { translateNow } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { formatCurrency } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { reportWorkspaceHref } from "@/lib/reportCatalog";
import { triggerSeverityMeta } from "../../shared";
import { useReportsPageContext } from "../../context";

export function AutomationRuleSections() {
  const { t } = useTranslation();
  const {
    automationLoading,
    automationQueueCount,
    comparisonLoading,
    locale,
    navigate,
    personaScopeDescription,
    reportAutomationCommandCenter,
    reportAutomationRuleReviewCount,
    reportWorkspacePanelClass,
    setActiveTab,
    visibleAutomationCoverage,
    visibleAutomationQueue,
    visibleReportAutomationRules,
    visibleReportAutomationTriggerRules,
    visibleReportPackReadiness,
  } = useReportsPageContext();
  return (
    <>
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
                        <div className="mt-1 tabular-nums text-base font-semibold">
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
                        <div className="tabular-nums text-2xl font-semibold">{item.count}</div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.amount" />
                        </div>
                        <div className="tabular-nums text-lg font-semibold">
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
                        <div className="tabular-nums text-lg font-semibold">
                          {item.liveReportCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.automations" />
                        </div>
                        <div className="tabular-nums text-lg font-semibold">
                          {item.automatedSignalCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.comparisons" />
                        </div>
                        <div className="tabular-nums text-lg font-semibold">
                          {item.comparisonTypeCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.workflows" />
                        </div>
                        <div className="tabular-nums text-lg font-semibold">
                          {item.workflowReportCount}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-muted-foreground">
                          <T k="reportCenter.openWork" />
                        </span>
                        <span className="tabular-nums">
                          {item.openWorkItemCount} items -{" "}
                          <Money amount={item.amountAtRisk} currency={"AED"} />
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">
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
                    {t["automationRuleSections.ruleCoverageAndOpenWork"]}
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
                    label: translateNow("reportCenter.setupNeeded"),
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
                      className={`truncate tabular-nums text-lg font-semibold ${
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
                  <div className="text-xs font-medium text-muted-foreground">
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
                            <Money amount={rule.amountAtRisk} currency={"AED"} />
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
                      {t["automationRuleSections.allVisibleRulesAreReady"]}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
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
                        <div className="tabular-nums text-lg font-semibold">
                          {rule.liveReportCount}/{rule.reportCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.comparisons" />
                        </div>
                        <div className="tabular-nums text-lg font-semibold">
                          {rule.comparisonMetricCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.openWork" />
                        </div>
                        <div className="tabular-nums text-lg font-semibold">
                          {rule.openWorkItemCount}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <T k="reportCenter.amount" />
                        </div>
                        <div className="truncate tabular-nums text-sm font-semibold">
                          <Money amount={rule.amountAtRisk} currency={"AED"} />
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
                      <div className="text-xs font-medium text-muted-foreground">
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
                      <div className="text-xs font-medium text-muted-foreground">
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
                      <div className="text-xs font-medium text-muted-foreground">
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
