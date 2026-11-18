// Invoice payments and customer credits (W3-A: R03-05, R03-08, R03-13, R03-21).
//
// * recordInvoicePayment — the ONE way to settle an invoice with cash. The
//   payment account must be a cash or bank account (sub_type cash | bank,
//   else 422); the payment date is the journal date; posting goes through the
//   ledger kernel inside storage.recordInvoicePayment's row-locked transaction.
//   Registered as the "invoices.recordPayment" service so other modules (bank
//   matching, online payments) settle through it without importing routes.
// * Customer credits — money owed TO a customer (a credit note on a paid
//   invoice, or an overpayment). A credit is either applied to another open
//   invoice of the same currency or refunded through a cash/bank account.
//   Both post through the kernel; a rate difference is realised FX.
//
// A-B1 (kept): the old Stripe helpers marked invoices paid with a plain column
// write and no journal. Online payment, when built, must call this service.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  accounts,
  customerCreditAllocations,
  customerCredits,
  invoicePayments,
  invoices,
  journalEntries,
  type CustomerCredit,
  type Invoice,
} from "../../shared/schema";
import { storage } from "../storage";
import { DomainError } from "../errors";
import {
  documentCurrency,
  isForeignCurrency,
  loadBaseCurrency,
  postJournal,
  reverseEntry,
  withLedgerTx,
  type LedgerTx,
  type PostJournalLineInput,
} from "../ledger";
import { fromFils, toFils } from "../../shared/money";
import { emitDomainEvent } from "../platform/domain-events";
import { has, provide, resolve } from "../platform/service-registry";
import { createLogger } from "../config/logger";
import {
  getArAccount,
  getFxAccounts,
  invoiceOpenFils,
  invoiceRate,
  lockInvoice,
  refreshSettlementStatus,
  toBase,
} from "./invoice-posting.service";
import { isTerminal } from "./invoice-state-machine";
import {
  CUSTOMER_DEPOSIT_SOURCE,
  depositConsumptionLines,
  syncDepositStatus,
} from "./customer-deposits.service";
import { getRate } from "./fx/rates";
import {
  ALLOWANCE_FOR_DOUBTFUL_DEBTS_CODE,
  allowanceForDoubtfulDebtsFils,
} from "../reporting/ifrs-adjustments";
import { bankCurrencyOf, bankRateOn, cashLegFor } from "./fx/bank-currency";

const log = createLogger("invoice-payment");

export const PAYMENT_ACCOUNT_SUB_TYPES = ["cash", "bank"] as const;

/** 422 unless the account is an active cash/bank account of the company. */
export async function assertCashOrBankAccount(
  companyId: string,
  accountId: string,
  executor: LedgerTx = db
): Promise<typeof accounts.$inferSelect> {
  const [acct] = await executor
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)));
  if (!acct) {
    throw new DomainError(
      "PAYMENT_ACCOUNT_NOT_FOUND",
      422,
      { accountId },
      "Invalid payment account"
    );
  }
  if (
    acct.type !== "asset" ||
    !(PAYMENT_ACCOUNT_SUB_TYPES as readonly string[]).includes(String(acct.subType)) ||
    !acct.isActive ||
    acct.isArchived
  ) {
    throw new DomainError(
      "PAYMENT_ACCOUNT_NOT_CASH_OR_BANK",
      422,
      { accountId, code: acct.code, subType: acct.subType },
      "Payment account must be an active cash or bank account (sub-type cash or bank)."
    );
  }
  return acct;
}

export interface RecordPaymentInput {
  invoiceId: string;
  companyId: string;
  amount: number;
  date: Date;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  paymentAccountId: string;
  /** AED per unit of the invoice currency on the payment date (realised FX). */
  paymentExchangeRate?: number | null;
  createdBy: string;
  allowCredit?: boolean;
  /**
   * WQ1: run inside the caller's ledger transaction (one receipt over several invoices, a cash
   * sale). Reads see the caller's uncommitted rows; events fire after the caller commits.
   */
  tx?: LedgerTx;
}

/**
 * Settle an invoice (backward compatible with storage.recordInvoicePayment's
 * result). Emits payment.received and, when fully settled, invoice.paid after
 * the commit.
 */
export async function recordInvoicePayment(input: RecordPaymentInput) {
  const exec: LedgerTx = input.tx ?? db;
  const loadInvoice = async (): Promise<Invoice | undefined> => {
    if (!input.tx) return storage.getInvoice(input.invoiceId, input.companyId);
    const [row] = await exec
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.companyId, input.companyId)));
    return row as Invoice | undefined;
  };
  let invoice = await loadInvoice();
  if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
  if ((input.method ?? "").toLowerCase() === WRITE_OFF_METHOD) {
    throw new DomainError(
      "PAYMENT_METHOD_RESERVED",
      422,
      { method: input.method },
      "Use the write-off action to write off a receivable."
    );
  }
  // A3 (H1): a receipt on a written-off invoice first reinstates the write-off (bad debt
  // recovered: Dr A/R / Cr bad-debt expense), then settles as an ordinary payment.
  if (
    !input.tx &&
    invoice.invoiceType !== "credit_note" &&
    ["paid", "partial"].includes(invoice.status)
  ) {
    const target = invoice;
    const { written, open } = await withLedgerTx(async (tx) => ({
      written: await invoiceWrittenOffFils(tx, target.id),
      open: await invoiceOpenFils(tx, target),
    }));
    const wanted = toFils(input.amount, { rounding: "halfUp" });
    if (written > 0 && wanted > open) {
      await reinstateWriteOffs({
        companyId: input.companyId,
        invoiceId: target.id,
        date: input.date.toISOString().slice(0, 10),
        reason: "Bad debt recovered: payment received",
        userId: input.createdBy,
        neededFils: wanted,
      });
      invoice = (await storage.getInvoice(input.invoiceId, input.companyId)) ?? target;
    }
  }
  if (invoice.invoiceType === "credit_note") {
    throw new DomainError(
      "CANNOT_PAY_CREDIT_NOTE",
      422,
      undefined,
      "A credit note cannot be paid; refund its customer credit instead."
    );
  }
  if (invoice.status === "draft") {
    throw new DomainError(
      "INVOICE_NOT_ISSUED",
      422,
      undefined,
      "Issue the invoice before recording a payment."
    );
  }
  if (isTerminal(invoice.status)) {
    throw new DomainError(
      "INVOICE_TERMINAL",
      422,
      undefined,
      `Cannot record payment on ${invoice.status} invoice`
    );
  }
  const acct = await assertCashOrBankAccount(input.companyId, input.paymentAccountId, exec);
  // R03-22: a foreign invoice settles at the payment-date rate (company rate,
  // then system rate via fx.getRate) so realised FX is booked; with no rate on
  // file it settles at the invoice rate (no FX), as before.
  let paymentExchangeRate = input.paymentExchangeRate ?? null;
  const baseCurrency = await loadBaseCurrency(input.companyId);
  const currency = documentCurrency(invoice.currency, baseCurrency);
  if (!paymentExchangeRate && currency !== baseCurrency) {
    try {
      const r = await getRate(
        input.companyId,
        currency,
        baseCurrency,
        input.date.toISOString().slice(0, 10)
      );
      if (!r.stale) paymentExchangeRate = r.rate;
    } catch {
      paymentExchangeRate = null;
    }
  }
  const receivableAccountId = await getArAccount(exec, input.companyId);
  // A2 (C4, IAS 21): a bank account holds only its own currency. Receipts into a base-currency
  // account carry no foreign tag; into a third-currency account they are converted explicitly.
  const bankCur = (await bankCurrencyOf(input.companyId, input.paymentAccountId)) ?? baseCurrency;
  const cashLeg =
    bankCur === baseCurrency
      ? { currency: null, rate: null }
      : bankCur === currency
        ? { currency: bankCur, rate: null }
        : {
            currency: bankCur,
            rate: await bankRateOn(
              input.companyId,
              bankCur,
              baseCurrency,
              input.date.toISOString().slice(0, 10),
              currency
            ),
          };
  let result;
  try {
    result = await storage.recordInvoicePayment({
      invoiceId: input.invoiceId,
      companyId: input.companyId,
      amount: input.amount,
      date: input.date,
      method: input.method || "bank",
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      paymentAccountId: input.paymentAccountId,
      paymentAccountCurrency: (acct as { currency?: string | null }).currency ?? null,
      paymentExchangeRate,
      cashLeg,
      receivableAccountId,
      createdBy: input.createdBy,
      allowCredit: input.allowCredit === true,
      ...(input.tx ? { tx: input.tx } : {}),
    });
  } catch (err) {
    const e = err as { code?: string; message?: string; details?: unknown };
    if (
      e?.code &&
      [
        "PAYMENT_EXCEEDS_BALANCE",
        "OVERPAYMENT",
        "INVOICE_TERMINAL",
        "CURRENCY_MISMATCH",
        "CUSTOMER_CREDIT_ACCOUNT_MISSING",
        "REALISED_FX_ACCOUNT_MISSING",
      ].includes(e.code)
    ) {
      throw new DomainError(e.code, 422, e.details, e.message);
    }
    if (e?.code === "INVOICE_NOT_FOUND") throw new DomainError("INVOICE_NOT_FOUND", 404);
    throw err;
  }
  const amountFils = toFils(input.amount, { rounding: "halfUp" });
  if (input.tx) {
    // WQ1: inside a caller's transaction the events wait for its commit. A new cash sale or an
    // open invoice has no bad-debt relief to reverse (relief needs a written-off, overdue debt);
    // the relief check still runs after the commit.
    const settled = result;
    await withLedgerTx(async (_tx, hooks) => {
      hooks.afterCommit(async () => {
        await afterPaymentRecorded(input, settled, amountFils);
      });
    }, input.tx);
    return result;
  }
  const relief = await afterPaymentRecorded(input, result, amountFils);
  return relief ? { ...result, badDebtReliefReversal: relief } : result;
}

/** Bad-debt relief reversal (C2 NL8) and the payment.received / invoice.paid events. */
async function afterPaymentRecorded(
  input: RecordPaymentInput,
  result: { payment: { id: string }; invoice: Invoice },
  amountFils: number
) {
  // C2 (NL8): reverse any bad-debt relief claimed on this invoice now (Art. 64(3)), so the VAT
  // return is right as soon as the receipt is; a failure is returned, not only logged.
  let badDebtReliefReversal:
    | { status: "reversed"; claimId: string; date: string }
    | { status: "failed"; code: string; message: string }
    | null = null;
  if (has("vat.reverseReliefOnPayment")) {
    try {
      const r = await resolve<ReverseReliefOnPayment>("vat.reverseReliefOnPayment")({
        companyId: input.companyId,
        invoiceId: input.invoiceId,
        paymentId: result.payment.id,
        actorUserId: input.createdBy,
      });
      if (r) badDebtReliefReversal = { status: "reversed", claimId: r.claimId, date: r.date };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      badDebtReliefReversal = {
        status: "failed",
        code: e?.code ?? "BAD_DEBT_RELIEF_REVERSAL_FAILED",
        message: e?.message ?? "The bad-debt relief could not be reversed",
      };
      log.error({ err, invoiceId: input.invoiceId }, "bad-debt relief reversal on payment failed");
    }
  }
  emitDomainEvent("payment.received", {
    companyId: input.companyId,
    entityId: result.payment.id,
    invoiceId: input.invoiceId,
    amountFils,
    actorUserId: input.createdBy,
  });
  if (result.invoice.status === "paid") {
    emitDomainEvent("invoice.paid", {
      companyId: input.companyId,
      entityId: input.invoiceId,
      amountFils: toFils(result.invoice.total, { rounding: "halfUp" }),
      actorUserId: input.createdBy,
    });
  }
  return badDebtReliefReversal;
}

type ReverseReliefOnPayment = (p: {
  companyId: string;
  invoiceId: string;
  paymentId: string;
  actorUserId?: string | null;
}) => Promise<{ claimId: string; date: string } | null>;

export type RecordInvoicePaymentService = typeof recordInvoicePayment;

export interface ReverseInvoicePaymentInput {
  companyId: string;
  paymentId: string;
  actorId: string;
  reason: string;
  /** Reversal date (default: the kernel's rule, the original date if its period is open). */
  date?: string | null;
  /** Run inside the caller's ledger transaction (bank unmatch, compensation). */
  tx?: LedgerTx;
}

/**
 * Undo one invoice payment: reverse its own journal entry through the kernel (by entry id — the
 * payment journal's source id is the invoice, so reverseBySource would hit every payment), delete
 * the payment row and recompute the settlement status through the invoice state machine.
 * Idempotent: an already-removed payment is a no-op. Registered as "invoices.reversePayment".
 */
export async function reverseInvoicePayment(
  input: ReverseInvoicePaymentInput
): Promise<{ reversed: boolean; invoice: Invoice | null }> {
  return withLedgerTx(async (tx) => {
    const where = and(
      eq(invoicePayments.id, input.paymentId),
      eq(invoicePayments.companyId, input.companyId)
    );
    const [peek] = await tx
      .select({ invoiceId: invoicePayments.invoiceId })
      .from(invoicePayments)
      .where(where);
    if (!peek) return { reversed: false, invoice: null };
    // Same lock order as recordInvoicePayment: invoice first, then the payment row.
    const invoice = await lockInvoice(tx, peek.invoiceId, input.companyId);
    const [payment] = await tx.select().from(invoicePayments).where(where).for("update");
    if (!payment) return { reversed: false, invoice: null };
    if (payment.journalEntryId) {
      const [je] = await tx
        .select({ reversedBy: journalEntries.reversedByEntryId, status: journalEntries.status })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.id, payment.journalEntryId),
            eq(journalEntries.companyId, input.companyId)
          )
        );
      if (je && je.status === "posted" && !je.reversedBy) {
        await reverseEntry(
          payment.journalEntryId,
          {
            reason: input.reason,
            source: "payment_reversal",
            sourceId: payment.invoiceId,
            ...(input.date ? { date: input.date } : {}),
          },
          { actorId: input.actorId, tx, companyId: input.companyId }
        );
      }
    }
    await tx.delete(invoicePayments).where(eq(invoicePayments.id, payment.id));
    const updated = await refreshSettlementStatus(tx, invoice.id);
    return { reversed: true, invoice: (updated as Invoice) ?? null };
  }, input.tx);
}

export type ReverseInvoicePaymentService = typeof reverseInvoicePayment;

/** Register "invoices.recordPayment" and "invoices.reversePayment" (idempotent). */
export function registerInvoicePaymentService(): void {
  if (!has("invoices.recordPayment")) provide("invoices.recordPayment", recordInvoicePayment);
  if (!has("invoices.reversePayment")) provide("invoices.reversePayment", reverseInvoicePayment);
}

// ─── Customer credits ───────────────────────────────────────────────────────

export async function listCustomerCredits(companyId: string, status?: string) {
  const conds = [eq(customerCredits.companyId, companyId)];
  if (status) conds.push(eq(customerCredits.status, status));
  return db
    .select()
    .from(customerCredits)
    .where(and(...conds))
    .orderBy(desc(customerCredits.createdAt));
}

async function lockCredit(
  tx: LedgerTx,
  creditId: string,
  companyId: string
): Promise<CustomerCredit> {
  await tx.execute(
    sql`SELECT id FROM customer_credits WHERE id = ${creditId} AND company_id = ${companyId} FOR UPDATE`
  );
  const [credit] = await tx
    .select()
    .from(customerCredits)
    .where(and(eq(customerCredits.id, creditId), eq(customerCredits.companyId, companyId)));
  if (!credit) throw new DomainError("CUSTOMER_CREDIT_NOT_FOUND", 404);
  if (credit.status !== "open") {
    throw new DomainError("CUSTOMER_CREDIT_CLOSED", 409, { status: credit.status });
  }
  return credit;
}

function fxLine(
  diffBase: number,
  fxAcc: { gain: string; loss: string },
  label: string
): PostJournalLineInput[] {
  if (diffBase > 0)
    return [
      { accountId: fxAcc.gain, creditFils: diffBase, description: `${label} — realised FX gain` },
    ];
  if (diffBase < 0)
    return [
      { accountId: fxAcc.loss, debitFils: -diffBase, description: `${label} — realised FX loss` },
    ];
  return [];
}

async function reduceCredit(tx: LedgerTx, credit: CustomerCredit, amountFils: number) {
  const remainingFils = toFils(credit.remaining, { rounding: "halfUp" }) - amountFils;
  await tx
    .update(customerCredits)
    .set({
      remaining: Number(fromFils(remainingFils)),
      status: remainingFils === 0 ? "closed" : "open",
      updatedAt: new Date(),
    })
    .where(eq(customerCredits.id, credit.id));
}

/**
 * Apply a customer credit to an open invoice of the same customer currency:
 *   Dr customer-credit liability  (amount × credit rate)
 *   Cr Accounts Receivable        (amount × invoice rate)
 *   ± realised FX for any rate difference.
 */
export async function applyCustomerCredit(args: {
  companyId: string;
  creditId: string;
  invoiceId: string;
  amountFils: number;
  date: string;
  userId: string;
}) {
  const out = await withLedgerTx(async (tx) => {
    const credit = await lockCredit(tx, args.creditId, args.companyId);
    const invoice = await lockInvoice(tx, args.invoiceId, args.companyId);
    if (
      invoice.invoiceType === "credit_note" ||
      !["sent", "posted", "partial"].includes(invoice.status)
    ) {
      throw new DomainError(
        "INVOICE_NOT_OPEN",
        409,
        { status: invoice.status },
        "Credits can only be applied to an issued, unpaid invoice."
      );
    }
    const baseCurrency = await loadBaseCurrency(args.companyId, tx);
    if (documentCurrency(invoice.currency, baseCurrency) !== credit.currency.toUpperCase()) {
      throw new DomainError("CURRENCY_MISMATCH", 422, {
        credit: credit.currency,
        invoice: invoice.currency,
      });
    }
    const remaining = toFils(credit.remaining, { rounding: "halfUp" });
    if (args.amountFils > remaining) {
      throw new DomainError("CREDIT_EXCEEDS_REMAINING", 409, { remaining: fromFils(remaining) });
    }
    const open = await invoiceOpenFils(tx, invoice);
    if (args.amountFils > open) {
      throw new DomainError("CREDIT_EXCEEDS_INVOICE_BALANCE", 409, { open: fromFils(open) });
    }
    const creditRate =
      credit.currency.toUpperCase() === baseCurrency ? "1" : String(credit.exchangeRate);
    const invRate = invoiceRate(invoice, baseCurrency);
    const liabBase = toBase(args.amountFils, creditRate);
    const arBase = toBase(args.amountFils, invRate);
    const ar = await getArAccount(tx, args.companyId);
    const foreign = credit.currency.toUpperCase() !== baseCurrency;
    const fxAcc = liabBase !== arBase ? await getFxAccounts(tx, args.companyId) : null;
    const label = `Credit applied to ${invoice.number}`;
    // A4 (M1): a customer deposit carried VAT on receipt; applying it to the invoice (which
    // charges VAT in full) reverses that share from 2020 so the supply's VAT is declared once.
    const isDeposit = credit.sourceType === "deposit";
    const deposit = isDeposit
      ? await depositConsumptionLines(
          tx,
          credit,
          args.amountFils,
          `Deposit applied to ${invoice.number}`,
          args.date
        )
      : null;
    const lines: PostJournalLineInput[] = [
      ...(deposit
        ? deposit.lines
        : [
            {
              accountId: credit.liabilityAccountId,
              debitFils: liabBase,
              description: label,
              ...(foreign
                ? {
                    foreignCurrency: credit.currency,
                    foreignDebit: fromFils(args.amountFils),
                    exchangeRate: creditRate,
                  }
                : {}),
            },
          ]),
      {
        accountId: ar,
        creditFils: arBase,
        controlLeg: "receivables",
        description: label,
        ...(foreign
          ? {
              foreignCurrency: credit.currency,
              foreignCredit: fromFils(args.amountFils),
              exchangeRate: invRate,
            }
          : {}),
      },
      // Extinguishing a larger liability than the receivable cleared is a gain.
      ...(fxAcc ? fxLine(liabBase - arBase, fxAcc, label) : []),
    ];
    const [alloc] = await tx
      .insert(customerCreditAllocations)
      .values({
        companyId: args.companyId,
        creditId: credit.id,
        kind: "apply",
        invoiceId: invoice.id,
        amount: Number(fromFils(args.amountFils)),
        date: new Date(`${args.date}T00:00:00.000Z`),
        exchangeRate: Number(invRate),
        vatAmount: deposit ? Number(fromFils(deposit.vatFils)) : null,
        createdBy: args.userId,
      })
      .returning();
    const { entry } = await postJournal(
      {
        companyId: args.companyId,
        date: args.date,
        memo: isDeposit ? `Deposit ${deposit!.deposit.number} applied to ${invoice.number}` : label,
        status: "posted",
        source: isDeposit ? CUSTOMER_DEPOSIT_SOURCE : "customer_credit",
        sourceId: alloc.id,
        idempotencyKey: `customer_credit:${alloc.id}:apply`,
        lines,
      },
      { actorId: args.userId, tx }
    );
    await tx
      .update(customerCreditAllocations)
      .set({ journalEntryId: entry.id })
      .where(eq(customerCreditAllocations.id, alloc.id));
    await reduceCredit(tx, credit, args.amountFils);
    if (isDeposit) await syncDepositStatus(tx, credit);
    const updated = await refreshSettlementStatus(tx, invoice.id);
    return { allocationId: alloc.id, journalEntryId: entry.id, invoice: updated as Invoice };
  });
  if (out.invoice?.status === "paid") {
    emitDomainEvent("invoice.paid", {
      companyId: args.companyId,
      entityId: args.invoiceId,
      actorUserId: args.userId,
    });
  }
  return out;
}

/**
 * Refund (part of) a customer credit through a cash/bank account:
 *   Dr customer-credit liability  (amount × credit rate)
 *   Cr cash / bank                (amount × refund rate)
 *   ± realised FX.
 */
export async function refundCustomerCredit(args: {
  companyId: string;
  creditId: string;
  amountFils: number;
  date: string;
  paymentAccountId: string;
  exchangeRate?: number | null;
  reference?: string | null;
  userId: string;
}) {
  await assertCashOrBankAccount(args.companyId, args.paymentAccountId);
  return withLedgerTx(async (tx) => {
    const credit = await lockCredit(tx, args.creditId, args.companyId);
    const remaining = toFils(credit.remaining, { rounding: "halfUp" });
    if (args.amountFils > remaining) {
      throw new DomainError("CREDIT_EXCEEDS_REMAINING", 409, { remaining: fromFils(remaining) });
    }
    const foreign = isForeignCurrency(credit.currency, await loadBaseCurrency(args.companyId, tx));
    const creditRate = foreign ? String(credit.exchangeRate) : "1";
    const refundRate = foreign
      ? String(args.exchangeRate && args.exchangeRate > 0 ? args.exchangeRate : credit.exchangeRate)
      : "1";
    const liabBase = toBase(args.amountFils, creditRate);
    // A2 (C4): the bank line is measured in the bank account's own currency.
    const base = await loadBaseCurrency(args.companyId, tx);
    const leg = await cashLegFor({
      companyId: args.companyId,
      base,
      bankCurrency: await bankCurrencyOf(args.companyId, args.paymentAccountId),
      docCurrency: foreign ? credit.currency : base,
      docAmountFils: args.amountFils,
      docRate: refundRate,
      date: args.date,
    });
    const cashBase = leg.cashBaseFils;
    const fxAcc = liabBase !== cashBase ? await getFxAccounts(tx, args.companyId) : null;
    const isDeposit = credit.sourceType === "deposit";
    const label = isDeposit
      ? `Refund of customer deposit (${credit.customerName})`
      : `Refund of customer credit (${credit.customerName})`;
    // A4 (M1): refunding an advance reverses its share of the VAT declared on receipt.
    const deposit = isDeposit
      ? await depositConsumptionLines(tx, credit, args.amountFils, label, args.date)
      : null;
    const lines: PostJournalLineInput[] = [
      ...(deposit
        ? deposit.lines
        : [
            {
              accountId: credit.liabilityAccountId,
              debitFils: liabBase,
              description: label,
              ...(foreign
                ? {
                    foreignCurrency: credit.currency,
                    foreignDebit: fromFils(args.amountFils),
                    exchangeRate: creditRate,
                  }
                : {}),
            },
          ]),
      {
        accountId: args.paymentAccountId,
        creditFils: cashBase,
        description: label,
        ...(leg.tag
          ? {
              foreignCurrency: leg.tag.foreignCurrency,
              foreignCredit: leg.tag.amount,
              exchangeRate: leg.tag.exchangeRate,
            }
          : {}),
      },
      // Paying out more base than the liability carried is a loss, less a gain.
      ...(fxAcc ? fxLine(liabBase - cashBase, fxAcc, label) : []),
    ];
    const [alloc] = await tx
      .insert(customerCreditAllocations)
      .values({
        companyId: args.companyId,
        creditId: credit.id,
        kind: "refund",
        paymentAccountId: args.paymentAccountId,
        amount: Number(fromFils(args.amountFils)),
        date: new Date(`${args.date}T00:00:00.000Z`),
        exchangeRate: Number(refundRate),
        reference: args.reference ?? null,
        vatAmount: deposit ? Number(fromFils(deposit.vatFils)) : null,
        createdBy: args.userId,
      })
      .returning();
    const { entry } = await postJournal(
      {
        companyId: args.companyId,
        date: args.date,
        memo: label,
        status: "posted",
        source: isDeposit ? CUSTOMER_DEPOSIT_SOURCE : "customer_credit",
        sourceId: alloc.id,
        idempotencyKey: `customer_credit:${alloc.id}:refund`,
        lines,
      },
      { actorId: args.userId, tx }
    );
    await tx
      .update(customerCreditAllocations)
      .set({ journalEntryId: entry.id })
      .where(eq(customerCreditAllocations.id, alloc.id));
    await reduceCredit(tx, credit, args.amountFils);
    if (isDeposit) await syncDepositStatus(tx, credit);
    return { allocationId: alloc.id, journalEntryId: entry.id };
  });
}

// ─── Bad-debt write-off and the allowance for doubtful debts (A3: H1, M5) ───────
//
// A write-off is a settlement of the invoice (IFRS 9.5.4.4: no reasonable expectation of
// recovery), so it is an invoice_payments row with method 'write_off' and no payment account:
// the one settlement rule (server/reporting/settlement.ts) closes the document and the aging
// keeps tying to GL 1040. The journal debits the bad-debt expense (5120) or, against an
// allowance already provided, the allowance for doubtful debts (1045), and credits A/R at the
// invoice's booking rate. VAT bad-debt relief (FDL 8/2017 Art. 64) is a separate step on the
// written-off amount (server/tax/vat-adjustments.service.ts). A later receipt reinstates the
// write-off first (bad debt recovered), then settles as a normal payment.

export const WRITE_OFF_METHOD = "write_off";
export const WRITE_OFF_SOURCE = "invoice_write_off";
export const ALLOWANCE_SOURCE = "doubtful_debt_allowance";
export const BAD_DEBT_EXPENSE_CODE = "5120";
const ALLOWANCE_CODE = ALLOWANCE_FOR_DOUBTFUL_DEBTS_CODE;

/** Allowance balance (fils, credit) at `asOf` read inside the caller's transaction. */
async function allowanceFilsInTx(tx: LedgerTx, companyId: string, asOf: string): Promise<number> {
  const res = await tx.execute(
    sql`SELECT COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::text AS f
          FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN accounts a ON a.id = jl.account_id
         WHERE je.company_id = ${companyId} AND je.status = 'posted' AND a.company_id = ${companyId}
           AND a.code = ${ALLOWANCE_CODE}
           AND ((je.date + interval '4 hours')::date) <= ${asOf}::date`
  );
  const rows = ((res as { rows?: unknown[] }).rows ?? res) as Array<{ f: string }>;
  return Number(rows[0]?.f ?? 0);
}

async function ensureReceivableAccount(companyId: string, code: "5120" | "1045") {
  const found = await storage.getAccountByCode(companyId, code);
  if (found && found.isActive && !found.isArchived) return found;
  const template =
    code === "5120"
      ? {
          nameEn: "Bad Debt Expense",
          nameAr: "مصروف الديون المعدومة",
          description: "Receivables written off and impairment losses on trade receivables",
          type: "expense",
          subType: "operating_expense",
        }
      : {
          nameEn: "Allowance for Doubtful Debts",
          nameAr: "مخصص الديون المشكوك في تحصيلها",
          description: "Loss allowance on trade receivables (IFRS 9 simplified approach)",
          type: "asset",
          subType: "contra_asset",
        };
  return storage.createAccount({
    companyId,
    code,
    ...template,
    isVatAccount: false,
    vatType: null,
    isSystemAccount: false,
  } as Parameters<typeof storage.createAccount>[0]);
}

/** Written-off amount (document-currency fils) still standing on an invoice. */
export async function invoiceWrittenOffFils(tx: LedgerTx, invoiceId: string): Promise<number> {
  const res = await tx.execute(
    sql`SELECT COALESCE(SUM(ROUND(amount * 100)), 0)::text AS f FROM invoice_payments
         WHERE invoice_id = ${invoiceId} AND method = ${WRITE_OFF_METHOD}`
  );
  const rows = ((res as { rows?: unknown[] }).rows ?? res) as Array<{ f: string }>;
  return Number(rows[0]?.f ?? 0);
}

export interface WriteOffInput {
  companyId: string;
  invoiceId: string;
  date: string;
  /** Document-currency fils; default the whole open balance. */
  amountFils?: number | null;
  against?: "expense" | "allowance";
  reason: string;
  userId: string;
}

export async function writeOffInvoice(input: WriteOffInput) {
  const expense = await ensureReceivableAccount(input.companyId, BAD_DEBT_EXPENSE_CODE);
  const allowanceAcct =
    input.against === "allowance"
      ? await ensureReceivableAccount(input.companyId, ALLOWANCE_CODE)
      : null;
  return withLedgerTx(async (tx) => {
    const invoice = await lockInvoice(tx, input.invoiceId, input.companyId);
    if (invoice.invoiceType === "credit_note") {
      throw new DomainError("CANNOT_WRITE_OFF_CREDIT_NOTE", 422);
    }
    if (!["sent", "posted", "partial"].includes(invoice.status)) {
      throw new DomainError(
        "INVOICE_NOT_OPEN",
        409,
        { status: invoice.status },
        "Only an issued invoice with an open balance can be written off."
      );
    }
    const open = await invoiceOpenFils(tx, invoice);
    const amount = input.amountFils ?? open;
    if (amount <= 0 || amount > open) {
      throw new DomainError(
        "WRITE_OFF_EXCEEDS_BALANCE",
        422,
        { open: fromFils(open), attempted: fromFils(amount) },
        "The write-off cannot exceed the invoice's open balance."
      );
    }
    const baseCurrency = await loadBaseCurrency(input.companyId, tx);
    const rate = invoiceRate(invoice, baseCurrency);
    const base = toBase(amount, rate);
    const foreign = isForeignCurrency(invoice.currency, baseCurrency);
    const ar = await getArAccount(tx, input.companyId);
    // Against the allowance: use what is provided, the rest is a direct expense.
    const fromAllowance = allowanceAcct
      ? Math.min(base, Math.max(0, await allowanceFilsInTx(tx, input.companyId, input.date)))
      : 0;
    const label = `Bad debt written off - ${invoice.number}`;
    const [row] = await tx
      .insert(invoicePayments)
      .values({
        invoiceId: invoice.id,
        companyId: input.companyId,
        amount: Number(fromFils(amount)),
        date: new Date(`${input.date}T00:00:00.000Z`),
        method: WRITE_OFF_METHOD,
        reference: "Write-off",
        notes: input.reason,
        paymentAccountId: null,
        exchangeRate: null,
        createdBy: input.userId,
      })
      .returning();
    const lines: PostJournalLineInput[] = [];
    if (fromAllowance > 0) {
      lines.push({
        accountId: allowanceAcct!.id,
        debitFils: fromAllowance,
        description: `${label} (allowance used)`,
      });
    }
    if (base - fromAllowance > 0) {
      lines.push({ accountId: expense.id, debitFils: base - fromAllowance, description: label });
    }
    lines.push({
      accountId: ar,
      creditFils: base,
      controlLeg: "receivables",
      description: label,
      ...(foreign
        ? {
            foreignCurrency: documentCurrency(invoice.currency, baseCurrency),
            foreignCredit: fromFils(amount),
            exchangeRate: rate,
          }
        : {}),
    });
    const { entry } = await postJournal(
      {
        companyId: input.companyId,
        date: input.date,
        memo: `${label}: ${input.reason}`.slice(0, 500),
        status: "posted",
        source: WRITE_OFF_SOURCE,
        sourceId: invoice.id,
        idempotencyKey: `${WRITE_OFF_SOURCE}:${row.id}`,
        lines,
      },
      { actorId: input.userId, tx }
    );
    await tx
      .update(invoicePayments)
      .set({ journalEntryId: entry.id })
      .where(eq(invoicePayments.id, row.id));
    const updated = await refreshSettlementStatus(tx, invoice.id);
    return {
      writeOff: { ...row, journalEntryId: entry.id },
      journalEntryId: entry.id,
      amount: Number(fromFils(amount)),
      baseAmount: Number(fromFils(base)),
      fromAllowance: Number(fromFils(fromAllowance)),
      toExpense: Number(fromFils(base - fromAllowance)),
      invoice: updated as Invoice,
    };
  });
}

/**
 * Reinstate the written-off balance of an invoice (newest write-off first) until at least
 * `neededFils` is open again, or all of it when `neededFils` is null: the bad debt is recovered
 * or the write-off was wrong. Each write-off journal is reversed on `date`.
 */
export async function reinstateWriteOffs(input: {
  companyId: string;
  invoiceId: string;
  date: string;
  reason: string;
  userId: string;
  neededFils?: number | null;
  tx?: LedgerTx;
}): Promise<{ reinstatedFils: number; invoice: Invoice | null }> {
  return withLedgerTx(async (tx) => {
    const invoice = await lockInvoice(tx, input.invoiceId, input.companyId);
    const rows = await tx
      .select()
      .from(invoicePayments)
      .where(
        and(
          eq(invoicePayments.invoiceId, invoice.id),
          eq(invoicePayments.companyId, input.companyId),
          eq(invoicePayments.method, WRITE_OFF_METHOD)
        )
      )
      .orderBy(desc(invoicePayments.date), desc(invoicePayments.createdAt));
    let open = await invoiceOpenFils(tx, invoice);
    let reinstated = 0;
    let latest: Invoice | null = invoice;
    for (const r of rows) {
      if (input.neededFils != null && open >= input.neededFils) break;
      const f = toFils(r.amount, { rounding: "halfUp" });
      const out = await reverseInvoicePayment({
        companyId: input.companyId,
        paymentId: r.id,
        actorId: input.userId,
        reason: input.reason,
        date: input.date,
        tx,
      });
      if (out.reversed) {
        reinstated += f;
        open += f;
        latest = out.invoice;
      }
    }
    return { reinstatedFils: reinstated, invoice: latest };
  }, input.tx);
}

/** Allowance for doubtful debts at `asOf` (base currency) and the account carrying it. */
export async function getDoubtfulDebtAllowance(companyId: string, asOf: string | null) {
  const acct = await storage.getAccountByCode(companyId, ALLOWANCE_CODE);
  const fils = await allowanceForDoubtfulDebtsFils(companyId, asOf);
  return {
    accountId: acct?.id ?? null,
    accountCode: ALLOWANCE_CODE,
    asOf,
    balance: Number(fromFils(fils)),
  };
}

/**
 * Set the allowance for doubtful debts to `targetFils` at `date` (IFRS 9.5.5.15 simplified
 * approach: a lifetime expected-credit-loss estimate the accountant enters). An increase posts
 * Dr 5120 impairment loss / Cr 1045; a decrease reverses it. Receivables (1040) and the aging
 * are untouched; the aging shows the allowance as a reconciling line to net receivables.
 */
export async function setDoubtfulDebtAllowance(input: {
  companyId: string;
  date: string;
  targetFils: number;
  memo?: string | null;
  userId: string;
}) {
  const expense = await ensureReceivableAccount(input.companyId, BAD_DEBT_EXPENSE_CODE);
  const allowance = await ensureReceivableAccount(input.companyId, ALLOWANCE_CODE);
  return withLedgerTx(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM accounts WHERE id = ${allowance.id} AND company_id = ${input.companyId} FOR UPDATE`
    );
    const current = await allowanceFilsInTx(tx, input.companyId, input.date);
    const delta = input.targetFils - current;
    if (delta === 0) {
      throw new DomainError(
        "ALLOWANCE_NO_CHANGE",
        422,
        { balance: fromFils(current) },
        "The allowance already has this balance."
      );
    }
    const label =
      delta > 0
        ? "Increase in allowance for doubtful debts"
        : "Release of allowance for doubtful debts";
    const memo = input.memo ? `${label}: ${input.memo}` : label;
    const { entry } = await postJournal(
      {
        companyId: input.companyId,
        date: input.date,
        memo: memo.slice(0, 500),
        status: "posted",
        source: ALLOWANCE_SOURCE,
        sourceId: allowance.id,
        lines:
          delta > 0
            ? [
                { accountId: expense.id, debitFils: delta, description: label },
                { accountId: allowance.id, creditFils: delta, description: label },
              ]
            : [
                { accountId: allowance.id, debitFils: -delta, description: label },
                { accountId: expense.id, creditFils: -delta, description: label },
              ],
      },
      { actorId: input.userId, tx }
    );
    return {
      journalEntryId: entry.id,
      previousBalance: Number(fromFils(current)),
      balance: Number(fromFils(input.targetFils)),
      change: Number(fromFils(delta)),
    };
  });
}
