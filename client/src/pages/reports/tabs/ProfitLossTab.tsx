// Reports > pl tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingDown, TrendingUp } from "lucide-react";
import { ProfitLossSections, StatementDownloads } from "../StatementParts";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";
import { useReportsPageContext } from "../context";

export default function ProfitLossTab() {
  const { dateRange, locale, plLoading, profitLoss, selectedCompanyId, t } =
    useReportsPageContext();
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.totalRevenue" />
            </CardTitle>
            <div className="w-8 h-8 rounded-md bg-success-subtle flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-success " />
            </div>
          </CardHeader>
          <CardContent>
            {plLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold font-mono" data-testid="text-total-revenue">
                {formatCurrency(profitLoss?.totalRevenue || 0, "AED", locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.totalExpenses" />
            </CardTitle>
            <div className="w-8 h-8 rounded-md bg-danger-subtle flex items-center justify-center">
              <TrendingDown className="w-4 h-4 text-destructive " />
            </div>
          </CardHeader>
          <CardContent>
            {plLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold font-mono" data-testid="text-total-expenses">
                {formatCurrency(profitLoss?.totalExpenses || 0, "AED", locale)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.netProfit" />
            </CardTitle>
            <div className="w-8 h-8 rounded-md bg-info-subtle flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-info " />
            </div>
          </CardHeader>
          <CardContent>
            {plLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold font-mono" data-testid="text-net-profit">
                {formatCurrency(profitLoss?.netProfit || 0, "AED", locale)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{t.profitLoss}</CardTitle>
            <CardDescription>
              {dateRange.from && dateRange.to
                ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                : t["reportCenter.allTime"]}
            </CardDescription>
          </div>
          <StatementDownloads
            companyId={selectedCompanyId}
            kind="profit-loss"
            from={dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined}
            to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
          />
        </CardHeader>
        <CardContent>
          {plLoading ? (
            <Skeleton className="h-64" />
          ) : profitLoss?.sections ? (
            <ProfitLossSections report={profitLoss} />
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-3 text-success ">
                  <T k="reportCenter.revenue" />
                </h3>
                <Table>
                  <TableBody>
                    {profitLoss?.revenue?.map((item, index) => (
                      <TableRow key={item.accountCode || `revenue-${index}`}>
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
                        <T k="pages.totalRevenue" />
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(profitLoss?.totalRevenue || 0, "AED", locale)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="font-semibold mb-3 text-destructive ">
                  <T k="reportCenter.expenses" />
                </h3>
                <Table>
                  <TableBody>
                    {profitLoss?.expenses?.map((item, index) => (
                      <TableRow key={item.accountCode || `expense-${index}`}>
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
                        <T k="pages.totalExpenses" />
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(profitLoss?.totalExpenses || 0, "AED", locale)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="border-t-4 pt-4">
                <div className="flex justify-between items-center text-lg font-semibold">
                  <span>
                    <T k="reportCenter.netProfit" />
                  </span>
                  <span
                    className={`font-mono ${(profitLoss?.netProfit ?? 0) >= 0 ? "text-success " : "text-destructive "}`}
                  >
                    {formatCurrency(profitLoss?.netProfit ?? 0, "AED", locale)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
