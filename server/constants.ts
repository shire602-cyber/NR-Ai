// UAE accounting constants used across the codebase.
// Centralized here so VAT rates, currency, and the system Chart of Accounts
// codes are not duplicated as magic numbers/strings in route and service files.

/** UAE standard VAT rate (5%). */
export const UAE_VAT_RATE = 0.05;

/** UAE Corporate Tax small-business exemption threshold in AED. */
export const UAE_CT_EXEMPTION_THRESHOLD = 375_000;

/** Default reporting/invoice currency for UAE-based businesses. */
export const DEFAULT_CURRENCY = 'AED';

/**
 * System-account codes from the default UAE Chart of Accounts.
 * The accounting code lookup logic in routes/services should reference these
 * names instead of bare strings, so a future COA renumbering only touches one
 * file.
 */
export const ACCOUNT_CODES = {
  /** Accounts Receivable (current asset). */
  AR: '1040',
  /** Accounts Payable (current liability). Matches `2010` in the default UAE COA. */
  AP: '2010',
  /** Output VAT payable (current liability). Matches `2020` in the default UAE COA. */
  VAT_OUTPUT: '2020',
  /** Input VAT receivable (current asset). Matches `1050` in the default UAE COA. */
  VAT_INPUT: '1050',
  /** Sales Revenue (income). */
  REVENUE: '4010',
  /** Service Revenue (alternate revenue account some firms use). */
  REVENUE_ALT: '4020',
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
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type IntegrationSyncStatus =
  (typeof INTEGRATION_SYNC_STATUS)[keyof typeof INTEGRATION_SYNC_STATUS];
