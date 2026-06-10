import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { requireFeature } from '../middleware/featureGate';
import { storage } from '../storage';
import { generateQuotePDF } from '../services/pdf-quote.service';
import { createLogger } from '../config/logger';

const logger = createLogger('quotes-routes');

// Client payloads carry ISO strings; Drizzle timestamp columns want Dates.
function normalizeQuoteDates<T extends { date?: unknown; expiryDate?: unknown }>(data: T): T {
  const out: any = { ...data };
  if (out.date) out.date = new Date(out.date);
  if (out.expiryDate) out.expiryDate = new Date(out.expiryDate);
  return out;
}

export function registerQuoteRoutes(app: Express) {
  // =====================================
  // Quote Routes
  // =====================================

  // Customer-only: List quotes by company
  app.get('/api/companies/:companyId/quotes', authMiddleware, requireCustomer,
    requireFeature('quotes'), asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const quotes = await storage.getQuotesByCompanyId(companyId);
      res.json(quotes);
    }));

  // Customer-only: Get single quote with lines
  app.get('/api/quotes/:id', authMiddleware, requireCustomer, requireFeature('quotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const quote = await storage.getQuote(id);
    if (!quote) {
      return res.status(404).json({ message: 'Quote not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const lines = await storage.getQuoteLinesByQuoteId(id);
    res.json({ ...quote, lines });
  }));

  // Customer-only: Create quote with lines
  app.post('/api/companies/:companyId/quotes', authMiddleware, requireCustomer,
    requireFeature('quotes'), asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;
      const { lines, ...quoteData } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const quote = await storage.createQuote(normalizeQuoteDates({ ...quoteData, companyId }));

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          await storage.createQuoteLine({ ...line, quoteId: quote.id });
        }
      }

      const quoteLines = await storage.getQuoteLinesByQuoteId(quote.id);
      res.status(201).json({ ...quote, lines: quoteLines });
    }));

  // Customer-only: Update quote
  app.put('/api/quotes/:id', authMiddleware, requireCustomer, requireFeature('quotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const { lines, ...updateData } = req.body;

    const quote = await storage.getQuote(id);
    if (!quote) {
      return res.status(404).json({ message: 'Quote not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updated = await storage.updateQuote(id, normalizeQuoteDates(updateData));

    if (lines && Array.isArray(lines)) {
      await storage.deleteQuoteLinesByQuoteId(quote.id);
      for (const line of lines) {
        await storage.createQuoteLine({ ...line, quoteId: quote.id });
      }
    }

    const quoteLines = await storage.getQuoteLinesByQuoteId(quote.id);
    res.json({ ...updated, lines: quoteLines });
  }));

  // Customer-only: Delete quote
  app.delete('/api/quotes/:id', authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const quote = await storage.getQuote(id);
    if (!quote) {
      return res.status(404).json({ message: 'Quote not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await storage.deleteQuote(id);
    res.json({ message: 'Quote deleted' });
  }));

  // Customer-only: Convert quote to invoice
  app.post('/api/quotes/:id/convert-to-invoice', authMiddleware, requireCustomer, requireFeature('quotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const quote = await storage.getQuote(id);
    if (!quote) {
      return res.status(404).json({ message: 'Quote not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (quote.status === 'converted') {
      return res.status(400).json({ message: 'Quote already converted' });
    }

    const lines = await storage.getQuoteLinesByQuoteId(id);

    // Create invoice from quote
    const invoiceNumber = `INV-${Date.now()}`;
    const invoice = await storage.createInvoice({
      companyId: quote.companyId,
      number: invoiceNumber,
      customerName: quote.customerName,
      customerTrn: quote.customerTrn,
      date: new Date(),
      currency: quote.currency,
      subtotal: quote.subtotal,
      vatAmount: quote.vatAmount,
      total: quote.total,
      status: 'draft',
    });

    // Copy lines to invoice
    for (const line of lines) {
      await storage.createInvoiceLine({
        invoiceId: invoice.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        vatSupplyType: line.vatSupplyType,
      });
    }

    // Mark quote as converted
    await storage.updateQuote(id, {
      status: 'converted',
      convertedInvoiceId: invoice.id,
    });

    logger.info({ quoteId: id, invoiceId: invoice.id }, 'Quote converted to invoice');
    res.json({ invoice, message: 'Quote converted to invoice' });
  }));

  // Customer-only: Generate PDF
  app.get('/api/quotes/:id/pdf', authMiddleware, requireCustomer, requireFeature('quotes'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const quote = await storage.getQuote(id);
    if (!quote) {
      return res.status(404).json({ message: 'Quote not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, quote.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const lines = await storage.getQuoteLinesByQuoteId(id);
    const company = await storage.getCompany(quote.companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const pdfBuffer = await generateQuotePDF(quote, lines, company);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quote-${quote.number}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }));
}
