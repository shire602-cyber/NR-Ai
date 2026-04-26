// Invoice status state machine.
//
// Allowed transitions (target ← any of):
//   draft   → sent, posted, void
//   sent    → paid, partial, void
//   posted  → paid, partial, void
//   partial → paid, void
//   paid    → void          (allowed but caller should warn)
//   void, cancelled         (terminal — no transitions out)
//
// Anything not listed is rejected.

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'posted'
  | 'partial'
  | 'paid'
  | 'void'
  | 'cancelled';

export const INVOICE_STATUSES: InvoiceStatus[] = [
  'draft',
  'sent',
  'posted',
  'partial',
  'paid',
  'void',
  'cancelled',
];

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['sent', 'posted', 'void'],
  sent: ['paid', 'partial', 'void'],
  posted: ['paid', 'partial', 'void'],
  partial: ['paid', 'void'],
  paid: ['void'],
  void: [],
  cancelled: [],
};

export function isValidStatus(status: string): status is InvoiceStatus {
  return INVOICE_STATUSES.includes(status as InvoiceStatus);
}

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: string): boolean {
  return status === 'void' || status === 'cancelled' || status === 'paid';
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
): InvoiceStatus {
  if (isTerminal(currentStatus)) return currentStatus;
  if (totalPaid >= total - 0.005) return 'paid';
  if (totalPaid > 0) return 'partial';
  // No payments — keep whatever non-payment state we were in.
  return currentStatus === 'partial' || currentStatus === 'paid'
    ? 'sent'
    : currentStatus;
}
