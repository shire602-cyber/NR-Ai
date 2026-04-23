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

  async function getEnhancedDashboardStats(companyId: string) {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [invoices, accounts, entries, allLines, receipts] = await Promise.all([
      storage.getInvoicesByCompanyId(companyId),
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
      storage.getReceiptsByCompanyId(companyId),
    ]);

    const entryDateMap = new Map<string, Date>(entries.map(e => [e.id, new Date(e.date)]));
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    // Per-account all-time balance
    const allTimeBalance = new Map<string, number>();
    // Income/expense per account for current and last month
    const currentMonthBalance = new Map<string, number>();
    const lastMonthBalance = new Map<string, number>();
    // Monthly expense totals for last 3 completed months
    const burnMonthlyTotals: number[] = [0, 0, 0];

    for (const line of allLines) {
      const account = accountMap.get(line.accountId);
      if (!account) continue;
      const entryDate = entryDateMap.get(line.entryId);
      if (!entryDate) continue;

      const debit = line.debit || 0;
      const credit = line.credit || 0;

      // All-time balance (normal balance by type)
      const prev = allTimeBalance.get(line.accountId) || 0;
      if (account.type === 'asset' || account.type === 'expense') {
        allTimeBalance.set(line.accountId, prev + debit - credit);
      } else {
        allTimeBalance.set(line.accountId, prev + credit - debit);
      }

      // Current month income/expense
      if (entryDate >= currentMonthStart) {
        const cb = currentMonthBalance.get(line.accountId) || 0;
        if (account.type === 'income') currentMonthBalance.set(line.accountId, cb + credit - debit);
        else if (account.type === 'expense') currentMonthBalance.set(line.accountId, cb + debit - credit);
      }

      // Last month income/expense
      if (entryDate >= lastMonthStart && entryDate <= lastMonthEnd) {
        const lb = lastMonthBalance.get(line.accountId) || 0;
        if (account.type === 'income') lastMonthBalance.set(line.accountId, lb + credit - debit);
        else if (account.type === 'expense') lastMonthBalance.set(line.accountId, lb + debit - credit);
      }

      // Burn rate: last 3 completed months' expenses
      if (account.type === 'expense') {
        for (let i = 1; i <= 3; i++) {
          const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
          if (entryDate >= mStart && entryDate <= mEnd) {
            burnMonthlyTotals[i - 1] += debit - credit;
          }
        }
      }
    }

    // ── Cash Position ─────────────────────────────────────────────
    // Asset accounts whose name suggests cash/bank, or subType = current_asset
    const cashAccountIds = new Set(
      accounts.filter(a =>
        a.type === 'asset' && (
          a.subType === 'current_asset' ||
          a.nameEn.toLowerCase().includes('cash') ||
          a.nameEn.toLowerCase().includes('bank')
        )
      ).map(a => a.id)
    );

    let cashPosition = 0;
    for (const [accountId, balance] of allTimeBalance) {
      if (cashAccountIds.has(accountId)) cashPosition += balance;
    }

    // ── Total Revenue / Expenses (all-time) ───────────────────────
    let revenue = 0;
    let expenses = 0;
    for (const [accountId, balance] of allTimeBalance) {
      const account = accountMap.get(accountId);
      if (!account) continue;
      if (account.type === 'income') revenue += balance;
      else if (account.type === 'expense') expenses += balance;
    }

    // ── Monthly Burn Rate & Runway ────────────────────────────────
    const monthlyBurnRate = burnMonthlyTotals.reduce((s, v) => s + v, 0) / 3;
    const cashRunway = monthlyBurnRate > 0 ? cashPosition / monthlyBurnRate : null;

    // ── Growth Rates ──────────────────────────────────────────────
    const currentRevenue = Array.from(currentMonthBalance.entries())
      .filter(([id]) => accountMap.get(id)?.type === 'income')
      .reduce((s, [, v]) => s + v, 0);
    const lastRevenue = Array.from(lastMonthBalance.entries())
      .filter(([id]) => accountMap.get(id)?.type === 'income')
      .reduce((s, [, v]) => s + v, 0);
    const currentExpenses = Array.from(currentMonthBalance.entries())
      .filter(([id]) => accountMap.get(id)?.type === 'expense')
      .reduce((s, [, v]) => s + v, 0);
    const lastExpenses = Array.from(lastMonthBalance.entries())
      .filter(([id]) => accountMap.get(id)?.type === 'expense')
      .reduce((s, [, v]) => s + v, 0);

    const revenueGrowth = lastRevenue > 0 ? ((currentRevenue - lastRevenue) / lastRevenue) * 100 : null;
    const expenseGrowth = lastExpenses > 0 ? ((currentExpenses - lastExpenses) / lastExpenses) * 100 : null;

    // ── Top 5 Expense Categories This Month ──────────────────────
    const topExpenseCategories = Array.from(currentMonthBalance.entries())
      .filter(([id, v]) => accountMap.get(id)?.type === 'expense' && v > 0)
      .map(([id, value]) => ({ name: accountMap.get(id)!.nameEn, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // ── AR Aging ──────────────────────────────────────────────────
    // No dueDate field; treat invoice date + 30 days as net-30 due date
    const unpaidInvoices = invoices.filter(inv => inv.status === 'sent' || inv.status === 'draft');
    const arAging = { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
    for (const inv of unpaidInvoices) {
      const daysOld = Math.floor((now.getTime() - new Date(inv.date).getTime()) / 86400000);
      if (daysOld <= 30) arAging.days0to30 += inv.total;
      else if (daysOld <= 60) arAging.days31to60 += inv.total;
      else if (daysOld <= 90) arAging.days61to90 += inv.total;
      else arAging.days90plus += inv.total;
    }

    // ── AP Aging ──────────────────────────────────────────────────
    // Unposted receipts represent outstanding payables
    const unpaidReceipts = receipts.filter(rec => !rec.posted && rec.date);
    const apAging = { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
    for (const rec of unpaidReceipts) {
      const daysOld = Math.floor((now.getTime() - new Date(rec.date!).getTime()) / 86400000);
      const amount = (rec.amount || 0) + (rec.vatAmount || 0);
      if (daysOld <= 30) apAging.days0to30 += amount;
      else if (daysOld <= 60) apAging.days31to60 += amount;
      else if (daysOld <= 90) apAging.days61to90 += amount;
      else apAging.days90plus += amount;
    }

    const outstanding = unpaidInvoices.reduce((sum, inv) => sum + inv.total, 0);

    return {
      revenue,
      expenses,
      outstanding,
      totalInvoices: invoices.length,
      totalEntries: entries.length,
      cashPosition,
      monthlyBurnRate,
      cashRunway,
      arAging,
      apAging,
      revenueGrowth,
      expenseGrowth,
      topExpenseCategories,
    };
  }

  app.get("/api/companies/:companyId/dashboard/stats", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getEnhancedDashboardStats(req.params.companyId));
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
      .slice(0, 5);

    res.json(breakdown);
  }));

  app.get("/api/companies/:companyId/dashboard/monthly-trends", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const invoices = await storage.getInvoicesByCompanyId(companyId);
    const entries = await storage.getJournalEntriesByCompanyId(companyId);
    const accounts = await storage.getAccountsByCompanyId(companyId);

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
      const revenue = invoices
        .filter(inv => {
          const invDate = new Date(inv.date);
          return invDate.getMonth() === monthNum && invDate.getFullYear() === yearNum;
        })
        .reduce((sum, inv) => sum + (inv.subtotal || 0), 0);

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
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }))
      .filter(item => item.amount > 0);

    const expenses = accounts
      .filter(a => a.type === 'expense')
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }))
      .filter(item => item.amount > 0);

    const totalRevenue = revenue.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
    const netProfit = totalRevenue - totalExpenses;

    res.json({ reportCurrency: 'AED', revenue, expenses, totalRevenue, totalExpenses, netProfit });
  }));

  app.get("/api/companies/:companyId/reports/balance-sheet", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;

    const accounts = await storage.getAccountsByCompanyId(companyId);
    let entries = await storage.getJournalEntriesByCompanyId(companyId);

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
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }));

    const liabilities = accounts
      .filter(a => a.type === 'liability')
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }));

    const equity = accounts
      .filter(a => a.type === 'equity')
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }));

    res.json({
      reportCurrency: 'AED',
      assets,
      liabilities,
      equity,
      totalAssets: assets.reduce((s, i) => s + i.amount, 0),
      totalLiabilities: liabilities.reduce((s, i) => s + i.amount, 0),
      totalEquity: equity.reduce((s, i) => s + i.amount, 0),
    });
  }));

  app.get("/api/companies/:companyId/reports/vat-summary", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;

    let invoices = await storage.getInvoicesByCompanyId(companyId);
    let receipts = await storage.getReceiptsByCompanyId(companyId);

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
        if (!receipt.date) return true;
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
        const rate = invoice.exchangeRate ?? 1;
        salesSubtotal += invoice.subtotal * rate;
        salesVAT += invoice.vatAmount * rate;
      }
    }

    let purchasesSubtotal = 0;
    let purchasesVAT = 0;
    for (const receipt of receipts) {
      if (receipt.posted) {
        const rate = receipt.exchangeRate ?? 1;
        purchasesSubtotal += (receipt.amount || 0) * rate;
        purchasesVAT += (receipt.vatAmount || 0) * rate;
      }
    }

    res.json({
      reportCurrency: 'AED',
      period: 'Current Period',
      salesSubtotal,
      salesVAT,
      purchasesSubtotal,
      purchasesVAT,
      netVATPayable: salesVAT - purchasesVAT,
    });
  }));

  // =====================================
  // Legacy / Global Dashboard Routes
  // =====================================

  app.get("/api/dashboard/stats", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId) {
      return res.json({
        revenue: 0, expenses: 0, outstanding: 0, totalInvoices: 0, totalEntries: 0,
        cashPosition: 0, monthlyBurnRate: 0, cashRunway: null,
        arAging: { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
        apAging: { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
        revenueGrowth: null, expenseGrowth: null, topExpenseCategories: [],
      });
    }
    res.json(await getEnhancedDashboardStats(companyId as string));
  }));

  app.get("/api/dashboard/summary", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId) {
      return res.json({
        revenue: 0, expenses: 0, outstanding: 0, totalInvoices: 0, totalEntries: 0,
        cashPosition: 0, monthlyBurnRate: 0, cashRunway: null,
        arAging: { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
        apAging: { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
        revenueGrowth: null, expenseGrowth: null, topExpenseCategories: [],
      });
    }
    res.json(await getEnhancedDashboardStats(companyId as string));
  }));

  app.get("/api/dashboard/recent-invoices", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId) return res.json([]);
    const invoices = await storage.getInvoicesByCompanyId(companyId as string);
    res.json(invoices.slice(0, 5));
  }));

  app.get("/api/dashboard/expense-breakdown", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.query;
    if (!companyId) return res.json([]);

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

    res.json(
      Array.from(balances.values())
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
    );
  }));
}
