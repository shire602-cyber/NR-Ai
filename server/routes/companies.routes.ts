import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { insertCompanySchema } from "../../shared/schema";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";
import { createLogger } from '../config/logger';

const log = createLogger('companies');

/**
 * Seed Chart of Accounts for a company using the default UAE chart.
 */
async function seedChartOfAccounts(companyId: string): Promise<{ created: number; alreadyExisted: boolean }> {
  // Check if company already has accounts
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) {
    log.info({ companyId }, 'Company already has accounts, skipping seed');
    return { created: 0, alreadyExisted: true };
  }

  // Create all default accounts for this company
  const defaultAccounts = createDefaultAccountsForCompany(companyId);

  try {
    const createdAccounts = await storage.createBulkAccounts(defaultAccounts as any);
    log.info({ companyId, count: createdAccounts.length }, 'Created chart of accounts');
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: any) {
    if (error.message?.includes('PARTIAL_INSERT')) {
      log.error({ companyId, err: error.message }, 'Partial insert detected during COA seed');
      throw new Error('PARTIAL_CHART: Chart of Accounts partially created due to race condition. Please contact support.');
    }
    throw error;
  }
}

export function registerCompanyRoutes(app: Express) {
  // =====================================
  // Company Routes
  // =====================================

  app.get("/api/companies", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const companies = await storage.getCompaniesByUserId(userId);
    res.json(companies);
  }));

  app.post("/api/companies", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const validated = insertCompanySchema.parse(req.body);

    // Check if company name exists
    const existing = await storage.getCompanyByName(validated.name);
    if (existing) {
      return res.status(400).json({ message: 'Company name already exists' });
    }

    const company = await storage.createCompany(validated);

    // Associate user with company as owner
    await storage.createCompanyUser({
      companyId: company.id,
      userId,
      role: 'owner',
    });

    // Seed Chart of Accounts
    await seedChartOfAccounts(company.id);

    res.json(company);
  }));

  app.get("/api/companies/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const company = await storage.getCompany(id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json(company);
  }));

  // PUT is an alias for PATCH — some clients send PUT for full updates
  app.put("/api/companies/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = { ...req.body };
    if (updateData.taxRegistrationDate) {
      if (typeof updateData.taxRegistrationDate === 'string') {
        updateData.taxRegistrationDate = new Date(updateData.taxRegistrationDate);
      } else if (!(updateData.taxRegistrationDate instanceof Date)) {
        updateData.taxRegistrationDate = new Date(updateData.taxRegistrationDate);
      }
    } else {
      delete updateData.taxRegistrationDate;
    }

    const company = await storage.updateCompany(id, updateData);
    res.json(company);
  }));

  app.patch("/api/companies/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Prepare update data with proper type conversions
    const updateData = { ...req.body };

    // Convert taxRegistrationDate to Date if it exists and is not already a Date
    if (updateData.taxRegistrationDate) {
      if (typeof updateData.taxRegistrationDate === 'string') {
        updateData.taxRegistrationDate = new Date(updateData.taxRegistrationDate);
      } else if (!(updateData.taxRegistrationDate instanceof Date)) {
        // If it's not a string or Date, try to coerce it
        updateData.taxRegistrationDate = new Date(updateData.taxRegistrationDate);
      }
    } else {
      // If taxRegistrationDate is undefined or null, ensure it's properly set
      delete updateData.taxRegistrationDate;
    }

    try {
      const company = await storage.updateCompany(id, updateData);
      log.info({ id: company.id }, 'Company profile updated');
      res.json(company);
    } catch (err: any) {
      // Postgres unique_violation. Surface a 409 with a clear message so the
      // onboarding wizard can show something actionable instead of being
      // stuck on a generic save-failed toast.
      if (err?.code === '23505') {
        log.warn({ id, constraint: err.constraint }, 'Company update unique violation');
        return res.status(409).json({
          message: 'That value is already taken by another tenant. Please pick a different one.',
          field: err.constraint?.includes('name') ? 'name' : undefined,
        });
      }
      throw err;
    }
  }));

  // Mark company onboarding as complete
  app.post("/api/companies/:id/onboarding/complete", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const company = await storage.updateCompany(id, { onboardingCompleted: true });
    res.json(company);
  }));

  // List bank accounts for a company
  app.get("/api/companies/:id/bank-accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const accounts = await storage.getBankAccountsByCompanyId(id);
    res.json(accounts);
  }));

  // Create a bank account for a company
  app.post("/api/companies/:id/bank-accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const account = await storage.createBankAccount({ ...req.body, companyId: id });
    res.status(201).json(account);
  }));

  // Seed Chart of Accounts for company
  // Customer-only: Seed chart of accounts
  app.post("/api/companies/:id/seed-accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Check if user has access to this company
    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Seed Chart of Accounts
    const result = await seedChartOfAccounts(id);

    const accountsWithBalances = await storage.getAccountsWithBalances(id);

    if (result.alreadyExisted) {
      return res.status(409).json({
        message: 'Chart of Accounts already exists for this company',
        accounts: accountsWithBalances
      });
    }

    res.status(201).json({
      message: 'Chart of Accounts seeded successfully',
      accountsCreated: result.created,
      accounts: accountsWithBalances
    });
  }));
}
