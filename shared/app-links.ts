/**
 * In-app links written into stored records (notification `actionUrl`s, reminder links). They are
 * kept here so the server never stores a path the client router does not have (the broken-path
 * sweep found `/invoices/<id>`, `/banking`, `/compliance` and `/settings` links that opened the
 * 404 page; tests/unit/app-links-routes.test.ts pins every stored link to a client route).
 */

/** One bill, opened in the bill editor/view. */
export function billHref(billId: string): string {
  return `/bill-pay/${encodeURIComponent(billId)}/edit`;
}

/** One receipt, opened in the receipt dialog (Receipts.tsx reads `?open=<id>`). */
export function receiptHref(receiptId: string): string {
  return `/receipts?open=${encodeURIComponent(receiptId)}`;
}

/** One invoice, opened in the invoice view (Invoices.tsx reads `?open=<id>`). */
export function invoiceHref(invoiceId: string): string {
  return `/invoices?open=${encodeURIComponent(invoiceId)}`;
}

/** Open the CSV statement import dialog. */
export const BANK_STATEMENT_IMPORT_HREF = "/bank-reconciliation?import=1";
