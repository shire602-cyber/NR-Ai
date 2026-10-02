// What the report viewer needs to know about each server report beyond the catalog entry: the filters it takes, whether
// it is limited to sensitive roles, and how it treats an as-of day or a comparison. Mirrors the definitions in
// server/reports/definitions/*.ts; tests/unit/report-params-ui.test.ts fails when the two drift.

export type ReportFilterKey =
  | "accountId"
  | "contactId"
  | "bankAccountId"
  | "source"
  | "userId"
  | "entityType"
  | "action"
  | "budgetPlanId"
  | "costCenterId"
  | "taxYear"
  | "payrollRunId"
  | "companyIds"
  | "statement"
  | "projectId"
  | "employeeId"
  | "strict";

export interface ReportUiRule {
  filters: readonly ReportFilterKey[];
  /** Owner / accountant / CFO or firm staff only. */
  sensitive?: boolean;
  /** An as-of day after today is refused (ageing). */
  noFutureAsOf?: boolean;
  /** The report builds its own comparison (no "no comparison" choice). */
  ownComparison?: boolean;
  /** Runs as a comparison without being asked. */
  defaultCompare?: "priorPeriod" | "priorYear";
  /** The run takes `strict=1` (consolidation: refuse instead of warning on unmatched intercompany balances). */
  strict?: boolean;
  /** Budget vs Actual carries its own budget column. */
  budgetComparison?: boolean;
}

const NONE: ReportUiRule = { filters: [] };
const AGEING: ReportUiRule = { filters: [], noFutureAsOf: true };
const LEDGER: ReportUiRule = { filters: ["accountId", "costCenterId", "source"] };
const PAYROLL: ReportUiRule = { filters: ["payrollRunId"], sensitive: true };

export const REPORT_UI_RULES: Record<string, ReportUiRule> = {
  "profit-loss": NONE,
  "balance-sheet": NONE,
  "trial-balance": NONE,
  "comparative-trial-balance": { filters: [], ownComparison: true },
  "cash-flow": NONE,
  "cash-flow-direct": NONE,
  "equity-movement": NONE,
  "period-comparison": { filters: [], defaultCompare: "priorPeriod" },
  "general-ledger": LEDGER,
  "account-transactions": LEDGER,
  "journal-report": { filters: ["source", "userId"] },
  "fx-gains-losses": NONE,
  "ar-aging": AGEING,
  "customer-balances": AGEING,
  "receivables-detail": AGEING,
  "invoice-status": NONE,
  "revenue-customer": NONE,
  "sales-product-service": NONE,
  "payments-received": { filters: ["contactId"] },
  "credit-notes-refunds": NONE,
  "quotes-conversion": NONE,
  "recurring-schedule": NONE,
  "ap-aging": AGEING,
  "vendor-balances": AGEING,
  "payables-detail": AGEING,
  "expenses-vendor": NONE,
  "expenses-category": NONE,
  "purchases-vendor": NONE,
  "purchases-item": NONE,
  "payments-made": NONE,
  "purchase-orders-status": NONE,
  "vendor-credits": NONE,
  "expense-claims": NONE,
  "unreconciled-bank-items": { filters: ["bankAccountId"] },
  "inventory-valuation": AGEING,
  "inventory-summary": AGEING,
  "inventory-movement": NONE,
  "fixed-asset-register": AGEING,
  "depreciation-schedule": NONE,
  "asset-disposals": NONE,
  "payroll-summary": PAYROLL,
  "wps-sif-summary": PAYROLL,
  "payroll-register": PAYROLL,
  "budget-actual": { filters: ["budgetPlanId"], budgetComparison: true },
  "cost-center-profitability": { filters: ["costCenterId"] },
  "cash-flow-forecast": NONE,
  "month-end-close-status": NONE,
  "audit-trail": { filters: ["userId", "entityType", "action"], sensitive: true },
  "consolidated-statements": { filters: ["companyIds", "statement"], strict: true },
  "vat-summary": NONE,
  "vat-return": NONE,
  "vat-audit-sales": NONE,
  "vat-audit-purchases": NONE,
  "vat-control-reconciliation": NONE,
  "corporate-tax-estimate": NONE,
  "ct-workpaper": { filters: ["taxYear"] },
  // Wave 2 (rows over the sales order, advance, project, approval, leave, loan and bank feed tables)
  "bank-reconciliation-statement": { filters: ["bankAccountId"], noFutureAsOf: true },
  "bank-feed-status": NONE,
  "sales-orders-status": NONE,
  "customer-advances": AGEING,
  "project-profitability": { filters: ["projectId"] },
  "time-summary": { filters: ["projectId", "userId"] },
  "unbilled-time-expenses": { filters: ["projectId"], noFutureAsOf: true },
  "approval-history": { filters: ["entityType", "userId"] },
  "leave-balances": { filters: ["employeeId"], sensitive: true, noFutureAsOf: true },
  "eos-provision": { filters: [], sensitive: true, noFutureAsOf: true },
  "employee-loans": { filters: [], sensitive: true, noFutureAsOf: true },
};

const FALLBACK: ReportUiRule = NONE;
export const reportUiRule = (reportId: string): ReportUiRule =>
  REPORT_UI_RULES[reportId] ?? FALLBACK;
