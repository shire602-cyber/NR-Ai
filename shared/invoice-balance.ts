/**
 * Balance fields the invoice list API (GET /api/companies/:companyId/invoices) adds to every
 * invoice. Computed server-side with the one settlement rule (server/reporting/settlement.ts)
 * that the aged-receivables report and the dashboard `outstanding` figure use: total less
 * payments, issued credit-note invoices and applied customer credits, floored at zero, rounded
 * to fils per document.
 */
import type { Invoice } from "./schema";

export interface InvoiceBalanceFields {
  /** Sum of payments received, in the invoice currency. */
  amountPaid: number;
  /** Remaining balance owed in the invoice currency (0 for drafts, void, cancelled, credit notes). */
  openBalance: number;
  /** Remaining balance owed in the company base currency (openBalance x the invoice exchange rate). */
  openBalanceBase: number;
  /**
   * C2 (NL3): the part of amountPaid that is a bad-debt write-off, not cash (invoice currency).
   * A fully written-off invoice is settled ("paid" status) but shown as written off.
   */
  amountWrittenOff?: number;
}

/** One row of the invoice list API: the invoice plus its server-computed balance fields. */
export type InvoiceListItem = Invoice & Partial<InvoiceBalanceFields>;
