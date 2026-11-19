/**
 * VAT Return Autopilot routes (Phase 3).
 *
 * All routes are companyId-scoped through `storage.hasCompanyAccess`. Firm
 * users hit the `/due-dates` endpoint to see deadlines across every client
 * they have access to in a single view.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { pool } from "../db";
import { AppError, DomainError, errorMessage } from "../errors";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { recordAudit } from "../services/audit.service";
import { vatAutopilotStatusBody } from "../../shared/validators/vat";
import { assertAlignedPeriod, frequencyOf } from "../tax/vat-periods";
import { loadVatCompany } from "../tax/vat-engine";
import {
  calculateVatReturn,
  upsertCalculatedPeriod,
  listPeriodsForCompany,
  addAdjustment,
  updatePeriodStatus,
  listDueDates,
  computeDueDate,
  isValidVat201BoxKey,
  type VatPeriod,
} from "../services/vat-autopilot.service";

function userId(req: Request): string | undefined {
  return req.user?.id;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Invalid ISO date" });

const calculateQuerySchema = z.object({
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
  frequency: z.enum(["monthly", "quarterly"]).optional(),
  persist: z.union([z.literal("true"), z.literal("false")]).optional(),
});

// `amount` is bounded to ±1 trillion AED so a malicious or fat-fingered value
// can't blow up downstream numeric columns. NaN/Infinity are rejected by the
// `.finite()` clause.
const adjustmentBodySchema = z.strictObject({
  companyId: z.string().guid(),
  periodId: z.string().guid(),
  box: z.string().refine(isValidVat201BoxKey, { message: "Unknown VAT 201 box key" }),
  amount: z.number().finite().min(-1e12).max(1e12),
  reason: z.string().min(1).max(2000),
});

const dueDatesQuerySchema = z.object({
  companyId: z.string().guid().optional(),
});

const companyIdParamSchema = z.object({ companyId: z.string().guid() });

/**
 * An explicit period must be exactly one tax period of the company's stagger (R07-07): a
 * misaligned range is 422 PERIOD_NOT_ALIGNED. The due date is statutory (period end + 28 days).
 */
async function parsePeriod(
  companyId: string,
  parsed: z.infer<typeof calculateQuerySchema>
): Promise<VatPeriod | undefined> {
  if (!parsed.periodStart && !parsed.periodEnd) return undefined;
  const company = await loadVatCompany(companyId);
  const frequency = parsed.frequency ?? company.frequency;
  const aligned = assertAlignedPeriod({
    from: parsed.periodStart,
    to: parsed.periodEnd,
    frequency: frequencyOf(frequency),
    startMonth: company.startMonth,
  });
  const start = new Date(`${aligned.from}T00:00:00.000Z`);
  const end = new Date(`${aligned.to}T23:59:59.999Z`);
  return { start, end, dueDate: computeDueDate(end), frequency: aligned.frequency };
}

function badRequest(res: Response, err: z.ZodError) {
  return res.status(400).json({
    message: "Invalid request",
    code: "VALIDATION_ERROR",
    issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

/**
 * Map service-thrown errors onto HTTP responses. Known validation failures
 * produce 4xx; anything else (DB outage, code bug) must propagate as 500 so
 * it isn't silently masked as a generic "calculation failed" 400.
 */
function mapCalculationError(err: unknown): { status: number; code: string; message: string } {
  // Engine / period / TRN errors already carry their status and code.
  if (err instanceof AppError) throw err;
  const message = (err as { message?: string })?.message || "Failed to calculate VAT return";
  if (/TRN/.test(message)) return { status: 400, code: "NO_TRN", message };
  if (/emirate/i.test(message)) return { status: 422, code: "EMIRATE_NOT_SET", message };
  if (/not found/i.test(message)) return { status: 404, code: "NOT_FOUND", message };
  return { status: 500, code: "CALCULATION_FAILED", message };
}

export function registerVATAutopilotRoutes(app: Express) {
  // ─── Auto-calculate the current (or specified) period ─────────────────────
  app.get(
    "/api/vat/autopilot/calculate/:companyId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = companyIdParamSchema.safeParse(req.params);
      if (!params.success) return badRequest(res, params.error);
      const query = calculateQuerySchema.safeParse(req.query);
      if (!query.success) return badRequest(res, query.error);

      const { companyId } = params.data;
      const uid = userId(req);
      if (!uid) return res.status(401).json({ message: "Unauthenticated", code: "AUTH_REQUIRED" });
      const hasAccess = await storage.hasCompanyAccess(uid, companyId);
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      // Optional period override via query string for historical calculations.
      const period = await parsePeriod(companyId, query.data);

      try {
        const calc = await calculateVatReturn(companyId, period);
        // Persist the snapshot so the periods listing reflects it.
        const persist = query.data.persist !== "false";
        let periodId: string | null = null;
        if (persist) {
          periodId = await upsertCalculatedPeriod(calc);
        }
        res.json({ ...calc, periodId });
      } catch (err) {
        const mapped = mapCalculationError(err);
        res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
      }
    })
  );

  // ─── List all periods (with status, calculation snapshot, deadline) ───────
  app.get(
    "/api/vat/autopilot/periods/:companyId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = companyIdParamSchema.safeParse(req.params);
      if (!params.success) return badRequest(res, params.error);

      const { companyId } = params.data;
      const uid = userId(req);
      if (!uid) return res.status(401).json({ message: "Unauthenticated", code: "AUTH_REQUIRED" });
      const hasAccess = await storage.hasCompanyAccess(uid, companyId);
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      const periods = await listPeriodsForCompany(companyId);
      res.json(periods);
    })
  );

  // ─── Single period detail (with adjustments) ──────────────────────────────
  app.get(
    "/api/vat/autopilot/periods/:companyId/:periodId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = z
        .object({
          companyId: z.string().guid(),
          periodId: z.string().guid(),
        })
        .safeParse(req.params);
      if (!params.success) return badRequest(res, params.error);

      const { companyId, periodId } = params.data;
      const uid = userId(req);
      if (!uid) return res.status(401).json({ message: "Unauthenticated", code: "AUTH_REQUIRED" });
      const hasAccess = await storage.hasCompanyAccess(uid, companyId);
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const result = await pool.query(
        `SELECT * FROM vat_return_periods WHERE id = $1 AND company_id = $2`,
        [periodId, companyId]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ message: "Period not found", code: "VAT_PERIOD_NOT_FOUND" });
      res.json(result.rows[0]);
    })
  );

  // ─── Add a manual adjustment to a period ──────────────────────────────────
  app.post(
    "/api/vat/autopilot/adjustments",
    authMiddleware,
    strictBody(adjustmentBodySchema, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, periodId, box, amount, reason } =
        parsedBody<z.output<typeof adjustmentBodySchema>>(req);
      const uid = userId(req);
      if (!uid) return res.status(401).json({ message: "Unauthenticated", code: "AUTH_REQUIRED" });
      const hasAccess = await storage.hasCompanyAccess(uid, companyId);
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      // Service-layer also filters by company_id on the UPDATE — that's the
      // authoritative gate. The pre-check here only exists so we can surface a
      // 404 distinct from "period belongs to another tenant" without leaking it.
      try {
        const adjustment = await addAdjustment({
          periodId,
          companyId,
          box,
          amount,
          reason,
          userId: uid,
        });
        res.status(201).json(adjustment);
      } catch (err: unknown) {
        res
          .status(400)
          .json({
            message: errorMessage(err) || "Could not add adjustment",
            code: "VAT_ADJUSTMENT_FAILED",
          });
      }
    })
  );

  // ─── Update period filing status ──────────────────────────────────────────
  app.patch(
    "/api/vat/autopilot/periods/:periodId/status",
    authMiddleware,
    strictBody(vatAutopilotStatusBody, { allowServerOwned: ["companyId", "status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const params = z.object({ periodId: z.string().guid() }).safeParse(req.params);
      if (!params.success) return badRequest(res, params.error);

      const { periodId } = params.data;
      const { companyId, status, ftaReferenceNumber, overrideReason } =
        parsedBody<z.output<typeof vatAutopilotStatusBody>>(req);
      const uid = userId(req);
      if (!uid) return res.status(401).json({ message: "Unauthenticated", code: "AUTH_REQUIRED" });
      const hasAccess = await storage.hasCompanyAccess(uid, companyId);
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      // E1 (J3-r2): one state machine. Submitting / filing a return goes through the VAT return
      // flow (Returns tab), never a one-click flip of the period.
      if (status === "submitted" || status === "accepted") {
        return res.status(409).json({
          message:
            "Submit and file the VAT return from the Returns tab; a period cannot be marked submitted on its own.",
          code: "USE_VAT_RETURN_FLOW",
        });
      }

      try {
        const summary = await updatePeriodStatus({
          periodId,
          companyId,
          newStatus: status,
          userId: uid,
          ftaReferenceNumber,
          overrideReason: overrideReason ?? null,
        });
        if (!summary)
          return res
            .status(404)
            .json({ message: "Period not found", code: "VAT_PERIOD_NOT_FOUND" });
        await recordAudit({
          userId: uid,
          companyId,
          action: `vat_period.status.${status}`,
          entityType: "vat_return_period",
          entityId: periodId,
          after: { status, overrideReason: overrideReason ?? null },
          req,
        });
        res.json(summary);
      } catch (err: unknown) {
        if (err instanceof DomainError) throw err;
        res.status(400).json({
          message: (err as Error)?.message || "Could not update status",
          code: "INVALID_TRANSITION",
        });
      }
    })
  );

  // ─── Firm-wide upcoming deadlines ─────────────────────────────────────────
  app.get(
    "/api/vat/autopilot/due-dates",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const uid = userId(req);
      if (!uid) return res.status(401).json({ message: "Unauthenticated", code: "AUTH_REQUIRED" });
      const query = dueDatesQuerySchema.safeParse(req.query);
      if (!query.success) return badRequest(res, query.error);
      if (query.data.companyId) {
        const hasAccess = await storage.hasCompanyAccess(uid, query.data.companyId);
        if (!hasAccess)
          return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
        const dueDates = await listDueDates([query.data.companyId]);
        return res.json(dueDates);
      }

      // Resolve every company the caller has direct membership in. Firm staff
      // see all assigned clients via the same companyUsers join; ordinary users
      // see only their own companies. Either way the SQL is server-side
      // filtered to the caller — no client-supplied company list is trusted.
      const companies = await storage.getCompaniesByUserId(uid);
      const accessibleIds = companies.map((c) => c.id);
      if (accessibleIds.length === 0) return res.json([]);
      const dueDates = await listDueDates(accessibleIds);
      res.json(dueDates);
    })
  );
}
