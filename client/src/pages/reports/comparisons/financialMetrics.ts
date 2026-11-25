// P&L, balance, cash, receivable and payable comparison metric rows.
// Split from the Reports page comparisonRows memo (R20-09); behaviour unchanged.
import { ComparisonMetricRow, makeComparisonMetric } from "../shared";
import type { ComparisonRowsInput } from "./comparisonRowsInput";
import type { ComputeDocumentComparisonFiguresResult } from "./documentFigures";
import type { ComputeOperationsComparisonFiguresResult } from "./operationsFigures";

export function financialComparisonMetrics({
  comparisonCurrentProfitLoss,
  comparisonCurrentSalesProductService,
  comparisonPreviousProfitLoss,
  comparisonPreviousSalesProductService,
  currentAverageDueSoonBillValue,
  currentAverageDueSoonInvoiceValue,
  currentAverageInvoiceValue,
  currentAverageOpenBillValue,
  currentAverageOpenInvoiceValue,
  currentAverageOverdueBillDays,
  currentAverageOverdueBillValue,
  currentAverageOverdueInvoiceDays,
  currentAverageOverdueInvoiceValue,
  currentAverageVendorBillValue,
  currentBreakEvenGap,
  currentBudgetActualValue,
  currentBudgetBaselineValue,
  currentBurnRate,
  currentCashConversionGap,
  currentCashRiskWeekCount,
  currentCollectionDays,
  currentDebtEquityRatio,
  currentDueSoonBillShare,
  currentDueSoonBillValue,
  currentDueSoonBills,
  currentDueSoonCashCoverage,
  currentDueSoonCashGap,
  currentDueSoonInvoiceShare,
  currentDueSoonReceivableInvoices,
  currentDueSoonReceivableValue,
  currentDueSoonWorkloadGap,
  currentExpenseRatio,
  currentInvoiceValue,
  currentInvoices,
  currentLiabilityAssetRatio,
  currentNetMargin,
  currentOpenBillShare,
  currentOpenBillValueShare,
  currentOpenCashCoverage,
  currentOpenCashGap,
  currentOpenInvoiceShare,
  currentOpenInvoiceValueShare,
  currentOpenPayableValue,
  currentOpenReceivableInvoices,
  currentOpenReceivableValue,
  currentOpenWorkloadGap,
  currentOperatingCashFlow,
  currentOverdueBillCount,
  currentOverdueBillShare,
  currentOverdueCashCoverage,
  currentOverdueCashGap,
  currentOverdueInvoiceCount,
  currentOverdueInvoiceShare,
  currentOverduePayableShare,
  currentOverduePayableValue,
  currentOverdueReceivableShare,
  currentOverdueReceivableValue,
  currentOverdueWorkloadGap,
  currentPaidInvoiceShare,
  currentPaidVendorBillShare,
  currentPayableDays,
  currentProjectedCashShortfall,
  currentRevenueExpenseCoverage,
  currentRunwayDays,
  currentTopCustomerShare,
  currentTopVendorShare,
  currentVendorBillDocuments,
  currentVendorBillValue,
  currentVendorBills,
  currentWorkingCapitalProxy,
  previousAverageDueSoonBillValue,
  previousAverageDueSoonInvoiceValue,
  previousAverageInvoiceValue,
  previousAverageOpenBillValue,
  previousAverageOpenInvoiceValue,
  previousAverageOverdueBillDays,
  previousAverageOverdueBillValue,
  previousAverageOverdueInvoiceDays,
  previousAverageOverdueInvoiceValue,
  previousAverageVendorBillValue,
  previousBreakEvenGap,
  previousBurnRate,
  previousCashConversionGap,
  previousCollectionDays,
  previousDebtEquityRatio,
  previousDueSoonBillShare,
  previousDueSoonBillValue,
  previousDueSoonBills,
  previousDueSoonCashCoverage,
  previousDueSoonCashGap,
  previousDueSoonInvoiceShare,
  previousDueSoonReceivableInvoices,
  previousDueSoonReceivableValue,
  previousDueSoonWorkloadGap,
  previousExpenseRatio,
  previousInvoiceValue,
  previousInvoices,
  previousLiabilityAssetRatio,
  previousNetMargin,
  previousOpenBillShare,
  previousOpenBillValueShare,
  previousOpenCashCoverage,
  previousOpenCashGap,
  previousOpenInvoiceShare,
  previousOpenInvoiceValueShare,
  previousOpenPayableValue,
  previousOpenReceivableInvoices,
  previousOpenReceivableValue,
  previousOpenWorkloadGap,
  previousOperatingCashFlow,
  previousOverdueBillCount,
  previousOverdueBillShare,
  previousOverdueCashCoverage,
  previousOverdueCashGap,
  previousOverdueInvoiceCount,
  previousOverdueInvoiceShare,
  previousOverduePayableShare,
  previousOverduePayableValue,
  previousOverdueReceivableShare,
  previousOverdueReceivableValue,
  previousOverdueWorkloadGap,
  previousPaidInvoiceShare,
  previousPaidVendorBillShare,
  previousPayableDays,
  previousRevenueExpenseCoverage,
  previousRunwayDays,
  previousTopCustomerShare,
  previousTopVendorShare,
  previousVendorBillDocuments,
  previousVendorBillValue,
  previousVendorBills,
  previousWorkingCapitalProxy,
}: Pick<
  ComparisonRowsInput &
    ComputeDocumentComparisonFiguresResult &
    ComputeOperationsComparisonFiguresResult,
  | "comparisonCurrentProfitLoss"
  | "comparisonCurrentSalesProductService"
  | "comparisonPreviousProfitLoss"
  | "comparisonPreviousSalesProductService"
  | "currentAverageDueSoonBillValue"
  | "currentAverageDueSoonInvoiceValue"
  | "currentAverageInvoiceValue"
  | "currentAverageOpenBillValue"
  | "currentAverageOpenInvoiceValue"
  | "currentAverageOverdueBillDays"
  | "currentAverageOverdueBillValue"
  | "currentAverageOverdueInvoiceDays"
  | "currentAverageOverdueInvoiceValue"
  | "currentAverageVendorBillValue"
  | "currentBreakEvenGap"
  | "currentBudgetActualValue"
  | "currentBudgetBaselineValue"
  | "currentBurnRate"
  | "currentCashConversionGap"
  | "currentCashRiskWeekCount"
  | "currentCollectionDays"
  | "currentDebtEquityRatio"
  | "currentDueSoonBillShare"
  | "currentDueSoonBillValue"
  | "currentDueSoonBills"
  | "currentDueSoonCashCoverage"
  | "currentDueSoonCashGap"
  | "currentDueSoonInvoiceShare"
  | "currentDueSoonReceivableInvoices"
  | "currentDueSoonReceivableValue"
  | "currentDueSoonWorkloadGap"
  | "currentExpenseRatio"
  | "currentInvoiceValue"
  | "currentInvoices"
  | "currentLiabilityAssetRatio"
  | "currentNetMargin"
  | "currentOpenBillShare"
  | "currentOpenBillValueShare"
  | "currentOpenCashCoverage"
  | "currentOpenCashGap"
  | "currentOpenInvoiceShare"
  | "currentOpenInvoiceValueShare"
  | "currentOpenPayableValue"
  | "currentOpenReceivableInvoices"
  | "currentOpenReceivableValue"
  | "currentOpenWorkloadGap"
  | "currentOperatingCashFlow"
  | "currentOverdueBillCount"
  | "currentOverdueBillShare"
  | "currentOverdueCashCoverage"
  | "currentOverdueCashGap"
  | "currentOverdueInvoiceCount"
  | "currentOverdueInvoiceShare"
  | "currentOverduePayableShare"
  | "currentOverduePayableValue"
  | "currentOverdueReceivableShare"
  | "currentOverdueReceivableValue"
  | "currentOverdueWorkloadGap"
  | "currentPaidInvoiceShare"
  | "currentPaidVendorBillShare"
  | "currentPayableDays"
  | "currentProjectedCashShortfall"
  | "currentRevenueExpenseCoverage"
  | "currentRunwayDays"
  | "currentTopCustomerShare"
  | "currentTopVendorShare"
  | "currentVendorBillDocuments"
  | "currentVendorBillValue"
  | "currentVendorBills"
  | "currentWorkingCapitalProxy"
  | "previousAverageDueSoonBillValue"
  | "previousAverageDueSoonInvoiceValue"
  | "previousAverageInvoiceValue"
  | "previousAverageOpenBillValue"
  | "previousAverageOpenInvoiceValue"
  | "previousAverageOverdueBillDays"
  | "previousAverageOverdueBillValue"
  | "previousAverageOverdueInvoiceDays"
  | "previousAverageOverdueInvoiceValue"
  | "previousAverageVendorBillValue"
  | "previousBreakEvenGap"
  | "previousBurnRate"
  | "previousCashConversionGap"
  | "previousCollectionDays"
  | "previousDebtEquityRatio"
  | "previousDueSoonBillShare"
  | "previousDueSoonBillValue"
  | "previousDueSoonBills"
  | "previousDueSoonCashCoverage"
  | "previousDueSoonCashGap"
  | "previousDueSoonInvoiceShare"
  | "previousDueSoonReceivableInvoices"
  | "previousDueSoonReceivableValue"
  | "previousDueSoonWorkloadGap"
  | "previousExpenseRatio"
  | "previousInvoiceValue"
  | "previousInvoices"
  | "previousLiabilityAssetRatio"
  | "previousNetMargin"
  | "previousOpenBillShare"
  | "previousOpenBillValueShare"
  | "previousOpenCashCoverage"
  | "previousOpenCashGap"
  | "previousOpenInvoiceShare"
  | "previousOpenInvoiceValueShare"
  | "previousOpenPayableValue"
  | "previousOpenReceivableInvoices"
  | "previousOpenReceivableValue"
  | "previousOpenWorkloadGap"
  | "previousOperatingCashFlow"
  | "previousOverdueBillCount"
  | "previousOverdueBillShare"
  | "previousOverdueCashCoverage"
  | "previousOverdueCashGap"
  | "previousOverdueInvoiceCount"
  | "previousOverdueInvoiceShare"
  | "previousOverduePayableShare"
  | "previousOverduePayableValue"
  | "previousOverdueReceivableShare"
  | "previousOverdueReceivableValue"
  | "previousOverdueWorkloadGap"
  | "previousPaidInvoiceShare"
  | "previousPaidVendorBillShare"
  | "previousPayableDays"
  | "previousRevenueExpenseCoverage"
  | "previousRunwayDays"
  | "previousTopCustomerShare"
  | "previousTopVendorShare"
  | "previousVendorBillDocuments"
  | "previousVendorBillValue"
  | "previousVendorBills"
  | "previousWorkingCapitalProxy"
>): ComparisonMetricRow[] {
  return [
    makeComparisonMetric({
      id: "revenue",
      label: "Revenue",
      current: comparisonCurrentProfitLoss?.totalRevenue ?? 0,
      previous: comparisonPreviousProfitLoss?.totalRevenue ?? 0,
      currency: "AED",
      signal: "Growth",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "pl",
    }),
    makeComparisonMetric({
      id: "net-profit",
      label: "Net profit",
      current: comparisonCurrentProfitLoss?.netProfit ?? 0,
      previous: comparisonPreviousProfitLoss?.netProfit ?? 0,
      currency: "AED",
      signal: "Profitability",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "pl",
    }),
    makeComparisonMetric({
      id: "net-margin",
      label: "Net margin",
      current: currentNetMargin,
      previous: previousNetMargin,
      currency: "%",
      signal: "Profit efficiency",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "pl",
    }),
    makeComparisonMetric({
      id: "expense-ratio",
      label: "Expense ratio",
      current: currentExpenseRatio,
      previous: previousExpenseRatio,
      currency: "%",
      signal: "Cost efficiency",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "pl",
    }),
    makeComparisonMetric({
      id: "revenue-expense-coverage",
      label: "Revenue expense coverage",
      current: currentRevenueExpenseCoverage,
      previous: previousRevenueExpenseCoverage,
      currency: "%",
      signal: "Revenue covers expenses",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "pl",
    }),
    makeComparisonMetric({
      id: "break-even-gap",
      label: "Break-even gap",
      current: currentBreakEvenGap,
      previous: previousBreakEvenGap,
      currency: "AED",
      signal: "Break-even shortfall",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "pl",
    }),
    makeComparisonMetric({
      id: "invoice-value",
      label: "Invoice value",
      current: currentInvoiceValue,
      previous: previousInvoiceValue,
      currency: "AED",
      signal: "Sales activity",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "sales",
    }),
    makeComparisonMetric({
      id: "invoice-count",
      label: "Invoice count",
      current: currentInvoices.length,
      previous: previousInvoices.length,
      currency: "count",
      signal: "Invoice volume",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "sales",
    }),
    makeComparisonMetric({
      id: "paid-invoice-share",
      label: "Paid invoice share",
      current: currentPaidInvoiceShare,
      previous: previousPaidInvoiceShare,
      currency: "%",
      signal: "Collections effectiveness",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "sales",
    }),
    makeComparisonMetric({
      id: "average-invoice-value",
      label: "Average invoice value",
      current: currentAverageInvoiceValue,
      previous: previousAverageInvoiceValue,
      currency: "AED",
      signal: "Deal size",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "sales",
    }),
    makeComparisonMetric({
      id: "liability-asset-ratio",
      label: "Liabilities to assets",
      current: currentLiabilityAssetRatio,
      previous: previousLiabilityAssetRatio,
      currency: "%",
      signal: "Balance leverage",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "bs",
    }),
    makeComparisonMetric({
      id: "debt-to-equity-ratio",
      label: "Debt to equity",
      current: currentDebtEquityRatio,
      previous: previousDebtEquityRatio,
      currency: "%",
      signal: "Capital structure",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "bs",
    }),
    makeComparisonMetric({
      id: "burn-rate",
      label: "Monthly burn rate",
      current: currentBurnRate,
      previous: previousBurnRate,
      currency: "AED",
      signal: "Cash pressure",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "cash-runway-days",
      label: "Cash runway coverage",
      current: currentRunwayDays,
      previous: previousRunwayDays,
      currency: "days",
      signal: "90-day runway",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "projected-cash-shortfall",
      label: "Projected cash shortfall",
      current: currentProjectedCashShortfall,
      previous: 0,
      currentLabel: "Forecast",
      previousLabel: "Zero shortfall",
      currency: "AED",
      signal: "Negative cash risk",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "cash-risk-week-count",
      label: "Cash risk week count",
      current: currentCashRiskWeekCount,
      previous: 0,
      currentLabel: "Forecast",
      previousLabel: "Clear weeks",
      currency: "count",
      signal: "Forecast risk weeks",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "operating-cash-flow",
      label: "Operating cash flow",
      current: currentOperatingCashFlow,
      previous: previousOperatingCashFlow,
      currency: "AED",
      signal: "Cash movement",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "budget-actual-variance",
      label: "Budget actual variance",
      current: currentBudgetActualValue,
      previous: currentBudgetBaselineValue,
      currentLabel: "Actual",
      previousLabel: "Budget",
      currency: "AED",
      signal: "Budget vs actual",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "open-receivables",
      label: "Open receivables",
      current: currentOpenReceivableValue,
      previous: previousOpenReceivableValue,
      currency: "AED",
      signal: "Collections pressure",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "open-invoice-count",
      label: "Open invoice count",
      current: currentOpenReceivableInvoices.length,
      previous: previousOpenReceivableInvoices.length,
      currency: "count",
      signal: "Collections workload",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-open-invoice-value",
      label: "Average open invoice value",
      current: currentAverageOpenInvoiceValue,
      previous: previousAverageOpenInvoiceValue,
      currency: "AED",
      signal: "Open invoice size",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "open-invoice-value-share",
      label: "Open invoice value share",
      current: currentOpenInvoiceValueShare,
      previous: previousOpenInvoiceValueShare,
      currency: "%",
      signal: "Collections value mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "due-soon-invoice-count",
      label: "Invoices due soon",
      current: currentDueSoonReceivableInvoices.length,
      previous: previousDueSoonReceivableInvoices.length,
      currency: "count",
      signal: "7-day collections queue",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "due-soon-invoice-value",
      label: "Value due soon",
      current: currentDueSoonReceivableValue,
      previous: previousDueSoonReceivableValue,
      currency: "AED",
      signal: "7-day cash collection",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-due-soon-invoice-value",
      label: "Average due-soon invoice value",
      current: currentAverageDueSoonInvoiceValue,
      previous: previousAverageDueSoonInvoiceValue,
      currency: "AED",
      signal: "7-day invoice size",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "due-soon-invoice-share",
      label: "Due-soon invoice share",
      current: currentDueSoonInvoiceShare,
      previous: previousDueSoonInvoiceShare,
      currency: "%",
      signal: "7-day collections mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "open-invoice-share",
      label: "Open invoice share",
      current: currentOpenInvoiceShare,
      previous: previousOpenInvoiceShare,
      currency: "%",
      signal: "Collections workload mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "overdue-receivables",
      label: "Overdue receivables",
      current: currentOverdueReceivableValue,
      previous: previousOverdueReceivableValue,
      currency: "AED",
      signal: "A/R at risk",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "overdue-receivable-share",
      label: "Overdue receivable share",
      current: currentOverdueReceivableShare,
      previous: previousOverdueReceivableShare,
      currency: "%",
      signal: "A/R overdue mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "overdue-invoice-count",
      label: "Overdue invoice count",
      current: currentOverdueInvoiceCount,
      previous: previousOverdueInvoiceCount,
      currency: "count",
      signal: "Customer follow-ups",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-overdue-invoice-value",
      label: "Average overdue invoice value",
      current: currentAverageOverdueInvoiceValue,
      previous: previousAverageOverdueInvoiceValue,
      currency: "AED",
      signal: "Overdue invoice size",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-overdue-invoice-days",
      label: "Average overdue invoice age",
      current: currentAverageOverdueInvoiceDays,
      previous: previousAverageOverdueInvoiceDays,
      currency: "days",
      signal: "Overdue aging",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "overdue-invoice-share",
      label: "Overdue invoice share",
      current: currentOverdueInvoiceShare,
      previous: previousOverdueInvoiceShare,
      currency: "%",
      signal: "Overdue workload mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "vendor-bill-value",
      label: "Vendor bill value",
      current: currentVendorBillValue,
      previous: previousVendorBillValue,
      currency: "AED",
      signal: "Supplier spend",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "vendor-bill-count",
      label: "Vendor bill count",
      current: currentVendorBillDocuments.length,
      previous: previousVendorBillDocuments.length,
      currency: "count",
      signal: "Supplier bill volume",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-bill-value",
      label: "Average bill value",
      current: currentAverageVendorBillValue,
      previous: previousAverageVendorBillValue,
      currency: "AED",
      signal: "Supplier bill size",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "top-vendor-share",
      label: "Top vendor share",
      current: currentTopVendorShare,
      previous: previousTopVendorShare,
      currency: "%",
      signal: "Supplier concentration",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "paid-bill-share",
      label: "Paid bill share",
      current: currentPaidVendorBillShare,
      previous: previousPaidVendorBillShare,
      currency: "%",
      signal: "Supplier payment coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "open-payables",
      label: "Open payables",
      current: currentOpenPayableValue,
      previous: previousOpenPayableValue,
      currency: "AED",
      signal: "Bill-pay pressure",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "open-bill-value-share",
      label: "Open bill value share",
      current: currentOpenBillValueShare,
      previous: previousOpenBillValueShare,
      currency: "%",
      signal: "Bill-pay value mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "open-cash-gap",
      label: "Open cash gap",
      current: currentOpenCashGap,
      previous: previousOpenCashGap,
      currency: "AED",
      signal: "Net unpaid pressure",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "open-cash-coverage",
      label: "Open cash coverage",
      current: currentOpenCashCoverage,
      previous: previousOpenCashCoverage,
      currency: "%",
      signal: "Open bill coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "open-workload-gap",
      label: "Open workload gap",
      current: currentOpenWorkloadGap,
      previous: previousOpenWorkloadGap,
      currency: "count",
      signal: "Net unpaid workload",
      favorable: "neutral",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "open-bill-count",
      label: "Open bill count",
      current: currentVendorBills.length,
      previous: previousVendorBills.length,
      currency: "count",
      signal: "Bill-pay workload",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-open-bill-value",
      label: "Average open bill value",
      current: currentAverageOpenBillValue,
      previous: previousAverageOpenBillValue,
      currency: "AED",
      signal: "Open bill size",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "due-soon-bill-count",
      label: "Bills due soon",
      current: currentDueSoonBills.length,
      previous: previousDueSoonBills.length,
      currency: "count",
      signal: "7-day bill-pay queue",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "due-soon-bill-value",
      label: "Value due soon",
      current: currentDueSoonBillValue,
      previous: previousDueSoonBillValue,
      currency: "AED",
      signal: "7-day cash need",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-due-soon-bill-value",
      label: "Average due-soon bill value",
      current: currentAverageDueSoonBillValue,
      previous: previousAverageDueSoonBillValue,
      currency: "AED",
      signal: "7-day bill size",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "due-soon-bill-share",
      label: "Due-soon bill share",
      current: currentDueSoonBillShare,
      previous: previousDueSoonBillShare,
      currency: "%",
      signal: "7-day bill-pay mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "due-soon-cash-gap",
      label: "Due-soon cash gap",
      current: currentDueSoonCashGap,
      previous: previousDueSoonCashGap,
      currency: "AED",
      signal: "7-day net cash need",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "due-soon-cash-coverage",
      label: "Due-soon cash coverage",
      current: currentDueSoonCashCoverage,
      previous: previousDueSoonCashCoverage,
      currency: "%",
      signal: "7-day bill coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "due-soon-workload-gap",
      label: "Due-soon workload gap",
      current: currentDueSoonWorkloadGap,
      previous: previousDueSoonWorkloadGap,
      currency: "count",
      signal: "7-day net workload",
      favorable: "neutral",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "open-bill-share",
      label: "Open bill share",
      current: currentOpenBillShare,
      previous: previousOpenBillShare,
      currency: "%",
      signal: "Bill-pay workload mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "overdue-payables",
      label: "Overdue payables",
      current: currentOverduePayableValue,
      previous: previousOverduePayableValue,
      currency: "AED",
      signal: "A/P at risk",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "overdue-cash-gap",
      label: "Overdue cash gap",
      current: currentOverdueCashGap,
      previous: previousOverdueCashGap,
      currency: "AED",
      signal: "Net overdue pressure",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "overdue-cash-coverage",
      label: "Overdue cash coverage",
      current: currentOverdueCashCoverage,
      previous: previousOverdueCashCoverage,
      currency: "%",
      signal: "Overdue bill coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "overdue-workload-gap",
      label: "Overdue workload gap",
      current: currentOverdueWorkloadGap,
      previous: previousOverdueWorkloadGap,
      currency: "count",
      signal: "Net overdue workload",
      favorable: "neutral",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "overdue-payable-share",
      label: "Overdue payable share",
      current: currentOverduePayableShare,
      previous: previousOverduePayableShare,
      currency: "%",
      signal: "A/P overdue mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "overdue-bill-count",
      label: "Overdue bill count",
      current: currentOverdueBillCount,
      previous: previousOverdueBillCount,
      currency: "count",
      signal: "Vendor follow-ups",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-overdue-bill-value",
      label: "Average overdue bill value",
      current: currentAverageOverdueBillValue,
      previous: previousAverageOverdueBillValue,
      currency: "AED",
      signal: "Overdue bill size",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "average-overdue-bill-days",
      label: "Average overdue bill age",
      current: currentAverageOverdueBillDays,
      previous: previousAverageOverdueBillDays,
      currency: "days",
      signal: "Overdue aging",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "overdue-bill-share",
      label: "Overdue bill share",
      current: currentOverdueBillShare,
      previous: previousOverdueBillShare,
      currency: "%",
      signal: "Overdue bill mix",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "working-capital-proxy",
      label: "Working capital proxy",
      current: currentWorkingCapitalProxy,
      previous: previousWorkingCapitalProxy,
      currency: "AED",
      signal: "A/R less A/P",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "collection-days",
      label: "Collection days",
      current: currentCollectionDays,
      previous: previousCollectionDays,
      currency: "days",
      signal: "DSO proxy",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "payable-days",
      label: "Payable days",
      current: currentPayableDays,
      previous: previousPayableDays,
      currency: "days",
      signal: "DPO proxy",
      favorable: "neutral",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "cash-conversion-gap",
      label: "Cash conversion gap",
      current: currentCashConversionGap,
      previous: previousCashConversionGap,
      currency: "days",
      signal: "DSO less DPO",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "top-customer-share",
      label: "Top customer share",
      current: currentTopCustomerShare,
      previous: previousTopCustomerShare,
      currency: "%",
      signal: "Client concentration",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "sales",
    }),
    makeComparisonMetric({
      id: "top-product-service-share",
      label: "Top product/service share",
      current: comparisonCurrentSalesProductService?.totals?.topProductServiceShare ?? 0,
      previous: comparisonPreviousSalesProductService?.totals?.topProductServiceShare ?? 0,
      currency: "%",
      signal: "Sales mix concentration",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "sales",
    }),
  ];
}
