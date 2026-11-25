// Shared money math for line-based documents (quotes, credit notes, purchase
// orders, invoices). The server is the source of truth for totals — clients
// send lines only, and every create/update recomputes from them.
//
// F01: the rounding rule lives in shared/document-totals.ts so the editor,
// API, PDF, e-invoice payload and VAT autopilot all use the same LINE-level
// half-up rounding. This module re-exports it for existing server callers.

export {
  calculateDocumentTotals,
  normaliseVatRate,
  lineNetAmount,
  lineVatAmount,
  roundMoney,
  type DocumentTotalsLine as DocumentLineInput,
} from "../../shared/document-totals";
