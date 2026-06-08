import crypto from 'crypto';
import Decimal from 'decimal.js';
import { and,eq,sql } from 'drizzle-orm';
import { type Express,type Request,type Response } from 'express';
import { z } from 'zod';
import {
invoiceLines as invoiceLinesTable,invoices as invoicesTable,journalEntries as journalEntriesTable,
journalEntryNumberSequences,
journalLines as journalLinesTable,type Invoice
} from '../../shared/schema';
import { createLogger } from '../config/logger';
import { ACCOUNT_CODES,UAE_VAT_RATE } from '../constants';
import { db } from '../db';
import { authMiddleware,requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { recordAudit } from '../services/audit.service';
import { generateEInvoiceXML } from '../services/einvoice.service';
import { hasSmtpConfig,sendInvoiceEmail,sendPaymentReminderEmail } from '../services/email.service';
import { allocateInvoiceNumber,peekNextInvoiceNumber } from '../services/invoice-numbering.service';
import { canTransition,isTerminal,isValidStatus } from '../services/invoice-state-machine';
import { generateInvoicePDF } from '../services/pdf-invoice.service';
import { assertPeriodNotLocked } from '../services/period-lock.service';
import { assertRetentionExpired } from '../services/retention.service';
import { createAndEmitNotification } from '../services/socket.service';
import { storage } from '../storage';

const log = createLogger('invoices');

const emirateSchema = z.enum([
  'abu_dhabi',
  'dubai',
  'sharjah',
  'ajman',
  'umm_al_quwain',
  'ras_al_khaimah',
  'fujairah',
]);

// Walk the user's companies to find the invoice. Storage queries are
// tenant-scoped, so a hit also proves the user has access.
async function findInvoiceForUser(userId: string, invoiceId: string): Promise<Invoice | undefined> {
  const userCompanies = await storage.getCompaniesByUserId(userId);
  for (const c of userCompanies) {
    const invoice = await storage.getInvoice(invoiceId, c.id);
    if (invoice) return invoice;
  }
  return undefined;
}

const invoiceLineInputSchema = z.object({
  description: z.string().trim().min(1, 'Line description is required').max(1000),
  quantity: z.coerce.number().finite().positive('Line quantity must be greater than 0'),
  unitPrice: z.coerce.number().finite().positive('Line unit price must be greater than 0'),
  vatRate: z.coerce.number().finite().min(0).max(1).default(UAE_VAT_RATE),
  supplyEmirate: emirateSchema.optional(),
});

const invoiceLinesInputSchema = z.array(invoiceLineInputSchema).min(1, 'At least one invoice line is required');

type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

function calculateInvoiceTotals(lines: InvoiceLineInput[]) {
  let subtotalD = new Decimal(0);
  let vatAmountD = new Decimal(0);

  for (const line of lines) {
    const lineTotal = new Decimal(line.unitPrice).times(line.quantity);
    subtotalD = subtotalD.plus(lineTotal);
    vatAmountD = vatAmountD.plus(
      lineTotal.times(line.vatRate ?? UAE_VAT_RATE),
    );
  }

  return {
    subtotal: subtotalD.toDecimalPlaces(2).toNumber(),
    vatAmount: vatAmountD.toDecimalPlaces(2).toNumber(),
    total: subtotalD.plus(vatAmountD).toDecimalPlaces(2).toNumber(),
  };
}

function positiveExchangeRate(rawRate: unknown): number {
  const rate = Number(rawRate ?? 1);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Exchange rate must be a positive number');
  }
  return rate;
}

function toBaseCurrencyAmount(amount: number, currency: string, exchangeRate: number): number {
  const amountD = new Decimal(amount || 0);
  return (currency || 'AED') === 'AED'
    ? amountD.toDecimalPlaces(2).toNumber()
    : amountD.times(exchangeRate).toDecimalPlaces(2).toNumber();
}

function withForeignAmount(
  currency: string,
  exchangeRate: number,
  foreignDebit: number,
  foreignCredit: number,
) {
  if ((currency || 'AED') === 'AED') {
    return { foreignDebit: 0, foreignCredit: 0, exchangeRate: 1 };
  }
  return {
    foreignCurrency: currency,
    foreignDebit,
    foreignCredit,
    exchangeRate,
  };
}

async function allocateJournalEntryNumberInTransaction(
  companyId: string,
  date: Date,
  tx: typeof db,
): Promise<string> {
  const dateKey = date.toISOString().slice(0, 10);
  const prefix = `JE-${dateKey.replace(/-/g, '')}`;
  const [seq] = await tx
    .insert(journalEntryNumberSequences)
    .values({ companyId, entryDate: dateKey, lastValue: 1 })
    .onConflictDoUpdate({
      target: [
        journalEntryNumberSequences.companyId,
        journalEntryNumberSequences.entryDate,
      ],
      set: {
        lastValue: sql`${journalEntryNumberSequences.lastValue} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastValue: journalEntryNumberSequences.lastValue });
  return `${prefix}-${String(seq.lastValue).padStart(3, '0')}`;
}

export function registerInvoiceRoutes(app: Express) {
  // =====================================
  // Invoice Routes
  // =====================================

  // Customer-only: Full bookkeeping invoices (clients use simplified portal)
  app.get("/api/companies/:companyId/invoices", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    // Verify company access
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Use the trimmed projection so list responses don't carry full UBL XML
    // (einvoice_xml can be 10-50KB per row). The detail endpoint pulls the
    // full record on demand. limit/offset accept optional pagination.
    const limit = Math.min(Number(req.query.limit) || 1000, 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const invoices = await storage.getInvoicesSummaryByCompanyId(companyId, { limit, offset });
    res.json(invoices);
  }));

  // Customer-only: Get single invoice
  app.get("/api/invoices/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const invoice = await findInvoiceForUser(userId, id);

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Fetch invoice lines
    const lines = await storage.getInvoiceLinesByInvoiceId(id);

    res.json({ ...invoice, lines });
  }));

  // Check for similar invoices
  // Customer-only: Check for similar invoices
  app.post("/api/companies/:companyId/invoices/check-similar", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;
    const { customerName, total, date } = req.body;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const invoices = await storage.getInvoicesByCompanyId(companyId);

    // Find similar invoices
    const similarInvoices = invoices.filter(invoice => {
      // Check if customer name is similar (case-insensitive partial match)
      const customerMatch = customerName && invoice.customerName &&
        invoice.customerName.toLowerCase().includes(customerName.toLowerCase()) ||
        customerName.toLowerCase().includes(invoice.customerName?.toLowerCase() || '');

      // Check if total is within 10% range
      const amountMatch = total && invoice.total &&
        Math.abs(invoice.total - total) / total < 0.1;

      // Check if date is within 7 days
      let dateMatch = false;
      if (date && invoice.date) {
        const checkDate = new Date(date);
        const invoiceDate = new Date(invoice.date);
        const daysDiff = Math.abs((checkDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
        dateMatch = daysDiff <= 7;
      }

      // Return if at least 2 criteria match
      const matchCount = [customerMatch, amountMatch, dateMatch].filter(Boolean).length;
      return matchCount >= 2;
    });

    res.json({
      hasSimilar: similarInvoices.length > 0,
      similarInvoices: similarInvoices.slice(0, 5).map(invoice => ({
        id: invoice.id,
        number: invoice.number,
        customerName: invoice.customerName,
        total: invoice.total,
        date: invoice.date,
        status: invoice.status,
      })),
    });
  }));

  // Peek next invoice/credit-note number — for UI display before save. Does
  // not allocate, so it is safe to call from a draft form.
  app.get("/api/companies/:companyId/invoices/next-number", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;
    const docType = (req.query.docType === 'credit_note' ? 'credit_note' : 'invoice') as 'invoice' | 'credit_note';

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const number = await peekNextInvoiceNumber(companyId, docType);
    res.json({ number, docType });
  }));

  // Customer-only: Create invoices
  app.post("/api/companies/:companyId/invoices", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;
    const { lines, date, ...invoiceData } = req.body;
    const parsedLines = invoiceLinesInputSchema.parse(lines);

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const company = await storage.getCompany(companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    const defaultSupplyEmirate = company.emirate || 'dubai';

    // Calculate totals using decimal.js to avoid binary-float drift on
    // NUMERIC(15,2) columns. Sums are kept as Decimal until the very end.
    const { subtotal, vatAmount, total } = calculateInvoiceTotals(parsedLines);
    const invoiceCurrency = (invoiceData.currency || 'AED').toString();
    let exchangeRate: number;
    try {
      exchangeRate = positiveExchangeRate(invoiceData.exchangeRate ?? 1);
    } catch (err: any) {
      return res.status(400).json({ message: err.message, code: 'INVALID_EXCHANGE_RATE' });
    }
    const baseSubtotal = toBaseCurrencyAmount(subtotal, invoiceCurrency, exchangeRate);
    const baseVatAmount = toBaseCurrencyAmount(vatAmount, invoiceCurrency, exchangeRate);
    const baseTotal = toBaseCurrencyAmount(total, invoiceCurrency, exchangeRate);

    // Convert date string to Date object if it's a string
    const invoiceDate = typeof date === 'string' ? new Date(date) : date;

    // Block invoice creation in a locked period — invoice creation immediately
    // posts a revenue-recognition journal entry on this date.
    await assertPeriodNotLocked(companyId, invoiceDate);
    const accounts = await storage.getAccountsByCompanyId(companyId);
    const accountsReceivable = accounts.find(a => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
    const salesRevenue = accounts.find(
      a => a.isSystemAccount && a.type === 'income' && (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT)
    );
    const vatPayable = accounts.find(a => a.isVatAccount && a.vatType === 'output' && a.code === ACCOUNT_CODES.VAT_OUTPUT);
    if (!accountsReceivable || !salesRevenue || (vatAmount > 0 && !vatPayable)) {
      return res.status(500).json({ message: 'Required system accounts are missing for invoice posting' });
    }

    // FTA requires sequential, gap-free invoice numbering. We MUST allocate
    // and insert the invoice in a single transaction — otherwise a failed
    // insert after a successful allocation burns the number permanently and
    // the next allocation produces a gap (FTA Article 78 violation).
    const { invoice, entryNumber } = await db.transaction(async (tx: typeof db) => {
      const number = await allocateInvoiceNumber(companyId, 'invoice', invoiceDate, tx);

      log.info({
        companyId,
        userId,
        number,
        clientSuppliedNumber: invoiceData.number,
        date: invoiceDate,
        subtotal,
        vatAmount,
        total,
        linesCount: parsedLines.length,
      }, 'Creating invoice');

      const [insertedInvoice] = await tx
        .insert(invoicesTable)
        .values({
          ...invoiceData,
          number,
          date: invoiceDate,
          companyId,
          currency: invoiceCurrency,
          exchangeRate,
          baseCurrencyAmount: baseTotal,
          subtotal,
          vatAmount,
          total,
        })
        .returning();

      for (const line of parsedLines) {
        await tx.insert(invoiceLinesTable).values({
          invoiceId: insertedInvoice.id,
          ...line,
          supplyEmirate: line.supplyEmirate || defaultSupplyEmirate,
        });
      }

      const journalLines: Array<{
        accountId: string;
        debit: number;
        credit: number;
        description: string;
        foreignCurrency?: string;
        foreignDebit?: number;
        foreignCredit?: number;
        exchangeRate?: number;
      }> = [
        {
          accountId: accountsReceivable.id,
          debit: baseTotal,
          credit: 0,
          description: `Invoice ${insertedInvoice.number} - ${insertedInvoice.customerName}`,
          ...withForeignAmount(invoiceCurrency, exchangeRate, total, 0),
        },
        {
          accountId: salesRevenue.id,
          debit: 0,
          credit: baseSubtotal,
          description: `Sales revenue - Invoice ${insertedInvoice.number}`,
          ...withForeignAmount(invoiceCurrency, exchangeRate, 0, subtotal),
        },
      ];
      if (vatAmount > 0 && vatPayable) {
        journalLines.push({
          accountId: vatPayable.id,
          debit: 0,
          credit: baseVatAmount,
          description: `VAT output - Invoice ${insertedInvoice.number}`,
          ...withForeignAmount(invoiceCurrency, exchangeRate, 0, vatAmount),
        });
      }

      const postingEntryNumber = await allocateJournalEntryNumberInTransaction(companyId, invoiceDate, tx);
      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          companyId: companyId,
          date: invoiceDate,
          memo: `Sales Invoice ${insertedInvoice.number} - ${insertedInvoice.customerName}`,
          entryNumber: postingEntryNumber,
          status: 'posted',
          source: 'invoice',
          sourceId: insertedInvoice.id,
          createdBy: userId,
          postedBy: userId,
          postedAt: invoiceDate,
        })
        .returning();
      for (const line of journalLines) {
        await tx.insert(journalLinesTable).values({ ...line, entryId: entry.id });
      }

      return { invoice: insertedInvoice, entryNumber: postingEntryNumber };
    });

    log.info({ entryNumber, invoiceId: invoice.id }, 'Revenue recognition journal entry created');

    log.info({ invoiceId: invoice.id }, 'Invoice created successfully');

    await recordAudit({
      userId,
      companyId,
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: invoice.id,
      before: null,
      after: {
        number: invoice.number,
        customerName: invoice.customerName,
        total: invoice.total,
        currency: invoice.currency,
        status: invoice.status,
      },
      req,
    });

    createAndEmitNotification({
      userId,
      companyId,
      type: 'invoice_created',
      title: 'Invoice created',
      message: `Invoice ${invoice.number} for ${invoice.customerName} — ${invoice.total} ${invoice.currency || 'AED'}`,
      priority: 'normal',
      relatedEntityType: 'invoice',
      relatedEntityId: invoice.id,
      actionUrl: '/invoices',
    }).catch(() => {});

    res.json(invoice);
  }));

  // Post invoice journal entries
  // Customer-only: Post invoice to journal
  app.post("/api/invoices/:id/post", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Tenant-scoped lookup also enforces access.
    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    const company = await storage.getCompany(invoice.companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    const _defaultSupplyEmirate = company.emirate || 'dubai';

    // Get all draft entries for this invoice
    const entries = await storage.getJournalEntriesByCompanyId(invoice.companyId);
    const invoiceEntries = entries.filter(e => e.sourceId === id && e.status === 'draft');

    if (invoiceEntries.length === 0) {
      return res.status(400).json({ message: 'No draft entries to post' });
    }

    // Block posting any draft entry into a locked period.
    for (const entry of invoiceEntries) {
      await assertPeriodNotLocked(invoice.companyId, entry.date);
    }

    // Post all draft entries
    for (const entry of invoiceEntries) {
      await storage.updateJournalEntry(entry.id, invoice.companyId, {
        status: 'posted',
        postedBy: userId,
        postedAt: new Date(),
      });
    }

    res.json({ message: 'Invoice entries posted successfully', count: invoiceEntries.length });
  }));

  // Customer-only: Update invoice
  app.put("/api/invoices/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const { lines, date, ...invoiceData } = req.body;
    const parsedLines = invoiceLinesInputSchema.parse(lines);

    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    const company = await storage.getCompany(invoice.companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    const defaultSupplyEmirate = company.emirate || 'dubai';

    if (isTerminal(invoice.status)) {
      return res.status(422).json({
        message: `Cannot edit ${invoice.status} invoice`,
        code: 'INVOICE_TERMINAL',
      });
    }

    // Recompute totals from lines using decimal.js for precise money math.
    const { subtotal, vatAmount, total } = calculateInvoiceTotals(parsedLines);
    const invoiceCurrency = (invoiceData.currency || invoice.currency || 'AED').toString();
    let exchangeRate: number;
    try {
      exchangeRate = positiveExchangeRate(invoiceData.exchangeRate ?? invoice.exchangeRate ?? 1);
    } catch (err: any) {
      return res.status(400).json({ message: err.message, code: 'INVALID_EXCHANGE_RATE' });
    }
    const baseTotal = toBaseCurrencyAmount(total, invoiceCurrency, exchangeRate);

    // If a posted journal entry exists for this invoice and the amount is
    // changing, refuse. The user must void & reissue (or issue a credit
    // note) instead — silently re-posting the GL would break period-locked
    // ledgers and audit trails.
    const existingEntries = await storage.getJournalEntriesBySource(
      invoice.companyId,
      'invoice',
      id,
    );
    const postedEntry = existingEntries.find(e => e.status === 'posted');
    const totalsChanged =
      Math.abs(Number(invoice.total) - total) > 0.005 ||
      Math.abs(Number(invoice.subtotal) - subtotal) > 0.005 ||
      Math.abs(Number(invoice.vatAmount) - vatAmount) > 0.005;
    if (postedEntry && totalsChanged) {
      return res.status(422).json({
        message:
          'Invoice amount cannot be changed while a posted journal entry exists. Void this invoice and issue a credit note or new invoice instead.',
        code: 'INVOICE_POSTED_AMOUNT_LOCKED',
      });
    }

    const invoiceDate = typeof date === 'string' ? new Date(date) : date;

    // Block updates that would touch a locked period (either the invoice's
    // existing date or the requested new date).
    await assertPeriodNotLocked(invoice.companyId, invoice.date);
    if (invoiceDate) {
      await assertPeriodNotLocked(invoice.companyId, invoiceDate);
    }

    const updatedInvoice = await db.transaction(async (tx: typeof db) => {
      const [updated] = await tx
        .update(invoicesTable)
        .set({
          ...invoiceData,
          date: invoiceDate,
          currency: invoiceCurrency,
          exchangeRate,
          baseCurrencyAmount: baseTotal,
          subtotal,
          vatAmount,
          total,
          updatedAt: new Date(),
        })
        .where(and(eq(invoicesTable.id, id), eq(invoicesTable.companyId, invoice.companyId)))
        .returning();
      if (!updated) {
        throw new Error('Invoice not found');
      }

      await tx.delete(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, id));
      for (const line of parsedLines) {
        await tx.insert(invoiceLinesTable).values({
          invoiceId: id,
          ...line,
          supplyEmirate: line.supplyEmirate || defaultSupplyEmirate,
        });
      }
      return updated;
    });

    await recordAudit({
      userId,
      companyId: invoice.companyId,
      action: 'invoice.update',
      entityType: 'invoice',
      entityId: id,
      before: {
        subtotal: invoice.subtotal,
        vatAmount: invoice.vatAmount,
        total: invoice.total,
        date: invoice.date,
      },
      after: { subtotal, vatAmount, total, date: invoiceDate },
      req,
    });

    log.info({ id }, 'Invoice updated successfully');
    res.json(updatedInvoice);
  }));

  // Customer-only: Delete invoice
  app.delete("/api/invoices/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // FTA: 5-year retention. Throws RetentionViolationError → 409 via global handler.
    assertRetentionExpired(invoice as { createdAt: Date | string; retentionExpiresAt?: Date | string | null }, 'Invoice');

    try {
      await storage.safeDeleteInvoice(id);
    } catch (err: any) {
      if (err?.code === 'INVOICE_HAS_POSTED_JE') {
        return res.status(422).json({
          message: err.message,
          code: err.code,
        });
      }
      if (err?.code === 'INVOICE_NOT_FOUND') {
        return res.status(404).json({ message: err.message });
      }
      throw err;
    }

    await recordAudit({
      userId,
      companyId: invoice.companyId,
      action: 'invoice.delete',
      entityType: 'invoice',
      entityId: id,
      before: { number: invoice.number, status: invoice.status, total: invoice.total },
      after: null,
      req,
    });

    res.json({ message: 'Invoice deleted successfully' });
  }));

  // Customer-only: Update invoice status (state-machine enforced)
  app.patch("/api/invoices/:id/status", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, paymentAccountId } = req.body;
    const userId = (req as any).user.id;

    if (!status || !isValidStatus(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be one of: draft, sent, posted, partial, paid, void, cancelled',
      });
    }

    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const oldStatus = invoice.status;

    // Status transitions that post journal entries (currently only
    // draft/sent -> paid) must respect period locks. Use the invoice's
    // own date — that's the period the JE is being posted into — not the
    // wall-clock now, which can mismatch when paying historic invoices.
    if (status === 'paid' && oldStatus !== 'paid') {
      await assertPeriodNotLocked(invoice.companyId, invoice.date);
    }

    // No-op transition is fine.
    if (oldStatus !== status && !canTransition(oldStatus, status)) {
      return res.status(422).json({
        message: `Invalid invoice status transition: ${oldStatus} → ${status}`,
        code: 'INVALID_TRANSITION',
        allowed: { from: oldStatus, to: status },
      });
    }

    // 'paid' transition through this endpoint records the full payment via
    // the transactional helper so we share the race-safe code path.
    if (status === 'paid' && oldStatus !== 'paid') {
      if (!paymentAccountId) {
        return res.status(400).json({ message: 'Payment account is required when marking invoice as paid' });
      }
      const paymentAccount = await storage.getAccount(paymentAccountId, invoice.companyId);
      if (!paymentAccount) {
        return res.status(400).json({ message: 'Invalid payment account' });
      }
      if (paymentAccount.type !== 'asset') {
        return res.status(400).json({ message: 'Payment account must be a cash or bank account' });
      }

      const accounts = await storage.getAccountsByCompanyId(invoice.companyId);
      const accountsReceivable = accounts.find(a => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
      if (!accountsReceivable) {
        return res.status(500).json({ message: 'Accounts Receivable account not found' });
      }

      // Compute the unpaid remainder so we don't double-record.
      const previouslyPaid = await storage.getInvoicePaidTotal(id);
      const remaining = invoice.total - previouslyPaid;

      try {
        if (remaining > 0.005) {
          await storage.recordInvoicePayment({
            invoiceId: id,
            companyId: invoice.companyId,
            amount: remaining,
            date: new Date(),
            method: 'manual',
            reference: null,
            notes: 'Marked paid via status update',
            paymentAccountId,
            paymentAccountCurrency: (paymentAccount as any).currency ?? null,
            receivableAccountId: accountsReceivable.id,
            createdBy: userId,
          });
        } else {
          await storage.updateInvoiceStatus(id, invoice.companyId, 'paid');
        }
      } catch (err: any) {
        if (err?.code === 'INVOICE_TERMINAL') {
          return res.status(422).json({ message: err.message, code: err.code });
        }
        if (err?.code === 'CURRENCY_MISMATCH') {
          return res.status(422).json({ message: err.message, code: err.code });
        }
        throw err;
      }
    } else if (oldStatus !== status) {
      let statusUpdatedInTransaction = false;
      // Void must reverse the original revenue-recognition JE so the GL
      // doesn't keep recognising sales that were never realised. Without
      // this, a voided invoice would still inflate revenue and AR.
      if (status === 'void') {
        const accounts = await storage.getAccountsByCompanyId(invoice.companyId);
        const accountsReceivable = accounts.find(
          a => a.code === ACCOUNT_CODES.AR && a.isSystemAccount,
        );
        const salesRevenue = accounts.find(
          a =>
            a.isSystemAccount &&
            a.type === 'income' &&
            (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT),
        );
        const vatPayable = accounts.find(
          a => a.isVatAccount && a.vatType === 'output' && a.code === ACCOUNT_CODES.VAT_OUTPUT,
        );

        const existingEntries = await storage.getJournalEntriesBySource(
          invoice.companyId,
          'invoice',
          id,
        );
        const originalEntry = existingEntries.find(e => e.status === 'posted');
        if (originalEntry && (!accountsReceivable || !salesRevenue || (Number(invoice.vatAmount) > 0 && !vatPayable))) {
          return res.status(500).json({ message: 'Required system accounts are missing for invoice reversal' });
        }

        if (originalEntry && accountsReceivable && salesRevenue) {
          const reversalDate = new Date();
          // Block reversal posting into a locked period — without this we
          // could flip status without writing the offsetting JE.
          await assertPeriodNotLocked(invoice.companyId, reversalDate);
          const invoiceCurrency = invoice.currency || 'AED';
          const exchangeRate = positiveExchangeRate(invoice.exchangeRate || 1);
          const baseSubtotal = toBaseCurrencyAmount(Number(invoice.subtotal), invoiceCurrency, exchangeRate);
          const baseVatAmount = toBaseCurrencyAmount(Number(invoice.vatAmount), invoiceCurrency, exchangeRate);
          const baseTotal = toBaseCurrencyAmount(Number(invoice.total), invoiceCurrency, exchangeRate);

          const reversalLines: Array<{
            accountId: string;
            debit: number;
            credit: number;
            description: string;
            foreignCurrency?: string;
            foreignDebit?: number;
            foreignCredit?: number;
            exchangeRate?: number;
          }> = [
            {
              accountId: salesRevenue.id,
              debit: baseSubtotal,
              credit: 0,
              description: `Reverse revenue - Void Invoice ${invoice.number}`,
              ...withForeignAmount(invoiceCurrency, exchangeRate, Number(invoice.subtotal), 0),
            },
          ];
          if (Number(invoice.vatAmount) > 0 && vatPayable) {
            reversalLines.push({
              accountId: vatPayable.id,
              debit: baseVatAmount,
              credit: 0,
              description: `Reverse VAT - Void Invoice ${invoice.number}`,
              ...withForeignAmount(invoiceCurrency, exchangeRate, Number(invoice.vatAmount), 0),
            });
          }
          reversalLines.push({
            accountId: accountsReceivable.id,
            debit: 0,
            credit: baseTotal,
            description: `Reverse A/R - Void Invoice ${invoice.number}`,
            ...withForeignAmount(invoiceCurrency, exchangeRate, 0, Number(invoice.total)),
          });

          let entryNumber = '';
          await db.transaction(async (tx: typeof db) => {
            entryNumber = await allocateJournalEntryNumberInTransaction(invoice.companyId, reversalDate, tx);
            const [entry] = await tx
              .insert(journalEntriesTable)
              .values({
                companyId: invoice.companyId,
                date: reversalDate,
                memo: `Void Invoice ${invoice.number} - reversal of original posting`,
                entryNumber,
                status: 'posted',
                source: 'invoice',
                sourceId: id,
                reversedEntryId: originalEntry.id,
                reversalReason: 'Invoice voided',
                createdBy: userId,
                postedBy: userId,
                postedAt: reversalDate,
              } as any)
              .returning();
            for (const line of reversalLines) {
              await tx.insert(journalLinesTable).values({ ...line, entryId: entry.id });
            }
            await tx
              .update(invoicesTable)
              .set({ status })
              .where(eq(invoicesTable.id, id));
          });
          statusUpdatedInTransaction = true;

          log.info(
            { invoiceId: id, originalEntryId: originalEntry.id, entryNumber },
            'Void reversal journal entry created',
          );
        }
      }

      if (!statusUpdatedInTransaction) {
        await storage.updateInvoiceStatus(id, invoice.companyId, status);
      }
    }

    const updatedInvoice = await storage.getInvoice(id, invoice.companyId);
    log.info({ id, oldStatus, status }, 'Status transition');

    await recordAudit({
      userId,
      companyId: invoice.companyId,
      action: 'invoice.status_change',
      entityType: 'invoice',
      entityId: id,
      before: { status: oldStatus },
      after: { status },
      req,
    });

    if (status !== oldStatus && (status === 'paid' || status === 'void')) {
      createAndEmitNotification({
        userId,
        companyId: invoice.companyId,
        type: 'invoice_status_change',
        title: `Invoice ${status}`,
        message: `Invoice ${invoice.number} for ${invoice.customerName} marked as ${status}`,
        priority: 'normal',
        relatedEntityType: 'invoice',
        relatedEntityId: id,
        actionUrl: '/invoices',
      }).catch(() => {});
    }

    res.json(updatedInvoice);
  }));

  // =====================================
  // E-Invoicing (PINT AE / UBL 2.1)
  // =====================================

  // Customer-only: Generate e-invoice XML for an invoice
  app.post("/api/invoices/:id/generate-einvoice", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const lines = await storage.getInvoiceLinesByInvoiceId(id);
    const company = await storage.getCompany(invoice.companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const customer = invoice.customerName
      ? { name: invoice.customerName, trn: invoice.customerTrn || undefined }
      : undefined;

    const { xml, uuid, hash } = generateEInvoiceXML(invoice, lines, company, customer);

    // Save e-invoice data to the invoice record
    await storage.updateInvoice(id, invoice.companyId, {
      einvoiceUuid: uuid,
      einvoiceXml: xml,
      einvoiceHash: hash,
      einvoiceStatus: 'generated',
    });

    log.info({ id, uuid }, 'Generated e-invoice');

    res.json({ uuid, hash, status: 'generated' });
  }));

  // Customer-only: Get e-invoice XML for an invoice
  app.get("/api/invoices/:id/einvoice-xml", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (!invoice.einvoiceXml) {
      return res.status(404).json({ message: 'E-invoice has not been generated for this invoice' });
    }

    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="einvoice-${invoice.number}.xml"`);
    res.send(invoice.einvoiceXml);
  }));

  // =====================================
  // Invoice Sharing & PDF
  // =====================================

  // Customer-only: Generate share link for invoice
  app.post("/api/invoices/:id/share", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Generate a random token
    const token = crypto.randomBytes(16).toString('hex');
    // 90-day expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    await storage.setInvoiceShareToken(id, token, expiresAt);

    res.json({
      shareUrl: `/view/invoice/${token}`,
      token,
    });
  }));

  // Customer-only: Download invoice as PDF
  app.get("/api/invoices/:id/pdf", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const lines = await storage.getInvoiceLinesByInvoiceId(id);
    const company = await storage.getCompany(invoice.companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const pdfBuffer = await generateInvoicePDF(invoice, lines, company);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${invoice.number}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }));

  // Public: View invoice by share token (NO auth required)
  app.get("/api/public/invoices/:token", asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.params;

    const invoice = await storage.getInvoiceByShareToken(token);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found or link is invalid' });
    }

    // Check expiry
    if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
      return res.status(410).json({ message: 'This invoice link has expired' });
    }

    const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
    const company = await storage.getCompany(invoice.companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Return sanitized data (no internal IDs exposed except what's needed)
    res.json({
      invoice: {
        number: invoice.number,
        customerName: invoice.customerName,
        customerTrn: invoice.customerTrn,
        date: invoice.date,
        currency: invoice.currency,
        subtotal: invoice.subtotal,
        vatAmount: invoice.vatAmount,
        total: invoice.total,
        status: invoice.status,
      },
      lines: lines.map(l => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        vatSupplyType: l.vatSupplyType,
        supplyEmirate: l.supplyEmirate,
      })),
      company: {
        name: company.name,
        trnVatNumber: company.trnVatNumber,
        businessAddress: company.businessAddress,
        contactPhone: company.contactPhone,
        contactEmail: company.contactEmail,
        websiteUrl: company.websiteUrl,
        logoUrl: company.logoUrl,
      },
    });
  }));

  // =====================================
  // Recurring Invoice Control
  // =====================================

  // POST /api/companies/:companyId/invoices/:invoiceId/set-recurring
  // DEPRECATED — returns 410 Gone. The scheduler reads recurring_invoices
  // template rows (created via /api/companies/:companyId/recurring-invoices),
  // NOT invoices.is_recurring + invoices.next_recurring_date. Setting those
  // legacy invoice-level fields had no effect on scheduling — invoices
  // marked recurring this way were never picked up by the cron. Migrate
  // callers to POST /api/companies/:companyId/recurring-invoices.
  app.post("/api/companies/:companyId/invoices/:invoiceId/set-recurring", authMiddleware, requireCustomer, asyncHandler(async (_req: Request, res: Response) => {
    return res.status(410).json({
      message: 'This endpoint is deprecated and no longer schedules invoices. Use POST /api/companies/:companyId/recurring-invoices instead.',
      code: 'ENDPOINT_DEPRECATED',
      replacement: '/api/companies/:companyId/recurring-invoices',
    });
  }));

  // =====================================
  // Invoice Payments
  // =====================================

  // GET /api/companies/:companyId/invoices/:invoiceId/payments
  app.get("/api/companies/:companyId/invoices/:invoiceId/payments", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, invoiceId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const invoice = await storage.getInvoice(invoiceId, companyId);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const payments = await storage.getInvoicePaymentsByInvoiceId(invoiceId);
    res.json(payments);
  }));

  // POST /api/companies/:companyId/invoices/:invoiceId/payments
  app.post("/api/companies/:companyId/invoices/:invoiceId/payments", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, invoiceId } = req.params;
    const userId = (req as any).user.id;
    const { amount, date, method, reference, notes, paymentAccountId } = req.body;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    // Validate first — cheap rejects before we touch the DB.
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(422).json({ message: 'Payment amount must be a positive number' });
    }
    if (!paymentAccountId) {
      return res.status(400).json({ message: 'paymentAccountId is required' });
    }

    const invoice = await storage.getInvoice(invoiceId, companyId);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Reject voided/cancelled invoices up front (the storage layer also
    // re-checks under FOR UPDATE; this is a fast-path 422).
    if (isTerminal(invoice.status)) {
      return res.status(422).json({
        message: `Cannot record payment on ${invoice.status} invoice`,
        code: 'INVOICE_TERMINAL',
      });
    }

    const paymentAccount = await storage.getAccount(paymentAccountId, companyId);
    if (!paymentAccount || paymentAccount.type !== 'asset') {
      return res.status(400).json({ message: 'Invalid payment account — must be an asset (cash/bank) account' });
    }
    // Currency validation: bank-account currency (if present) must match the invoice.
    const acctCurrency = (paymentAccount as any).currency as string | null | undefined;
    if (acctCurrency && acctCurrency !== invoice.currency) {
      return res.status(422).json({
        message: `Payment account currency (${acctCurrency}) does not match invoice currency (${invoice.currency})`,
        code: 'CURRENCY_MISMATCH',
      });
    }

    const accounts = await storage.getAccountsByCompanyId(companyId);
    const accountsReceivable = accounts.find(a => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
    if (!accountsReceivable) {
      return res.status(500).json({ message: 'Accounts Receivable account not found' });
    }

    const paymentDate = date ? new Date(date) : new Date();

    // Block payment recording into a locked period.
    await assertPeriodNotLocked(companyId, paymentDate);

    let result;
    try {
      result = await storage.recordInvoicePayment({
        invoiceId,
        companyId,
        amount: numericAmount,
        date: paymentDate,
        method: method || 'bank',
        reference: reference || null,
        notes: notes || null,
        paymentAccountId,
        paymentAccountCurrency: acctCurrency ?? null,
        receivableAccountId: accountsReceivable.id,
        createdBy: userId,
      });
    } catch (err: any) {
      const code = err?.code;
      if (code === 'OVERPAYMENT' || code === 'INVOICE_TERMINAL' || code === 'CURRENCY_MISMATCH') {
        return res.status(422).json({ message: err.message, code });
      }
      if (code === 'INVOICE_NOT_FOUND') {
        return res.status(404).json({ message: err.message });
      }
      if (code === 'INVOICE_COMPANY_MISMATCH') {
        return res.status(403).json({ message: err.message });
      }
      throw err;
    }

    await recordAudit({
      userId,
      companyId,
      action: 'invoice.payment',
      entityType: 'invoice',
      entityId: invoiceId,
      before: { status: invoice.status, totalPaid: result.totalPaid - numericAmount },
      after: { status: result.invoice.status, totalPaid: result.totalPaid },
      req,
      extra: {
        paymentId: result.payment.id,
        amount: numericAmount,
        method: method || 'bank',
        journalEntryId: result.journalEntryId,
      },
    });

    res.status(201).json({
      payment: result.payment,
      totalPaid: result.totalPaid,
      status: result.invoice.status,
    });
  }));

  // =====================================
  // Credit Notes
  // =====================================

  // POST /api/companies/:companyId/invoices/:invoiceId/credit-note
  app.post("/api/companies/:companyId/invoices/:invoiceId/credit-note", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, invoiceId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const original = await storage.getInvoice(invoiceId, companyId);
    if (!original) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (original.invoiceType === 'credit_note') {
      return res.status(400).json({ message: 'Cannot create a credit note of a credit note' });
    }

    // Block credit note creation if today is in a locked period — the credit
    // note posts a reversing JE on `now`.
    await assertPeriodNotLocked(companyId, new Date());

    const originalLines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
    const company = await storage.getCompany(companyId);
    const defaultSupplyEmirate = company?.emirate || 'dubai';
    const originalCurrency = original.currency || 'AED';
    const originalExchangeRate = positiveExchangeRate(original.exchangeRate || 1);
    const baseOriginalSubtotal = toBaseCurrencyAmount(Number(original.subtotal), originalCurrency, originalExchangeRate);
    const baseOriginalVatAmount = toBaseCurrencyAmount(Number(original.vatAmount), originalCurrency, originalExchangeRate);
    const baseOriginalTotal = toBaseCurrencyAmount(Number(original.total), originalCurrency, originalExchangeRate);
    const accounts = await storage.getAccountsByCompanyId(companyId);
    const accountsReceivable = accounts.find(a => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
    const salesRevenue = accounts.find(a => a.isSystemAccount && a.type === 'income' && (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT));
    const vatPayable = accounts.find(a => a.isVatAccount && a.vatType === 'output' && a.code === ACCOUNT_CODES.VAT_OUTPUT);
    if (!accountsReceivable || !salesRevenue || (Number(original.vatAmount) > 0 && !vatPayable)) {
      return res.status(500).json({ message: 'Required system accounts are missing for credit-note posting' });
    }
    const allEntries = await storage.getJournalEntriesByCompanyId(companyId);
    const originalEntry = allEntries.find(e => e.sourceId === invoiceId && e.source === 'invoice');

    // Allocate credit-note number AND insert the credit note + its lines in
    // a single transaction so a failed insert rolls back the sequence
    // increment (otherwise FTA-required gap-free numbering breaks).
    const now = new Date();
    const { cnNumber, creditNote, entryNumber } = await db.transaction(async (tx: typeof db) => {
      const number = await allocateInvoiceNumber(companyId, 'credit_note', now, tx);

      const [insertedCreditNote] = await tx
        .insert(invoicesTable)
        .values({
          companyId,
          number,
          customerName: original.customerName,
          customerTrn: original.customerTrn || undefined,
          date: now,
          currency: original.currency,
          exchangeRate: originalExchangeRate,
          baseCurrencyAmount: -baseOriginalTotal,
          subtotal: -original.subtotal,
          vatAmount: -original.vatAmount,
          total: -original.total,
          status: 'sent',
          invoiceType: 'credit_note',
          originalInvoiceId: invoiceId,
        } as any)
        .returning();

      for (const line of originalLines) {
        await tx.insert(invoiceLinesTable).values({
          invoiceId: insertedCreditNote.id,
          description: `[Credit] ${line.description}`,
          quantity: -line.quantity,
          unitPrice: line.unitPrice,
          vatRate: line.vatRate,
          vatSupplyType: line.vatSupplyType || undefined,
          supplyEmirate: line.supplyEmirate || defaultSupplyEmirate,
        } as any);
      }

      const cnLines: Array<{
        accountId: string;
        debit: number;
        credit: number;
        description: string;
        foreignCurrency?: string;
        foreignDebit?: number;
        foreignCredit?: number;
        exchangeRate?: number;
      }> = [
        {
          accountId: salesRevenue.id,
          debit: baseOriginalSubtotal,
          credit: 0,
          description: `Reverse revenue - ${number}`,
          ...withForeignAmount(originalCurrency, originalExchangeRate, Number(original.subtotal), 0),
        },
      ];
      if (original.vatAmount > 0 && vatPayable) {
        cnLines.push({
          accountId: vatPayable.id,
          debit: baseOriginalVatAmount,
          credit: 0,
          description: `Reverse VAT - ${number}`,
          ...withForeignAmount(originalCurrency, originalExchangeRate, Number(original.vatAmount), 0),
        });
      }
      cnLines.push({
        accountId: accountsReceivable.id,
        debit: 0,
        credit: baseOriginalTotal,
        description: `Reduce A/R - ${number}`,
        ...withForeignAmount(originalCurrency, originalExchangeRate, 0, Number(original.total)),
      });

      const entryNumber = await allocateJournalEntryNumberInTransaction(companyId, now, tx);
      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          companyId,
          date: now,
          memo: `Credit Note ${number} - reversal of Invoice ${original.number}`,
          entryNumber,
          status: 'posted',
          source: 'invoice',
          sourceId: insertedCreditNote.id,
          reversedEntryId: originalEntry?.id || null,
          reversalReason: 'Credit note issued',
          createdBy: userId,
          postedBy: userId,
          postedAt: now,
        } as any)
        .returning();
      for (const line of cnLines) {
        await tx.insert(journalLinesTable).values({ ...line, entryId: entry.id });
      }

      return { cnNumber: number, creditNote: insertedCreditNote, entryNumber };
    });
    log.info({ creditNoteId: creditNote.id, entryNumber }, 'Credit-note reversal journal entry created');

    await recordAudit({
      userId,
      companyId,
      action: 'invoice.credit_note',
      entityType: 'invoice',
      entityId: creditNote.id,
      before: { originalInvoiceId: invoiceId, originalNumber: original.number },
      after: {
        creditNoteNumber: cnNumber,
        total: creditNote.total,
        currency: creditNote.currency,
      },
      req,
    });

    res.status(201).json(creditNote);
  }));

  // Public: Download PDF by share token (NO auth required)
  app.get("/api/public/invoices/:token/pdf", asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.params;

    const invoice = await storage.getInvoiceByShareToken(token);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found or link is invalid' });
    }

    if (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date()) {
      return res.status(410).json({ message: 'This invoice link has expired' });
    }

    const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
    const company = await storage.getCompany(invoice.companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const pdfBuffer = await generateInvoicePDF(invoice, lines, company);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${invoice.number}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }));

  // Customer-only: Send invoice by email
  app.post("/api/companies/:companyId/invoices/:invoiceId/send-email", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, invoiceId } = req.params;
    const userId = (req as any).user.id;

    const bodySchema = z.object({
      to: z.string().email('Invalid email address'),
      subject: z.string().optional(),
      message: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || 'Invalid request' });
    }
    const { to, subject, message } = parsed.data;

    if (!hasSmtpConfig()) {
      return res.status(503).json({
        message: 'Email sending is not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.',
        code: 'SMTP_NOT_CONFIGURED',
      });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const invoice = await storage.getInvoice(invoiceId, companyId);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const company = await storage.getCompany(companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const lines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
    const pdfBuffer = await generateInvoicePDF(invoice, lines, company);

    await sendInvoiceEmail(to, invoice, company, pdfBuffer, subject, message);

    await storage.createActivityLog({
      userId,
      companyId,
      action: 'send',
      entityType: 'invoice',
      entityId: invoiceId,
      description: `Invoice ${invoice.number} sent by email to ${to}`,
      metadata: JSON.stringify({ to, invoiceNumber: invoice.number }),
    });

    res.json({ message: `Invoice ${invoice.number} sent to ${to}` });
  }));

  // Customer-only: Send payment reminder email
  app.post("/api/companies/:companyId/invoices/:invoiceId/send-reminder", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, invoiceId } = req.params;
    const userId = (req as any).user.id;

    const bodySchema = z.object({
      to: z.string().email('Invalid email address'),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || 'Invalid request' });
    }
    const { to } = parsed.data;

    if (!hasSmtpConfig()) {
      return res.status(503).json({
        message: 'Email sending is not configured. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.',
        code: 'SMTP_NOT_CONFIGURED',
      });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const invoice = await storage.getInvoice(invoiceId, companyId);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (invoice.status === 'paid' || invoice.status === 'void') {
      return res.status(400).json({ message: `Cannot send reminder for a ${invoice.status} invoice` });
    }

    const company = await storage.getCompany(companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const newReminderCount = (invoice.reminderCount || 0) + 1;
    const lines = await storage.getInvoiceLinesByInvoiceId(invoiceId);
    const pdfBuffer = await generateInvoicePDF(invoice, lines, company);

    await sendPaymentReminderEmail(to, invoice, company, pdfBuffer, newReminderCount);

    await storage.updateInvoice(invoiceId, companyId, {
      reminderCount: newReminderCount,
      lastReminderSentAt: new Date(),
    });

    await storage.createActivityLog({
      userId,
      companyId,
      action: 'send',
      entityType: 'invoice',
      entityId: invoiceId,
      description: `Payment reminder #${newReminderCount} sent for invoice ${invoice.number} to ${to}`,
      metadata: JSON.stringify({ to, reminderCount: newReminderCount, invoiceNumber: invoice.number }),
    });

    res.json({
      message: `Payment reminder #${newReminderCount} sent to ${to}`,
      reminderCount: newReminderCount,
    });
  }));
}
