// DatabaseStorage part: Invoices, invoice lines, quotes, credit notes, recurring invoices and invoice payments.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  accounts,
  creditNoteLines,
  creditNotes,
  customerCredits,
  invoiceLines,
  invoicePayments,
  invoices,
  journalEntries,
  paymentChases,
  quoteLines,
  quotes,
  recurringInvoices,
  type CreditNote,
  type CreditNoteLine,
  type InsertCreditNote,
  type InsertCreditNoteLine,
  type InsertInvoice,
  type InsertInvoiceLine,
  type InsertInvoicePayment,
  type InsertQuote,
  type InsertQuoteLine,
  type InsertRecurringInvoice,
  type Invoice,
  type InvoiceLine,
  type InvoicePayment,
  type JournalEntry,
  type Quote,
  type QuoteLine,
  type RecurringInvoice,
} from "@shared/schema";
import { db, rowsFromResult } from "../db";
import { and, desc, eq, getTableColumns, inArray, isNull, lte, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import Decimal from "decimal.js";
import {
  isTerminal,
  statusFromPayments,
  type InvoiceStatus,
} from "../services/invoice-state-machine";
import { ACCOUNT_CODES } from "../constants";
import { allocatePayment, buildPaymentJournalLines } from "../services/invoice-lifecycle";
import { isForeignCurrency, loadBaseCurrency, postJournal } from "../ledger";
import type { InvoiceSummary } from "./types";
import { DEFAULT_LIST_LIMIT } from "./helpers";
import { LedgerStorage } from "./ledger";
import { receivableSettlementPartsSql } from "../reporting/settlement";

export class SalesStorage extends LedgerStorage {
  // Invoices
  async getInvoice(id: string, companyId: string): Promise<Invoice | undefined> {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
    return invoice || undefined;
  }

  /** Unscoped lookup — caller MUST authorise via hasCompanyAccess on the
   * returned record's companyId before using it. */
  async getInvoiceById(id: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice || undefined;
  }

  async getInvoicesByCompanyId(companyId: string): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .orderBy(desc(invoices.date));
  }

  // Trimmed projection used by list endpoints — strips einvoiceXml (full UBL
  // doc) and einvoiceHash, which can each be 10-50KB per invoice and bloat
  // the JSON payload by 100x for a tenant with hundreds of submitted invoices.
  async getInvoicesSummaryByCompanyId(
    companyId: string,
    opts: { limit?: number; offset?: number } = {}
  ): Promise<InvoiceSummary[]> {
    const limit = opts.limit ?? DEFAULT_LIST_LIMIT;
    const offset = opts.offset ?? 0;
    return await db
      .select({
        id: invoices.id,
        companyId: invoices.companyId,
        number: invoices.number,
        customerName: invoices.customerName,
        customerTrn: invoices.customerTrn,
        date: invoices.date,
        dueDate: invoices.dueDate,
        paymentTerms: invoices.paymentTerms,
        currency: invoices.currency,
        exchangeRate: invoices.exchangeRate,
        baseCurrencyAmount: invoices.baseCurrencyAmount,
        subtotal: invoices.subtotal,
        vatAmount: invoices.vatAmount,
        total: invoices.total,
        status: invoices.status,
        shareToken: invoices.shareToken,
        shareTokenExpiresAt: invoices.shareTokenExpiresAt,
        einvoiceUuid: invoices.einvoiceUuid,
        einvoiceStatus: invoices.einvoiceStatus,
        reminderCount: invoices.reminderCount,
        lastReminderSentAt: invoices.lastReminderSentAt,
        invoiceType: invoices.invoiceType,
        originalInvoiceId: invoices.originalInvoiceId,
        legacyCreditNoteId: invoices.legacyCreditNoteId,
        isRecurring: invoices.isRecurring,
        recurringInterval: invoices.recurringInterval,
        nextRecurringDate: invoices.nextRecurringDate,
        recurringEndDate: invoices.recurringEndDate,
        contactId: invoices.contactId,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .orderBy(desc(invoices.date))
      .limit(limit)
      .offset(offset);
  }

  /**
   * R20-05: keyset (cursor) page of a company's invoices, newest first, by
   * (created_at, id) — backed by idx_invoices_company_created_id. The cursor
   * is opaque to clients: base64url("<created_at ISO>|<id>").
   */
  async getInvoicesPage(
    companyId: string,
    opts: { limit: number; cursor?: string | null; status?: string; type?: string }
  ): Promise<{
    items: Omit<Invoice, "einvoiceXml" | "einvoiceHash">[];
    nextCursor: string | null;
  }> {
    const conds = [eq(invoices.companyId, companyId)];
    // Derived filters used by dashboard drill-through links (R13-21):
    //   open    = issued, not fully settled (sent | posted | partial)
    //   overdue = open with a due date before today (UAE calendar day)
    const OPEN_STATUSES = ["sent", "posted", "partial"];
    if (opts.status === "open" || opts.status === "overdue") {
      conds.push(inArray(invoices.status, OPEN_STATUSES));
      if (!opts.type) conds.push(eq(invoices.invoiceType, "invoice"));
      if (opts.status === "overdue") {
        conds.push(
          sql`${invoices.dueDate} IS NOT NULL AND ${invoices.dueDate}::date < (now() AT TIME ZONE 'Asia/Dubai')::date`
        );
      }
    } else if (opts.status) {
      conds.push(eq(invoices.status, opts.status));
    }
    if (opts.type) conds.push(eq(invoices.invoiceType, opts.type));
    if (opts.cursor) {
      let createdAt: Date | null = null;
      let cursorTs = "";
      let id = "";
      try {
        const raw = Buffer.from(opts.cursor, "base64url").toString("utf8");
        const [ts, rid] = raw.split("|");
        createdAt = /^\d{4}-\d{2}-\d{2}[ T][\d:.]+$/.test(ts ?? "") ? new Date(`${ts}Z`) : null;
        cursorTs = ts ?? "";
        id = rid ?? "";
      } catch {
        createdAt = null;
      }
      if (!createdAt || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
        throw new DomainError("INVALID_CURSOR", 400);
      }
      conds.push(
        sql`(${invoices.createdAt}, ${invoices.id}) < (${cursorTs}::timestamp, ${id}::uuid)`
      );
    }
    const { einvoiceXml: _x, einvoiceHash: _h, ...cols } = getTableColumns(invoices);
    const rows = await db
      .select({ ...cols, cursorTs: sql<string>`${invoices.createdAt}::text` })
      .from(invoices)
      .where(and(...conds))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > opts.limit && last
        ? Buffer.from(`${last.cursorTs}|${last.id}`, "utf8").toString("base64url")
        : null;
    const items = page.map(
      ({ cursorTs: _c, ...rest }: { cursorTs: string } & Record<string, unknown>) => rest
    ) as Omit<Invoice, "einvoiceXml" | "einvoiceHash">[];
    return { items, nextCursor };
  }

  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db.insert(invoices).values(insertInvoice).returning();
    return invoice;
  }

  async updateInvoice(
    id: string,
    companyId: string,
    data: Partial<InsertInvoice>
  ): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set(data)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .returning();
    if (!invoice) {
      throw new Error("Invoice not found");
    }
    return invoice;
  }

  async updateInvoiceStatus(id: string, companyId: string, status: string): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set({ status })
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .returning();

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    return invoice;
  }

  async deleteInvoice(id: string, companyId: string): Promise<void> {
    await db.delete(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
  }

  async getInvoiceByShareToken(token: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.shareToken, token));
    return invoice || undefined;
  }

  async setInvoiceShareToken(id: string, token: string, expiresAt: Date): Promise<void> {
    await db
      .update(invoices)
      .set({ shareToken: token, shareTokenExpiresAt: expiresAt })
      .where(eq(invoices.id, id));
  }

  // Invoice Lines
  async createInvoiceLine(insertLine: InsertInvoiceLine): Promise<InvoiceLine> {
    const [line] = await db.insert(invoiceLines).values(insertLine).returning();
    return line;
  }

  async getInvoiceLinesByInvoiceId(invoiceId: string): Promise<InvoiceLine[]> {
    return await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  }

  async getInvoiceLinesByInvoiceIds(invoiceIds: string[]): Promise<InvoiceLine[]> {
    if (invoiceIds.length === 0) return [];
    return await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds));
  }

  async deleteInvoiceLinesByInvoiceId(invoiceId: string): Promise<void> {
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
  }

  // Quotes
  async getQuotesByCompanyId(companyId: string): Promise<Quote[]> {
    return await db
      .select()
      .from(quotes)
      .where(eq(quotes.companyId, companyId))
      .orderBy(desc(quotes.createdAt));
  }

  async getQuote(id: string): Promise<Quote | undefined> {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    return quote;
  }

  async createQuote(data: InsertQuote): Promise<Quote> {
    const [quote] = await db.insert(quotes).values(data).returning();
    return quote;
  }

  async updateQuote(id: string, data: Partial<InsertQuote>): Promise<Quote | undefined> {
    const [quote] = await db
      .update(quotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(quotes.id, id))
      .returning();
    return quote;
  }

  async deleteQuote(id: string): Promise<void> {
    await db.delete(quotes).where(eq(quotes.id, id));
  }

  async getQuoteLinesByQuoteId(quoteId: string): Promise<QuoteLine[]> {
    return await db.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId));
  }

  async createQuoteLine(data: InsertQuoteLine): Promise<QuoteLine> {
    const [line] = await db.insert(quoteLines).values(data).returning();
    return line;
  }

  async deleteQuoteLinesByQuoteId(quoteId: string): Promise<void> {
    await db.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
  }

  // Credit notes
  async getCreditNotesByCompanyId(companyId: string): Promise<CreditNote[]> {
    return await db
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.companyId, companyId))
      .orderBy(desc(creditNotes.createdAt));
  }

  async getCreditNote(id: string): Promise<CreditNote | undefined> {
    const [note] = await db.select().from(creditNotes).where(eq(creditNotes.id, id)).limit(1);
    return note;
  }

  async createCreditNote(data: InsertCreditNote): Promise<CreditNote> {
    const [note] = await db.insert(creditNotes).values(data).returning();
    return note;
  }

  async updateCreditNote(
    id: string,
    data: Partial<InsertCreditNote>
  ): Promise<CreditNote | undefined> {
    const [note] = await db
      .update(creditNotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(creditNotes.id, id))
      .returning();
    return note;
  }

  async deleteCreditNote(id: string): Promise<void> {
    await db.delete(creditNotes).where(eq(creditNotes.id, id));
  }

  async getCreditNoteLinesByCreditNoteId(creditNoteId: string): Promise<CreditNoteLine[]> {
    return await db
      .select()
      .from(creditNoteLines)
      .where(eq(creditNoteLines.creditNoteId, creditNoteId));
  }

  async createCreditNoteLine(data: InsertCreditNoteLine): Promise<CreditNoteLine> {
    const [line] = await db.insert(creditNoteLines).values(data).returning();
    return line;
  }

  async deleteCreditNoteLinesByCreditNoteId(creditNoteId: string): Promise<void> {
    await db.delete(creditNoteLines).where(eq(creditNoteLines.creditNoteId, creditNoteId));
  }

  // Recurring Invoices
  async getRecurringInvoicesByCompanyId(companyId: string): Promise<RecurringInvoice[]> {
    return await db
      .select()
      .from(recurringInvoices)
      .where(eq(recurringInvoices.companyId, companyId))
      .orderBy(desc(recurringInvoices.createdAt));
  }

  async getRecurringInvoice(id: string): Promise<RecurringInvoice | undefined> {
    const [item] = await db.select().from(recurringInvoices).where(eq(recurringInvoices.id, id));
    return item || undefined;
  }

  async getDueRecurringInvoices(): Promise<RecurringInvoice[]> {
    return await db
      .select()
      .from(recurringInvoices)
      .where(
        and(eq(recurringInvoices.isActive, true), lte(recurringInvoices.nextRunDate, new Date()))
      );
  }

  async fetchAndLockNextDueRecurringInvoice(
    tx: typeof db,
    excludeIds: string[] = []
  ): Promise<RecurringInvoice | undefined> {
    // Pessimistic row lock with SKIP LOCKED — concurrent cron runners see
    // the row as "unavailable" rather than the same row twice. Eliminates
    // the throwaway-invoice + safeDeleteInvoice pattern that left holes in
    // the FTA-required sequential allocator.
    //
    // `excludeIds` skips templates the caller has already visited in this
    // cron tick. Without this, a period-locked or errored template stays
    // "earliest due" and the scheduler would re-fetch it on every loop
    // iteration, starving later due templates.
    // W3-A: the excluded ids are bound one parameter each (a JS array bound
    // to `::uuid[]` failed, and the scheduler then spun on the same error),
    // and the locked row is re-read through Drizzle so the template comes
    // back camelCased (raw SELECT * rows are snake_case: linesJson was
    // undefined and every template was disabled as "invalid").
    const exclude =
      excludeIds.length === 0
        ? sql``
        : sql`AND id NOT IN (${sql.join(
            excludeIds.map((id) => sql`${id}::uuid`),
            sql`, `
          )})`;
    const result = await tx.execute(sql`
      SELECT id FROM recurring_invoices
      WHERE is_active = true
        AND next_run_date <= now()
        ${exclude}
      ORDER BY next_run_date ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    const rows = rowsFromResult<{ id: string }>(result);
    if (!rows[0]) return undefined;
    const [template] = await tx
      .select()
      .from(recurringInvoices)
      .where(eq(recurringInvoices.id, rows[0].id));
    return template;
  }

  async createRecurringInvoice(data: InsertRecurringInvoice): Promise<RecurringInvoice> {
    const [item] = await db.insert(recurringInvoices).values(data).returning();
    return item;
  }

  async updateRecurringInvoice(
    id: string,
    data: Partial<RecurringInvoice>
  ): Promise<RecurringInvoice> {
    const [item] = await db
      .update(recurringInvoices)
      .set(data)
      .where(eq(recurringInvoices.id, id))
      .returning();
    if (!item) {
      throw new Error("Recurring invoice not found");
    }
    return item;
  }

  async deleteRecurringInvoice(id: string): Promise<void> {
    await db.delete(recurringInvoices).where(eq(recurringInvoices.id, id));
  }

  // Invoice Payments
  async getInvoicePaymentsByInvoiceId(invoiceId: string): Promise<InvoicePayment[]> {
    return await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId))
      .orderBy(desc(invoicePayments.createdAt));
  }

  async getInvoicePaymentsByCompanyId(companyId: string): Promise<InvoicePayment[]> {
    return await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.companyId, companyId))
      .orderBy(desc(invoicePayments.createdAt));
  }

  async createInvoicePayment(data: InsertInvoicePayment): Promise<InvoicePayment> {
    const [payment] = await db.insert(invoicePayments).values(data).returning();
    return payment;
  }

  async getJournalEntriesBySource(
    companyId: string,
    source: string,
    sourceId: string
  ): Promise<JournalEntry[]> {
    return await db
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.companyId, companyId),
          eq(journalEntries.source, source),
          eq(journalEntries.sourceId, sourceId)
        )
      );
  }

  async recordInvoicePayment(input: {
    invoiceId: string;
    companyId: string;
    amount: number;
    date: Date;
    method: string;
    reference: string | null;
    notes: string | null;
    paymentAccountId: string;
    paymentAccountCurrency?: string | null;
    /** A-B5: AED-per-unit rate on the payment date; enables realised FX and
     *  cross-currency settlement. Null = settle at the invoice rate (no FX). */
    paymentExchangeRate?: number | null;
    receivableAccountId: string;
    createdBy: string;
    /** Guard against silent overpayment. An amount exceeding the outstanding
     *  balance is only booked as a customer advance when the caller explicitly
     *  opts in. Without this flag, an over-balance payment is rejected so a
     *  fat-fingered figure cannot post a phantom liability. */
    allowCredit?: boolean;
  }): Promise<{
    payment: InvoicePayment;
    invoice: Invoice;
    journalEntryId: string;
    totalPaid: number;
  }> {
    return await db.transaction(async (tx: typeof db) => {
      // Lock the invoice row. Concurrent payment writers will queue here.
      const lockResult = await tx.execute(sql`
        SELECT id, company_id, currency, total, status, number, exchange_rate
        FROM invoices
        WHERE id = ${input.invoiceId}
        FOR UPDATE
      `);
      const lockedRows = rowsFromResult<{
        id: string;
        company_id: string;
        currency: string;
        total: number;
        status: string;
        number?: string;
        exchange_rate?: number | string | null;
      }>(lockResult);
      const lockedInvoice = lockedRows[0];
      if (!lockedInvoice) {
        const e: Error & { code?: string; details?: unknown } = new Error("Invoice not found");
        e.code = "INVOICE_NOT_FOUND";
        throw e;
      }
      if (lockedInvoice.company_id !== input.companyId) {
        const e: Error & { code?: string; details?: unknown } = new Error(
          "Invoice does not belong to company"
        );
        e.code = "INVOICE_COMPANY_MISMATCH";
        throw e;
      }
      if (isTerminal(lockedInvoice.status)) {
        const e: Error & { code?: string; details?: unknown } = new Error(
          `Cannot record payment on ${lockedInvoice.status} invoice`
        );
        e.code = "INVOICE_TERMINAL";
        throw e;
      }
      // A-B5: a currency mismatch is allowed when an explicit payment-date rate
      // is supplied (cross-currency settlement, e.g. paying a USD invoice from
      // an AED bank account) — the rate converts the cash and realised FX is
      // posted. Without a rate we keep the strict guard.
      const hasPaymentRate = !!(input.paymentExchangeRate && input.paymentExchangeRate > 0);
      if (
        input.paymentAccountCurrency &&
        input.paymentAccountCurrency !== lockedInvoice.currency &&
        !hasPaymentRate
      ) {
        const e: Error & { code?: string; details?: unknown } = new Error(
          `Payment account currency (${input.paymentAccountCurrency}) does not match invoice currency (${lockedInvoice.currency})`
        );
        e.code = "CURRENCY_MISMATCH";
        throw e;
      }

      // Sum existing settlements INSIDE the lock so we see the canonical figure:
      // the one settlement rule (server/reporting/settlement.ts, D5c) — payments,
      // issued credit notes and applied customer credits.
      const parts = receivableSettlementPartsSql("si");
      const sumResult = await tx.execute(sql`
        SELECT ${sql.raw(parts.paid)} AS paid,
               ${sql.raw(parts.credited)} AS credited,
               ${sql.raw(parts.applied)} AS applied
          FROM (SELECT ${input.invoiceId}::uuid AS id) si
      `);
      const sumRows = rowsFromResult<{
        paid: number | string;
        credited: number | string;
        applied: number | string;
      }>(sumResult);

      // Decimal.js comparison so summing many payments cannot drift past
      // the invoice total via binary-float error and silently overpay.
      const totalD = new Decimal(lockedInvoice.total);
      const previouslyPaidD = new Decimal(sumRows[0]?.paid ?? 0);
      const creditedD = new Decimal(sumRows[0]?.credited ?? 0).plus(sumRows[0]?.applied ?? 0);
      const amountD = new Decimal(input.amount);
      const remainingD = totalD.minus(previouslyPaidD).minus(creditedD);

      // A-B12: split the payment into the part that clears the receivable and
      // any excess that becomes a customer credit (a liability), rather than
      // rejecting overpayments outright. The excess is parked in Deferred
      // Revenue / Customer Advances (account 2050). If that account is not in
      // the chart we fall back to the previous hard rejection so we never post
      // an unbalanced or mis-classified entry.
      const allocation = allocatePayment({
        amount: amountD.toNumber(),
        remaining: remainingD.toNumber(),
        tolerance: 0.005,
      });
      // Guard: refuse to turn an over-balance payment into a customer advance
      // unless the caller explicitly opted in. This stops a mistyped amount
      // (e.g. 100000 instead of 1000.00) from silently posting a large,
      // unrecoverable liability with a success response.
      if (allocation.customerCredit > 0 && !input.allowCredit) {
        const e: Error & { code?: string; details?: unknown } = new Error(
          `Payment ${amountD.toFixed(2)} exceeds the outstanding balance ${remainingD.toFixed(2)}. ` +
            `Re-send with allowCredit=true to record the excess as a customer advance.`
        );
        e.code = "PAYMENT_EXCEEDS_BALANCE";
        e.details = { balance: remainingD.toNumber(), attempted: amountD.toNumber() };
        throw e;
      }
      let customerCreditAccountId: string | null = null;
      if (allocation.customerCredit > 0) {
        const advanceRows = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.companyId, input.companyId),
              eq(accounts.code, ACCOUNT_CODES.DEFERRED_REVENUE)
            )
          );
        customerCreditAccountId = advanceRows[0]?.id ?? null;
        if (!customerCreditAccountId) {
          const e: Error & { code?: string; details?: unknown } = new Error(
            `Payment ${amountD.toFixed(2)} exceeds remaining balance ${remainingD.toFixed(2)} ` +
              `and no customer-advance account (${ACCOUNT_CODES.DEFERRED_REVENUE}) exists to hold the overpayment`
          );
          e.code = "OVERPAYMENT";
          throw e;
        }
      }

      // A-B5/A-B12: compute the balanced legs via the tested pure builder. AR
      // clears at the invoice rate; cash at the payment-date rate (when one is
      // supplied — else the invoice rate, i.e. no FX, identical to before).
      const invRate =
        Number(lockedInvoice.exchange_rate) > 0 ? Number(lockedInvoice.exchange_rate) : 1;
      const payRate = hasPaymentRate ? Number(input.paymentExchangeRate) : invRate;
      // Resolve FX gain/loss accounts only when a differing payment rate could
      // produce realised FX (avoids a lookup on the common same-rate path).
      let fxGainAccountId: string | null = null;
      let fxLossAccountId: string | null = null;
      if (hasPaymentRate && Math.abs(payRate - invRate) > 1e-9) {
        const fxRows = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.companyId, input.companyId),
              inArray(accounts.code, [ACCOUNT_CODES.FX_GAIN, ACCOUNT_CODES.FX_LOSS])
            )
          );
        fxGainAccountId = fxRows.find((a) => a.code === ACCOUNT_CODES.FX_GAIN)?.id ?? null;
        fxLossAccountId = fxRows.find((a) => a.code === ACCOUNT_CODES.FX_LOSS)?.id ?? null;
      }
      // W3-A (R03-22): a payment that settles the invoice in full clears the
      // exact A/R residual on the ledger (foreign invoices: rounding on earlier
      // credit notes / part payments would otherwise leave a fils behind).
      let receivableCreditAedOverride: number | null = null;
      const settlesInFull = remainingD.minus(allocation.appliedToReceivable).abs().lte(0.005);
      // W5-C (R14-19): foreign means "not the company's functional currency".
      const companyBase = await loadBaseCurrency(input.companyId, tx);
      const isForeignInvoice = isForeignCurrency(lockedInvoice.currency, companyBase);
      if (settlesInFull && isForeignInvoice) {
        const residual = await tx.execute(sql`
          WITH docs AS (
            SELECT je.id FROM journal_entries je
             WHERE je.company_id = ${input.companyId} AND je.status = 'posted' AND (
                   (je.source = 'invoice' AND je.source_id = ${input.invoiceId})
                OR (je.source = 'invoice' AND je.source_id IN (
                      SELECT id FROM invoices WHERE original_invoice_id = ${input.invoiceId}
                         AND invoice_type = 'credit_note'))
                OR (je.source = 'payment' AND je.source_id = ${input.invoiceId})
                OR (je.source = 'customer_credit' AND je.source_id IN (
                      SELECT id FROM customer_credit_allocations WHERE invoice_id = ${input.invoiceId})))
          )
          SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS residual
            FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
           WHERE jl.account_id = ${input.receivableAccountId} AND je.status = 'posted'
             AND (je.id IN (SELECT id FROM docs)
                  OR (je.source = 'reversal' AND je.source_id IN (SELECT id FROM docs)))
        `);
        const r = Number(rowsFromResult<{ residual: string }>(residual)[0]?.residual);
        if (Number.isFinite(r) && r > 0) receivableCreditAedOverride = r;
      }
      if (receivableCreditAedOverride !== null && !fxGainAccountId && !fxLossAccountId) {
        const fxRows = await tx
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.companyId, input.companyId),
              inArray(accounts.code, [ACCOUNT_CODES.FX_GAIN, ACCOUNT_CODES.FX_LOSS])
            )
          );
        fxGainAccountId = fxRows.find((a) => a.code === ACCOUNT_CODES.FX_GAIN)?.id ?? null;
        fxLossAccountId = fxRows.find((a) => a.code === ACCOUNT_CODES.FX_LOSS)?.id ?? null;
      }
      const built = buildPaymentJournalLines({
        receivableCreditAedOverride,
        appliedToReceivable: allocation.appliedToReceivable,
        customerCredit: allocation.customerCredit,
        invoiceRate: invRate,
        paymentRate: payRate,
        paymentAccountId: input.paymentAccountId,
        receivableAccountId: input.receivableAccountId,
        customerCreditAccountId,
        fxGainAccountId,
        fxLossAccountId,
        label: `Invoice ${lockedInvoice.number || input.invoiceId}`,
      });
      if (!built.ok) {
        const e: Error & { code?: string; details?: unknown } = new Error(built.message);
        e.code = built.code;
        throw e;
      }

      // W3-A: posted through the ledger kernel inside this transaction (exact
      // fils balance, account/period guards, in-transaction numbering). The
      // payment date is the journal date (R03-13).
      const foreignCur = isForeignInvoice ? lockedInvoice.currency.toUpperCase() : null;
      const { entry } = await postJournal(
        {
          companyId: input.companyId,
          date: input.date.toISOString().slice(0, 10),
          memo: `Payment received for Invoice ${lockedInvoice.number || input.invoiceId} - ${input.method}`,
          status: "posted",
          source: "payment",
          sourceId: input.invoiceId,
          allowFutureDate: true,
          lines: built.lines.map((l) => {
            const isAr = l.accountId === input.receivableAccountId && l.credit > 0;
            // W5-C (R14-16): the cash leg carries the foreign amount received so a
            // foreign-currency bank account reports its balance in its own currency.
            const isCash = l.accountId === input.paymentAccountId && l.debit > 0;
            return {
              accountId: l.accountId,
              debit: l.debit > 0 ? l.debit.toFixed(2) : undefined,
              credit: l.credit > 0 ? l.credit.toFixed(2) : undefined,
              description: l.description,
              ...(foreignCur && isAr
                ? {
                    foreignCurrency: foreignCur,
                    foreignCredit: new Decimal(allocation.appliedToReceivable).toFixed(2),
                    exchangeRate: String(invRate),
                  }
                : {}),
              ...(foreignCur && isCash
                ? {
                    foreignCurrency: foreignCur,
                    foreignDebit: amountD.toFixed(2),
                    exchangeRate: String(payRate),
                  }
                : {}),
            };
          }),
        },
        { actorId: input.createdBy, tx }
      );

      // Record the payment row.
      const [payment] = await tx
        .insert(invoicePayments)
        .values({
          invoiceId: input.invoiceId,
          companyId: input.companyId,
          amount: input.amount,
          date: input.date,
          method: input.method,
          reference: input.reference,
          notes: input.notes,
          paymentAccountId: input.paymentAccountId,
          exchangeRate: hasPaymentRate ? payRate : null,
          journalEntryId: entry.id,
          createdBy: input.createdBy,
        })
        .returning();

      // W3-A: an overpayment is a customer credit that can be applied to a
      // later invoice or refunded (customer_credits, liability 2050).
      if (allocation.customerCredit > 0 && customerCreditAccountId) {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId));
        await tx.insert(customerCredits).values({
          companyId: input.companyId,
          contactId: inv?.contactId ?? null,
          customerName: inv?.customerName ?? "",
          sourceType: "overpayment",
          sourceId: payment.id,
          invoiceId: input.invoiceId,
          currency: lockedInvoice.currency || "AED",
          exchangeRate: payRate,
          liabilityAccountId: customerCreditAccountId,
          amount: allocation.customerCredit,
          remaining: allocation.customerCredit,
          status: "open",
          createdBy: input.createdBy,
        });
      }

      // Recompute status from the canonical settled total (post-insert).
      const newTotalPaid = previouslyPaidD.plus(amountD).toNumber();
      const newStatus = statusFromPayments(
        lockedInvoice.status as InvoiceStatus,
        Number(lockedInvoice.total),
        new Decimal(newTotalPaid).plus(creditedD).toNumber()
      );
      const [updatedInvoice] = await tx
        .update(invoices)
        .set({ status: newStatus })
        .where(eq(invoices.id, input.invoiceId))
        .returning();

      // When the invoice transitions to fully paid, stamp paidAt on every
      // open chase row for it. This is what makes the chase effectiveness
      // dashboard work — without it, conversionRate is permanently 0.
      // Done inside the same txn so a payment write can't leave chase
      // analytics inconsistent with invoice state.
      if (newStatus === "paid") {
        await tx
          .update(paymentChases)
          .set({ paidAt: input.date })
          .where(and(eq(paymentChases.invoiceId, input.invoiceId), isNull(paymentChases.paidAt)));
      }

      return {
        payment,
        invoice: updatedInvoice,
        journalEntryId: entry.id,
        totalPaid: newTotalPaid,
      };
    });
  }

  async safeDeleteInvoice(id: string): Promise<void> {
    await db.transaction(async (tx: typeof db) => {
      // Read invoice for company scope
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
      if (!inv) {
        const e: Error & { code?: string; details?: unknown } = new Error("Invoice not found");
        e.code = "INVOICE_NOT_FOUND";
        throw e;
      }

      // Find associated journal entries (any source — invoice or payment).
      const associatedEntries = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, inv.companyId), eq(journalEntries.sourceId, id)));

      // Refuse if any are posted — caller must void instead.
      const posted = associatedEntries.filter((e) => e.status === "posted");
      if (posted.length > 0) {
        const err: Error & { code?: string; details?: unknown } = new Error(
          "Cannot delete invoice with posted journal entries. Void the invoice instead."
        );
        err.code = "INVOICE_HAS_POSTED_JE";
        throw err;
      }

      // Order matters: invoice_payments references journal_entries, and
      // invoices cascades to invoice_payments. Drop the invoice first so
      // payment rows are gone before we drop the JEs they referenced.
      await tx.delete(invoices).where(eq(invoices.id, id));
      for (const e of associatedEntries) {
        await tx.delete(journalEntries).where(eq(journalEntries.id, e.id));
      }
    });
  }

  async getInvoicePaidTotal(invoiceId: string): Promise<number> {
    const payments = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId));
    return payments.reduce((sum: number, p: InvoicePayment) => sum + p.amount, 0);
  }

  async getDueInvoicesForRecurring(): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.isRecurring, true), lte(invoices.nextRecurringDate, new Date())));
  }
}
