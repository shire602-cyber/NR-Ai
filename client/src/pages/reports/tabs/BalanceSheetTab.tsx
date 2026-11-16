// Reports > bs tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { BalanceCheck, StatementDownloads } from "../StatementParts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";
import { useReportsPageContext } from "../context";

export default function BalanceSheetTab() {
  const { balanceSheet, bsLoading, dateRange, locale, selectedCompanyId, t } =
    useReportsPageContext();
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{t.balanceSheet}</CardTitle>
            <CardDescription>
              {dateRange.from && dateRange.to
                ? `As of ${format(dateRange.to, "MMM dd, yyyy")}`
                : "Assets, liabilities, and equity as of today"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BalanceCheck
              isBalanced={balanceSheet?.isBalanced}
              difference={balanceSheet?.difference}
              testId="balance-sheet-balance-check"
            />
            <StatementDownloads
              companyId={selectedCompanyId}
              kind="balance-sheet"
              to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
            />
            <StatementDownloads
              companyId={selectedCompanyId}
              kind="changes-in-equity"
              from={dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined}
              to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
            />
          </div>
        </CardHeader>
        <CardContent>
          {bsLoading ? (
            <Skeleton className="h-96" />
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-3 text-info ">
                  <T k="reportCenter.assets" />
                </h3>
                <Table>
                  <TableBody>
                    {balanceSheet?.assets?.map((item, index) => (
                      <TableRow key={item.accountCode || `asset-${index}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {item.accountCode || "-"}
                        </TableCell>
                        <TableCell>{item.accountName || "Unknown Account"}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(item.amount ?? 0, "AED", locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell colSpan={2} className="font-semibold">
                        <T k="pages.totalAssets" />
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(balanceSheet?.totalAssets || 0, "AED", locale)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="font-semibold mb-3 text-destructive ">
                  <T k="reportCenter.liabilities" />
                </h3>
                <Table>
                  <TableBody>
                    {balanceSheet?.liabilities?.map((item, index) => (
                      <TableRow key={item.accountCode || `liability-${index}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {item.accountCode || "-"}
                        </TableCell>
                        <TableCell>{item.accountName || "Unknown Account"}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(item.amount ?? 0, "AED", locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell colSpan={2} className="font-semibold">
                        <T k="pages.totalLiabilities" />
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(balanceSheet?.totalLiabilities || 0, "AED", locale)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="font-semibold mb-3 text-chart-5 ">
                  <T k="reportCenter.equity" />
                </h3>
                <Table>
                  <TableBody>
                    {balanceSheet?.equity?.map((item, index) => (
                      <TableRow key={item.accountCode || `equity-${index}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {item.accountCode || "-"}
                        </TableCell>
                        <TableCell>{item.accountName || "Unknown Account"}</TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {formatCurrency(item.amount ?? 0, "AED", locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell colSpan={2} className="font-semibold">
                        <T k="pages.totalEquity" />
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(balanceSheet?.totalEquity || 0, "AED", locale)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
