import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { insertCompanySchema } from "../../shared/schema";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";

/**
 * Seed Chart of Accounts for a company using the default UAE chart.
 */
async function seedChartOfAccounts(companyId: string): Promise<{ created: number; alreadyExisted: boolean }> {
  // Check if company already has accounts
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) {
    console.log(`[Seed COA] Company ${companyId} already has accounts, skipping seed`);
    return { created: 0, alreadyExisted: true };
  }

  // Create all default accounts for this company
  const defaultAccounts = createDefaultAccountsForCompany(companyId);

  try {
    const createdAccounts = await storage.createBulkAccounts(defaultAccounts as any);
    console.log(`[Seed COA] Created ${createdAccounts.length} accounts for company ${companyId}`);
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: any) {
    if (error.message?.includes('PARTIAL_INSERT')) {
      console.error(`[Seed COA] Partial insert detected for company ${companyId}: ${error.message}`);
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

    const company = await storage.updateCompany(id, updateData);
    console.log('[Company Profile] Company updated:', company.id);
    res.json(company);
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
