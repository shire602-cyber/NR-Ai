/**
 * Bill Pay list filters (R13-21 / W3-E residual). Dashboard tiles link to
 * /bill-pay?tab=bills&status=open|overdue|<status>; the page derives its filter from the URL
 * search string on every navigation (not only on first mount), so a second drill-through while
 * the page is open still applies.
 */

export const BILL_STATUS_FILTERS = [
  "all",
  "open",
  "pending",
  "approved",
  "partial",
  "paid",
  "overdue",
] as const;
export type BillStatusFilter = (typeof BILL_STATUS_FILTERS)[number];

/** Bill states that still owe money (accept a payment). */
export const PAYABLE_BILL_STATUSES = ["approved", "overdue", "partial"];

export const BILL_PAY_TABS = ["bills", "payments", "summary"] as const;
export type BillPayTab = (typeof BILL_PAY_TABS)[number];

function params(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

/** The `status` filter named in a search string ("" / unknown values mean "all"). */
export function billStatusFilterFromSearch(search: string): BillStatusFilter {
  const status = params(search).get("status");
  return status && (BILL_STATUS_FILTERS as readonly string[]).includes(status)
    ? (status as BillStatusFilter)
    : "all";
}

/** The `tab` named in a search string (default "bills"). */
export function billPayTabFromSearch(search: string): BillPayTab {
  const tab = params(search).get("tab");
  return tab && (BILL_PAY_TABS as readonly string[]).includes(tab) ? (tab as BillPayTab) : "bills";
}

export interface FilterableBill {
  status: string;
  due_date: string | null;
  vendor_name: string;
  bill_number: string | null;
}

/** Past due on `todayIso` (YYYY-MM-DD). */
export function isBillPastDue(bill: { due_date: string | null }, todayIso: string): boolean {
  if (!bill.due_date) return false;
  return bill.due_date.slice(0, 10) < todayIso;
}

/** Apply the status filter and the vendor / bill-number search. */
export function filterBills<T extends FilterableBill>(
  bills: readonly T[],
  status: string,
  search: string,
  todayIso: string = new Date().toISOString().slice(0, 10)
): T[] {
  let out = [...bills];
  if (status === "open") {
    out = out.filter((b) => PAYABLE_BILL_STATUSES.includes(b.status));
  } else if (status === "overdue") {
    out = out.filter(
      (b) =>
        b.status === "overdue" ||
        (PAYABLE_BILL_STATUSES.includes(b.status) && isBillPastDue(b, todayIso))
    );
  } else if (status !== "all") {
    out = out.filter((b) => b.status === status);
  }
  const q = search.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (b) =>
        b.vendor_name.toLowerCase().includes(q) ||
        (b.bill_number !== null && b.bill_number.toLowerCase().includes(q))
    );
  }
  return out;
}

/** An inbound e-invoice row (GET /api/companies/:id/einvoicing/inbound). */
export interface InboundDocument {
  id: string;
  supplierName: string | null;
  documentNumber: string;
  documentType: string | null;
  status: string;
  billId: string | null;
  receivedAt: string;
}

/** Supplier credit notes (UBL type 381) still waiting for review (W4-C residual). */
export function pendingSupplierCreditNotes(items: readonly InboundDocument[]): InboundDocument[] {
  return items.filter((d) => d.documentType === "381" && d.status === "received" && !d.billId);
}
