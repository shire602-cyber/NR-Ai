import { Button } from "@/components/ui/button";
import { formatMessage } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { reportSectionHref } from "@/lib/reportCatalog";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function ReportWorkspacePartD({ m }: { m: DashboardModel }) {
  const { t } = m;
  const {
    preferredReportWorkspace,
    preferredReportDecisionShortcuts,
    preferredReportComparisonPresets,
    preferredReportTriggerRules,
    preferredReportDeliverySubscriptions,
  } = m;
  return (
    <>
      <div className="border-b border-border/60 p-5" data-testid="dashboard-report-trigger-rules">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="reportCenter.triggerRules" />
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {formatMessage(t["dashboard.trThresholds"], {
                name: preferredReportWorkspace.navLabel,
              })}
            </p>
          </div>
          <Link href={reportSectionHref(preferredReportWorkspace, "trigger-rules")}>
            <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent">
              <T k="pageLabels.openTriggerRules" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {preferredReportTriggerRules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-md border border-border/70 p-4"
              data-testid={`dashboard-report-trigger-rule-${rule.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{rule.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {rule.threshold}
                  </p>
                </div>
                <Badge
                  variant={
                    rule.severity === "critical"
                      ? "danger"
                      : rule.severity === "review"
                        ? "warning"
                        : "info"
                  }
                  dot
                >
                  {rule.severity === "critical"
                    ? t["reportCenter.severityCritical"]
                    : rule.severity === "review"
                      ? t["reportCenter.severityReview"]
                      : t["reportCenter.severityMonitor"]}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge variant="outline">
                  {formatMessage(t["dashboard.nReports"], { n: rule.reports.length })}
                </Badge>
                <Badge variant="outline">{rule.cadence}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={rule.primaryReportHref}>
                  <Button variant="outline" size="sm">
                    {rule.actionLabel}
                  </Button>
                </Link>
                <Link href={rule.href}>
                  <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                    <T k="pageLabels.viewRule" />
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="border-b border-border/60 p-5"
        data-testid="dashboard-report-delivery-subscriptions"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="reportCenter.deliverySubscriptions" />
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {formatMessage(t["dashboard.dsScheduledPacks"], {
                name: preferredReportWorkspace.navLabel,
              })}
            </p>
          </div>
          <Link href={reportSectionHref(preferredReportWorkspace, "delivery-subscriptions")}>
            <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent">
              <T k="pageLabels.openSubscriptions" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {preferredReportDeliverySubscriptions.map((subscription) => (
            <div
              key={subscription.id}
              className="rounded-md border border-border/70 p-4"
              data-testid={`dashboard-report-delivery-subscription-${subscription.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{subscription.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {subscription.cadence}
                  </p>
                </div>
                <Badge variant="outline">{subscription.channel}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.readyReports" />
                  </div>
                  <div className="mt-1 font-semibold tabular-nums text-foreground">
                    {subscription.readyReports}/{subscription.reports.length}
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.triggerRules" />
                  </div>
                  <div className="mt-1 font-semibold tabular-nums text-foreground">
                    {subscription.triggerRules.length}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {subscription.deliveryGuardrail}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={subscription.href}>
                  <Button variant="outline" size="sm">
                    <T k="reportCenter.openSubscription" />
                  </Button>
                </Link>
                <Link href={reportSectionHref(preferredReportWorkspace, "pack-automation")}>
                  <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                    <T k="pageLabels.reviewPack" />
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="border-b border-border/60 p-5"
        data-testid="dashboard-report-decision-shortcuts"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="pageLabels.businessQuestions" />
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {formatMessage(t["dashboard.dsQuestions"], {
                name: preferredReportWorkspace.navLabel,
              })}
            </p>
          </div>
          <Link href={reportSectionHref(preferredReportWorkspace, "decision-shortcuts")}>
            <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent">
              <T k="pageLabels.openDecisionShortcuts" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {preferredReportDecisionShortcuts.map((shortcut) => (
            <div
              key={shortcut.id}
              className="rounded-md border border-border/70 p-4"
              data-testid={`dashboard-report-decision-shortcut-${shortcut.id}`}
            >
              <div className="text-sm font-semibold text-foreground">{shortcut.question}</div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {shortcut.answer}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge variant="outline">
                  {formatMessage(t["dashboard.nReports"], { n: shortcut.reports.length })}
                </Badge>
                {shortcut.primaryReport ? (
                  <Badge variant="outline">{shortcut.primaryReport.name}</Badge>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={shortcut.primaryReportHref}>
                  <Button variant="outline" size="sm">
                    <T k="reportCenter.openReport" />
                  </Button>
                </Link>
                <Link href={shortcut.workflowHref}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`dashboard-report-decision-shortcut-automation-${shortcut.id}`}
                  >
                    <T k="reportCenter.automate" />
                  </Button>
                </Link>
                <Link href={shortcut.href}>
                  <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
                    <T k="pageLabels.viewShortcut" />
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="border-b border-border/60 p-5"
        data-testid="dashboard-report-comparison-presets"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="reportCenter.comparisonPresets" />
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {formatMessage(t["dashboard.dsComparisonPaths"], {
                name: preferredReportWorkspace.navLabel,
              })}
            </p>
          </div>
          <Link href={reportSectionHref(preferredReportWorkspace, "recommendations")}>
            <Button variant="ghost" size="sm" className="gap-1 text-accent hover:text-accent">
              <T k="pageLabels.openComparisonCenter" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {preferredReportComparisonPresets.map((preset) => (
            <div
              key={preset.id}
              className="rounded-md border border-border/70 p-4"
              data-testid={`dashboard-report-comparison-preset-${preset.id}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{preset.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {preset.question}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant="outline">
                      {formatMessage(t["dashboard.nMetrics"], { n: preset.metricIds.length })}
                    </Badge>
                    <Badge variant="outline">
                      {formatMessage(t["dashboard.nReports"], { n: preset.reports.length })}
                    </Badge>
                    <Badge variant="outline">{preset.baseline}</Badge>
                  </div>
                </div>
                <Link href={preset.href}>
                  <Button variant="outline" size="sm" className="shrink-0">
                    <T k="reportCenter.openComparison" />
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
              <div className="mt-3 rounded-md bg-muted/30 p-2 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {t["reportCenter.labelAutomation"]}
                </span>{" "}
                {preset.automationTrigger}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
