import { Router, type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { insertInvoiceSchema, type Account, type Receipt } from '../../shared/schema';
import { saveReceiptImage, deleteReceiptImage, resolveImagePath } from '../services/fileStorage';
import { createAndEmitNotification } from '../services/socket.service';
import { assertPeriodNotLocked } from '../services/period-lock.service';
import { recordAudit } from '../services/audit.service';
import { createLogger } from '../config/logger';
import { assertRetentionExpired } from '../services/retention.service';
import {
  buildOcrReceiptsWorkbook,
  buildExportFilename,
  receiptToExportRow,
} from '../services/excel-export.service';
// @ts-ignore
import PDFDocument from 'pdfkit';

const log = createLogger('receipts');

// Walk the user's companies and return the first match — storage.getReceipt is
// tenant-scoped, so a hit here also proves the user has access.
async function findReceiptForUser(userId: string, receiptId: string): Promise<Receipt | undefined> {
  const userCompanies = await storage.getCompaniesByUserId(userId);
  for (const c of userCompanies) {
    const receipt = await storage.getReceipt(receiptId, c.id);
    if (receipt) return receipt;
  }
  return undefined;
}

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

  // Bulk Excel export for saved receipts. Optional `ids` filters down to a
  // specific subset (e.g. user selected rows in the UI). All filtering happens
  // server-side after a tenant scope check so cross-company leaks are
  // impossible.
  app.post(
    '/api/companies/:companyId/receipts/export-excel',
    authMiddleware,
    requireCustomer,
    validate({ body: receiptsExportSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const { ids } = req.body as z.infer<typeof receiptsExportSchema>;
      const all = await storage.getReceiptsByCompanyId(companyId);
      const subset = ids && ids.length > 0
        ? all.filter((r) => ids.includes(r.id))
        : all;

      const rows = subset.map((r) =>
        receiptToExportRow({
          date: r.date,
          merchant: r.merchant,
          // receipts table doesn't store invoiceNumber; export it as blank.
          invoiceNumber: null,
          amount: r.amount as unknown as number,
          vatAmount: r.vatAmount as unknown as number,
          currency: r.currency,
        }),
      );

      const buffer = await buildOcrReceiptsWorkbook(rows, {
        sheetName: 'Receipts',
        title: 'Muhasib Receipts Export',
      });
      const filename = buildExportFilename('muhasib-receipts');

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    }),
  );

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

  app.post("/api/companies/:companyId/receipts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { imageData, ...receiptData } = req.body;

    // Block receipt creation in a locked period — receipts are eventually
    // posted as journal entries dated on receipt.date.
    if (receiptData.date) {
      await assertPeriodNotLocked(companyId, receiptData.date);
    }

    log.info({
      companyId,
      userId,
      merchant: receiptData.merchant,
      amount: receiptData.amount,
      hasImageData: !!imageData,
      imageDataLength: imageData?.length,
    }, 'Creating receipt');

    // Save image to disk; store only the path in Postgres (not the base64 blob).
    // Validate MIME type from the data URL — never trust the filename extension.
    const ALLOWED_RECEIPT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    let imagePath: string | undefined;
    if (imageData) {
      if (typeof imageData !== 'string') {
        return res.status(400).json({ message: 'Invalid image data' });
      }
      const dataUrlMatch = imageData.match(/^data:([^;]+);base64,/);
      const mimeType = dataUrlMatch ? dataUrlMatch[1].toLowerCase() : null;
      if (!mimeType || !ALLOWED_RECEIPT_MIME.includes(mimeType)) {
        return res.status(400).json({
          message: 'Invalid image MIME type. Allowed: JPEG, PNG, WebP, GIF.',
        });
      }
      const { randomUUID } = await import('crypto');
      imagePath = await saveReceiptImage(imageData, `${randomUUID()}.jpg`);
    }

    const receipt = await storage.createReceipt({
      ...receiptData,
      companyId,
      uploadedBy: userId,
      imagePath: imagePath ?? null,
      // imageData intentionally omitted — not stored in Postgres
    });

    log.info({ receiptId: receipt.id }, 'Receipt created successfully');

    await recordAudit({
      userId,
      companyId,
      action: 'receipt.create',
      entityType: 'receipt',
      entityId: receipt.id,
      before: null,
      after: { merchant: receipt.merchant, amount: receipt.amount, currency: receipt.currency },
      req,
    });

    createAndEmitNotification({
      userId,
      companyId,
      type: 'document_uploaded',
      title: 'Receipt uploaded',
      message: `New receipt from ${receipt.merchant || 'unknown merchant'} for ${receipt.amount ?? ''} ${receipt.currency || ''}`.trim(),
      priority: 'normal',
      relatedEntityType: 'receipt',
      relatedEntityId: receipt.id,
      actionUrl: '/receipts',
    }).catch(() => {});

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

    const before = await findReceiptForUser(userId, id);
    if (!before) {
      return res.status(404).json({ message: 'Receipt not found' });
    }
    const updatedReceipt = await storage.updateReceipt(id, before.companyId, req.body);
    await recordAudit({
      userId,
      companyId: updatedReceipt.companyId,
      action: 'receipt.update',
      entityType: 'receipt',
      entityId: id,
      before: { merchant: before.merchant, amount: before.amount, accountId: before.accountId },
      after: {
        merchant: updatedReceipt.merchant,
        amount: updatedReceipt.amount,
        accountId: updatedReceipt.accountId,
      },
      req,
    });
    log.info({ id }, 'Receipt updated successfully');
    res.json(updatedReceipt);
  }));

  // Customer-only: Delete receipt
  app.delete("/api/receipts/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Remove image file before deleting DB row (best-effort; don't block on failure)
    const existing = await findReceiptForUser(userId, id);
    if (!existing) {
      return res.status(404).json({ message: 'Receipt not found' });
    }
    const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }
    // FTA 5-year retention.
    assertRetentionExpired(existing as { createdAt: Date | string; retentionExpiresAt?: Date | string | null }, 'Receipt');

    if (existing.imagePath) {
      await deleteReceiptImage(existing.imagePath);
    }

    await storage.deleteReceipt(id, existing.companyId);

    await recordAudit({
      userId,
      companyId: existing.companyId,
      action: 'receipt.delete',
      entityType: 'receipt',
      entityId: id,
      before: { merchant: existing.merchant, amount: existing.amount },
      after: null,
      req,
    });

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

    // Get receipt — findReceiptForUser also enforces tenant access.
    const receipt = await findReceiptForUser(userId, id);
    if (!receipt) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    // Check if already posted
    if (receipt.posted) {
      return res.status(400).json({ message: 'Receipt has already been posted' });
    }

    // Validate amount is present and positive
    const subtotalForeign = receipt.amount || 0;
    const vatAmountForeign = receipt.vatAmount || 0;
    const totalAmountForeign = subtotalForeign + vatAmountForeign;
    if (totalAmountForeign <= 0) {
      return res.status(400).json({ message: 'Receipt amount must be greater than zero' });
    }

    // FX: convert foreign-currency receipt amounts to AED for the journal,
    // since journal lines are stored in base currency (AED). Receipts created
    // before FX support default to currency='AED' and exchangeRate=1, so this
    // is a no-op for AED receipts.
    const receiptCurrency = receipt.currency || 'AED';
    const isForeign = receiptCurrency !== 'AED';
    const fxRate = Number(receipt.exchangeRate) || 1;
    if (isForeign && fxRate <= 0) {
      return res.status(400).json({ message: 'Foreign-currency receipt is missing a valid exchange rate' });
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const subtotal = isForeign ? round2(subtotalForeign * fxRate) : subtotalForeign;
    const vatAmount = isForeign ? round2(vatAmountForeign * fxRate) : vatAmountForeign;
    // Recompute the total from rounded components so debits/credits balance
    // exactly (avoids 1-cent rounding drift that would fail the JE balance check).
    const totalAmount = subtotal + vatAmount;

    // Get accounts (tenant-scoped to the receipt's company — cross-tenant
    // accounts simply won't be found) and validate they exist and are correct types.
    const expenseAccount = await storage.getAccount(accountId, receipt.companyId);
    const paymentAccount = await storage.getAccount(paymentAccountId, receipt.companyId);

    if (!expenseAccount || !paymentAccount) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Validate account types
    if (expenseAccount.type !== 'expense') {
      return res.status(400).json({ message: 'Selected account must be an expense account' });
    }

    if (paymentAccount.type !== 'asset') {
      return res.status(400).json({ message: 'Payment account must be a cash or bank account (asset)' });
    }

    // Look up Input VAT (recoverable) and, for reverse-charge receipts, Output
    // VAT (payable) accounts by vatType to avoid hardcoded name matching.
    const isReverseCharge = !!(receipt as any).reverseCharge;
    let vatRecoverableAccount: Account | null = null;
    let vatPayableAccount: Account | null = null;
    if (vatAmount > 0) {
      const companyAccounts = await storage.getAccountsByCompanyId(receipt.companyId);
      vatRecoverableAccount = companyAccounts.find(
        a => a.isVatAccount && a.vatType === 'input' && a.isActive
      ) || null;
      if (isReverseCharge) {
        vatPayableAccount = companyAccounts.find(
          a => a.isVatAccount && a.vatType === 'output' && a.isActive
        ) || null;
        if (!vatRecoverableAccount || !vatPayableAccount) {
          return res.status(400).json({
            message: 'Reverse-charge posting requires both Input VAT and Output VAT accounts in the chart of accounts',
          });
        }
      }
    }

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

    // Block posting receipts into a locked period.
    await assertPeriodNotLocked(receipt.companyId, entryDate);

    // Generate entry number atomically via storage helper
    const entryNumber = await storage.generateEntryNumber(receipt.companyId, entryDate);

    // Build journal lines. Three shapes:
    //  - Reverse-charge with VAT: 4-line entry. The vendor doesn't charge VAT,
    //    so cash payable = subtotal. The buyer self-assesses both sides:
    //    Dr Expense, Dr Input VAT, Cr Output VAT, Cr Cash.
    //  - Standard with VAT: 3-line entry (Dr Expense, Dr Input VAT, Cr Cash).
    //  - No VAT (or no Input VAT account): 2-line entry (Dr Expense, Cr Cash).
    type JournalLineInput = {
      accountId: string;
      debit: number;
      credit: number;
      description: string;
      foreignCurrency?: string | null;
      foreignDebit?: number;
      foreignCredit?: number;
      exchangeRate?: number;
    };
    const journalLineInputs: JournalLineInput[] = [];

    // Helper to attach foreign-currency tracking to a line when the receipt
    // is in a non-AED currency, so the original amount and rate are preserved.
    const withFx = (line: JournalLineInput, foreignDebit: number, foreignCredit: number): JournalLineInput => {
      if (!isForeign) return line;
      return {
        ...line,
        foreignCurrency: receiptCurrency,
        foreignDebit: round2(foreignDebit),
        foreignCredit: round2(foreignCredit),
        exchangeRate: fxRate,
      };
    };

    if (isReverseCharge && vatAmount > 0 && vatRecoverableAccount && vatPayableAccount) {
      // Reverse-charge: vendor charges no VAT, buyer self-assesses both legs.
      journalLineInputs.push(withFx({
        accountId: expenseAccount.id,
        debit: subtotal,
        credit: 0,
        description: `${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
      }, subtotalForeign, 0));
      journalLineInputs.push(withFx({
        accountId: vatRecoverableAccount.id,
        debit: vatAmount,
        credit: 0,
        description: `Input VAT (reverse-charge) - ${receipt.merchant || 'expense'}`,
      }, vatAmountForeign, 0));
      journalLineInputs.push(withFx({
        accountId: vatPayableAccount.id,
        debit: 0,
        credit: vatAmount,
        description: `Output VAT (reverse-charge) - ${receipt.merchant || 'expense'}`,
      }, 0, vatAmountForeign));
      journalLineInputs.push(withFx({
        accountId: paymentAccount.id,
        debit: 0,
        credit: subtotal,
        description: `Payment for ${receipt.merchant || 'expense'}`,
      }, 0, subtotalForeign));
    } else if (vatAmount > 0 && vatRecoverableAccount) {
      // 3-line entry: Debit Expense (subtotal), Debit VAT Recoverable (VAT), Credit Cash (total)
      journalLineInputs.push(withFx({
        accountId: expenseAccount.id,
        debit: subtotal,
        credit: 0,
        description: `${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
      }, subtotalForeign, 0));
      journalLineInputs.push(withFx({
        accountId: vatRecoverableAccount.id,
        debit: vatAmount,
        credit: 0,
        description: `Input VAT - ${receipt.merchant || 'expense'}`,
      }, vatAmountForeign, 0));
      journalLineInputs.push(withFx({
        accountId: paymentAccount.id,
        debit: 0,
        credit: totalAmount,
        description: `Payment for ${receipt.merchant || 'expense'}`,
      }, 0, totalAmountForeign));
    } else {
      // 2-line entry: Debit Expense (total), Credit Cash (total)
      journalLineInputs.push(withFx({
        accountId: expenseAccount.id,
        debit: totalAmount,
        credit: 0,
        description: `${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
      }, totalAmountForeign, 0));
      journalLineInputs.push(withFx({
        accountId: paymentAccount.id,
        debit: 0,
        credit: totalAmount,
        description: `Payment for ${receipt.merchant || 'expense'}`,
      }, 0, totalAmountForeign));
    }

    // Create journal entry with lines atomically (validates balance & wraps in transaction)
    const entry = await storage.createJournalEntry(
      {
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
      },
      journalLineInputs
    );

    // Update receipt with posting information
    const updatedReceipt = await storage.updateReceipt(id, receipt.companyId, {
      accountId,
      paymentAccountId,
      posted: true,
      journalEntryId: entry.id,
    });

    log.info({ id, journalEntryId: entry.id }, 'Receipt posted successfully');
    res.json(updatedReceipt);
  }));

  // Customer-only: Batch export receipts as multi-page PDF
  app.get("/api/companies/:companyId/receipts/export-pdf", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const { from, to, category } = req.query as { from?: string; to?: string; category?: string };
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ message: 'Company not found' });

    let receipts = await storage.getReceiptsByCompanyId(companyId);

    if (from) {
      const fromDate = new Date(from);
      receipts = receipts.filter(r => r.date && new Date(r.date) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      receipts = receipts.filter(r => r.date && new Date(r.date) <= toDate);
    }
    if (category && category !== 'all') {
      receipts = receipts.filter(r => r.category === category);
    }

    if (!receipts.length) {
      return res.status(404).json({ message: 'No receipts found for the given filters' });
    }

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: false });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = 595.28;
      const margin = 50;
      const contentWidth = pageWidth - 2 * margin;
      const labelColor = '#6B7280';
      const valueColor = '#111827';

      // Summary page
      doc.addPage();
      doc.rect(0, 0, pageWidth, 80).fill('#1E40AF');
      doc.fontSize(20).fillColor('#FFFFFF').font('Helvetica-Bold');
      doc.text(company.name, margin, 20, { width: contentWidth });
      doc.fontSize(12).font('Helvetica');
      doc.text('EXPENSE RECEIPTS EXPORT', margin, 48, { width: contentWidth });

      let sy = 100;
      // receipts.amount stores the net subtotal (VAT excluded); the receipt
      // total displayed to the user is amount + vatAmount.
      const totalSubtotal = receipts.reduce((sum, r) => sum + (r.amount ?? 0), 0);
      const totalVat = receipts.reduce((sum, r) => sum + (r.vatAmount ?? 0), 0);
      const totalAmount = totalSubtotal + totalVat;
      const dateRangeStr = from && to ? `${from} to ${to}` : from ? `From ${from}` : to ? `To ${to}` : 'All time';

      doc.fontSize(11).fillColor(labelColor).font('Helvetica-Bold').text('Export Summary', margin, sy);
      sy += 20;
      doc.moveTo(margin, sy).lineTo(margin + contentWidth, sy).stroke('#E5E7EB');
      sy += 14;

      const summaryRow = (label: string, value: string) => {
        doc.fontSize(10).fillColor(labelColor).font('Helvetica').text(label, margin, sy, { width: 200 });
        doc.fontSize(10).fillColor(valueColor).font('Helvetica-Bold').text(value, margin + 200, sy, { width: contentWidth - 200 });
        sy += 18;
      };

      summaryRow('Date Range:', dateRangeStr);
      if (category && category !== 'all') summaryRow('Category:', category);
      summaryRow('Total Receipts:', receipts.length.toString());
      summaryRow('Total Amount:', `AED ${totalAmount.toFixed(2)}`);
      if (totalVat > 0) summaryRow('Total VAT:', `AED ${totalVat.toFixed(2)}`);

      sy += 20;
      // Summary table header
      doc.rect(margin, sy, contentWidth, 24).fill('#F3F4F6');
      doc.fontSize(9).fillColor('#374151').font('Helvetica-Bold');
      doc.text('#', margin + 4, sy + 7, { width: 24 });
      doc.text('Date', margin + 30, sy + 7, { width: 70 });
      doc.text('Merchant', margin + 105, sy + 7, { width: 160 });
      doc.text('Category', margin + 270, sy + 7, { width: 110 });
      doc.text('Amount', margin + 385, sy + 7, { width: contentWidth - 385, align: 'right' });
      sy += 26;

      receipts.forEach((r, idx) => {
        if (sy > 750) {
          doc.addPage();
          sy = margin;
        }
        if (idx % 2 === 1) doc.rect(margin, sy - 2, contentWidth, 18).fill('#F9FAFB');
        doc.fontSize(8).fillColor(valueColor).font('Helvetica');
        doc.text((idx + 1).toString(), margin + 4, sy, { width: 24 });
        doc.text(r.date ? new Date(r.date).toLocaleDateString('en-AE') : '-', margin + 30, sy, { width: 70 });
        doc.text(r.merchant || 'Unknown', margin + 105, sy, { width: 160 });
        doc.text(r.category || 'Uncategorized', margin + 270, sy, { width: 110 });
        const rowTotal = (r.amount ?? 0) + (r.vatAmount ?? 0);
        doc.text(`${r.currency || 'AED'} ${rowTotal.toFixed(2)}`, margin + 385, sy, { width: contentWidth - 385, align: 'right' });
        sy += 16;
      });

      // Total row
      sy += 4;
      doc.moveTo(margin, sy).lineTo(margin + contentWidth, sy).stroke('#E5E7EB');
      sy += 8;
      doc.fontSize(9).fillColor('#1E40AF').font('Helvetica-Bold');
      doc.text('TOTAL', margin + 270, sy, { width: 110 });
      doc.text(`AED ${totalAmount.toFixed(2)}`, margin + 385, sy, { width: contentWidth - 385, align: 'right' });

      // Individual receipt pages
      receipts.forEach((r) => {
        doc.addPage();

        doc.rect(0, 0, pageWidth, 70).fill('#1E40AF');
        doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold');
        doc.text(company.name, margin, 14, { width: contentWidth });
        doc.fontSize(10).font('Helvetica');
        doc.text('EXPENSE RECEIPT', margin, 40, { width: contentWidth, align: 'right' });

        let y = 88;
        const addRow = (label: string, value: string) => {
          doc.fontSize(9).fillColor(labelColor).font('Helvetica-Bold').text(label, margin, y, { width: 120 });
          doc.fontSize(9).fillColor(valueColor).font('Helvetica').text(value, margin + 130, y, { width: contentWidth - 130 });
          y += 18;
        };

        addRow('Merchant:', r.merchant || 'N/A');
        addRow('Date:', r.date ? new Date(r.date).toLocaleDateString('en-AE') : 'N/A');
        addRow('Category:', r.category || 'Uncategorized');
        addRow('Currency:', r.currency || 'AED');
        y += 6;

        doc.rect(margin, y, contentWidth, 44).fill('#F9FAFB').stroke('#E5E7EB');
        doc.fontSize(11).fillColor('#1F2937').font('Helvetica-Bold');
        doc.text('Total Amount', margin + 12, y + 8);
        doc.fontSize(15).fillColor('#1E40AF');
        const receiptTotal = (r.amount ?? 0) + (r.vatAmount ?? 0);
        doc.text(`${r.currency || 'AED'} ${receiptTotal.toFixed(2)}`, margin + 12, y + 22, { width: contentWidth - 24, align: 'right' });
        y += 58;

        if (r.vatAmount && r.vatAmount > 0) {
          doc.fontSize(9).fillColor(labelColor).font('Helvetica');
          const base = (r.amount ?? 0).toFixed(2);
          doc.text(`Base: ${r.currency || 'AED'} ${base}   VAT: ${r.currency || 'AED'} ${r.vatAmount.toFixed(2)}`, margin, y);
          y += 18;
        }

        if (r.rawText) {
          y += 6;
          doc.fontSize(9).fillColor(labelColor).font('Helvetica-Bold').text('OCR Text:', margin, y);
          y += 14;
          doc.fontSize(8).fillColor(valueColor).font('Helvetica').text(r.rawText.slice(0, 300), margin, y, { width: contentWidth });
        }

        doc.fontSize(7).fillColor('#9CA3AF').font('Helvetica');
        doc.text(`Generated by ${company.name} · ${new Date().toLocaleDateString('en-AE')}`, margin, 780, { width: contentWidth, align: 'center' });
      });

      doc.end();
    });

    const dateTag = from && to ? `_${from}_to_${to}` : '';
    const catTag = category && category !== 'all' ? `_${category.replace(/\s+/g, '-')}` : '';

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipts${dateTag}${catTag}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }));

  // Customer-only: Serve receipt image (new file-based or legacy base64)
  app.get("/api/companies/:companyId/receipts/:id/image", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const receipt = await storage.getReceipt(id, companyId);
    if (!receipt) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    if (receipt.imagePath) {
      try {
        return res.sendFile(resolveImagePath(receipt.imagePath));
      } catch {
        return res.status(404).json({ message: 'No image available for this receipt' });
      }
    }

    // Backward compat: legacy records that have base64 imageData but no imagePath
    if (receipt.imageData) {
      const raw = receipt.imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(raw, 'base64');
      res.set('Content-Type', 'image/jpeg');
      return res.send(buffer);
    }

    return res.status(404).json({ message: 'No image available for this receipt' });
  }));

  // Customer-only: Download receipt as PDF
  app.get("/api/companies/:companyId/receipts/:id/pdf", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId, id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const receipt = await storage.getReceipt(id, companyId);
    if (!receipt) {
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
      const total = ((receipt.amount ?? 0) + (receipt.vatAmount ?? 0)).toFixed(2);
      doc.text(`${receipt.currency || 'AED'} ${total}`, margin + 10, y + 22, { width: contentWidth - 20, align: 'right' });
      y += 55;

      if (receipt.vatAmount && receipt.vatAmount > 0) {
        doc.fontSize(9).fillColor(labelColor).font('Helvetica');
        const base = (receipt.amount ?? 0).toFixed(2);
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

// Body schema for the bulk Excel export. `ids` is optional — omitting it (or
// passing an empty array) exports every receipt the company has access to.
const receiptsExportSchema = z.object({
  ids: z.array(z.string().uuid()).max(5000).optional(),
});
