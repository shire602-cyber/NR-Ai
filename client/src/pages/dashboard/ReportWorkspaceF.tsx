import { Button } from "@/components/ui/button";
import { formatMessage } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import type { DashboardModel } from "./useCustomerDashboardModel";

export function ReportWorkspacePartF({ m }: { m: DashboardModel }) {
  const { t } = m;
  const {
    preferredReportWorkspace,
    preferredReportPackTemplates,
    preferredReportAutomationStarters,
  } = m;
  return (
    <>
      <div
        className="border-t border-border/60 p-5"
        data-testid="dashboard-report-automation-starters"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="reportCenter.automationStarters" />
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {formatMessage(t["dashboard.wsLaunchChecklists"], {
                name: preferredReportWorkspace.navLabel,
              })}
            </p>
          </div>
          <Badge variant="outline">
            {formatMessage(t["dashboard.nStarters"], {
              n: preferredReportAutomationStarters.length,
            })}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {preferredReportAutomationStarters.map((starter) => (
            <div
              key={starter.id}
              className="rounded-md border border-border/70 p-4"
              data-testid={`dashboard-report-automation-starter-${starter.id}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-foreground">{starter.title}</div>
                    <Badge variant="info">{starter.setupTime}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {starter.outcome}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant="outline">
                      {formatMessage(t["dashboard.readyOfReports"], {
                        ready: starter.readyReports,
                        total: starter.reports.length,
                      })}
                    </Badge>
                    <Badge variant="outline">
                      {formatMessage(t["dashboard.nPlaybooks"], { n: starter.playbooks.length })}
                    </Badge>
                    <Badge variant="outline">
                      {formatMessage(t["dashboard.nSteps"], { n: starter.setupSteps.length })}
                    </Badge>
                  </div>
                </div>
                <Link href={starter.href}>
                  <Button variant="outline" size="sm" className="shrink-0">
                    {starter.primaryAction}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {starter.setupSteps.map((step) => (
                  <div
                    key={step}
                    className="flex gap-2 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground"
                  >
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border/60 p-5" data-testid="dashboard-report-pack-templates">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-caption font-medium text-muted-foreground">
              <T k="pageLabels.readyMadeReportPacks" />
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {formatMessage(t["dashboard.wsPackTemplatesIntro"], {
                name: preferredReportWorkspace.navLabel,
              })}
            </p>
          </div>
          <Badge variant="outline">
            {formatMessage(t["dashboard.nTemplates"], { n: preferredReportPackTemplates.length })}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {preferredReportPackTemplates.map((template) => (
            <div
              key={template.id}
              className="rounded-md border border-border/70 p-4"
              data-testid={`dashboard-report-pack-template-${template.id}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{template.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {template.outcome}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant="outline">{template.cadence}</Badge>
                    <Badge variant="outline">
                      {formatMessage(t["dashboard.readyOfReports"], {
                        ready: template.readyReports,
                        total: template.reports.length,
                      })}
                    </Badge>
                  </div>
                </div>
                <Link href={template.href}>
                  <Button variant="outline" size="sm" className="shrink-0">
                    <T k="reportCenter.openTemplate" />
                    <ArrowRight className="w-3.5 h-3.5" />
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
