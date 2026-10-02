// Matches that touch more than one document or account, all inside the caller's bank-line lock:
//
//   allocations  one bank receipt settling several invoices (in order, an optional partial on the last), and an
//                overpayment kept as customer credit (2050) only when the caller says so
//   split        one bank line posted across several accounts (a loan instalment: principal and interest)
//   transfer     the two bank lines of one own-account transfer, in two bank accounts and possibly two currencies, posted
//                as ONE journal with the exchange difference on 5140 / 4090
//
// Each posting goes through the same services as a single match (recordInvoicePayment, createJournalEntry({ tx })).

import { sql } from "drizzle-orm";
import type { BankTransaction } from "../../shared/schema";
import { ACCOUNT_CODES } from "../constants";
import { storage } from "../storage";
import { getInvoiceBalance } from "./invoice-outstanding.db";
import { resolveSettlementDate } from "./payment-date-guard.service";
import { assertPeriodNotLocked } from "./period-lock.service";
import { buildBankEntryLines, type EntryLine } from "./bank-entry-lines";
import { allocateByPercent } from "./bank-rule-split";
import {
  appError,
  assertOpen,
  bankRate,
  findUnlinkedPaymentDetail,
  matchPatch,
  readTransaction,
  resolveBank,
  resolveContraAccount,
  save,
  type BankContext,
  type PostCtx,
  type Tx,
} from "./bank-posting-common";

export const BANK_ENTRY_SOURCE = "bank_reconciliation";
const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface MultiResult {
  transaction: BankTransaction;
  journalEntryId: string | null;
  entryIds: string[];
}

/** First entry on the bank line; the rest in bank_transaction_entries. */
async function linkEntries(tx: Tx, ctx: PostCtx, txnId: string, entryIds: string[]): Promise<void> {
  for (const id of entryIds.slice(1)) {
    await tx.execute(sql`
      INSERT INTO bank_transaction_entries (company_id, bank_transaction_id, journal_entry_id)
      VALUES (${ctx.companyId}, ${txnId}, ${id}) ON CONFLICT DO NOTHING`);
  }
}

// ─── one receipt, several invoices ─────────────────────────────────────────

export interface AllocationSpec {
  allocations: Array<{ invoiceId: string; amount?: number }>;
  /** What to do with money left after every listed invoice is paid in full. */
  keepAsCredit?: boolean;
  paymentDate?: string | null;
  confidence?: number | null;
}

export async function allocateInvoicesInTx(tx: Tx, ctx: PostCtx, txn: BankTransaction, bank: BankContext, spec: AllocationSpec): Promise<MultiResult> {
  if (Number(txn.amount) <= 0) throw appError(422, "DIRECTION_MISMATCH", "Only money received can be matched to invoices.");
  if (!spec.allocations.length) throw appError(400, "VALIDATION_ERROR", "List at least one invoice.");
  const ids = spec.allocations.map((a) => a.invoiceId);
  if (new Set(ids).size !== ids.length) throw appError(422, "ALLOCATION_INVALID", "An invoice appears twice in the allocation.");

  const accounts = await storage.getAccountsByCompanyId(ctx.companyId);
  const ar = accounts.find((a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
  if (!ar) throw appError(500, "AR_ACCOUNT_MISSING", "Accounts Receivable account not found");
  const { date } = await resolveSettlementDate(ctx.companyId, { requested: spec.paymentDate, fallback: txn.transactionDate });

  // 1. plan and validate everything before anything is posted
  let remaining = Math.abs(Number(txn.amount));
  const plan: Array<{ invoice: NonNullable<Awaited<ReturnType<typeof storage.getInvoice>>>; amount: number; outstanding: number; allowCredit: boolean; relinkEntry?: string }> = [];
  for (const a of spec.allocations) {
    const invoice = await storage.getInvoice(a.invoiceId, ctx.companyId);
    if (!invoice) throw appError(404, "INVOICE_NOT_FOUND", "Invoice not found");
    if ((invoice.currency || "AED").toUpperCase() !== bank.currency) {
      throw appError(422, "CURRENCY_MISMATCH", `Invoice ${invoice.number} is in ${invoice.currency} but this bank account is in ${bank.currency}.`);
    }
    // a payment an earlier unmatch (or a manual payment) left in the ledger is linked, not posted again
    const relink = await findUnlinkedPaymentDetail(tx, { table: "invoice_payments", fk: "invoice_id", documentId: invoice.id, companyId: ctx.companyId, glAccountId: bank.glAccountId, amount: a.amount ?? null, maxAmount: remaining, source: "payment", txnId: txn.id });
    if (relink) {
      plan.push({ invoice, amount: r2(relink.amount), outstanding: r2(relink.amount), allowCredit: false, relinkEntry: relink.id });
      remaining = r2(remaining - relink.amount);
      continue;
    }
    const balance = await getInvoiceBalance(ctx.companyId, invoice.id);
    if (balance.outstanding <= 0.005) throw appError(409, "INVOICE_NOTHING_OUTSTANDING", `Invoice ${invoice.number} has nothing outstanding.`);
    const want = r2(a.amount ?? Math.min(balance.outstanding, remaining));
    if (!(want > 0)) throw appError(422, "ALLOCATION_INVALID", `Nothing is left of the bank line for invoice ${invoice.number}.`);
    if (want > balance.outstanding + 0.005) {
      throw appError(422, "PAYMENT_EXCEEDS_BALANCE", `${want.toFixed(2)} is more than the ${balance.outstanding.toFixed(2)} outstanding on invoice ${invoice.number}.`);
    }
    if (want > remaining + 0.005) throw appError(422, "ALLOCATION_EXCEEDS_BANK_LINE", "The allocations add up to more than the bank line.");
    plan.push({ invoice, amount: want, outstanding: balance.outstanding, allowCredit: false });
    remaining = r2(remaining - want);
  }
  if (remaining > 0.005) {
    const last = plan[plan.length - 1];
    if (!spec.keepAsCredit) {
      throw appError(422, "OVERPAYMENT_CHOICE_REQUIRED", `${remaining.toFixed(2)} is left after the listed invoices. Keep it as customer credit (2050) or allocate it to another invoice.`, { excess: remaining });
    }
    if (last.amount < last.outstanding - 0.005) {
      throw appError(422, "ALLOCATION_INVALID", "The last invoice is only partly paid, so the rest of the bank line cannot be kept as customer credit.");
    }
    last.amount = r2(last.amount + remaining);
    last.allowCredit = true;
    remaining = 0;
  }

  // 2. post (or re-link a payment an earlier unmatch left in the ledger)
  const entryIds: string[] = [];
  for (const p of plan) {
    if (p.relinkEntry) {
      entryIds.push(p.relinkEntry);
      continue;
    }
    try {
      const paid = await storage.recordInvoicePayment({
        invoiceId: p.invoice.id,
        companyId: ctx.companyId,
        amount: p.amount,
        date,
        method: "bank_reconciliation",
        reference: txn.reference,
        notes: `Reconciled from bank statement: ${txn.description}`.slice(0, 500),
        paymentAccountId: bank.glAccountId,
        paymentAccountCurrency: bank.currency,
        receivableAccountId: ar.id,
        createdBy: ctx.userId,
        allowCredit: p.allowCredit,
      });
      entryIds.push(paid.journalEntryId);
    } catch (err: any) {
      if (err?.code === "INVOICE_NOTHING_OUTSTANDING") throw appError(409, err.code, err.message);
      if (["CURRENCY_MISMATCH", "OVERPAYMENT", "INVOICE_TERMINAL", "PAYMENT_EXCEEDS_BALANCE"].includes(err?.code)) throw appError(422, err.code, err.message);
      throw err;
    }
  }
  await linkEntries(tx, ctx, txn.id, entryIds);
  const saved = await save(tx, ctx, txn.id, matchPatch(ctx.userId, { matchedInvoiceId: plan[0].invoice.id, matchedJournalEntryId: entryIds[0] }, spec.confidence ?? null));
  return { transaction: saved, journalEntryId: entryIds[0], entryIds };
}

// ─── one bank line, several accounts ───────────────────────────────────────

export interface SplitSpec {
  lines: Array<{ accountId: string; amount?: number; percent?: number; description?: string | null }>;
  memo?: string | null;
  confidence?: number | null;
}

export async function splitEntryInTx(tx: Tx, ctx: PostCtx, txn: BankTransaction, bank: BankContext, spec: SplitSpec): Promise<MultiResult> {
  if (spec.lines.length < 1 || spec.lines.length > 10) throw appError(422, "SPLIT_INVALID", "A split needs 1 to 10 lines.");
  const gross = Math.abs(Number(txn.amount));
  const byAmount = spec.lines.every((l) => l.amount !== undefined);
  const byPercent = spec.lines.every((l) => l.percent !== undefined);
  if (!byAmount && !byPercent) throw appError(422, "SPLIT_INVALID", "Give every line an amount, or every line a percent.");
  let amounts: number[];
  if (byAmount) {
    amounts = spec.lines.map((l) => r2(l.amount as number));
    if (amounts.some((a) => !(a > 0))) throw appError(422, "SPLIT_INVALID", "Every split amount must be above 0.");
    const total = r2(amounts.reduce((a, b) => a + b, 0));
    if (Math.abs(total - gross) > 0.005) throw appError(422, "SPLIT_INVALID", `The lines add up to ${total.toFixed(2)} but the bank line is ${gross.toFixed(2)}.`);
  } else {
    const pct = spec.lines.map((l) => Number(l.percent));
    if (pct.some((p) => !(p > 0)) || Math.abs(pct.reduce((a, b) => a + b, 0) - 100) > 0.001) throw appError(422, "SPLIT_INVALID", "The percents must be above 0 and add up to 100.");
    amounts = allocateByPercent(Math.round(gross * 100), pct).map((c) => c / 100);
  }
  const contra = [];
  for (let i = 0; i < spec.lines.length; i++) {
    const account = await resolveContraAccount(ctx.companyId, spec.lines[i].accountId, bank.glAccountId);
    contra.push({ accountId: account.id, amount: amounts[i], description: spec.lines[i].description ?? txn.description });
  }
  const date = new Date(txn.transactionDate);
  const rate = await bankRate(ctx.companyId, bank.currency, date);
  const lines = buildBankEntryLines({ amount: Number(txn.amount), bankGlAccountId: bank.glAccountId, contra, currency: bank.currency, rate, description: txn.description.slice(0, 200) });
  const entry = await storage.createJournalEntry(
    {
      companyId: ctx.companyId,
      entryNumber: "PENDING",
      date,
      memo: (spec.memo || txn.description).slice(0, 500),
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
  const saved = await save(tx, ctx, txn.id, matchPatch(ctx.userId, { matchedJournalEntryId: entry.id }, spec.confidence ?? null));
  return { transaction: saved, journalEntryId: entry.id, entryIds: [entry.id] };
}

// ─── own-account transfer: two bank lines, one journal ─────────────────────

/**
 * `txn` is the line the request names, `otherId` the other bank line of the transfer. The outflow leg owns the journal
 * (source bank_reconciliation, sourceId = that line), so unmatching it reverses the journal and unmatching the inflow
 * leg only releases that line. The journal is in AED: each leg at the company rate of its day, the difference to
 * 5140 (loss) or 4090 (gain), foreign amounts kept on the foreign bank lines.
 */
export async function transferInTx(tx: Tx, ctx: PostCtx, txn: BankTransaction, bank: BankContext, otherId: string, memo?: string | null): Promise<MultiResult> {
  if (otherId === txn.id) throw appError(422, "TRANSFER_INVALID", "A transfer needs two different bank lines.");
  const other = await readTransaction(tx, ctx.companyId, otherId);
  assertOpen(other);
  const otherBank = await resolveBank(ctx.companyId, other);
  if (Number(txn.amount) > 0 === Number(other.amount) > 0) throw appError(422, "TRANSFER_INVALID", "One line must be money out and the other money in.");
  if (txn.bankStatementAccountId === other.bankStatementAccountId || bank.glAccountId === otherBank.glAccountId) {
    throw appError(422, "TRANSFER_INVALID", "The two lines must be in two different bank accounts.");
  }
  const outTxn = Number(txn.amount) < 0 ? txn : other;
  const inTxn = outTxn === txn ? other : txn;
  const outBank = outTxn === txn ? bank : otherBank;
  const inBank = outTxn === txn ? otherBank : bank;

  const date = new Date(outTxn.transactionDate);
  await assertPeriodNotLocked(ctx.companyId, outTxn.transactionDate);
  await assertPeriodNotLocked(ctx.companyId, inTxn.transactionDate);
  const outAbs = Math.abs(Number(outTxn.amount));
  const inAbs = Math.abs(Number(inTxn.amount));
  const outRate = await bankRate(ctx.companyId, outBank.currency, new Date(outTxn.transactionDate));
  const inRate = await bankRate(ctx.companyId, inBank.currency, new Date(inTxn.transactionDate));
  const outAed = r2(outAbs * outRate);
  const inAed = r2(inAbs * inRate);
  if (outBank.currency === inBank.currency && Math.abs(outAbs - inAbs) > 0.005) {
    throw appError(422, "TRANSFER_INVALID", `The two lines are ${outAbs.toFixed(2)} and ${inAbs.toFixed(2)}: a same-currency transfer must match (post a bank charge separately).`);
  }

  const foreignFields = (cur: string, amt: number, rate: number, side: "debit" | "credit"): Partial<EntryLine> =>
    cur === "AED" ? {} : { foreignCurrency: cur, foreignDebit: side === "debit" ? amt : 0, foreignCredit: side === "credit" ? amt : 0, exchangeRate: rate };
  const accounts = await storage.getAccountsByCompanyId(ctx.companyId);
  const label = (memo || `Transfer ${outTxn.description}`).slice(0, 200);
  const lines: EntryLine[] = [
    { accountId: inBank.glAccountId, debit: inAed, credit: 0, description: label, ...foreignFields(inBank.currency, inAbs, inRate, "debit") },
    { accountId: outBank.glAccountId, debit: 0, credit: outAed, description: label, ...foreignFields(outBank.currency, outAbs, outRate, "credit") },
  ];
  const diff = r2(outAed - inAed); // paid more AED than arrived: a loss
  if (Math.abs(diff) > 0.005) {
    const fx = accounts.find((a) => a.code === (diff > 0 ? ACCOUNT_CODES.FX_LOSS : ACCOUNT_CODES.FX_GAIN));
    if (!fx) throw appError(422, "FX_ACCOUNT_MISSING", `The exchange ${diff > 0 ? "loss" : "gain"} account (${diff > 0 ? ACCOUNT_CODES.FX_LOSS : ACCOUNT_CODES.FX_GAIN}) is missing.`);
    lines.push({ accountId: fx.id, debit: diff > 0 ? diff : 0, credit: diff < 0 ? -diff : 0, description: "Exchange difference on transfer" });
  }
  const entry = await storage.createJournalEntry(
    {
      companyId: ctx.companyId,
      entryNumber: "PENDING",
      date,
      memo: label,
      status: "posted",
      source: BANK_ENTRY_SOURCE,
      sourceId: outTxn.id,
      createdBy: ctx.userId,
      postedBy: ctx.userId,
      postedAt: new Date(),
    } as any,
    lines as any,
    { tx }
  );
  const savedOut = await save(tx, ctx, outTxn.id, matchPatch(ctx.userId, { matchedJournalEntryId: entry.id }));
  const savedIn = await save(tx, ctx, inTxn.id, matchPatch(ctx.userId, { matchedJournalEntryId: entry.id }));
  return { transaction: savedOut.id === txn.id ? savedOut : savedIn, journalEntryId: entry.id, entryIds: [entry.id] };
}
