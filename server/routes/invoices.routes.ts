import { Router, type Express, type Request, type Response } from 'express';
import crypto from 'crypto';
import { storage } from '../storage';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { insertInvoiceSchema } from '../../shared/schema';
import { generateInvoicePDF } from '../services/pdf-invoice.service';
import { generateEInvoiceXML } from '../services/einvoice.service';
import { hasSmtpConfig, sendInvoiceEmail, sendPaymentReminderEmail } from '../services/email.service';
import { createAndEmitNotification } from '../services/socket.service';

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

    const invoices = await storage.getInvoicesByCompanyId(companyId);
    res.json(invoices);
  }));

  // Customer-only: Get single invoice
  app.get("/api/invoices/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const invoice = await storage.getInvoice(id);

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Verify company access
    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
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

  // Customer-only: Create invoices
  app.post("/api/companies/:companyId/invoices", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;
    const { lines, date, dueDate, ...invoiceData } = req.body;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Calculate totals
    let subtotal = 0;
    let vatAmount = 0;

    for (const line of lines) {
      const lineTotal = line.quantity * line.unitPrice;
      subtotal += lineTotal;
      vatAmount += lineTotal * (line.vatRate || 0.05);
    }

    const total = subtotal + vatAmount;

    // Convert date strings to Date objects
    const invoiceDate = typeof date === 'string' ? new Date(date) : date;
    const invoiceDueDate = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;

    console.log('[Invoices] Creating invoice:', {
      companyId,
      userId,
      number: invoiceData.number,
      date: invoiceDate,
      subtotal,
      vatAmount,
      total,
      linesCount: lines.length
    });

    // Create invoice
    const invoice = await storage.createInvoice({
      ...invoiceData,
      date: invoiceDate,
      dueDate: invoiceDueDate,
      companyId,
      subtotal,
      vatAmount,
      total,
    });

    // Create invoice lines
    for (const line of lines) {
      await storage.createInvoiceLine({
        invoiceId: invoice.id,
        ...line,
      });
    }

    // Revenue recognition: create journal entry immediately when invoice is raised
    const accounts = await storage.getAccountsByCompanyId(companyId);
    // Look up by code/type to avoid fragile name-string matching
    const accountsReceivable = accounts.find(a => a.code === '1040' && a.isSystemAccount);
    const salesRevenue = accounts.find(
      a => a.isSystemAccount && a.type === 'income' && (a.code === '4010' || a.code === '4020')
    );
    const vatPayable = accounts.find(a => a.isVatAccount && a.vatType === 'output' && a.code === '2020');

    if (accountsReceivable && salesRevenue) {
      // Generate entry number atomically via storage helper
      const entryNumber = await storage.generateEntryNumber(companyId, invoiceDate);

      const entry = await storage.createJournalEntry({
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
      });

      // Debit: Accounts Receivable (total)
      await storage.createJournalLine({
        entryId: entry.id,
        accountId: accountsReceivable.id,
        debit: total,
        credit: 0,
        description: `Invoice ${invoice.number} - ${invoice.customerName}`,
      });

      // Credit: Sales Revenue (subtotal)
      await storage.createJournalLine({
        entryId: entry.id,
        accountId: salesRevenue.id,
        debit: 0,
        credit: subtotal,
        description: `Sales revenue - Invoice ${invoice.number}`,
      });

      // Credit: VAT Payable (vat amount) - if there's VAT
      if (vatAmount > 0 && vatPayable) {
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: vatPayable.id,
          debit: 0,
          credit: vatAmount,
          description: `VAT output - Invoice ${invoice.number}`,
        });
      }

      console.log('[Invoices] Revenue recognition journal entry created:', entryNumber, 'for invoice:', invoice.id);
    } else {
      console.warn('[Invoices] Could not create revenue recognition entry - missing accounts');
    }

    console.log('[Invoices] Invoice created successfully:', invoice.id);

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

    // Get invoice
    const invoice = await storage.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Check access
    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get all draft entries for this invoice
    const entries = await storage.getJournalEntriesByCompanyId(invoice.companyId);
    const invoiceEntries = entries.filter(e => e.sourceId === id && e.status === 'draft');

    if (invoiceEntries.length === 0) {
      return res.status(400).json({ message: 'No draft entries to post' });
    }

    // Post all draft entries
    for (const entry of invoiceEntries) {
      await storage.updateJournalEntry(entry.id, {
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

    // Get invoice to verify it exists and get company access
    const invoice = await storage.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Calculate totals
    let subtotal = 0;
    let vatAmount = 0;

    for (const line of lines) {
      const lineTotal = line.quantity * line.unitPrice;
      subtotal += lineTotal;
      vatAmount += lineTotal * (line.vatRate || 0.05);
    }

    const total = subtotal + vatAmount;

    // Convert date string to Date object if it's a string
    const invoiceDate = typeof date === 'string' ? new Date(date) : date;

    // Update invoice
    const updatedInvoice = await storage.updateInvoice(id, {
      ...invoiceData,
      date: invoiceDate,
      subtotal,
      vatAmount,
      total,
    });

    // Delete existing lines and create new ones
    await storage.deleteInvoiceLinesByInvoiceId(id);
    for (const line of lines) {
      await storage.createInvoiceLine({
        invoiceId: id,
        ...line,
      });
    }

    console.log('[Invoices] Invoice updated successfully:', id);
    res.json(updatedInvoice);
  }));

  // Customer-only: Delete invoice
  app.delete("/api/invoices/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Get invoice to verify it exists and get company access
    const invoice = await storage.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await storage.deleteInvoice(id);
    res.json({ message: 'Invoice deleted successfully' });
  }));

  // Customer-only: Update invoice status
  app.patch("/api/invoices/:id/status", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, paymentAccountId } = req.body;
    const userId = (req as any).user.id;

    // Validate status
    const validStatuses = ['draft', 'sent', 'paid', 'partial', 'void'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be one of: draft, sent, paid, void' });
    }

    // Get invoice to verify it exists and get company access
    const invoice = await storage.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const oldStatus = invoice.status;
    const updatedInvoice = await storage.updateInvoiceStatus(id, status);

    console.log(`[Invoices] Status transition: ${oldStatus} -> ${status} for invoice ${id}`);

    // Payment recording when invoice is marked as paid
    // Note: Revenue is already recognized when invoice is created
    if (status === 'paid' && oldStatus !== 'paid') {
      // Validate payment account is provided
      if (!paymentAccountId) {
        return res.status(400).json({ message: 'Payment account is required when marking invoice as paid' });
      }

      // Validate payment account belongs to company
      const paymentAccount = await storage.getAccount(paymentAccountId);
      if (!paymentAccount || paymentAccount.companyId !== invoice.companyId) {
        return res.status(400).json({ message: 'Invalid payment account' });
      }

      // Validate payment account is an asset account (cash/bank)
      if (paymentAccount.type !== 'asset') {
        return res.status(400).json({ message: 'Payment account must be a cash or bank account' });
      }

      const accounts = await storage.getAccountsByCompanyId(invoice.companyId);
      const accountsReceivable = accounts.find(a => a.code === '1040' && a.isSystemAccount);

      if (accountsReceivable) {
        // Generate entry number atomically via storage helper
        const now = new Date();
        const entryNumber = await storage.generateEntryNumber(invoice.companyId, now);

        const entry = await storage.createJournalEntry({
          companyId: invoice.companyId,
          date: now,
          memo: `Payment received for Invoice ${invoice.number}`,
          entryNumber,
          status: 'posted',
          source: 'payment',
          sourceId: invoice.id,
          createdBy: userId,
          postedBy: userId,
          postedAt: now,
        });

        // Debit: Selected payment account (total)
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: paymentAccountId,
          debit: invoice.total,
          credit: 0,
          description: `Payment received - Invoice ${invoice.number}`,
        });

        // Credit: Accounts Receivable (total)
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: accountsReceivable.id,
          debit: 0,
          credit: invoice.total,
          description: `Clear A/R - Invoice ${invoice.number}`,
        });

        console.log('[Invoices] Payment journal entry created:', entryNumber, 'for invoice:', id, 'to account:', paymentAccount.nameEn);
      } else {
        return res.status(500).json({ message: 'Accounts Receivable account not found' });
      }
    }

    console.log('[Invoices] Invoice status updated:', id, status);

    if (status !== oldStatus && (status === 'paid' || status === 'overdue' || status === 'void')) {
      createAndEmitNotification({
        userId,
        companyId: invoice.companyId,
        type: 'invoice_status_change',
        title: `Invoice ${status}`,
        message: `Invoice ${invoice.number} for ${invoice.customerName} marked as ${status}`,
        priority: status === 'overdue' ? 'high' : 'normal',
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

    const invoice = await storage.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
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
    await storage.updateInvoice(id, {
      einvoiceUuid: uuid,
      einvoiceXml: xml,
      einvoiceHash: hash,
      einvoiceStatus: 'generated',
    });

    console.log('[E-Invoice] Generated e-invoice for invoice:', id, 'UUID:', uuid);

    res.json({ uuid, hash, status: 'generated' });
  }));

  // Customer-only: Get e-invoice XML for an invoice
  app.get("/api/invoices/:id/einvoice-xml", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const invoice = await storage.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
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

    const invoice = await storage.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
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

    const invoice = await storage.getInvoice(id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, invoice.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
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
  app.post("/api/companies/:companyId/invoices/:invoiceId/set-recurring", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, invoiceId } = req.params;
    const userId = (req as any).user.id;
    const { isRecurring, recurringInterval, nextRecurringDate, recurringEndDate } = req.body;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice || invoice.companyId !== companyId) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (isRecurring && !['weekly', 'monthly', 'quarterly', 'yearly'].includes(recurringInterval)) {
      return res.status(400).json({ message: 'recurringInterval must be weekly, monthly, quarterly, or yearly' });
    }

    const updated = await storage.updateInvoice(invoiceId, {
      isRecurring: !!isRecurring,
      recurringInterval: isRecurring ? recurringInterval : null,
      nextRecurringDate: isRecurring && nextRecurringDate ? new Date(nextRecurringDate) : null,
      recurringEndDate: recurringEndDate ? new Date(recurringEndDate) : null,
    } as any);

    res.json(updated);
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

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice || invoice.companyId !== companyId) {
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

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice || invoice.companyId !== companyId) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Payment amount must be positive' });
    }

    if (!paymentAccountId) {
      return res.status(400).json({ message: 'paymentAccountId is required' });
    }

    const paymentAccount = await storage.getAccount(paymentAccountId);
    if (!paymentAccount || paymentAccount.companyId !== companyId || paymentAccount.type !== 'asset') {
      return res.status(400).json({ message: 'Invalid payment account — must be an asset (cash/bank) account' });
    }

    const paymentDate = date ? new Date(date) : new Date();

    // Create journal entry: Debit Cash/Bank, Credit Accounts Receivable
    const accounts = await storage.getAccountsByCompanyId(companyId);
    const accountsReceivable = accounts.find(a => a.code === '1040' && a.isSystemAccount);

    let journalEntryId: string | undefined;
    if (accountsReceivable) {
      const entryNumber = await storage.generateEntryNumber(companyId, paymentDate);
      const entry = await storage.createJournalEntry({
        companyId,
        date: paymentDate,
        memo: `Payment received for Invoice ${invoice.number} - ${method || 'bank'}`,
        entryNumber,
        status: 'posted',
        source: 'payment',
        sourceId: invoice.id,
        createdBy: userId,
        postedBy: userId,
        postedAt: paymentDate,
      });

      await storage.createJournalLine({
        entryId: entry.id,
        accountId: paymentAccountId,
        debit: amount,
        credit: 0,
        description: `Payment received - Invoice ${invoice.number}`,
      });

      await storage.createJournalLine({
        entryId: entry.id,
        accountId: accountsReceivable.id,
        debit: 0,
        credit: amount,
        description: `Clear A/R - Invoice ${invoice.number}`,
      });

      journalEntryId = entry.id;
    }

    const payment = await storage.createInvoicePayment({
      invoiceId,
      companyId,
      amount,
      date: paymentDate,
      method: method || 'bank',
      reference: reference || null,
      notes: notes || null,
      paymentAccountId,
      journalEntryId: journalEntryId || null,
      createdBy: userId,
    } as any);

    // Auto-update invoice status based on total payments
    const totalPaid = await storage.getInvoicePaidTotal(invoiceId);
    const newStatus = totalPaid >= invoice.total ? 'paid' : 'partial';
    if (invoice.status !== newStatus && invoice.status !== 'void') {
      await storage.updateInvoiceStatus(invoiceId, newStatus);
    }

    res.status(201).json({ payment, totalPaid, status: newStatus });
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

    const original = await storage.getInvoice(invoiceId);
    if (!original || original.companyId !== companyId) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (original.invoiceType === 'credit_note') {
      return res.status(400).json({ message: 'Cannot create a credit note of a credit note' });
    }

    const originalLines = await storage.getInvoiceLinesByInvoiceId(invoiceId);

    // Generate credit note number
    const cnNumber = `CN-${original.number}`;

    const creditNote = await storage.createInvoice({
      companyId,
      number: cnNumber,
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
    } as any);

    for (const line of originalLines) {
      await storage.createInvoiceLine({
        invoiceId: creditNote.id,
        description: `[Credit] ${line.description}`,
        quantity: -line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        vatSupplyType: line.vatSupplyType || undefined,
      } as any);
    }

    // Reverse journal entry: Debit Sales Revenue + VAT, Credit Accounts Receivable
    const accounts = await storage.getAccountsByCompanyId(companyId);
    const accountsReceivable = accounts.find(a => a.code === '1040' && a.isSystemAccount);
    const salesRevenue = accounts.find(a => a.isSystemAccount && a.type === 'income' && (a.code === '4010' || a.code === '4020'));
    const vatPayable = accounts.find(a => a.isVatAccount && a.vatType === 'output' && a.code === '2020');

    if (accountsReceivable && salesRevenue) {
      const now = new Date();
      const entryNumber = await storage.generateEntryNumber(companyId, now);

      // Find the original invoice's journal entry to reverse
      const allEntries = await storage.getJournalEntriesByCompanyId(companyId);
      const originalEntry = allEntries.find(e => e.sourceId === invoiceId && e.source === 'invoice');

      const entry = await storage.createJournalEntry({
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
      } as any);

      // Debit Sales Revenue (reverse the credit)
      await storage.createJournalLine({
        entryId: entry.id,
        accountId: salesRevenue.id,
        debit: original.subtotal,
        credit: 0,
        description: `Reverse revenue - ${cnNumber}`,
      });

      // Debit VAT Payable if applicable
      if (original.vatAmount > 0 && vatPayable) {
        await storage.createJournalLine({
          entryId: entry.id,
          accountId: vatPayable.id,
          debit: original.vatAmount,
          credit: 0,
          description: `Reverse VAT - ${cnNumber}`,
        });
      }

      // Credit Accounts Receivable (reduce the A/R)
      await storage.createJournalLine({
        entryId: entry.id,
        accountId: accountsReceivable.id,
        debit: 0,
        credit: original.total,
        description: `Reduce A/R - ${cnNumber}`,
      });
    }

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

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice || invoice.companyId !== companyId) {
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

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice || invoice.companyId !== companyId) {
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

    await storage.updateInvoice(invoiceId, {
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
