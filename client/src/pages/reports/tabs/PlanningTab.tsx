// Reports > planning tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { AlertTriangle, BarChart3, CheckCircle2, FileSpreadsheet, TrendingUp } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useReportsPageContext } from "../context";

export default function PlanningTab() {
  const { hasFocusedReportSelection, locale, planningLoading, planningReport, reportSectionClass } =
    useReportsPageContext();
  return (
    <>
      <div
        className={reportSectionClass(
          ["budget-actual", "cash-flow-forecast"],
          "grid grid-cols-1 gap-6 md:grid-cols-4"
        )}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.budget" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {planningLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="font-mono text-2xl font-bold">
                {formatCurrency(planningReport.budgetTotal, "AED", locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.actual" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {planningLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="font-mono text-2xl font-bold">
                {formatCurrency(planningReport.actualTotal, "AED", locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.variance" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              {planningReport.variance >= 0 ? (
                <CheckCircle2 className="h-4 w-4 text-success " />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning " />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {planningLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-1">
                <div className="font-mono text-2xl font-bold">
                  {formatCurrency(planningReport.variance, "AED", locale)}
                </div>
                <Badge variant={planningReport.variance >= 0 ? "success" : "warning"} dot>
                  {planningReport.variance >= 0 ? "Under budget" : "Over budget"}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.projectedCash" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {planningLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-1">
                <div className="font-mono text-2xl font-bold">
                  {formatCurrency(planningReport.projectedEndingBalance, "AED", locale)}
                </div>
                <Badge
                  variant={
                    planningReport.cashWarning === "On track"
                      ? "success"
                      : planningReport.cashWarning === "Low cash warning"
                        ? "warning"
                        : "danger"
                  }
                  dot
                >
                  {planningReport.cashWarning}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className={reportSectionClass(["budget-actual"])}>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>
                  <T k="reportCenter.budgetVsActual" />
                </CardTitle>
                <CardDescription>
                  {planningReport.budget
                    ? `${planningReport.budget.name} (${planningReport.budget.fiscalYear})`
                    : "Create a budget to compare actuals."}
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/budgets">
                  <T k="reportCenter.openBudgets" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {planningLoading ? (
              <Skeleton className="h-64" />
            ) : planningReport.largestVarianceLines.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="reportCenter.category" />
                    </TableHead>
                    <TableHead className="text-right">
                      <T k="reportCenter.budget" />
                    </TableHead>
                    <TableHead className="text-right">
                      <T k="reportCenter.actual" />
                    </TableHead>
                    <TableHead className="text-right">
                      <T k="reportCenter.variance" />
                    </TableHead>
                    <TableHead className="text-right">
                      <T k="reportCenter.status" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planningReport.largestVarianceLines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.category}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(line.totals.budget, "AED", locale)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(line.totals.actual, "AED", locale)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(line.totals.variance, "AED", locale)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={line.totals.variance >= 0 ? "success" : "warning"} dot>
                          {line.totals.variance >= 0 ? "Under" : "Over"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noBudgetVarianceDataAvailable" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={reportSectionClass(["cash-flow-forecast"])}>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>
                  <T k="reportCenter.cashFlowForecast" />
                </CardTitle>
                <CardDescription>90-day projected inflows, outflows, and balance.</CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/cashflow-forecast">
                  <T k="reportCenter.openForecast" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {planningLoading ? (
              <Skeleton className="h-64" />
            ) : planningReport.projections.length ? (
              <div className="max-h-[520px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week</TableHead>
                      <TableHead>
                        <T k="reportCenter.period" />
                      </TableHead>
                      <TableHead className="text-right">In</TableHead>
                      <TableHead className="text-right">Out</TableHead>
                      <TableHead className="text-right">
                        <T k="reportCenter.balance" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {planningReport.projections.map((row) => (
                      <TableRow key={row.week}>
                        <TableCell className="font-medium">Week {row.week}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.weekStart} - {row.weekEnd}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.expectedInflows, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(row.expectedOutflows, "AED", locale)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(row.projectedBalance, "AED", locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noCashFlowProjectionDataAvailable" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={cn(hasFocusedReportSelection && "hidden")}>
        <CardHeader>
          <CardTitle>
            <T k="reportCenter.planningAutomation" />
          </CardTitle>
          <CardDescription>
            <T k="reportCenter.signalsThatShouldDriveAlertsAndFollow" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.overBudgetLines" />
              </div>
              <div className="font-mono text-2xl font-semibold">
                {planningReport.overBudgetLines}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.cashMovement" />
              </div>
              <div className="font-mono text-2xl font-semibold">
                {formatCurrency(planningReport.cashMovement, "AED", locale)}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.forecastInsights" />
              </div>
              <div className="font-mono text-2xl font-semibold">
                {planningReport.insights.length}
              </div>
            </div>
          </div>
          {planningReport.insights.length > 0 && (
            <div className="mt-4 space-y-2">
              {planningReport.insights.slice(0, 3).map((insight) => (
                <div key={insight} className="rounded-md border p-3 text-sm">
                  {insight}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
