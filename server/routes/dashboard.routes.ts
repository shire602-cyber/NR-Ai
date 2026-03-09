import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";

/**
 * Register all dashboard and basic report routes.
 */
export function registerDashboardRoutes(app: Express) {
  // =====================================
  // Dashboard Stats Routes
  // =====================================

  app.get("/api/companies/:companyId/dashboard/stats", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const invoices = await storage.getInvoicesByCompanyId(companyId);
    const entries = await storage.getJournalEntriesByCompanyId(companyId);
    const accounts = await storage.getAccountsByCompanyId(companyId);

    // Calculate from journal entries
    const balances = new Map<string, number>();
    for (const entry of entries) {
      const lines = await storage.getJournalLinesByEntryId(entry.id);
      for (const line of lines) {
        const account = accounts.find(a => a.id === line.accountId);
        if (!account) continue;

        const current = balances.get(account.type) || 0;
        if (account.type === 'income') {
          balances.set('income', current + line.credit - line.debit);
        } else if (account.type === 'expense') {
          balances.set('expense', current + line.debit - line.credit);
        }
      }
    }

    const revenue = balances.get('income') || 0;
    const expenses = balances.get('expense') || 0;
    const outstanding = invoices.filter(inv => inv.status === 'sent' || inv.status === 'draft')
      .reduce((sum, inv) => sum + inv.total, 0);

    res.json({
      revenue,
      expenses,
      outstanding,
      totalInvoices: invoices.length,
      totalEntries: entries.length,
    });
  }));

  app.get("/api/companies/:companyId/dashboard/expense-breakdown", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const entries = await storage.getJournalEntriesByCompanyId(companyId);
    const accounts = await storage.getAccountsByCompanyId(companyId);
    const expenseAccounts = accounts.filter(a => a.type === 'expense');

    const balances = new Map<string, number>();
    for (const entry of entries) {
      const lines = await storage.getJournalLinesByEntryId(entry.id);
      for (const line of lines) {
        const account = accounts.find(a => a.id === line.accountId);
        if (!account || account.type !== 'expense') continue;

        const current = balances.get(account.id) || 0;
        balances.set(account.id, current + line.debit - line.credit);
      }
    }

    const breakdown = expenseAccounts
      .map(account => ({
        name: account.nameEn,
        value: balances.get(account.id) || 0,
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5); // Top 5 expenses

    res.json(breakdown);
  }));

  app.get("/api/companies/:companyId/dashboard/monthly-trends", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const invoices = await storage.getInvoicesByCompanyId(companyId);
    const entries = await storage.getJournalEntriesByCompanyId(companyId);
    const accounts = await storage.getAccountsByCompanyId(companyId);

    // Get last 6 months
    const months = Array.from({ length: 6 }, (_, i) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - i));
      return {
        month: date.toLocaleDateString('en-US', { month: 'short' }),
        monthNum: date.getMonth(),
        yearNum: date.getFullYear(),
      };
    });

    const trends = await Promise.all(months.map(async ({ month, monthNum, yearNum }) => {
      // Calculate revenue from invoices
      const revenue = invoices
        .filter(inv => {
          const invDate = new Date(inv.date);
          return invDate.getMonth() === monthNum && invDate.getFullYear() === yearNum;
        })
        .reduce((sum, inv) => sum + (inv.subtotal || 0), 0);

      // Calculate expenses from journal entries
      let expenses = 0;
      for (const entry of entries) {
        const entryDate = new Date(entry.date);
        if (entryDate.getMonth() === monthNum && entryDate.getFullYear() === yearNum) {
          const lines = await storage.getJournalLinesByEntryId(entry.id);
          for (const line of lines) {
            const account = accounts.find(a => a.id === line.accountId);
            if (account && account.type === 'expense') {
              expenses += line.debit - line.credit;
            }
          }
        }
      }

      return { month, revenue, expenses };
    }));

    res.json(trends);
  }));

  // =====================================
  // Reports Routes
  // =====================================

  app.get("/api/companies/:companyId/reports/pl", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;

    const accounts = await storage.getAccountsByCompanyId(companyId);
    let entries = await storage.getJournalEntriesByCompanyId(companyId);

    // Filter entries by date range if provided
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate as string) : null;
      const end = endDate ? new Date(endDate as string) : null;

      entries = entries.filter(entry => {
        const entryDate = new Date(entry.date);
        if (start && entryDate < start) return false;
        if (end && entryDate > end) return false;
        return true;
      });
    }

    // Calculate balances for each account
    const balances = new Map<string, number>();

    for (const entry of entries) {
      const lines = await storage.getJournalLinesByEntryId(entry.id);
      for (const line of lines) {
        const account = accounts.find(a => a.id === line.accountId);
        if (!account) continue;

        const current = balances.get(account.id) || 0;
        if (account.type === 'income') {
          balances.set(account.id, current + line.credit - line.debit);
        } else if (account.type === 'expense') {
          balances.set(account.id, current + line.debit - line.credit);
        }
      }
    }

    const revenue = accounts
      .filter(a => a.type === 'income')
      .map(a => ({
        accountName: a.nameEn,
        amount: balances.get(a.id) || 0,
      }))
      .filter(item => item.amount > 0);

    const expenses = accounts
      .filter(a => a.type === 'expense')
      .map(a => ({
        accountName: a.nameEn,
        amount: balances.get(a.id) || 0,
      }))
      .filter(item => item.amount > 0);

    const totalRevenue = revenue.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
    const netProfit = totalRevenue - totalExpenses;

    res.json({
      revenue,
      expenses,
      totalRevenue,
      totalExpenses,
      netProfit,
    });
  }));

  app.get("/api/companies/:companyId/reports/balance-sheet", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;

    const accounts = await storage.getAccountsByCompanyId(companyId);
    let entries = await storage.getJournalEntriesByCompanyId(companyId);

    // Filter entries by date range if provided
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate as string) : null;
      const end = endDate ? new Date(endDate as string) : null;

      entries = entries.filter(entry => {
        const entryDate = new Date(entry.date);
        if (start && entryDate < start) return false;
        if (end && entryDate > end) return false;
        return true;
      });
    }

    // Calculate balances
    const balances = new Map<string, number>();

    for (const entry of entries) {
      const lines = await storage.getJournalLinesByEntryId(entry.id);
      for (const line of lines) {
        const account = accounts.find(a => a.id === line.accountId);
        if (!account) continue;

        const current = balances.get(account.id) || 0;
        if (account.type === 'asset' || account.type === 'expense') {
          balances.set(account.id, current + line.debit - line.credit);
        } else {
          balances.set(account.id, current + line.credit - line.debit);
        }
      }
    }

    const assets = accounts
      .filter(a => a.type === 'asset')
      .map(a => ({
        accountName: a.nameEn,
        amount: balances.get(a.id) || 0,
      }));

    const liabilities = accounts
      .filter(a => a.type === 'liability')
      .map(a => ({
        accountName: a.nameEn,
        amount: balances.get(a.id) || 0,
      }));

    const equity = accounts
      .filter(a => a.type === 'equity')
      .map(a => ({
        accountName: a.nameEn,
        amount: balances.get(a.id) || 0,
      }));

    const totalAssets = assets.reduce((sum, item) => sum + item.amount, 0);
    const totalLiabilities = liabilities.reduce((sum, item) => sum + item.amount, 0);
    const totalEquity = equity.reduce((sum, item) => sum + item.amount, 0);

    res.json({
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
    });
  }));

  app.get("/api/companies/:companyId/reports/vat-summary", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;

    let invoices = await storage.getInvoicesByCompanyId(companyId);
    let receipts = await storage.getReceiptsByCompanyId(companyId);

    // Filter invoices by date range if provided
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate as string) : null;
      const end = endDate ? new Date(endDate as string) : null;

      invoices = invoices.filter(invoice => {
        const invoiceDate = new Date(invoice.date);
        if (start && invoiceDate < start) return false;
        if (end && invoiceDate > end) return false;
        return true;
      });

      receipts = receipts.filter(receipt => {
        const receiptDate = new Date(receipt.date);
        if (start && receiptDate < start) return false;
        if (end && receiptDate > end) return false;
        return true;
      });
    }

    let salesSubtotal = 0;
    let salesVAT = 0;

    for (const invoice of invoices) {
      if (invoice.status !== 'void') {
        salesSubtotal += invoice.subtotal;
        salesVAT += invoice.vatAmount;
      }
    }

    // Calculate purchases VAT from posted receipts/expenses
    // Note: receipt.amount is the subtotal (VAT-exclusive), receipt.vatAmount is the VAT component
    let purchasesSubtotal = 0;
    let purchasesVAT = 0;

    for (const receipt of receipts) {
      if (receipt.posted) {
        // receipt.amount = subtotal (VAT-exclusive)
        // receipt.vatAmount = VAT amount (separate field)
        purchasesSubtotal += (receipt.amount || 0);
        purchasesVAT += (receipt.vatAmount || 0);
      }
    }

    const netVATPayable = salesVAT - purchasesVAT;

    res.json({
      period: 'Current Period',
      salesSubtotal,
      salesVAT,
      purchasesSubtotal,
      purchasesVAT,
      netVATPayable,
    });
  }));

  // =====================================
  // Dashboard Routes
  // =====================================

  app.get("/api/dashboard/stats", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId) {
      return res.json({ revenue: 0, expenses: 0, outstanding: 0, totalInvoices: 0, totalEntries: 0 });
    }

    const invoices = await storage.getInvoicesByCompanyId(companyId as string);
    const accounts = await storage.getAccountsByCompanyId(companyId as string);
    const entries = await storage.getJournalEntriesByCompanyId(companyId as string);

    // Calculate revenue and expenses from journal entries
    const balances = new Map<string, number>();
    for (const entry of entries) {
      const lines = await storage.getJournalLinesByEntryId(entry.id);
      for (const line of lines) {
        const account = accounts.find(a => a.id === line.accountId);
        if (!account) continue;
        const current = balances.get(account.type) || 0;
        if (account.type === 'income') {
          balances.set('income', current + line.credit - line.debit);
        } else if (account.type === 'expense') {
          balances.set('expense', current + line.debit - line.credit);
        }
      }
    }

    const outstanding = invoices
      .filter(inv => inv.status === 'sent' || inv.status === 'draft')
      .reduce((sum, inv) => sum + inv.total, 0);

    res.json({
      revenue: balances.get('income') || 0,
      expenses: balances.get('expense') || 0,
      outstanding,
      totalInvoices: invoices.length,
      totalEntries: entries.length,
    });
  }));

  app.get("/api/dashboard/recent-invoices", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId) {
      return res.json([]);
    }

    const invoices = await storage.getInvoicesByCompanyId(companyId as string);
    res.json(invoices.slice(0, 5));
  }));

  app.get("/api/dashboard/expense-breakdown", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId) {
      return res.json([]);
    }

    const accounts = await storage.getAccountsByCompanyId(companyId as string);
    const entries = await storage.getJournalEntriesByCompanyId(companyId as string);

    const balances = new Map<string, { name: string; value: number }>();

    for (const entry of entries) {
      const lines = await storage.getJournalLinesByEntryId(entry.id);
      for (const line of lines) {
        const account = accounts.find(a => a.id === line.accountId);
        if (!account || account.type !== 'expense') continue;

        const current = balances.get(account.id) || { name: account.nameEn, value: 0 };
        current.value += line.debit - line.credit;
        balances.set(account.id, current);
      }
    }

    const data = Array.from(balances.values())
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    res.json(data);
  }));
}
