// Reports > sales tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { AlertTriangle, BarChart3, FileText, TrendingDown } from "lucide-react";
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
import { amountInAed, formatReportDate, invoiceStatusLabel, invoiceStatusVariant } from "../shared";
import { evidenceSourceHref } from "@/lib/evidenceLinks";
import { format } from "date-fns";
import { Money } from "@/components/ui/money";
import { useReportsPageContext } from "../context";
import { StatementDownloads } from "../StatementParts";

export default function SalesTab() {
  const { t } = useTranslation();
  const {
    agingReportLoading,
    customerRevenue,
    dateRange,
    invoiceStatusReport,
    locale,
    overdueCustomerRows,
    productServiceSalesRows,
    productServiceTopShare,
    receivableAgingRows,
    receivableAgingSummary,
    reportInvoices,
    reportSectionClass,
    salesLoading,
    salesProductServiceLoading,
    statusSummary,
    selectedCompanyId,
  } = useReportsPageContext();
  return (
    <>
      <div
        className={reportSectionClass(
          ["ar-aging", "invoice-status", "revenue-customer", "sales-product-service"],
          "grid grid-cols-1 gap-6 md:grid-cols-4"
        )}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.invoiceValue" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">
                <Money amount={invoiceStatusReport.invoiceValueAed} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.activeInvoices" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">
                {invoiceStatusReport.activeInvoiceCount}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.unpaidInvoices" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <AlertTriangle className="h-4 w-4 text-warning " />
            </div>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">
                {invoiceStatusReport.unpaidCount}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.overdueOutstanding" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <TrendingDown className="h-4 w-4 text-destructive " />
            </div>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : invoiceStatusReport.overdueCurrency ? (
              <div className="tabular-nums text-2xl font-bold">
                <Money
                  amount={invoiceStatusReport.overdueOutstanding}
                  currency={invoiceStatusReport.overdueCurrency}
                />
              </div>
            ) : (
              <div className="text-sm font-medium">
                <T k="reportCenter.mixedCurrencies" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={reportSectionClass(["ar-aging"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>A/R Aging</CardTitle>
              <CardDescription>
                <T k="reportCenter.salesAgingHint" />
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatementDownloads
                companyId={selectedCompanyId}
                kind="ar-aging"
                from={dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined}
                to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
              />
              <Button asChild size="sm" variant="outline">
                <Link href="/payment-chasing">
                  <T k="reportCenter.openCollections" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {agingReportLoading ? (
            <Skeleton className="h-80" />
          ) : receivableAgingRows.length ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.current" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={receivableAgingSummary.current} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.overdue" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={receivableAgingSummary.overdue} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Over 90 days</div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={receivableAgingSummary.over90} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.totalReceivable" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={receivableAgingSummary.total} currency={"AED"} />
                  </div>
                </div>
              </div>

              <div className="max-h-[520px] overflow-auto rounded-md border">
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.customer" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.current" />
                      </TableHead>
                      <TableHead data-numeric>1-30</TableHead>
                      <TableHead data-numeric>31-60</TableHead>
                      <TableHead data-numeric>61-90</TableHead>
                      <TableHead data-numeric>90+</TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.total" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receivableAgingRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.current} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.days30} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.days60} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.days90} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.over90} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric className=" font-medium">
                          <Money amount={row.total} currency={"AED"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noOpenReceivablesFoundForAging" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={reportSectionClass(["sales-product-service"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Sales by product/service</CardTitle>
              <CardDescription>
                <T k="reportCenter.salesProductHint" />
              </CardDescription>
            </div>
            <Badge
              variant={productServiceTopShare >= 50 ? "warning" : "success"}
              dot={productServiceSalesRows.length > 0}
            >
              {productServiceSalesRows.length
                ? `${productServiceTopShare.toFixed(1)}% top share`
                : t["reportCenter.noLineItems"]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {salesProductServiceLoading ? (
            <Skeleton className="h-64" />
          ) : productServiceSalesRows.length ? (
            <div className="max-h-[460px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product / service</TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.invoices" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.quantity" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.sales" />
                    </TableHead>
                    <TableHead data-numeric>VAT</TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.avgUnit" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productServiceSalesRows.map((row) => (
                    <TableRow key={row.productService}>
                      <TableCell>
                        <div className="font-medium">{row.productService}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.lineCount} lines - {row.supplyTypes.join(", ")}
                        </div>
                      </TableCell>
                      <TableCell data-numeric>{row.invoiceCount}</TableCell>
                      <TableCell data-numeric>
                        {row.quantity.toLocaleString(locale, { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell data-numeric className=" font-medium">
                        <Money amount={row.amountAed} currency={"AED"} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={row.vatAed} currency={"AED"} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={row.averageUnitPriceAed} currency={"AED"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noInvoiceLineItemSalesFoundFor" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className={reportSectionClass(["invoice-status"])}>
          <CardHeader>
            <CardTitle>
              <T k="reportCenter.invoiceStatus" />
            </CardTitle>
            <CardDescription>
              <T k="reportCenter.statusMixAndAedEquivalentInvoiceValue" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-64" />
            ) : statusSummary.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="reportCenter.status" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.invoices" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.value" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statusSummary.map((row) => (
                    <TableRow key={row.status}>
                      <TableCell>
                        <Badge variant={invoiceStatusVariant(row.status)} dot>
                          {invoiceStatusLabel(row.status)}
                        </Badge>
                      </TableCell>
                      <TableCell data-numeric>{row.count}</TableCell>
                      <TableCell data-numeric className=" font-medium">
                        <Money amount={row.amountAed} currency={"AED"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noInvoicesFoundForThisPeriod" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={reportSectionClass(["revenue-customer"])}>
          <CardHeader>
            <CardTitle>
              <T k="reportCenter.revenueByCustomer" />
            </CardTitle>
            <CardDescription>
              <T k="reportCenter.issuedInvoiceValueByCustomerShownIn" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-64" />
            ) : customerRevenue.length ? (
              <div className="max-h-[420px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.customer" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.invoices" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.value" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerRevenue.map((row) => (
                      <TableRow key={row.customerName}>
                        <TableCell className="font-medium">{row.customerName}</TableCell>
                        <TableCell data-numeric>{row.invoiceCount}</TableCell>
                        <TableCell data-numeric className=" font-medium">
                          <Money amount={row.amountAed} currency={"AED"} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noIssuedCustomerRevenueFoundForThis" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={reportSectionClass(["invoice-status"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.reminderRouting" />
              </CardTitle>
              <CardDescription>
                <T k="reportCenter.overdueCustomerBalancesGroupedByRecommendedChase" />
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/payment-chasing">
                <T k="reportCenter.openChasingQueue" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {salesLoading ? (
            <Skeleton className="h-64" />
          ) : overdueCustomerRows.length ? (
            <div className="max-h-[420px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="reportCenter.customer" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.invoices" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.outstanding" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.oldest" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.nextLevel" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueCustomerRows.map((row) => (
                    <TableRow key={`${row.customerName}-${row.currency}`}>
                      <TableCell className="font-medium">{row.customerName}</TableCell>
                      <TableCell data-numeric>{row.invoiceCount}</TableCell>
                      <TableCell data-numeric className=" font-medium">
                        <Money amount={row.outstanding} currency={row.currency} />
                      </TableCell>
                      <TableCell data-numeric>{row.maxDaysOverdue} days</TableCell>
                      <TableCell data-numeric>
                        <Badge variant="warning">Level {row.recommendedLevel}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noOverdueInvoicesInTheReminderQueue" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={reportSectionClass(["invoice-status"])}>
        <CardHeader>
          <CardTitle>
            <T k="reportCenter.invoiceDetail" />
          </CardTitle>
          <CardDescription>
            {dateRange.from && dateRange.to
              ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
              : t["reportCenter.allInvoiceDates"]}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {salesLoading ? (
            <Skeleton className="h-96" />
          ) : reportInvoices.length ? (
            <div className="max-h-[520px] overflow-auto rounded-md border">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="reportCenter.invoice" />
                    </TableHead>
                    <TableHead>
                      <T k="reportCenter.customer" />
                    </TableHead>
                    <TableHead>
                      <T k="reportCenter.issueDate" />
                    </TableHead>
                    <TableHead>
                      <T k="reportCenter.dueDate" />
                    </TableHead>
                    <TableHead>
                      <T k="reportCenter.status" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.amount" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.aedValue" />
                    </TableHead>
                    <TableHead data-numeric>
                      <T k="reportCenter.proof" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="tabular-nums font-medium">{invoice.number}</TableCell>
                      <TableCell>{invoice.customerName || "Unknown Customer"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatReportDate(invoice.date)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatReportDate(invoice.dueDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={invoiceStatusVariant(invoice.status)} dot>
                          {invoiceStatusLabel(invoice.status)}
                        </Badge>
                      </TableCell>
                      <TableCell data-numeric>
                        <Money amount={invoice.total ?? 0} currency={invoice.currency || "AED"} />
                      </TableCell>
                      <TableCell data-numeric className=" font-medium">
                        <Money amount={amountInAed(invoice)} currency={"AED"} />
                      </TableCell>
                      <TableCell data-numeric>
                        <Button asChild size="sm" variant="outline">
                          <Link href={evidenceSourceHref("invoice", invoice.id)}>
                            <T k="reportCenter.proof" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noInvoicesFoundForThisPeriod" />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
