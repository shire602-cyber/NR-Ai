// Issuing an invoice (draft -> sent / posted): stock and COGS, the revenue journal and the status change are ONE
// transaction under the document lock.
//
// EXTRACTED from PATCH /api/invoices/:id/status (invoices.routes.ts) in Phase 8 D1 so that advance invoices, recurring
// invoices, sales-order invoices and late fees issue through the very same path.
//
// Phase 9 follow-up: the journal(s) used to commit in their own transactions (releasing the company-month posting
// lock) and the status was set afterwards by the caller, so a VAT filing that took the month lock in between saw the
// ledger but not the document. Now the COGS journal, the revenue journal and the status update commit together, so the
// month lock is released only when ledger and document agree, and a failure at any step leaves nothing behind (no
// journal, no stock movement, the invoice still a draft). The invoice number is allocated when the draft is created
// (FTA gap-free numbering), and the document date is the invoice date, so neither changes here.

import { and, eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { customerContacts, invoices as invoicesTable, type Invoice } from "../../shared/schema";
import { withDocumentLock, LOCK_NS } from "./document-lock";
import { assertPeriodNotLocked, assertNotFutureDate } from "./period-lock.service";
import { postInvoiceRevenueJournalInTx } from "./invoice-posting.service";
import { postCogsForInvoiceInTx } from "./inventory-costing.service";

export type IssueResult =
  | { ok: true }
  | { ok: false; status: number; body: { message: string; code: string } };

export type IssuedStatus = "sent" | "posted";

/** Thrown inside the transaction to roll everything back (COGS included) and answer with `result`. */
class IssueRefused extends Error {
  constructor(readonly result: Extract<IssueResult, { ok: false }>) {
    super(result.body.message);
  }
}

/**
 * Recognise revenue for a draft invoice and set its status (default "sent"), atomically. Throws on a locked period,
 * a future date or short stock (the global error handler renders those); returns a failure when the chart of
 * accounts lacks the revenue accounts. Idempotent: an invoice that is no longer a draft is left untouched.
 */
export async function issueInvoice(
  invoice: Invoice,
  userId: string,
  status: IssuedStatus = "sent"
): Promise<IssueResult> {
  const id = invoice.id;
  await assertPeriodNotLocked(invoice.companyId, invoice.date);
  // A-4: do not recognise revenue with a future invoice date.
  assertNotFutureDate(invoice.date);
  try {
    return await withDocumentLock(id, LOCK_NS.INVOICE_POSTING, async (tx: typeof db) => {
      // Re-read under the lock: a parallel issue / void that held it just before us has already committed.
      const [current] = await tx
        .select()
        .from(invoicesTable)
        .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, invoice.companyId)));
      if (!current) {
        throw new IssueRefused({ ok: false, status: 404, body: { message: "Invoice not found", code: "INVOICE_NOT_FOUND" } });
      }
      if (current.status === "void" || current.status === "cancelled") {
        throw new IssueRefused({
          ok: false,
          status: 409,
          body: { message: `Invoice ${current.number} is ${current.status} and cannot be issued.`, code: "INVALID_TRANSITION" },
        });
      }
      if (current.status !== "draft") return { ok: true } as IssueResult; // already issued by someone else

      // Place of supply: a draft made without one (quote conversion, project invoice, recurring template) takes
      // the customer's emirate now; from here on it is part of the issued document.
      if (!(current as any).emirate && current.contactId) {
        const [contactRow] = await tx
          .select({ emirate: customerContacts.emirate })
          .from(customerContacts)
          .where(and(eq(customerContacts.id, current.contactId), eq(customerContacts.companyId, invoice.companyId)));
        if (contactRow?.emirate) {
          await tx.update(invoicesTable).set({ emirate: contactRow.emirate } as any).where(eq(invoicesTable.id, id));
          (current as any).emirate = contactRow.emirate;
        }
      }

      // Inventory first: stock is checked and consumed (and COGS posted) BEFORE revenue is recognised, so a
      // short-stock invoice is refused with 422 INSUFFICIENT_STOCK and nothing has been posted.
      await postCogsForInvoiceInTx(tx, current as any, userId);
      const posted = await postInvoiceRevenueJournalInTx(tx, current as any, userId);
      // postInvoiceRevenueJournalInTx returns false both for "already posted" (fine: legacy data) and
      // "missing accounts" (NOT fine): distinguish via the GL.
      if (!posted) {
        const existing = await storage.getJournalEntriesBySource(invoice.companyId, "invoice", id);
        if (!existing.some((e) => e.status === "posted")) {
          throw new IssueRefused({
            ok: false,
            status: 422,
            body: {
              message:
                "Cannot issue invoice: revenue accounts are missing from the chart of accounts. Seed the default chart first (POST /api/companies/:id/seed-accounts).",
              code: "CHART_OF_ACCOUNTS_MISSING",
            },
          });
        }
      }
      await tx
        .update(invoicesTable)
        .set({ status })
        .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, invoice.companyId)));
      return { ok: true } as IssueResult;
    });
  } catch (err) {
    if (err instanceof IssueRefused) return err.result;
    throw err;
  }
}
