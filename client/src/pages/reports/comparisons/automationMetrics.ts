// Spend, receipt, expense-claim, bank and automation comparison metric rows.
// Split from the Reports page comparisonRows memo (R20-09); behaviour unchanged.
import { ComparisonMetricRow, makeComparisonMetric } from "../shared";
import type { ComputeOperationsComparisonFiguresResult } from "./operationsFigures";
import type { ComputeDocumentComparisonFiguresResult } from "./documentFigures";

export function automationComparisonMetrics({
  currentApprovedExpenseClaimCount,
  currentApprovedExpenseClaimValue,
  currentAutoPostedReceiptCount,
  currentAutoPostedReceiptValue,
  currentAutomatedLedgerActivity,
  currentAutomationAdoptionIndex,
  currentAutomationValueAdoptionIndex,
  currentAutomationWorkQueueCount,
  currentAutomationWorkQueueValue,
  currentAverageReceiptValue,
  currentBankAssistedTransactionCount,
  currentBankAssistedTransactionCoverage,
  currentBankAssistedTransactionValue,
  currentBankAssistedTransactionValueCoverage,
  currentBankMatchSuggestionCoverage,
  currentBankMatchSuggestionValueCoverage,
  currentBankReconciliationCoverage,
  currentExpenseClaimReviewCount,
  currentExpenseClaimReviewValue,
  currentExpenseValue,
  currentLedgerAutomationShare,
  currentManualLedgerActivity,
  currentReceiptAutomationCoverage,
  currentReceiptAutomationValueCoverage,
  currentReceipts,
  currentReconciledBankCount,
  currentReconciledBankValue,
  currentSubmittedExpenseClaimCount,
  currentSubmittedExpenseClaimValue,
  currentSuggestedBankMatchCount,
  currentUnpostedExpenseShare,
  currentUnpostedReceiptCount,
  currentUnpostedReceiptValue,
  currentUnreconciledBankCount,
  currentUnreconciledBankValue,
  previousApprovedExpenseClaimCount,
  previousApprovedExpenseClaimValue,
  previousAutoPostedReceiptCount,
  previousAutoPostedReceiptValue,
  previousAutomatedLedgerActivity,
  previousAutomationAdoptionIndex,
  previousAutomationValueAdoptionIndex,
  previousAutomationWorkQueueCount,
  previousAutomationWorkQueueValue,
  previousAverageReceiptValue,
  previousBankAssistedTransactionCount,
  previousBankAssistedTransactionCoverage,
  previousBankAssistedTransactionValue,
  previousBankAssistedTransactionValueCoverage,
  previousBankMatchSuggestionCoverage,
  previousBankMatchSuggestionValueCoverage,
  previousBankReconciliationCoverage,
  previousExpenseClaimReviewCount,
  previousExpenseClaimReviewValue,
  previousExpenseValue,
  previousLedgerAutomationShare,
  previousManualLedgerActivity,
  previousReceiptAutomationCoverage,
  previousReceiptAutomationValueCoverage,
  previousReceipts,
  previousReconciledBankCount,
  previousReconciledBankValue,
  previousSubmittedExpenseClaimCount,
  previousSubmittedExpenseClaimValue,
  previousSuggestedBankMatchCount,
  previousUnpostedExpenseShare,
  previousUnpostedReceiptCount,
  previousUnpostedReceiptValue,
  previousUnreconciledBankCount,
  previousUnreconciledBankValue,
}: Pick<
  ComputeOperationsComparisonFiguresResult & ComputeDocumentComparisonFiguresResult,
  | "currentApprovedExpenseClaimCount"
  | "currentApprovedExpenseClaimValue"
  | "currentAutoPostedReceiptCount"
  | "currentAutoPostedReceiptValue"
  | "currentAutomatedLedgerActivity"
  | "currentAutomationAdoptionIndex"
  | "currentAutomationValueAdoptionIndex"
  | "currentAutomationWorkQueueCount"
  | "currentAutomationWorkQueueValue"
  | "currentAverageReceiptValue"
  | "currentBankAssistedTransactionCount"
  | "currentBankAssistedTransactionCoverage"
  | "currentBankAssistedTransactionValue"
  | "currentBankAssistedTransactionValueCoverage"
  | "currentBankMatchSuggestionCoverage"
  | "currentBankMatchSuggestionValueCoverage"
  | "currentBankReconciliationCoverage"
  | "currentExpenseClaimReviewCount"
  | "currentExpenseClaimReviewValue"
  | "currentExpenseValue"
  | "currentLedgerAutomationShare"
  | "currentManualLedgerActivity"
  | "currentReceiptAutomationCoverage"
  | "currentReceiptAutomationValueCoverage"
  | "currentReceipts"
  | "currentReconciledBankCount"
  | "currentReconciledBankValue"
  | "currentSubmittedExpenseClaimCount"
  | "currentSubmittedExpenseClaimValue"
  | "currentSuggestedBankMatchCount"
  | "currentUnpostedExpenseShare"
  | "currentUnpostedReceiptCount"
  | "currentUnpostedReceiptValue"
  | "currentUnreconciledBankCount"
  | "currentUnreconciledBankValue"
  | "previousApprovedExpenseClaimCount"
  | "previousApprovedExpenseClaimValue"
  | "previousAutoPostedReceiptCount"
  | "previousAutoPostedReceiptValue"
  | "previousAutomatedLedgerActivity"
  | "previousAutomationAdoptionIndex"
  | "previousAutomationValueAdoptionIndex"
  | "previousAutomationWorkQueueCount"
  | "previousAutomationWorkQueueValue"
  | "previousAverageReceiptValue"
  | "previousBankAssistedTransactionCount"
  | "previousBankAssistedTransactionCoverage"
  | "previousBankAssistedTransactionValue"
  | "previousBankAssistedTransactionValueCoverage"
  | "previousBankMatchSuggestionCoverage"
  | "previousBankMatchSuggestionValueCoverage"
  | "previousBankReconciliationCoverage"
  | "previousExpenseClaimReviewCount"
  | "previousExpenseClaimReviewValue"
  | "previousExpenseValue"
  | "previousLedgerAutomationShare"
  | "previousManualLedgerActivity"
  | "previousReceiptAutomationCoverage"
  | "previousReceiptAutomationValueCoverage"
  | "previousReceipts"
  | "previousReconciledBankCount"
  | "previousReconciledBankValue"
  | "previousSubmittedExpenseClaimCount"
  | "previousSubmittedExpenseClaimValue"
  | "previousSuggestedBankMatchCount"
  | "previousUnpostedExpenseShare"
  | "previousUnpostedReceiptCount"
  | "previousUnpostedReceiptValue"
  | "previousUnreconciledBankCount"
  | "previousUnreconciledBankValue"
>): ComparisonMetricRow[] {
  return [
    makeComparisonMetric({
      id: "expense-spend",
      label: "Expense spend",
      current: currentExpenseValue,
      previous: previousExpenseValue,
      currency: "AED",
      signal: "Cost pressure",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "receipt-count",
      label: "Receipt count",
      current: currentReceipts.length,
      previous: previousReceipts.length,
      currency: "count",
      signal: "Receipt workload",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "average-receipt-value",
      label: "Average receipt value",
      current: currentAverageReceiptValue,
      previous: previousAverageReceiptValue,
      currency: "AED",
      signal: "Receipt size",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "expense-claim-review-value",
      label: "Expense claim review value",
      current: currentExpenseClaimReviewValue,
      previous: previousExpenseClaimReviewValue,
      currency: "AED",
      signal: "Claims queue",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "expense-claim-review-count",
      label: "Expense claim review count",
      current: currentExpenseClaimReviewCount,
      previous: previousExpenseClaimReviewCount,
      currency: "count",
      signal: "Claims awaiting review",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "submitted-expense-claim-count",
      label: "Submitted expense claim count",
      current: currentSubmittedExpenseClaimCount,
      previous: previousSubmittedExpenseClaimCount,
      currency: "count",
      signal: "Claim approvals",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "submitted-expense-claim-value",
      label: "Submitted expense claim value",
      current: currentSubmittedExpenseClaimValue,
      previous: previousSubmittedExpenseClaimValue,
      currency: "AED",
      signal: "Claim approval value",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "approved-expense-claim-count",
      label: "Approved expense claim count",
      current: currentApprovedExpenseClaimCount,
      previous: previousApprovedExpenseClaimCount,
      currency: "count",
      signal: "Reimbursement follow-up",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "approved-expense-claim-value",
      label: "Approved expense claim value",
      current: currentApprovedExpenseClaimValue,
      previous: previousApprovedExpenseClaimValue,
      currency: "AED",
      signal: "Reimbursement value",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "unposted-expense-share",
      label: "Unposted expense share",
      current: currentUnpostedExpenseShare,
      previous: previousUnpostedExpenseShare,
      currency: "%",
      signal: "Bookkeeping backlog",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "unposted-receipt-count",
      label: "Unposted receipt count",
      current: currentUnpostedReceiptCount,
      previous: previousUnpostedReceiptCount,
      currency: "count",
      signal: "Posting queue",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "unposted-receipt-value",
      label: "Unposted receipt value",
      current: currentUnpostedReceiptValue,
      previous: previousUnpostedReceiptValue,
      currency: "AED",
      signal: "Posting value",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "auto-posted-receipt-count",
      label: "Auto-posted receipt count",
      current: currentAutoPostedReceiptCount,
      previous: previousAutoPostedReceiptCount,
      currency: "count",
      signal: "Receipts automated",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "auto-posted-receipt-value",
      label: "Auto-posted receipt value",
      current: currentAutoPostedReceiptValue,
      previous: previousAutoPostedReceiptValue,
      currency: "AED",
      signal: "Automated expense value",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "receipt-automation-coverage",
      label: "Receipt automation coverage",
      current: currentReceiptAutomationCoverage,
      previous: previousReceiptAutomationCoverage,
      currency: "%",
      signal: "Auto-post coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "receipt-automation-value-coverage",
      label: "Receipt automation value coverage",
      current: currentReceiptAutomationValueCoverage,
      previous: previousReceiptAutomationValueCoverage,
      currency: "%",
      signal: "Auto-posted value",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "expenses",
    }),
    makeComparisonMetric({
      id: "bank-reconciliation-coverage",
      label: "Bank reconciliation coverage",
      current: currentBankReconciliationCoverage,
      previous: previousBankReconciliationCoverage,
      currency: "%",
      signal: "Bank automation coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "reconciled-bank-count",
      label: "Reconciled bank count",
      current: currentReconciledBankCount,
      previous: previousReconciledBankCount,
      currency: "count",
      signal: "Bank transactions cleared",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "reconciled-bank-value",
      label: "Reconciled bank value",
      current: currentReconciledBankValue,
      previous: previousReconciledBankValue,
      currency: "AED",
      signal: "Bank value cleared",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "unreconciled-bank-count",
      label: "Unreconciled bank count",
      current: currentUnreconciledBankCount,
      previous: previousUnreconciledBankCount,
      currency: "count",
      signal: "Bank review queue",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "unreconciled-bank-value",
      label: "Unreconciled bank value",
      current: currentUnreconciledBankValue,
      previous: previousUnreconciledBankValue,
      currency: "AED",
      signal: "Bank value at review",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "bank-match-suggestion-coverage",
      label: "Bank match suggestion coverage",
      current: currentBankMatchSuggestionCoverage,
      previous: previousBankMatchSuggestionCoverage,
      currency: "%",
      signal: "Suggested match coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "bank-match-suggestion-value-coverage",
      label: "Bank match suggestion value coverage",
      current: currentBankMatchSuggestionValueCoverage,
      previous: previousBankMatchSuggestionValueCoverage,
      currency: "%",
      signal: "Suggested match value",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "suggested-bank-match-count",
      label: "Suggested bank match count",
      current: currentSuggestedBankMatchCount,
      previous: previousSuggestedBankMatchCount,
      currency: "count",
      signal: "Review-ready matches",
      favorable: "neutral",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "bank-assisted-transaction-count",
      label: "Bank-assisted transaction count",
      current: currentBankAssistedTransactionCount,
      previous: previousBankAssistedTransactionCount,
      currency: "count",
      signal: "Bank work assisted",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "bank-assisted-transaction-value",
      label: "Bank-assisted transaction value",
      current: currentBankAssistedTransactionValue,
      previous: previousBankAssistedTransactionValue,
      currency: "AED",
      signal: "Assisted bank value",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "bank-assisted-transaction-coverage",
      label: "Bank-assisted transaction coverage",
      current: currentBankAssistedTransactionCoverage ?? 0,
      previous: previousBankAssistedTransactionCoverage ?? 0,
      currency: "%",
      signal: "Bank work coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "bank-assisted-transaction-value-coverage",
      label: "Bank-assisted transaction value coverage",
      current: currentBankAssistedTransactionValueCoverage ?? 0,
      previous: previousBankAssistedTransactionValueCoverage ?? 0,
      currency: "%",
      signal: "Assisted bank value coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "balances",
    }),
    makeComparisonMetric({
      id: "automation-work-queue-count",
      label: "Automation work queue count",
      current: currentAutomationWorkQueueCount,
      previous: previousAutomationWorkQueueCount,
      currency: "count",
      signal: "Action queue",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "automation-work-queue-value",
      label: "Automation work queue value",
      current: currentAutomationWorkQueueValue,
      previous: previousAutomationWorkQueueValue,
      currency: "AED",
      signal: "Queue value",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "ledger-automation-share",
      label: "Ledger automation share",
      current: currentLedgerAutomationShare,
      previous: previousLedgerAutomationShare,
      currency: "%",
      signal: "Ledger automation coverage",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "manual-ledger-activity",
      label: "Manual ledger activity",
      current: currentManualLedgerActivity,
      previous: previousManualLedgerActivity,
      currency: "AED",
      signal: "Manual ledger value",
      favorable: "decrease",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "automated-ledger-activity",
      label: "Automated ledger activity",
      current: currentAutomatedLedgerActivity,
      previous: previousAutomatedLedgerActivity,
      currency: "AED",
      signal: "Automated ledger value",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "automation-adoption-index",
      label: "Automation adoption index",
      current: currentAutomationAdoptionIndex,
      previous: previousAutomationAdoptionIndex,
      currency: "%",
      signal: "Automation adoption",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
    makeComparisonMetric({
      id: "automation-value-adoption-index",
      label: "Automation value adoption index",
      current: currentAutomationValueAdoptionIndex,
      previous: previousAutomationValueAdoptionIndex,
      currency: "%",
      signal: "Automation value adoption",
      favorable: "increase",
      personas: ["owner", "freelancer", "accountant"],
      tab: "planning",
    }),
  ];
}
