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
  type CustomerCredit,
  type Invoice,
} from "../../shared/schema";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { postJournal, withLedgerTx, type LedgerTx, type PostJournalLineInput } from "../ledger";
import { fromFils, mulRate, toFils } from "../../shared/money";
import { emitDomainEvent } from "../platform/domain-events";
import { has, provide } from "../platform/service-registry";
import {
  BASE_CURRENCY,
  getArAccount,
  getFxAccounts,
  invoiceOpenFils,
  invoiceRate,
  lockInvoice,
  refreshSettlementStatus,
  toBase,
} from "./invoice-posting.service";
import { isTerminal } from "./invoice-state-machine";
import { getRate } from "./fx/rates";

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
}

/**
 * Settle an invoice (backward compatible with storage.recordInvoicePayment's
 * result). Emits payment.received and, when fully settled, invoice.paid after
 * the commit.
 */
export async function recordInvoicePayment(input: RecordPaymentInput) {
  const invoice = await storage.getInvoice(input.invoiceId, input.companyId);
  if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", 404, undefined, "Invoice not found");
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
  const acct = await assertCashOrBankAccount(input.companyId, input.paymentAccountId);
  // R03-22: a foreign invoice settles at the payment-date rate (company rate,
  // then system rate via fx.getRate) so realised FX is booked; with no rate on
  // file it settles at the invoice rate (no FX), as before.
  let paymentExchangeRate = input.paymentExchangeRate ?? null;
  const currency = (invoice.currency || BASE_CURRENCY).toUpperCase();
  if (!paymentExchangeRate && currency !== BASE_CURRENCY) {
    try {
      const r = await getRate(
        input.companyId,
        currency,
        BASE_CURRENCY,
        input.date.toISOString().slice(0, 10)
      );
      if (!r.stale) paymentExchangeRate = r.rate;
    } catch {
      paymentExchangeRate = null;
    }
  }
  const receivableAccountId = await getArAccount(db, input.companyId);
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
      receivableAccountId,
      createdBy: input.createdBy,
      allowCredit: input.allowCredit === true,
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
  return result;
}

export type RecordInvoicePaymentService = typeof recordInvoicePayment;

/** Register "invoices.recordPayment" (idempotent). */
export function registerInvoicePaymentService(): void {
  if (!has("invoices.recordPayment")) provide("invoices.recordPayment", recordInvoicePayment);
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
    if ((invoice.currency || BASE_CURRENCY).toUpperCase() !== credit.currency.toUpperCase()) {
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
      credit.currency.toUpperCase() === BASE_CURRENCY ? "1" : String(credit.exchangeRate);
    const invRate = invoiceRate(invoice);
    const liabBase = toBase(args.amountFils, creditRate);
    const arBase = toBase(args.amountFils, invRate);
    const ar = await getArAccount(tx, args.companyId);
    const foreign = credit.currency.toUpperCase() !== BASE_CURRENCY;
    const fxAcc = liabBase !== arBase ? await getFxAccounts(tx, args.companyId) : null;
    const label = `Credit applied to ${invoice.number}`;
    const lines: PostJournalLineInput[] = [
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
      {
        accountId: ar,
        creditFils: arBase,
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
        createdBy: args.userId,
      })
      .returning();
    const { entry } = await postJournal(
      {
        companyId: args.companyId,
        date: args.date,
        memo: label,
        status: "posted",
        source: "customer_credit",
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
    const foreign = credit.currency.toUpperCase() !== BASE_CURRENCY;
    const creditRate = foreign ? String(credit.exchangeRate) : "1";
    const refundRate = foreign
      ? String(args.exchangeRate && args.exchangeRate > 0 ? args.exchangeRate : credit.exchangeRate)
      : "1";
    const liabBase = toBase(args.amountFils, creditRate);
    const cashBase = foreign ? mulRate(args.amountFils, refundRate) : args.amountFils;
    const fxAcc = liabBase !== cashBase ? await getFxAccounts(tx, args.companyId) : null;
    const label = `Refund of customer credit (${credit.customerName})`;
    const lines: PostJournalLineInput[] = [
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
      { accountId: args.paymentAccountId, creditFils: cashBase, description: label },
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
        createdBy: args.userId,
      })
      .returning();
    const { entry } = await postJournal(
      {
        companyId: args.companyId,
        date: args.date,
        memo: label,
        status: "posted",
        source: "customer_credit",
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
    return { allocationId: alloc.id, journalEntryId: entry.id };
  });
}
