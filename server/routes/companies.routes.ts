import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { insertCompanySchema, companyPreferencesSchema } from "../../shared/schema";
import { ZodError } from "zod";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";
import { createLogger } from '../config/logger';
import { ensureCriticalSchema } from '../db';

const log = createLogger('companies');

function isCompanySchemaDriftError(err: any): boolean {
  return err?.code === '42703' || err?.code === '42P01';
}

async function withCompanySchemaRepair<T>(
  ctx: { route: string; id?: string; userId?: string },
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (err: any) {
    if (!isCompanySchemaDriftError(err)) throw err;

    log.error(
      { ...ctx, pgCode: err?.code, err: err?.message },
      'Company write hit schema drift; running critical schema guard and retrying once',
    );
    await ensureCriticalSchema();
    return await operation();
  }
}

/**
 * Translate a Postgres-driver error from a companies write into an HTTP
 * response. Returns true (and writes the response) when the error matches a
 * known SQLSTATE; returns false to let the caller re-throw for the global
 * handler to render a generic 500.
 *
 * Why this is its own helper: the onboarding wizard's "Save & Continue"
 * surfaces whatever the API returns. A bare 500 with "Internal Server Error"
 * leaves the user stuck with no actionable message and leaves us with no
 * structured log either. We catch the common write-time failures
 * (unique violation, NOT NULL violation, CHECK violation, value too long,
 * invalid input syntax for type) and surface them as 4xx with a hint about
 * which field the user needs to change. Schema drift (column does not exist)
 * is logged as a 5xx with explicit context so it lands in alerts and we can
 * tell it apart from a generic crash.
 */
export function handleCompanyWriteError(
  err: any,
  ctx: { route: string; id?: string; userId?: string },
  res: Response,
): boolean {
  const code: string | undefined = err?.code;

  // Always emit a structured log so production can tell apart 23505 from
  // 42703 from a connection drop. Includes the constraint/column the driver
  // gives us so we don't have to guess from the message text.
  log.warn(
    {
      ...ctx,
      pgCode: code,
      pgConstraint: err?.constraint,
      pgColumn: err?.column,
      pgDetail: err?.detail,
      pgTable: err?.table,
      err: err?.message,
    },
    'Company write failed',
  );

  switch (code) {
    case '23505': // unique_violation
      res.status(409).json({
        message: 'That value is already taken by another tenant. Please pick a different one.',
        field: err?.constraint?.includes('name') ? 'name' : undefined,
      });
      return true;
    case '23502': // not_null_violation
      res.status(400).json({
        message: `Required field is missing: ${err?.column ?? 'unknown'}`,
        field: err?.column,
      });
      return true;
    case '23514': // check_violation
      res.status(400).json({
        message: `Value rejected by validation rule: ${err?.constraint ?? 'check constraint'}`,
      });
      return true;
    case '22001': // string_data_right_truncation (value too long)
      res.status(400).json({
        message: 'One of the values you entered is too long for this field.',
      });
      return true;
    case '22P02': // invalid_text_representation (e.g. bad uuid)
      res.status(400).json({
        message: 'One of the values you entered is not valid for this field.',
      });
      return true;
    case '42703': // undefined_column — schema/DB drift
    case '42P01': // undefined_table
      // The schema-guard in server/db.ts is meant to prevent this; if we
      // still hit it after the one-shot repair, return a clear retryable
      // service error instead of leaking a generic 500 to onboarding.
      log.error(
        { ...ctx, pgCode: code, err: err?.message },
        'Schema drift: companies write referenced a missing column/table',
      );
      res.status(503).json({
        message: 'Company database schema is being repaired. Please retry in a moment.',
        code: 'COMPANY_SCHEMA_REPAIR_REQUIRED',
      });
      return true;
    default:
      return false;
  }
}

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
    const { id: userId, firmRole } = (req as any).user;
    const companies = await storage.getAccessibleCompanies(userId, firmRole);
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

    let company;
    try {
      company = await withCompanySchemaRepair(
        { route: 'POST /api/companies', userId },
        () => storage.createCompany(validated),
      );
    } catch (err: any) {
      if (handleCompanyWriteError(err, { route: 'POST /api/companies', userId }, res)) {
        return;
      }
      throw err;
    }

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
    const { id: userId, firmRole } = (req as any).user;

    // Check if user has access to this company (or via firm role)
    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
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
    const { id: userId, firmRole } = (req as any).user;

    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
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

    try {
      const company = await withCompanySchemaRepair(
        { route: 'PUT /api/companies/:id', id, userId },
        () => storage.updateCompany(id, updateData),
      );
      res.json(company);
    } catch (err: any) {
      if (handleCompanyWriteError(err, { route: 'PUT /api/companies/:id', id, userId }, res)) {
        return;
      }
      throw err;
    }
  }));

  app.patch("/api/companies/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { id: userId, firmRole } = (req as any).user;

    // Check if user has access to this company (or via firm role)
    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
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
      const company = await withCompanySchemaRepair(
        { route: 'PATCH /api/companies/:id', id, userId },
        () => storage.updateCompany(id, updateData),
      );
      log.info({ id: company.id }, 'Company profile updated');
      res.json(company);
    } catch (err: any) {
      if (handleCompanyWriteError(err, { route: 'PATCH /api/companies/:id', id, userId }, res)) {
        return;
      }
      throw err;
    }
  }));

  // QuickBooks-style company preferences page — strictly validated PATCH.
  // Kept separate from PATCH /api/companies/:id so other callers that send
  // unrelated fields (e.g. tax registration date, company type) keep working.
  app.patch("/api/companies/:id/preferences", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let validated;
    try {
      validated = companyPreferencesSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          message: 'Invalid company preferences',
          errors: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Strip undefined keys so we never overwrite existing values with NULL
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(validated)) {
      if (value !== undefined) updateData[key] = value;
    }

    const company = await storage.updateCompany(id, updateData as any);
    log.info({ id: company.id }, 'Company preferences updated');
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

    const account = await storage.createBankAccount({ ...req.body, companyId: id });
    res.status(201).json(account);
  }));

  // Seed Chart of Accounts for company
  // Customer-only: Seed chart of accounts
  app.post("/api/companies/:id/seed-accounts", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { id: userId, firmRole } = (req as any).user;

    // Check if user has access to this company (or via firm role)
    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
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
