// Reports > trial tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { AlertTriangle, CheckCircle2, DollarSign, Scale } from "lucide-react";
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
import { formatCurrency } from "@/lib/format";
import { useReportsPageContext } from "../context";

export default function TrialBalanceTab() {
  const { dateRange, locale, t, trialBalance, trialBalanceLoading, trialBalanceSummary } =
    useReportsPageContext();
  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Debit / Credit Status</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              {trialBalanceSummary.isBalanced ? (
                <CheckCircle2 className="h-4 w-4 text-success " />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning " />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {trialBalanceLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-1">
                <div
                  className="font-mono text-2xl font-bold"
                  data-testid="text-trial-balance-difference"
                >
                  {formatCurrency(
                    trialBalance?.totals?.difference ?? 0,
                    trialBalance?.reportCurrency ?? "AED",
                    locale
                  )}
                </div>
                <Badge variant={trialBalanceSummary.isBalanced ? "success" : "warning"} dot>
                  {trialBalanceSummary.isBalanced ? "Balanced" : "Needs review"}
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
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <Scale className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {trialBalanceLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="font-mono text-2xl font-bold">
                {trialBalanceSummary.activeAccounts}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.fxAccounts" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {trialBalanceLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="font-mono text-2xl font-bold">
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
                  : "Posted account balances through today"}
              </CardDescription>
            </div>
            {!trialBalanceLoading && (
              <Badge variant={trialBalanceSummary.isBalanced ? "success" : "warning"} dot>
                {trialBalanceSummary.isBalanced ? "Ready for close" : "Difference flagged"}
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
                    <TableHead className="text-right">
                      <T k="reportCenter.debit" />
                    </TableHead>
                    <TableHead className="text-right">
                      <T k="reportCenter.credit" />
                    </TableHead>
                    <TableHead className="text-right">
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
                      <TableCell className="font-mono text-xs text-muted-foreground">
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
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.totalDebit ?? 0, trialBalance.reportCurrency, locale)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(row.totalCredit ?? 0, trialBalance.reportCurrency, locale)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(row.balance ?? 0, trialBalance.reportCurrency, locale)}
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
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(
                        trialBalance.totals?.sumDebits ?? 0,
                        trialBalance.reportCurrency ?? "AED",
                        locale
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(
                        trialBalance.totals?.sumCredits ?? 0,
                        trialBalance.reportCurrency ?? "AED",
                        locale
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatCurrency(
                        trialBalance.totals?.difference ?? 0,
                        trialBalance.reportCurrency ?? "AED",
                        locale
                      )}
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
