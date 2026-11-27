// Reports > tax tab.
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
import { formatMessage } from "@/lib/i18n";
import { reportDateRange } from "../shared";
import { useReportsPageContext } from "../context";
import { SecondaryQueryError } from "../ReportQueryNotice";

export default function CorporateTaxTab() {
  const {
    corporateTaxBridgeRows,
    corporateTaxEstimate,
    corporateTaxLoading,
    corporateTaxPeriodLabel,
    corporateTaxStatus,
    secondaryLoadErrors,
    t,
  } = useReportsPageContext();
  return (
    <>
      <SecondaryQueryError error={secondaryLoadErrors.corporateTaxEstimate} testId="corporate-tax-tab-estimate-error" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.taxPayable" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {corporateTaxLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-kpi" data-testid="text-corporate-tax-payable">
                <Money amount={corporateTaxEstimate?.taxPayable ?? 0} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.taxableIncome" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {corporateTaxLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-kpi">
                <Money amount={corporateTaxEstimate?.taxableIncome ?? 0} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.aboveBand" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {corporateTaxLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="tabular-nums text-kpi">
                  <Money amount={corporateTaxEstimate?.taxableAmount ?? 0} currency={"AED"} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatMessage(t["reportCenter.text.ctRate"], {
                    rate: ((corporateTaxEstimate?.taxRate ?? 0) * 100).toFixed(2),
                  })}
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
          </CardHeader>
          <CardContent>
            {corporateTaxLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-kpi">
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
                  ? reportDateRange(
                      corporateTaxEstimate.periodStart,
                      corporateTaxEstimate.periodEnd
                    )
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
                  {t["reportCenter.text.ctNote"]}
                </p>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="reportCenter.bridge" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.amount" />
                    </TableHead>
                    <TableHead>
                      <T k="reportCenter.tabs.note" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corporateTaxBridgeRows.map((row) => (
                    <TableRow key={row.metric}>
                      <TableCell className="font-medium">{row.metric}</TableCell>
                      <TableCell data-numeric>
                        <Money amount={row.amount} currency={"AED"} />
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
