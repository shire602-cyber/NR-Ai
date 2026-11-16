// Reports > suites workspace panel.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { ArrowRight, BarChart3, FileText, Send, Sparkles } from "lucide-react";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useCatalogText } from "@/lib/reportCatalogText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { T } from "@/components/layout/T";
import { useReportsPageContext } from "../context";

export default function SuitesPanel() {
  const { t } = useTranslation();
  const ct = useCatalogText();
  const {
    isReportDeliveryHandoffAcknowledged,
    personaScopeDescription,
    queueReportDeliverySubscription,
    queueReportDeliverySubscriptionWithHandoffGuard,
    reportDeliverySubscriptionHasReviewHandoff,
    reportDeliverySubscriptionSummaries,
    reportWorkspacePanelClass,
    selectedCompanyId,
    setReportPersonaFilter,
    visibleReportManagementBriefSummaries,
    visibleReportPackTemplates,
    visibleReportSuiteSummaries,
  } = useReportsPageContext();
  return (
    <>
      <section
        className={reportWorkspacePanelClass("suites", "space-y-4")}
        aria-labelledby="report-suites-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-suites-title" className="text-xl font-semibold">
              <T k="reportCenter.reportSuites" />
            </h2>
            <p className="text-sm text-muted-foreground">
              <T k="reportCenter.suitesIntro" />
            </p>
          </div>
          <Badge variant="info" dot>
            {formatMessage(t["reportCenter.nSuites"], { n: visibleReportSuiteSummaries.length })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3" data-testid="report-suites">
          {visibleReportSuiteSummaries.map((suite) => {
            const WorkspaceIcon = suite.workspace.icon;
            const suiteDeliverySubscription = reportDeliverySubscriptionSummaries.find(
              (subscription) => subscription.id === suite.deliverySubscriptionId
            );
            const suiteRequiresHandoffAcknowledgement =
              reportDeliverySubscriptionHasReviewHandoff(suite.deliverySubscriptionId) &&
              !isReportDeliveryHandoffAcknowledged(suite.deliverySubscriptionId);
            const isQueueingThisSuiteDelivery =
              queueReportDeliverySubscription.isPending &&
              queueReportDeliverySubscription.variables?.subscriptionId ===
                suite.deliverySubscriptionId;
            const isSuiteDeliveryPaused = suiteDeliverySubscription?.enabled === false;
            const suiteQueueLabel = isQueueingThisSuiteDelivery
              ? t["components.launchQueueing"]
              : suiteRequiresHandoffAcknowledgement
                ? t["components.launchAcknowledgeHandoff"]
                : isSuiteDeliveryPaused
                  ? ct.cx("Paused")
                  : ct.cx("Queue delivery");

            return (
              <Card
                key={suite.id}
                id={`report-suite-${suite.id}`}
                data-testid={`report-suite-${suite.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{suite.title}</CardTitle>
                        <CardDescription>{suite.workflow}</CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={suite.readyCount === suite.reports.length ? "success" : "warning"}
                      dot
                    >
                      {suite.readyCount}/{suite.reports.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">{suite.outcome}</p>

                  <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.comparison" />
                      </div>
                      <div className="mt-1 truncate font-medium text-foreground">
                        {suite.comparisonPreset.title}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{t["reportCenter.labelPack"]}</div>
                      <div className="mt-1 truncate font-medium text-foreground">
                        {suite.packTemplate.cadence}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.automation" />
                      </div>
                      <div className="mt-1 truncate font-medium text-foreground">
                        {suite.automationStarter.setupTime}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.triggerRules" />
                      </div>
                      <div className="mt-1 tabular-nums font-medium text-foreground">
                        {suite.triggerRules.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.delivery" />
                      </div>
                      <div className="mt-1 truncate font-medium text-foreground">
                        {suite.deliverySubscription.channel}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.savedViews" />
                      </div>
                      <div className="mt-1 tabular-nums font-medium text-foreground">
                        {suite.savedViews.length}
                      </div>
                    </div>
                  </div>

                  <div
                    className="rounded-md border border-border/70 bg-secondary/30 p-3 text-xs"
                    data-testid={`report-suite-delivery-readiness-${suite.id}`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-medium text-foreground">
                          <T k="reportCenter.deliveryReadiness" />
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {suiteDeliverySubscription
                            ? `${suiteDeliverySubscription.channel} · ${ct.cx(
                                suiteDeliverySubscription.nextRunLabel ||
                                  "Next run calculated on queue"
                              )}`
                            : suite.deliverySubscription.channel}
                        </div>
                      </div>
                      <Badge
                        variant={suiteDeliverySubscription?.statusVariant ?? "neutral"}
                        dot
                        className="w-fit"
                      >
                        {suiteRequiresHandoffAcknowledgement
                          ? t["reportCenter.handoffReview"]
                          : (suiteDeliverySubscription?.status ?? ct.cx("Catalog"))}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {suite.reports.slice(0, 5).map((report) => (
                      <Badge key={report.id} variant="outline">
                        {report.name}
                      </Badge>
                    ))}
                    {suite.reports.length > 5 ? (
                      <Badge variant="neutral">+{suite.reports.length - 5}</Badge>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <Button asChild size="sm" variant="outline" className="justify-start">
                      <Link href={suite.comparisonHref}>
                        <BarChart3 className="h-3.5 w-3.5" />
                        <T k="reportCenter.compare" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="justify-start">
                      <Link href={suite.packHref}>
                        <FileText className="h-3.5 w-3.5" />
                        {t["reportCenter.labelPack"]}
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="justify-start text-accent">
                      <Link href={suite.automationHref}>
                        <Sparkles className="h-3.5 w-3.5" />
                        <T k="reportCenter.autopilot" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="justify-start text-accent">
                      <Link href={suite.deliveryHref}>
                        <Send className="h-3.5 w-3.5" />
                        <T k="reportCenter.delivery" />
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="justify-start"
                      disabled={
                        !selectedCompanyId ||
                        queueReportDeliverySubscription.isPending ||
                        isSuiteDeliveryPaused
                      }
                      onClick={() =>
                        queueReportDeliverySubscriptionWithHandoffGuard(
                          suite.deliverySubscriptionId
                        )
                      }
                      data-testid={`report-suite-queue-delivery-${suite.id}`}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {suiteQueueLabel}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
      <section
        className={reportWorkspacePanelClass("suites", "space-y-4")}
        aria-labelledby="report-management-briefs-title"
        data-testid="report-management-briefs"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-management-briefs-title" className="text-xl font-semibold">
              <T k="reportCenter.managementPackBriefs" />
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatMessage(t["reportCenter.spBriefsIntro"], { scope: personaScopeDescription })}
            </p>
          </div>
          <Badge variant="info" dot>
            {formatMessage(t["reportCenter.nBriefs"], {
              n: visibleReportManagementBriefSummaries.length,
            })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {visibleReportManagementBriefSummaries.map((brief) => {
            const WorkspaceIcon = brief.workspace.icon;

            return (
              <Card
                key={brief.id}
                id={`report-management-brief-${brief.id}`}
                data-testid={`report-management-brief-${brief.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-semibold">{brief.title}</CardTitle>
                        <CardDescription>{brief.audience}</CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={brief.readyCount === brief.reports.length ? "success" : "warning"}
                      dot
                    >
                      {brief.readyCount}/{brief.reports.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">{brief.outcome}</p>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">{t["reportCenter.labelKpis"]}</div>
                      <div className="mt-1 tabular-nums text-base font-semibold">
                        {brief.kpiMetricIds.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.narratives" />
                      </div>
                      <div className="mt-1 tabular-nums text-base font-semibold">
                        {brief.narrativeSections.length}
                      </div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-muted-foreground">
                        <T k="reportCenter.dimensions" />
                      </div>
                      <div className="mt-1 tabular-nums text-base font-semibold">
                        {brief.dimensionBreakdowns.length}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.kpiWidgets" />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {brief.kpiWidgets.map((widget) => (
                        <div
                          key={widget.id}
                          className="rounded-md border p-2 text-xs"
                          data-testid={`report-management-brief-kpi-${widget.id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-foreground">{widget.label}</div>
                            <Badge variant="outline">
                              {t[
                                `reportCenter.display${widget.display.charAt(0).toUpperCase()}${widget.display.slice(1)}`
                              ] ?? widget.display}
                            </Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">{widget.question}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.narrativeSections" />
                    </div>
                    {brief.narrativeSections.map((section) => (
                      <div
                        key={section.id}
                        className="rounded-md border p-3"
                        data-testid={`report-management-brief-narrative-${section.id}`}
                      >
                        <div className="text-sm font-medium text-foreground">{section.title}</div>
                        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {section.prompt}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="outline">
                            {formatMessage(t["reportCenter.nReportsShort"], {
                              n: section.sourceReportIds.length,
                            })}
                          </Badge>
                          <Badge variant="outline">
                            {formatMessage(t["reportCenter.nMetrics"], {
                              n: section.comparisonMetricIds.length,
                            })}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      <T k="reportCenter.dimensionalLenses" />
                    </div>
                    <div className="grid gap-2">
                      {brief.dimensionBreakdowns.map((dimension) => (
                        <div
                          key={dimension.id}
                          className="rounded-md bg-muted/30 p-2 text-xs"
                          data-testid={`report-management-brief-dimension-${dimension.id}`}
                        >
                          <div className="font-medium text-foreground">{dimension.label}</div>
                          <div className="mt-1 text-muted-foreground">
                            {dimension.dimension} · {dimension.question}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {brief.batchAction ? (
                    <div
                      className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs"
                      data-testid={`report-management-brief-batch-${brief.id}`}
                    >
                      <div className="font-medium text-foreground">{brief.batchAction.label}</div>
                      <div className="mt-1 text-muted-foreground">{brief.batchAction.detail}</div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={brief.href}>
                        <T k="reportCenter.openBrief" /> <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={brief.suiteHref}>
                        <T k="reportCenter.openSuite" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={brief.deliveryHref}>
                        <T k="reportCenter.openDelivery" />
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
        className={reportWorkspacePanelClass("suites", "space-y-4")}
        aria-labelledby="report-pack-templates-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="report-pack-templates-title" className="text-xl font-semibold">
              <T k="reportCenter.reportPackTemplates" />
            </h2>
            <p className="text-sm text-muted-foreground">
              <T k="reportCenter.packsIntro" />
            </p>
          </div>
          <Badge variant="outline">
            {formatMessage(t["reportCenter.nTemplates"], { n: visibleReportPackTemplates.length })}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleReportPackTemplates.map((template) => {
            const TemplateIcon = template.workspace.icon;

            return (
              <Card
                key={template.id}
                id={`report-pack-template-${template.id}`}
                data-testid={`report-pack-template-${template.id}`}
              >
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{template.title}</CardTitle>
                      <CardDescription>{template.audience}</CardDescription>
                    </div>
                    <TemplateIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </div>
                  <Badge variant="outline" className="w-fit capitalize">
                    {t[
                      `reportCenter.persona${template.persona.charAt(0).toUpperCase()}${template.persona.slice(1)}`
                    ] ?? template.persona}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{template.outcome}</p>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border p-3">
                      <div className="font-medium text-foreground">
                        <T k="reportCenter.cadence" />
                      </div>
                      <div className="mt-1 text-muted-foreground">{template.cadence}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="font-medium text-foreground">
                        <T k="reportCenter.readyReports" />
                      </div>
                      <div className="mt-1 tabular-nums text-base font-semibold">
                        {template.readyCount}/{template.reports.length}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">
                        {t["reportCenter.labelComparisons"]}
                      </span>{" "}
                      {template.comparisonFocus}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">
                        {t["reportCenter.labelAutomation"]}
                      </span>{" "}
                      {template.automationTrigger}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">
                        {t["reportCenter.labelDelivery"]}
                      </span>{" "}
                      {template.delivery}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {template.reports.slice(0, 5).map((report) => (
                      <Badge key={report.id} variant="outline">
                        {report.name}
                      </Badge>
                    ))}
                    {template.reports.length > 5 ? (
                      <Badge variant="neutral">+{template.reports.length - 5}</Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={template.href}>
                        <T k="reportCenter.openTemplate" />
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReportPersonaFilter(template.persona)}
                    >
                      <T k="reportCenter.filterLibrary" />
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
