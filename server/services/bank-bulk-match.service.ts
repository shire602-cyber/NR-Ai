// Bulk accept of reconciliation suggestions. All or nothing for the part that can be checked in advance:
//
//   phase 1  validate every item, with the amounts of items that share an invoice or bill added up against what is
//            still open on it; any failure -> 422 BULK_MATCH_INVALID listing every error, nothing posted
//   phase 2  apply each item under its own bank-line lock; a race that appears only now stops the run with
//            409 BULK_MATCH_PARTIAL and the ids already applied (each of those is complete)
//
// One bulk run per company at a time (runExclusive), so two parallel bulk-matches cannot both pass phase 1 against
// the same open balance.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { bankTransactions, type BankTransaction } from "../../shared/schema";
import { AppError } from "../errors";
import { storage } from "../storage";
import { getInvoiceBalance } from "./invoice-outstanding.db";
import { runExclusive } from "./document-queue";
import { assertPeriodNotLocked } from "./period-lock.service";
import { resolveSettlementDate } from "./payment-date-guard.service";
import { loadOpenBills } from "./bank-matching.service";
import { applyMatch, type MatchInput, type MatchKind, type MatchResult } from "./bank-posting.service";
import { isDocumentOnlyAccount, periodLockedCode, type PostCtx } from "./bank-posting-common";
import { pool } from "../db";

export const MAX_BULK_ITEMS = 200;

export interface BulkItem {
  transactionId: string;
  kind: MatchKind;
  targetId: string;
  /** kind "invoices": one bank receipt settling these invoices, in order (the last may be partial). */
  targetIds?: string[];
  paymentDate?: string | null;
}

export interface BulkError {
  index: number;
  transactionId: string;
  code: string;
  message: string;
}

export interface BulkResultRow {
  index: number;
  transactionId: string;
  kind: MatchKind;
  targetId: string;
  journalEntryId: string | null;
  receiptId: string | null;
}

export interface BulkOutcome {
  applied: number;
  results: BulkResultRow[];
  dryRun: boolean;
}

const asBulkError = (index: number, item: BulkItem, rawErr: unknown): BulkError => {
  const err = periodLockedCode(rawErr);
  if (err instanceof AppError) return { index, transactionId: item.transactionId, code: err.code, message: err.message };
  return { index, transactionId: item.transactionId, code: "INTERNAL_ERROR", message: (err as Error)?.message ?? "Unexpected error" };
};

async function validateBatch(ctx: PostCtx, items: BulkItem[]): Promise<BulkError[]> {
  const errors: BulkError[] = [];
  const fail = (i: number, code: string, message: string) => errors.push({ index: i, transactionId: items[i].transactionId, code, message });

  const ids = Array.from(new Set(items.map((i) => i.transactionId)));
  const rows = await db
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.companyId, ctx.companyId), inArray(bankTransactions.id, ids)));
  const txns = new Map<string, BankTransaction>(rows.map((r: BankTransaction) => [r.id, r]));

  const seenTxn = new Set<string>();
  const targetUse = new Map<string, number>();
  const multiInvoiceUse = new Map<string, number>();
  const invoiceDemand = new Map<string, { total: number; indexes: number[] }>();
  const billDemand = new Map<string, { total: number; indexes: number[] }>();

  items.forEach((item, i) => {
    if (seenTxn.has(item.transactionId)) fail(i, "DUPLICATE_TRANSACTION", "A bank line appears twice in the batch.");
    seenTxn.add(item.transactionId);
    const txn = txns.get(item.transactionId);
    if (!txn) return fail(i, "BANK_TXN_NOT_FOUND", "Bank transaction not found");
    if (txn.reconciliationId) return fail(i, "BANK_TXN_IN_COMPLETED_RECONCILIATION", "This bank line belongs to a completed reconciliation.");
    if (txn.matchStatus === "matched" || txn.isReconciled) return fail(i, "ALREADY_RECONCILED", "This bank line is already reconciled.");
    if (!txn.bankAccountId) return fail(i, "BANK_GL_NOT_LINKED", "This bank account is not linked to a ledger account.");
    const inflow = Number(txn.amount) > 0;
    if (item.kind === "invoice" && !inflow) return fail(i, "DIRECTION_MISMATCH", "Only money received can be matched to an invoice.");
    if (item.kind === "bill" && inflow) return fail(i, "DIRECTION_MISMATCH", "Only money paid out can be matched to a bill.");
    if (item.kind === "invoices") {
      if (!inflow) return fail(i, "DIRECTION_MISMATCH", "Only money received can be matched to invoices.");
      for (const invoiceId of item.targetIds?.length ? item.targetIds : [item.targetId]) {
        multiInvoiceUse.set(invoiceId, (multiInvoiceUse.get(invoiceId) ?? 0) + 1);
        if (multiInvoiceUse.get(invoiceId)! > 1 || invoiceDemand.has(invoiceId)) fail(i, "TARGET_USED_TWICE", "An invoice is used for two bank lines.");
      }
    } else if (item.kind === "invoice") {
      if (multiInvoiceUse.has(item.targetId)) fail(i, "TARGET_USED_TWICE", "An invoice is used for two bank lines.");
      const d = invoiceDemand.get(item.targetId) ?? { total: 0, indexes: [] };
      d.total += Math.abs(Number(txn.amount));
      d.indexes.push(i);
      invoiceDemand.set(item.targetId, d);
    } else if (item.kind === "bill") {
      const d = billDemand.get(item.targetId) ?? { total: 0, indexes: [] };
      d.total += Math.abs(Number(txn.amount));
      d.indexes.push(i);
      billDemand.set(item.targetId, d);
    } else if (item.kind === "journal" || item.kind === "receipt") {
      const key = `${item.kind}:${item.targetId}`;
      targetUse.set(key, (targetUse.get(key) ?? 0) + 1);
      if ((targetUse.get(key) ?? 0) > 1) fail(i, "TARGET_USED_TWICE", "The same entry or receipt is used for two bank lines.");
    }
  });

  // dates: the settlement date must be valid and its period open
  for (let i = 0; i < items.length; i++) {
    const txn = txns.get(items[i].transactionId);
    if (!txn || errors.some((e) => e.index === i)) continue;
    try {
      if (items[i].kind === "invoice" || items[i].kind === "bill") {
        await resolveSettlementDate(ctx.companyId, { requested: items[i].paymentDate, fallback: txn.transactionDate });
      } else {
        await assertPeriodNotLocked(ctx.companyId, txn.transactionDate);
      }
    } catch (err) {
      errors.push(asBulkError(i, items[i], err));
    }
  }

  for (const [invoiceId, demand] of invoiceDemand) {
    const invoice = await storage.getInvoice(invoiceId, ctx.companyId);
    if (!invoice) {
      demand.indexes.forEach((i) => fail(i, "INVOICE_NOT_FOUND", "Invoice not found"));
      continue;
    }
    const balance = await getInvoiceBalance(ctx.companyId, invoiceId);
    if (balance.outstanding <= 0.005) demand.indexes.forEach((i) => fail(i, "INVOICE_NOTHING_OUTSTANDING", `Invoice ${invoice.number} has nothing outstanding.`));
    else if (demand.total > balance.outstanding + 0.005) {
      demand.indexes.forEach((i) =>
        fail(i, "PAYMENT_EXCEEDS_BALANCE", `The batch applies ${demand.total.toFixed(2)} to invoice ${invoice.number}, which has ${balance.outstanding.toFixed(2)} outstanding.`)
      );
    }
  }

  if (billDemand.size) {
    const open = new Map((await loadOpenBills(ctx.companyId)).map((b) => [b.id, b]));
    const exists = await pool.query(`SELECT id FROM vendor_bills WHERE company_id = $1 AND id = ANY($2::uuid[])`, [ctx.companyId, Array.from(billDemand.keys())]);
    const known = new Set(exists.rows.map((r: any) => r.id));
    for (const [billId, demand] of billDemand) {
      const bill = open.get(billId);
      if (!known.has(billId)) demand.indexes.forEach((i) => fail(i, "BILL_NOT_FOUND", "Bill not found"));
      else if (!bill) demand.indexes.forEach((i) => fail(i, "BILL_NOT_PAYABLE", "The bill is not approved or has nothing outstanding."));
      else if (demand.total > bill.open + 0.005) {
        demand.indexes.forEach((i) =>
          fail(i, "PAYMENT_EXCEEDS_BALANCE", `The batch pays ${demand.total.toFixed(2)} on bill ${bill.number ?? ""}, which has ${bill.open.toFixed(2)} outstanding.`)
        );
      }
    }
  }

  // account targets: valid posting accounts
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind !== "account" || errors.some((e) => e.index === i)) continue;
    const account = await storage.getAccount(items[i].targetId, ctx.companyId);
    if (!account || account.isActive === false || account.isArchived === true) fail(i, "ACCOUNT_INVALID", "The account must be an active account of this company.");
    else if (isDocumentOnlyAccount(account)) fail(i, "ACCOUNT_REQUIRES_DOCUMENT", `Account ${account.code} is moved by documents, not by a bank line.`);
  }

  return errors.sort((a, b) => a.index - b.index);
}

export async function bulkMatch(ctx: PostCtx, items: BulkItem[], opts: { dryRun?: boolean } = {}): Promise<BulkOutcome> {
  if (items.length === 0 || items.length > MAX_BULK_ITEMS) {
    throw new AppError({ message: `A bulk match takes 1 to ${MAX_BULK_ITEMS} items.`, statusCode: 400, code: "VALIDATION_ERROR" });
  }
  return await runExclusive(`bank-bulk:${ctx.companyId}`, async () => {
    const errors = await validateBatch(ctx, items);
    if (errors.length > 0) {
      throw new AppError({ message: `${errors.length} item(s) cannot be applied; nothing was posted.`, statusCode: 422, code: "BULK_MATCH_INVALID", details: { errors } });
    }
    const results: BulkResultRow[] = [];
    if (opts.dryRun) {
      items.forEach((it, index) => results.push({ index, transactionId: it.transactionId, kind: it.kind, targetId: it.targetId, journalEntryId: null, receiptId: null }));
      return { applied: 0, results, dryRun: true };
    }
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      try {
        const input: MatchInput = {
          transactionId: item.transactionId,
          kind: item.kind,
          targetId: item.targetId,
          paymentDate: item.paymentDate ?? null,
          ...(item.kind === "invoices" ? { allocations: (item.targetIds?.length ? item.targetIds : [item.targetId]).map((invoiceId) => ({ invoiceId })) } : {}),
        };
        const done: MatchResult = await applyMatch(ctx, input);
        results.push({ index, transactionId: item.transactionId, kind: item.kind, targetId: item.targetId, journalEntryId: done.journalEntryId, receiptId: done.receiptId });
      } catch (err) {
        throw new AppError({
          message: `Applied ${results.length} of ${items.length}; item ${index + 1} failed.`,
          statusCode: 409,
          code: "BULK_MATCH_PARTIAL",
          details: { applied: results.map((r) => r.transactionId), results, failed: asBulkError(index, item, err) },
        });
      }
    }
    return { applied: results.length, results, dryRun: false };
  });
}
