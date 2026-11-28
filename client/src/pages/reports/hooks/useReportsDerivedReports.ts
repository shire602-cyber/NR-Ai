// Report models derived from the queried data: sales, inventory, fixed assets, aging, consolidation, expenses and payroll.
// Stage of the Reports page state; useReportsPage composes the stages in order (R20-09).
import {
  CustomerRevenueRow,
  ExpenseClaimStatusRow,
  ExpenseSummaryRow,
  FixedAssetValuationRow,
  InventoryMovementTypeRow,
  InvoiceStatusSummaryRow,
  JournalEntryReportRow,
  JournalLineReportRow,
  OverdueCustomerRow,
  PayrollStatusReportRow,
  amountInAed,
  buildConsolidatedStatementsReport,
  buildDepreciationScheduleReport,
  expenseClaimAmount,
  expenseClaimInDateRange,
  fixedAssetAmount,
  inactiveInvoiceStatuses,
  isUnpaidInvoice,
  inventoryAmount,
  inventoryMovementInDateRange,
  invoiceInDateRange,
  journalAccountName,
  journalEntryInDateRange,
  journalSourceLabel,
  nonRevenueInvoiceStatuses,
  payrollAmount,
  payrollRunInDateRange,
  receiptInDateRange,
  receiptSpendInBase,
  receiptVatInBase,
  reportDateRange,
  reportText,
} from "../shared";
import { prepareAgingReportsForExport } from "@/lib/export";
import { useCallback, useMemo } from "react";
import type { ReportsDataQueriesState } from "./useReportsDataQueries";
import type { ReportsWorkspaceStateState } from "./useReportsWorkspaceState";

type UseReportsDerivedReportsDeps = Pick<
  ReportsDataQueriesState & ReportsWorkspaceStateState,
  | "agingReport"
  | "balanceSummaries"
  | "billAgingReport"
  | "consolidatedStatementSources"
  | "dateRange"
  | "depreciationPeriodDate"
  | "expenseClaimSummary"
  | "expenseClaimSummaryLoading"
  | "expenseClaims"
  | "expenseClaimsLoading"
  | "fixedAssetSummary"
  | "fixedAssets"
  | "inventoryMovements"
  | "inventoryProducts"
  | "invoices"
  | "invoicesLoading"
  | "journalEntries"
  | "journalLoading"
  | "overdueLoading"
  | "overdueReport"
  | "payrollRuns"
  | "payrollRunsLoading"
  | "receipts"
  | "receiptsLoading"
  | "salesProductServiceReport"
  | "selectedCompany"
  | "trialBalance"
  | "vendorBills"
>;

export function useReportsDerivedReports({
  agingReport,
  balanceSummaries,
  billAgingReport,
  consolidatedStatementSources,
  dateRange,
  depreciationPeriodDate,
  expenseClaimSummary,
  expenseClaimSummaryLoading,
  expenseClaims,
  expenseClaimsLoading,
  fixedAssetSummary,
  fixedAssets,
  inventoryMovements,
  inventoryProducts,
  invoices,
  invoicesLoading,
  journalEntries,
  journalLoading,
  overdueLoading,
  overdueReport,
  payrollRuns,
  payrollRunsLoading,
  receipts,
  receiptsLoading,
  salesProductServiceReport,
  selectedCompany,
  trialBalance,
  vendorBills,
}: UseReportsDerivedReportsDeps) {
  const trialBalanceSummary = useMemo(() => {
    const rows = trialBalance?.rows ?? [];
    const activeAccounts = rows.filter((row) => Math.abs(row.balance) > 0.005).length;
    const foreignCurrencyAccounts = rows.filter((row) => row.hasForeignLines).length;
    const isBalanced = (trialBalance?.totals?.difference ?? 0) < 0.005;
    return { activeAccounts, foreignCurrencyAccounts, isBalanced };
  }, [trialBalance]);
  const reportInvoices = useMemo(() => {
    return invoices.filter((invoice) => invoiceInDateRange(invoice, dateRange));
  }, [dateRange, invoices]);
  const statusSummary = useMemo<InvoiceStatusSummaryRow[]>(() => {
    const summaries = new Map<string, InvoiceStatusSummaryRow>();
    for (const invoice of reportInvoices) {
      const status = invoice.status || "unknown";
      const summary = summaries.get(status) ?? { status, count: 0, amountAed: 0 };
      summary.count += 1;
      summary.amountAed += amountInAed(invoice);
      summaries.set(status, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.amountAed - a.amountAed);
  }, [reportInvoices]);
  const customerRevenue = useMemo<CustomerRevenueRow[]>(() => {
    const summaries = new Map<string, CustomerRevenueRow>();
    for (const invoice of reportInvoices) {
      if (nonRevenueInvoiceStatuses.has(invoice.status)) continue;
      const customerName = invoice.customerName || "Unknown Customer";
      const summary = summaries.get(customerName) ?? {
        customerName,
        invoiceCount: 0,
        amountAed: 0,
      };
      summary.invoiceCount += 1;
      summary.amountAed += amountInAed(invoice);
      summaries.set(customerName, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.amountAed - a.amountAed);
  }, [reportInvoices]);
  const overdueRows = useMemo(() => overdueReport?.rows ?? [], [overdueReport?.rows]);
  const productServiceSalesRows = useMemo(
    () => salesProductServiceReport?.rows ?? [],
    [salesProductServiceReport?.rows]
  );
  const topProductServiceSalesRow = productServiceSalesRows[0];
  const productServiceTopShare = salesProductServiceReport?.totals?.topProductServiceShare ?? 0;
  const overdueCustomerRows = useMemo<OverdueCustomerRow[]>(() => {
    const summaries = new Map<string, OverdueCustomerRow>();
    for (const row of overdueRows) {
      const customerName = row.invoice.customerName || "Unknown Customer";
      const currency = row.invoice.currency || "AED";
      const key = `${customerName}::${currency}`;
      const summary = summaries.get(key) ?? {
        customerName,
        currency,
        invoiceCount: 0,
        outstanding: 0,
        maxDaysOverdue: 0,
        recommendedLevel: 1,
      };
      summary.invoiceCount += 1;
      summary.outstanding += Number(row.outstanding) || 0;
      summary.maxDaysOverdue = Math.max(summary.maxDaysOverdue, row.daysOverdue);
      summary.recommendedLevel = Math.max(summary.recommendedLevel, row.recommendedLevel);
      summaries.set(key, summary);
    }
    return Array.from(summaries.values()).sort((a, b) => b.outstanding - a.outstanding);
  }, [overdueRows]);
  const invoiceStatusReport = useMemo(() => {
    const activeInvoices = reportInvoices.filter(
      (invoice) => !inactiveInvoiceStatuses.has(invoice.status)
    );
    const invoiceValueAed = activeInvoices.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
    // X5 (J1 L5): a credit note is not an unpaid invoice, and an invoice whose open balance is
    // nil (settled by a credit note) is not unpaid either.
    const unpaidCount = activeInvoices.filter((invoice) => isUnpaidInvoice(invoice)).length;
    const overdueCurrencies = new Set(overdueRows.map((row) => row.invoice.currency || "AED"));
    const overdueCurrency =
      overdueCurrencies.size === 1 ? Array.from(overdueCurrencies)[0] : undefined;
    return {
      invoiceCount: reportInvoices.length,
      activeInvoiceCount: activeInvoices.length,
      unpaidCount,
      invoiceValueAed,
      overdueRows,
      overdueCustomerRows,
      overdueCurrency,
      overdueOutstanding: overdueReport?.totalOutstanding ?? 0,
      statusSummary,
      customerRevenue,
      productServiceRows: productServiceSalesRows,
      productServiceTotals: salesProductServiceReport?.totals ?? {
        productServiceCount: 0,
        invoiceCount: 0,
        lineCount: 0,
        quantity: 0,
        amountAed: 0,
        vatAed: 0,
        topProductServiceShare: 0,
      },
      invoices: reportInvoices,
    };
  }, [
    customerRevenue,
    overdueCustomerRows,
    overdueReport?.totalOutstanding,
    overdueRows,
    productServiceSalesRows,
    reportInvoices,
    salesProductServiceReport?.totals,
    statusSummary,
  ]);
  const salesLoading = invoicesLoading || overdueLoading;
  const inventoryValuationReport = useMemo(() => {
    const movementCountByProduct = new Map<string, number>();
    for (const movement of inventoryMovements) {
      movementCountByProduct.set(
        movement.productId,
        (movementCountByProduct.get(movement.productId) ?? 0) + 1
      );
    }

    const rows = inventoryProducts
      .map((product) => {
        const currentStock = Number(product.currentStock ?? 0) || 0;
        const unitCost = inventoryAmount(product.costPrice);
        const unitPrice = inventoryAmount(product.unitPrice);
        const stockValueAed = currentStock * unitCost;
        const lowStockThreshold = product.lowStockThreshold;
        return {
          ...product,
          currentStock,
          lowStockThreshold,
          unitCost,
          unitPrice,
          grossMarginAed: unitPrice - unitCost,
          stockValueAed,
          movementCount: movementCountByProduct.get(product.id) ?? 0,
          isLowStock:
            lowStockThreshold !== null &&
            lowStockThreshold !== undefined &&
            currentStock <= lowStockThreshold,
          isNegativeStock: currentStock < 0,
          isMissingCost: currentStock !== 0 && unitCost <= 0,
        };
      })
      .sort((a, b) => b.stockValueAed - a.stockValueAed || a.name.localeCompare(b.name));

    const activeRows = rows.filter((row) => row.isActive);
    const lowStockCount = activeRows.filter((row) => row.isLowStock).length;
    const negativeStockCount = activeRows.filter((row) => row.isNegativeStock).length;
    const missingCostCount = activeRows.filter((row) => row.isMissingCost).length;
    const reviewRows = activeRows.filter(
      (row) => row.isLowStock || row.isNegativeStock || row.isMissingCost
    );

    return {
      rows,
      activeRows,
      reviewRows,
      productCount: rows.length,
      activeProductCount: activeRows.length,
      totalUnits: activeRows.reduce((sum, row) => sum + row.currentStock, 0),
      totalStockValueAed: activeRows.reduce((sum, row) => sum + row.stockValueAed, 0),
      reviewValueAed: reviewRows.reduce((sum, row) => sum + Math.abs(row.stockValueAed), 0),
      lowStockCount,
      negativeStockCount,
      missingCostCount,
      movementCount: inventoryMovements.length,
      reviewCount: reviewRows.length,
    };
  }, [inventoryMovements, inventoryProducts]);
  const reportInventoryMovements = useMemo(() => {
    return inventoryMovements.filter((movement) =>
      inventoryMovementInDateRange(movement, dateRange)
    );
  }, [dateRange, inventoryMovements]);
  const inventoryMovementReport = useMemo(() => {
    const productById = new Map(inventoryProducts.map((product) => [product.id, product]));
    const typeRows = new Map<string, InventoryMovementTypeRow>();
    const rows = reportInventoryMovements
      .map((movement) => {
        const product = productById.get(movement.productId);
        const quantity = Number(movement.quantity ?? 0) || 0;
        const unitCost = inventoryAmount(movement.unitCost);
        const valueAed = Math.abs(quantity) * unitCost;
        const type = movement.type || "adjustment";
        const typeSummary = typeRows.get(type) ?? { type, count: 0, quantity: 0, valueAed: 0 };
        typeSummary.count += 1;
        typeSummary.quantity += Math.abs(quantity);
        typeSummary.valueAed += valueAed;
        typeRows.set(type, typeSummary);
        return {
          ...movement,
          type,
          quantity,
          unitCost,
          valueAed,
          productName: product?.name ?? "Unknown product",
          sku: product?.sku ?? "",
          unit: product?.unit ?? "",
        };
      })
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime || a.productName.localeCompare(b.productName);
      });
    const inboundTypes = new Set(["purchase", "return"]);
    const outboundTypes = new Set(["sale"]);
    const inboundUnits = rows
      .filter((row) => inboundTypes.has(row.type))
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const outboundUnits = rows
      .filter((row) => outboundTypes.has(row.type))
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const adjustmentUnits = rows
      .filter((row) => row.type === "adjustment")
      .reduce((sum, row) => sum + Math.abs(row.quantity), 0);
    const totalMovementValueAed = rows.reduce((sum, row) => sum + row.valueAed, 0);
    const outboundValueAed = rows
      .filter((row) => outboundTypes.has(row.type))
      .reduce((sum, row) => sum + row.valueAed, 0);

    return {
      rows,
      typeRows: Array.from(typeRows.values()).sort(
        (a, b) => b.valueAed - a.valueAed || a.type.localeCompare(b.type)
      ),
      movementCount: rows.length,
      inboundUnits,
      outboundUnits,
      adjustmentUnits,
      totalMovementValueAed,
      outboundValueAed,
      productCount: new Set(rows.map((row) => row.productId)).size,
      reorderSignalCount:
        inventoryValuationReport.lowStockCount + inventoryValuationReport.negativeStockCount,
    };
  }, [
    inventoryProducts,
    inventoryValuationReport.lowStockCount,
    inventoryValuationReport.negativeStockCount,
    reportInventoryMovements,
  ]);
  const fixedAssetRegisterReport = useMemo(() => {
    const rows: FixedAssetValuationRow[] = fixedAssets
      .map((asset) => ({
        ...asset,
        purchaseCost: fixedAssetAmount(asset.purchase_cost),
        salvageValue: fixedAssetAmount(asset.salvage_value),
        accumulatedDepreciation: fixedAssetAmount(asset.accumulated_depreciation),
        netBookValue: fixedAssetAmount(asset.net_book_value),
      }))
      .sort((a, b) => b.netBookValue - a.netBookValue || a.asset_name.localeCompare(b.asset_name));
    const activeRows = rows.filter((asset) => asset.status === "active");
    const capitalizationReviewRows = activeRows.filter((asset) => asset.needs_capitalization_je);
    const depreciationReviewRows = activeRows.filter(
      (asset) =>
        asset.category !== "Land" &&
        Number(asset.useful_life_years ?? 0) > 0 &&
        asset.netBookValue > asset.salvageValue + 0.005
    );
    const reviewRows = activeRows.filter(
      (asset) =>
        asset.needs_capitalization_je ||
        (asset.category !== "Land" &&
          Number(asset.useful_life_years ?? 0) > 0 &&
          asset.netBookValue > asset.salvageValue + 0.005)
    );

    return {
      rows,
      activeRows,
      reviewRows,
      byCategory: fixedAssetSummary?.byCategory ?? [],
      totalAssets: fixedAssetSummary?.totalAssets ?? activeRows.length,
      totalCost:
        fixedAssetSummary?.totalCost ??
        activeRows.reduce((sum, asset) => sum + asset.purchaseCost, 0),
      totalAccumulatedDepreciation:
        fixedAssetSummary?.totalAccumulatedDepreciation ??
        activeRows.reduce((sum, asset) => sum + asset.accumulatedDepreciation, 0),
      totalNetBookValue:
        fixedAssetSummary?.totalNetBookValue ??
        activeRows.reduce((sum, asset) => sum + asset.netBookValue, 0),
      disposedAssetCount: rows.filter((asset) => asset.status !== "active").length,
      capitalizationReviewCount: capitalizationReviewRows.length,
      depreciationReviewCount: depreciationReviewRows.length,
      reviewValueAed: reviewRows.reduce((sum, asset) => sum + Math.max(0, asset.netBookValue), 0),
      reviewCount: reviewRows.length,
    };
  }, [fixedAssetSummary, fixedAssets]);
  const depreciationScheduleReport = useMemo(
    () =>
      buildDepreciationScheduleReport(fixedAssetRegisterReport.activeRows, depreciationPeriodDate),
    [depreciationPeriodDate, fixedAssetRegisterReport.activeRows]
  );
  const balanceReport = useMemo(() => {
    const customers = balanceSummaries?.customers ?? [];
    const vendors = balanceSummaries?.vendors ?? [];
    const customerOpenAed = customers.reduce((sum, row) => sum + row.openBalanceAed, 0);
    const customerOverdueAed = customers.reduce((sum, row) => sum + row.overdueBalanceAed, 0);
    const vendorOpenAed = vendors.reduce((sum, row) => sum + row.openBalanceAed, 0);
    const vendorOverdueAed = vendors.reduce((sum, row) => sum + row.overdueBalanceAed, 0);
    return {
      generatedAt: balanceSummaries?.generatedAt,
      customers,
      vendors,
      customerCount: customers.length,
      vendorCount: vendors.length,
      customerOpenAed,
      customerOverdueAed,
      vendorOpenAed,
      vendorOverdueAed,
      netBalanceAed: customerOpenAed - vendorOpenAed,
      overdueCustomerCount: customers.filter((row) => row.overdueBalanceAed > 0).length,
      overdueVendorCount: vendors.filter((row) => row.overdueBalanceAed > 0).length,
      inventory: {
        ...inventoryValuationReport,
        movementCount: inventoryMovementReport.movementCount,
        movementRows: inventoryMovementReport.rows,
        movementTypeRows: inventoryMovementReport.typeRows,
        productMovementCount: inventoryMovementReport.productCount,
        movementInboundUnits: inventoryMovementReport.inboundUnits,
        movementOutboundUnits: inventoryMovementReport.outboundUnits,
        movementAdjustmentUnits: inventoryMovementReport.adjustmentUnits,
        totalMovementValueAed: inventoryMovementReport.totalMovementValueAed,
        outboundMovementValueAed: inventoryMovementReport.outboundValueAed,
      },
      fixedAssets: {
        ...fixedAssetRegisterReport,
        depreciation: depreciationScheduleReport,
      },
    };
  }, [
    balanceSummaries,
    depreciationScheduleReport,
    fixedAssetRegisterReport,
    inventoryMovementReport,
    inventoryValuationReport,
  ]);
  const receivableAgingRows = useMemo(
    () =>
      agingReport
        .filter((row) => row.type === "receivable")
        .slice()
        .sort((a, b) => b.total - a.total),
    [agingReport]
  );
  const receivableAgingSummary = useMemo(
    () => ({
      current: receivableAgingRows.reduce((sum, row) => sum + row.current, 0),
      overdue: receivableAgingRows.reduce(
        (sum, row) => sum + row.days30 + row.days60 + row.days90 + row.over90,
        0
      ),
      over90: receivableAgingRows.reduce((sum, row) => sum + row.over90, 0),
      total: receivableAgingRows.reduce((sum, row) => sum + row.total, 0),
    }),
    [receivableAgingRows]
  );
  const payableAgingBuckets = useMemo(
    () => [
      {
        label: "Current",
        labelKey: "reportCenter.current",
        count: billAgingReport?.current?.count ?? 0,
        amount: billAgingReport?.current?.amount ?? 0,
      },
      {
        label: "1-30",
        labelKey: "analytics.bucket30",
        count: billAgingReport?.days_1_30?.count ?? 0,
        amount: billAgingReport?.days_1_30?.amount ?? 0,
      },
      {
        label: "31-60",
        labelKey: "analytics.bucket60",
        count: billAgingReport?.days_31_60?.count ?? 0,
        amount: billAgingReport?.days_31_60?.amount ?? 0,
      },
      {
        label: "61-90",
        labelKey: "analytics.bucket90",
        count: billAgingReport?.days_61_90?.count ?? 0,
        amount: billAgingReport?.days_61_90?.amount ?? 0,
      },
      {
        label: "90+",
        labelKey: "analytics.bucketOver90",
        count: billAgingReport?.days_90_plus?.count ?? 0,
        amount: billAgingReport?.days_90_plus?.amount ?? 0,
      },
    ],
    [billAgingReport]
  );
  const payableAgingSummary = useMemo(() => {
    const overdueBuckets = payableAgingBuckets.slice(1);
    return {
      current: payableAgingBuckets[0]?.amount ?? 0,
      overdue: overdueBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
      over90: payableAgingBuckets[4]?.amount ?? 0,
      total: payableAgingBuckets.reduce((sum, bucket) => sum + bucket.amount, 0),
      billCount: payableAgingBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
    };
  }, [payableAgingBuckets]);
  const agingExportSheets = useMemo(
    () => prepareAgingReportsForExport({ receivables: agingReport, payables: billAgingReport }),
    [agingReport, billAgingReport]
  );
  const receivableAgingExportSheets = useMemo(
    () => agingExportSheets.filter((sheet) => sheet.sheetName === "A/R Aging"),
    [agingExportSheets]
  );
  const payableAgingExportSheets = useMemo(
    () => agingExportSheets.filter((sheet) => sheet.sheetName === "A/P Aging"),
    [agingExportSheets]
  );
  const consolidatedStatementsReport = useMemo(
    () =>
      buildConsolidatedStatementsReport(
        consolidatedStatementSources,
        dateRange.from && dateRange.to
          ? reportDateRange(dateRange.from, dateRange.to)
          : reportText("consAllPosted", "All posted activity"),
        "AED"
      ),
    [consolidatedStatementSources, dateRange.from, dateRange.to]
  );
  const reportReceipts = useMemo(() => {
    return receipts.filter((receipt) => receiptInDateRange(receipt, dateRange));
  }, [dateRange, receipts]);
  const receiptVendorById = useMemo(() => {
    return new Map(
      receipts.map((receipt) => [receipt.id, receipt.merchant || "Unknown receipt vendor"])
    );
  }, [receipts]);
  const vendorBillVendorById = useMemo(() => {
    return new Map(vendorBills.map((bill) => [bill.id, bill.vendor_name || "Unknown bill vendor"]));
  }, [vendorBills]);
  const reportExpenseJournalEntries = useMemo(() => {
    return journalEntries.filter(
      (entry) => entry.status === "posted" && journalEntryInDateRange(entry, dateRange)
    );
  }, [dateRange, journalEntries]);
  const expenseVendorLabel = useCallback(
    (entry: JournalEntryReportRow) => {
      const source = (entry.source || "").toLowerCase();
      if (source === "bill" && entry.sourceId) {
        return (
          vendorBillVendorById.get(entry.sourceId) ??
          reportText("unknownBillVendor", "Unknown bill vendor")
        );
      }
      if (source === "receipt" && entry.sourceId) {
        return (
          receiptVendorById.get(entry.sourceId) ??
          reportText("unknownReceiptVendor", "Unknown receipt vendor")
        );
      }
      return reportText("manualNoVendor", "Manual / no vendor");
    },
    [receiptVendorById, vendorBillVendorById]
  );
  const buildExpenseSummary = useCallback(
    (getLabel: (entry: JournalEntryReportRow, line: JournalLineReportRow) => string) => {
      const summaries = new Map<string, ExpenseSummaryRow & { entryIds: Set<string> }>();
      for (const entry of reportExpenseJournalEntries) {
        for (const line of entry.lines ?? []) {
          if (line.account?.type !== "expense") continue;
          const debitAed = Number(line.debit) || 0;
          const creditAed = Number(line.credit) || 0;
          if (Math.abs(debitAed) < 0.005 && Math.abs(creditAed) < 0.005) continue;
          const label = getLabel(entry, line);
          const summary = summaries.get(label) ?? {
            label,
            entryCount: 0,
            lineCount: 0,
            debitAed: 0,
            creditAed: 0,
            netExpenseAed: 0,
            entryIds: new Set<string>(),
          };
          summary.entryIds.add(entry.id);
          summary.lineCount += 1;
          summary.debitAed += debitAed;
          summary.creditAed += creditAed;
          summary.netExpenseAed += debitAed - creditAed;
          summaries.set(label, summary);
        }
      }
      return Array.from(summaries.values())
        .map(({ entryIds, ...summary }) => ({
          ...summary,
          entryCount: entryIds.size,
        }))
        .sort((a, b) => Math.abs(b.netExpenseAed) - Math.abs(a.netExpenseAed));
    },
    [reportExpenseJournalEntries]
  );
  const expenseByVendor = useMemo(
    () => buildExpenseSummary((entry) => expenseVendorLabel(entry)),
    [buildExpenseSummary, expenseVendorLabel]
  );
  const expenseByCategory = useMemo(
    () => buildExpenseSummary((_entry, line) => journalAccountName(line.account)),
    [buildExpenseSummary]
  );
  const reportExpenseClaims = useMemo(() => {
    return expenseClaims.filter((claim) => expenseClaimInDateRange(claim, dateRange));
  }, [dateRange, expenseClaims]);
  const expenseClaimReport = useMemo(() => {
    const statusRows = new Map<string, ExpenseClaimStatusRow>();
    for (const claim of reportExpenseClaims) {
      const status = claim.status || "draft";
      const summary = statusRows.get(status) ?? { status, count: 0, totalAmount: 0 };
      summary.count += 1;
      summary.totalAmount += expenseClaimAmount(claim);
      statusRows.set(status, summary);
    }
    const claimStatusRows = Array.from(statusRows.values()).sort(
      (a, b) => b.totalAmount - a.totalAmount || a.status.localeCompare(b.status)
    );
    const submittedClaims = reportExpenseClaims.filter((claim) => claim.status === "submitted");
    const approvedClaims = reportExpenseClaims.filter((claim) => claim.status === "approved");
    const paidClaims = reportExpenseClaims.filter((claim) => claim.status === "paid");
    const totalAmount = reportExpenseClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const submittedAmount = submittedClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const approvedAmount = approvedClaims.reduce(
      (sum, claim) => sum + expenseClaimAmount(claim),
      0
    );
    const thisMonthTotal = Object.values(expenseClaimSummary?.thisMonth ?? {}).reduce(
      (sum, bucket) => sum + Number(bucket.total ?? 0),
      0
    );

    return {
      claims: reportExpenseClaims,
      statusRows: claimStatusRows,
      claimCount: reportExpenseClaims.length,
      totalAmount,
      submittedCount: submittedClaims.length,
      submittedAmount,
      approvedUnpaidCount: approvedClaims.length,
      approvedUnpaidAmount: approvedAmount,
      paidCount: paidClaims.length,
      thisMonthTotal,
      reviewCount: submittedClaims.length + approvedClaims.length,
      summary: expenseClaimSummary ?? { all: {}, thisMonth: {} },
    };
  }, [expenseClaimSummary, reportExpenseClaims]);
  const baseCurrency = selectedCompany?.baseCurrency ?? "AED";
  const expenseReport = useMemo(() => {
    const entriesById = new Map(journalEntries.map((entry) => [entry.id, entry]));
    const capturedReceiptSpend = reportReceipts.reduce(
      (sum, receipt) =>
        sum + receiptSpendInBase(receipt, entriesById.get(receipt.journalEntryId ?? "")),
      0
    );
    const capturedReceiptVat = reportReceipts.reduce(
      (sum, receipt) => sum + receiptVatInBase(receipt),
      0
    );
    const unpostedReceipts = reportReceipts.filter((receipt) => !receipt.posted).length;
    const autoPostedReceipts = reportReceipts.filter((receipt) => receipt.autoPosted).length;
    const debitAed = expenseByCategory.reduce((sum, row) => sum + row.debitAed, 0);
    const creditAed = expenseByCategory.reduce((sum, row) => sum + row.creditAed, 0);
    const totalAed = expenseByCategory.reduce((sum, row) => sum + row.netExpenseAed, 0);
    const expenseEntryIds = new Set<string>();
    for (const entry of reportExpenseJournalEntries) {
      if ((entry.lines ?? []).some((line) => line.account?.type === "expense")) {
        expenseEntryIds.add(entry.id);
      }
    }
    const expenseLines = reportExpenseJournalEntries
      .flatMap((entry) =>
        (entry.lines ?? [])
          .filter((line) => line.account?.type === "expense")
          .map((line) => {
            const debitAed = Number(line.debit) || 0;
            const creditAed = Number(line.credit) || 0;
            return {
              id: line.id,
              date: entry.date,
              entryNumber: entry.entryNumber,
              vendor: expenseVendorLabel(entry),
              accountName: journalAccountName(line.account),
              accountCode: line.account?.code || "",
              source: journalSourceLabel(entry.source),
              memo: line.memo || entry.memo || "",
              debitAed,
              creditAed,
              netExpenseAed: debitAed - creditAed,
            };
          })
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return {
      baseCurrency,
      basis: reportText(
        "expenseBasis",
        "Posted journal lines where the linked chart-of-account type is expense. Input VAT and unposted receipts are shown separately as source-workflow context."
      ),
      entryCount: expenseEntryIds.size,
      lineCount: expenseByCategory.reduce((sum, row) => sum + row.lineCount, 0),
      receiptCount: reportReceipts.length,
      subtotalAed: debitAed,
      receiptVat: capturedReceiptVat,
      totalAed,
      debitAed,
      creditAed,
      receiptSpend: capturedReceiptSpend,
      unpostedReceipts,
      autoPostedReceipts,
      byVendor: expenseByVendor,
      byCategory: expenseByCategory,
      lines: expenseLines,
      receipts: reportReceipts,
      claims: expenseClaimReport,
    };
  }, [
    baseCurrency,
    journalEntries,
    expenseByCategory,
    expenseByVendor,
    expenseVendorLabel,
    expenseClaimReport,
    reportExpenseJournalEntries,
    reportReceipts,
  ]);
  const expensesLoading =
    receiptsLoading || expenseClaimsLoading || expenseClaimSummaryLoading || journalLoading;
  const reportPayrollRuns = useMemo(() => {
    return payrollRuns.filter((run) => payrollRunInDateRange(run, dateRange));
  }, [dateRange, payrollRuns]);
  const payrollReport = useMemo(() => {
    const statusRows = new Map<string, PayrollStatusReportRow>();
    for (const run of reportPayrollRuns) {
      const status = run.status || "draft";
      const summary = statusRows.get(status) ?? {
        status,
        count: 0,
        employeeCount: 0,
        totalNet: 0,
      };
      summary.count += 1;
      summary.employeeCount += Number(run.employee_count ?? 0);
      summary.totalNet += payrollAmount(run.total_net);
      statusRows.set(status, summary);
    }

    const calculatedRuns = reportPayrollRuns.filter((run) => run.status === "calculated");
    const approvedRuns = reportPayrollRuns.filter((run) => run.status === "approved");
    const draftRuns = reportPayrollRuns.filter((run) => run.status === "draft");
    const sifEligibleRuns = reportPayrollRuns.filter(
      (run) => run.status === "calculated" || run.status === "approved"
    );
    const sifGeneratedRuns = reportPayrollRuns.filter((run) => Boolean(run.sif_file_content));
    const wpsMissingRuns = sifEligibleRuns.filter((run) => !run.sif_file_content);
    const latestRun = [...reportPayrollRuns].sort(
      (a, b) =>
        b.period_year - a.period_year ||
        b.period_month - a.period_month ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    return {
      runs: reportPayrollRuns,
      statusRows: Array.from(statusRows.values()).sort(
        (a, b) => b.totalNet - a.totalNet || a.status.localeCompare(b.status)
      ),
      runCount: reportPayrollRuns.length,
      employeeCount: reportPayrollRuns.reduce(
        (sum, run) => sum + Number(run.employee_count ?? 0),
        0
      ),
      totalBasic: reportPayrollRuns.reduce((sum, run) => sum + payrollAmount(run.total_basic), 0),
      totalAllowances: reportPayrollRuns.reduce(
        (sum, run) => sum + payrollAmount(run.total_allowances),
        0
      ),
      totalDeductions: reportPayrollRuns.reduce(
        (sum, run) => sum + payrollAmount(run.total_deductions),
        0
      ),
      totalNet: reportPayrollRuns.reduce((sum, run) => sum + payrollAmount(run.total_net), 0),
      approvedCount: approvedRuns.length,
      calculatedCount: calculatedRuns.length,
      draftCount: draftRuns.length,
      approvalQueueCount: calculatedRuns.length,
      sifGeneratedCount: sifGeneratedRuns.length,
      wpsReadyCount: approvedRuns.filter((run) => Boolean(run.sif_file_content)).length,
      wpsMissingCount: wpsMissingRuns.length,
      latestRun,
    };
  }, [reportPayrollRuns]);
  const payrollLoading = payrollRunsLoading;

  return {
    trialBalanceSummary,
    reportInvoices,
    statusSummary,
    customerRevenue,
    productServiceSalesRows,
    topProductServiceSalesRow,
    productServiceTopShare,
    overdueCustomerRows,
    invoiceStatusReport,
    salesLoading,
    inventoryValuationReport,
    inventoryMovementReport,
    fixedAssetRegisterReport,
    depreciationScheduleReport,
    balanceReport,
    receivableAgingRows,
    receivableAgingSummary,
    payableAgingBuckets,
    payableAgingSummary,
    receivableAgingExportSheets,
    payableAgingExportSheets,
    consolidatedStatementsReport,
    expenseClaimReport,
    expenseReport,
    expensesLoading,
    payrollReport,
    payrollLoading,
  };
}

export type ReportsDerivedReportsState = ReturnType<typeof useReportsDerivedReports>;
