/**
 * Mirrors the server rule on PUT /api/invoices/:id: paid, void, cancelled and
 * credited invoices are locked (fix them with a credit note or by reopening,
 * not by editing). Hide the Edit action for them instead of offering a button
 * that can only fail.
 */
const LOCKED_INVOICE_STATUSES = new Set(["credited", "paid", "void", "cancelled"]);

export function canEditInvoice(status: string | null | undefined): boolean {
  return !LOCKED_INVOICE_STATUSES.has((status ?? "").toLowerCase());
}
