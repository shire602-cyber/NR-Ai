// Reports > payroll tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Money } from "@/components/ui/money";
import {
  formatReportDate,
  payrollAmount,
  payrollPeriodLabel,
  payrollStatusVariant,
} from "../shared";
import { useReportsPageContext } from "../context";

export default function PayrollTab() {
  const { payrollLoading, payrollReport, reportSectionClass } = useReportsPageContext();
  return (
    <>
      <div
        className={reportSectionClass(
          ["payroll-summary", "wps-sif-summary"],
          "grid grid-cols-1 gap-6 md:grid-cols-4"
        )}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.netPayroll" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {payrollLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-kpi">
                <Money amount={payrollReport.totalNet} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.payrollRuns" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {payrollLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-kpi">{payrollReport.runCount}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.needsApproval" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {payrollLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-kpi">{payrollReport.approvalQueueCount}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.needsSif" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {payrollLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-kpi">{payrollReport.wpsMissingCount}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={reportSectionClass(["payroll-summary"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.payrollSummary" />
              </CardTitle>
              <CardDescription>
                Pay-period totals, approval state, and WPS/SIF readiness.
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/payroll">
                <T k="reportCenter.openPayroll" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {payrollLoading ? (
            <Skeleton className="h-80" />
          ) : payrollReport.runCount ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                <div className="rounded-md border p-4">
                  <div className="mb-3">
                    <div className="font-medium">
                      <T k="reportCenter.payrollStatusMix" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.currentDateRangePayrollByWorkflowStatus" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    {payrollReport.statusRows.map((row) => (
                      <div
                        key={row.status}
                        className="flex items-center justify-between gap-4 text-sm"
                      >
                        <div>
                          <Badge variant={payrollStatusVariant(row.status)} dot>
                            {row.status}
                          </Badge>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.count} runs / {row.employeeCount} employees
                          </div>
                        </div>
                        <div className="text-end tabular-nums">
                          <Money amount={row.totalNet} currency={"AED"} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="max-h-[520px] overflow-auto rounded-md border">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="reportCenter.period" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.status" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.employees" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.basic" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.allowances" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.deductions" />
                        </TableHead>
                        <TableHead data-numeric>Net</TableHead>
                        <TableHead>SIF</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollReport.runs.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="font-medium">{payrollPeriodLabel(run)}</TableCell>
                          <TableCell>
                            <Badge variant={payrollStatusVariant(run.status)} dot>
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell data-numeric>{run.employee_count}</TableCell>
                          <TableCell data-numeric>
                            <Money amount={payrollAmount(run.total_basic)} currency={"AED"} />
                          </TableCell>
                          <TableCell data-numeric>
                            <Money amount={payrollAmount(run.total_allowances)} currency={"AED"} />
                          </TableCell>
                          <TableCell data-numeric>
                            <Money amount={payrollAmount(run.total_deductions)} currency={"AED"} />
                          </TableCell>
                          <TableCell data-numeric className=" font-medium">
                            <Money amount={payrollAmount(run.total_net)} currency={"AED"} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={run.sif_file_content ? "success" : "warning"} dot>
                              {run.sif_file_content ? "Generated" : "Needed"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noPayrollRunsFoundForThisPeriod" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={reportSectionClass(["wps-sif-summary"])}>
        <CardHeader>
          <CardTitle>WPS / SIF readiness</CardTitle>
          <CardDescription>
            <T k="reportCenter.payrollWpsHint" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.sifGenerated" />
              </div>
              <div className="font-mono text-2xl font-semibold">
                {payrollReport.sifGeneratedCount}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.wpsReady" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {payrollReport.wpsReadyCount}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.approvedRuns" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {payrollReport.approvedCount}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.latestPeriod" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {payrollPeriodLabel(payrollReport.latestRun)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatReportDate(payrollReport.latestRun?.approved_at)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
