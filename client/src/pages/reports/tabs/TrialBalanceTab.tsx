// Reports > trial tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { format } from "date-fns";
import { Money } from "@/components/ui/money";
import { useReportsPageContext } from "../context";

export default function TrialBalanceTab() {
  const { dateRange, t, trialBalance, trialBalanceLoading, trialBalanceSummary } =
    useReportsPageContext();
  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Debit / credit status</CardTitle>
          </CardHeader>
          <CardContent>
            {trialBalanceLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-1">
                <div className="tabular-nums text-kpi" data-testid="text-trial-balance-difference">
                  <Money
                    amount={trialBalance?.totals?.difference ?? 0}
                    currency={trialBalance?.reportCurrency ?? "AED"}
                  />
                </div>
                <Badge variant={trialBalanceSummary.isBalanced ? "success" : "warning"} dot>
                  {trialBalanceSummary.isBalanced
                    ? t["consolidation.balanced"]
                    : t["reportCenter.needsReview"]}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.activeAccounts" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trialBalanceLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="tabular-nums text-kpi">{trialBalanceSummary.activeAccounts}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.fxAccounts" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trialBalanceLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="tabular-nums text-kpi">
                {trialBalanceSummary.foreignCurrencyAccounts}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{t.trialBalance}</CardTitle>
              <CardDescription>
                {dateRange.from && dateRange.to
                  ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                  : t["reportCenter.trialBalanceThroughToday"]}
              </CardDescription>
            </div>
            {!trialBalanceLoading && (
              <Badge variant={trialBalanceSummary.isBalanced ? "success" : "warning"} dot>
                {trialBalanceSummary.isBalanced
                  ? t["reportCenter.readyForClose"]
                  : t["reportCenter.differenceFlagged"]}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {trialBalanceLoading ? (
            <Skeleton className="h-96" />
          ) : trialBalance?.rows?.length ? (
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>
                      <T k="reportCenter.account" />
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.debit" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.credit" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.balance" />
                    </TableHead>
                    <TableHead>
                      <T k="reportCenter.flags" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trialBalance.rows.map((row) => (
                    <TableRow key={row.accountId}>
                      <TableCell className="tabular-nums text-xs text-muted-foreground">
                        {row.accountCode || "-"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.accountName || "Unknown Account"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {row.accountType}
                        </Badge>
                      </TableCell>
                      <TableCell data-numeric>
                        <Money
                          amount={row.totalDebit ?? 0}
                          currency={trialBalance.reportCurrency}
                        />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money
                          amount={row.totalCredit ?? 0}
                          currency={trialBalance.reportCurrency}
                        />
                      </TableCell>
                      <TableCell data-numeric className=" font-medium">
                        <Money amount={row.balance ?? 0} currency={trialBalance.reportCurrency} />
                      </TableCell>
                      <TableCell>
                        {row.hasForeignLines ? (
                          <Badge variant="info">FX</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell colSpan={3} className="font-semibold">
                      <T k="reportCenter.totals" />
                    </TableCell>
                    <TableCell data-numeric className=" font-semibold">
                      <Money
                        amount={trialBalance.totals?.sumDebits ?? 0}
                        currency={trialBalance.reportCurrency ?? "AED"}
                      />
                    </TableCell>
                    <TableCell data-numeric className=" font-semibold">
                      <Money
                        amount={trialBalance.totals?.sumCredits ?? 0}
                        currency={trialBalance.reportCurrency ?? "AED"}
                      />
                    </TableCell>
                    <TableCell data-numeric className=" font-semibold">
                      <Money
                        amount={trialBalance.totals?.difference ?? 0}
                        currency={trialBalance.reportCurrency ?? "AED"}
                      />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noPostedAccountsFoundForThisPeriod" />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
