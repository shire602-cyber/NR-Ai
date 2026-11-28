// Reports > pl tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingDown, TrendingUp } from "lucide-react";
import { ProfitLossSections, StatementDownloads } from "../StatementParts";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { useTranslation } from "@/lib/i18n";
import { formatDateRange } from "@/lib/format-date";
import { Money } from "@/components/ui/money";
import { useReportsPageContext } from "../context";
import { reportQueryState } from "../model/reportQueryState";
import { ReportBody } from "../ReportQueryNotice";

export default function ProfitLossTab() {
  const { dateRange, plFetchStatus, profitLoss, reportLoadErrors, selectedCompanyId, t } =
    useReportsPageContext();
  const { locale } = useTranslation();
  const state = reportQueryState(profitLoss, plFetchStatus, reportLoadErrors.pl?.error);
  // Totals come only from a response; every other state shows a skeleton or a dash.
  const kpi = (amount: number | undefined) =>
    state.view === "data" ? <Money amount={amount || 0} currency={"AED"} /> : "—";
  // SWEEP: Arabic statements showed English account names and dates.
  const accountLabel = (item: { accountName?: string | null; accountNameAr?: string | null }) =>
    (locale === "ar" && item.accountNameAr) || item.accountName || t["screens.unknownAccount"];
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
            {state.view === "loading" ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-kpi tabular-nums" data-testid="text-total-revenue">
                {kpi(profitLoss?.totalRevenue)}
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
            {state.view === "loading" ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-kpi tabular-nums" data-testid="text-total-expenses">
                {kpi(profitLoss?.totalExpenses)}
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
            {state.view === "loading" ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-kpi tabular-nums" data-testid="text-net-profit">
                {kpi(profitLoss?.netProfit)}
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
                ? formatDateRange(dateRange.from, dateRange.to, locale)
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
          <ReportBody
            state={state}
            error={reportLoadErrors.pl}
            testId="report-pl"
            skeletonClassName="h-64"
          >
            {profitLoss?.sections ? (
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
                          <TableCell className="tabular-nums text-xs text-muted-foreground">
                            {item.accountCode || "-"}
                          </TableCell>
                          <TableCell>{accountLabel(item)}</TableCell>
                          <TableCell data-numeric className=" font-medium">
                            <Money amount={item.amount ?? 0} currency={"AED"} />
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2">
                        <TableCell colSpan={2} className="font-semibold">
                          <T k="pages.totalRevenue" />
                        </TableCell>
                        <TableCell data-numeric className=" font-semibold">
                          <Money amount={profitLoss?.totalRevenue || 0} currency={"AED"} />
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
                          <TableCell className="tabular-nums text-xs text-muted-foreground">
                            {item.accountCode || "-"}
                          </TableCell>
                          <TableCell>{accountLabel(item)}</TableCell>
                          <TableCell data-numeric className=" font-medium">
                            <Money amount={item.amount ?? 0} currency={"AED"} />
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2">
                        <TableCell colSpan={2} className="font-semibold">
                          <T k="pages.totalExpenses" />
                        </TableCell>
                        <TableCell data-numeric className=" font-semibold">
                          <Money amount={profitLoss?.totalExpenses || 0} currency={"AED"} />
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
                      className={`tabular-nums ${(profitLoss?.netProfit ?? 0) >= 0 ? "text-success " : "text-destructive "}`}
                    >
                      <Money amount={profitLoss?.netProfit ?? 0} currency={"AED"} />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </ReportBody>
        </CardContent>
      </Card>
    </>
  );
}
