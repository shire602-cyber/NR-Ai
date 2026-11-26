// Reports > bs tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { BalanceCheck, StatementDownloads } from "../StatementParts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { Money } from "@/components/ui/money";
import { useReportsPageContext } from "../context";

export default function BalanceSheetTab() {
  const { balanceSheet, bsLoading, bsReadState, dateRange, refetchBs, selectedCompanyId, t } =
    useReportsPageContext();
  const { locale } = useTranslation();
  // SWEEP: Arabic statements showed English account names and dates.
  const accountLabel = (item: { accountName?: string | null; accountNameAr?: string | null }) =>
    (locale === "ar" && item.accountNameAr) || item.accountName || t["screens.unknownAccount"];
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>{t.balanceSheet}</CardTitle>
            <CardDescription>
              {dateRange.from && dateRange.to
                ? formatMessage(t["reportCenter.tabs.asOf"], {
                    date: formatDate(dateRange.to, locale),
                  })
                : t["reportCenter.tabs.balanceSheetToday"]}
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
          {bsReadState === "error" ? (
            <ErrorState
              title={t["reportCenter.dataLoadError"]}
              onRetry={() => refetchBs()}
            />
          ) : bsLoading ? (
            <Skeleton className="h-96" />
          ) : (
            <div className="space-y-6">
              {bsReadState === "stale" && (
                <div
                  role="status"
                  className="rounded-md bg-warning-subtle p-3 text-small text-warning-subtle-foreground flex items-center justify-between gap-4"
                >
                  <span>{t["reportCenter.dataStale"]}</span>
                  <button
                    onClick={() => void refetchBs()}
                    className="shrink-0 text-sm font-medium underline underline-offset-2"
                  >
                    {t["reportCenter.retry"]}
                  </button>
                </div>
              )}
              {balanceSheet?.warnings?.some(
                (warning) => warning.code === "OVERDRAWN_CASH_ACCOUNTS"
              ) && (
                <p
                  role="status"
                  className="rounded-md bg-warning-subtle p-3 text-small text-warning-subtle-foreground"
                >
                  <T k="statements.overdrawnCashAccounts" />
                </p>
              )}
              <div>
                <h3 className="font-semibold mb-3 text-info ">
                  <T k="reportCenter.assets" />
                </h3>
                <Table>
                  <TableBody>
                    {balanceSheet?.assets?.map((item, index) => (
                      <TableRow key={item.accountCode || `asset-${index}`}>
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
                        <T k="pages.totalAssets" />
                      </TableCell>
                      <TableCell data-numeric className=" font-semibold">
                        <Money amount={balanceSheet?.totalAssets || 0} currency={"AED"} />
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
                        <T k="pages.totalLiabilities" />
                      </TableCell>
                      <TableCell data-numeric className=" font-semibold">
                        <Money amount={balanceSheet?.totalLiabilities || 0} currency={"AED"} />
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
                        <T k="pages.totalEquity" />
                      </TableCell>
                      <TableCell data-numeric className=" font-semibold">
                        <Money amount={balanceSheet?.totalEquity || 0} currency={"AED"} />
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
