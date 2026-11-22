// Spend, receipt, bank, payroll, ledger, cash, tax and close figures for the comparison ranges.
// Split from the Reports page comparisonRows memo (R20-09); behaviour unchanged.
import {
  BankTransactionReportRow,
  CashFlowStatementRow,
  ComparisonRange,
  ExpenseClaimReportRow,
  PayrollRunReportRow,
  ReceiptReportRow,
  activityLogRiskLevel,
  averageAvailablePercent,
  expenseClaimAmount,
  inventoryMovementValue,
  normalizeMonthlyBurn,
  payrollAmount,
  ratioPercent,
  receiptSpendAed,
  runwayCoverageDays,
  valueInDateRange,
} from "../shared";
import type { ComparisonRowsInput } from "./comparisonRowsInput";
import type { ComputeDocumentComparisonFiguresResult } from "./documentFigures";

export function computeOperationsComparisonFigures({
  cashFlowForecast,
  cashFlowStatement,
  comparisonCurrentBalanceSheet,
  comparisonCurrentProfitLoss,
  comparisonCurrentRange,
  comparisonCurrentVat,
  comparisonPreviousBalanceSheet,
  comparisonPreviousCorporateTaxEstimate,
  comparisonPreviousProfitLoss,
  comparisonPreviousRange,
  comparisonPreviousVat,
  consolidatedStatementsReport,
  corporateTaxEstimate,
  currentActivityLogs,
  currentBankTransactions,
  currentComparisonDays,
  currentDueSoonBillValue,
  currentDueSoonBills,
  currentDueSoonReceivableInvoices,
  currentDueSoonReceivableValue,
  currentExpenseClaims,
  currentInventoryMovements,
  currentOverdueBillCount,
  currentOverdueInvoiceCount,
  currentOverduePayableValue,
  currentOverdueReceivableValue,
  currentPayrollRuns,
  currentReceipts,
  fxGainsLosses,
  journalEntries,
  monthEndCloseStatus,
  previousActivityLogs,
  previousBankTransactions,
  previousComparisonDays,
  previousDueSoonBillValue,
  previousDueSoonBills,
  previousDueSoonReceivableInvoices,
  previousDueSoonReceivableValue,
  previousExpenseClaims,
  previousInventoryMovements,
  previousOverdueBillCount,
  previousOverdueInvoiceCount,
  previousOverduePayableValue,
  previousOverdueReceivableValue,
  previousPayrollRuns,
  previousReceipts,
  serverGroupConsolidation,
  varianceReport,
}: Pick<
  ComparisonRowsInput & ComputeDocumentComparisonFiguresResult,
  | "cashFlowForecast"
  | "cashFlowStatement"
  | "comparisonCurrentBalanceSheet"
  | "comparisonCurrentProfitLoss"
  | "comparisonCurrentRange"
  | "comparisonCurrentVat"
  | "comparisonPreviousBalanceSheet"
  | "comparisonPreviousCorporateTaxEstimate"
  | "comparisonPreviousProfitLoss"
  | "comparisonPreviousRange"
  | "comparisonPreviousVat"
  | "consolidatedStatementsReport"
  | "corporateTaxEstimate"
  | "currentActivityLogs"
  | "currentBankTransactions"
  | "currentComparisonDays"
  | "currentDueSoonBillValue"
  | "currentDueSoonBills"
  | "currentDueSoonReceivableInvoices"
  | "currentDueSoonReceivableValue"
  | "currentExpenseClaims"
  | "currentInventoryMovements"
  | "currentOverdueBillCount"
  | "currentOverdueInvoiceCount"
  | "currentOverduePayableValue"
  | "currentOverdueReceivableValue"
  | "currentPayrollRuns"
  | "currentReceipts"
  | "fxGainsLosses"
  | "journalEntries"
  | "monthEndCloseStatus"
  | "previousActivityLogs"
  | "previousBankTransactions"
  | "previousComparisonDays"
  | "previousDueSoonBillValue"
  | "previousDueSoonBills"
  | "previousDueSoonReceivableInvoices"
  | "previousDueSoonReceivableValue"
  | "previousExpenseClaims"
  | "previousInventoryMovements"
  | "previousOverdueBillCount"
  | "previousOverdueInvoiceCount"
  | "previousOverduePayableValue"
  | "previousOverdueReceivableValue"
  | "previousPayrollRuns"
  | "previousReceipts"
  | "serverGroupConsolidation"
  | "varianceReport"
>) {
  const currentExpenseValue = currentReceipts.reduce(
    (sum, receipt) => sum + receiptSpendAed(receipt),
    0
  );
  const previousExpenseValue = previousReceipts.reduce(
    (sum, receipt) => sum + receiptSpendAed(receipt),
    0
  );
  const currentAverageReceiptValue =
    currentReceipts.length > 0
      ? Math.round((currentExpenseValue / currentReceipts.length) * 100) / 100
      : 0;
  const previousAverageReceiptValue =
    previousReceipts.length > 0
      ? Math.round((previousExpenseValue / previousReceipts.length) * 100) / 100
      : 0;
  const expenseClaimReviewRows = (rows: ExpenseClaimReportRow[]) =>
    rows.filter((claim) => claim.status === "submitted" || claim.status === "approved");
  const submittedExpenseClaimRows = (rows: ExpenseClaimReportRow[]) =>
    rows.filter((claim) => claim.status === "submitted");
  const approvedExpenseClaimRows = (rows: ExpenseClaimReportRow[]) =>
    rows.filter((claim) => claim.status === "approved");
  const expenseClaimReviewValue = (rows: ExpenseClaimReportRow[]) =>
    expenseClaimReviewRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
  const submittedExpenseClaimValue = (rows: ExpenseClaimReportRow[]) =>
    submittedExpenseClaimRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
  const approvedExpenseClaimValue = (rows: ExpenseClaimReportRow[]) =>
    approvedExpenseClaimRows(rows).reduce((sum, claim) => sum + expenseClaimAmount(claim), 0);
  const currentExpenseClaimReviewValue = expenseClaimReviewValue(currentExpenseClaims);
  const previousExpenseClaimReviewValue = expenseClaimReviewValue(previousExpenseClaims);
  const currentSubmittedExpenseClaimValue = submittedExpenseClaimValue(currentExpenseClaims);
  const previousSubmittedExpenseClaimValue = submittedExpenseClaimValue(previousExpenseClaims);
  const currentApprovedExpenseClaimValue = approvedExpenseClaimValue(currentExpenseClaims);
  const previousApprovedExpenseClaimValue = approvedExpenseClaimValue(previousExpenseClaims);
  const currentExpenseClaimReviewCount = expenseClaimReviewRows(currentExpenseClaims).length;
  const previousExpenseClaimReviewCount = expenseClaimReviewRows(previousExpenseClaims).length;
  const currentSubmittedExpenseClaimCount = submittedExpenseClaimRows(currentExpenseClaims).length;
  const previousSubmittedExpenseClaimCount =
    submittedExpenseClaimRows(previousExpenseClaims).length;
  const currentApprovedExpenseClaimCount = approvedExpenseClaimRows(currentExpenseClaims).length;
  const previousApprovedExpenseClaimCount = approvedExpenseClaimRows(previousExpenseClaims).length;
  const receiptTotalAed = (receipt: ReceiptReportRow) => receiptSpendAed(receipt);
  const unpostedReceiptRows = (rows: ReceiptReportRow[]) =>
    rows.filter((receipt) => !receipt.posted);
  const unpostedReceiptValue = (rows: ReceiptReportRow[]) =>
    unpostedReceiptRows(rows).reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
  const currentUnpostedReceiptValue = unpostedReceiptValue(currentReceipts);
  const previousUnpostedReceiptValue = unpostedReceiptValue(previousReceipts);
  const unpostedExpenseShare = (rows: ReceiptReportRow[]) => {
    const total = rows.reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
    if (total <= 0.005) return 0;

    const unpostedTotal = unpostedReceiptValue(rows);
    return Math.round((unpostedTotal / total) * 10000) / 100;
  };
  const currentUnpostedExpenseShare = unpostedExpenseShare(currentReceipts);
  const previousUnpostedExpenseShare = unpostedExpenseShare(previousReceipts);
  const currentUnpostedReceiptCount = unpostedReceiptRows(currentReceipts).length;
  const previousUnpostedReceiptCount = unpostedReceiptRows(previousReceipts).length;
  const autoPostedReceiptRows = (rows: ReceiptReportRow[]) =>
    rows.filter((receipt) => receipt.autoPosted);
  const autoPostedReceiptValue = (rows: ReceiptReportRow[]) =>
    autoPostedReceiptRows(rows).reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
  const currentAutoPostedReceiptCount = autoPostedReceiptRows(currentReceipts).length;
  const previousAutoPostedReceiptCount = autoPostedReceiptRows(previousReceipts).length;
  const currentAutoPostedReceiptValue = autoPostedReceiptValue(currentReceipts);
  const previousAutoPostedReceiptValue = autoPostedReceiptValue(previousReceipts);
  const receiptAutomationCoverage = (rows: ReceiptReportRow[]) => {
    if (rows.length === 0) return 0;

    return Math.round((autoPostedReceiptRows(rows).length / rows.length) * 10000) / 100;
  };
  const currentReceiptAutomationCoverage = receiptAutomationCoverage(currentReceipts);
  const previousReceiptAutomationCoverage = receiptAutomationCoverage(previousReceipts);
  const receiptAutomationValueCoverage = (rows: ReceiptReportRow[]) => {
    const total = rows.reduce((sum, receipt) => sum + receiptTotalAed(receipt), 0);
    if (total <= 0.005) return 0;

    return Math.round((autoPostedReceiptValue(rows) / total) * 10000) / 100;
  };
  const currentReceiptAutomationValueCoverage = receiptAutomationValueCoverage(currentReceipts);
  const previousReceiptAutomationValueCoverage = receiptAutomationValueCoverage(previousReceipts);
  const bankReconciliationCoverage = (rows: BankTransactionReportRow[]) => {
    if (rows.length === 0) return 0;

    const reconciledRows = rows.filter((transaction) => transaction.isReconciled).length;
    return Math.round((reconciledRows / rows.length) * 10000) / 100;
  };
  const currentBankReconciliationCoverage = bankReconciliationCoverage(currentBankTransactions);
  const previousBankReconciliationCoverage = bankReconciliationCoverage(previousBankTransactions);
  const bankTransactionReviewValue = (transaction: BankTransactionReportRow) =>
    Math.abs(Number(transaction.amount) || 0);
  const reconciledBankTransactionRows = (rows: BankTransactionReportRow[]) =>
    rows.filter((transaction) => transaction.isReconciled);
  const currentReconciledBankCount = reconciledBankTransactionRows(currentBankTransactions).length;
  const previousReconciledBankCount =
    reconciledBankTransactionRows(previousBankTransactions).length;
  const currentReconciledBankValue = reconciledBankTransactionRows(currentBankTransactions).reduce(
    (sum, transaction) => sum + bankTransactionReviewValue(transaction),
    0
  );
  const previousReconciledBankValue = reconciledBankTransactionRows(
    previousBankTransactions
  ).reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
  const currentUnreconciledBankCount = currentBankTransactions.filter(
    (transaction) => !transaction.isReconciled
  ).length;
  const previousUnreconciledBankCount = previousBankTransactions.filter(
    (transaction) => !transaction.isReconciled
  ).length;
  const currentUnreconciledBankValue = currentBankTransactions
    .filter((transaction) => !transaction.isReconciled)
    .reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
  const previousUnreconciledBankValue = previousBankTransactions
    .filter((transaction) => !transaction.isReconciled)
    .reduce((sum, transaction) => sum + bankTransactionReviewValue(transaction), 0);
  const bankSuggestedMatchRows = (rows: BankTransactionReportRow[]) =>
    rows.filter(
      (transaction) => !transaction.isReconciled && transaction.matchStatus === "suggested"
    );
  const currentSuggestedBankMatchCount = bankSuggestedMatchRows(currentBankTransactions).length;
  const previousSuggestedBankMatchCount = bankSuggestedMatchRows(previousBankTransactions).length;
  const currentSuggestedBankMatchValue = bankSuggestedMatchRows(currentBankTransactions).reduce(
    (sum, transaction) => sum + bankTransactionReviewValue(transaction),
    0
  );
  const previousSuggestedBankMatchValue = bankSuggestedMatchRows(previousBankTransactions).reduce(
    (sum, transaction) => sum + bankTransactionReviewValue(transaction),
    0
  );
  const currentBankMatchSuggestionCoverage = ratioPercent(
    currentSuggestedBankMatchCount,
    currentUnreconciledBankCount
  );
  const previousBankMatchSuggestionCoverage = ratioPercent(
    previousSuggestedBankMatchCount,
    previousUnreconciledBankCount
  );
  const currentBankMatchSuggestionValueCoverage = ratioPercent(
    currentSuggestedBankMatchValue,
    currentUnreconciledBankValue
  );
  const previousBankMatchSuggestionValueCoverage = ratioPercent(
    previousSuggestedBankMatchValue,
    previousUnreconciledBankValue
  );
  const bankAssistedTransactionRows = (rows: BankTransactionReportRow[]) =>
    rows.filter(
      (transaction) =>
        transaction.isReconciled ||
        (!transaction.isReconciled && transaction.matchStatus === "suggested")
    );
  const bankAssistedTransactionValue = (rows: BankTransactionReportRow[]) =>
    bankAssistedTransactionRows(rows).reduce(
      (sum, transaction) => sum + bankTransactionReviewValue(transaction),
      0
    );
  const currentBankAssistedTransactionCount =
    bankAssistedTransactionRows(currentBankTransactions).length;
  const previousBankAssistedTransactionCount =
    bankAssistedTransactionRows(previousBankTransactions).length;
  const currentBankAssistedTransactionValue = bankAssistedTransactionValue(currentBankTransactions);
  const previousBankAssistedTransactionValue =
    bankAssistedTransactionValue(previousBankTransactions);
  const bankAssistedTransactionCoverage = (rows: BankTransactionReportRow[]) => {
    if (rows.length === 0) return null;

    return ratioPercent(bankAssistedTransactionRows(rows).length, rows.length);
  };
  const currentBankAssistedTransactionCoverage =
    bankAssistedTransactionCoverage(currentBankTransactions);
  const previousBankAssistedTransactionCoverage =
    bankAssistedTransactionCoverage(previousBankTransactions);
  const bankAssistedTransactionValueCoverage = (rows: BankTransactionReportRow[]) => {
    const total = rows.reduce(
      (sum, transaction) => sum + bankTransactionReviewValue(transaction),
      0
    );
    if (total <= 0.005) return null;

    return ratioPercent(bankAssistedTransactionValue(rows), total);
  };
  const currentBankAssistedTransactionValueCoverage =
    bankAssistedTransactionValueCoverage(currentBankTransactions);
  const previousBankAssistedTransactionValueCoverage =
    bankAssistedTransactionValueCoverage(previousBankTransactions);
  const currentAutomationWorkQueueCount =
    currentOverdueInvoiceCount +
    currentDueSoonReceivableInvoices.length +
    currentOverdueBillCount +
    currentDueSoonBills.length +
    currentUnpostedReceiptCount +
    currentExpenseClaimReviewCount +
    currentSuggestedBankMatchCount;
  const previousAutomationWorkQueueCount =
    previousOverdueInvoiceCount +
    previousDueSoonReceivableInvoices.length +
    previousOverdueBillCount +
    previousDueSoonBills.length +
    previousUnpostedReceiptCount +
    previousExpenseClaimReviewCount +
    previousSuggestedBankMatchCount;
  const currentAutomationWorkQueueValue =
    currentOverdueReceivableValue +
    currentDueSoonReceivableValue +
    currentOverduePayableValue +
    currentDueSoonBillValue +
    currentUnpostedReceiptValue +
    currentExpenseClaimReviewValue +
    currentSuggestedBankMatchValue;
  const previousAutomationWorkQueueValue =
    previousOverdueReceivableValue +
    previousDueSoonReceivableValue +
    previousOverduePayableValue +
    previousDueSoonBillValue +
    previousUnpostedReceiptValue +
    previousExpenseClaimReviewValue +
    previousSuggestedBankMatchValue;
  const currentPayrollValue = currentPayrollRuns.reduce(
    (sum, run) => sum + payrollAmount(run.total_net),
    0
  );
  const previousPayrollValue = previousPayrollRuns.reduce(
    (sum, run) => sum + payrollAmount(run.total_net),
    0
  );
  const payrollGrossValue = (rows: PayrollRunReportRow[]) =>
    rows.reduce(
      (sum, run) => sum + payrollAmount(run.total_basic) + payrollAmount(run.total_allowances),
      0
    );
  const payrollDeductionValue = (rows: PayrollRunReportRow[]) =>
    rows.reduce((sum, run) => sum + payrollAmount(run.total_deductions), 0);
  const currentPayrollGrossValue = payrollGrossValue(currentPayrollRuns);
  const previousPayrollGrossValue = payrollGrossValue(previousPayrollRuns);
  const currentPayrollDeductionValue = payrollDeductionValue(currentPayrollRuns);
  const previousPayrollDeductionValue = payrollDeductionValue(previousPayrollRuns);
  const currentPayrollDeductionShare = ratioPercent(
    currentPayrollDeductionValue,
    currentPayrollGrossValue
  );
  const previousPayrollDeductionShare = ratioPercent(
    previousPayrollDeductionValue,
    previousPayrollGrossValue
  );
  const currentAveragePayrollRunValue =
    currentPayrollRuns.length > 0
      ? Math.round((currentPayrollValue / currentPayrollRuns.length) * 100) / 100
      : 0;
  const previousAveragePayrollRunValue =
    previousPayrollRuns.length > 0
      ? Math.round((previousPayrollValue / previousPayrollRuns.length) * 100) / 100
      : 0;
  const currentPayrollCoveredEmployees = currentPayrollRuns.reduce(
    (sum, run) => sum + Number(run.employee_count ?? 0),
    0
  );
  const previousPayrollCoveredEmployees = previousPayrollRuns.reduce(
    (sum, run) => sum + Number(run.employee_count ?? 0),
    0
  );
  const currentPayrollCostPerCoveredEmployee =
    currentPayrollCoveredEmployees > 0
      ? Math.round((currentPayrollValue / currentPayrollCoveredEmployees) * 100) / 100
      : 0;
  const previousPayrollCostPerCoveredEmployee =
    previousPayrollCoveredEmployees > 0
      ? Math.round((previousPayrollValue / previousPayrollCoveredEmployees) * 100) / 100
      : 0;
  const payrollApprovalQueueRows = (rows: PayrollRunReportRow[]) =>
    rows.filter((run) => run.status === "calculated");
  const payrollApprovalQueueCount = (rows: PayrollRunReportRow[]) =>
    payrollApprovalQueueRows(rows).length;
  const payrollApprovalQueueValue = (rows: PayrollRunReportRow[]) =>
    payrollApprovalQueueRows(rows).reduce((sum, run) => sum + payrollAmount(run.total_net), 0);
  const wpsMissingRunRows = (rows: PayrollRunReportRow[]) =>
    rows.filter(
      (run) => (run.status === "calculated" || run.status === "approved") && !run.sif_file_content
    );
  const wpsMissingRunCount = (rows: PayrollRunReportRow[]) => wpsMissingRunRows(rows).length;
  const wpsMissingRunValue = (rows: PayrollRunReportRow[]) =>
    wpsMissingRunRows(rows).reduce((sum, run) => sum + payrollAmount(run.total_net), 0);
  const currentPayrollApprovalQueueCount = payrollApprovalQueueCount(currentPayrollRuns);
  const previousPayrollApprovalQueueCount = payrollApprovalQueueCount(previousPayrollRuns);
  const currentPayrollApprovalQueueValue = payrollApprovalQueueValue(currentPayrollRuns);
  const previousPayrollApprovalQueueValue = payrollApprovalQueueValue(previousPayrollRuns);
  const currentWpsMissingRunCount = wpsMissingRunCount(currentPayrollRuns);
  const previousWpsMissingRunCount = wpsMissingRunCount(previousPayrollRuns);
  const currentWpsMissingRunValue = wpsMissingRunValue(currentPayrollRuns);
  const previousWpsMissingRunValue = wpsMissingRunValue(previousPayrollRuns);
  const currentPayrollReadinessQueueCount =
    currentPayrollApprovalQueueCount + currentWpsMissingRunCount;
  const previousPayrollReadinessQueueCount =
    previousPayrollApprovalQueueCount + previousWpsMissingRunCount;
  const currentPayrollReadinessQueueValue =
    currentPayrollApprovalQueueValue + currentWpsMissingRunValue;
  const previousPayrollReadinessQueueValue =
    previousPayrollApprovalQueueValue + previousWpsMissingRunValue;
  const wpsReadyShare = (rows: PayrollRunReportRow[]) => {
    const eligibleRuns = rows.filter(
      (run) => run.status === "calculated" || run.status === "approved"
    );
    if (eligibleRuns.length === 0) return 0;

    const readyRuns = eligibleRuns.filter((run) => Boolean(run.sif_file_content)).length;
    return Math.round((readyRuns / eligibleRuns.length) * 10000) / 100;
  };
  const currentWpsReadyShare = wpsReadyShare(currentPayrollRuns);
  const previousWpsReadyShare = wpsReadyShare(previousPayrollRuns);
  const currentInventoryMovementValue = currentInventoryMovements.reduce(
    (sum, movement) => sum + inventoryMovementValue(movement),
    0
  );
  const previousInventoryMovementValue = previousInventoryMovements.reduce(
    (sum, movement) => sum + inventoryMovementValue(movement),
    0
  );
  const ledgerActivityBreakdownForRange = (range: ComparisonRange) => {
    const postedEntries = journalEntries.filter(
      (entry) => entry.status === "posted" && valueInDateRange(entry.date, range)
    );
    return postedEntries.reduce(
      (summary, entry) => {
        const entryActivity = (entry.lines ?? []).reduce(
          (lineSum, line) => lineSum + Math.max(Number(line.debit) || 0, Number(line.credit) || 0),
          0
        );
        summary.totalActivity += entryActivity;
        if (!entry.source || entry.source === "manual") {
          summary.manualActivity += entryActivity;
        }
        return summary;
      },
      { totalActivity: 0, manualActivity: 0 }
    );
  };
  const currentLedgerActivityBreakdown = ledgerActivityBreakdownForRange(comparisonCurrentRange);
  const previousLedgerActivityBreakdown = ledgerActivityBreakdownForRange(comparisonPreviousRange);
  const currentLedgerActivity = currentLedgerActivityBreakdown.totalActivity;
  const previousLedgerActivity = previousLedgerActivityBreakdown.totalActivity;
  const currentManualLedgerShare = ratioPercent(
    currentLedgerActivityBreakdown.manualActivity,
    currentLedgerActivityBreakdown.totalActivity
  );
  const previousManualLedgerShare = ratioPercent(
    previousLedgerActivityBreakdown.manualActivity,
    previousLedgerActivityBreakdown.totalActivity
  );
  const currentManualLedgerActivity = currentLedgerActivityBreakdown.manualActivity;
  const previousManualLedgerActivity = previousLedgerActivityBreakdown.manualActivity;
  const automatedLedgerActivity = (summary: { totalActivity: number; manualActivity: number }) =>
    Math.max(0, summary.totalActivity - summary.manualActivity);
  const currentAutomatedLedgerActivity = automatedLedgerActivity(currentLedgerActivityBreakdown);
  const previousAutomatedLedgerActivity = automatedLedgerActivity(previousLedgerActivityBreakdown);
  const currentHighRiskActivityCount = currentActivityLogs.filter(
    (log) => activityLogRiskLevel(log) === "High"
  ).length;
  const previousHighRiskActivityCount = previousActivityLogs.filter(
    (log) => activityLogRiskLevel(log) === "High"
  ).length;
  const currentHighRiskActivityShare = ratioPercent(
    currentHighRiskActivityCount,
    currentActivityLogs.length
  );
  const previousHighRiskActivityShare = ratioPercent(
    previousHighRiskActivityCount,
    previousActivityLogs.length
  );
  const currentReviewActivityCount = currentActivityLogs.filter(
    (log) => activityLogRiskLevel(log) !== "Low"
  ).length;
  const previousReviewActivityCount = previousActivityLogs.filter(
    (log) => activityLogRiskLevel(log) !== "Low"
  ).length;
  const currentReviewActivityShare = ratioPercent(
    currentReviewActivityCount,
    currentActivityLogs.length
  );
  const previousReviewActivityShare = ratioPercent(
    previousReviewActivityCount,
    previousActivityLogs.length
  );
  const currentFxUnrealizedExposure =
    Math.abs(fxGainsLosses?.totalUnrealizedGain ?? 0) +
    Math.abs(fxGainsLosses?.totalUnrealizedLoss ?? 0);
  const currentLedgerAutomationCoverage =
    currentLedgerActivityBreakdown.totalActivity > 0.005 ? 100 - currentManualLedgerShare : null;
  const previousLedgerAutomationCoverage =
    previousLedgerActivityBreakdown.totalActivity > 0.005 ? 100 - previousManualLedgerShare : null;
  const currentLedgerAutomationShare = currentLedgerAutomationCoverage ?? 0;
  const previousLedgerAutomationShare = previousLedgerAutomationCoverage ?? 0;
  const currentAutomationAdoptionIndex = averageAvailablePercent([
    currentReceipts.length > 0 ? currentReceiptAutomationCoverage : null,
    currentBankAssistedTransactionCoverage,
    currentLedgerAutomationCoverage,
  ]);
  const previousAutomationAdoptionIndex = averageAvailablePercent([
    previousReceipts.length > 0 ? previousReceiptAutomationCoverage : null,
    previousBankAssistedTransactionCoverage,
    previousLedgerAutomationCoverage,
  ]);
  const currentAutomationValueAdoptionIndex = averageAvailablePercent([
    currentExpenseValue > 0.005 ? currentReceiptAutomationValueCoverage : null,
    currentBankAssistedTransactionValueCoverage,
    currentLedgerAutomationCoverage,
  ]);
  const previousAutomationValueAdoptionIndex = averageAvailablePercent([
    previousExpenseValue > 0.005 ? previousReceiptAutomationValueCoverage : null,
    previousBankAssistedTransactionValueCoverage,
    previousLedgerAutomationCoverage,
  ]);
  const currentBurnRate = normalizeMonthlyBurn(
    comparisonCurrentProfitLoss?.totalRevenue ?? 0,
    comparisonCurrentProfitLoss?.totalExpenses ?? 0,
    currentComparisonDays
  );
  const previousBurnRate = normalizeMonthlyBurn(
    comparisonPreviousProfitLoss?.totalRevenue ?? 0,
    comparisonPreviousProfitLoss?.totalExpenses ?? 0,
    previousComparisonDays
  );
  const currentRunwayDays = runwayCoverageDays(
    cashFlowForecast?.currentBalance ?? 0,
    currentBurnRate
  );
  const previousRunwayDays = runwayCoverageDays(
    cashFlowForecast?.currentBalance ?? 0,
    previousBurnRate
  );
  const cashForecastProjections = cashFlowForecast?.projections ?? [];
  const lowestForecastBalance = cashForecastProjections.length
    ? Math.min(...cashForecastProjections.map((projection) => projection.projectedBalance))
    : (cashFlowForecast?.currentBalance ?? 0);
  const currentProjectedCashShortfall = Math.max(0, -lowestForecastBalance);
  const currentCashRiskWeekCount = cashForecastProjections.filter(
    (projection) => projection.projectedBalance < 0
  ).length;
  const currentNetMargin = ratioPercent(
    comparisonCurrentProfitLoss?.netProfit ?? 0,
    comparisonCurrentProfitLoss?.totalRevenue ?? 0
  );
  const previousNetMargin = ratioPercent(
    comparisonPreviousProfitLoss?.netProfit ?? 0,
    comparisonPreviousProfitLoss?.totalRevenue ?? 0
  );
  const currentExpenseRatio = ratioPercent(
    comparisonCurrentProfitLoss?.totalExpenses ?? 0,
    comparisonCurrentProfitLoss?.totalRevenue ?? 0
  );
  const previousExpenseRatio = ratioPercent(
    comparisonPreviousProfitLoss?.totalExpenses ?? 0,
    comparisonPreviousProfitLoss?.totalRevenue ?? 0
  );
  const currentRevenueExpenseCoverage = ratioPercent(
    comparisonCurrentProfitLoss?.totalRevenue ?? 0,
    comparisonCurrentProfitLoss?.totalExpenses ?? 0
  );
  const previousRevenueExpenseCoverage = ratioPercent(
    comparisonPreviousProfitLoss?.totalRevenue ?? 0,
    comparisonPreviousProfitLoss?.totalExpenses ?? 0
  );
  const consolidatedMetricSource = serverGroupConsolidation
    ? {
        label: "Consolidated",
        currency: serverGroupConsolidation.currency,
        currentRevenue: serverGroupConsolidation.currentRevenue,
        previousRevenue: serverGroupConsolidation.previousRevenue,
        currentExpenses: serverGroupConsolidation.currentExpenses,
        previousExpenses: serverGroupConsolidation.previousExpenses,
        currentNetProfit: serverGroupConsolidation.currentNetProfit,
        previousNetProfit: serverGroupConsolidation.previousNetProfit,
        reviewCount:
          consolidatedStatementsReport.reviewCount + serverGroupConsolidation.warningCount,
      }
    : {
        label: "Roll-up",
        currency: "AED",
        currentRevenue: consolidatedStatementsReport.currentComparisonRevenue,
        previousRevenue: consolidatedStatementsReport.previousRevenue,
        currentExpenses: consolidatedStatementsReport.currentComparisonExpenses,
        previousExpenses: consolidatedStatementsReport.previousExpenses,
        currentNetProfit: consolidatedStatementsReport.currentComparisonNetProfit,
        previousNetProfit: consolidatedStatementsReport.previousNetProfit,
        reviewCount: consolidatedStatementsReport.reviewCount,
      };
  const currentConsolidatedMargin = ratioPercent(
    consolidatedMetricSource.currentNetProfit,
    consolidatedMetricSource.currentRevenue
  );
  const previousConsolidatedMargin = ratioPercent(
    consolidatedMetricSource.previousNetProfit,
    consolidatedMetricSource.previousRevenue
  );
  const currentBreakEvenGap = Math.max(
    0,
    (comparisonCurrentProfitLoss?.totalExpenses ?? 0) -
      (comparisonCurrentProfitLoss?.totalRevenue ?? 0)
  );
  const previousBreakEvenGap = Math.max(
    0,
    (comparisonPreviousProfitLoss?.totalExpenses ?? 0) -
      (comparisonPreviousProfitLoss?.totalRevenue ?? 0)
  );
  const currentPayrollExpenseShare = ratioPercent(
    currentPayrollValue,
    comparisonCurrentProfitLoss?.totalExpenses ?? 0
  );
  const previousPayrollExpenseShare = ratioPercent(
    previousPayrollValue,
    comparisonPreviousProfitLoss?.totalExpenses ?? 0
  );
  const operatingCashFlowForRow = (row: CashFlowStatementRow | undefined) =>
    (row?.operatingInflow ?? 0) - (row?.operatingOutflow ?? 0);
  const currentOperatingCashFlow = operatingCashFlowForRow(cashFlowStatement.at(-1));
  const previousOperatingCashFlow = operatingCashFlowForRow(cashFlowStatement.at(-2));
  const currentLiabilityAssetRatio = ratioPercent(
    comparisonCurrentBalanceSheet?.totalLiabilities ?? 0,
    comparisonCurrentBalanceSheet?.totalAssets ?? 0
  );
  const previousLiabilityAssetRatio = ratioPercent(
    comparisonPreviousBalanceSheet?.totalLiabilities ?? 0,
    comparisonPreviousBalanceSheet?.totalAssets ?? 0
  );
  const currentDebtEquityRatio = ratioPercent(
    comparisonCurrentBalanceSheet?.totalLiabilities ?? 0,
    comparisonCurrentBalanceSheet?.totalEquity ?? 0
  );
  const previousDebtEquityRatio = ratioPercent(
    comparisonPreviousBalanceSheet?.totalLiabilities ?? 0,
    comparisonPreviousBalanceSheet?.totalEquity ?? 0
  );
  const budgetComparisonLines = varianceReport?.varianceLines ?? [];
  const currentBudgetActualValue = budgetComparisonLines.reduce(
    (sum, line) => sum + line.totals.actual,
    0
  );
  const currentBudgetBaselineValue = budgetComparisonLines.reduce(
    (sum, line) => sum + line.totals.budget,
    0
  );
  const currentTotalTaxExposure =
    (comparisonCurrentVat?.netVATPayable ?? 0) + (corporateTaxEstimate?.taxPayable ?? 0);
  const previousTotalTaxExposure =
    (comparisonPreviousVat?.netVATPayable ?? 0) +
    (comparisonPreviousCorporateTaxEstimate?.taxPayable ?? 0);
  const currentTaxExposureRate = ratioPercent(
    currentTotalTaxExposure,
    comparisonCurrentProfitLoss?.totalRevenue ?? 0
  );
  const previousTaxExposureRate = ratioPercent(
    previousTotalTaxExposure,
    comparisonPreviousProfitLoss?.totalRevenue ?? 0
  );
  const currentAvailableTaxCash = Math.max(0, cashFlowForecast?.currentBalance ?? 0);
  const currentTaxReserveNeed = Math.max(0, currentTotalTaxExposure);
  const currentTaxReserveCoverage =
    currentTaxReserveNeed > 0.005
      ? ratioPercent(
          Math.min(currentAvailableTaxCash, currentTaxReserveNeed),
          currentTaxReserveNeed
        )
      : 100;
  const currentTaxFundingGap = Math.max(0, currentTaxReserveNeed - currentAvailableTaxCash);
  const currentTaxAdjustedRunwayDays = runwayCoverageDays(
    Math.max(0, currentAvailableTaxCash - currentTaxReserveNeed),
    currentBurnRate
  );
  const monthEndChecklistItems = monthEndCloseStatus?.checklist ?? [];
  const currentMonthEndOpenChecks = monthEndChecklistItems.filter(
    (item) => item.status !== "complete"
  ).length;
  const currentMonthEndReadiness = monthEndChecklistItems.length
    ? ratioPercent(
        monthEndChecklistItems.length - currentMonthEndOpenChecks,
        monthEndChecklistItems.length
      )
    : 100;
  return {
    currentExpenseValue,
    previousExpenseValue,
    currentAverageReceiptValue,
    previousAverageReceiptValue,
    currentExpenseClaimReviewValue,
    previousExpenseClaimReviewValue,
    currentSubmittedExpenseClaimValue,
    previousSubmittedExpenseClaimValue,
    currentApprovedExpenseClaimValue,
    previousApprovedExpenseClaimValue,
    currentExpenseClaimReviewCount,
    previousExpenseClaimReviewCount,
    currentSubmittedExpenseClaimCount,
    previousSubmittedExpenseClaimCount,
    currentApprovedExpenseClaimCount,
    previousApprovedExpenseClaimCount,
    currentUnpostedReceiptValue,
    previousUnpostedReceiptValue,
    currentUnpostedExpenseShare,
    previousUnpostedExpenseShare,
    currentUnpostedReceiptCount,
    previousUnpostedReceiptCount,
    currentAutoPostedReceiptCount,
    previousAutoPostedReceiptCount,
    currentAutoPostedReceiptValue,
    previousAutoPostedReceiptValue,
    currentReceiptAutomationCoverage,
    previousReceiptAutomationCoverage,
    currentReceiptAutomationValueCoverage,
    previousReceiptAutomationValueCoverage,
    currentBankReconciliationCoverage,
    previousBankReconciliationCoverage,
    currentReconciledBankCount,
    previousReconciledBankCount,
    currentReconciledBankValue,
    previousReconciledBankValue,
    currentUnreconciledBankCount,
    previousUnreconciledBankCount,
    currentUnreconciledBankValue,
    previousUnreconciledBankValue,
    currentSuggestedBankMatchCount,
    previousSuggestedBankMatchCount,
    currentBankMatchSuggestionCoverage,
    previousBankMatchSuggestionCoverage,
    currentBankMatchSuggestionValueCoverage,
    previousBankMatchSuggestionValueCoverage,
    currentBankAssistedTransactionCount,
    previousBankAssistedTransactionCount,
    currentBankAssistedTransactionValue,
    previousBankAssistedTransactionValue,
    currentBankAssistedTransactionCoverage,
    previousBankAssistedTransactionCoverage,
    currentBankAssistedTransactionValueCoverage,
    previousBankAssistedTransactionValueCoverage,
    currentAutomationWorkQueueCount,
    previousAutomationWorkQueueCount,
    currentAutomationWorkQueueValue,
    previousAutomationWorkQueueValue,
    currentPayrollValue,
    previousPayrollValue,
    currentPayrollDeductionShare,
    previousPayrollDeductionShare,
    currentAveragePayrollRunValue,
    previousAveragePayrollRunValue,
    currentPayrollCoveredEmployees,
    previousPayrollCoveredEmployees,
    currentPayrollCostPerCoveredEmployee,
    previousPayrollCostPerCoveredEmployee,
    currentPayrollApprovalQueueCount,
    previousPayrollApprovalQueueCount,
    currentPayrollApprovalQueueValue,
    previousPayrollApprovalQueueValue,
    currentWpsMissingRunCount,
    previousWpsMissingRunCount,
    currentWpsMissingRunValue,
    previousWpsMissingRunValue,
    currentPayrollReadinessQueueCount,
    previousPayrollReadinessQueueCount,
    currentPayrollReadinessQueueValue,
    previousPayrollReadinessQueueValue,
    currentWpsReadyShare,
    previousWpsReadyShare,
    currentInventoryMovementValue,
    previousInventoryMovementValue,
    currentLedgerActivity,
    previousLedgerActivity,
    currentManualLedgerShare,
    previousManualLedgerShare,
    currentManualLedgerActivity,
    previousManualLedgerActivity,
    currentAutomatedLedgerActivity,
    previousAutomatedLedgerActivity,
    currentHighRiskActivityCount,
    previousHighRiskActivityCount,
    currentHighRiskActivityShare,
    previousHighRiskActivityShare,
    currentReviewActivityCount,
    previousReviewActivityCount,
    currentReviewActivityShare,
    previousReviewActivityShare,
    currentFxUnrealizedExposure,
    currentLedgerAutomationShare,
    previousLedgerAutomationShare,
    currentAutomationAdoptionIndex,
    previousAutomationAdoptionIndex,
    currentAutomationValueAdoptionIndex,
    previousAutomationValueAdoptionIndex,
    currentBurnRate,
    previousBurnRate,
    currentRunwayDays,
    previousRunwayDays,
    currentProjectedCashShortfall,
    currentCashRiskWeekCount,
    currentNetMargin,
    previousNetMargin,
    currentExpenseRatio,
    previousExpenseRatio,
    currentRevenueExpenseCoverage,
    previousRevenueExpenseCoverage,
    consolidatedMetricSource,
    currentConsolidatedMargin,
    previousConsolidatedMargin,
    currentBreakEvenGap,
    previousBreakEvenGap,
    currentPayrollExpenseShare,
    previousPayrollExpenseShare,
    currentOperatingCashFlow,
    previousOperatingCashFlow,
    currentLiabilityAssetRatio,
    previousLiabilityAssetRatio,
    currentDebtEquityRatio,
    previousDebtEquityRatio,
    currentBudgetActualValue,
    currentBudgetBaselineValue,
    currentTotalTaxExposure,
    previousTotalTaxExposure,
    currentTaxExposureRate,
    previousTaxExposureRate,
    currentTaxReserveCoverage,
    currentTaxFundingGap,
    currentTaxAdjustedRunwayDays,
    currentMonthEndOpenChecks,
    currentMonthEndReadiness,
  };
}

export type ComputeOperationsComparisonFiguresResult = ReturnType<
  typeof computeOperationsComparisonFigures
>;
