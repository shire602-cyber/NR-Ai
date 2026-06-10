import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { requireFeature } from '../middleware/featureGate';
import { storage } from '../storage';

interface AccountBreakdown {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

interface GroupedAccounts {
  [accountId: string]: {
    accountCode: string;
    accountName: string;
    debitTotal: number;
    creditTotal: number;
  };
}

export function registerFinancialStatementRoutes(app: Express) {
  // =====================================
  // Financial Statements Routes
  // =====================================

  // Profit & Loss (Income Statement)
  app.get('/api/companies/:companyId/financial-statements/profit-loss', authMiddleware, requireCustomer, requireFeature('advancedReports'),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : null;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: 'startDate and endDate query params are required' });
      }

      // Fetch all posted journal entries for this company
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const filteredEntries = entries.filter(e =>
        e.status === 'posted' &&
        new Date(e.date) >= startDate &&
        new Date(e.date) <= endDate
      );

      // Batch-fetch all accounts for the company
      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map(a => [a.id, a]));

      // Group journal lines by account
      const grouped: GroupedAccounts = {};

      for (const entry of filteredEntries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accountMap.get(line.accountId);
          if (!account) continue;
          // Only income and expense accounts go into P&L
          if (account.type !== 'income' && account.type !== 'expense') continue;

          if (!grouped[line.accountId]) {
            grouped[line.accountId] = {
              accountCode: account.code,
              accountName: account.nameEn,
              debitTotal: 0,
              creditTotal: 0,
            };
          }
          grouped[line.accountId].debitTotal += line.debit || 0;
          grouped[line.accountId].creditTotal += line.credit || 0;
        }
      }

      // Income = net credits to income accounts (credit - debit)
      const revenueBreakdown: AccountBreakdown[] = [];
      let totalRevenue = 0;

      // Expenses = net debits to expense accounts (debit - credit)
      const expenseBreakdown: AccountBreakdown[] = [];
      let totalExpenses = 0;

      for (const [accountId, data] of Object.entries(grouped)) {
        const account = accountMap.get(accountId);
        if (!account) continue;

        if (account.type === 'income') {
          const amount = data.creditTotal - data.debitTotal;
          totalRevenue += amount;
          revenueBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount,
          });
        } else if (account.type === 'expense') {
          const amount = data.debitTotal - data.creditTotal;
          totalExpenses += amount;
          expenseBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount,
          });
        }
      }

      // Sort breakdowns by account code
      revenueBreakdown.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      expenseBreakdown.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

      res.json({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        revenue: Math.round(totalRevenue * 100) / 100,
        expenses: Math.round(totalExpenses * 100) / 100,
        netIncome: Math.round((totalRevenue - totalExpenses) * 100) / 100,
        breakdown: {
          revenue: revenueBreakdown,
          expenses: expenseBreakdown,
        },
      });
    }));

  // Balance Sheet
  app.get('/api/companies/:companyId/financial-statements/balance-sheet', authMiddleware, requireCustomer, requireFeature('advancedReports'),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : null;
      if (!asOfDate) {
        return res.status(400).json({ message: 'asOfDate query param is required' });
      }

      // Fetch all posted journal entries up to asOfDate
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const filteredEntries = entries.filter(e =>
        e.status === 'posted' &&
        new Date(e.date) <= asOfDate
      );

      // Batch-fetch all accounts
      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map(a => [a.id, a]));

      // Group by account
      const grouped: GroupedAccounts = {};

      for (const entry of filteredEntries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accountMap.get(line.accountId);
          if (!account) continue;

          if (!grouped[line.accountId]) {
            grouped[line.accountId] = {
              accountCode: account.code,
              accountName: account.nameEn,
              debitTotal: 0,
              creditTotal: 0,
            };
          }
          grouped[line.accountId].debitTotal += line.debit || 0;
          grouped[line.accountId].creditTotal += line.credit || 0;
        }
      }

      const assetBreakdown: AccountBreakdown[] = [];
      let totalAssets = 0;

      const liabilityBreakdown: AccountBreakdown[] = [];
      let totalLiabilities = 0;

      const equityBreakdown: AccountBreakdown[] = [];
      let totalEquity = 0;

      // Income/expense roll up into retained earnings for BS
      let retainedEarnings = 0;

      for (const [accountId, data] of Object.entries(grouped)) {
        const account = accountMap.get(accountId);
        if (!account) continue;

        if (account.type === 'asset') {
          // Assets have normal debit balance
          const amount = data.debitTotal - data.creditTotal;
          totalAssets += amount;
          assetBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount,
          });
        } else if (account.type === 'liability') {
          // Liabilities have normal credit balance
          const amount = data.creditTotal - data.debitTotal;
          totalLiabilities += amount;
          liabilityBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount,
          });
        } else if (account.type === 'equity') {
          // Equity has normal credit balance
          const amount = data.creditTotal - data.debitTotal;
          totalEquity += amount;
          equityBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount,
          });
        } else if (account.type === 'income') {
          retainedEarnings += (data.creditTotal - data.debitTotal);
        } else if (account.type === 'expense') {
          retainedEarnings -= (data.debitTotal - data.creditTotal);
        }
      }

      // Add retained earnings to equity
      totalEquity += retainedEarnings;
      if (retainedEarnings !== 0) {
        equityBreakdown.push({
          accountId: 'retained-earnings',
          accountCode: '3900',
          accountName: 'Retained Earnings (Current Period)',
          amount: retainedEarnings,
        });
      }

      // Sort breakdowns
      assetBreakdown.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      liabilityBreakdown.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      equityBreakdown.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

      res.json({
        asOfDate: asOfDate.toISOString(),
        assets: {
          total: Math.round(totalAssets * 100) / 100,
          breakdown: assetBreakdown,
        },
        liabilities: {
          total: Math.round(totalLiabilities * 100) / 100,
          breakdown: liabilityBreakdown,
        },
        equity: {
          total: Math.round(totalEquity * 100) / 100,
          breakdown: equityBreakdown,
        },
        // Accounting equation check
        totalLiabilitiesAndEquity: Math.round((totalLiabilities + totalEquity) * 100) / 100,
        isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      });
    }));

  // Cash Flow Statement
  app.get('/api/companies/:companyId/financial-statements/cash-flow', authMiddleware, requireCustomer, requireFeature('advancedReports'),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : null;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: 'startDate and endDate query params are required' });
      }

      // Fetch posted entries in date range
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const filteredEntries = entries.filter(e =>
        e.status === 'posted' &&
        new Date(e.date) >= startDate &&
        new Date(e.date) <= endDate
      );

      // Batch-fetch all accounts
      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map(a => [a.id, a]));

      // Classify cash flows by account sub-type and type
      const operating: AccountBreakdown[] = [];
      let operatingTotal = 0;

      const investing: AccountBreakdown[] = [];
      let investingTotal = 0;

      const financing: AccountBreakdown[] = [];
      let financingTotal = 0;

      // Group by account
      const grouped: GroupedAccounts = {};

      for (const entry of filteredEntries) {
        const lines = await storage.getJournalLinesByEntryId(entry.id);
        for (const line of lines) {
          const account = accountMap.get(line.accountId);
          if (!account) continue;

          if (!grouped[line.accountId]) {
            grouped[line.accountId] = {
              accountCode: account.code,
              accountName: account.nameEn,
              debitTotal: 0,
              creditTotal: 0,
            };
          }
          grouped[line.accountId].debitTotal += line.debit || 0;
          grouped[line.accountId].creditTotal += line.credit || 0;
        }
      }

      for (const [accountId, data] of Object.entries(grouped)) {
        const account = accountMap.get(accountId);
        if (!account) continue;

        // Net cash effect (debit = outflow for cash-type, credit = inflow)
        const netAmount = data.debitTotal - data.creditTotal;

        const item: AccountBreakdown = {
          accountId,
          accountCode: data.accountCode,
          accountName: data.accountName,
          amount: Math.round(netAmount * 100) / 100,
        };

        // Classify based on account type and sub-type
        if (account.type === 'income' || account.type === 'expense') {
          // Operating activities: revenue and expenses
          // For income: credit balance is positive cash flow
          // For expense: debit balance is negative cash flow
          if (account.type === 'income') {
            item.amount = Math.round((data.creditTotal - data.debitTotal) * 100) / 100;
          } else {
            item.amount = Math.round((data.creditTotal - data.debitTotal) * 100) / 100;
          }
          operatingTotal += item.amount;
          operating.push(item);
        } else if (account.type === 'asset' && account.subType === 'fixed_asset') {
          // Investing activities: fixed asset changes
          // Debit to fixed asset = cash outflow (investing)
          item.amount = Math.round((data.creditTotal - data.debitTotal) * 100) / 100;
          investingTotal += item.amount;
          investing.push(item);
        } else if (account.type === 'liability' && account.subType === 'long_term_liability') {
          // Financing activities: long-term liability changes
          // Credit to liability = cash inflow (financing)
          item.amount = Math.round((data.creditTotal - data.debitTotal) * 100) / 100;
          financingTotal += item.amount;
          financing.push(item);
        } else if (account.type === 'equity') {
          // Financing activities: equity changes
          item.amount = Math.round((data.creditTotal - data.debitTotal) * 100) / 100;
          financingTotal += item.amount;
          financing.push(item);
        } else if (account.type === 'asset' && account.subType === 'current_asset') {
          // Operating activities: current asset changes (excluding cash)
          // Increase in current assets = cash outflow
          item.amount = Math.round((data.creditTotal - data.debitTotal) * 100) / 100;
          operatingTotal += item.amount;
          operating.push(item);
        } else if (account.type === 'liability' && account.subType === 'current_liability') {
          // Operating activities: current liability changes
          // Increase in current liabilities = cash inflow
          item.amount = Math.round((data.creditTotal - data.debitTotal) * 100) / 100;
          operatingTotal += item.amount;
          operating.push(item);
        } else {
          // Default: treat unclassified asset/liability as operating
          item.amount = Math.round((data.creditTotal - data.debitTotal) * 100) / 100;
          operatingTotal += item.amount;
          operating.push(item);
        }
      }

      // Sort each section
      operating.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      investing.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      financing.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

      const netCashChange = operatingTotal + investingTotal + financingTotal;

      res.json({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        operating: {
          total: Math.round(operatingTotal * 100) / 100,
          breakdown: operating,
        },
        investing: {
          total: Math.round(investingTotal * 100) / 100,
          breakdown: investing,
        },
        financing: {
          total: Math.round(financingTotal * 100) / 100,
          breakdown: financing,
        },
        netCashChange: Math.round(netCashChange * 100) / 100,
      });
    }));
}
