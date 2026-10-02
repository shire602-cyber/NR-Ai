// Customer advances and deposits (Phase 8 D1).
//
// An advance is an ADVANCE TAX INVOICE: an invoice of type `advance` whose single line posts to 2055 Customer
// Advances instead of revenue. It is issued and paid through the ordinary paths (issueInvoice, recordInvoicePayment),
// so VAT falls due in the period of the advance (Decree-Law 8/2017 Art. 25-26) and Pay now, statements and the VAT
// return need no special case. The final invoice deducts it by an `advance` line (shared/sales-line-math.ts); an
// unapplied balance is paid back through a credit note on the advance invoice and the existing refund flow.
//
// Invariant: GL 2055 = sum of advance net - applied (issued final invoices) - refunded (credit notes) per company.
// Locks, always in this order: the final invoice (INVOICE_POSTING) -> the advance row (FOR UPDATE).

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customerAdvanceApplications,
  customerAdvances,
  customerContacts,
  invoices,
  journalEntries,
  type CustomerAdvance,
  type Invoice,
} from "../../shared/schema";
import { storage } from "../storage";
import { AppError } from "../errors";
import { ACCOUNT_CODES, UAE_VAT_RATE } from "../constants";
import { withDocumentLock, LOCK_NS } from "./document-lock";
import { allocateInvoiceNumber } from "./invoice-numbering.service";
import { assertNotFutureDate, assertPeriodNotLocked } from "./period-lock.service";
import { resolveSettlementDate } from "./payment-date-guard.service";
import { issueInvoice } from "./invoice-issue.service";
import { issueCreditNote } from "./credit-note-issue.service";
import { createRefund, getRefundSummary, isRefundAccount } from "./customer-refund.service";
import {
  editableLinesOf,
  loadInvoiceLineRows,
  replaceInvoiceLines,
  type SalesLineSource,
} from "./sales-lines.service";
import { splitGross } from "../../shared/sales-line-math";
import { ensureSystemAccount } from "./inventory-costing.service";
import { advanceBalance, refreshAdvanceStatus } from "./advance-ledger.service";

type Tx = typeof db;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MAX_AMOUNT = 9_000_000_000_000;

const refuse = (statusCode: number, code: string, message: string) => new AppError({ message, statusCode, code });
const dayOf = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

// ─── create ─────────────────────────────────────────────────────────────────

export interface CreateAdvanceInput {
  companyId: string;
  userId: string;
  contactId: string;
  date: string; // YYYY-MM-DD
  /** Gross amount received or requested, VAT included. */
  amount: number;
  vatRate: number; // 0 or 0.05
  kind: "advance" | "deposit";
  description?: string | null;
  salesOrderId?: string | null;
  receive?: { paymentAccountId: string; method?: string | null; reference?: string | null } | null;
}

export async function createAdvance(input: CreateAdvanceInput) {
  const { companyId, userId } = input;
  if (!(input.amount > 0) || input.amount > MAX_AMOUNT) {
    throw refuse(422, "AMOUNT_OUT_OF_RANGE", "The amount must be above 0 and within range.");
  }
  const [contact] = await db
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.id, input.contactId), eq(customerContacts.companyId, companyId)));
  if (!contact) throw refuse(422, "CONTACT_NOT_FOUND", "contactId is not a contact of this company.");

  // A refundable deposit is not consideration for a supply: outside the scope of VAT.
  const isDeposit = input.kind === "deposit";
  const vatRate = isDeposit ? 0 : input.vatRate === 5 ? UAE_VAT_RATE : input.vatRate;
  if (vatRate !== 0 && vatRate !== UAE_VAT_RATE) {
    throw refuse(422, "INVALID_VAT_RATE", "VAT rate must be 0% or 5% (UAE).");
  }
  const supplyType = isDeposit ? "out_of_scope" : vatRate > 0 ? "standard_rated" : "zero_rated";

  if (input.salesOrderId) {
    const so = rowsOf(
      await db.execute(sql`SELECT id FROM sales_orders WHERE id = ${input.salesOrderId} AND company_id = ${companyId}`)
    );
    if (so.length === 0) throw refuse(422, "SALES_ORDER_NOT_FOUND", "salesOrderId is not a sales order of this company.");
  }

  const date = dayOf(input.date);
  if (Number.isNaN(date.getTime())) throw refuse(400, "INVALID_DATE", "Invalid date.");
  // The advance tax invoice recognises VAT now: it must land in an open period and not in the future.
  await assertPeriodNotLocked(companyId, date);
  assertNotFutureDate(date);

  // Everything issue needs must exist BEFORE a number is consumed (FTA numbering has no gaps).
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const hasAr = accounts.some((a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
  const hasRevenue = accounts.some(
    (a) => a.isSystemAccount && a.type === "income" && (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT)
  );
  if (!hasAr || !hasRevenue) {
    throw refuse(422, "CHART_OF_ACCOUNTS_MISSING", "Seed the default chart of accounts first.");
  }
  const advanceAccount = await ensureSystemAccount(db, companyId, ACCOUNT_CODES.CUSTOMER_ADVANCES, "liability");

  const split = splitGross(input.amount, vatRate);
  const description =
    input.description?.trim() || (isDeposit ? "Refundable security deposit" : "Advance payment");

  const created = await db.transaction(async (tx: Tx) => {
    const number = await allocateInvoiceNumber(companyId, "invoice", date, tx);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        companyId,
        number,
        customerName: contact.name,
        customerTrn: contact.trnNumber ?? undefined,
        customerAddress: contact.address ?? undefined,
        contactId: contact.id,
        date,
        dueDate: date,
        currency: "AED",
        exchangeRate: 1,
        invoiceType: "advance",
        status: "draft",
        subtotal: split.net,
        vatAmount: split.vat,
        total: input.amount,
      } as any)
      .returning();
    const source: SalesLineSource = {
      kind: "item",
      description,
      quantity: 1,
      unitPrice: split.net,
      vatRate,
      vatSupplyType: supplyType,
      revenueAccountId: advanceAccount.id,
    };
    await replaceInvoiceLines(tx, { companyId, invoiceId: invoice.id, lines: [source], exchangeRate: 1 });
    const [stored] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
    const advNumber = await allocateInvoiceNumber(companyId, "advance", date, tx);
    const [advance] = await tx
      .insert(customerAdvances)
      .values({
        companyId,
        contactId: contact.id,
        number: advNumber,
        kind: input.kind,
        invoiceId: invoice.id,
        salesOrderId: input.salesOrderId ?? null,
        currency: "AED",
        vatRate,
        vatSupplyType: supplyType,
        netAmount: stored.subtotal,
        vatAmount: stored.vatAmount,
        grossAmount: stored.total,
        description,
        status: "open",
        createdBy: userId,
      } as any)
      .returning();
    return { invoice: stored, advance };
  });

  // Issue: revenue-style journal (Dr 1040 / Cr 2055, Cr 2020) through the ordinary issue path.
  const issued = await issueInvoice(created.invoice as Invoice, userId);
  if (!issued.ok) {
    throw refuse(issued.status, issued.body.code, issued.body.message);
  }
  const sent = await storage.updateInvoiceStatus(created.invoice.id, companyId, "sent");

  let payment: unknown;
  let paymentError: string | undefined;
  if (input.receive) {
    try {
      const account = await storage.getAccount(input.receive.paymentAccountId, companyId);
      if (!account || account.type !== "asset") {
        throw refuse(400, "INVALID_PAYMENT_ACCOUNT", "Invalid payment account: it must be a cash or bank account of this company.");
      }
      const ar = accounts.find((a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount)!;
      const { date: paymentDate } = await resolveSettlementDate(companyId, { requested: input.date });
      const result = await storage.recordInvoicePayment({
        invoiceId: created.invoice.id,
        companyId,
        amount: Number(sent.total),
        date: paymentDate,
        method: input.receive.method || "bank",
        reference: input.receive.reference || null,
        notes: `Received against ${created.advance.number}`,
        paymentAccountId: input.receive.paymentAccountId,
        paymentAccountCurrency: (account as any).currency ?? null,
        receivableAccountId: ar.id,
        createdBy: userId,
      });
      payment = result.payment;
    } catch (err: any) {
      paymentError = err?.message || "The payment could not be recorded.";
    }
  }
  const invoice = await storage.getInvoice(created.invoice.id, companyId);
  return { advance: created.advance as CustomerAdvance, invoice, payment, paymentError };
}

// ─── apply / remove (draft final invoice) ───────────────────────────────────

async function lockDraftInvoice(tx: Tx, companyId: string, invoiceId: string): Promise<Invoice> {
  const found = rowsOf(
    await tx.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId} FOR UPDATE`)
  );
  if (found.length === 0) throw refuse(404, "INVOICE_NOT_FOUND", "Invoice not found");
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  const posted = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.source, "invoice"),
        eq(journalEntries.sourceId, invoiceId),
        eq(journalEntries.status, "posted")
      )
    );
  if (invoice.status !== "draft" || posted.length > 0) {
    throw refuse(409, "INVOICE_NOT_DRAFT", "An advance can only be applied to or removed from a draft invoice.");
  }
  return invoice;
}

/** Rebuild the lines of a draft from its own stored items and discount inputs plus the active applications. */
async function rebuildDraft(tx: Tx, invoice: Invoice) {
  const rows = await loadInvoiceLineRows(tx, invoice.id);
  await replaceInvoiceLines(tx, {
    companyId: invoice.companyId,
    invoiceId: invoice.id,
    lines: editableLinesOf(rows as any[]),
    discountType: (invoice as any).discountType ?? null,
    discountValue: (invoice as any).discountValue ?? null,
    exchangeRate: Number(invoice.exchangeRate) || 1,
  });
}

export async function applyAdvance(args: {
  companyId: string;
  invoiceId: string;
  advanceId: string;
  /** Net amount of the advance to deduct. */
  amount: number;
  userId: string;
}) {
  const { companyId, invoiceId, advanceId, amount, userId } = args;
  if (!(amount > 0) || amount > MAX_AMOUNT) throw refuse(422, "AMOUNT_OUT_OF_RANGE", "The amount must be above 0.");
  const net = r2(amount);

  return await withDocumentLock(invoiceId, LOCK_NS.INVOICE_POSTING, async (tx: Tx) => {
    const invoice = await lockDraftInvoice(tx, companyId, invoiceId);
    if (invoice.invoiceType !== "invoice") {
      throw refuse(422, "INVOICE_TYPE_NOT_SUPPORTED", "An advance can only be deducted on an ordinary invoice.");
    }
    if (invoice.currency !== "AED") {
      throw refuse(
        422,
        "ADVANCE_CURRENCY_UNSUPPORTED",
        "Advances are AED only: a deduction must post at the advance's own rate, and an invoice posts at one rate."
      );
    }
    const locked = rowsOf(
      await tx.execute(sql`SELECT id FROM customer_advances WHERE id = ${advanceId} AND company_id = ${companyId} FOR UPDATE`)
    );
    if (locked.length === 0) throw refuse(404, "ADVANCE_NOT_FOUND", "Advance not found");
    const [advance] = await tx.select().from(customerAdvances).where(eq(customerAdvances.id, advanceId));
    if (advance.status === "void") throw refuse(422, "ADVANCE_VOID", "This advance is void.");
    if (advance.kind === "deposit") {
      throw refuse(422, "ADVANCE_IS_DEPOSIT", "A refundable deposit is not deducted from an invoice: refund it instead.");
    }
    if (!invoice.contactId || invoice.contactId !== advance.contactId) {
      throw refuse(422, "ADVANCE_CONTACT_MISMATCH", "The advance belongs to a different customer than this invoice.");
    }
    const [advInvoice] = await tx.select().from(invoices).where(eq(invoices.id, advance.invoiceId));
    if (!advInvoice || !["sent", "posted", "partial", "paid"].includes(advInvoice.status)) {
      throw refuse(422, "ADVANCE_NOT_ISSUED", "The advance invoice has not been issued, so it cannot be applied yet.");
    }
    const balance = await advanceBalance(tx, advanceId);
    if (net > balance.available + 0.004) {
      throw refuse(422, "ADVANCE_EXCEEDED", `Only ${balance.available.toFixed(2)} of this advance is still available.`);
    }
    const vat = r2(net * Number(advance.vatRate));
    const [application] = await tx
      .insert(customerAdvanceApplications)
      .values({ companyId, advanceId, kind: "application", invoiceId, netAmount: net, vatAmount: vat, status: "active", createdBy: userId } as any)
      .returning();
    // Throws 422 ADVANCE_EXCEEDS_INVOICE (rolling the application back) when the items cannot absorb it.
    await rebuildDraft(tx, invoice);
    await refreshAdvanceStatus(tx, advanceId);
    const [updated] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    return { application, invoice: updated };
  });
}

export async function removeApplication(args: { companyId: string; invoiceId: string; applicationId: string }) {
  const { companyId, invoiceId, applicationId } = args;
  return await withDocumentLock(invoiceId, LOCK_NS.INVOICE_POSTING, async (tx: Tx) => {
    const invoice = await lockDraftInvoice(tx, companyId, invoiceId);
    const [app] = await tx
      .select()
      .from(customerAdvanceApplications)
      .where(
        and(
          eq(customerAdvanceApplications.id, applicationId),
          eq(customerAdvanceApplications.companyId, companyId),
          eq(customerAdvanceApplications.invoiceId, invoiceId),
          eq(customerAdvanceApplications.kind, "application")
        )
      );
    if (!app) throw refuse(404, "APPLICATION_NOT_FOUND", "Application not found");
    await tx.execute(sql`SELECT id FROM customer_advances WHERE id = ${app.advanceId} FOR UPDATE`);
    await tx.delete(customerAdvanceApplications).where(eq(customerAdvanceApplications.id, applicationId));
    await rebuildDraft(tx, invoice);
    await refreshAdvanceStatus(tx, app.advanceId);
    const [updated] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    return { invoice: updated };
  });
}

// ─── refund ─────────────────────────────────────────────────────────────────

export async function refundAdvance(args: {
  companyId: string;
  advanceId: string;
  userId: string;
  /** Gross amount (VAT included) to pay back. */
  amount: number;
  date: string;
  bankAccountId: string;
}) {
  const { companyId, advanceId, userId } = args;
  if (!(args.amount > 0) || args.amount > MAX_AMOUNT) throw refuse(422, "AMOUNT_OUT_OF_RANGE", "The amount must be above 0.");
  const [advance] = await db
    .select()
    .from(customerAdvances)
    .where(and(eq(customerAdvances.id, advanceId), eq(customerAdvances.companyId, companyId)));
  if (!advance) throw refuse(404, "ADVANCE_NOT_FOUND", "Advance not found");
  if (advance.status === "void") throw refuse(422, "ADVANCE_VOID", "This advance is void.");
  const [advInvoice] = await db.select().from(invoices).where(eq(invoices.id, advance.invoiceId));
  if (!advInvoice || !["sent", "posted", "partial", "paid"].includes(advInvoice.status)) {
    throw refuse(422, "ADVANCE_NOT_ISSUED", "The advance invoice has not been issued.");
  }
  // Dated in a locked period -> 403 (before anything is reserved).
  const refundDate = dayOf(args.date);
  if (Number.isNaN(refundDate.getTime())) throw refuse(400, "INVALID_DATE", "Invalid date.");
  await assertPeriodNotLocked(companyId, refundDate);
  assertNotFutureDate(refundDate);

  // The refund account is checked BEFORE anything is reserved or posted (same rule as a customer refund).
  const bank = await storage.getAccount(args.bankAccountId, companyId);
  if (!bank || !(await isRefundAccount(bank, companyId))) {
    throw refuse(422, "INVALID_REFUND_ACCOUNT", "The refund account must be a cash or bank account of this company (not Accounts Receivable or Inventory).");
  }

  const rate = Number(advance.vatRate);
  const requested = splitGross(args.amount, rate);
  const original = await loadInvoiceLineRows(db, advance.invoiceId);
  const advLine = original.find((l: any) => l.lineKind === "item") ?? original[0];

  // 1. Reserve under the advance row lock (no nested locks: the credit note takes its own afterwards).
  const reservation = await db.transaction(async (tx: Tx) => {
    await tx.execute(sql`SELECT id FROM customer_advances WHERE id = ${advanceId} FOR UPDATE`);
    const balance = await advanceBalance(tx, advanceId);
    if (requested.net > balance.available + 0.004) {
      throw refuse(422, "ADVANCE_EXCEEDED", `Only ${balance.available.toFixed(2)} (net) of this advance is still available to refund.`);
    }
    const [row] = await tx
      .insert(customerAdvanceApplications)
      .values({
        companyId,
        advanceId,
        kind: "refund",
        invoiceId: advance.invoiceId,
        netAmount: requested.net,
        vatAmount: requested.vat,
        status: "pending",
        createdBy: userId,
      } as any)
      .returning();
    return { row, wholeAdvance: Math.abs(balance.available - requested.net) < 0.005 && balance.applied === 0 && balance.refunded === 0 };
  });

  const drop = async () => {
    await db.delete(customerAdvanceApplications).where(eq(customerAdvanceApplications.id, reservation.row.id));
  };

  // 2. Credit note on the advance invoice (Dr 2055, Dr 2020 / Cr 1040), then the cash refund.
  let cn;
  try {
    const body: Record<string, unknown> = { date: args.date };
    if (!reservation.wholeAdvance) {
      body.lines = [
        {
          description: advLine?.description ?? "Advance payment",
          quantity: 1,
          unitPrice: requested.net,
          vatRate: rate,
          vatSupplyType: advance.vatSupplyType,
          originalLineId: advLine?.id,
        },
      ];
    }
    const result = await issueCreditNote({ companyId, invoiceId: advance.invoiceId, original: advInvoice, userId, body, viaAdvanceRefund: true });
    if (!result.ok) {
      throw refuse(result.status, String(result.body.code ?? "CREDIT_NOTE_FAILED"), String(result.body.message ?? "The credit note could not be issued."));
    }
    cn = result;
  } catch (err) {
    await drop();
    throw err;
  }

  // The reservation is now a fact: the credit note reversed that part of 2055.
  await db
    .update(customerAdvanceApplications)
    .set({ status: "active", invoiceId: cn.creditNote.id })
    .where(eq(customerAdvanceApplications.id, reservation.row.id));

  let refund: unknown = null;
  let refundError: string | undefined;
  try {
    const summary = await getRefundSummary(companyId, cn.creditNote.id);
    if (summary.refundable > 0.004) {
      const out = await createRefund({
        companyId,
        creditNoteId: cn.creditNote.id,
        userId,
        amount: Math.min(Math.abs(Number(cn.creditNote.total)), summary.refundable),
        date: args.date,
        bankAccountId: args.bankAccountId,
        reference: advance.number,
        notes: `Refund of advance ${advance.number}`,
      });
      refund = out.refund;
    }
  } catch (err: any) {
    // The credit note stands (2055 is released); the cash refund can be retried from the credit note.
    refundError = err?.message || "The refund could not be recorded.";
  }
  await db.transaction(async (tx: Tx) => {
    await refreshAdvanceStatus(tx, advanceId);
  });
  return { creditNote: cn.creditNote, refund, refundError };
}

// ─── reads ──────────────────────────────────────────────────────────────────

export async function listAdvances(companyId: string, filter: { contactId?: string; status?: string } = {}) {
  const conds = [eq(customerAdvances.companyId, companyId)];
  if (filter.contactId) conds.push(eq(customerAdvances.contactId, filter.contactId));
  if (filter.status) conds.push(eq(customerAdvances.status, filter.status));
  const rows = await db
    .select({ advance: customerAdvances, invoiceNumber: invoices.number, invoiceStatus: invoices.status, contactName: customerContacts.name })
    .from(customerAdvances)
    .innerJoin(invoices, eq(invoices.id, customerAdvances.invoiceId))
    .innerJoin(customerContacts, eq(customerContacts.id, customerAdvances.contactId))
    .where(and(...conds))
    .orderBy(desc(customerAdvances.createdAt));
  const out = [];
  for (const r of rows) {
    const balance = await advanceBalance(db, r.advance.id);
    out.push({ ...r.advance, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, contactName: r.contactName, ...balance });
  }
  return out;
}

export async function getAdvance(companyId: string, advanceId: string) {
  const [row] = await db
    .select({ advance: customerAdvances, invoiceNumber: invoices.number, invoiceStatus: invoices.status, contactName: customerContacts.name })
    .from(customerAdvances)
    .innerJoin(invoices, eq(invoices.id, customerAdvances.invoiceId))
    .innerJoin(customerContacts, eq(customerContacts.id, customerAdvances.contactId))
    .where(and(eq(customerAdvances.id, advanceId), eq(customerAdvances.companyId, companyId)));
  if (!row) return null;
  const applications = await db
    .select()
    .from(customerAdvanceApplications)
    .where(eq(customerAdvanceApplications.advanceId, advanceId))
    .orderBy(asc(customerAdvanceApplications.createdAt));
  const balance = await advanceBalance(db, advanceId);
  return { ...row.advance, invoiceNumber: row.invoiceNumber, invoiceStatus: row.invoiceStatus, contactName: row.contactName, ...balance, applications };
}

/** Unapplied advances of one customer, for the statement memo and the invoice picker. */
export async function unappliedAdvancesForContact(companyId: string, contactId: string) {
  const all = await listAdvances(companyId, { contactId });
  return all.filter((a) => a.status !== "void" && a.available > 0.004 && ["sent", "posted", "partial", "paid"].includes(a.invoiceStatus));
}

/** The advances an invoice has deducted (or, for a credit note, refunded), for the invoice screen. */
export async function loadAdvanceApplicationsForInvoice(companyId: string, invoiceId: string) {
  const rows = await db
    .select({
      id: customerAdvanceApplications.id,
      advanceId: customerAdvanceApplications.advanceId,
      kind: customerAdvanceApplications.kind,
      status: customerAdvanceApplications.status,
      netAmount: customerAdvanceApplications.netAmount,
      vatAmount: customerAdvanceApplications.vatAmount,
      advanceNumber: customerAdvances.number,
    })
    .from(customerAdvanceApplications)
    .innerJoin(customerAdvances, eq(customerAdvances.id, customerAdvanceApplications.advanceId))
    .where(and(eq(customerAdvanceApplications.companyId, companyId), eq(customerAdvanceApplications.invoiceId, invoiceId)))
    .orderBy(asc(customerAdvanceApplications.createdAt));
  return rows as Array<{ id: string; advanceId: string; kind: string; status: string; netAmount: number; vatAmount: number; advanceNumber: string }>;
}
