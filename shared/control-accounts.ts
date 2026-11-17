/**
 * A2 (H8): default-chart control accounts and the sub-ledger that owns each. Manual journals may
 * touch these only as an explicit adjustment with a reason (server/ledger/control-accounts.ts).
 * Client-safe (no runtime imports).
 */
export type ControlLedger = "receivables" | "payables" | "inventory" | "vat" | "grni" | "payroll";

export const CONTROL_ACCOUNT_CODES: Readonly<Record<string, ControlLedger>> = {
  "1040": "receivables",
  "2010": "payables",
  "1070": "inventory",
  "1050": "vat",
  "2020": "vat",
  "2015": "grni",
  "2030": "payroll",
  "2032": "payroll",
  "2034": "payroll",
  "2036": "payroll",
};

/** True when an account (by code / VAT flag) is a control account in the default chart. */
export function isControlAccount(a: { code?: string | null; isVatAccount?: boolean | null }) {
  return !!(a.code && CONTROL_ACCOUNT_CODES[a.code]) || a.isVatAccount === true;
}
