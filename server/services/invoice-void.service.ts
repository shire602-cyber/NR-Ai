// Atomic, idempotent void / cancel of an invoice or credit note.
//
// The route used to read the status, check for payments and credit notes, post
// the reversing journal entry and only then flip the status, with no lock in
// between. Five parallel PATCH {status:"void"} requests all read "sent", all
// posted a reversal and all returned 200: AR went to -1050, revenue to +1000.
//
// Now everything happens in ONE transaction that first
//   1. takes the document advisory locks (invoice posting + credit notes of the
//      original invoice, so a concurrent issue / credit note serialises with us),
//   2. locks the invoice row FOR UPDATE (the same row recordInvoicePayment
//      locks, so a concurrent payment queues behind us),
//   3. re-reads status, payments, credit notes and the journal INSIDE the lock.
// The loser of a race therefore sees the committed void and gets 409
// INVOICE_ALREADY_VOID; a reversal that already exists is never posted twice.
// Inside the transaction only the transaction handle is used (never the pool),
// so N parallel requests waiting on the lock cannot starve the winner of a
// connection.

import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  invoices as invoicesTable,
  invoicePayments,
  journalEntries,
  journalLines,
} from "../../shared/schema";
import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";
import { canTransition } from "./invoice-state-machine";
import { evaluateVoidRequest, selectVoidableEntries } from "./invoice-lifecycle";
import { reverseToZero } from "./credit-note-remainder.service";
import { resolveInvoiceFx } from "./invoice-fx";
import { acquireDocumentLock, LOCK_NS } from "./document-lock";
import { assertPeriodNotLocked } from "./period-lock.service";
import { syncInvoiceStatusFromBalance } from "./invoice-credit-status";
import { countLiveRefunds } from "./customer-refund.service";
import { uaeCalendarDate } from "../utils/date";
import { restockForVoidInTx, undoCreditNoteRestockInTx } from "./inventory-costing.service";
import { createLogger } from "../config/logger";

const log = createLogger("invoice-void");

export type VoidOutcome =
  | { ok: true; reversalEntryId: string | null }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): VoidOutcome => ({ ok: false, status, code, message });

export function alreadyTerminalOutcome(status: string): VoidOutcome {
  return status === "cancelled"
    ? fail(409, "INVOICE_ALREADY_CANCELLED", "This invoice is already cancelled.")
    : fail(409, "INVOICE_ALREADY_VOID", "This document is already void; it was reversed once and cannot be voided again.");
}

export async function voidOrCancelInvoice(args: {
  invoiceId: string;
  companyId: string;
  targetStatus: "void" | "cancelled";
  userId: string;
}): Promise<VoidOutcome> {
  const { invoiceId, companyId, targetStatus, userId } = args;

  // Everything that needs the pool is read BEFORE the transaction is opened.
  const preliminary = await storage.getInvoice(invoiceId, companyId);
  if (!preliminary) return fail(404, "INVOICE_NOT_FOUND", "Invoice not found");
  // An opening-balance invoice posted nothing of its own (its amount is inside the opening
  // balances), so voiding it would flip the status and leave the receivable in the ledger.
  if ((preliminary as any).isOpeningBalance) {
    return fail(
      409,
      "OPENING_BALANCE_INVOICE",
      "This invoice was entered as an opening balance. Reverse the opening balances to remove it."
    );
  }
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const accountsReceivable = accounts.find((a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
  const vatPayable = accounts.find(
    (a) => a.isVatAccount && a.vatType === "output" && a.code === ACCOUNT_CODES.VAT_OUTPUT
  );
  // The reversal is dated the UAE calendar day of the void (UTC midnight of that day, the way the
  // ledger reads dates), because that date decides which VAT period reports the cancellation
  // (vat-document-effect.ts). postedAt stays the real instant.
  const postedAtNow = new Date();
  const reversalDate = uaeCalendarDate(postedAtNow);
  // Block reversal posting into a locked period - without this we could flip
  // status without writing the offsetting JE. Only needed when a JE will be
  // posted (an unposted draft has nothing to reverse).
  const priorEntries = await storage.getJournalEntriesBySource(companyId, "invoice", invoiceId);
  if (priorEntries.some((e) => e.status === "posted")) {
    await assertPeriodNotLocked(companyId, reversalDate);
  }
  // A credit note's lock key is its ORIGINAL invoice, the key credit-note creation uses.
  const creditNoteLockKey = preliminary.originalInvoiceId ?? invoiceId;

  return await db.transaction(async (tx: typeof db) => {
    await acquireDocumentLock(tx, invoiceId, LOCK_NS.INVOICE_POSTING);
    await acquireDocumentLock(tx, creditNoteLockKey, LOCK_NS.CREDIT_NOTE);
    await tx.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`);

    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId)));
    if (!invoice) return fail(404, "INVOICE_NOT_FOUND", "Invoice not found");

    if (invoice.status === "void" || invoice.status === "cancelled") {
      return alreadyTerminalOutcome(invoice.status);
    }
    if (!canTransition(invoice.status, targetStatus)) {
      return fail(422, "INVALID_TRANSITION", `Invalid invoice status transition: ${invoice.status} → ${targetStatus}`);
    }

    // Cash already paid back against a credit note must be voided first: voiding the credit note
    // underneath a standing refund would leave the customer's credit and the cash out of step.
    if (invoice.invoiceType === "credit_note" && (await countLiveRefunds(tx, invoiceId)) > 0) {
      return fail(
        409,
        "CREDIT_NOTE_HAS_REFUNDS",
        "This credit note has refunds paid against it. Void the refunds first, then void the credit note."
      );
    }

    // A-1: refuse to void/cancel an invoice that has recorded payments (the
    // reversal only unwinds revenue/VAT/AR; the cash would be left orphaned).
    const payments = await tx.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId));
    const paidTotal = payments.reduce((sum: number, p: { amount: number }) => sum + Number(p.amount), 0);
    // Credit notes already reversed part of the original entry; voiding would
    // negate it again (double reversal), so refuse.
    const liveCreditNotes = await tx
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.originalInvoiceId, invoiceId),
          eq(invoicesTable.invoiceType, "credit_note"),
          notInArray(invoicesTable.status, ["void", "cancelled"])
        )
      );
    const decision = evaluateVoidRequest({
      targetStatus,
      paidTotal,
      creditNoteCount: liveCreditNotes.length,
    });
    if (!decision.ok) return fail(decision.status, decision.code, decision.message);

    const entries = await tx
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.source, "invoice"),
          eq(journalEntries.sourceId, invoiceId)
        )
      );
    const { original, reversal } = selectVoidableEntries(entries);

    // Idempotency guard on the ledger itself: never a second reversal.
    if (reversal) {
      return fail(409, "REVERSAL_ALREADY_POSTED", "A reversal journal entry already exists for this document.");
    }

    let reversalEntryId: string | null = null;
    if (original) {
      // Reverse the AED amounts that were actually posted: read the original
      // entry's lines and negate them. Recomputing from the document amounts
      // reversed a foreign-currency invoice in document currency and let
      // rounding drift; negating the posted lines cannot.
      const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, original.id));
      const postedLines = lines.map((l: any) => ({
        accountId: l.accountId,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }));
      const reversalLegs = reverseToZero(postedLines, {
        arAccountId: accountsReceivable?.id ?? null,
        vatAccountId: vatPayable?.id ?? null,
        labels: {
          revenue: `Reverse revenue - Void Invoice ${invoice.number}`,
          vat: `Reverse VAT - Void Invoice ${invoice.number}`,
          ar: `Reverse A/R - Void Invoice ${invoice.number}`,
        },
      });
      if (reversalLegs.length === 0) {
        return fail(422, "NOTHING_TO_REVERSE", "Cannot post reversal: the original journal entry has no lines to reverse.");
      }
      const fx = resolveInvoiceFx(invoice as any);
      // The AR leg keeps the document-currency amount, like the posting did.
      const reversalLines =
        accountsReceivable && fx.isForeign
          ? reversalLegs.map((l) =>
              l.accountId === accountsReceivable.id && l.credit > 0
                ? { ...l, foreignCurrency: fx.currency, exchangeRate: fx.rate, foreignCredit: Number(invoice.total) }
                : l
            )
          : reversalLegs;

      const entry = await storage.createJournalEntry(
        {
          companyId,
          date: reversalDate,
          memo: `Void Invoice ${invoice.number} - reversal of original posting`,
          entryNumber: "PENDING", // assigned inside the transaction
          status: "posted",
          source: "invoice",
          sourceId: invoiceId,
          reversedEntryId: original.id,
          reversalReason: `Invoice ${targetStatus}`,
          createdBy: userId,
          postedBy: userId,
          postedAt: postedAtNow,
        } as any,
        reversalLines as any,
        { tx }
      );
      reversalEntryId = entry.id;
      log.info({ invoiceId, originalEntryId: original.id, entryNumber: entry.entryNumber }, "Void reversal journal entry created");
    }

    // Stock sold on this invoice comes back at the cost it left at and its COGS journal is
    // reversed (same transaction, same period lock as the revenue reversal). No-op when the
    // invoice consumed no stock.
    if (invoice.invoiceType !== "credit_note") {
      await restockForVoidInTx(tx, {
        invoice: invoice as any,
        userId,
        reversalDate,
        postedAt: postedAtNow,
        targetStatus,
      });
    } else {
      // A credit note that restocked brings that stock back out and re-posts the COGS it reversed
      // (409 STOCK_ALREADY_CONSUMED when the units were sold again; the throw rolls everything back).
      await undoCreditNoteRestockInTx(tx, {
        creditNote: invoice as any,
        userId,
        reversalDate,
        postedAt: postedAtNow,
      });
    }

    await tx
      .update(invoicesTable)
      .set({ status: targetStatus })
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.companyId, companyId)));
    // A voided credit note no longer reduces its invoice: give the invoice its
    // open / partial / paid status back (a credited invoice becomes payable again).
    if (invoice.invoiceType === "credit_note" && invoice.originalInvoiceId) {
      await syncInvoiceStatusFromBalance(tx, companyId, invoice.originalInvoiceId);
    }
    return { ok: true, reversalEntryId } as VoidOutcome;
  });
}
