// Reports > tax tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { Badge } from "@/components/ui/badge";
import { BarChart3, ClipboardCheck, DollarSign, Scale } from "lucide-react";
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
import { formatCurrency } from "@/lib/format";
import { formatReportDate } from "../shared";
import { useReportsPageContext } from "../context";

export default function CorporateTaxTab() {
  const {
    corporateTaxBridgeRows,
    corporateTaxEstimate,
    corporateTaxLoading,
    corporateTaxPeriodLabel,
    corporateTaxStatus,
    locale,
  } = useReportsPageContext();
  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.taxPayable" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <Scale className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {corporateTaxLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div
                className="font-mono text-2xl font-bold"
                data-testid="text-corporate-tax-payable"
              >
                {formatCurrency(corporateTaxEstimate?.taxPayable ?? 0, "AED", locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.taxableIncome" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {corporateTaxLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="font-mono text-2xl font-bold">
                {formatCurrency(corporateTaxEstimate?.taxableIncome ?? 0, "AED", locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.aboveBand" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {corporateTaxLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="font-mono text-2xl font-bold">
                  {formatCurrency(corporateTaxEstimate?.taxableAmount ?? 0, "AED", locale)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {((corporateTaxEstimate?.taxRate ?? 0) * 100).toFixed(2)}% returned rate
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.postedJournals" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {corporateTaxLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="font-mono text-2xl font-bold">
                {corporateTaxEstimate?.journalEntriesProcessed ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.corporateTaxEstimate" />
              </CardTitle>
              <CardDescription>
                {corporateTaxEstimate
                  ? `${formatReportDate(corporateTaxEstimate.periodStart)} - ${formatReportDate(corporateTaxEstimate.periodEnd)}`
                  : corporateTaxPeriodLabel}
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/corporate-tax">
                <T k="reportCenter.openCorporateTax" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {corporateTaxLoading ? (
            <Skeleton className="h-80" />
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Badge variant={corporateTaxStatus.variant} dot>
                    {corporateTaxStatus.label}
                  </Badge>
                  <p className="mt-2 text-sm text-muted-foreground">{corporateTaxStatus.detail}</p>
                </div>
                <p className="max-w-md text-sm text-muted-foreground">
                  Estimate only. Open Corporate Tax to adjust the workpaper or save a draft; this
                  report does not submit to the FTA or post accounting entries.
                </p>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="reportCenter.bridge" />
                    </TableHead>
                    <TableHead className="text-right">
                      <T k="reportCenter.amount" />
                    </TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corporateTaxBridgeRows.map((row) => (
                    <TableRow key={row.metric}>
                      <TableCell className="font-medium">{row.metric}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.amount, "AED", locale)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.note}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
