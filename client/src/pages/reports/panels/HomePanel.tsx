// Reports > home workspace panel.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { formatMessage, useTranslation } from "@/lib/i18n";
import { ArrowRight, BarChart3, FileText, Search, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import { Money } from "@/components/ui/money";
import { reportStatusMeta } from "../shared";
import { useReportsPageContext } from "../context";

export default function HomePanel() {
  const { t } = useTranslation();
  const {
    activeReportWorkspaceTab,
    automationQueueCount,
    personaFilterLabel,
    personaScopeDescription,
    reportAutomationOperationsNeedingReview,
    reportHomeAutomationOperation,
    reportHomeQuickReports,
    reportHomeSavedViews,
    reportHomeSuites,
    reportStats,
    reportWorkflowSearch,
    setReportWorkspaceTab,
    updateReportWorkflowSearch,
  } = useReportsPageContext();
  return (
    <>
      {activeReportWorkspaceTab === "home" ? (
        <section className="space-y-4" aria-labelledby="reports-home-title">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.65fr)]">
            <Card className="border-card-border">
              <CardHeader className="space-y-3 pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle id="reports-home-title" className="text-xl">
                      <T k="reportCenter.reportingCommandCenter" />
                    </CardTitle>
                    <CardDescription>{personaScopeDescription}</CardDescription>
                  </div>
                  <Badge
                    variant={reportAutomationOperationsNeedingReview > 0 ? "warning" : "success"}
                    dot
                    className="w-fit"
                  >
                    {reportAutomationOperationsNeedingReview > 0
                      ? formatMessage(t["reportCenter.needAction"], {
                          n: reportAutomationOperationsNeedingReview,
                        })
                      : t["reportCenter.ready"]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.readyReports" />
                    </div>
                    <div className="mt-1 text-kpi tabular-nums">
                      {reportStats.ready}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.liveReports" />
                    </div>
                    <div className="mt-1 text-kpi tabular-nums">
                      {reportStats.live}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.automations" />
                    </div>
                    <div className="mt-1 text-kpi tabular-nums">
                      {reportStats.automationStarters}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.openQueue" />
                    </div>
                    <div className="mt-1 text-kpi tabular-nums">
                      {automationQueueCount}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={reportWorkflowSearch}
                      onChange={(event) => updateReportWorkflowSearch(event.target.value)}
                      placeholder={t["homePanel.searchReportsPacksComparisonsAutomations"]}
                      className="ps-9"
                      data-testid="input-report-home-search"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReportWorkspaceTab("reports")}
                    data-testid="button-report-home-search-open"
                  >
                    <T k="reportCenter.searchLibrary" />
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => setReportWorkspaceTab("reports")}
                  >
                    <FileText className="h-4 w-4" />
                    <T k="reportCenter.reports" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => setReportWorkspaceTab("comparisons")}
                  >
                    <BarChart3 className="h-4 w-4" />
                    <T k="reportCenter.compare" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => setReportWorkspaceTab("automation")}
                  >
                    <Sparkles className="h-4 w-4" />
                    <T k="reportCenter.automate" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() => setReportWorkspaceTab("delivery")}
                  >
                    <Send className="h-4 w-4" />
                    <T k="reportCenter.delivery" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-card-border">
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      <T k="reportCenter.nextAutomation" />
                    </CardTitle>
                    <CardDescription>
                      {reportHomeAutomationOperation?.workspace.title ?? personaFilterLabel}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={reportHomeAutomationOperation?.statusVariant ?? "neutral"}
                    dot
                    className="w-fit"
                  >
                    {reportHomeAutomationOperation?.status ?? t["homePanel.noRoleSelected"]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {reportHomeAutomationOperation ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.health" />
                        </div>
                        <div className="mt-1 tabular-nums text-lg font-semibold">
                          {reportHomeAutomationOperation.automationScore}/100
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">
                          <T k="reportCenter.atRisk" />
                        </div>
                        <div className="mt-1 truncate tabular-nums text-sm font-semibold">
                          <Money
                            amount={reportHomeAutomationOperation.amountAtRisk}
                            currency={"AED"}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border p-3 text-sm">
                      <div className="font-medium text-foreground">
                        {reportHomeAutomationOperation.nextAction.label}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {reportHomeAutomationOperation.nextAction.detail}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={reportHomeAutomationOperation.nextAction.href}>
                        <T k="reportCenter.openAction" /> <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    <T k="reportCenter.selectARoleToShowTheNext" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">
                  <T k="reportCenter.topReports" />
                </h2>
                <p className="text-sm text-muted-foreground">
                  {formatMessage(t["reportCenter.homeShortcuts"], { persona: personaFilterLabel })}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReportWorkspaceTab("reports")}
              >
                <T k="reportCenter.allReports" />
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            {reportHomeQuickReports.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {reportHomeQuickReports.map(
                  ({ report, href, workflowHref, comparisonHref, deliveryHref, profile }) => (
                    <Card key={`${profile.persona}-${report.id}`} className="border-card-border">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">
                              {report.name}
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {report.category} · {profile.workspace.navLabel}
                            </div>
                          </div>
                          <Badge variant={report.status === "planned" ? "warning" : "success"} dot>
                            {reportStatusMeta[report.status].label}
                          </Badge>
                        </div>
                        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {report.decisionQuestion}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button asChild size="sm">
                            <Link href={href}>{t["pages.open"]}</Link>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={workflowHref}>
                              <T k="reportCenter.automate" />
                            </Link>
                          </Button>
                          {comparisonHref ? (
                            <Button asChild size="sm" variant="ghost">
                              <Link href={comparisonHref}>
                                <T k="reportCenter.compare" />
                              </Link>
                            </Button>
                          ) : null}
                          {deliveryHref ? (
                            <Button asChild size="sm" variant="ghost">
                              <Link href={deliveryHref}>
                                <T k="reportCenter.schedule" />
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                <T k="reportCenter.noQuickAccessReportsMatchTheCurrent" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="border-card-border">
              <CardHeader className="space-y-2 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      <T k="reportCenter.suites" />
                    </CardTitle>
                    <CardDescription>
                      <T k="reportCenter.reportPacksReadyForRecurringReview" />
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setReportWorkspaceTab("suites")}
                  >
                    <T k="reportCenter.openSuites" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {reportHomeSuites.map((suite) => (
                  <div
                    key={suite.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{suite.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{suite.workflow}</div>
                    </div>
                    <Badge
                      variant={suite.readyCount === suite.reports.length ? "success" : "warning"}
                      dot
                    >
                      {suite.readyCount}/{suite.reports.length}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-card-border">
              <CardHeader className="space-y-2 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      <T k="reportCenter.savedViews" />
                    </CardTitle>
                    <CardDescription>
                      <T k="reportCenter.reusableFiltersAndComparisonPresets" />
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setReportWorkspaceTab("reports")}
                  >
                    <T k="reportCenter.openViews" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {reportHomeSavedViews.length ? (
                  reportHomeSavedViews.map((view) => (
                    <Link key={view.id} href={view.href}>
                      <div className="rounded-md border p-3 text-sm transition-colors hover:bg-muted/5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{view.title}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {view.report.name} · {view.comparisonPeriod}
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    <T k="reportCenter.noSavedViewsMatchTheCurrentFilters" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}
    </>
  );
}
