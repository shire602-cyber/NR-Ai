// Reports > expenses tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { useTranslation } from "@/lib/i18n";
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
import { expenseClaimAmount, expenseClaimStatusVariant, formatReportDate } from "../shared";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { useReportsPageContext } from "../context";

export default function ExpensesTab() {
  const { t } = useTranslation();
  const {
    dateRange,
    expenseClaimReport,
    expenseReport,
    expensesLoading,
    hasFocusedReportSelection,
    locale,
    reportSectionClass,
  } = useReportsPageContext();
  return (
    <>
      <div
        className={reportSectionClass(
          ["expenses-vendor", "expenses-category"],
          "rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground"
        )}
      >
        <span className="font-medium text-foreground">Source basis:</span> {expenseReport.basis}
      </div>
      <div
        className={reportSectionClass(
          ["expenses-vendor", "expenses-category", "expense-claims"],
          "grid grid-cols-1 gap-6 md:grid-cols-4"
        )}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.postedExpenses" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-kpi">
                <Money amount={expenseReport.totalAed} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.grossExpenseDebits" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-kpi">
                <Money amount={expenseReport.subtotalAed} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.receiptVatCaptured" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-kpi">
                <Money amount={expenseReport.vatAed} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.postingQueue" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="space-y-1">
                <div className="tabular-nums text-kpi">{expenseReport.unpostedReceipts}</div>
                <div className="text-xs text-muted-foreground">
                  {expenseReport.autoPostedReceipts} auto-posted
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className={reportSectionClass(["expenses-vendor"])}>
          <CardHeader>
            <CardTitle>
              <T k="reportCenter.expensesByVendor" />
            </CardTitle>
            <CardDescription>
              {t["expensesTab.postedExpenseAccountActivityGrouped"]}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-64" />
            ) : expenseReport.byVendor.length ? (
              <div className="max-h-[420px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.vendor" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.entries" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.lines" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.netExpense" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenseReport.byVendor.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell data-numeric>{row.entryCount}</TableCell>
                        <TableCell data-numeric className=" font-medium">
                          {row.lineCount}
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.netExpenseAed} currency={"AED"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noExpensesFoundForThisPeriod" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={reportSectionClass(["expenses-category"])}>
          <CardHeader>
            <CardTitle>
              <T k="reportCenter.expensesByCategory" />
            </CardTitle>
            <CardDescription>
              {t["expensesTab.postedExpenseAccountActivityGrouped2"]}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-64" />
            ) : expenseReport.byCategory.length ? (
              <div className="max-h-[420px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.category" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.lines" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.debit" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.credit" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.netExpense" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenseReport.byCategory.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell data-numeric>{row.lineCount}</TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.debitAed} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.creditAed} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric className=" font-medium">
                          <Money amount={row.netExpenseAed} currency={"AED"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noCategorizedExpensesFoundForThisPeriod" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={reportSectionClass(["expense-claims"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.expenseClaims" />
              </CardTitle>
              <CardDescription>
                <T k="reportCenter.claimStatusApprovalRoutingAndReimbursementQueue" />
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/expense-claims">
                <T k="reportCenter.openClaims" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {expensesLoading ? (
            <Skeleton className="h-80" />
          ) : expenseClaimReport.claimCount ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.claims" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {expenseClaimReport.claimCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.claimValue" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={expenseClaimReport.totalAmount} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.needsApproval" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {expenseClaimReport.submittedCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.approvedUnpaid" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {expenseClaimReport.approvedUnpaidCount}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                <div className="rounded-md border p-4">
                  <div className="mb-3">
                    <div className="font-medium">
                      <T k="reportCenter.claimStatusMix" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.currentDateRangeClaimsByWorkflowStatus" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    {expenseClaimReport.statusRows.map((row) => (
                      <div
                        key={row.status}
                        className="flex items-center justify-between gap-4 text-sm"
                      >
                        <div>
                          <Badge variant={expenseClaimStatusVariant(row.status)} dot>
                            {row.status}
                          </Badge>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.count} claims
                          </div>
                        </div>
                        <div className="text-end tabular-nums">
                          <Money amount={row.totalAmount} currency={"AED"} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="max-h-[420px] overflow-auto rounded-md border">
                  <Table className="min-w-[880px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="reportCenter.claim" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.status" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.created" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.submitted" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.amount" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenseClaimReport.claims.map((claim) => (
                        <TableRow key={claim.id}>
                          <TableCell>
                            <div className="font-medium">{claim.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {claim.claim_number}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={expenseClaimStatusVariant(claim.status)} dot>
                              {claim.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatReportDate(claim.created_at)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatReportDate(claim.submitted_at)}
                          </TableCell>
                          <TableCell data-numeric className=" font-medium">
                            <Money
                              amount={expenseClaimAmount(claim)}
                              currency={claim.currency || "AED"}
                            />
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
              <T k="reportCenter.noExpenseClaimsFoundForThisPeriod" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={cn(hasFocusedReportSelection && "hidden")}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.postingAutomation" />
              </CardTitle>
              <CardDescription>
                <T k="reportCenter.receiptsReadyForReviewPostingAndAutopilot" />
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/receipts">
                <T k="reportCenter.openReceipts" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.capturedReceipts" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {expenseReport.receiptCount}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.autoPosted" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {expenseReport.autoPostedReceipts}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.needsPosting" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {expenseReport.unpostedReceipts}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.claimsReview" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {expenseClaimReport.reviewCount}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className={reportSectionClass(["expenses-vendor", "expenses-category"])}>
        <CardHeader>
          <CardTitle>
            <T k="reportCenter.postedExpenseDetail" />
          </CardTitle>
          <CardDescription>
            {dateRange.from && dateRange.to
              ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
              : t["expensesTab.allPostedJournalEntryDates"]}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {expensesLoading ? (
            <Skeleton className="h-96" />
          ) : expenseReport.lines.length ? (
            <div className="max-h-[520px] overflow-auto rounded-md border">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="reportCenter.entry" />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>
                      <T k="reportCenter.vendor" />
                    </TableHead>
                    <TableHead>
                      <T k="reportCenter.expenseAccount" />
                    </TableHead>
                    <TableHead>
                      <T k="reportCenter.source" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.debit" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.credit" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.netExpense" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenseReport.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="tabular-nums font-medium">{line.entryNumber}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatReportDate(line.date)}
                      </TableCell>
                      <TableCell className="font-medium">{line.vendor}</TableCell>
                      <TableCell>
                        <div className="font-medium">{line.accountName}</div>
                        <div className="tabular-nums text-xs text-muted-foreground">
                          {line.accountCode || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{line.source}</TableCell>
                      <TableCell data-numeric>
                        {line.debitAed > 0 ? formatCurrency(line.debitAed, "AED", locale) : "-"}
                      </TableCell>
                      <TableCell data-numeric>
                        {line.creditAed > 0 ? formatCurrency(line.creditAed, "AED", locale) : "-"}
                      </TableCell>
                      <TableCell data-numeric className=" font-medium">
                        <Money amount={line.netExpenseAed} currency={"AED"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noPostedExpenseAccountJournalLinesFound" />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
