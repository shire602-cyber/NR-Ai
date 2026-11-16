// Reports > close tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { useTranslation } from "@/lib/i18n";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupConsolidationPanel } from "../GroupConsolidation";
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
import { activityLogRiskVariant, consolidatedStatusVariant, formatReportDate } from "../shared";
import { format } from "date-fns";
import { Money } from "@/components/ui/money";
import { useReportsPageContext } from "../context";

export default function CloseTab() {
  const { t } = useTranslation();
  const {
    auditTrailLoading,
    auditTrailPeriodLabel,
    auditTrailReport,
    consolidatedStatementsLoading,
    consolidatedStatementsReport,
    serverGroupConsolidation,
    dateRange,
    monthEndChecklist,
    monthEndCloseLoading,
    monthEndCloseStatus,
    monthEndCompletedChecks,
    monthEndPeriod,
    monthEndPeriodLabel,
    monthEndReadinessPercent,
    monthEndReviewChecks,
    reportSectionClass,
  } = useReportsPageContext();
  return (
    <>
      <div
        className={reportSectionClass(
          ["month-end-close-status", "audit-trail", "consolidated-statements"],
          "grid grid-cols-1 gap-6 md:grid-cols-4"
        )}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.closeReadiness" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {monthEndCloseLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">{monthEndReadinessPercent}%</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.completed" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <CheckCircle2 className="h-4 w-4 text-success " />
            </div>
          </CardHeader>
          <CardContent>
            {monthEndCloseLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">{monthEndCompletedChecks}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.needsReview2" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <AlertTriangle className="h-4 w-4 text-warning " />
            </div>
          </CardHeader>
          <CardContent>
            {monthEndCloseLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">{monthEndReviewChecks}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.closePeriod" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="tabular-nums text-2xl font-bold">{monthEndPeriod}</div>
            <p className="mt-1 text-xs text-muted-foreground">{monthEndPeriodLabel}</p>
          </CardContent>
        </Card>
      </div>

      <Card className={reportSectionClass(["month-end-close-status"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.monthEndCloseStatus" />
              </CardTitle>
              <CardDescription>
                {monthEndCloseStatus
                  ? `${formatReportDate(monthEndCloseStatus.periodStart)} - ${formatReportDate(monthEndCloseStatus.periodEnd)}`
                  : monthEndPeriodLabel}
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/month-end">
                <T k="reportCenter.openMonthEnd" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {monthEndCloseLoading ? (
            <Skeleton className="h-80" />
          ) : monthEndChecklist.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="reportCenter.check" />
                  </TableHead>
                  <TableHead>
                    <T k="reportCenter.status" />
                  </TableHead>
                  <TableHead>
                    <T k="reportCenter.description" />
                  </TableHead>
                  <TableHead>
                    <T k="reportCenter.details" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthEndChecklist.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === "complete" ? "success" : "warning"} dot>
                        {item.status === "complete" ? "Complete" : t["reportCenter.needsReview"]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.description}
                    </TableCell>
                    <TableCell className="text-sm">{item.details}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noMonthEndCloseChecksFoundFor" />
            </div>
          )}
        </CardContent>
      </Card>
      <Card className={reportSectionClass(["audit-trail"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle id="audit-trail-title">
                <T k="reportCenter.auditTrail" />
              </CardTitle>
              <CardDescription>{auditTrailPeriodLabel}</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/history">
                <T k="reportCenter.openHistory" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {auditTrailLoading ? (
            <Skeleton className="h-80" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="pages.events" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    {auditTrailReport.logCount}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.highRisk" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    {auditTrailReport.highRiskCount}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.postingActions" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    {auditTrailReport.postingActionCount}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.users" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    {auditTrailReport.userCount}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="text-sm font-medium">
                    <T k="reportCenter.activityByAction" />
                  </div>
                  {auditTrailReport.actionRows.slice(0, 6).length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <T k="reportCenter.action" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="pages.events" />
                          </TableHead>
                          <TableHead>
                            <T k="reportCenter.latest" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditTrailReport.actionRows.slice(0, 6).map((row) => (
                          <TableRow key={row.key}>
                            <TableCell className="capitalize">{row.label}</TableCell>
                            <TableCell data-numeric>{row.count}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatReportDate(row.latestAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      <T k="reportCenter.noActivityActionsFoundForThisPeriod" />
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium">
                    <T k="reportCenter.activityByRecordType" />
                  </div>
                  {auditTrailReport.entityRows.slice(0, 6).length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <T k="reportCenter.recordType" />
                          </TableHead>
                          <TableHead data-numeric>
                            <T k="pages.events" />
                          </TableHead>
                          <TableHead>
                            <T k="reportCenter.latest" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditTrailReport.entityRows.slice(0, 6).map((row) => (
                          <TableRow key={row.key}>
                            <TableCell className="capitalize">{row.label}</TableCell>
                            <TableCell data-numeric>{row.count}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatReportDate(row.latestAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      <T k="reportCenter.noAuditedRecordTypesFoundForThis" />
                    </div>
                  )}
                </div>
              </div>

              {auditTrailReport.rows.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>
                          <T k="reportCenter.action" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.record" />
                        </TableHead>
                        <TableHead>Risk</TableHead>
                        <TableHead>
                          <T k="reportCenter.description" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditTrailReport.rows.slice(0, 20).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-muted-foreground">
                            {formatReportDate(row.createdAt)}
                          </TableCell>
                          <TableCell className="capitalize">{row.actionLabel}</TableCell>
                          <TableCell>
                            <div className="capitalize">{row.entityLabel}</div>
                            <div className="tabular-nums text-xs text-muted-foreground">
                              {row.entityId || "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={activityLogRiskVariant(row.riskLevel)} dot>
                              {row.riskLevel}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[360px] truncate">
                            {row.description}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <T k="reportCenter.noActivityLogsFoundForThisPeriod" />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      <Card className={reportSectionClass(["consolidated-statements"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                {serverGroupConsolidation ? (
                  <T k="reportCenter.managementConsolidation" />
                ) : (
                  <T k="reportCenter.managementRollUp" />
                )}
              </CardTitle>
              <CardDescription>
                {consolidatedStatementsReport.periodLabel}.{" "}
                {serverGroupConsolidation ? (
                  <T k="reportCenter.perEntityBeforeEliminations" />
                ) : (
                  <T k="reportCenter.combinedViewUnconsolidated" />
                )}
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/financial-statements">
                <T k="reportCenter.openStatements" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <GroupConsolidationPanel
            from={dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined}
            to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
          />
          {consolidatedStatementsLoading ? (
            <Skeleton className="h-80" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.entities" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    {consolidatedStatementsReport.loadedEntityCount}/
                    {consolidatedStatementsReport.entityCount}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.revenue" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    <Money amount={consolidatedStatementsReport.totalRevenue} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.netProfit2" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    <Money amount={consolidatedStatementsReport.netProfit} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.assets" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    <Money amount={consolidatedStatementsReport.totalAssets} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.reviewItems" />
                  </div>
                  <div className="tabular-nums text-xl font-semibold">
                    {consolidatedStatementsReport.reviewCount}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={consolidatedStatementsReport.reviewCount > 0 ? "warning" : "success"}
                  dot
                >
                  {consolidatedStatementsReport.statusLabel}
                </Badge>
                <Badge variant="outline">{consolidatedStatementsReport.consolidationBasis}</Badge>
              </div>

              {consolidatedStatementsReport.rows.length ? (
                <div className="overflow-x-auto">
                  <Table className="min-w-[980px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="reportCenter.company" />
                        </TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.revenue" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.netProfit2" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.assets" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.status" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.review" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consolidatedStatementsReport.rows.map((row) => (
                        <TableRow key={row.companyId}>
                          <TableCell>
                            <div className="font-medium">{row.companyName}</div>
                            <div className="text-xs text-muted-foreground">{row.baseCurrency}</div>
                          </TableCell>
                          <TableCell className="capitalize">{row.companyType}</TableCell>
                          <TableCell data-numeric>
                            <Money amount={row.revenue} currency={"AED"} />
                          </TableCell>
                          <TableCell data-numeric>
                            <Money amount={row.netProfit} currency={"AED"} />
                          </TableCell>
                          <TableCell data-numeric>
                            <Money amount={row.assets} currency={"AED"} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={consolidatedStatusVariant(row.status)} dot>
                              {row.statusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                            {row.reviewReason || "Ready for accountant pack."}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <T k="reportCenter.noAccessibleCompaniesFoundForThisManagement" />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
