/**
 * Invoice list filters from the URL (R13-21, S1 regression cover). Dashboard tiles link to
 * /invoices?status=open|overdue|<status> (server/services/dashboard-stats.service.ts `links`);
 * the Invoices page reads the filter here and the API applies it server-side
 * (GET /api/companies/:id/invoices?status=, which also accepts the derived open / overdue).
 */

/** Statuses the invoice list understands (stored statuses plus derived open / overdue). */
export const INVOICE_STATUS_FILTERS = [
  "open",
  "overdue",
  "draft",
  "sent",
  "partial",
  "paid",
  "void",
] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

/** The ?status= filter from a location search string, or null when absent / unknown. */
export function parseInvoiceStatusFilter(
  search: string | null | undefined
): InvoiceStatusFilter | null {
  if (!search) return null;
  const v = new URLSearchParams(search).get("status");
  if (!v) return null;
  const s = v.trim().toLowerCase();
  return (INVOICE_STATUS_FILTERS as readonly string[]).includes(s)
    ? (s as InvoiceStatusFilter)
    : null;
}

/** The list API query string for a filter (empty when none). */
export function invoiceStatusQuery(filter: string | null | undefined): string {
  return filter ? `&status=${encodeURIComponent(filter)}` : "";
}
