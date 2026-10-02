// Issuing an invoice (draft -> sent / posted): stock and COGS first, then the revenue journal.
//
// EXTRACTED from PATCH /api/invoices/:id/status (invoices.routes.ts) in Phase 8 D1 without logic changes, so that
// advance invoices, recurring invoices, sales-order invoices and late fees issue through the very same path.
// The caller updates the invoice status afterwards (updateInvoiceStatus) like the route does.

import { storage } from "../storage";
import { db } from "../db";
import type { Invoice } from "../../shared/schema";
import { withDocumentLock, LOCK_NS } from "./document-lock";
import { assertPeriodNotLocked, assertNotFutureDate } from "./period-lock.service";
import { postInvoiceRevenueJournal } from "./invoice-posting.service";
import { postCogsForInvoice, restockInvoiceInTx } from "./inventory-costing.service";

export type IssueResult =
  | { ok: true }
  | { ok: false; status: number; body: { message: string; code: string } };

// The issue could not complete after stock was consumed: return it and reverse the COGS journal.
async function undoIssueCogs(invoice: Invoice, userId: string): Promise<void> {
  const now = new Date();
  await withDocumentLock(invoice.id, LOCK_NS.INVOICE_POSTING, (tx: typeof db) =>
    restockInvoiceInTx(tx, {
      invoice,
      userId,
      requested: null,
      reversalDate: invoice.date instanceof Date ? invoice.date : new Date(invoice.date),
      postedAt: now,
      source: { id: invoice.id, label: `Issue of Invoice ${invoice.number} not completed` },
      reason: "Issue not completed",
    })
  );
}

/**
 * Recognise revenue for a draft invoice. Throws on a locked period, a future date or short stock (the global
 * error handler renders those); returns a failure when the chart of accounts lacks the revenue accounts.
 */
export async function issueInvoice(invoice: Invoice, userId: string): Promise<IssueResult> {
  const id = invoice.id;
  await assertPeriodNotLocked(invoice.companyId, invoice.date);
  // A-4: do not recognise revenue with a future invoice date.
  assertNotFutureDate(invoice.date);
  // Inventory first: stock is checked and consumed (and COGS posted) in one transaction
  // BEFORE revenue is recognised, so a short-stock invoice is refused with 422
  // INSUFFICIENT_STOCK and nothing has been posted. If revenue then cannot post, the
  // stock effect is undone below.
  const cogs = await postCogsForInvoice(invoice as any, userId);
  let posted: boolean;
  try {
    posted = await postInvoiceRevenueJournal(invoice as any, userId);
  } catch (err) {
    if (cogs.consumed) await undoIssueCogs(invoice as any, userId);
    throw err;
  }
  const existing = await storage.getJournalEntriesBySource(
    invoice.companyId,
    "invoice",
    id
  );
  // postInvoiceRevenueJournal returns false both for "already posted"
  // (fine) and "missing accounts" (NOT fine) — distinguish via the GL.
  if (!posted && !existing.some((e) => e.status === "posted")) {
    if (cogs.consumed) await undoIssueCogs(invoice as any, userId);
    return {
      ok: false,
      status: 422,
      body: {
        message:
          "Cannot issue invoice: revenue accounts are missing from the chart of accounts. Seed the default chart first (POST /api/companies/:id/seed-accounts).",
        code: "CHART_OF_ACCOUNTS_MISSING",
      },
    };
  }
  return { ok: true };
}
