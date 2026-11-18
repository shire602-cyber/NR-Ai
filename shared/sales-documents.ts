/**
 * WQ1: pure rules shared by the sales editors (client) and routes (server). Client-safe: no
 * schema or runtime imports.
 */

/** Payment terms a sales document can carry (the server validator's grammar). */
export const PAYMENT_TERM_OPTIONS = [
  "due_on_receipt",
  "net7",
  "net15",
  "net30",
  "net45",
  "net60",
  "net90",
] as const;

/** Contact payment terms are stored in days; a document carries due_on_receipt / netN. */
export function termsFromDays(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days) || days < 0) return null;
  return days === 0 ? "due_on_receipt" : `net${Math.round(days)}`;
}

/** Days of credit in a terms code (due_on_receipt = 0, netN = N), null when unknown. */
export function daysFromTerms(terms: string | null | undefined): number | null {
  if (!terms) return null;
  if (terms === "due_on_receipt") return 0;
  const m = /^net(\d{1,3})$/.exec(terms);
  return m ? Number(m[1]) : null;
}

/** Due date (YYYY-MM-DD) = document date + the terms' days; null for custom / unknown terms. */
export function dueDateFromTerms(dateIso: string, terms: string | null | undefined): string | null {
  const days = daysFromTerms(terms);
  if (days === null || !/^\d{4}-\d{2}-\d{2}/.test(dateIso)) return null;
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface OpenInvoiceForReceipt {
  id: string;
  /** Open balance in fils (invoice currency). */
  openFils: number;
  /** YYYY-MM-DD; the oldest due date is paid first, then the oldest invoice date. */
  dueDate?: string | null;
  date?: string | null;
  number?: string | null;
}

/**
 * Auto apply (7.6): spread a receipt over open invoices, oldest due date first (invoice date,
 * then number, as tie-breaks). Returns the allocation per invoice (fils, only > 0) and what is
 * left over (an overpayment, which becomes customer credit).
 */
export function autoApplyOldestFirst(
  amountFils: number,
  invoices: OpenInvoiceForReceipt[]
): { allocations: Array<{ invoiceId: string; amountFils: number }>; unappliedFils: number } {
  const key = (i: OpenInvoiceForReceipt) =>
    `${(i.dueDate || i.date || "9999-12-31").slice(0, 10)}|${(i.date || "").slice(0, 10)}|${i.number ?? ""}`;
  const ordered = [...invoices]
    .filter((i) => i.openFils > 0)
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  let left = Math.max(0, Math.round(amountFils));
  const allocations: Array<{ invoiceId: string; amountFils: number }> = [];
  for (const inv of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, inv.openFils);
    allocations.push({ invoiceId: inv.id, amountFils: take });
    left -= take;
  }
  return { allocations, unappliedFils: left };
}
