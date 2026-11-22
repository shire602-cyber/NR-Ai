import { endOfDay, startOfDay } from "date-fns";
import { parseCalendarDate } from "./format-date";

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

type InvoiceDateRange = { from?: Date; to?: Date };

export function filterInvoiceDates<T extends { date?: string | Date | null }>(
  rows: T[],
  range: InvoiceDateRange
): T[] {
  if (!range.from && !range.to) return rows;
  const from = range.from ? startOfDay(range.from).getTime() : -Infinity;
  const to = range.to ? endOfDay(range.to).getTime() : Infinity;
  return rows.filter(({ date }) => {
    if (!date) return false;
    const time = parseCalendarDate(date).getTime();
    return time >= from && time <= to;
  });
}

export async function collectInvoiceExportRows<T extends { date?: string | Date | null }>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
  range: InvoiceDateRange
): Promise<T[]> {
  let cursor: string | null = null;
  const rows: T[] = [];
  const seen = new Set<string>();
  do {
    const page = await fetchPage(cursor);
    rows.push(...filterInvoiceDates(page.items, range));
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Invoice pagination did not advance");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return rows;
}
