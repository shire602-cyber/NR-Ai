import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { insertAccountSchema } from "../../shared/schema";

export function registerAccountRoutes(app: Express) {
  // =====================================
  // Account Routes
  // =====================================

  // Customer-only: Full chart of accounts access
  app.get("/api/companies/:companyId/accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    // Verify company access
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const accounts = await storage.getAccountsByCompanyId(companyId);
    res.json(accounts);
  }));

  // Customer-only: Create accounts
  app.post("/api/companies/:companyId/accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    // Verify company access
    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const validated = insertAccountSchema.parse({ ...req.body, companyId });

    const account = await storage.createAccount(validated);
    res.json(account);
  }));

  // Customer-only: Update accounts
  app.put("/api/accounts/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Get account to verify it exists and get company access
    const account = await storage.getAccount(id);
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, account.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updatedAccount = await storage.updateAccount(id, req.body);
    res.json(updatedAccount);
  }));

  // Customer-only: Archive accounts (soft delete)
  app.post("/api/accounts/:id/archive", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const account = await storage.getAccount(id);
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, account.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // System accounts cannot be archived (pre-check for better error message)
    if (account.isSystemAccount) {
      return res.status(409).json({
        message: 'System accounts cannot be archived. These are essential for proper bookkeeping.'
      });
    }

    try {
      const archivedAccount = await storage.archiveAccount(id);
      res.json(archivedAccount);
    } catch (archiveError: any) {
      // Handle race condition where account was marked as system between read and update
      if (archiveError.message.includes('system account')) {
        return res.status(409).json({
          message: 'System accounts cannot be archived. These are essential for proper bookkeeping.'
        });
      }
      throw archiveError;
    }
  }));

  // Customer-only: Unarchive accounts
  app.post("/api/accounts/:id/unarchive", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const account = await storage.getAccount(id);
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, account.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const unarchivedAccount = await storage.updateAccount(id, {
      isArchived: false,
      isActive: true,
      updatedAt: new Date()
    });
    res.json(unarchivedAccount);
  }));

  // Customer-only: Delete accounts (permanent - only for non-system accounts with no transactions)
  app.delete("/api/accounts/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Get account to verify it exists and get company access
    const account = await storage.getAccount(id);
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, account.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // System accounts cannot be deleted
    if (account.isSystemAccount) {
      return res.status(400).json({
        message: 'System accounts cannot be deleted. You can archive them instead if needed.'
      });
    }

    // Check if account has any transactions
    const hasTransactions = await storage.accountHasTransactions(id);
    if (hasTransactions) {
      return res.status(400).json({
        message: 'Cannot delete account with existing transactions. Please archive the account instead, or remove all journal entries first.'
      });
    }

    await storage.deleteAccount(id);
    res.json({ message: 'Account deleted successfully' });
  }));

  // Get accounts with balances for Chart of Accounts
  // Customer-only: Accounts with balances
  app.get("/api/companies/:companyId/accounts-with-balances", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { dateStart, dateEnd } = req.query;
    let dateRange: { start: Date; end: Date } | undefined;

    if (dateStart && dateEnd) {
      dateRange = {
        start: new Date(dateStart as string),
        end: new Date(dateEnd as string)
      };
    }

    const accountsWithBalances = await storage.getAccountsWithBalances(companyId, dateRange);
    res.json(accountsWithBalances);
  }));

  // Get account ledger
  // Customer-only: Account ledger
  app.get("/api/accounts/:id/ledger", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const account = await storage.getAccount(id);
    if (!account) {
      return res.status(404).json({ message: 'Account not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, account.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { dateStart, dateEnd, search, limit, offset } = req.query;

    const options: {
      dateStart?: Date;
      dateEnd?: Date;
      search?: string;
      limit?: number;
      offset?: number;
    } = {};

    if (dateStart) options.dateStart = new Date(dateStart as string);
    if (dateEnd) options.dateEnd = new Date(dateEnd as string);
    if (search) options.search = search as string;
    if (limit) options.limit = parseInt(limit as string);
    if (offset) options.offset = parseInt(offset as string);

    const ledger = await storage.getAccountLedger(id, options);
    res.json(ledger);
  }));
}
