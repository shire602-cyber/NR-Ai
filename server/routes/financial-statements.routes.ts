import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import {
  classifyBalanceSheetAccount,
  computeCashFlow,
} from "../services/financial-statements";

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

// Parse a report boundary date. Date-only values (e.g. "2026-06-12") are
// CALENDAR dates: as an end boundary the whole day must be included, so we
// extend them to 23:59:59.999 UTC. Timestamps are passed through unchanged.
function parseEndOfDay(raw: string): Date {
  const d = new Date(raw);
  if (!raw.includes("T")) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d;
}

export function registerFinancialStatementRoutes(app: Express) {
  // =====================================
  // Financial Statements Routes
  // =====================================

  // Profit & Loss (Income Statement)
  app.get(
    "/api/companies/:companyId/financial-statements/profit-loss",
    authMiddleware,
    requireCustomer,
    requireFeature("advancedReports"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate = req.query.endDate ? parseEndOfDay(req.query.endDate as string) : null;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate query params are required" });
      }

      // Fetch all posted journal entries for this company
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const filteredEntries = entries.filter(
        (e) => e.status === "posted" && new Date(e.date) >= startDate && new Date(e.date) <= endDate
      );

      // Batch-fetch all accounts for the company
      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map((a) => [a.id, a]));

      // Group journal lines by account
      const grouped: GroupedAccounts = {};

      // S1: one batched query for all lines instead of one query per entry (N+1).
      const allLines = await storage.getJournalLinesByEntryIds(filteredEntries.map((e) => e.id));
      {
        for (const line of allLines) {
          const account = accountMap.get(line.accountId);
          if (!account) continue;
          // Only income and expense accounts go into P&L
          if (account.type !== "income" && account.type !== "expense") continue;

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

        if (account.type === "income") {
          const amount = data.creditTotal - data.debitTotal;
          totalRevenue += amount;
          revenueBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount,
          });
        } else if (account.type === "expense") {
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
    })
  );

  // Balance Sheet
  app.get(
    "/api/companies/:companyId/financial-statements/balance-sheet",
    authMiddleware,
    requireCustomer,
    requireFeature("advancedReports"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const asOfDate = req.query.asOfDate ? parseEndOfDay(req.query.asOfDate as string) : null;
      if (!asOfDate) {
        return res.status(400).json({ message: "asOfDate query param is required" });
      }

      // Fetch all posted journal entries up to asOfDate
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const filteredEntries = entries.filter(
        (e) => e.status === "posted" && new Date(e.date) <= asOfDate
      );

      // Batch-fetch all accounts
      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map((a) => [a.id, a]));

      // Group by account
      const grouped: GroupedAccounts = {};

      // S1: one batched query for all lines instead of one query per entry (N+1).
      const allLines = await storage.getJournalLinesByEntryIds(filteredEntries.map((e) => e.id));
      {
        for (const line of allLines) {
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

        // A-2: classify with abnormal-balance reclassification — a receivable
        // carrying a net credit balance is presented as a liability (customer
        // credit), and a payable carrying a net debit balance as an asset, so
        // financial position is stated correctly even when accounts are
        // abnormal. Income/expense roll into retained earnings.
        const classified = classifyBalanceSheetAccount({
          type: account.type,
          debitTotal: data.debitTotal,
          creditTotal: data.creditTotal,
          // Needed so contra-asset accounts (accumulated depreciation) are not
          // reclassified into liabilities on their normal credit balance.
          code: account.code,
        });

        if (classified.section === "asset") {
          totalAssets += classified.amount;
          assetBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount: classified.amount,
          });
        } else if (classified.section === "liability") {
          totalLiabilities += classified.amount;
          liabilityBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount: classified.amount,
          });
        } else if (classified.section === "equity") {
          totalEquity += classified.amount;
          equityBreakdown.push({
            accountId,
            accountCode: data.accountCode,
            accountName: data.accountName,
            amount: classified.amount,
          });
        } else {
          // income or expense — both contribute (credit - debit) to retained earnings
          retainedEarnings += classified.amount;
        }
      }

      // Add retained earnings to equity
      totalEquity += retainedEarnings;
      if (retainedEarnings !== 0) {
        equityBreakdown.push({
          accountId: "retained-earnings",
          accountCode: "3900",
          // A-B10: this is accumulated earnings since inception (all posted
          // income/expense up to the as-of date), not a single period.
          accountName: "Retained Earnings (Accumulated)",
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
    })
  );

  // Cash Flow Statement
  app.get(
    "/api/companies/:companyId/financial-statements/cash-flow",
    authMiddleware,
    requireCustomer,
    requireFeature("advancedReports"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate = req.query.endDate ? parseEndOfDay(req.query.endDate as string) : null;

      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate query params are required" });
      }

      // Fetch posted entries in date range
      const entries = await storage.getJournalEntriesByCompanyId(companyId);
      const filteredEntries = entries.filter(
        (e) => e.status === "posted" && new Date(e.date) >= startDate && new Date(e.date) <= endDate
      );

      // Batch-fetch all accounts
      const allAccounts = await storage.getAccountsByCompanyId(companyId);
      const accountMap = new Map(allAccounts.map((a) => [a.id, a]));

      // A-3: build the cash-flow statement from ACTUAL cash movements (direct
      // method). For each entry that touches a cash/bank account we attribute
      // its net cash movement to the dominant non-cash counterpart and bucket
      // by activity. Cash accounts are never listed as line items and the net
      // cash change equals the real change in cash/bank balances — unlike the
      // previous implementation, which summed every account's delta (including
      // the cash account itself) and produced a net change that did not tie out.
      // S1: one batched query for all lines, then group by entry in memory
      // (computeCashFlow needs lines grouped per entry), instead of N+1 queries.
      const cfLines = await storage.getJournalLinesByEntryIds(filteredEntries.map((e) => e.id));
      const cfLinesByEntry = new Map<string, typeof cfLines>();
      for (const l of cfLines) {
        const arr = cfLinesByEntry.get(l.entryId);
        if (arr) arr.push(l);
        else cfLinesByEntry.set(l.entryId, [l]);
      }
      const entriesWithLines = filteredEntries.map((entry) => ({
        lines: cfLinesByEntry.get(entry.id) ?? [],
      }));
      const cf = computeCashFlow({ entries: entriesWithLines, accounts: allAccounts });

      res.json({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        operating: cf.operating,
        investing: cf.investing,
        financing: cf.financing,
        netCashChange: cf.netCashChange,
      });
    })
  );
}
