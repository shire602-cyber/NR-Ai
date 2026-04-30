import { Router, type Express, type Request, type Response } from 'express';
import crypto from 'crypto';
import Decimal from 'decimal.js';
import { storage } from '../storage';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { insertInvoiceSchema, type Invoice } from '../../shared/schema';
import { generateInvoicePDF } from '../services/pdf-invoice.service';
import { generateEInvoiceXML } from '../services/einvoice.service';
import { hasSmtpConfig, sendInvoiceEmail, sendPaymentReminderEmail } from '../services/email.service';
import { createAndEmitNotification } from '../services/socket.service';
import { db } from '../db';
import { invoices as invoicesTable, invoiceLines as invoiceLinesTable } from '../../shared/schema';
import { assertPeriodNotLocked } from '../services/period-lock.service';
import { canTransition, isTerminal, isValidStatus } from '../services/invoice-state-machine';
import { recordAudit } from '../services/audit.service';
import { createLogger } from '../config/logger';
import { UAE_VAT_RATE, ACCOUNT_CODES } from '../constants';
import { allocateInvoiceNumber, peekNextInvoiceNumber } from '../services/invoice-numbering.service';
import { assertRetentionExpired } from '../services/retention.service';

const log = createLogger('invoices');

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

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Calculate totals using decimal.js to avoid binary-float drift on
    // NUMERIC(15,2) columns. Sums are kept as Decimal until the very end.
    let subtotalD = new Decimal(0);
    let vatAmountD = new Decimal(0);

    for (const line of lines) {
      const lineTotal = new Decimal(line.unitPrice).times(line.quantity);
      subtotalD = subtotalD.plus(lineTotal);
      vatAmountD = vatAmountD.plus(
        lineTotal.times(line.vatRate ?? UAE_VAT_RATE),
      );
    }

    const subtotal = subtotalD.toDecimalPlaces(2).toNumber();
    const vatAmount = vatAmountD.toDecimalPlaces(2).toNumber();
    const total = subtotalD.plus(vatAmountD).toDecimalPlaces(2).toNumber();

    // Convert date string to Date object if it's a string
    const invoiceDate = typeof date === 'string' ? new Date(date) : date;

    // Block invoice creation in a locked period — invoice creation immediately
    // posts a revenue-recognition journal entry on this date.
    await assertPeriodNotLocked(companyId, invoiceDate);

    // FTA requires sequential, gap-free invoice numbering. We MUST allocate
    // and insert the invoice in a single transaction — otherwise a failed
    // insert after a successful allocation burns the number permanently and
    // the next allocation produces a gap (FTA Article 78 violation).
    const { allocatedNumber, invoice } = await db.transaction(async (tx: typeof db) => {
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
        linesCount: lines.length,
      }, 'Creating invoice');

      const [insertedInvoice] = await tx
        .insert(invoicesTable)
        .values({
          ...invoiceData,
          number,
          date: invoiceDate,
          companyId,
          subtotal,
          vatAmount,
          total,
        })
        .returning();

      for (const line of lines) {
        await tx.insert(invoiceLinesTable).values({
          invoiceId: insertedInvoice.id,
          ...line,
        });
      }

      return { allocatedNumber: number, invoice: insertedInvoice };
    });

    // Revenue recognition: create journal entry immediately when invoice is raised
    const accounts = await storage.getAccountsByCompanyId(companyId);
    // Look up by code/type to avoid fragile name-string matching
    const accountsReceivable = accounts.find(a => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
    const salesRevenue = accounts.find(
      a => a.isSystemAccount && a.type === 'income' && (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT)
    );
    const vatPayable = accounts.find(a => a.isVatAccount && a.vatType === 'output' && a.code === ACCOUNT_CODES.VAT_OUTPUT);

    if (accountsReceivable && salesRevenue) {
      // Generate entry number atomically via storage helper
      const entryNumber = await storage.generateEntryNumber(companyId, invoiceDate);

      const journalLines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [
        {
          accountId: accountsReceivable.id,
          debit: total,
          credit: 0,
          description: `Invoice ${invoice.number} - ${invoice.customerName}`,
        },
        {
          accountId: salesRevenue.id,
          debit: 0,
          credit: subtotal,
          description: `Sales revenue - Invoice ${invoice.number}`,
        },
      ];
      if (vatAmount > 0 && vatPayable) {
        journalLines.push({
          accountId: vatPayable.id,
          debit: 0,
          credit: vatAmount,
          description: `VAT output - Invoice ${invoice.number}`,
        });
      }

      await storage.createJournalEntry(
        {
          companyId: companyId,
          date: invoiceDate,
          memo: `Sales Invoice ${invoice.number} - ${invoice.customerName}`,
          entryNumber,
          status: 'posted',
          source: 'invoice',
          sourceId: invoice.id,
          createdBy: userId,
          postedBy: userId,
          postedAt: invoiceDate,
        },
        journalLines
      );

      log.info({ entryNumber, invoiceId: invoice.id }, 'Revenue recognition journal entry created');
    } else {
      log.warn('Could not create revenue recognition entry - missing accounts');
    }

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

    const invoice = await findInvoiceForUser(userId, id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (isTerminal(invoice.status)) {
      return res.status(422).json({
        message: `Cannot edit ${invoice.status} invoice`,
        code: 'INVOICE_TERMINAL',
      });
    }

    // Recompute totals from lines using decimal.js for precise money math.
    let subtotalD = new Decimal(0);
    let vatAmountD = new Decimal(0);
    for (const line of lines) {
      const lineTotal = new Decimal(line.unitPrice).times(line.quantity);
      subtotalD = subtotalD.plus(lineTotal);
      vatAmountD = vatAmountD.plus(
        lineTotal.times(line.vatRate ?? UAE_VAT_RATE),
      );
    }
    const subtotal = subtotalD.toDecimalPlaces(2).toNumber();
    const vatAmount = vatAmountD.toDecimalPlaces(2).toNumber();
    const total = subtotalD.plus(vatAmountD).toDecimalPlaces(2).toNumber();

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

    // Update invoice
    const updatedInvoice = await storage.updateInvoice(id, invoice.companyId, {
      ...invoiceData,
      date: invoiceDate,
      subtotal,
      vatAmount,
      total,
    });

    await storage.deleteInvoiceLinesByInvoiceId(id);
    for (const line of lines) {
      await storage.createInvoiceLine({
        invoiceId: id,
        ...line,
      });
    }

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

        if (originalEntry && accountsReceivable && salesRevenue) {
          const reversalDate = new Date();
          // Block reversal posting into a locked period — without this we
          // could flip status without writing the offsetting JE.
          await assertPeriodNotLocked(invoice.companyId, reversalDate);

          const entryNumber = await storage.generateEntryNumber(
            invoice.companyId,
            reversalDate,
          );

          const reversalLines: Array<{
            accountId: string;
            debit: number;
            credit: number;
            description: string;
          }> = [
            {
              accountId: salesRevenue.id,
              debit: Number(invoice.subtotal),
              credit: 0,
              description: `Reverse revenue - Void Invoice ${invoice.number}`,
            },
          ];
          if (Number(invoice.vatAmount) > 0 && vatPayable) {
            reversalLines.push({
              accountId: vatPayable.id,
              debit: Number(invoice.vatAmount),
              credit: 0,
              description: `Reverse VAT - Void Invoice ${invoice.number}`,
            });
          }
          reversalLines.push({
            accountId: accountsReceivable.id,
            debit: 0,
            credit: Number(invoice.total),
            description: `Reverse A/R - Void Invoice ${invoice.number}`,
          });

          await storage.createJournalEntry(
            {
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
            } as any,
            reversalLines,
          );

          log.info(
            { invoiceId: id, originalEntryId: originalEntry.id, entryNumber },
            'Void reversal journal entry created',
          );
        }
      }

      await storage.updateInvoiceStatus(id, invoice.companyId, status);
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

    // Allocate credit-note number AND insert the credit note + its lines in
    // a single transaction so a failed insert rolls back the sequence
    // increment (otherwise FTA-required gap-free numbering breaks).
    const { cnNumber, creditNote } = await db.transaction(async (tx: typeof db) => {
      const number = await allocateInvoiceNumber(companyId, 'credit_note', new Date(), tx);

      const [insertedCreditNote] = await tx
        .insert(invoicesTable)
        .values({
          companyId,
          number,
          customerName: original.customerName,
          customerTrn: original.customerTrn || undefined,
          date: new Date(),
          currency: original.currency,
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
        } as any);
      }

      return { cnNumber: number, creditNote: insertedCreditNote };
    });

    // Reverse journal entry: Debit Sales Revenue + VAT, Credit Accounts Receivable
    const accounts = await storage.getAccountsByCompanyId(companyId);
    const accountsReceivable = accounts.find(a => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
    const salesRevenue = accounts.find(a => a.isSystemAccount && a.type === 'income' && (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT));
    const vatPayable = accounts.find(a => a.isVatAccount && a.vatType === 'output' && a.code === ACCOUNT_CODES.VAT_OUTPUT);

    if (accountsReceivable && salesRevenue) {
      const now = new Date();
      const entryNumber = await storage.generateEntryNumber(companyId, now);

      // Find the original invoice's journal entry to reverse
      const allEntries = await storage.getJournalEntriesByCompanyId(companyId);
      const originalEntry = allEntries.find(e => e.sourceId === invoiceId && e.source === 'invoice');

      const cnLines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [
        {
          accountId: salesRevenue.id,
          debit: original.subtotal,
          credit: 0,
          description: `Reverse revenue - ${cnNumber}`,
        },
      ];
      if (original.vatAmount > 0 && vatPayable) {
        cnLines.push({
          accountId: vatPayable.id,
          debit: original.vatAmount,
          credit: 0,
          description: `Reverse VAT - ${cnNumber}`,
        });
      }
      cnLines.push({
        accountId: accountsReceivable.id,
        debit: 0,
        credit: original.total,
        description: `Reduce A/R - ${cnNumber}`,
      });

      await storage.createJournalEntry(
        {
          companyId,
          date: now,
          memo: `Credit Note ${cnNumber} - reversal of Invoice ${original.number}`,
          entryNumber,
          status: 'posted',
          source: 'invoice',
          sourceId: creditNote.id,
          reversedEntryId: originalEntry?.id || null,
          reversalReason: 'Credit note issued',
          createdBy: userId,
          postedBy: userId,
          postedAt: now,
        } as any,
        cnLines
      );
    }

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
