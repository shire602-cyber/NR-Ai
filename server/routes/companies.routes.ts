import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { billingEnforced, checkCompanyQuota } from "../middleware/featureGate";
import { bypassesTrialLock, companyTrialLocked } from "../middleware/trialAccessPolicy";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { assertUaeVatRate } from "../http/vat-rate-guard";
import { DomainError, errorCode, errorMessage } from "../errors";
import {
  createCompanyBody,
  updateCompanyBody,
  LOGO_MAX_BYTES,
  type CreateCompanyBody,
  type UpdateCompanyBody,
} from "../../shared/validators/companies";
import { recordAudit } from "../services/audit.service";
import { inspectUpload, UploadRejectedError } from "../services/upload-guard";
import { deleteReceiptImage, readReceiptImage, saveReceiptFile } from "../services/fileStorage";
import { z } from "zod";
import { createDefaultAccountsForCompany } from "../defaultChartOfAccounts";
import { createLogger } from "../config/logger";
import { ensureCriticalSchema } from "../db";
import { withNrClientVatGroup } from "../services/firm-clients.service";

const log = createLogger("companies");

function isCompanySchemaDriftError(err: unknown): boolean {
  const code = errorCode(err);
  return code === "42703" || code === "42P01";
}

/** Fields node-postgres puts on a DatabaseError. */
interface PgDriverError {
  code?: string;
  constraint?: string;
  column?: string;
  detail?: string;
  table?: string;
  message?: string;
}

async function withCompanySchemaRepair<T>(
  ctx: { route: string; id?: string; userId?: string },
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (err: unknown) {
    if (!isCompanySchemaDriftError(err)) throw err;

    log.error(
      { ...ctx, pgCode: errorCode(err), err: errorMessage(err) },
      "Company write hit schema drift; running critical schema guard and retrying once"
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
  err: unknown,
  ctx: { route: string; id?: string; userId?: string },
  res: Response
): boolean {
  const pgErr = (err ?? {}) as PgDriverError;
  const code: string | undefined = pgErr.code;

  // Always emit a structured log so production can tell apart 23505 from
  // 42703 from a connection drop. Includes the constraint/column the driver
  // gives us so we don't have to guess from the message text.
  log.warn(
    {
      ...ctx,
      pgCode: code,
      pgConstraint: pgErr.constraint,
      pgColumn: pgErr.column,
      pgDetail: pgErr.detail,
      pgTable: pgErr.table,
      err: pgErr.message,
    },
    "Company write failed"
  );

  switch (code) {
    case "23505": // unique_violation
      res.status(409).json({
        message: "That value is already taken by another tenant. Please pick a different one.",
        code: "COMPANY_VALUE_TAKEN",
        field: pgErr.constraint?.includes("name") ? "name" : undefined,
      });
      return true;
    case "23502": // not_null_violation
      res.status(400).json({
        message: `Required field is missing: ${pgErr.column ?? "unknown"}`,
        code: "REQUIRED_FIELD_MISSING",
        field: pgErr.column,
      });
      return true;
    case "23514": // check_violation
      res.status(400).json({
        message: `Value rejected by validation rule: ${pgErr.constraint ?? "check constraint"}`,
        code: "CONSTRAINT_VIOLATION",
      });
      return true;
    case "22001": // string_data_right_truncation (value too long)
      res.status(400).json({
        message: "One of the values you entered is too long for this field.",
        code: "VALUE_TOO_LONG",
      });
      return true;
    case "22P02": // invalid_text_representation (e.g. bad uuid)
      res.status(400).json({
        message: "One of the values you entered is not valid for this field.",
        code: "INVALID_IDENTIFIER",
      });
      return true;
    case "42703": // undefined_column — schema/DB drift
    case "42P01": // undefined_table
      // The schema-guard in server/db.ts is meant to prevent this; if we
      // still hit it after the one-shot repair, return a clear retryable
      // service error instead of leaking a generic 500 to onboarding.
      log.error(
        { ...ctx, pgCode: code, err: pgErr.message },
        "Schema drift: companies write referenced a missing column/table"
      );
      res.status(503).json({
        message: "Company database schema is being repaired. Please retry in a moment.",
        code: "COMPANY_SCHEMA_REPAIR_REQUIRED",
      });
      return true;
    default:
      return false;
  }
}

/**
 * Seed Chart of Accounts for a company using the default UAE chart.
 */
async function seedChartOfAccounts(
  companyId: string
): Promise<{ created: number; alreadyExisted: boolean }> {
  // Check if company already has accounts
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) {
    log.info({ companyId }, "Company already has accounts, skipping seed");
    return { created: 0, alreadyExisted: true };
  }

  // Create all default accounts for this company
  const defaultAccounts = createDefaultAccountsForCompany(companyId);

  try {
    const createdAccounts = await storage.createBulkAccounts(defaultAccounts);
    log.info({ companyId, count: createdAccounts.length }, "Created chart of accounts");
    return { created: createdAccounts.length, alreadyExisted: false };
  } catch (error: unknown) {
    if (errorMessage(error)?.includes("PARTIAL_INSERT")) {
      log.error({ companyId, err: errorMessage(error) }, "Partial insert detected during COA seed");
      throw new Error(
        "PARTIAL_CHART: Chart of Accounts partially created due to race condition. Please contact support."
      );
    }
    throw error;
  }
}

/** Returned with company writes that carry a TRN: we check the format, not the FTA register. */
const TRN_VERIFICATION = {
  format: "checked",
  ftaLookup: "external_not_integrated",
} as const;

export function registerCompanyRoutes(app: Express) {
  // =====================================
  // Company Routes
  // =====================================

  app.get(
    "/api/companies",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = req.user!;
      // A client_portal user sees its supplier only through /api/client-portal/company. The app
      // shell still lists companies on every page, so answer that with nothing instead of a 403
      // (no failed call, and no supplier company row leaks to the customer).
      if (req.user!.userType === "client_portal" && !req.user!.isAdmin) {
        return res.json([]);
      }
      const companies = await storage.getAccessibleCompanies(
        userId,
        firmRole,
        req.user?.isAdmin === true
      );
      // myRole lets the client keep owner-only flows (the setup wizard) away from
      // invited members. Firm-accessible client companies have no direct membership.
      const roles = await storage.getCompanyRolesByUserId(userId);
      const enforceTrialLock = billingEnforced() && !bypassesTrialLock(req.user!);
      res.set("Cache-Control", "private, no-store").json(
        await Promise.all(
          companies.map(async (company) => {
            const myRole = roles[company.id] ?? null;
            if (enforceTrialLock && (await companyTrialLocked(company.id))) {
              // The company switcher and billing need identity and role, but no business data.
              return {
                id: company.id,
                name: company.name,
                companyType: company.companyType,
                onboardingCompleted: company.onboardingCompleted,
                myRole,
              };
            }
            return { ...withNrClientVatGroup(company), myRole };
          })
        )
      );
    })
  );

  app.post(
    "/api/companies",
    authMiddleware,
    // H8: the old plan caps were bypassable by
    // simply creating another company. maxCompanies is now actually enforced.
    checkCompanyQuota(),
    strictBody(createCompanyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const { vatRegistered: _legacyVatRegistered, ...validated } =
        parsedBody<CreateCompanyBody>(req);

      if (validated.defaultVatRate !== undefined) {
        assertUaeVatRate(validated.defaultVatRate, "defaultVatRate", "default VAT rate");
      }

      // companyType decides the access model (customer SaaS vs NRA-managed client): only a
      // platform admin may create anything other than a customer company (R17-05).
      if (
        validated.companyType !== undefined &&
        validated.companyType !== "customer" &&
        req.user?.isAdmin !== true
      ) {
        throw new DomainError(
          "COMPANY_TYPE_ADMIN_ONLY",
          403,
          undefined,
          "Only a platform admin can set the company type."
        );
      }

      // Names are unique per owner (case-insensitive), not across tenants (R14-09).
      if (await storage.ownerHasCompanyNamed(userId, validated.name)) {
        throw new DomainError(
          "COMPANY_NAME_TAKEN",
          409,
          { field: "name" },
          "You already have a company with this name."
        );
      }

      let company;
      try {
        company = await withCompanySchemaRepair({ route: "POST /api/companies", userId }, () =>
          storage.createCompany(validated as never)
        );
      } catch (err: unknown) {
        if (handleCompanyWriteError(err, { route: "POST /api/companies", userId }, res)) {
          return;
        }
        throw err;
      }

      // Associate user with company as owner
      await storage.createCompanyUser({
        companyId: company.id,
        userId,
        role: "owner",
      });

      // Seed Chart of Accounts
      await seedChartOfAccounts(company.id);

      res.json(withNrClientVatGroup(company));
    })
  );

  app.get(
    "/api/companies/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const { id: userId, firmRole } = req.user!;

      // Check if user has access to this company (or via firm role)
      const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const company = await storage.getCompany(id);
      if (!company) {
        return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
      }

      res.json(company);
    })
  );

  /**
   * Single write path for PUT, PATCH and PATCH /preferences (R14-07, R14-20): the body was
   * validated by `updateCompanyBody`; this applies the business rules and writes.
   */
  async function updateCompanyHandler(route: string, req: Request, res: Response) {
    const { id } = req.params;
    const { id: userId, firmRole } = req.user!;

    const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
    }
    const current = await storage.getCompany(id);
    if (!current) {
      return res.status(404).json({ message: "Company not found", code: "COMPANY_NOT_FOUND" });
    }

    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.body as UpdateCompanyBody)) {
      if (value !== undefined && key !== "vatRegistered") updateData[key] = value;
    }

    // WQ3 (12.10): the default VAT rate is 0% or the UAE standard rate (5%).
    if ("defaultVatRate" in updateData) {
      assertUaeVatRate(updateData.defaultVatRate, "defaultVatRate", "default VAT rate");
    }

    // PRIVILEGE ESCALATION GUARD (R17-05). `companyType` decides whether a company is a
    // self-serve customer or an accounting-firm/NRA tenant, which gates entire route families.
    // Only a platform admin may change it; re-sending the current value is a no-op.
    if ("companyType" in updateData) {
      if (updateData.companyType === current.companyType) {
        delete updateData.companyType;
      } else if (req.user?.isAdmin !== true) {
        throw new DomainError(
          "COMPANY_TYPE_ADMIN_ONLY",
          403,
          undefined,
          "Only a platform admin can change the company type."
        );
      }
    }

    // Base currency is part of every posted amount's meaning: freeze it once books exist (R14-08).
    if (
      typeof updateData.baseCurrency === "string" &&
      updateData.baseCurrency !== current.baseCurrency
    ) {
      if (await storage.companyHasPostedJournal(id)) {
        throw new DomainError(
          "BASE_CURRENCY_LOCKED",
          409,
          { currentBaseCurrency: current.baseCurrency },
          "Base currency cannot change after journal entries have been posted."
        );
      }
    }

    if (
      typeof updateData.name === "string" &&
      updateData.name.trim().toLowerCase() !== current.name.trim().toLowerCase() &&
      (await storage.ownerHasCompanyNamed(userId, updateData.name, id))
    ) {
      throw new DomainError(
        "COMPANY_NAME_TAKEN",
        409,
        { field: "name" },
        "You already have a company with this name."
      );
    }

    // Nothing updatable survived (e.g. only a no-op companyType): return the company unchanged
    // rather than issuing an UPDATE with no columns, which the driver rejects.
    if (Object.keys(updateData).length === 0) {
      return res.json(withNrClientVatGroup(current));
    }

    try {
      const company = await withCompanySchemaRepair({ route, id, userId }, () =>
        storage.updateCompany(id, updateData as never)
      );
      await recordAudit({
        userId,
        companyId: id,
        action: "company.update",
        entityType: "company",
        entityId: id,
        before: {
          baseCurrency: current.baseCurrency,
          trnVatNumber: current.trnVatNumber,
          fiscalYearStartMonth: current.fiscalYearStartMonth,
        },
        after: {
          baseCurrency: company.baseCurrency,
          trnVatNumber: company.trnVatNumber,
          fiscalYearStartMonth: company.fiscalYearStartMonth,
        },
        req,
        extra: { fields: Object.keys(updateData).filter((k) => k !== "logoUrl") },
      });
      log.info({ id: company.id, route }, "Company updated");
      res.json(
        company.trnVatNumber
          ? { ...withNrClientVatGroup(company), trnVerification: TRN_VERIFICATION }
          : withNrClientVatGroup(company)
      );
    } catch (err: unknown) {
      if (handleCompanyWriteError(err, { route, id, userId }, res)) {
        return;
      }
      throw err;
    }
  }

  // PUT is an alias for PATCH — some clients send PUT for full updates
  app.put(
    "/api/companies/:id",
    authMiddleware,
    strictBody(updateCompanyBody),
    asyncHandler((req: Request, res: Response) =>
      updateCompanyHandler("PUT /api/companies/:id", req, res)
    )
  );

  app.patch(
    "/api/companies/:id",
    authMiddleware,
    strictBody(updateCompanyBody),
    asyncHandler((req: Request, res: Response) =>
      updateCompanyHandler("PATCH /api/companies/:id", req, res)
    )
  );

  // QuickBooks-style company preferences page. Same contract as PATCH /api/companies/:id.
  app.patch(
    "/api/companies/:id/preferences",
    authMiddleware,
    strictBody(updateCompanyBody),
    asyncHandler((req: Request, res: Response) =>
      updateCompanyHandler("PATCH /api/companies/:id/preferences", req, res)
    )
  );

  // Logo upload: bytes are validated (magic-byte sniff, 1 MB cap, raster only) and stored
  // through fileStorage; only the storage key lives on the company row (R14-13).
  app.post(
    "/api/companies/:id/logo",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({ imageData: z.string().min(1).max(2_000_000) })),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;
      if (!(await storage.hasCompanyAccess(userId, id))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      let inspected;
      try {
        inspected = await inspectUpload((req.body as { imageData: string }).imageData);
      } catch (err) {
        if (err instanceof UploadRejectedError) {
          return res.status(err.status).json({ message: err.message, code: err.code });
        }
        throw err;
      }
      if (!/^image\/(png|jpeg|webp|gif)$/.test(inspected.mime)) {
        throw new DomainError(
          "LOGO_TYPE_UNSUPPORTED",
          400,
          undefined,
          "Logo must be PNG, JPEG, WebP or GIF"
        );
      }
      if (inspected.size > LOGO_MAX_BYTES) {
        throw new DomainError("LOGO_TOO_LARGE", 413, undefined, "Logo must be 1 MB or smaller");
      }
      const previous = await storage.getCompany(id);
      const key = await saveReceiptFile(inspected.buffer, {
        mime: inspected.mime,
        ext: inspected.ext,
      });
      const company = await storage.updateCompany(id, { logoPath: key } as never);
      if (previous?.logoPath) await deleteReceiptImage(previous.logoPath).catch(() => undefined);
      await recordAudit({
        userId,
        companyId: id,
        action: "company.logo_upload",
        entityType: "company",
        entityId: id,
        before: null,
        after: { mime: inspected.mime, size: inspected.size },
        req,
      });
      res.json({ logoPath: company.logoPath, mime: inspected.mime, size: inspected.size });
    })
  );

  app.get(
    "/api/companies/:id/logo",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const { id: userId, firmRole } = req.user!;
      if (!(await storage.hasCompanyAccess(userId, id, firmRole))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const company = await storage.getCompany(id);
      if (!company?.logoPath)
        return res.status(404).json({ message: "No logo uploaded", code: "LOGO_NOT_FOUND" });
      const image = await readReceiptImage(company.logoPath);
      if (!image)
        return res.status(404).json({ message: "No logo uploaded", code: "LOGO_NOT_FOUND" });
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(image.buffer);
    })
  );

  // Mark company onboarding as complete
  app.post(
    "/api/companies/:id/onboarding/complete",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = req.user!.id;

      const hasAccess = await storage.hasCompanyAccess(userId, id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      const company = await storage.updateCompany(id, { onboardingCompleted: true });
      res.json(withNrClientVatGroup(company));
    })
  );

  // NOTE: GET/POST /api/companies/:id/bank-accounts used to be declared here.
  //
  // They were SHADOWING the richer handlers in bank-statements.routes.ts, which
  // validate the bank against the UAE bank list and link a GL account. Express
  // matches the first registration, and this module registers earlier, so the
  // stricter handlers never ran and a bank account could be created with any
  // bankName at all.
  //
  // The canonical handlers now live in bank-statements.routes.ts alongside the
  // rest of the banking surface. `scripts/check-route-shadowing.mjs` fails the
  // build if a duplicate is ever reintroduced.

  // Seed Chart of Accounts for company
  // Customer-only: Seed chart of accounts
  app.post(
    "/api/companies/:id/seed-accounts",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const { id: userId, firmRole } = req.user!;

      // Check if user has access to this company (or via firm role)
      const hasAccess = await storage.hasCompanyAccess(userId, id, firmRole);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }

      // Seed Chart of Accounts
      const result = await seedChartOfAccounts(id);

      const accountsWithBalances = await storage.getAccountsWithBalances(id);

      if (result.alreadyExisted) {
        return res.status(409).json({
          message: "Chart of Accounts already exists for this company",
          code: "CHART_ALREADY_EXISTS",
          accounts: accountsWithBalances,
        });
      }

      res.status(201).json({
        message: "Chart of Accounts seeded successfully",
        accountsCreated: result.created,
        accounts: accountsWithBalances,
      });
    })
  );
}
