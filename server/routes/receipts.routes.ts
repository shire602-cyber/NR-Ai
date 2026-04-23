import { Router, type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { insertInvoiceSchema } from '../../shared/schema';
// @ts-ignore
import PDFDocument from 'pdfkit';

export function registerReceiptRoutes(app: Express) {
  // =====================================
  // Receipt Routes
  // =====================================

  // Customer-only: Full receipts/expenses access
  app.get("/api/companies/:companyId/receipts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const receipts = await storage.getReceiptsByCompanyId(companyId);
    res.json(receipts);
  }));

  // Check for similar transactions
  // Customer-only: Check for similar receipts/transactions
  app.post("/api/companies/:companyId/receipts/check-similar", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;
    const { merchant, amount, date } = req.body;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const receipts = await storage.getReceiptsByCompanyId(companyId);

    // Find similar transactions
    const similarTransactions = receipts.filter(receipt => {
      // Check if merchant name is similar (case-insensitive partial match)
      const merchantMatch = merchant && receipt.merchant &&
        receipt.merchant.toLowerCase().includes(merchant.toLowerCase()) ||
        merchant.toLowerCase().includes(receipt.merchant?.toLowerCase() || '');

      // Check if amount is within 10% range
      const amountMatch = amount && receipt.amount &&
        Math.abs(receipt.amount - amount) / amount < 0.1;

      // Check if date is within 7 days
      let dateMatch = false;
      if (date && receipt.date) {
        const checkDate = new Date(date);
        const receiptDate = new Date(receipt.date);
        const daysDiff = Math.abs((checkDate.getTime() - receiptDate.getTime()) / (1000 * 60 * 60 * 24));
        dateMatch = daysDiff <= 7;
      }

      // Return if at least 2 criteria match
      const matchCount = [merchantMatch, amountMatch, dateMatch].filter(Boolean).length;
      return matchCount >= 2;
    });

    res.json({
      hasSimilar: similarTransactions.length > 0,
      similarTransactions: similarTransactions.slice(0, 5).map(receipt => ({
        id: receipt.id,
        merchant: receipt.merchant,
        amount: receipt.amount,
        date: receipt.date,
        category: receipt.category,
      })),
    });
  }));

  app.post("/api/companies/:companyId/receipts", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const receiptData = req.body;

    console.log('[Receipts] Creating receipt:', {
      companyId,
      userId,
      merchant: receiptData.merchant,
      amount: receiptData.amount,
      hasImageData: !!receiptData.imageData,
      imageDataLength: receiptData.imageData?.length
    });

    const receipt = await storage.createReceipt({
      ...receiptData,
      companyId, // Add companyId from URL params
      uploadedBy: userId,
    });

    console.log('[Receipts] Receipt created successfully:', receipt.id);
    res.json(receipt);
  }));

  // Customer-only: Update receipt
  app.put("/api/receipts/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Convert empty category string to null (UUID field cannot accept empty strings)
    if (req.body.category === '') {
      req.body.category = null;
    }

    const updatedReceipt = await storage.updateReceipt(id, req.body);
    console.log('[Receipts] Receipt updated successfully:', id);
    res.json(updatedReceipt);
  }));

  // Customer-only: Delete receipt
  app.delete("/api/receipts/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    await storage.deleteReceipt(id);
    res.json({ message: 'Receipt deleted successfully' });
  }));

  // Customer-only: Post receipt to journal entry
  app.post("/api/receipts/:id/post", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const { accountId, paymentAccountId } = req.body;

    // Validate required fields
    if (!accountId || !paymentAccountId) {
      return res.status(400).json({ message: 'Expense account and payment account are required' });
    }

    // Get receipt
    const receipt = await storage.getReceipt(id);
    if (!receipt) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    // Check if already posted
    if (receipt.posted) {
      return res.status(400).json({ message: 'Receipt has already been posted' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, receipt.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Validate amount is present and positive
    const totalAmount = (receipt.amount || 0) + (receipt.vatAmount || 0);
    if (totalAmount <= 0) {
      return res.status(400).json({ message: 'Receipt amount must be greater than zero' });
    }

    // Get accounts to validate they exist and are correct types
    const expenseAccount = await storage.getAccount(accountId);
    const paymentAccount = await storage.getAccount(paymentAccountId);

    if (!expenseAccount || !paymentAccount) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // CRITICAL: Validate accounts belong to the same company as the receipt
    if (expenseAccount.companyId !== receipt.companyId) {
      return res.status(403).json({ message: 'Expense account must belong to the same company as the receipt' });
    }

    if (paymentAccount.companyId !== receipt.companyId) {
      return res.status(403).json({ message: 'Payment account must belong to the same company as the receipt' });
    }

    // Validate account types
    if (expenseAccount.type !== 'expense') {
      return res.status(400).json({ message: 'Selected account must be an expense account' });
    }

    if (paymentAccount.type !== 'asset') {
      return res.status(400).json({ message: 'Payment account must be a cash or bank account (asset)' });
    }

    // TODO: Wrap in database transaction to ensure atomicity
    // For now, we'll proceed with the journal entry creation
    // In production, this should be wrapped in a transaction
    // NOTE: The operations below (journal entry creation, journal line creation,
    // and receipt update) need to be wrapped in a database transaction to prevent
    // partial writes if any step fails mid-way.

    // Parse date safely
    let entryDate: Date;
    try {
      const parsed = new Date(receipt.date || new Date());
      if (isNaN(parsed.getTime())) {
        entryDate = new Date();
      } else {
        entryDate = parsed;
      }
    } catch (e) {
      entryDate = new Date();
    }

    // Generate entry number atomically via storage helper
    const entryNumber = await storage.generateEntryNumber(receipt.companyId, entryDate);

    // Create journal entry for the receipt
    const entry = await storage.createJournalEntry({
      companyId: receipt.companyId,
      date: entryDate,
      memo: `Receipt: ${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
      entryNumber,
      status: 'posted',
      source: 'receipt',
      sourceId: receipt.id,
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
    });

    // Debit: Expense Account (total amount including VAT)
    await storage.createJournalLine({
      entryId: entry.id,
      accountId: expenseAccount.id,
      debit: totalAmount,
      credit: 0,
      description: `${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
    });

    // Credit: Payment Account (cash/bank)
    await storage.createJournalLine({
      entryId: entry.id,
      accountId: paymentAccount.id,
      debit: 0,
      credit: totalAmount,
      description: `Payment for ${receipt.merchant || 'expense'}`,
    });

    // Update receipt with posting information
    const updatedReceipt = await storage.updateReceipt(id, {
      accountId,
      paymentAccountId,
      posted: true,
      journalEntryId: entry.id,
    });

    console.log('[Receipts] Receipt posted successfully:', id, 'Journal entry:', entry.id);
    res.json(updatedReceipt);
  }));

  // Customer-only: Download receipt as PDF
  app.get("/api/companies/:companyId/receipts/:id/pdf", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const receipt = await storage.getReceipt(id);
    if (!receipt || receipt.companyId !== companyId) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = 419.53;
      const margin = 40;
      const contentWidth = pageWidth - 2 * margin;

      // Header
      doc.rect(0, 0, pageWidth, 70).fill('#1E40AF');
      doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text(company.name, margin, 15, { width: contentWidth });
      doc.fontSize(10).font('Helvetica');
      doc.text('EXPENSE RECEIPT', margin, 40, { width: contentWidth, align: 'right' });

      // Receipt details
      let y = 85;
      const labelColor = '#6B7280';
      const valueColor = '#111827';

      const addRow = (label: string, value: string) => {
        doc.fontSize(9).fillColor(labelColor).font('Helvetica-Bold').text(label, margin, y);
        doc.fontSize(9).fillColor(valueColor).font('Helvetica').text(value, margin + 100, y);
        y += 16;
      };

      addRow('Merchant:', receipt.merchant || 'N/A');
      addRow('Date:', receipt.date ? new Date(receipt.date).toLocaleDateString('en-AE') : 'N/A');
      addRow('Category:', receipt.category || 'Uncategorized');
      addRow('Currency:', receipt.currency || 'AED');
      y += 4;

      // Amount box
      doc.rect(margin, y, contentWidth, 40).fill('#F9FAFB').stroke('#E5E7EB');
      doc.fontSize(11).fillColor('#1F2937').font('Helvetica-Bold');
      doc.text('Total Amount', margin + 10, y + 8);
      doc.fontSize(14).fillColor('#1E40AF');
      const total = (receipt.amount ?? 0).toFixed(2);
      doc.text(`${receipt.currency || 'AED'} ${total}`, margin + 10, y + 22, { width: contentWidth - 20, align: 'right' });
      y += 55;

      if (receipt.vatAmount && receipt.vatAmount > 0) {
        doc.fontSize(9).fillColor(labelColor).font('Helvetica');
        const base = ((receipt.amount ?? 0) - receipt.vatAmount).toFixed(2);
        doc.text(`Base: ${receipt.currency || 'AED'} ${base}   VAT (5%): ${receipt.currency || 'AED'} ${receipt.vatAmount.toFixed(2)}`, margin, y);
        y += 16;
      }

      if (receipt.rawText) {
        y += 4;
        doc.fontSize(9).fillColor(labelColor).font('Helvetica-Bold').text('OCR Text:', margin, y);
        y += 12;
        const preview = receipt.rawText.slice(0, 200);
        doc.fontSize(8).fillColor(valueColor).font('Helvetica').text(preview, margin, y, { width: contentWidth });
      }

      // Footer
      doc.fontSize(7).fillColor('#9CA3AF').font('Helvetica');
      doc.text(`Generated by ${company.name} · ${new Date().toLocaleDateString('en-AE')}`, margin, 560, { width: contentWidth, align: 'center' });

      doc.end();
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id.slice(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }));
}
