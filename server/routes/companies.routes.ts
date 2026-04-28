import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { insertCompanySchema, insertBankAccountSchema } from "../../shared/schema";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";
import { createLogger } from '../config/logger';
import { isoDateSchema, optionalTrnSchema } from "../../shared/validators";

const log = createLogger('companies');

// Updates that the company-profile UI is allowed to send. Drizzle's
// generated insert schema isn't usable here because we need partial
// semantics plus stricter rules on TRN format and date sanity.
const updateCompanyBodySchema = insertCompanySchema.partial().extend({
  trnVatNumber: optionalTrnSchema,
  taxRegistrationDate: isoDateSchema().optional().nullable(),
});

// Same TRN/date refinements applied to company creation.
const createCompanyBodySchema = insertCompanySchema.extend({
  trnVatNumber: optionalTrnSchema,
  taxRegistrationDate: isoDateSchema().optional().nullable(),
});

const createBankAccountBodySchema = insertBankAccountSchema
  .omit({ companyId: true })
  .extend({
    iban: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/, 'Invalid IBAN format')
      .optional()
      .or(z.literal('').transform(() => undefined)),
  });

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
    const validated = createCompanyBodySchema.parse(req.body);

    // Check if company name exists
    const existing = await storage.getCompanyByName(validated.name);
    if (existing) {
      return res.status(400).json({ message: 'Company name already exists' });
    }

    const company = await storage.createCompany(validated as any);

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

    const updateData = updateCompanyBodySchema.parse(req.body);
    const company = await storage.updateCompany(id, updateData as any);
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

    const updateData = updateCompanyBodySchema.parse(req.body);
    const company = await storage.updateCompany(id, updateData as any);
    log.info({ id: company.id }, 'Company profile updated');
    res.json(company);
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

    const parsed = createBankAccountBodySchema.parse(req.body);
    const account = await storage.createBankAccount({ ...parsed, companyId: id });
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
