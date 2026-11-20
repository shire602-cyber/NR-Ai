/**
 * Bill Pay list filters (R13-21 / W3-E residual). Dashboard tiles link to
 * /bill-pay?tab=bills&status=open|overdue|<status>; the page derives its filter from the URL
 * search string on every navigation (not only on first mount), so a second drill-through while
 * the page is open still applies.
 */

export const BILL_STATUS_FILTERS = [
  "all",
  "to_complete",
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

/** WQ2: drafts and rejected bills still need the maker's work before approval. */
export const TO_COMPLETE_STATUSES = ["draft", "rejected"];

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
  if (status === "to_complete") {
    out = out.filter((b) => TO_COMPLETE_STATUSES.includes(b.status));
  } else if (status === "open") {
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

// ── WQ2 (8.15): status tabs ──────────────────────────────────────────────────

/**
 * The bill list tabs, in order. Each maps to one status filter, so the URL (?status=) and a
 * dashboard drill-through select the same tab. "To pay" counts every bill that still owes money
 * (overdue ones included); "Overdue" is the past-due part of it.
 */
export const BILL_LIST_TABS = [
  { id: "to_complete", filter: "to_complete" },
  { id: "to_approve", filter: "pending" },
  { id: "to_pay", filter: "open" },
  { id: "overdue", filter: "overdue" },
  { id: "paid", filter: "paid" },
  // Sixth tab: ScrollTabs (spec 2.4, at most 5 visible) puts it in the "More" menu.
  { id: "all", filter: "all" },
] as const;
export type BillListTabId = (typeof BILL_LIST_TABS)[number]["id"];

/** The tab a status filter belongs to (approved / partial have none: they show under All). */
export function billTabForFilter(filter: string): BillListTabId {
  return BILL_LIST_TABS.find((t) => t.filter === filter)?.id ?? "all";
}

export interface ApprovalQueueEntry {
  bill_id: string;
  awaiting_me: boolean;
}

/**
 * Count per tab (the same rules as filterBills, so a count always equals the rows its tab shows),
 * plus how many pending bills wait for the current user's sign-off under the approval rules.
 */
export function billTabCounts<T extends FilterableBill & { id: string }>(
  bills: readonly T[],
  queue: readonly ApprovalQueueEntry[] = [],
  todayIso: string = new Date().toISOString().slice(0, 10)
): Record<BillListTabId, number> & { awaitingMe: number } {
  const counts = Object.fromEntries(
    BILL_LIST_TABS.map((tab) => [tab.id, filterBills(bills, tab.filter, "", todayIso).length])
  ) as Record<BillListTabId, number>;
  const pending = new Set(bills.filter((b) => b.status === "pending").map((b) => b.id));
  const awaitingMe = queue.filter((q) => q.awaiting_me && pending.has(q.bill_id)).length;
  return { ...counts, awaitingMe };
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
