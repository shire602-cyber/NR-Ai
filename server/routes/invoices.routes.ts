import { Router, type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { insertInvoiceSchema } from '../../shared/schema';

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
    const { lines, date, ...invoiceData } = req.body;

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

    // Convert date string to Date object if it's a string
    const invoiceDate = typeof date === 'string' ? new Date(date) : date;

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
    const accountsReceivable = accounts.find(a => a.nameEn === 'Accounts Receivable');
    const salesRevenue = accounts.find(a => a.nameEn === 'Sales Revenue');
    const vatPayable = accounts.find(a => a.nameEn === 'VAT Payable');

    if (accountsReceivable && salesRevenue) {
      // Generate entry number atomically via storage helper
      const entryNumber = await storage.generateEntryNumber(companyId, invoiceDate);

      const entry = await storage.createJournalEntry({
        companyId: companyId,
        date: invoiceDate,
        memo: `Sales Invoice ${invoice.number} - ${invoice.customerName}`,
        entryNumber,
        status: 'draft', // Wait for manual posting
        source: 'invoice',
        sourceId: invoice.id,
        createdBy: userId,
        postedBy: null,
        postedAt: null,
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
    const validStatuses = ['draft', 'sent', 'paid', 'void'];
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
      const accountsReceivable = accounts.find(a => a.nameEn === 'Accounts Receivable');

      if (accountsReceivable) {
        // Generate entry number atomically via storage helper
        const now = new Date();
        const entryNumber = await storage.generateEntryNumber(invoice.companyId, now);

        const entry = await storage.createJournalEntry({
          companyId: invoice.companyId,
          date: now,
          memo: `Payment received for Invoice ${invoice.number}`,
          entryNumber,
          status: 'draft',
          source: 'payment',
          sourceId: invoice.id,
          createdBy: userId,
          postedBy: null,
          postedAt: null,
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
    res.json(updatedInvoice);
  }));
}
