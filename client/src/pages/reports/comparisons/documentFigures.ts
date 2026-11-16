// Invoice, vendor-bill, receivable and payable figures for the current and previous comparison ranges.
// Split from the Reports page comparisonRows memo (R20-09); behaviour unchanged.
import {
  ComparisonRange,
  InvoiceReportRow,
  VendorBillReportRow,
  activityLogInDateRange,
  amountInAed,
  averageDaysOverdue,
  buildDepreciationScheduleReport,
  dueWithinDaysAfterRangeEnd,
  expenseClaimInDateRange,
  inactiveInvoiceStatuses,
  inactiveVendorBillStatuses,
  inclusiveDayCount,
  inventoryMovementInDateRange,
  invoiceInDateRange,
  nonPayableVendorBillStatuses,
  nonRevenueInvoiceStatuses,
  payrollRunInDateRange,
  ratioPercent,
  receiptInDateRange,
  valueInDateRange,
  vendorBillInDateRange,
  vendorBillOutstandingAed,
  vendorBillPaidAed,
  vendorBillTotalAed,
} from "../shared";
import type { ComparisonRowsInput } from "./comparisonRowsInput";

export function computeDocumentComparisonFigures({
  activityLogs,
  bankTransactions,
  comparisonCurrentRange,
  comparisonPreviousRange,
  expenseClaims,
  fixedAssetRegisterReport,
  inventoryMovements,
  invoices,
  payrollRuns,
  receipts,
  vendorBills,
}: Pick<
  ComparisonRowsInput,
  | "activityLogs"
  | "bankTransactions"
  | "comparisonCurrentRange"
  | "comparisonPreviousRange"
  | "expenseClaims"
  | "fixedAssetRegisterReport"
  | "inventoryMovements"
  | "invoices"
  | "payrollRuns"
  | "receipts"
  | "vendorBills"
>) {
  const currentInvoices = invoices.filter(
    (invoice) =>
      !inactiveInvoiceStatuses.has(invoice.status) &&
      invoiceInDateRange(invoice, comparisonCurrentRange)
  );
  const previousInvoices = invoices.filter(
    (invoice) =>
      !inactiveInvoiceStatuses.has(invoice.status) &&
      invoiceInDateRange(invoice, comparisonPreviousRange)
  );
  const currentVendorBillDocuments = vendorBills.filter(
    (bill) =>
      !nonPayableVendorBillStatuses.has(bill.status) &&
      vendorBillInDateRange(bill, comparisonCurrentRange)
  );
  const previousVendorBillDocuments = vendorBills.filter(
    (bill) =>
      !nonPayableVendorBillStatuses.has(bill.status) &&
      vendorBillInDateRange(bill, comparisonPreviousRange)
  );
  const currentVendorBills = currentVendorBillDocuments.filter(
    (bill) => !inactiveVendorBillStatuses.has(bill.status)
  );
  const previousVendorBills = previousVendorBillDocuments.filter(
    (bill) => !inactiveVendorBillStatuses.has(bill.status)
  );
  const currentReceipts = receipts.filter((receipt) =>
    receiptInDateRange(receipt, comparisonCurrentRange)
  );
  const previousReceipts = receipts.filter((receipt) =>
    receiptInDateRange(receipt, comparisonPreviousRange)
  );
  const currentBankTransactions = bankTransactions.filter((transaction) =>
    valueInDateRange(transaction.transactionDate, comparisonCurrentRange)
  );
  const previousBankTransactions = bankTransactions.filter((transaction) =>
    valueInDateRange(transaction.transactionDate, comparisonPreviousRange)
  );
  const currentExpenseClaims = expenseClaims.filter((claim) =>
    expenseClaimInDateRange(claim, comparisonCurrentRange)
  );
  const previousExpenseClaims = expenseClaims.filter((claim) =>
    expenseClaimInDateRange(claim, comparisonPreviousRange)
  );
  const currentPayrollRuns = payrollRuns.filter((run) =>
    payrollRunInDateRange(run, comparisonCurrentRange)
  );
  const previousPayrollRuns = payrollRuns.filter((run) =>
    payrollRunInDateRange(run, comparisonPreviousRange)
  );
  const currentInventoryMovements = inventoryMovements.filter((movement) =>
    inventoryMovementInDateRange(movement, comparisonCurrentRange)
  );
  const previousInventoryMovements = inventoryMovements.filter((movement) =>
    inventoryMovementInDateRange(movement, comparisonPreviousRange)
  );
  const currentActivityLogs = activityLogs.filter((log) =>
    activityLogInDateRange(log, comparisonCurrentRange)
  );
  const previousActivityLogs = activityLogs.filter((log) =>
    activityLogInDateRange(log, comparisonPreviousRange)
  );
  const currentDepreciationEstimate = buildDepreciationScheduleReport(
    fixedAssetRegisterReport.activeRows,
    comparisonCurrentRange.to
  ).periodDepreciationAed;
  const previousDepreciationEstimate = buildDepreciationScheduleReport(
    fixedAssetRegisterReport.activeRows,
    comparisonPreviousRange.to
  ).periodDepreciationAed;
  const currentInvoiceValue = currentInvoices.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const previousInvoiceValue = previousInvoices.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const revenueInvoiceRows = (rows: InvoiceReportRow[]) =>
    rows.filter((invoice) => !nonRevenueInvoiceStatuses.has(invoice.status));
  const currentRevenueInvoices = revenueInvoiceRows(currentInvoices);
  const previousRevenueInvoices = revenueInvoiceRows(previousInvoices);
  const currentRevenueInvoiceValue = currentRevenueInvoices.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const previousRevenueInvoiceValue = previousRevenueInvoices.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const openReceivableRows = (rows: InvoiceReportRow[]) =>
    rows.filter(
      (invoice) => !nonRevenueInvoiceStatuses.has(invoice.status) && invoice.status !== "paid"
    );
  const currentOpenReceivableInvoices = openReceivableRows(currentInvoices);
  const previousOpenReceivableInvoices = openReceivableRows(previousInvoices);
  const currentOpenReceivableValue = currentOpenReceivableInvoices.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const previousOpenReceivableValue = previousOpenReceivableInvoices.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const currentOpenInvoiceValueShare = ratioPercent(
    currentOpenReceivableValue,
    currentRevenueInvoiceValue
  );
  const previousOpenInvoiceValueShare = ratioPercent(
    previousOpenReceivableValue,
    previousRevenueInvoiceValue
  );
  const currentAverageOpenInvoiceValue =
    currentOpenReceivableInvoices.length > 0
      ? Math.round((currentOpenReceivableValue / currentOpenReceivableInvoices.length) * 100) / 100
      : 0;
  const previousAverageOpenInvoiceValue =
    previousOpenReceivableInvoices.length > 0
      ? Math.round((previousOpenReceivableValue / previousOpenReceivableInvoices.length) * 100) /
        100
      : 0;
  const currentOpenInvoiceShare = ratioPercent(
    currentOpenReceivableInvoices.length,
    currentRevenueInvoices.length
  );
  const previousOpenInvoiceShare = ratioPercent(
    previousOpenReceivableInvoices.length,
    previousRevenueInvoices.length
  );
  const currentDueSoonReceivableInvoices = dueWithinDaysAfterRangeEnd(
    currentOpenReceivableInvoices,
    (invoice) => invoice.dueDate,
    comparisonCurrentRange
  );
  const previousDueSoonReceivableInvoices = dueWithinDaysAfterRangeEnd(
    previousOpenReceivableInvoices,
    (invoice) => invoice.dueDate,
    comparisonPreviousRange
  );
  const currentDueSoonReceivableValue = currentDueSoonReceivableInvoices.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const previousDueSoonReceivableValue = previousDueSoonReceivableInvoices.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const currentAverageDueSoonInvoiceValue =
    currentDueSoonReceivableInvoices.length > 0
      ? Math.round(
          (currentDueSoonReceivableValue / currentDueSoonReceivableInvoices.length) * 100
        ) / 100
      : 0;
  const previousAverageDueSoonInvoiceValue =
    previousDueSoonReceivableInvoices.length > 0
      ? Math.round(
          (previousDueSoonReceivableValue / previousDueSoonReceivableInvoices.length) * 100
        ) / 100
      : 0;
  const currentDueSoonInvoiceShare = ratioPercent(
    currentDueSoonReceivableInvoices.length,
    currentOpenReceivableInvoices.length
  );
  const previousDueSoonInvoiceShare = ratioPercent(
    previousDueSoonReceivableInvoices.length,
    previousOpenReceivableInvoices.length
  );
  const isDueByRangeEnd = (invoice: InvoiceReportRow, range: ComparisonRange) => {
    if (!invoice.dueDate) return false;
    const dueDate = new Date(invoice.dueDate);
    if (Number.isNaN(dueDate.getTime())) return false;
    const rangeEnd = new Date(range.to);
    rangeEnd.setHours(23, 59, 59, 999);
    return dueDate <= rangeEnd;
  };
  const overdueReceivableRows = (rows: InvoiceReportRow[], range: ComparisonRange) =>
    rows.filter(
      (invoice) =>
        !nonRevenueInvoiceStatuses.has(invoice.status) &&
        invoice.status !== "paid" &&
        isDueByRangeEnd(invoice, range)
    );
  const currentOverdueReceivables = overdueReceivableRows(currentInvoices, comparisonCurrentRange);
  const previousOverdueReceivables = overdueReceivableRows(
    previousInvoices,
    comparisonPreviousRange
  );
  const currentOverdueReceivableValue = currentOverdueReceivables.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const previousOverdueReceivableValue = previousOverdueReceivables.reduce(
    (sum, invoice) => sum + amountInAed(invoice),
    0
  );
  const currentOverdueInvoiceCount = currentOverdueReceivables.length;
  const previousOverdueInvoiceCount = previousOverdueReceivables.length;
  const currentAverageOverdueInvoiceDays = averageDaysOverdue(
    currentOverdueReceivables,
    (invoice) => invoice.dueDate,
    comparisonCurrentRange
  );
  const previousAverageOverdueInvoiceDays = averageDaysOverdue(
    previousOverdueReceivables,
    (invoice) => invoice.dueDate,
    comparisonPreviousRange
  );
  const currentAverageOverdueInvoiceValue =
    currentOverdueInvoiceCount > 0
      ? Math.round((currentOverdueReceivableValue / currentOverdueInvoiceCount) * 100) / 100
      : 0;
  const previousAverageOverdueInvoiceValue =
    previousOverdueInvoiceCount > 0
      ? Math.round((previousOverdueReceivableValue / previousOverdueInvoiceCount) * 100) / 100
      : 0;
  const currentOverdueReceivableShare = ratioPercent(
    currentOverdueReceivableValue,
    currentOpenReceivableValue
  );
  const previousOverdueReceivableShare = ratioPercent(
    previousOverdueReceivableValue,
    previousOpenReceivableValue
  );
  const currentOverdueInvoiceShare = ratioPercent(
    currentOverdueInvoiceCount,
    currentOpenReceivableInvoices.length
  );
  const previousOverdueInvoiceShare = ratioPercent(
    previousOverdueInvoiceCount,
    previousOpenReceivableInvoices.length
  );
  const paidInvoiceShare = (rows: InvoiceReportRow[]) => {
    const revenueRows = revenueInvoiceRows(rows);
    const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
    if (total <= 0.005) return 0;

    const paidTotal = revenueRows
      .filter((invoice) => invoice.status === "paid")
      .reduce((sum, invoice) => sum + amountInAed(invoice), 0);
    return Math.round((paidTotal / total) * 10000) / 100;
  };
  const currentPaidInvoiceShare = paidInvoiceShare(currentInvoices);
  const previousPaidInvoiceShare = paidInvoiceShare(previousInvoices);
  const averageInvoiceValue = (rows: InvoiceReportRow[]) => {
    const revenueRows = revenueInvoiceRows(rows);
    if (revenueRows.length === 0) return 0;

    const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
    return Math.round((total / revenueRows.length) * 100) / 100;
  };
  const currentAverageInvoiceValue = averageInvoiceValue(currentInvoices);
  const previousAverageInvoiceValue = averageInvoiceValue(previousInvoices);
  const currentOpenPayableValue = currentVendorBills.reduce(
    (sum, bill) => sum + vendorBillOutstandingAed(bill),
    0
  );
  const previousOpenPayableValue = previousVendorBills.reduce(
    (sum, bill) => sum + vendorBillOutstandingAed(bill),
    0
  );
  const currentOpenCashGap = currentOpenPayableValue - currentOpenReceivableValue;
  const previousOpenCashGap = previousOpenPayableValue - previousOpenReceivableValue;
  const currentOpenCashCoverage = ratioPercent(currentOpenReceivableValue, currentOpenPayableValue);
  const previousOpenCashCoverage = ratioPercent(
    previousOpenReceivableValue,
    previousOpenPayableValue
  );
  const currentOpenWorkloadGap = currentVendorBills.length - currentOpenReceivableInvoices.length;
  const previousOpenWorkloadGap =
    previousVendorBills.length - previousOpenReceivableInvoices.length;
  const currentAverageOpenBillValue =
    currentVendorBills.length > 0
      ? Math.round((currentOpenPayableValue / currentVendorBills.length) * 100) / 100
      : 0;
  const previousAverageOpenBillValue =
    previousVendorBills.length > 0
      ? Math.round((previousOpenPayableValue / previousVendorBills.length) * 100) / 100
      : 0;
  const currentOpenBillShare = ratioPercent(
    currentVendorBills.length,
    currentVendorBillDocuments.length
  );
  const previousOpenBillShare = ratioPercent(
    previousVendorBills.length,
    previousVendorBillDocuments.length
  );
  const currentDueSoonBills = dueWithinDaysAfterRangeEnd(
    currentVendorBills,
    (bill) => bill.due_date,
    comparisonCurrentRange
  );
  const previousDueSoonBills = dueWithinDaysAfterRangeEnd(
    previousVendorBills,
    (bill) => bill.due_date,
    comparisonPreviousRange
  );
  const currentDueSoonBillValue = currentDueSoonBills.reduce(
    (sum, bill) => sum + vendorBillOutstandingAed(bill),
    0
  );
  const previousDueSoonBillValue = previousDueSoonBills.reduce(
    (sum, bill) => sum + vendorBillOutstandingAed(bill),
    0
  );
  const currentAverageDueSoonBillValue =
    currentDueSoonBills.length > 0
      ? Math.round((currentDueSoonBillValue / currentDueSoonBills.length) * 100) / 100
      : 0;
  const previousAverageDueSoonBillValue =
    previousDueSoonBills.length > 0
      ? Math.round((previousDueSoonBillValue / previousDueSoonBills.length) * 100) / 100
      : 0;
  const currentDueSoonBillShare = ratioPercent(
    currentDueSoonBills.length,
    currentVendorBills.length
  );
  const previousDueSoonBillShare = ratioPercent(
    previousDueSoonBills.length,
    previousVendorBills.length
  );
  const currentDueSoonCashGap = currentDueSoonBillValue - currentDueSoonReceivableValue;
  const previousDueSoonCashGap = previousDueSoonBillValue - previousDueSoonReceivableValue;
  const currentDueSoonCashCoverage = ratioPercent(
    currentDueSoonReceivableValue,
    currentDueSoonBillValue
  );
  const previousDueSoonCashCoverage = ratioPercent(
    previousDueSoonReceivableValue,
    previousDueSoonBillValue
  );
  const currentDueSoonWorkloadGap =
    currentDueSoonBills.length - currentDueSoonReceivableInvoices.length;
  const previousDueSoonWorkloadGap =
    previousDueSoonBills.length - previousDueSoonReceivableInvoices.length;
  const isBillDueByRangeEnd = (bill: VendorBillReportRow, range: ComparisonRange) => {
    if (!bill.due_date) return false;
    const dueDate = new Date(bill.due_date);
    if (Number.isNaN(dueDate.getTime())) return false;
    const rangeEnd = new Date(range.to);
    rangeEnd.setHours(23, 59, 59, 999);
    return dueDate <= rangeEnd;
  };
  const overduePayableRows = (rows: VendorBillReportRow[], range: ComparisonRange) =>
    rows.filter((bill) => isBillDueByRangeEnd(bill, range));
  const currentOverduePayables = overduePayableRows(currentVendorBills, comparisonCurrentRange);
  const previousOverduePayables = overduePayableRows(previousVendorBills, comparisonPreviousRange);
  const currentOverduePayableValue = currentOverduePayables.reduce(
    (sum, bill) => sum + vendorBillOutstandingAed(bill),
    0
  );
  const previousOverduePayableValue = previousOverduePayables.reduce(
    (sum, bill) => sum + vendorBillOutstandingAed(bill),
    0
  );
  const currentOverdueCashGap = currentOverduePayableValue - currentOverdueReceivableValue;
  const previousOverdueCashGap = previousOverduePayableValue - previousOverdueReceivableValue;
  const currentOverdueCashCoverage = ratioPercent(
    currentOverdueReceivableValue,
    currentOverduePayableValue
  );
  const previousOverdueCashCoverage = ratioPercent(
    previousOverdueReceivableValue,
    previousOverduePayableValue
  );
  const currentOverdueBillCount = currentOverduePayables.length;
  const previousOverdueBillCount = previousOverduePayables.length;
  const currentOverdueWorkloadGap = currentOverdueBillCount - currentOverdueInvoiceCount;
  const previousOverdueWorkloadGap = previousOverdueBillCount - previousOverdueInvoiceCount;
  const currentAverageOverdueBillDays = averageDaysOverdue(
    currentOverduePayables,
    (bill) => bill.due_date,
    comparisonCurrentRange
  );
  const previousAverageOverdueBillDays = averageDaysOverdue(
    previousOverduePayables,
    (bill) => bill.due_date,
    comparisonPreviousRange
  );
  const currentAverageOverdueBillValue =
    currentOverdueBillCount > 0
      ? Math.round((currentOverduePayableValue / currentOverdueBillCount) * 100) / 100
      : 0;
  const previousAverageOverdueBillValue =
    previousOverdueBillCount > 0
      ? Math.round((previousOverduePayableValue / previousOverdueBillCount) * 100) / 100
      : 0;
  const currentOverdueBillShare = ratioPercent(currentOverdueBillCount, currentVendorBills.length);
  const previousOverdueBillShare = ratioPercent(
    previousOverdueBillCount,
    previousVendorBills.length
  );
  const currentOverduePayableShare = ratioPercent(
    currentOverduePayableValue,
    currentOpenPayableValue
  );
  const previousOverduePayableShare = ratioPercent(
    previousOverduePayableValue,
    previousOpenPayableValue
  );
  const currentWorkingCapitalProxy = currentOpenReceivableValue - currentOpenPayableValue;
  const previousWorkingCapitalProxy = previousOpenReceivableValue - previousOpenPayableValue;
  const currentVendorBillValue = currentVendorBillDocuments.reduce(
    (sum, bill) => sum + vendorBillTotalAed(bill),
    0
  );
  const previousVendorBillValue = previousVendorBillDocuments.reduce(
    (sum, bill) => sum + vendorBillTotalAed(bill),
    0
  );
  const currentAverageVendorBillValue =
    currentVendorBillDocuments.length > 0
      ? Math.round((currentVendorBillValue / currentVendorBillDocuments.length) * 100) / 100
      : 0;
  const previousAverageVendorBillValue =
    previousVendorBillDocuments.length > 0
      ? Math.round((previousVendorBillValue / previousVendorBillDocuments.length) * 100) / 100
      : 0;
  const currentPaidVendorBillValue = currentVendorBillDocuments.reduce(
    (sum, bill) => sum + vendorBillPaidAed(bill),
    0
  );
  const previousPaidVendorBillValue = previousVendorBillDocuments.reduce(
    (sum, bill) => sum + vendorBillPaidAed(bill),
    0
  );
  const currentPaidVendorBillShare = ratioPercent(
    currentPaidVendorBillValue,
    currentVendorBillValue
  );
  const previousPaidVendorBillShare = ratioPercent(
    previousPaidVendorBillValue,
    previousVendorBillValue
  );
  const currentOpenBillValueShare = ratioPercent(currentOpenPayableValue, currentVendorBillValue);
  const previousOpenBillValueShare = ratioPercent(
    previousOpenPayableValue,
    previousVendorBillValue
  );
  const topVendorShare = (rows: VendorBillReportRow[]) => {
    const total = rows.reduce((sum, bill) => sum + vendorBillTotalAed(bill), 0);
    if (total <= 0.005) return 0;

    const byVendor = new Map<string, number>();
    for (const bill of rows) {
      const vendorName = bill.vendor_name || "Unknown Vendor";
      byVendor.set(vendorName, (byVendor.get(vendorName) ?? 0) + vendorBillTotalAed(bill));
    }

    const topVendorSpend = Math.max(0, ...Array.from(byVendor.values()));
    return Math.round((topVendorSpend / total) * 10000) / 100;
  };
  const currentTopVendorShare = topVendorShare(currentVendorBillDocuments);
  const previousTopVendorShare = topVendorShare(previousVendorBillDocuments);
  const currentComparisonDays = inclusiveDayCount(
    comparisonCurrentRange.from,
    comparisonCurrentRange.to
  );
  const previousComparisonDays = inclusiveDayCount(
    comparisonPreviousRange.from,
    comparisonPreviousRange.to
  );
  const currentCollectionDays =
    currentInvoiceValue > 0.005
      ? Math.round(
          (currentOpenReceivableValue / currentInvoiceValue) * currentComparisonDays * 10
        ) / 10
      : 0;
  const previousCollectionDays =
    previousInvoiceValue > 0.005
      ? Math.round(
          (previousOpenReceivableValue / previousInvoiceValue) * previousComparisonDays * 10
        ) / 10
      : 0;
  const currentPayableDays =
    currentVendorBillValue > 0.005
      ? Math.round(
          (currentOpenPayableValue / currentVendorBillValue) * currentComparisonDays * 10
        ) / 10
      : 0;
  const previousPayableDays =
    previousVendorBillValue > 0.005
      ? Math.round(
          (previousOpenPayableValue / previousVendorBillValue) * previousComparisonDays * 10
        ) / 10
      : 0;
  const currentCashConversionGap =
    Math.round((currentCollectionDays - currentPayableDays) * 10) / 10;
  const previousCashConversionGap =
    Math.round((previousCollectionDays - previousPayableDays) * 10) / 10;
  const topCustomerShare = (rows: InvoiceReportRow[]) => {
    const revenueRows = rows.filter((invoice) => !nonRevenueInvoiceStatuses.has(invoice.status));
    const total = revenueRows.reduce((sum, invoice) => sum + amountInAed(invoice), 0);
    if (total <= 0.005) return 0;

    const byCustomer = new Map<string, number>();
    for (const invoice of revenueRows) {
      const customerName = invoice.customerName || "Unknown Customer";
      byCustomer.set(customerName, (byCustomer.get(customerName) ?? 0) + amountInAed(invoice));
    }

    const topCustomerRevenue = Math.max(0, ...Array.from(byCustomer.values()));
    return Math.round((topCustomerRevenue / total) * 10000) / 100;
  };
  const currentTopCustomerShare = topCustomerShare(currentInvoices);
  const previousTopCustomerShare = topCustomerShare(previousInvoices);
  return {
    currentInvoices,
    previousInvoices,
    currentVendorBillDocuments,
    previousVendorBillDocuments,
    currentVendorBills,
    previousVendorBills,
    currentReceipts,
    previousReceipts,
    currentBankTransactions,
    previousBankTransactions,
    currentExpenseClaims,
    previousExpenseClaims,
    currentPayrollRuns,
    previousPayrollRuns,
    currentInventoryMovements,
    previousInventoryMovements,
    currentActivityLogs,
    previousActivityLogs,
    currentDepreciationEstimate,
    previousDepreciationEstimate,
    currentInvoiceValue,
    previousInvoiceValue,
    currentOpenReceivableInvoices,
    previousOpenReceivableInvoices,
    currentOpenReceivableValue,
    previousOpenReceivableValue,
    currentOpenInvoiceValueShare,
    previousOpenInvoiceValueShare,
    currentAverageOpenInvoiceValue,
    previousAverageOpenInvoiceValue,
    currentOpenInvoiceShare,
    previousOpenInvoiceShare,
    currentDueSoonReceivableInvoices,
    previousDueSoonReceivableInvoices,
    currentDueSoonReceivableValue,
    previousDueSoonReceivableValue,
    currentAverageDueSoonInvoiceValue,
    previousAverageDueSoonInvoiceValue,
    currentDueSoonInvoiceShare,
    previousDueSoonInvoiceShare,
    currentOverdueReceivableValue,
    previousOverdueReceivableValue,
    currentOverdueInvoiceCount,
    previousOverdueInvoiceCount,
    currentAverageOverdueInvoiceDays,
    previousAverageOverdueInvoiceDays,
    currentAverageOverdueInvoiceValue,
    previousAverageOverdueInvoiceValue,
    currentOverdueReceivableShare,
    previousOverdueReceivableShare,
    currentOverdueInvoiceShare,
    previousOverdueInvoiceShare,
    currentPaidInvoiceShare,
    previousPaidInvoiceShare,
    currentAverageInvoiceValue,
    previousAverageInvoiceValue,
    currentOpenPayableValue,
    previousOpenPayableValue,
    currentOpenCashGap,
    previousOpenCashGap,
    currentOpenCashCoverage,
    previousOpenCashCoverage,
    currentOpenWorkloadGap,
    previousOpenWorkloadGap,
    currentAverageOpenBillValue,
    previousAverageOpenBillValue,
    currentOpenBillShare,
    previousOpenBillShare,
    currentDueSoonBills,
    previousDueSoonBills,
    currentDueSoonBillValue,
    previousDueSoonBillValue,
    currentAverageDueSoonBillValue,
    previousAverageDueSoonBillValue,
    currentDueSoonBillShare,
    previousDueSoonBillShare,
    currentDueSoonCashGap,
    previousDueSoonCashGap,
    currentDueSoonCashCoverage,
    previousDueSoonCashCoverage,
    currentDueSoonWorkloadGap,
    previousDueSoonWorkloadGap,
    currentOverduePayableValue,
    previousOverduePayableValue,
    currentOverdueCashGap,
    previousOverdueCashGap,
    currentOverdueCashCoverage,
    previousOverdueCashCoverage,
    currentOverdueBillCount,
    previousOverdueBillCount,
    currentOverdueWorkloadGap,
    previousOverdueWorkloadGap,
    currentAverageOverdueBillDays,
    previousAverageOverdueBillDays,
    currentAverageOverdueBillValue,
    previousAverageOverdueBillValue,
    currentOverdueBillShare,
    previousOverdueBillShare,
    currentOverduePayableShare,
    previousOverduePayableShare,
    currentWorkingCapitalProxy,
    previousWorkingCapitalProxy,
    currentVendorBillValue,
    previousVendorBillValue,
    currentAverageVendorBillValue,
    previousAverageVendorBillValue,
    currentPaidVendorBillShare,
    previousPaidVendorBillShare,
    currentOpenBillValueShare,
    previousOpenBillValueShare,
    currentTopVendorShare,
    previousTopVendorShare,
    currentComparisonDays,
    previousComparisonDays,
    currentCollectionDays,
    previousCollectionDays,
    currentPayableDays,
    previousPayableDays,
    currentCashConversionGap,
    previousCashConversionGap,
    currentTopCustomerShare,
    previousTopCustomerShare,
  };
}

export type ComputeDocumentComparisonFiguresResult = ReturnType<
  typeof computeDocumentComparisonFigures
>;
