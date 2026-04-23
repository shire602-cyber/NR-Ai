import { Router, type Express, type Request, type Response } from 'express';
import { storage } from '../storage';
import { z } from 'zod';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { insertInvoiceSchema } from '../../shared/schema';

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
    const subtotal = receipt.amount || 0;
    const vatAmount = receipt.vatAmount || 0;
    const totalAmount = subtotal + vatAmount;
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

    // Look up VAT Recoverable (Input VAT) account by vatType to avoid hardcoded name matching
    let vatRecoverableAccount = null;
    if (vatAmount > 0) {
      const companyAccounts = await storage.getAccountsByCompanyId(receipt.companyId);
      vatRecoverableAccount = companyAccounts.find(
        a => a.isVatAccount && a.vatType === 'input' && a.isActive
      ) || null;
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

    // Generate entry number atomically via storage helper
    const entryNumber = await storage.generateEntryNumber(receipt.companyId, entryDate);

    // Build journal lines:
    // If VAT is present and we have a VAT Recoverable account, use 3-line entry
    // Else use 2-line entry (debit expense full total, credit cash)
    const journalLineInputs: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];

    if (vatAmount > 0 && vatRecoverableAccount) {
      // 3-line entry: Debit Expense (subtotal), Debit VAT Recoverable (VAT), Credit Cash (total)
      journalLineInputs.push({
        accountId: expenseAccount.id,
        debit: subtotal,
        credit: 0,
        description: `${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
      });
      journalLineInputs.push({
        accountId: vatRecoverableAccount.id,
        debit: vatAmount,
        credit: 0,
        description: `Input VAT - ${receipt.merchant || 'expense'}`,
      });
      journalLineInputs.push({
        accountId: paymentAccount.id,
        debit: 0,
        credit: totalAmount,
        description: `Payment for ${receipt.merchant || 'expense'}`,
      });
    } else {
      // 2-line entry: Debit Expense (total), Credit Cash (total)
      journalLineInputs.push({
        accountId: expenseAccount.id,
        debit: totalAmount,
        credit: 0,
        description: `${receipt.merchant || 'Expense'} - ${receipt.category || 'General'}`,
      });
      journalLineInputs.push({
        accountId: paymentAccount.id,
        debit: 0,
        credit: totalAmount,
        description: `Payment for ${receipt.merchant || 'expense'}`,
      });
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
    const updatedReceipt = await storage.updateReceipt(id, {
      accountId,
      paymentAccountId,
      posted: true,
      journalEntryId: entry.id,
    });

    console.log('[Receipts] Receipt posted successfully:', id, 'Journal entry:', entry.id);
    res.json(updatedReceipt);
  }));
}
