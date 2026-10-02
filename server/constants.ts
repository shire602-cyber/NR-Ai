// UAE accounting constants used across the codebase.
// Centralized here so VAT rates, currency, and the system Chart of Accounts
// codes are not duplicated as magic numbers/strings in route and service files.

/** UAE standard VAT rate (5%). */
export const UAE_VAT_RATE = 0.05;

/** UAE Corporate Tax small-business exemption threshold in AED. */
export const UAE_CT_EXEMPTION_THRESHOLD = 375_000;

/** Default reporting/invoice currency for UAE-based businesses. */
export const DEFAULT_CURRENCY = "AED";

/**
 * System-account codes from the default UAE Chart of Accounts.
 * The accounting code lookup logic in routes/services should reference these
 * names instead of bare strings, so a future COA renumbering only touches one
 * file.
 */
export const ACCOUNT_CODES = {
  /** Accounts Receivable (current asset). */
  AR: "1040",
  /** Accounts Payable (current liability). */
  AP: "2010",
  /** Output VAT payable (current liability). */
  VAT_OUTPUT: "2020",
  /** Input VAT receivable (current asset). */
  VAT_INPUT: "1050",
  /** Cash on hand (current asset). */
  CASH: "1010",
  /** Bank accounts (current asset). */
  BANK: "1020",
  /** Inventory (current asset). */
  INVENTORY: "1070",
  /** Goods Received Not Invoiced (current liability): credited by a stock purchase movement, cleared by coding the vendor bill to it. */
  GRNI: "2015",
  /** Inventory Adjustments (expense): stock-take corrections; created on demand for older charts. */
  INVENTORY_ADJUSTMENTS: "5210",
  /** Cost of Goods Sold (expense): weighted-average cost of inventory sold; created on demand for older charts. */
  COGS: "5200",
  /** Employee Loans (asset): loans and salary advances to staff; created on demand for older charts. */
  EMPLOYEE_LOANS: "1080",
  /** Leave Pay Expense (expense) and Leave Pay Provision (liability): monthly accrual of unused annual leave; created on demand. */
  LEAVE_PAY_EXPENSE: "5029",
  LEAVE_PROVISION: "2037",
  /** Office equipment (fixed asset). */
  EQUIPMENT: "1210",
  /** Zero-rated sales (income). */
  ZERO_RATED_SALES: "4060",
  /** General/uncategorised expenses (expense) — default debit for VAT purchase posting. */
  GENERAL_EXPENSE: "5000",
  /** Sales Revenue (income). */
  REVENUE: "4010",
  /** Service Revenue (alternate revenue account some firms use). */
  REVENUE_ALT: "4020",
  /** 2050 Customer Credit (holds invoice overpayments until applied or refunded). */
  DEFERRED_REVENUE: "2050",
  /** Customer Advances (liability): advance tax invoices and deposits until applied or refunded; created on demand. */
  CUSTOMER_ADVANCES: "2055",
  /** Payment Gateway Clearing (asset, cash-like): online card receipts until the provider pays out. */
  GATEWAY_CLEARING: "1025",
  /** Shipping Income (revenue): delivery charged on sales documents. */
  SHIPPING_INCOME: "4035",
  /** Late-fee income (revenue): compensatory late-payment fees; the chart's 4040 account. */
  LATE_FEE_INCOME: "4040",
  /** Discounts Given (contra-revenue): line and document discounts. */
  DISCOUNTS_GIVEN: "4050",
  /** Bank charges and fees (expense): payment gateway fees. */
  GATEWAY_FEES: "5110",
  /** Employee Reimbursements Payable (owed to staff for approved expense claims). */
  EMP_REIMBURSEMENT_PAYABLE: "2045",
  /** Foreign-exchange gain (income) — REALISED FX differences (settlements). */
  FX_GAIN: "4090",
  /** Foreign-exchange loss (expense) — REALISED FX differences (settlements). */
  FX_LOSS: "5140",
  /** Unrealised exchange gain / (loss), one income account (credit = gain, debit = loss): revaluations only. Created on demand. */
  FX_UNREALISED: "4095",
} as const;

/**
 * Corporate tax accounts. In the default chart; an older company that lacks them
 * (by these codes or by these exact English names) gets them created from the
 * default template when a corporate tax return is filed.
 */
export const CT_ACCOUNT_CODES = {
  /** Corporate Tax Payable (current liability). */
  PAYABLE: "2060",
  /** Corporate Tax Expense (expense). */
  EXPENSE: "5150",
} as const;

/**
 * VAT settlement accounts outside the input/output pair. "Irrecoverable VAT Expense" receives
 * the input VAT a return does not recover and VAT rounding (<= AED 1.00) when the VAT accounts
 * are cleared at filing; "VAT Adjustments" receives the difference of a hand edit that declares
 * more tax than the ledger. Both are created on demand for older charts.
 */
export const VAT_ACCOUNT_CODES = {
  /** Irrecoverable VAT Expense (expense). */
  IRRECOVERABLE_EXPENSE: "5160",
  /** VAT Adjustments (expense): a hand edit that declares MORE tax than the ledger, with its reason. */
  ADJUSTMENTS: "5165",
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

/**
 * Receipt posting state. Receipts are stored unposted until they are turned
 * into a journal entry, at which point `posted=true`.
 */
export const RECEIPT_STATUS = {
  UNPOSTED: false,
  POSTED: true,
} as const;

/**
 * Generic integration sync status used by the integrations subsystem
 * (Google Sheets imports/exports, etc.).
 */
export const INTEGRATION_SYNC_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type IntegrationSyncStatus =
  (typeof INTEGRATION_SYNC_STATUS)[keyof typeof INTEGRATION_SYNC_STATUS];
