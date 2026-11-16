// Reports > payroll tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardCheck, DollarSign, FileSpreadsheet, FileText } from "lucide-react";
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
import { formatCurrency } from "@/lib/format";
import {
  formatReportDate,
  payrollAmount,
  payrollPeriodLabel,
  payrollStatusVariant,
} from "../shared";
import { useReportsPageContext } from "../context";

export default function PayrollTab() {
  const { locale, payrollLoading, payrollReport, reportSectionClass } = useReportsPageContext();
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
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {payrollLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="font-mono text-2xl font-bold">
                {formatCurrency(payrollReport.totalNet, "AED", locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.payrollRuns" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {payrollLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="font-mono text-2xl font-bold">{payrollReport.runCount}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.needsApproval" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {payrollLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="font-mono text-2xl font-bold">{payrollReport.approvalQueueCount}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.needsSif" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {payrollLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="font-mono text-2xl font-bold">{payrollReport.wpsMissingCount}</div>
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
                        <div className="text-right font-mono">
                          {formatCurrency(row.totalNet, "AED", locale)}
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
                        <TableHead className="text-right">
                          <T k="reportCenter.employees" />
                        </TableHead>
                        <TableHead className="text-right">
                          <T k="reportCenter.basic" />
                        </TableHead>
                        <TableHead className="text-right">
                          <T k="reportCenter.allowances" />
                        </TableHead>
                        <TableHead className="text-right">
                          <T k="reportCenter.deductions" />
                        </TableHead>
                        <TableHead className="text-right">Net</TableHead>
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
                          <TableCell className="text-right font-mono">
                            {run.employee_count}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(payrollAmount(run.total_basic), "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(payrollAmount(run.total_allowances), "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(payrollAmount(run.total_deductions), "AED", locale)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(payrollAmount(run.total_net), "AED", locale)}
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
            Generated SIF files and approved payroll runs ready for UAE WPS processing.
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
              <div className="font-mono text-2xl font-semibold">{payrollReport.wpsReadyCount}</div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.approvedRuns" />
              </div>
              <div className="font-mono text-2xl font-semibold">{payrollReport.approvedCount}</div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.latestPeriod" />
              </div>
              <div className="font-mono text-2xl font-semibold">
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
