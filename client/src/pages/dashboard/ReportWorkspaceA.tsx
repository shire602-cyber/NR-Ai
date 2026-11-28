import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { reportSectionHref } from "@/lib/reportCatalog";
import { FileText, Sparkles, ArrowRight, Clock, BarChart3 } from "lucide-react";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function ReportWorkspacePartA({ m }: { m: DashboardModel }) {
  const { t } = useTranslation();
  const {
    preferredReportWorkspace,
    dashboardReportWorkspaces,
    selectDashboardReportPersona,
    dashboardRoleWorkdayPath,
    preferredReportSetupSteps,
    preferredReportSuites,
  } = m;
  return (
    <>
      <div className="border-b border-border/60 p-5" data-testid="dashboard-report-role-switcher">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="pageLabels.reportingMode" />
            </div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
              <T k="dashboard.workspaceSwitchHint" />
            </p>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 lg:max-w-3xl">
            {dashboardReportWorkspaces.map((workspace) => (
              <button
                key={workspace.persona}
                type="button"
                onClick={() => selectDashboardReportPersona(workspace.persona)}
                className={`rounded-md border p-3 text-start transition-colors ${
                  workspace.isSelected
                    ? "border-accent bg-accent/5"
                    : "border-border/70 hover:border-accent hover:bg-muted/60"
                }`}
                data-testid={`dashboard-report-mode-${workspace.persona}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {workspace.navLabel}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatMessage(t["dashboard.wsReportsReady"], {
                        ready: workspace.readyReports,
                        total: workspace.totalReports,
                      })}
                    </div>
                  </div>
                  <Badge variant={workspace.isSelected ? "info" : "outline"}>
                    {workspace.readinessPercent}%
                  </Badge>
                </div>
                <div className="mt-2 text-caption text-muted-foreground">
                  {formatMessage(t["dashboard.wsLanesStarters"], {
                    lanes: workspace.automations.length,
                    starters: workspace.automationStarterCount,
                  })}
                </div>
                <div className="mt-1 text-caption text-muted-foreground">
                  {formatMessage(t["dashboard.wsPacksComparisons"], {
                    packs: workspace.packTemplateCount,
                    comparisons: workspace.comparisonPresetCount,
                  })}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="border-b border-border/60 p-5" data-testid="dashboard-report-role-setup">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="pageLabels.roleSetupPath" />
            </div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
              {formatMessage(t["dashboard.wsFollowPath"], {
                name: preferredReportWorkspace.navLabel,
              })}
            </p>
          </div>
          <Link href={reportSectionHref(preferredReportWorkspace, "role-setup")}>
            <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
              <T k="pageLabels.openSetupPath" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
          {preferredReportSetupSteps.map((step, index) => (
            <Link key={step.id} href={step.href}>
              <div
                className="h-full rounded-md border border-border/70 p-3 transition-colors hover:bg-muted/60"
                data-testid={`dashboard-report-role-setup-step-${step.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-caption font-semibold text-accent">
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">{step.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {step.outcome}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Badge variant="outline">
                    {formatMessage(t["dashboard.nReports"], { n: step.reports.length })}
                  </Badge>
                  <Badge variant="outline">
                    {t[
                      `dashboard.cmdWord${step.command.charAt(0).toUpperCase()}${step.command.slice(1)}`
                    ] ?? step.command}
                  </Badge>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <div
        className="border-b border-border/60 p-5"
        data-testid="dashboard-report-role-workday-path"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              {dashboardRoleWorkdayPath.eyebrow}
            </div>
            <h3 className="mt-2 text-base font-semibold text-foreground">
              {dashboardRoleWorkdayPath.title}
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
              {dashboardRoleWorkdayPath.description}
            </p>
          </div>
          <Link href={reportSectionHref(preferredReportWorkspace, "workflow-finder")}>
            <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
              <T k="pageLabels.openWorkflowFinder" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {dashboardRoleWorkdayPath.actions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.id} href={action.href}>
                <div
                  className="h-full rounded-md border border-border/70 p-3 transition-colors hover:bg-muted/60"
                  data-testid={`dashboard-report-role-workday-action-${action.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                      <Icon className="h-4 w-4" />
                    </div>
                    <Badge variant="outline">{action.cta}</Badge>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-foreground">{action.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {action.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="border-b border-border/60 p-5" data-testid="dashboard-report-suites">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="reportCenter.reportSuites" />
            </div>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
              <T k="dashboard.workspaceSuitesHint" />
            </p>
          </div>
          <Link href={reportSectionHref(preferredReportWorkspace, "report-suites")}>
            <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
              <T k="reportCenter.openSuites" />
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {preferredReportSuites.map((suite) => (
            <div
              key={suite.id}
              className="rounded-md border border-border/70 p-3"
              data-testid={`dashboard-report-suite-${suite.id}`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {suite.title}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{suite.workflow}</div>
                </div>
                <Badge
                  variant={suite.readyReports === suite.reports.length ? "success" : "warning"}
                  dot
                >
                  {suite.readyReports}/{suite.reports.length}
                </Badge>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{suite.outcome}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.triggerRules" />
                  </div>
                  <div className="mt-1 font-semibold tabular-nums text-foreground">
                    {suite.triggerRules.length}
                  </div>
                </div>
                <div className="rounded-md bg-muted/30 p-2">
                  <div className="text-muted-foreground">
                    <T k="reportCenter.delivery" />
                  </div>
                  <div className="mt-1 truncate font-medium text-foreground">
                    {suite.deliverySubscription?.channel ?? t["dashboard.workspaceOpenSetup"]}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {suite.reports.slice(0, 4).map((report) => (
                  <Badge key={report.id} variant="outline">
                    {report.name}
                  </Badge>
                ))}
                {suite.reports.length > 4 ? (
                  <Badge variant="neutral">+{suite.reports.length - 4}</Badge>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-4">
                <Link href={suite.comparisonHref}>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <BarChart3 className="w-3.5 h-3.5" />
                    <T k="reportCenter.compare" />
                  </Button>
                </Link>
                <Link href={suite.packHref}>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <FileText className="w-3.5 h-3.5" />
                    {t["reportCenter.labelPack"]}
                  </Button>
                </Link>
                <Link href={suite.automationHref}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-accent hover:text-accent"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <T k="reportCenter.autopilot" />
                  </Button>
                </Link>
                <Link href={suite.deliveryHref}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-accent hover:text-accent"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <T k="reportCenter.delivery" />
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
