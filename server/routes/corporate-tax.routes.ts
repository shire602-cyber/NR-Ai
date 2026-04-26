import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { UAE_CT_EXEMPTION_THRESHOLD } from '../constants';
import { assertPeriodNotLocked } from '../services/period-lock.service';

export function registerCorporateTaxRoutes(app: Express) {
  // =====================================
  // CORPORATE TAX RETURNS (UAE 9% CT)
  // =====================================

  // List all corporate tax returns for a company
  app.get("/api/companies/:companyId/corporate-tax/returns", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { companyId } = req.params;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const returns = await storage.getCorporateTaxReturnsByCompanyId(companyId);
    res.json(returns);
  }));

  // Get a single corporate tax return
  app.get("/api/corporate-tax/returns/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const taxReturn = await storage.getCorporateTaxReturn(id);
    if (!taxReturn) {
      return res.status(404).json({ message: 'Corporate tax return not found' });
    }

    res.json(taxReturn);
  }));

  // Create a corporate tax return
  app.post("/api/companies/:companyId/corporate-tax/returns", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { companyId } = req.params;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // CT returns settle tax against periodEnd — block creation when the
    // period is already locked, since the tax provision JE could not post.
    if (req.body?.periodEnd) {
      await assertPeriodNotLocked(companyId, req.body.periodEnd);
    }

    const taxReturn = await storage.createCorporateTaxReturn({
      ...req.body,
      companyId,
    });

    res.status(201).json(taxReturn);
  }));

  // Update a corporate tax return
  app.patch("/api/corporate-tax/returns/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await storage.getCorporateTaxReturn(id);
    if (!existing) {
      return res.status(404).json({ message: 'Corporate tax return not found' });
    }

    const taxReturn = await storage.updateCorporateTaxReturn(id, req.body);
    res.json(taxReturn);
  }));

  // Auto-calculate corporate tax for a period from journal entries
  app.get("/api/companies/:companyId/corporate-tax/calculate", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { companyId } = req.params;
    const { periodStart, periodEnd } = req.query;

    if (!periodStart || !periodEnd) {
      return res.status(400).json({ message: 'periodStart and periodEnd query parameters are required' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const startDate = new Date(periodStart as string);
    const endDate = new Date(periodEnd as string);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format for periodStart or periodEnd' });
    }

    // Get all accounts for this company to identify revenue vs expense accounts
    const allAccounts = await storage.getAccountsByCompanyId(companyId);
    const accountMap = new Map(allAccounts.map(a => [a.id, a]));

    // Get all journal entries in the period
    const journalEntries = await storage.getJournalEntriesByCompanyId(companyId);
    const periodEntries = journalEntries.filter(entry => {
      const entryDate = new Date(entry.date);
      return entryDate >= startDate && entryDate <= endDate && entry.status === 'posted';
    });

    let totalRevenue = 0;
    let totalExpenses = 0;

    // Single batched fetch for all period lines.
    const periodLines = await storage.getJournalLinesByEntryIds(periodEntries.map(e => e.id));
    for (const line of periodLines) {
      const account = accountMap.get(line.accountId);
      if (!account) continue;

      if (account.type === 'income') {
        // Revenue accounts: credit side increases revenue
        totalRevenue += (line.credit || 0) - (line.debit || 0);
      } else if (account.type === 'expense') {
        // Expense accounts: debit side increases expenses
        totalExpenses += (line.debit || 0) - (line.credit || 0);
      }
    }

    // Ensure non-negative values
    totalRevenue = Math.max(0, totalRevenue);
    totalExpenses = Math.max(0, totalExpenses);

    const exemptionThreshold = UAE_CT_EXEMPTION_THRESHOLD;
    const taxRate = 0.09;
    const totalDeductions = 0; // User can adjust this on the frontend
    const taxableIncome = totalRevenue - totalExpenses - totalDeductions;
    const taxableAmount = Math.max(0, taxableIncome - exemptionThreshold);
    const taxPayable = taxableAmount * taxRate;

    res.json({
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      grossProfit: Math.round((totalRevenue - totalExpenses) * 100) / 100,
      totalDeductions,
      taxableIncome: Math.round(taxableIncome * 100) / 100,
      exemptionThreshold,
      taxableAmount: Math.round(taxableAmount * 100) / 100,
      taxRate,
      taxPayable: Math.round(taxPayable * 100) / 100,
      journalEntriesProcessed: periodEntries.length,
    });
  }));
}
