/**
 * Balance fields the invoice list API (GET /api/companies/:companyId/invoices) adds to every
 * invoice. Computed server-side from invoice_payments and issued credit notes with the same
 * rule as the aged-receivables report that backs the dashboard `outstanding` figure
 * (total less payments less issued credits, floored at zero, rounded to fils per document).
 */
import type { Invoice } from "./schema";

export interface InvoiceBalanceFields {
  /** Sum of payments received, in the invoice currency. */
  amountPaid: number;
  /** Remaining balance owed in the invoice currency (0 for drafts, void, cancelled, credit notes). */
  openBalance: number;
  /** Remaining balance owed in the company base currency (openBalance x the invoice exchange rate). */
  openBalanceBase: number;
}

/** One row of the invoice list API: the invoice plus its server-computed balance fields. */
export type InvoiceListItem = Invoice & Partial<InvoiceBalanceFields>;
