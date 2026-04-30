import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { uaeDayStart, uaeDayEnd, uaeMonthStart, uaeMonthEnd, uaeYmdParts } from "../utils/date";

// Identifies a "real cash" account — bank, cash on hand, or petty cash.
// Used by Cash Position and any other view that should ignore non-cash
// current assets like AR, VAT Receivable, Prepaid, or Inventory.
function isCashOrBankAccount(a: { code?: string | null; nameEn: string; subType?: string | null }): boolean {
  if (a.subType === 'cash' || a.subType === 'bank') return true;
  const code = a.code ?? '';
  // Default chart-of-accounts: 1010 Cash on Hand, 1020 Bank Accounts, 1030 Petty Cash
  if (code >= '1010' && code <= '1039') return true;
  const name = a.nameEn.toLowerCase();
  return name.includes('cash') || name.includes('bank') || name.includes('petty');
}

/**
 * Register all dashboard and basic report routes.
 */
export function registerDashboardRoutes(app: Express) {
  // =====================================
  // Dashboard Stats Routes
  // =====================================

  async function getEnhancedDashboardStats(companyId: string) {
    const now = new Date();
    // Period buckets must use UAE-local calendar months. `new Date(y, m, 1)`
    // anchors at the server's local timezone, which on UTC infrastructure
    // pushes UAE late-evening activity into the previous month.
    const currentMonthStart = uaeMonthStart(now);
    const { year: nowY, month: nowM } = uaeYmdParts(now);
    const lastMonthAnchor = new Date(Date.UTC(nowY, nowM - 1, 15));
    const lastMonthStart = uaeMonthStart(lastMonthAnchor);
    const lastMonthEnd = uaeMonthEnd(lastMonthAnchor);

    const [invoices, accounts, allEntries, allLines, receipts] = await Promise.all([
      storage.getInvoicesByCompanyId(companyId),
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
      storage.getReceiptsByCompanyId(companyId),
    ]);

    // Only posted entries affect financial balances; drafts and voided
    // entries must be excluded so the dashboard does not inflate revenue,
    // expenses, or cash position.
    const entries = allEntries.filter(e => e.status === 'posted');

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

      // Burn rate: last 3 completed months' expenses (UAE calendar months).
      if (account.type === 'expense') {
        for (let i = 1; i <= 3; i++) {
          const anchor = new Date(Date.UTC(nowY, nowM - i, 15));
          const mStart = uaeMonthStart(anchor);
          const mEnd = uaeMonthEnd(anchor);
          if (entryDate >= mStart && entryDate <= mEnd) {
            burnMonthlyTotals[i - 1] += debit - credit;
          }
        }
      }
    }

    // ── Cash Position ─────────────────────────────────────────────
    // Cash position must reflect actual liquid funds only — bank accounts,
    // cash on hand, and petty cash. The previous filter keyed on
    // subType='current_asset', which also pulled in AR, VAT Receivable,
    // Prepaid Expenses, and Inventory and inflated the dashboard figure.
    // Default chart-of-accounts assigns cash codes 1010 (Cash on Hand),
    // 1020 (Bank Accounts) and 1030 (Petty Cash); custom accounts may use
    // subType='cash'/'bank' or have an explicit cash/bank/petty name.
    const cashAccountIds = new Set(
      accounts.filter(a => a.type === 'asset' && isCashOrBankAccount(a))
        .map(a => a.id)
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
    // Only legally-issued invoices count toward AR. Drafts have not been
    // delivered to the customer and create no receivable; partial means
    // some amount remains outstanding. Aging buckets count days *past due*
    // from the invoice's due date; if no dueDate, default to issue+30.
    const unpaidInvoices = invoices.filter(inv => inv.status === 'sent' || inv.status === 'partial');
    const arAging = { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
    for (const inv of unpaidInvoices) {
      const due = inv.dueDate
        ? new Date(inv.dueDate)
        : new Date(new Date(inv.date).getTime() + 30 * 86400000);
      const daysPastDue = Math.floor((now.getTime() - due.getTime()) / 86400000);
      if (daysPastDue <= 30) arAging.days0to30 += inv.total;
      else if (daysPastDue <= 60) arAging.days31to60 += inv.total;
      else if (daysPastDue <= 90) arAging.days61to90 += inv.total;
      else arAging.days90plus += inv.total;
    }

    // ── AP Aging ──────────────────────────────────────────────────
    // In this schema, a receipt is "posted" when its journal entry has
    // been created — and that JE credits the payment account, i.e. cash
    // has already left. So *unposted* receipts are the outstanding bills
    // that still owe a payment. Aging buckets count days *past due*
    // against a net-30 derived due date (the receipts table does not
    // carry an explicit dueDate). Bills not yet due land in the
    // "current" bucket so they aren't double-counted as overdue.
    const unpaidReceipts = receipts.filter(rec => !rec.posted && rec.date);
    const apAging = { current: 0, days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
    for (const rec of unpaidReceipts) {
      const due = new Date(new Date(rec.date!).getTime() + 30 * 86400000);
      const daysPastDue = Math.floor((now.getTime() - due.getTime()) / 86400000);
      const amount = (rec.amount || 0) + (rec.vatAmount || 0);
      if (daysPastDue < 0) apAging.current += amount;
      else if (daysPastDue <= 30) apAging.days0to30 += amount;
      else if (daysPastDue <= 60) apAging.days31to60 += amount;
      else if (daysPastDue <= 90) apAging.days61to90 += amount;
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
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    res.json(await getEnhancedDashboardStats(companyId));
  }));

  app.get("/api/companies/:companyId/dashboard/expense-breakdown", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    // Pull all GL lines for the tenant in a single join, then filter by
    // posted-entry membership in memory. The previous loop issued one query
    // per journal entry, which scaled linearly with ledger size.
    const [allEntries, accounts, allLines] = await Promise.all([
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
    ]);
    const postedEntryIds = new Set(allEntries.filter(e => e.status === 'posted').map(e => e.id));
    const expenseAccountIds = new Set(accounts.filter(a => a.type === 'expense').map(a => a.id));
    const accountNameById = new Map(accounts.map(a => [a.id, a.nameEn]));

    const balances = new Map<string, number>();
    for (const line of allLines) {
      if (!postedEntryIds.has(line.entryId)) continue;
      if (!expenseAccountIds.has(line.accountId)) continue;
      const current = balances.get(line.accountId) || 0;
      balances.set(line.accountId, current + line.debit - line.credit);
    }

    const breakdown = Array.from(expenseAccountIds)
      .map(id => ({ name: accountNameById.get(id)!, value: balances.get(id) || 0 }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    res.json(breakdown);
  }));

  app.get("/api/companies/:companyId/dashboard/monthly-trends", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    // Single batched fetch — issues 4 queries total instead of (months × entries).
    const [invoices, allEntries, accounts, allLines] = await Promise.all([
      storage.getInvoicesByCompanyId(companyId),
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
    ]);
    // Drafts and voided entries must not influence monthly trend totals.
    const entryDateById = new Map(
      allEntries.filter(e => e.status === 'posted').map(e => [e.id, new Date(e.date)]),
    );
    const expenseAccountIds = new Set(accounts.filter(a => a.type === 'expense').map(a => a.id));

    const months = Array.from({ length: 6 }, (_, i) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - i));
      return {
        month: date.toLocaleDateString('en-US', { month: 'short' }),
        monthNum: date.getMonth(),
        yearNum: date.getFullYear(),
      };
    });

    const trends = months.map(({ month, monthNum, yearNum }) => {
      const revenue = invoices
        .filter(inv => {
          if (inv.status === 'draft' || inv.status === 'void' || inv.status === 'cancelled') return false;
          const invDate = new Date(inv.date);
          return invDate.getMonth() === monthNum && invDate.getFullYear() === yearNum;
        })
        .reduce((sum, inv) => sum + (inv.subtotal || 0), 0);

      let expenses = 0;
      for (const line of allLines) {
        if (!expenseAccountIds.has(line.accountId)) continue;
        const entryDate = entryDateById.get(line.entryId);
        if (!entryDate) continue;
        if (entryDate.getMonth() !== monthNum || entryDate.getFullYear() !== yearNum) continue;
        expenses += line.debit - line.credit;
      }

      return { month, revenue, expenses };
    });

    res.json(trends);
  }));

  // =====================================
  // Reports Routes
  // =====================================

  app.get("/api/companies/:companyId/reports/pl", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    // P&L must reflect only posted journal activity; drafts/voided entries
    // would otherwise inflate revenue and expense totals.
    const [accounts, allEntries, allLines] = await Promise.all([
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
    ]);

    const start = startDate ? uaeDayStart(startDate as string) : null;
    const end = endDate ? uaeDayEnd(endDate as string) : null;
    const entries = allEntries
      .filter(e => e.status === 'posted')
      .filter(entry => {
        if (!start && !end) return true;
        const entryDate = new Date(entry.date);
        if (start && entryDate < start) return false;
        if (end && entryDate > end) return false;
        return true;
      });

    const eligibleEntryIds = new Set(entries.map(e => e.id));
    const accountById = new Map(accounts.map(a => [a.id, a]));
    const balances = new Map<string, number>();

    for (const line of allLines) {
      if (!eligibleEntryIds.has(line.entryId)) continue;
      const account = accountById.get(line.accountId);
      if (!account) continue;

      const current = balances.get(account.id) || 0;
      if (account.type === 'income') {
        balances.set(account.id, current + line.credit - line.debit);
      } else if (account.type === 'expense') {
        balances.set(account.id, current + line.debit - line.credit);
      }
    }

    // Negative balances are legitimate: a refund creates negative revenue,
    // a vendor credit creates negative expense, contra accounts are
    // commonly carried at the opposite sign of their parent. Filter out
    // only zero-activity rows so the P&L still ties to the GL.
    const revenue = accounts
      .filter(a => a.type === 'income')
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }))
      .filter(item => item.amount !== 0);

    const expenses = accounts
      .filter(a => a.type === 'expense')
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }))
      .filter(item => item.amount !== 0);

    const totalRevenue = revenue.reduce((sum, item) => sum + item.amount, 0);
    const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
    const netProfit = totalRevenue - totalExpenses;

    res.json({ reportCurrency: 'AED', revenue, expenses, totalRevenue, totalExpenses, netProfit });
  }));

  app.get("/api/companies/:companyId/reports/balance-sheet", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    // Balance sheet must reflect only posted journal activity.
    const [accounts, allEntriesRaw, allLines] = await Promise.all([
      storage.getAccountsByCompanyId(companyId),
      storage.getJournalEntriesByCompanyId(companyId),
      storage.getJournalLinesByCompanyId(companyId),
    ]);
    const allEntries = allEntriesRaw.filter(e => e.status === 'posted');

    // A balance sheet is a *point-in-time* snapshot: every asset, liability
    // and equity balance is cumulative from the inception of the books
    // through `endDate`. Period-scoping these would erase opening balances
    // and break Assets = Liabilities + Equity. P&L (income/expense) IS
    // period-scoped so we can compute current-period net income to roll
    // into equity. `startDate` only constrains the P&L slice.
    const end = endDate ? uaeDayEnd(endDate as string) : null;
    const start = startDate ? uaeDayStart(startDate as string) : null;

    const balanceSheetEntryIds = new Set(
      allEntries
        .filter(entry => !end || new Date(entry.date) <= end)
        .map(e => e.id),
    );
    const periodEntryIds = new Set(
      allEntries
        .filter(entry => {
          const entryDate = new Date(entry.date);
          if (start && entryDate < start) return false;
          if (end && entryDate > end) return false;
          return true;
        })
        .map(e => e.id),
    );
    const accountById = new Map(accounts.map(a => [a.id, a]));

    // Cumulative balances for asset/liability/equity accounts. Single pass
    // over allLines avoids per-entry round-trips.
    const balances = new Map<string, number>();
    let periodRevenue = 0;
    let periodExpenses = 0;
    for (const line of allLines) {
      const account = accountById.get(line.accountId);
      if (!account) continue;

      if (balanceSheetEntryIds.has(line.entryId)) {
        if (account.type === 'asset' || account.type === 'liability' || account.type === 'equity') {
          const current = balances.get(account.id) || 0;
          if (account.type === 'asset') {
            balances.set(account.id, current + line.debit - line.credit);
          } else {
            balances.set(account.id, current + line.credit - line.debit);
          }
        }
      }

      if (periodEntryIds.has(line.entryId)) {
        if (account.type === 'income') periodRevenue += (line.credit - line.debit);
        else if (account.type === 'expense') periodExpenses += (line.debit - line.credit);
      }
    }
    const netIncome = periodRevenue - periodExpenses;

    const assets = accounts
      .filter(a => a.type === 'asset')
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }));

    const liabilities = accounts
      .filter(a => a.type === 'liability')
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }));

    const equity = accounts
      .filter(a => a.type === 'equity')
      .map(a => ({ accountName: a.nameEn, amount: balances.get(a.id) || 0 }));

    // Surface net income as a synthetic equity row so the totals balance
    // and a reader can see how YTD earnings flowed into equity.
    if (netIncome !== 0) {
      equity.push({ accountName: 'Current Period Net Income', amount: netIncome });
    }

    res.json({
      reportCurrency: 'AED',
      assets,
      liabilities,
      equity,
      totalAssets: assets.reduce((s, i) => s + i.amount, 0),
      totalLiabilities: liabilities.reduce((s, i) => s + i.amount, 0),
      totalEquity: equity.reduce((s, i) => s + i.amount, 0),
      currentPeriodNetIncome: netIncome,
    });
  }));

  app.get("/api/companies/:companyId/reports/vat-summary", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    let invoices = await storage.getInvoicesByCompanyId(companyId);
    let receipts = await storage.getReceiptsByCompanyId(companyId);

    if (startDate || endDate) {
      const start = startDate ? uaeDayStart(startDate as string) : null;
      const end = endDate ? uaeDayEnd(endDate as string) : null;

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
      // Drafts must be excluded — they have not been issued to customers
      // and so cannot give rise to a VAT obligation under UAE FTA rules.
      if (invoice.status !== 'void' && invoice.status !== 'draft' && invoice.status !== 'cancelled') {
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
    const userId = (req as any).user?.id;
    const { companyId } = req.query;
    if (!companyId) {
      return res.json({
        revenue: 0, expenses: 0, outstanding: 0, totalInvoices: 0, totalEntries: 0,
        cashPosition: 0, monthlyBurnRate: 0, cashRunway: null,
        arAging: { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
        apAging: { current: 0, days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
        revenueGrowth: null, expenseGrowth: null, topExpenseCategories: [],
      });
    }
    const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    res.json(await getEnhancedDashboardStats(companyId as string));
  }));

  app.get("/api/dashboard/summary", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.query;
    if (!companyId) {
      return res.json({
        revenue: 0, expenses: 0, outstanding: 0, totalInvoices: 0, totalEntries: 0,
        cashPosition: 0, monthlyBurnRate: 0, cashRunway: null,
        arAging: { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
        apAging: { current: 0, days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 },
        revenueGrowth: null, expenseGrowth: null, topExpenseCategories: [],
      });
    }
    const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    res.json(await getEnhancedDashboardStats(companyId as string));
  }));

  app.get("/api/dashboard/recent-invoices", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.query;
    if (!companyId) return res.json([]);
    const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });
    const invoices = await storage.getInvoicesByCompanyId(companyId as string);
    res.json(invoices.slice(0, 5));
  }));

  app.get("/api/dashboard/expense-breakdown", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.query;
    if (!companyId) return res.json([]);
    const hasAccess = await storage.hasCompanyAccess(userId, companyId as string);
    if (!hasAccess) return res.status(403).json({ message: 'Access denied' });

    const [accounts, allEntries, allLines] = await Promise.all([
      storage.getAccountsByCompanyId(companyId as string),
      storage.getJournalEntriesByCompanyId(companyId as string),
      storage.getJournalLinesByCompanyId(companyId as string),
    ]);
    const postedEntryIds = new Set(allEntries.filter(e => e.status === 'posted').map(e => e.id));
    const expenseAccounts = new Map(
      accounts.filter(a => a.type === 'expense').map(a => [a.id, a]),
    );

    const balances = new Map<string, { name: string; value: number }>();
    for (const line of allLines) {
      if (!postedEntryIds.has(line.entryId)) continue;
      const account = expenseAccounts.get(line.accountId);
      if (!account) continue;
      const current = balances.get(account.id) || { name: account.nameEn, value: 0 };
      current.value += line.debit - line.credit;
      balances.set(account.id, current);
    }

    res.json(
      Array.from(balances.values())
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
    );
  }));
}
