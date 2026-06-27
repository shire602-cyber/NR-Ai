// A-B1: The previous Stripe invoice-payment helpers in this module
// (`createInvoicePaymentSession` / `handleInvoicePaymentCompleted`) were
// removed. They were dead code (no callers anywhere in the codebase) and,
// worse, the completion handler marked an invoice "paid" with a plain column
// write and posted NO journal entry — so Accounts Receivable would never clear
// and the bank would be understated.
//
// When online invoice payment is implemented, it MUST settle the receivable
// through `storage.recordInvoicePayment(...)`, which posts the balanced
// Dr Bank / Cr A/R cash-receipt entry (and now also handles overpayments as a
// customer credit). This module is intentionally left empty to prevent the
// broken path from being reintroduced.

export {};
