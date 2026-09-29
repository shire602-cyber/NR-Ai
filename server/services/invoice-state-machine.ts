// Invoice status state machine.
//
// Allowed transitions (target ← any of):
//   draft   → sent, posted, void, cancelled (abandon an unissued draft)
//   sent    → paid, partial, credited, void
//   posted  → paid, partial, credited, void
//   partial → paid, credited, void
//   credited → void         (then refused because credit notes exist; see void service)
//   credited → sent, posted, partial   SYSTEM ONLY: the status sync reopens it when a credit note is voided
//   paid    → void          (allowed but caller should warn)
//   void, cancelled         (terminal — no transitions out)
//
// `credited` is SYSTEM-DERIVED: it is set when credit notes bring an unpaid
// invoice's outstanding amount to zero and lifted again when one is voided.
// The status endpoint refuses to set it, or lift it, by hand. An invoice that is partly paid
// and partly credited to zero is SETTLED, so it becomes `paid` (money was
// received), never `credited`.
//
// Anything not listed is rejected.

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "posted"
  | "partial"
  | "paid"
  | "credited"
  | "void"
  | "cancelled";

export const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "sent",
  "posted",
  "partial",
  "paid",
  "credited",
  "void",
  "cancelled",
];

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "posted", "void", "cancelled"],
  sent: ["paid", "partial", "credited", "void"],
  posted: ["paid", "partial", "credited", "void"],
  partial: ["paid", "credited", "void"],
  credited: ["void"],
  paid: ["void"],
  void: [],
  cancelled: [],
};

export function isValidStatus(status: string): status is InvoiceStatus {
  return INVOICE_STATUSES.includes(status as InvoiceStatus);
}

// Transitions only the internal status sync may make (invoice-credit-status.ts,
// run when a credit note is issued or voided). A person cannot reopen a
// credited invoice by hand: it reopens only when its credit note is voided.
const SYSTEM_TRANSITIONS: Partial<Record<InvoiceStatus, InvoiceStatus[]>> = {
  credited: ["sent", "posted", "partial"],
};

export function canTransition(from: string, to: string, opts: { system?: boolean } = {}): boolean {
  if (from === to) return true;
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  if (TRANSITIONS[from].includes(to)) return true;
  return opts.system === true && (SYSTEM_TRANSITIONS[from] ?? []).includes(to);
}

export function isTerminal(status: string): boolean {
  return status === "void" || status === "cancelled" || status === "paid";
}

/**
 * Compute the correct status from totals.
 *   totalPaid >= total → 'paid'
 *   totalPaid > 0      → 'partial'
 *   else               → preserve prior non-paid status (sent/draft)
 *
 * Caller is responsible for never moving a void/cancelled invoice.
 */
export function statusFromPayments(
  currentStatus: InvoiceStatus,
  total: number,
  totalPaid: number,
  totalCredited = 0
): InvoiceStatus {
  if (isTerminal(currentStatus)) return currentStatus;
  // Credit notes settle part of the invoice exactly like a payment does.
  if (totalPaid + Math.abs(totalCredited) >= total - 0.005) return "paid";
  if (totalPaid > 0) return "partial";
  // No payments — keep whatever non-payment state we were in.
  return currentStatus === "partial" || currentStatus === "paid" ? "sent" : currentStatus;
}

/**
 * Status implied by an invoice's balance (payments AND credit notes). Used
 * after a credit note is issued or voided.
 *
 *   nothing left, something paid   → 'paid'     (settled: cash was received)
 *   nothing left, only credited    → 'credited'
 *   something left, something paid → 'partial'
 *   something left, nothing paid   → back to an open status ('posted' is kept, else 'sent')
 *
 * draft / void / cancelled never move.
 */
export function statusFromBalance(
  currentStatus: InvoiceStatus,
  balance: { total: number; paid: number; credited: number }
): InvoiceStatus {
  if (currentStatus === "draft" || currentStatus === "void" || currentStatus === "cancelled") {
    return currentStatus;
  }
  const paid = Math.abs(Number(balance.paid) || 0);
  const credited = Math.abs(Number(balance.credited) || 0);
  const total = Number(balance.total) || 0;
  if (paid + credited >= total - 0.005) {
    if (paid > 0) return "paid";
    if (credited > 0) return "credited";
    return currentStatus;
  }
  if (paid > 0) return "partial";
  return currentStatus === "posted" ? "posted" : "sent";
}
