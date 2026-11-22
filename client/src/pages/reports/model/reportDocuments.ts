// Document amount/date-range helpers, depreciation schedule, consolidation and status variants.
// Split from shared.tsx (R20-09); shared.tsx re-exports this module.
import type { BadgeProps } from "@/components/ui/badge";
import { translateNow } from "@/lib/i18n";
import type { DateRange } from "@/components/DateRangeFilter";
import { format } from "date-fns";
import { parseCalendarDate } from "@/lib/format-date";
import type {
  ActivityLogReportRow,
  ActivityLogRiskLevel,
  ConsolidatedCompanyStatementSource,
  ConsolidatedStatementsReport,
  ConsolidatedStatementStatus,
  CorporateTaxEstimateReport,
  DepreciationScheduleReport,
  DepreciationScheduleRow,
  DepreciationScheduleStatus,
  ExpenseClaimReportRow,
  FixedAssetReportRow,
  FixedAssetValuationRow,
  InventoryMovementReportRow,
  InvoiceReportRow,
  JournalAccount,
  JournalEntryReportRow,
  PayrollRunReportRow,
  ReceiptReportRow,
  VendorBillReportRow,
} from "./reportTypes";
import { invoiceStatusLabels } from "./reportWorkspace";
import { reportDate, reportLocale, reportMonthYear, reportText } from "./reportLabels";

export function amountInAed(invoice: InvoiceReportRow): number {
  return Number(invoice.baseCurrencyAmount ?? invoice.total ?? 0) || 0;
}

/** Server open balance (base currency) of an invoice; falls back to status only for old payloads. */
export function invoiceOpenAed(invoice: InvoiceReportRow): number {
  if (typeof invoice.openBalanceBase === "number") return Math.max(0, invoice.openBalanceBase);
  return invoice.status === "paid" ? 0 : amountInAed(invoice);
}

/** An issued invoice that still has a server open balance (credit-note settled / part-paid aware). */
export function isInvoiceOpen(invoice: InvoiceReportRow): boolean {
  if (invoice.status === "draft" || invoice.status === "void" || invoice.status === "cancelled")
    return false;
  if (invoice.invoiceType === "credit_note") return false;
  if (typeof invoice.openBalanceBase === "number") return invoice.openBalanceBase > 0.005;
  return invoice.status !== "paid";
}

/** An approved vendor bill that still has a server open balance. */
export function isVendorBillOpen(bill: VendorBillReportRow): boolean {
  if (bill.open_balance_base != null) return Number(bill.open_balance_base) > 0.005;
  return !["paid", "void", "cancelled"].includes(bill.status);
}

export function vendorBillTotalAed(bill: VendorBillReportRow): number {
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return (Number(bill.total_amount) || 0) * normalizedExchangeRate;
}

export function vendorBillOutstandingAed(bill: VendorBillReportRow): number {
  if (bill.open_balance_base != null) return Math.max(0, Number(bill.open_balance_base) || 0);
  const outstanding = Math.max(
    0,
    (Number(bill.total_amount) || 0) - (Number(bill.amount_paid) || 0)
  );
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return outstanding * normalizedExchangeRate;
}

export function vendorBillPaidAed(bill: VendorBillReportRow): number {
  const total = Math.max(0, Number(bill.total_amount) || 0);
  const paid = Math.min(total, Math.max(0, Number(bill.amount_paid) || 0));
  const exchangeRate = Number(bill.exchange_rate ?? 1);
  const normalizedExchangeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  return paid * normalizedExchangeRate;
}

export function valueInDateRange(value: string | null | undefined, dateRange: DateRange): boolean {
  if (!dateRange.from || !dateRange.to) return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const from = new Date(dateRange.from);
  from.setHours(0, 0, 0, 0);
  const to = new Date(dateRange.to);
  to.setHours(23, 59, 59, 999);
  return date >= from && date <= to;
}

export function invoiceInDateRange(invoice: InvoiceReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(invoice.date, dateRange);
}

export function receiptInDateRange(receipt: ReceiptReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(receipt.date, dateRange);
}

export function vendorBillInDateRange(bill: VendorBillReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(bill.bill_date, dateRange);
}

export function expenseClaimInDateRange(
  claim: ExpenseClaimReportRow,
  dateRange: DateRange
): boolean {
  return valueInDateRange(claim.created_at, dateRange);
}

export function inventoryMovementInDateRange(
  movement: InventoryMovementReportRow,
  dateRange: DateRange
): boolean {
  return valueInDateRange(movement.createdAt, dateRange);
}

export function activityLogInDateRange(log: ActivityLogReportRow, dateRange: DateRange): boolean {
  return valueInDateRange(log.createdAt, dateRange);
}

export function payrollRunPeriodDate(run: PayrollRunReportRow): Date | null {
  const month = Number(run.period_month);
  const year = Number(run.period_year);
  if (!month || !year) return null;
  const date = new Date(year, month - 1, 1);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function payrollRunInDateRange(run: PayrollRunReportRow, dateRange: DateRange): boolean {
  if (!dateRange.from || !dateRange.to) return true;
  const periodDate = payrollRunPeriodDate(run);
  if (!periodDate) return false;
  return valueInDateRange(periodDate.toISOString(), dateRange);
}

export function receiptExchangeRate(receipt: ReceiptReportRow): number {
  const rate = Number(receipt.exchangeRate ?? 1);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function receiptSubtotalAed(receipt: ReceiptReportRow): number {
  return Math.round((Number(receipt.amount) || 0) * receiptExchangeRate(receipt) * 100) / 100;
}

export function receiptVatAed(receipt: ReceiptReportRow): number {
  return Math.round((Number(receipt.vatAmount) || 0) * receiptExchangeRate(receipt) * 100) / 100;
}

export function receiptSpendAed(receipt: ReceiptReportRow): number {
  const cash = Number(receipt.baseCurrencyAmount);
  if (Number.isFinite(cash) && cash > 0) return cash;
  if (!receipt.posted && receipt.exchangeRateSource === null && cash === 0) return 0;
  return receiptSubtotalAed(receipt) + (receipt.reverseCharge ? 0 : receiptVatAed(receipt));
}

export function expenseClaimAmount(claim: ExpenseClaimReportRow): number {
  const amount = Number(claim.total_amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function payrollAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function payrollPeriodLabel(run?: PayrollRunReportRow | null): string {
  if (!run) return "-";
  const periodDate = payrollRunPeriodDate(run);
  return periodDate ? reportMonthYear(periodDate) : `${run.period_month}/${run.period_year}`;
}

export function fixedAssetAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function roundReportAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isNonDepreciableFixedAsset(asset: Pick<FixedAssetReportRow, "category">): boolean {
  return asset.category.trim().toLowerCase() === "land";
}

export function startOfReportMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function calendarMonthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export function daysInReportMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function depreciationStatusLabel(status: DepreciationScheduleStatus): string {
  if (status === "ready") return reportText("deprReady", "Ready to post");
  if (status === "fully_depreciated") return reportText("deprFully", "Fully depreciated");
  if (status === "non_depreciable") return reportText("deprNon", "Non-depreciable");
  if (status === "not_acquired") return reportText("deprNotAcquired", "Not acquired");
  return reportText("deprReview", "Review");
}

export function depreciationStatusVariant(
  status: DepreciationScheduleStatus
): BadgeProps["variant"] {
  if (status === "ready") return "success";
  if (status === "review") return "warning";
  if (status === "not_acquired") return "neutral";
  return "info";
}

export function calculateDepreciationScheduleRow(
  asset: FixedAssetValuationRow,
  periodDate: Date
): DepreciationScheduleRow {
  const purchaseDate = new Date(asset.purchase_date);
  const purchaseMonth = Number.isNaN(purchaseDate.getTime())
    ? null
    : startOfReportMonth(purchaseDate);
  const periodMonth = startOfReportMonth(periodDate);
  const method = asset.depreciation_method || "straight_line";
  const rawUsefulLifeYears = Number(asset.useful_life_years ?? 0);
  const usefulLifeYears =
    Number.isFinite(rawUsefulLifeYears) && rawUsefulLifeYears > 0 ? rawUsefulLifeYears : null;
  const usefulLifeMonths = usefulLifeYears ? usefulLifeYears * 12 : 0;
  const depreciableBase = Math.max(0, asset.purchaseCost - asset.salvageValue);
  const remainingDepreciable = Math.max(0, depreciableBase - asset.accumulatedDepreciation);
  const baseRow = {
    assetId: asset.id,
    assetName: asset.asset_name,
    assetNumber: asset.asset_number || asset.serial_number || "",
    category: asset.category,
    purchaseDate: asset.purchase_date,
    method,
    usefulLifeYears,
    purchaseCost: asset.purchaseCost,
    salvageValue: asset.salvageValue,
    accumulatedDepreciation: asset.accumulatedDepreciation,
    netBookValue: asset.netBookValue,
    depreciableBase,
    remainingDepreciable,
    monthsRemaining: usefulLifeMonths,
    prorationFactor: 1,
    monthlyDepreciation: 0,
    annualDepreciation: 0,
    projectedAccumulatedDepreciation: asset.accumulatedDepreciation,
    projectedNetBookValue: asset.netBookValue,
  };

  if (isNonDepreciableFixedAsset(asset)) {
    return {
      ...baseRow,
      status: "non_depreciable",
      statusLabel: depreciationStatusLabel("non_depreciable"),
      reviewReason: reportText("deprLand", "Land and other non-depreciable assets are excluded."),
    };
  }

  if (!purchaseMonth || !asset.purchaseCost || !usefulLifeYears || !usefulLifeMonths) {
    return {
      ...baseRow,
      status: "review",
      statusLabel: depreciationStatusLabel("review"),
      reviewReason: !purchaseMonth
        ? reportText("deprNoDate", "Purchase date is missing or invalid.")
        : !asset.purchaseCost
          ? reportText("deprNoCost", "Purchase cost is missing.")
          : reportText("deprNoLife", "Useful life is missing."),
    };
  }

  const monthsElapsed = calendarMonthsBetween(purchaseMonth, periodMonth);
  if (monthsElapsed < 0) {
    return {
      ...baseRow,
      status: "not_acquired",
      statusLabel: depreciationStatusLabel("not_acquired"),
      reviewReason: reportText("deprNotYet", "Asset was not acquired by this report period."),
    };
  }

  if (remainingDepreciable <= 0.005 || asset.netBookValue <= asset.salvageValue + 0.005) {
    return {
      ...baseRow,
      monthsRemaining: 0,
      status: "fully_depreciated",
      statusLabel: depreciationStatusLabel("fully_depreciated"),
      reviewReason: reportText("deprAtSalvage", "Net book value is at or below salvage value."),
    };
  }

  const monthsRemaining = Math.max(1, usefulLifeMonths - monthsElapsed);
  const currentNetBookValue = Math.max(0, asset.purchaseCost - asset.accumulatedDepreciation);
  let monthlyDepreciation =
    method === "declining_balance"
      ? (currentNetBookValue * (2 / (usefulLifeMonths / 12))) / 12
      : remainingDepreciable / monthsRemaining;
  let prorationFactor = 1;

  if (monthsElapsed === 0) {
    prorationFactor =
      (daysInReportMonth(purchaseDate) - purchaseDate.getDate() + 1) /
      daysInReportMonth(purchaseDate);
    monthlyDepreciation *= prorationFactor;
  }

  monthlyDepreciation = roundReportAmount(
    Math.min(Math.max(0, monthlyDepreciation), remainingDepreciable)
  );
  const projectedAccumulatedDepreciation = roundReportAmount(
    asset.accumulatedDepreciation + monthlyDepreciation
  );
  const projectedNetBookValue = roundReportAmount(
    Math.max(asset.salvageValue, asset.purchaseCost - projectedAccumulatedDepreciation)
  );

  return {
    ...baseRow,
    monthsRemaining,
    prorationFactor,
    monthlyDepreciation,
    annualDepreciation: roundReportAmount(monthlyDepreciation * 12),
    projectedAccumulatedDepreciation,
    projectedNetBookValue,
    status: monthlyDepreciation > 0 ? "ready" : "review",
    statusLabel: depreciationStatusLabel(monthlyDepreciation > 0 ? "ready" : "review"),
    reviewReason:
      monthlyDepreciation > 0
        ? reportText("deprEstimated", "Estimated depreciation for the report period.")
        : reportText("deprNone", "No depreciation amount calculated for this period."),
  };
}

export function buildDepreciationScheduleReport(
  assets: FixedAssetValuationRow[],
  periodDate: Date
): DepreciationScheduleReport {
  const rows = assets
    .map((asset) => calculateDepreciationScheduleRow(asset, periodDate))
    .sort(
      (a, b) =>
        b.monthlyDepreciation - a.monthlyDepreciation || a.assetName.localeCompare(b.assetName)
    );
  const readyRows = rows.filter((row) => row.status === "ready");
  const reviewRows = rows.filter((row) => row.status === "review");

  return {
    period: format(periodDate, "yyyy-MM"),
    rows,
    readyRows,
    reviewRows,
    assetCount: rows.length,
    depreciableAssetCount: rows.filter((row) => row.status !== "non_depreciable").length,
    readyToPostCount: readyRows.length,
    reviewCount: reviewRows.length,
    reviewValueAed: roundReportAmount(
      reviewRows.reduce((sum, row) => sum + Math.max(0, row.remainingDepreciable), 0)
    ),
    fullyDepreciatedCount: rows.filter((row) => row.status === "fully_depreciated").length,
    nonDepreciableCount: rows.filter((row) => row.status === "non_depreciable").length,
    periodDepreciationAed: roundReportAmount(
      readyRows.reduce((sum, row) => sum + row.monthlyDepreciation, 0)
    ),
    annualDepreciationAed: roundReportAmount(
      readyRows.reduce((sum, row) => sum + row.annualDepreciation, 0)
    ),
    remainingDepreciableAed: roundReportAmount(
      rows.reduce((sum, row) => sum + row.remainingDepreciable, 0)
    ),
  };
}

export function buildConsolidatedStatementsReport(
  sources: ConsolidatedCompanyStatementSource[],
  periodLabel: string,
  currency = "AED"
): ConsolidatedStatementsReport {
  const rows = sources
    .map((source) => {
      const revenue = roundReportAmount(source.profitLoss?.totalRevenue ?? 0);
      const expenses = roundReportAmount(source.profitLoss?.totalExpenses ?? 0);
      const netProfit = roundReportAmount(source.profitLoss?.netProfit ?? 0);
      const currentComparisonRevenue = roundReportAmount(
        source.comparisonCurrentProfitLoss?.totalRevenue ?? 0
      );
      const previousRevenue = roundReportAmount(
        source.comparisonPreviousProfitLoss?.totalRevenue ?? 0
      );
      const currentComparisonExpenses = roundReportAmount(
        source.comparisonCurrentProfitLoss?.totalExpenses ?? 0
      );
      const previousExpenses = roundReportAmount(
        source.comparisonPreviousProfitLoss?.totalExpenses ?? 0
      );
      const currentComparisonNetProfit = roundReportAmount(
        source.comparisonCurrentProfitLoss?.netProfit ?? 0
      );
      const previousNetProfit = roundReportAmount(
        source.comparisonPreviousProfitLoss?.netProfit ?? 0
      );
      const assets = roundReportAmount(source.balanceSheet?.totalAssets ?? 0);
      const liabilities = roundReportAmount(source.balanceSheet?.totalLiabilities ?? 0);
      const equity = roundReportAmount(source.balanceSheet?.totalEquity ?? 0);
      const balanceDifference = roundReportAmount(assets - liabilities - equity);
      const isBalanced = Math.abs(balanceDifference) < 0.01;
      const isMultiCurrency = source.baseCurrency !== currency;
      const reviewReasons: string[] = [];
      let status: ConsolidatedStatementStatus = "included";

      if (source.error) {
        status = "failed";
        reviewReasons.push(source.error);
      } else {
        if (!isBalanced) {
          status = "unbalanced";
          reviewReasons.push(`${currency} ${balanceDifference.toFixed(2)} balance difference.`);
        }
        if (isMultiCurrency) {
          if (status === "included") status = "multi_currency";
          reviewReasons.push(`${source.baseCurrency} needs FX translation review.`);
        }
      }

      return {
        companyId: source.companyId,
        companyName: source.companyName,
        companyType: source.companyType,
        baseCurrency: source.baseCurrency,
        revenue,
        expenses,
        netProfit,
        currentComparisonRevenue,
        previousRevenue,
        currentComparisonExpenses,
        previousExpenses,
        currentComparisonNetProfit,
        previousNetProfit,
        assets,
        liabilities,
        equity,
        balanceDifference,
        isBalanced,
        status,
        statusLabel:
          status === "failed"
            ? translateNow("reportCenter.statusMissingData")
            : status === "unbalanced"
              ? translateNow("reportCenter.statusBalanceReview")
              : status === "multi_currency"
                ? reportText("consFxReview", "FX review")
                : reportText("consIncluded", "Included"),
        reviewReason: reviewReasons.join(" "),
        workflow: "/financial-statements",
      };
    })
    .sort((a, b) => b.netProfit - a.netProfit || a.companyName.localeCompare(b.companyName));

  const loadedRows = rows.filter((row) => row.status !== "failed");
  const failedEntityCount = rows.length - loadedRows.length;
  const unbalancedEntityCount = loadedRows.filter((row) => !row.isBalanced).length;
  const multiCurrencyEntityCount = loadedRows.filter((row) => row.baseCurrency !== currency).length;
  const singleEntityOnly = rows.length === 1;
  const reviewCount =
    failedEntityCount +
    unbalancedEntityCount +
    multiCurrencyEntityCount +
    (singleEntityOnly ? 1 : 0);

  const totalRevenue = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.revenue, 0));
  const totalExpenses = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.expenses, 0));
  const netProfit = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.netProfit, 0));
  const currentComparisonRevenue = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.currentComparisonRevenue, 0)
  );
  const previousRevenue = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.previousRevenue, 0)
  );
  const currentComparisonExpenses = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.currentComparisonExpenses, 0)
  );
  const previousExpenses = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.previousExpenses, 0)
  );
  const currentComparisonNetProfit = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.currentComparisonNetProfit, 0)
  );
  const previousNetProfit = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.previousNetProfit, 0)
  );
  const totalAssets = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.assets, 0));
  const totalLiabilities = roundReportAmount(
    loadedRows.reduce((sum, row) => sum + row.liabilities, 0)
  );
  const totalEquity = roundReportAmount(loadedRows.reduce((sum, row) => sum + row.equity, 0));
  const balanceDifference = roundReportAmount(totalAssets - totalLiabilities - totalEquity);

  return {
    periodLabel,
    currency,
    consolidationBasis: reportText(
      "consolidationBasis",
      "Management roll-up of accessible companies; no eliminations applied."
    ),
    rows,
    entityCount: rows.length,
    loadedEntityCount: loadedRows.length,
    failedEntityCount,
    unbalancedEntityCount,
    multiCurrencyEntityCount,
    reviewCount,
    singleEntityOnly,
    totalRevenue,
    totalExpenses,
    netProfit,
    currentComparisonRevenue,
    previousRevenue,
    currentComparisonExpenses,
    previousExpenses,
    currentComparisonNetProfit,
    previousNetProfit,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanceDifference,
    eliminationsApplied: 0,
    statusLabel:
      reviewCount > 0
        ? singleEntityOnly
          ? reportText("consSingle", "Single entity roll-up")
          : translateNow("reportCenter.statusReviewBeforeDelivery")
        : reportText("consReady", "Ready for pack"),
  };
}

export function inventoryAmount(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function inventoryMovementValue(movement: InventoryMovementReportRow): number {
  return Math.abs(Number(movement.quantity ?? 0) || 0) * inventoryAmount(movement.unitCost);
}

export function journalEntryInDateRange(
  entry: JournalEntryReportRow,
  dateRange: DateRange
): boolean {
  return valueInDateRange(entry.date, dateRange);
}

/** Account name for display: the Arabic name in Arabic mode when the account has one. */
export function journalAccountName(account?: JournalAccount | null): string {
  if (reportLocale() === "ar" && account?.nameAr) return account.nameAr;
  return account?.nameEn || account?.nameAr || reportText("unknownAccount", "Unknown Account");
}

export function journalSourceLabel(source?: string | null): string {
  if (!source) return "Manual / no source";
  return source.replace(/[_-]+/g, " ");
}

export function formatReportDate(value?: string | null): string {
  if (!value) return "-";
  const date = parseCalendarDate(value);
  return Number.isNaN(date.getTime()) ? "-" : reportDate(date);
}

export function consolidatedStatusVariant(
  status: ConsolidatedStatementStatus
): BadgeProps["variant"] {
  if (status === "included") return "success";
  if (status === "multi_currency") return "info";
  if (status === "unbalanced") return "warning";
  return "danger";
}

export function invoiceStatusLabel(status: string): string {
  return invoiceStatusLabels[status] ?? status;
}

export function invoiceStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "paid") return "success";
  if (status === "sent" || status === "posted") return "info";
  if (status === "partial") return "warning";
  if (status === "void" || status === "cancelled") return "danger";
  return "neutral";
}

export function expenseClaimStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "paid") return "success";
  if (status === "approved") return "info";
  if (status === "submitted") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function payrollStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "approved" || status === "paid") return "success";
  if (status === "calculated") return "info";
  if (status === "draft") return "warning";
  return "neutral";
}

export function fixedAssetStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "active") return "success";
  if (status === "disposed") return "neutral";
  return "warning";
}

export function inventoryMovementVariant(type: string): BadgeProps["variant"] {
  if (type === "purchase" || type === "return") return "success";
  if (type === "sale") return "info";
  if (type === "adjustment") return "warning";
  return "neutral";
}

export function activityLogLabel(value: string | null | undefined, fallback = "Unknown"): string {
  if (!value) return fallback;
  return value.replace(/[_.-]+/g, " ");
}

export function activityLogRiskLevel(log: ActivityLogReportRow): ActivityLogRiskLevel {
  const signal = `${log.action} ${log.description}`.toLowerCase();
  if (/(delete|void|reject|failed|error|remove|archive)/.test(signal)) return "High";
  if (/(update|approve|post|journal|close|permission|admin|invite)/.test(signal)) return "Medium";
  return "Low";
}

export function activityLogRiskVariant(risk: ActivityLogRiskLevel): BadgeProps["variant"] {
  if (risk === "High") return "danger";
  if (risk === "Medium") return "warning";
  return "success";
}

export function corporateTaxEstimateStatus(report?: CorporateTaxEstimateReport | null): {
  label: string;
  detail: string;
  variant: BadgeProps["variant"];
} {
  if (!report) {
    return {
      label: reportText("ctPending", "Pending estimate"),
      detail: reportText("ctPendingDetail", "Waiting for posted journal data."),
      variant: "neutral",
    };
  }

  if (report.taxPayable > 0.005) {
    return {
      label: reportText("ctDue", "Tax due"),
      detail: reportText("ctDueDetail", "Review the tax workpaper before drafting the return."),
      variant: "warning",
    };
  }

  if (report.taxableIncome <= 0) {
    return {
      label: reportText("ctNoIncome", "No taxable income"),
      detail: reportText(
        "ctNoIncomeDetail",
        "The selected period is at or below break-even before adjustments."
      ),
      variant: "success",
    };
  }

  return {
    label: reportText("ctBelow", "Below threshold"),
    detail: reportText(
      "ctBelowDetail",
      "Taxable income is below the zero-rate band used by the workspace."
    ),
    variant: "success",
  };
}
