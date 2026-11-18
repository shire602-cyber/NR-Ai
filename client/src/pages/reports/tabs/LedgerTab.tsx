// Reports > ledger tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { useTranslation } from "@/lib/i18n";
import { ArrowLeft, ArrowRight } from "lucide-react";
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
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { formatReportDate, ledgerDetailPageSize } from "../shared";
import { useReportsPageContext } from "../context";
import { StatementDownloads } from "../StatementParts";

export default function LedgerTab() {
  const { t } = useTranslation();
  const {
    accountActivity,
    dateRange,
    ledgerDetailCurrentPage,
    ledgerDetailPageCount,
    ledgerDetailPageLines,
    ledgerDetailStartIndex,
    ledgerLines,
    ledgerLoading,
    ledgerReport,
    ledgerSourceRows,
    locale,
    reportSectionClass,
    setLedgerDetailPage,
    selectedCompanyId,
  } = useReportsPageContext();
  return (
    <>
      <div
        className={reportSectionClass(
          ["general-ledger", "account-transactions"],
          "grid grid-cols-1 gap-6 md:grid-cols-4"
        )}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.postedEntries" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-kpi">{ledgerReport.entryCount}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Debit / credit difference</CardTitle>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-1">
                <div className="tabular-nums text-kpi">
                  <Money amount={ledgerReport.difference} currency={"AED"} />
                </div>
                <Badge variant={ledgerReport.difference < 0.005 ? "success" : "warning"} dot>
                  {ledgerReport.difference < 0.005 ? "Balanced" : t["reportCenter.needsReview"]}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.accountsTouched" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-kpi">{ledgerReport.accountCount}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.reviewQueue" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="space-y-1">
                <div className="tabular-nums text-kpi">{ledgerReport.reviewEntries}</div>
                <div className="text-xs text-muted-foreground">
                  {ledgerReport.foreignCurrencyLines} FX lines
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className={reportSectionClass(["account-transactions"])}>
          <CardHeader>
            <CardTitle>
              <T k="reportCenter.accountTransactions" />
            </CardTitle>
            <CardDescription>
              <T k="reportCenter.accountLevelDebitCreditAndActivityTotals" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <Skeleton className="h-64" />
            ) : accountActivity.length ? (
              <div className="max-h-[520px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.account" />
                      </TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.lines" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.debit" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.credit" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountActivity.map((row) => (
                      <TableRow key={row.accountId}>
                        <TableCell>
                          <div className="font-medium">{row.accountName}</div>
                          <div className="tabular-nums text-xs text-muted-foreground">
                            {row.accountCode || "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {row.accountType}
                          </Badge>
                        </TableCell>
                        <TableCell data-numeric>{row.lineCount}</TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.debit} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.credit} currency={"AED"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noPostedAccountActivityFoundForThis" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={reportSectionClass(["general-ledger"])}>
          <CardHeader>
            <CardTitle>
              <T k="reportCenter.sourceReview" />
            </CardTitle>
            <CardDescription>
              <T k="reportCenter.automationRoutingByJournalEntrySource" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <Skeleton className="h-64" />
            ) : ledgerSourceRows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="reportCenter.source" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.entries" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.lines" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.activity" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.status" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerSourceRows.map((row) => (
                    <TableRow key={row.source}>
                      <TableCell className="capitalize">{row.source}</TableCell>
                      <TableCell data-numeric>{row.entryCount}</TableCell>
                      <TableCell data-numeric>{row.lineCount}</TableCell>
                      <TableCell data-numeric>
                        <Money amount={row.amountAed} currency={"AED"} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Badge variant={row.needsReview ? "warning" : "success"} dot>
                          {row.needsReview ? "Review" : "Linked"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noJournalSourcesFoundForThisPeriod" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={reportSectionClass(["general-ledger"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.generalLedgerDetail" />
              </CardTitle>
              <CardDescription>
                {dateRange.from && dateRange.to
                  ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
                  : t["expensesTab.allPostedJournalEntryDates"]}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {ledgerLines.length} rows · page {ledgerDetailCurrentPage} of{" "}
                {ledgerDetailPageCount}
              </Badge>
              <StatementDownloads
                companyId={selectedCompanyId}
                kind="general-ledger"
                from={dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined}
                to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
              />
              <Button asChild size="sm" variant="outline">
                <Link href="/journal">
                  <T k="reportCenter.openJournal" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {ledgerLoading ? (
            <Skeleton className="h-96" />
          ) : ledgerLines.length ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                Showing rows {ledgerDetailStartIndex + 1}-
                {Math.min(ledgerDetailStartIndex + ledgerDetailPageSize, ledgerLines.length)} of{" "}
                {ledgerLines.length}. Excel and Google Sheets exports include every filtered ledger
                line.
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.entry" />
                      </TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>
                        <T k="reportCenter.account" />
                      </TableHead>
                      <TableHead>
                        <T k="reportCenter.source" />
                      </TableHead>
                      <TableHead>Memo</TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.debit" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.credit" />
                      </TableHead>
                      <TableHead>
                        <T k="reportCenter.flags" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerDetailPageLines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="tabular-nums font-medium">
                          {line.entryNumber}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatReportDate(line.date)}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{line.accountName}</div>
                          <div className="tabular-nums text-xs text-muted-foreground">
                            {line.accountCode || "-"}
                          </div>
                        </TableCell>
                        <TableCell className="capitalize">{line.source}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-muted-foreground">
                          {line.memo || "-"}
                        </TableCell>
                        <TableCell data-numeric>
                          {line.debit > 0 ? formatCurrency(line.debit, "AED", locale) : "-"}
                        </TableCell>
                        <TableCell data-numeric>
                          {line.credit > 0 ? formatCurrency(line.credit, "AED", locale) : "-"}
                        </TableCell>
                        <TableCell>
                          {line.hasForeignCurrency ? (
                            <Badge variant="info">FX</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Table is paginated for readability; exports are not truncated.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={ledgerDetailCurrentPage <= 1}
                    onClick={() => setLedgerDetailPage((page) => Math.max(1, page - 1))}
                  >
                    <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
                    <T k="reportCenter.previous" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={ledgerDetailCurrentPage >= ledgerDetailPageCount}
                    onClick={() =>
                      setLedgerDetailPage((page) => Math.min(ledgerDetailPageCount, page + 1))
                    }
                  >
                    Next
                    <ArrowRight className="ms-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noPostedJournalLinesFoundForThis" />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
