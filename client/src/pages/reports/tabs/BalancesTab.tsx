// Reports > balances tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { useTranslation } from "@/lib/i18n";
import { AlertTriangle, Scale, TrendingDown, TrendingUp } from "lucide-react";
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
import {
  depreciationStatusVariant,
  fixedAssetStatusVariant,
  formatReportDate,
  inventoryMovementVariant,
} from "../shared";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format";
import { Money } from "@/components/ui/money";
import { useReportsPageContext } from "../context";
import { StatementDownloads } from "../StatementParts";

export default function BalancesTab() {
  const { t } = useTranslation();
  const {
    balanceReport,
    balancesLoading,
    billAgingLoading,
    depreciationPeriodDate,
    depreciationScheduleReport,
    fixedAssetRegisterReport,
    hasFocusedReportSelection,
    inventoryMovementReport,
    inventoryValuationReport,
    locale,
    payableAgingBuckets,
    payableAgingSummary,
    reportSectionClass,
    dateRange,
    selectedCompanyId,
  } = useReportsPageContext();
  return (
    <>
      <div
        className={reportSectionClass(
          [
            "customer-balances",
            "ap-aging",
            "vendor-balances",
            "inventory-valuation",
            "inventory-movement",
            "depreciation-schedule",
            "fixed-asset-register",
          ],
          "grid grid-cols-1 gap-6 md:grid-cols-4"
        )}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.customerOpenBalance" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <TrendingUp className="h-4 w-4 text-success " />
            </div>
          </CardHeader>
          <CardContent>
            {balancesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">
                <Money amount={balanceReport.customerOpenAed} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.customerOverdue" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <AlertTriangle className="h-4 w-4 text-warning " />
            </div>
          </CardHeader>
          <CardContent>
            {balancesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-1">
                <div className="tabular-nums text-2xl font-bold">
                  <Money amount={balanceReport.customerOverdueAed} currency={"AED"} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {balanceReport.overdueCustomerCount} customers
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.vendorOpenBalance" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <TrendingDown className="h-4 w-4 text-destructive " />
            </div>
          </CardHeader>
          <CardContent>
            {balancesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">
                <Money amount={balanceReport.vendorOpenAed} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              <T k="reportCenter.netArLessAp" />
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
              <Scale className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {balancesLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="tabular-nums text-2xl font-bold">
                <Money amount={balanceReport.netBalanceAed} currency={"AED"} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={reportSectionClass(["ap-aging"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>A/P Aging</CardTitle>
              <CardDescription>{t["balancesTab.openVendorBillsAgedFrom"]}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatementDownloads
                companyId={selectedCompanyId}
                kind="ap-aging"
                from={dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined}
                to={dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined}
              />
              <Button asChild size="sm" variant="outline">
                <Link href="/bill-pay?tab=summary">
                  <T k="reportCenter.openBillPay" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {billAgingLoading || balancesLoading ? (
            <Skeleton className="h-80" />
          ) : payableAgingSummary.total > 0 || balanceReport.vendors.length ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.current" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={payableAgingSummary.current} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.overdue" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={payableAgingSummary.overdue} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">Over 90 days</div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={payableAgingSummary.over90} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.openBills" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {payableAgingSummary.billCount.toLocaleString(locale)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                <div className="rounded-md border p-4">
                  <div className="mb-3">
                    <div className="font-medium">
                      <T k="reportCenter.agingBuckets" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.billCountAndOpenAedBalanceBy" />
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="reportCenter.bucket" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.bills" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.amount" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payableAgingBuckets.map((bucket) => (
                        <TableRow key={bucket.label}>
                          <TableCell className="font-medium">{bucket.label}</TableCell>
                          <TableCell data-numeric>{bucket.count.toLocaleString(locale)}</TableCell>
                          <TableCell data-numeric className=" font-medium">
                            <Money amount={bucket.amount} currency={"AED"} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="max-h-[520px] overflow-auto rounded-md border">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="reportCenter.vendor" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.bills" />
                        </TableHead>
                        <TableHead data-numeric>Open</TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.overdue" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.oldest" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balanceReport.vendors.map((row) => (
                        <TableRow key={`${row.name}-${row.currency}`}>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            <Badge
                              className="mt-1"
                              variant={row.overdueBalanceAed > 0 ? "warning" : "success"}
                              dot
                            >
                              {row.overdueBalanceAed > 0 ? t["balancesTab.payQueue"] : "Current"}
                            </Badge>
                          </TableCell>
                          <TableCell data-numeric>{row.billCount}</TableCell>
                          <TableCell data-numeric>
                            <div className="tabular-nums font-medium">
                              <Money amount={row.openBalance} currency={row.currency} />
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <Money amount={row.openBalanceAed} currency={"AED"} />
                            </div>
                          </TableCell>
                          <TableCell data-numeric>
                            <div className="tabular-nums font-medium">
                              <Money amount={row.overdueBalance} currency={row.currency} />
                            </div>
                            <div className="text-xs text-muted-foreground">
                              <Money amount={row.overdueBalanceAed} currency={"AED"} />
                            </div>
                          </TableCell>
                          <TableCell data-numeric>{row.maxDaysOverdue} days</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noOpenPayablesFoundForAging" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className={reportSectionClass(["customer-balances"])}>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>
                  <T k="reportCenter.customerBalanceSummary" />
                </CardTitle>
                <CardDescription>
                  {t["balancesTab.currentOpenReceivablesFromIssued"]}
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/payment-chasing">
                  <T k="reportCenter.openCollections" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {balancesLoading ? (
              <Skeleton className="h-72" />
            ) : balanceReport.customers.length ? (
              <div className="max-h-[460px] overflow-auto rounded-md border">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.customer" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.invoices" />
                      </TableHead>
                      <TableHead data-numeric>Open</TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.overdue" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.oldest" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balanceReport.customers.map((row) => (
                      <TableRow key={`${row.name}-${row.currency}`}>
                        <TableCell>
                          <div className="font-medium">{row.name}</div>
                          <Badge
                            className="mt-1"
                            variant={row.overdueBalanceAed > 0 ? "warning" : "success"}
                            dot
                          >
                            {row.overdueBalanceAed > 0 ? "Collections" : "Current"}
                          </Badge>
                        </TableCell>
                        <TableCell data-numeric>{row.invoiceCount}</TableCell>
                        <TableCell data-numeric>
                          <div className="tabular-nums font-medium">
                            <Money amount={row.openBalance} currency={row.currency} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <Money amount={row.openBalanceAed} currency={"AED"} />
                          </div>
                        </TableCell>
                        <TableCell data-numeric>
                          <div className="tabular-nums font-medium">
                            <Money amount={row.overdueBalance} currency={row.currency} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <Money amount={row.overdueBalanceAed} currency={"AED"} />
                          </div>
                        </TableCell>
                        <TableCell data-numeric>{row.maxDaysOverdue} days</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noOpenCustomerBalances" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={reportSectionClass(["vendor-balances"])}>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>
                  <T k="reportCenter.vendorBalanceSummary" />
                </CardTitle>
                <CardDescription>{t["balancesTab.currentOpenPayablesFromVendor"]}</CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/bill-pay?tab=summary">
                  <T k="reportCenter.openBillPay" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {balancesLoading ? (
              <Skeleton className="h-72" />
            ) : balanceReport.vendors.length ? (
              <div className="max-h-[460px] overflow-auto rounded-md border">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.vendor" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.bills" />
                      </TableHead>
                      <TableHead data-numeric>Open</TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.overdue" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.oldest" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balanceReport.vendors.map((row) => (
                      <TableRow key={`${row.name}-${row.currency}`}>
                        <TableCell>
                          <div className="font-medium">{row.name}</div>
                          <Badge
                            className="mt-1"
                            variant={row.overdueBalanceAed > 0 ? "warning" : "success"}
                            dot
                          >
                            {row.overdueBalanceAed > 0 ? t["balancesTab.payQueue"] : "Current"}
                          </Badge>
                        </TableCell>
                        <TableCell data-numeric>{row.billCount}</TableCell>
                        <TableCell data-numeric>
                          <div className="tabular-nums font-medium">
                            <Money amount={row.openBalance} currency={row.currency} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <Money amount={row.openBalanceAed} currency={"AED"} />
                          </div>
                        </TableCell>
                        <TableCell data-numeric>
                          <div className="tabular-nums font-medium">
                            <Money amount={row.overdueBalance} currency={row.currency} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <Money amount={row.overdueBalanceAed} currency={"AED"} />
                          </div>
                        </TableCell>
                        <TableCell data-numeric>{row.maxDaysOverdue} days</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <T k="reportCenter.noOpenVendorBalances" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={reportSectionClass(["inventory-valuation"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.inventoryValuation" />
              </CardTitle>
              <CardDescription>{t["balancesTab.stockQuantityCostValueReorder"]}</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/inventory">
                <T k="reportCenter.openInventory" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {balancesLoading ? (
            <Skeleton className="h-80" />
          ) : inventoryValuationReport.rows.length ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.activeProducts" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {inventoryValuationReport.activeProductCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.stockValue" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={inventoryValuationReport.totalStockValueAed} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.lowStock" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {inventoryValuationReport.lowStockCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.costingReview" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {inventoryValuationReport.missingCostCount}
                  </div>
                </div>
              </div>

              <div className="max-h-[520px] overflow-auto rounded-md border">
                <Table className="min-w-[940px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.product" />
                      </TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>
                        <T k="reportCenter.status" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.stock" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.unitCost" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.value" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.movements" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventoryValuationReport.rows.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="font-medium">{product.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {product.sku || "No SKU"}
                          </div>
                        </TableCell>
                        <TableCell>{product.unit}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              product.isNegativeStock || product.isMissingCost
                                ? "warning"
                                : product.isLowStock
                                  ? "info"
                                  : product.isActive
                                    ? "success"
                                    : "neutral"
                            }
                            dot
                          >
                            {product.isNegativeStock
                              ? t["balancesTab.negativeStock"]
                              : product.isMissingCost
                                ? t["balancesTab.missingCost"]
                                : product.isLowStock
                                  ? t["reportCenter.lowStock"]
                                  : product.isActive
                                    ? "Valued"
                                    : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell data-numeric>
                          {product.currentStock.toLocaleString(locale)}
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={product.unitCost} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric className=" font-medium">
                          <Money amount={product.stockValueAed} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>{product.movementCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noInventoryProductsFoundYet" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={reportSectionClass(["inventory-movement"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.inventoryMovement" />
              </CardTitle>
              <CardDescription>{t["balancesTab.stockReceiptsSalesReturnsAnd"]}</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/inventory">
                <T k="reportCenter.openMovements" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {balancesLoading ? (
            <Skeleton className="h-80" />
          ) : inventoryMovementReport.movementCount ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.movements" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {inventoryMovementReport.movementCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.inboundUnits" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {inventoryMovementReport.inboundUnits.toLocaleString(locale)}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.outboundUnits" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {inventoryMovementReport.outboundUnits.toLocaleString(locale)}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.movementValue" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money
                      amount={inventoryMovementReport.totalMovementValueAed}
                      currency={"AED"}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.75fr_1.25fr]">
                <div className="rounded-md border p-4">
                  <div className="mb-3">
                    <div className="font-medium">
                      <T k="reportCenter.movementTypeMix" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.quantityAndValueByMovementType" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    {inventoryMovementReport.typeRows.map((row) => (
                      <div
                        key={row.type}
                        className="flex items-center justify-between gap-4 text-sm"
                      >
                        <div>
                          <Badge variant={inventoryMovementVariant(row.type)} dot>
                            {row.type}
                          </Badge>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.count} movements / {row.quantity.toLocaleString(locale)} units
                          </div>
                        </div>
                        <div className="text-end tabular-nums">
                          <Money amount={row.valueAed} currency={"AED"} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="max-h-[520px] overflow-auto rounded-md border">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>
                          <T k="reportCenter.product" />
                        </TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.quantity" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.unitCost" />
                        </TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.value" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.reference" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventoryMovementReport.rows.map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatReportDate(movement.createdAt)}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{movement.productName}</div>
                            <div className="text-xs text-muted-foreground">
                              {movement.sku || movement.unit || "No SKU"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={inventoryMovementVariant(movement.type)} dot>
                              {movement.type}
                            </Badge>
                          </TableCell>
                          <TableCell data-numeric>
                            {movement.type === "sale" ? "-" : "+"}
                            {Math.abs(movement.quantity).toLocaleString(locale)}
                          </TableCell>
                          <TableCell data-numeric>
                            {movement.unitCost
                              ? formatCurrency(movement.unitCost, "AED", locale)
                              : "-"}
                          </TableCell>
                          <TableCell data-numeric className=" font-medium">
                            <Money amount={movement.valueAed} currency={"AED"} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {movement.reference || "-"}
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
              <T k="reportCenter.noInventoryMovementsFoundForThisPeriod" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={reportSectionClass(["depreciation-schedule"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.depreciationSchedule" />
              </CardTitle>
              <CardDescription>
                Estimated depreciation for {format(depreciationPeriodDate, "MMMM yyyy")} from the
                fixed asset register.
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/fixed-assets">
                <T k="reportCenter.openFixedAssets" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {balancesLoading ? (
            <Skeleton className="h-80" />
          ) : depreciationScheduleReport.rows.length ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.periodDepreciation" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money
                      amount={depreciationScheduleReport.periodDepreciationAed}
                      currency={"AED"}
                    />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.annualRunRate" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money
                      amount={depreciationScheduleReport.annualDepreciationAed}
                      currency={"AED"}
                    />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.readyToPost" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {depreciationScheduleReport.readyToPostCount}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.setupReview" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {depreciationScheduleReport.reviewCount}
                  </div>
                </div>
              </div>

              <div className="max-h-[520px] overflow-auto rounded-md border">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <T k="reportCenter.asset" />
                      </TableHead>
                      <TableHead>
                        <T k="reportCenter.method" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.remaining" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.monthlyDepreciation" />
                      </TableHead>
                      <TableHead data-numeric>
                        <T k="reportCenter.projectedNbv" />
                      </TableHead>
                      <TableHead>
                        <T k="reportCenter.status" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {depreciationScheduleReport.rows.map((row) => (
                      <TableRow key={row.assetId}>
                        <TableCell>
                          <div className="font-medium">{row.assetName}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.assetNumber || row.category}
                          </div>
                        </TableCell>
                        <TableCell className="capitalize">
                          {row.method.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.remainingDepreciable} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric className=" font-medium">
                          <Money amount={row.monthlyDepreciation} currency={"AED"} />
                        </TableCell>
                        <TableCell data-numeric>
                          <Money amount={row.projectedNetBookValue} currency={"AED"} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={depreciationStatusVariant(row.status)} dot>
                            {row.statusLabel}
                          </Badge>
                          {row.status !== "ready" && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {row.reviewReason}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noActiveFixedAssetsAvailableForDepreciation" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={reportSectionClass(["fixed-asset-register"])}>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                <T k="reportCenter.fixedAssetRegister" />
              </CardTitle>
              <CardDescription>
                {t["balancesTab.assetCostAccumulatedDepreciationNet"]}
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/fixed-assets">
                <T k="reportCenter.openFixedAssets" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {balancesLoading ? (
            <Skeleton className="h-96" />
          ) : fixedAssetRegisterReport.rows.length ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.activeAssets" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {fixedAssetRegisterReport.totalAssets}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.assetCost" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={fixedAssetRegisterReport.totalCost} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.netBookValue" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    <Money amount={fixedAssetRegisterReport.totalNetBookValue} currency={"AED"} />
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    <T k="reportCenter.reviewItems" />
                  </div>
                  <div className="tabular-nums text-2xl font-semibold">
                    {fixedAssetRegisterReport.reviewCount}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.8fr]">
                <div className="max-h-[520px] overflow-auto rounded-md border">
                  <Table className="min-w-[960px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <T k="reportCenter.asset" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.category" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.purchaseDate" />
                        </TableHead>
                        <TableHead>
                          <T k="reportCenter.status" />
                        </TableHead>
                        <TableHead data-numeric>Cost</TableHead>
                        <TableHead data-numeric>
                          <T k="reportCenter.depreciation" />
                        </TableHead>
                        <TableHead data-numeric>NBV</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fixedAssetRegisterReport.rows.map((asset) => (
                        <TableRow key={asset.id}>
                          <TableCell>
                            <div className="font-medium">{asset.asset_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {asset.asset_number || asset.serial_number || "No asset number"}
                            </div>
                          </TableCell>
                          <TableCell>{asset.category}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatReportDate(asset.purchase_date)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={fixedAssetStatusVariant(asset.status)} dot>
                              {asset.needs_capitalization_je
                                ? t["balancesTab.capitalizationReview"]
                                : asset.status}
                            </Badge>
                          </TableCell>
                          <TableCell data-numeric>
                            <Money amount={asset.purchaseCost} currency={"AED"} />
                          </TableCell>
                          <TableCell data-numeric>
                            <Money amount={asset.accumulatedDepreciation} currency={"AED"} />
                          </TableCell>
                          <TableCell data-numeric className=" font-medium">
                            <Money amount={asset.netBookValue} currency={"AED"} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="rounded-md border p-4">
                  <div className="mb-3">
                    <div className="font-medium">
                      <T k="reportCenter.categoryValuation" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <T k="reportCenter.activeAssetsGroupedByCategory" />
                    </div>
                  </div>
                  <div className="max-h-[420px] space-y-3 overflow-auto pe-1">
                    {fixedAssetRegisterReport.byCategory.length ? (
                      fixedAssetRegisterReport.byCategory.map((category) => (
                        <div
                          key={category.category}
                          className="flex items-center justify-between gap-4 text-sm"
                        >
                          <div>
                            <div className="font-medium">{category.category}</div>
                            <div className="text-xs text-muted-foreground">
                              {category.count} assets
                            </div>
                          </div>
                          <div className="text-end tabular-nums">
                            <Money amount={category.totalNetBookValue} currency={"AED"} />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        <T k="reportCenter.noActiveAssetCategories" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              <T k="reportCenter.noFixedAssetsRegisteredYet" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className={cn(hasFocusedReportSelection && "hidden")}>
        <CardHeader>
          <CardTitle>
            <T k="reportCenter.balanceAutomationQueues" />
          </CardTitle>
          <CardDescription>{t["balancesTab.currentOpenBalanceSignalsFor"]}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.collectionsQueue" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {balanceReport.overdueCustomerCount}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.billPayQueue" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {balanceReport.overdueVendorCount}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.inventoryReview" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {inventoryValuationReport.reviewCount}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.assetReview" />
              </div>
              <div className="tabular-nums text-2xl font-semibold">
                {fixedAssetRegisterReport.reviewCount}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">
                <T k="reportCenter.lastRefreshed" />
              </div>
              <div className="text-sm font-medium">
                {formatReportDate(balanceReport.generatedAt)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
