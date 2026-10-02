/**
 * Endpoints the sales screens call that are not plain REST on a list (actions on one record or a whole company). One place, so a
 * path change is one edit.
 */
export const salesEndpoints = {
  /** Pay (part of) what a customer paid on an invoice back: a credit note plus the refund, so statement and ageing show it. */
  refundPayment: (companyId: string, invoiceId: string) => `/api/companies/${companyId}/invoices/${invoiceId}/payment-refunds`,
  /** Generate the recurring invoices that are due now for this company, instead of waiting for the daily job. */
  runRecurringNow: (companyId: string) => `/api/companies/${companyId}/recurring-invoices/run-now`,
  /** Raise the late fees that are due now for this company, instead of waiting for the daily job. */
  runLateFeesNow: (companyId: string) => `/api/companies/${companyId}/late-fees/run-now`,
  /** A customer's credit balance (overpayments held in 2050) and the refunds paid out of it. */
  customerCredit: (companyId: string, contactId: string) => `/api/companies/${companyId}/customers/${contactId}/credit`,
  customerCreditRefunds: (companyId: string, contactId: string) => `/api/companies/${companyId}/customers/${contactId}/credit-refunds`,
  voidCustomerCreditRefund: (companyId: string, contactId: string, refundId: string) =>
    `/api/companies/${companyId}/customers/${contactId}/credit-refunds/${refundId}/void`,
} as const;

/** How many records a "run now" call created, from whichever count the server reports (0 when it reports none). */
export function jobCreatedCount(result: unknown): number {
  const r = (result ?? {}) as Record<string, unknown>;
  for (const key of ["generated", "created", "count", "raised", "invoices"]) {
    const v = r[key];
    if (typeof v === "number") return v;
    if (Array.isArray(v)) return v.length;
  }
  return 0;
}
