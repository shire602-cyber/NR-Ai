// What a bank line does to the books. One bank line, one lock (LOCK_NS.BANK_TRANSACTION): the row is re-read inside
// the lock, refused when already matched or frozen by a completed reconciliation, and the match is written in the
// same transaction as the journal entry it posts.
//
//   invoice  inflow  storage.recordInvoicePayment           Dr bank / Cr 1040 (source "payment")
//   bill     outflow recordBillPayment                      Dr 2010 / Cr bank (source "bill_payment")
//   account  either  one chosen account                     Dr bank / Cr account, or the reverse (source "bank_reconciliation")
//   rule     either  the rule's split lines (+ input VAT)   (source "bank_rule", plus a receipt row for the VAT)
//   journal / receipt  link only, nothing is posted
//   unmatch  reverses what the bank line itself posted; a payment stays and can be linked again

import { and, eq, sql } from "drizzle-orm";
import { bankTransactions, journalEntries, journalLines, type BankTransaction } from "../../shared/schema";
import { ACCOUNT_CODES } from "../constants";
import { storage } from "../storage";
import { getInvoiceBalance } from "./invoice-outstanding.db";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import { assertPeriodNotLocked } from "./period-lock.service";
import { resolveSettlementDate } from "./payment-date-guard.service";
import { recordBillPayment } from "./bill-payment.service";
import { buildBankEntryLines, reverseLines } from "./bank-entry-lines";
import { applyRuleInTx, RULE_SOURCE } from "./bank-rules.service";
import {
  appError,
  assertNotFrozen,
  assertOpen,
  bankRate,
  clearedPatch,
  matchPatch,
  periodLockedCode,
  readTransaction,
  resolveBank,
  resolveContraAccount,
  type PostCtx,
  type Tx,
} from "./bank-posting-common";

export const BANK_ENTRY_SOURCE = "bank_reconciliation";
export type MatchKind = "invoice" | "bill" | "journal" | "receipt" | "rule" | "account";

export interface MatchInput {
  transactionId: string;
  kind: MatchKind;
  targetId: string;
  paymentDate?: string | null;
  memo?: string | null;
  confidence?: number | null;
}

export interface MatchResult {
  transaction: BankTransaction;
  journalEntryId: string | null;
  receiptId: string | null;
  kind: MatchKind;
}

const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const ymdOf = (d: Date): string => d.toISOString().slice(0, 10);

async function save(tx: Tx, ctx: PostCtx, txnId: string, patch: Record<string, unknown>): Promise<BankTransaction> {
  const [row] = await tx
    .update(bankTransactions)
    .set(patch)
    .where(and(eq(bankTransactions.id, txnId), eq(bankTransactions.companyId, ctx.companyId)))
    .returning();
  return row;
}

// ─── re-link a payment an earlier unmatch left in the ledger ───────────────

/**
 * A posted payment of this document, from this bank GL account, for exactly this amount, whose journal no bank line of
 * the same bank account links to. Returns its journal entry id.
 */
async function findUnlinkedPayment(
  tx: Tx,
  a: { table: "invoice_payments" | "bill_payments"; fk: "invoice_id" | "bill_id"; documentId: string; companyId: string; glAccountId: string; amount: number; source: string; txnId: string }
): Promise<string | null> {
  const rows = rowsOf(
    await tx.execute(
      a.table === "invoice_payments"
        ? sql`
      SELECT je.id FROM invoice_payments p
        JOIN journal_entries je ON je.id = p.journal_entry_id AND je.company_id = ${a.companyId}
       WHERE p.invoice_id = ${a.documentId} AND p.payment_account_id = ${a.glAccountId} AND ABS(p.amount - ${a.amount}) < 0.005
         AND je.status = 'posted' AND je.source = ${a.source}
         AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversed_entry_id = je.id AND rv.status = 'posted')
         AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.company_id = je.company_id AND bt.matched_journal_entry_id = je.id
                          AND bt.bank_account_id = ${a.glAccountId} AND bt.id <> ${a.txnId})
       ORDER BY je.date LIMIT 1`
        : sql`
      SELECT je.id FROM bill_payments p
        JOIN journal_entries je ON je.company_id = ${a.companyId} AND je.source = ${a.source} AND je.source_id = p.id
       WHERE p.bill_id = ${a.documentId} AND p.payment_account_id = ${a.glAccountId} AND ABS(p.amount - ${a.amount}) < 0.005
         AND je.status = 'posted'
         AND NOT EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversed_entry_id = je.id AND rv.status = 'posted')
         AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.company_id = je.company_id AND bt.matched_journal_entry_id = je.id
                          AND bt.bank_account_id = ${a.glAccountId} AND bt.id <> ${a.txnId})
       ORDER BY je.date LIMIT 1`
    )
  );
  return rows[0]?.id ?? null;
}

// ─── invoice ───────────────────────────────────────────────────────────────

async function matchInvoice(tx: Tx, ctx: PostCtx, txn: BankTransaction, bank: { glAccountId: string; currency: string }, input: MatchInput): Promise<MatchResult> {
  if (Number(txn.amount) <= 0) throw appError(422, "DIRECTION_MISMATCH", "Only money received can be matched to an invoice.");
  const invoice = await storage.getInvoice(input.targetId, ctx.companyId);
  if (!invoice) throw appError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  if ((invoice.currency || "AED").toUpperCase() !== bank.currency) {
    throw appError(422, "CURRENCY_MISMATCH", `The invoice is in ${invoice.currency} but this bank account is in ${bank.currency}.`);
  }
  const accounts = await storage.getAccountsByCompanyId(ctx.companyId);
  const ar = accounts.find((a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
  if (!ar) throw appError(500, "AR_ACCOUNT_MISSING", "Accounts Receivable account not found");

  // Unmatching keeps the payment; matching again links it instead of posting a second one.
  const existing = await findUnlinkedPayment(tx, {
    table: "invoice_payments", fk: "invoice_id", documentId: invoice.id, companyId: ctx.companyId, glAccountId: bank.glAccountId,
    amount: Math.abs(Number(txn.amount)), source: "payment", txnId: txn.id,
  });
  if (existing) {
    await assertPeriodNotLocked(ctx.companyId, txn.transactionDate);
    const relinked = await save(tx, ctx, txn.id, matchPatch(ctx.userId, { matchedInvoiceId: invoice.id, matchedJournalEntryId: existing }, input.confidence ?? null));
    return { transaction: relinked, journalEntryId: existing, receiptId: null, kind: "invoice" };
  }


  const balance = await getInvoiceBalance(ctx.companyId, invoice.id);
  if (balance.outstanding <= 0.005) {
    throw appError(409, "INVOICE_NOTHING_OUTSTANDING", `Invoice ${invoice.number} has nothing outstanding${balance.isFullyCredited ? " (fully credited)" : ""}; a bank line cannot be matched to it.`);
  }
  const bankAbs = Math.abs(Number(txn.amount));
  const payAmount = Math.min(balance.outstanding, bankAbs);
  // A bank line above what is owed would be cleared by a smaller payment and leave the difference unexplained. The one
  // accepted case: credit notes reduced what is owed after the customer paid the original amount (line = total - paid).
  if (bankAbs - payAmount > 0.005 && !(balance.credited > 0 && bankAbs <= balance.total - balance.paid + 0.005)) {
    throw appError(422, "MATCH_AMOUNT_MISMATCH", `The bank line is ${bankAbs.toFixed(2)} but invoice ${invoice.number} has ${balance.outstanding.toFixed(2)} outstanding.`);
  }
  const { date } = await resolveSettlementDate(ctx.companyId, { requested: input.paymentDate, fallback: txn.transactionDate });

  let result;
  try {
    result = await storage.recordInvoicePayment({
      invoiceId: invoice.id,
      companyId: ctx.companyId,
      amount: payAmount,
      date,
      method: "bank_reconciliation",
      reference: txn.reference,
      notes: `Reconciled from bank statement: ${txn.description}`.slice(0, 500),
      paymentAccountId: bank.glAccountId,
      paymentAccountCurrency: bank.currency,
      receivableAccountId: ar.id,
      createdBy: ctx.userId,
    });
  } catch (err: any) {
    if (err?.code === "INVOICE_NOTHING_OUTSTANDING") throw appError(409, err.code, err.message);
    if (["CURRENCY_MISMATCH", "OVERPAYMENT", "INVOICE_TERMINAL", "PAYMENT_EXCEEDS_BALANCE"].includes(err?.code)) throw appError(422, err.code, err.message);
    throw err;
  }
  const saved = await save(tx, ctx, txn.id, matchPatch(ctx.userId, { matchedInvoiceId: invoice.id, matchedJournalEntryId: result.journalEntryId }, input.confidence ?? null));
  return { transaction: saved, journalEntryId: result.journalEntryId, receiptId: null, kind: "invoice" };
}

// ─── bill ──────────────────────────────────────────────────────────────────

async function matchBill(tx: Tx, ctx: PostCtx, txn: BankTransaction, bank: { glAccountId: string; currency: string }, input: MatchInput): Promise<MatchResult> {
  if (Number(txn.amount) >= 0) throw appError(422, "DIRECTION_MISMATCH", "Only money paid out can be matched to a bill.");
  const bill = rowsOf(
    await tx.execute(sql`SELECT id, currency, status FROM vendor_bills WHERE id = ${input.targetId} AND company_id = ${ctx.companyId}`)
  )[0];
  if (!bill) throw appError(404, "BILL_NOT_FOUND", "Bill not found");
  if ((bill.currency || "AED").toUpperCase() !== bank.currency) {
    throw appError(422, "CURRENCY_MISMATCH", `The bill is in ${bill.currency} but this bank account is in ${bank.currency}.`);
  }
  const { ymd } = await resolveSettlementDate(ctx.companyId, { requested: input.paymentDate, fallback: txn.transactionDate });
  const existing = await findUnlinkedPayment(tx, {
    table: "bill_payments", fk: "bill_id", documentId: bill.id, companyId: ctx.companyId, glAccountId: bank.glAccountId,
    amount: Math.abs(Number(txn.amount)), source: "bill_payment", txnId: txn.id,
  });
  if (existing) {
    const relinked = await save(tx, ctx, txn.id, matchPatch(ctx.userId, { matchedBillId: bill.id, matchedJournalEntryId: existing }, input.confidence ?? null));
    return { transaction: relinked, journalEntryId: existing, receiptId: null, kind: "bill" };
  }
  let paid;
  try {
    // The bank line's own transaction is the caller's: the payment, its journal and the match commit together.
    paid = await recordBillPayment({
      billId: bill.id,
      companyId: ctx.companyId,
      amount: Math.abs(Number(txn.amount)),
      paymentDate: ymd,
      paymentMethod: "bank_transfer",
      reference: txn.reference,
      notes: `Reconciled from bank statement: ${txn.description}`.slice(0, 500),
      paymentAccountId: bank.glAccountId,
      userId: ctx.userId,
      tx,
    });
  } catch (err: any) {
    if (err?.code === "PAYMENT_EXCEEDS_BALANCE") throw appError(422, err.code, err.message, err.details);
    throw err;
  }
  const saved = await save(tx, ctx, txn.id, matchPatch(ctx.userId, { matchedBillId: bill.id, matchedJournalEntryId: paid.journalEntryId }, input.confidence ?? null));
  return { transaction: saved, journalEntryId: paid.journalEntryId, receiptId: null, kind: "bill" };
}

// ─── link to something already posted ──────────────────────────────────────

async function matchExisting(tx: Tx, ctx: PostCtx, txn: BankTransaction, bank: { glAccountId: string }, input: MatchInput): Promise<MatchResult> {
  await assertPeriodNotLocked(ctx.companyId, txn.transactionDate);
  let entryId = input.targetId;
  let receiptId: string | null = null;
  if (input.kind === "receipt") {
    const receipt = rowsOf(
      await tx.execute(sql`SELECT id, posted, journal_entry_id FROM receipts WHERE id = ${input.targetId} AND company_id = ${ctx.companyId}`)
    )[0];
    if (!receipt) throw appError(404, "RECEIPT_NOT_FOUND", "Receipt not found");
    if (!receipt.posted || !receipt.journal_entry_id) {
      throw appError(422, "RECEIPT_NOT_POSTED", "Post the receipt to the ledger before matching it to a bank line.");
    }
    receiptId = receipt.id;
    entryId = receipt.journal_entry_id;
  }

  const entry = rowsOf(
    await tx.execute(sql`
      SELECT je.id, je.status, je.reversed_entry_id,
             COALESCE((SELECT SUM(jl.debit - jl.credit) FROM journal_lines jl WHERE jl.entry_id = je.id AND jl.account_id = ${bank.glAccountId}), 0)::float8 AS net,
             EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversed_entry_id = je.id AND rv.status = 'posted') AS reversed,
             EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.company_id = je.company_id AND bt.matched_journal_entry_id = je.id AND bt.id <> ${txn.id}
                       AND bt.bank_account_id = ${bank.glAccountId}) AS linked
        FROM journal_entries je WHERE je.id = ${entryId} AND je.company_id = ${ctx.companyId}`)
  )[0];
  if (!entry) throw appError(404, "JOURNAL_ENTRY_NOT_FOUND", "Journal entry not found");
  if (entry.status !== "posted" || entry.reversed || entry.reversed_entry_id) {
    throw appError(422, "JOURNAL_NOT_MATCHABLE", "Only a posted entry that has not been reversed can be matched.");
  }
  if (entry.linked) throw appError(409, "ALREADY_LINKED", "This entry is already matched to another bank line.");
  const net = Number(entry.net);
  if (Math.abs(net) < 0.005 || net > 0 !== Number(txn.amount) > 0) {
    throw appError(422, "MATCH_AMOUNT_MISMATCH", "The entry does not move this bank account in the same direction as the bank line.");
  }
  if (Math.abs(Math.abs(net) - Math.abs(Number(txn.amount))) > 0.01) {
    throw appError(422, "MATCH_AMOUNT_MISMATCH", `The entry moves ${Math.abs(net).toFixed(2)} on the bank account but the bank line is ${Math.abs(Number(txn.amount)).toFixed(2)}.`);
  }
  const saved = await save(
    tx,
    ctx,
    txn.id,
    matchPatch(ctx.userId, { matchedJournalEntryId: entryId, ...(receiptId ? { matchedReceiptId: receiptId } : {}) }, input.confidence ?? null)
  );
  return { transaction: saved, journalEntryId: entryId, receiptId, kind: input.kind };
}

// ─── one chosen account ────────────────────────────────────────────────────

async function matchAccount(tx: Tx, ctx: PostCtx, txn: BankTransaction, bank: { glAccountId: string; currency: string }, input: MatchInput): Promise<MatchResult> {
  const account = await resolveContraAccount(ctx.companyId, input.targetId, bank.glAccountId);
  const date = new Date(txn.transactionDate);
  const rate = await bankRate(ctx.companyId, bank.currency, date);
  const lines = buildBankEntryLines({
    amount: Number(txn.amount),
    bankGlAccountId: bank.glAccountId,
    contra: [{ accountId: account.id, amount: Math.abs(Number(txn.amount)), description: txn.description }],
    currency: bank.currency,
    rate,
    description: txn.description.slice(0, 200),
  });
  const entry = await storage.createJournalEntry(
    {
      companyId: ctx.companyId,
      entryNumber: "PENDING",
      date,
      memo: (input.memo || txn.description).slice(0, 500),
      status: "posted",
      source: BANK_ENTRY_SOURCE,
      sourceId: txn.id,
      createdBy: ctx.userId,
      postedBy: ctx.userId,
      postedAt: new Date(),
    } as any,
    lines as any,
    { tx }
  );
  const saved = await save(tx, ctx, txn.id, matchPatch(ctx.userId, { matchedJournalEntryId: entry.id }, input.confidence ?? null));
  return { transaction: saved, journalEntryId: entry.id, receiptId: null, kind: "account" };
}

// ─── entry point ───────────────────────────────────────────────────────────

/** Match or post one bank line. Everything for the line happens under its lock. */
export async function applyMatch(ctx: PostCtx, input: MatchInput): Promise<MatchResult> {
  try {
    return await applyMatchLocked(ctx, input);
  } catch (err) {
    throw periodLockedCode(err);
  }
}

async function applyMatchLocked(ctx: PostCtx, input: MatchInput): Promise<MatchResult> {
  return await withDocumentLock(input.transactionId, LOCK_NS.BANK_TRANSACTION, async (tx) => {
    const txn = await readTransaction(tx, ctx.companyId, input.transactionId);
    assertOpen(txn);
    const bank = await resolveBank(ctx.companyId, txn);
    switch (input.kind) {
      case "invoice":
        return await matchInvoice(tx, ctx, txn, bank, input);
      case "bill":
        return await matchBill(tx, ctx, txn, bank, input);
      case "journal":
      case "receipt":
        return await matchExisting(tx, ctx, txn, bank, input);
      case "account":
        return await matchAccount(tx, ctx, txn, bank, input);
      case "rule": {
        await assertPeriodNotLocked(ctx.companyId, txn.transactionDate);
        const done = await applyRuleInTx(tx, ctx, txn, bank, input.targetId);
        const [saved] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, txn.id));
        return { transaction: saved, journalEntryId: done.journalEntryId, receiptId: done.receiptId, kind: "rule" as const };
      }
    }
  });
}

// ─── unmatch ───────────────────────────────────────────────────────────────

export interface UnmatchResult {
  transaction: BankTransaction;
  reversedEntryId: string | null;
}

/**
 * Undo a match. An entry the bank line posted itself (create entry, rule) is reversed on its original date and the
 * rule's VAT receipt is deleted; a payment or a linked entry stays in the ledger and can be linked again.
 */
export async function unmatchTransaction(ctx: PostCtx, transactionId: string): Promise<UnmatchResult> {
  try {
    return await unmatchLocked(ctx, transactionId);
  } catch (err) {
    throw periodLockedCode(err);
  }
}

async function unmatchLocked(ctx: PostCtx, transactionId: string): Promise<UnmatchResult> {
  return await withDocumentLock(transactionId, LOCK_NS.BANK_TRANSACTION, async (tx) => {
    const txn = await readTransaction(tx, ctx.companyId, transactionId);
    assertNotFrozen(txn);
    await assertPeriodNotLocked(ctx.companyId, txn.transactionDate);

    let reversedEntryId: string | null = null;
    if (txn.matchedJournalEntryId) {
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.id, txn.matchedJournalEntryId), eq(journalEntries.companyId, ctx.companyId)));
      const ownsEntry = !!entry && (entry.source === BANK_ENTRY_SOURCE || entry.source === RULE_SOURCE) && entry.sourceId === txn.id;
      if (entry && ownsEntry) {
        // the other side of a transfer links the same entry: reversing it would leave that line pointing at nothing
        const elsewhere = rowsOf(
          await tx.execute(sql`SELECT 1 FROM bank_transactions WHERE company_id = ${ctx.companyId} AND matched_journal_entry_id = ${entry.id} AND id <> ${txn.id} LIMIT 1`)
        );
        if (elsewhere.length > 0) {
          throw appError(409, "ENTRY_LINKED_ELSEWHERE", "Another bank line is matched to this entry (the other side of a transfer). Unmatch that line first.");
        }
        const already = rowsOf(
          await tx.execute(sql`SELECT 1 FROM journal_entries WHERE reversed_entry_id = ${entry.id} AND status = 'posted' LIMIT 1`)
        );
        if (already.length === 0) {
          const original = await tx.select().from(journalLines).where(eq(journalLines.entryId, entry.id));
          const reversal = await storage.createJournalEntry(
            {
              companyId: ctx.companyId,
              entryNumber: "PENDING",
              date: entry.date,
              memo: `Unmatched bank line - reversal of ${entry.entryNumber}`.slice(0, 500),
              status: "posted",
              source: "reversal",
              sourceId: entry.id,
              reversedEntryId: entry.id,
              reversalReason: "Bank line unmatched",
              createdBy: ctx.userId,
              postedBy: ctx.userId,
              postedAt: new Date(),
            } as any,
            reverseLines(
              original.map((l: any) => ({
                accountId: l.accountId,
                debit: l.debit,
                credit: l.credit,
                description: l.description,
                foreignCurrency: l.foreignCurrency,
                foreignDebit: l.foreignDebit,
                foreignCredit: l.foreignCredit,
                exchangeRate: l.exchangeRate,
              })),
              "Unmatched"
            ) as any,
            { tx }
          );
          reversedEntryId = reversal.id;
        }
        // the VAT receipt a rule created goes with its entry, or box 9 would keep claiming the input VAT
        await tx.execute(sql`DELETE FROM receipts WHERE bank_transaction_id = ${txn.id} AND company_id = ${ctx.companyId}`);
      }
    }

    const [saved] = await tx
      .update(bankTransactions)
      .set({ ...clearedPatch })
      .where(and(eq(bankTransactions.id, txn.id), eq(bankTransactions.companyId, ctx.companyId)))
      .returning();
    return { transaction: saved, reversedEntryId };
  });
}

export { ymdOf };
