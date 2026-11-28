// Reports > comparisons workspace panel.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { formatMessage, useTranslation } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataBasisBadge } from "../StatementParts";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { comparisonBadgeVariant, formatComparisonPercent, formatComparisonValue } from "../shared";
import { reportComparisonMetricBasis } from "@/lib/reportCatalog";
import { useCatalogText } from "@/lib/reportCatalogText";
import { useReportsPageContext } from "../context";
import { SecondaryQueryError } from "../ReportQueryNotice";

export default function ComparisonsPanel() {
  const { t } = useTranslation();
  const ct = useCatalogText();
  const {
    comparisonCurrentLabel,
    comparisonLoading,
    comparisonPreviousLabel,
    comparisonRanges,
    locale,
    personaFilter,
    personaFilterLabel,
    personaScopeDescription,
    reportWorkspacePanelClass,
    secondaryLoadErrors,
    setActiveTab,
    visibleComparisonRows,
    visibleReportComparisonPresets,
  } = useReportsPageContext();
  return (
    <>
      <SecondaryQueryError error={secondaryLoadErrors.comparisonProfitLoss} testId="comparisons-panel-pl-error" />
      <SecondaryQueryError error={secondaryLoadErrors.comparisonBalanceSheet} testId="comparisons-panel-bs-error" />
      <SecondaryQueryError error={secondaryLoadErrors.comparisonVat} testId="comparisons-panel-vat-error" />
      <SecondaryQueryError error={secondaryLoadErrors.comparisonSalesProductService} testId="comparisons-panel-sps-error" />
      <SecondaryQueryError error={secondaryLoadErrors.comparisonCostCenter} testId="comparisons-panel-cc-error" />
      <SecondaryQueryError error={secondaryLoadErrors.comparisonCorporateTax} testId="comparisons-panel-ct-error" />
      <SecondaryQueryError error={secondaryLoadErrors.fxGainsLosses} testId="comparisons-panel-fx-error" />
      <SecondaryQueryError error={secondaryLoadErrors.costCenterProfitability} testId="comparisons-panel-cost-center-error" />
      <section
        className={reportWorkspacePanelClass("comparisons", "space-y-4")}
        aria-labelledby="period-comparison-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="period-comparison-title" className="text-xl font-semibold">
              <T k="reportCenter.periodComparison" />
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatMessage(t["reportCenter.cpCompared"], {
                current: ct.cx(comparisonCurrentLabel),
                previous: ct.cx(comparisonPreviousLabel),
                scope: personaScopeDescription,
              })}
            </p>
          </div>
          <Badge
            variant={
              personaFilter === "all" ? (comparisonRanges.isCustom ? "info" : "neutral") : "info"
            }
            dot
          >
            {personaFilter === "all"
              ? comparisonRanges.isCustom
                ? t["comparisonsPanel.customRange"]
                : t["comparisonsPanel.monthToDate"]
              : personaFilterLabel}
          </Badge>
        </div>

        {visibleReportComparisonPresets.length ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visibleReportComparisonPresets.map((preset) => (
              <Card
                key={preset.id}
                id={`report-comparison-preset-${preset.id}`}
                data-testid={`report-comparison-preset-${preset.id}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold">{preset.title}</CardTitle>
                      <CardDescription>{preset.baseline}</CardDescription>
                    </div>
                    <Badge variant={preset.warningCount > 0 ? "warning" : "success"} dot>
                      {preset.warningCount > 0
                        ? formatMessage(t["reportCenter.nReview"], { n: preset.warningCount })
                        : t["reportCenter.clear"]}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{preset.question}</p>

                  <div className="space-y-2">
                    {preset.metrics.map((metric) => (
                      <div
                        key={metric.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{metric.label}</div>
                          <div className="text-muted-foreground">{metric.signal}</div>
                        </div>
                        <Badge variant={comparisonBadgeVariant(metric)}>
                          {formatComparisonPercent(metric.percentChange)}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {preset.reports.slice(0, 4).map((report) => (
                      <Badge key={report.id} variant="outline">
                        {report.name}
                      </Badge>
                    ))}
                    {preset.reports.length > 4 ? (
                      <Badge variant="neutral">+{preset.reports.length - 4}</Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      {preset.automationTrigger}
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={preset.href}>
                        <T k="reportCenter.openPreset" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {comparisonLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-5">
            {visibleComparisonRows.map((row) => (
              <Card key={row.id}>
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold">{row.label}</CardTitle>
                      <CardDescription>{row.signal}</CardDescription>
                    </div>
                    <Badge variant={comparisonBadgeVariant(row)} dot>
                      {formatComparisonPercent(row.percentChange)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        {row.currentLabel ?? t["reportCenter.current"]}
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {formatComparisonValue(row, row.current, locale)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        {row.previousLabel ?? t["reportCenter.previous"]}
                      </div>
                      <div className="tabular-nums text-lg font-semibold">
                        {formatComparisonValue(row, row.previous, locale)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">
                        <T k="reportCenter.movement" />
                      </div>
                      <div className="truncate tabular-nums text-sm font-semibold">
                        {formatComparisonValue(row, row.delta, locale)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveTab(row.tab)}
                    >
                      {t["pages.open"]}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
      <section
        className={reportWorkspacePanelClass("comparisons", "space-y-4")}
        aria-labelledby="comparison-snapshots-title"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="comparison-snapshots-title" className="text-xl font-semibold">
              <T k="reportCenter.comparisonSnapshots" />
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatMessage(t["reportCenter.cpVs"], {
                current: ct.cx(comparisonCurrentLabel),
                previous: ct.cx(comparisonPreviousLabel),
                scope: personaScopeDescription,
              })}
            </p>
          </div>
          <Badge variant={personaFilter === "all" ? "outline" : "info"}>
            {personaFilter === "all"
              ? comparisonRanges.isCustom
                ? t["comparisonsPanel.selectedRange"]
                : t["comparisonsPanel.monthToDate"]
              : personaFilterLabel}
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <T k="reportCenter.currentVsPriorPeriod" />
            </CardTitle>
            <CardDescription>
              {t["comparisonsPanel.highLevelMovementAcrossRevenue"]}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {comparisonLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.metric" />
                      </TableHead>
                      <TableHead>
                        <T k="reportCenter.signal" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.current" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.baseline" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.change" />
                      </TableHead>
                      <TableHead>
                        <T k="pages.roles" />
                      </TableHead>
                      <TableHead data-numeric>{t["pages.open"]}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleComparisonRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {row.label}
                            <DataBasisBadge basis={reportComparisonMetricBasis(row.id)} />
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={comparisonBadgeVariant(row)} dot>
                            {row.signal}
                          </Badge>
                        </TableCell>
                        <TableCell data-numeric>
                          {formatComparisonValue(row, row.current, locale)}
                        </TableCell>
                        <TableCell data-numeric>
                          {formatComparisonValue(row, row.previous, locale)}
                        </TableCell>
                        <TableCell data-numeric>
                          <div className="tabular-nums font-medium">
                            {formatComparisonValue(row, row.delta, locale)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatComparisonPercent(row.percentChange)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {row.personas.map((persona) => (
                              <Badge key={persona} variant="outline" className="capitalize">
                                {t[
                                  `reportCenter.persona${persona.charAt(0).toUpperCase()}${persona.slice(1)}`
                                ] ?? persona}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell data-numeric>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setActiveTab(row.tab)}
                          >
                            {t["pages.open"]}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
