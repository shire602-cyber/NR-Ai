/**
 * Compliance calendar (W4-A: R08-21, R13-34, R15-10). Moved out of
 * document-chasing.routes.ts:
 *
 * - reads are scoped to the company (members and NR firm staff);
 * - writes need owner / admin / accountant (`tax.submit`) or firm staff;
 * - links to document requirements are an NR-firm-only feature: hidden from
 *   customers in responses and refused on customer writes.
 *
 * Generated obligations (VAT/CT/registration/UBO/licence/excise/e-invoicing/
 * WPS) come from services/compliance-obligations.service.ts.
 *
 * S4: every GET is read-only. Reads merge the live obligation specs over the
 * stored rows; the stored calendar is refreshed by the daily job
 * `compliance.deadlineScan`, by POST .../generate and by the change observer
 * (compliance-obligation-refresh.ts) after company settings, VAT stagger,
 * filings and payroll change. An obligation that is shown but not stored yet
 * has id `preview:<key>`; PATCHing it stores the calendar first.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { storage } from "../storage";
import { pool } from "../db";
import { DomainError } from "../errors";
import { strictBody } from "../http/strict-body";
import { COMPLIANCE_EVENT_TYPES } from "@shared/schema";
import { isNraFirmRole } from "../../shared/access";
import { zDateIn, zText, zUuid } from "../../shared/validators/primitives";
import { getRequirement } from "../services/document-chasing.service";
import {
  ensureGenerated,
  generateObligations,
  getCalendarRow,
  getCalendarRowByKey,
  PREVIEW_ID_PREFIX,
  listCalendar,
  listUpcoming,
  registerComplianceObligations,
} from "../services/compliance-obligations.service";
import { uaeToday } from "../services/corporate-tax/deadlines";

function isFirmUser(req: Request): boolean {
  return req.user?.isAdmin === true || isNraFirmRole(req.user?.firmRole ?? null);
}

async function requireCalendarAccess(req: Request, companyId: string): Promise<void> {
  if (!zUuid.safeParse(companyId).success) {
    throw new DomainError("INVALID_IDENTIFIER", 400, undefined, "Invalid path parameters");
  }
  const ok = await storage.hasCompanyAccess(req.user!.id, companyId, req.user!.firmRole ?? null);
  if (!ok) throw new DomainError("ACCESS_DENIED", 403, undefined, "Access denied");
}

const zCalendarDate = zDateIn({ min: "2000-01-01", maxDaysAhead: 3700 });

const rangeQuery = z.object({
  from: zCalendarDate.optional(),
  to: zCalendarDate.optional(),
  /** Legacy: GET never generates any more; accepted and ignored. */
  generate: z.enum(["true", "false"]).optional(),
});

const createEventSchema = z
  .object({
    eventType: z.enum(COMPLIANCE_EVENT_TYPES),
    description: zText(500, { min: 1 }),
    eventDate: zCalendarDate,
    reminderDays: z.array(z.number().int().min(0).max(365)).max(10).optional(),
    linkedRequirementId: zUuid.nullable().optional(),
  })
  .strict();

const generateSchema = z.object({ year: z.number().int().min(2023).max(2100).optional() }).strict();

const updateEventSchema = z
  .object({
    status: z.enum(["upcoming", "completed", "dismissed"]),
    note: zText(500).optional(),
  })
  .strict();

export function registerComplianceCalendarRoutes(app: Express) {
  registerComplianceObligations();

  app.get(
    "/api/companies/:companyId/compliance-calendar",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireCalendarAccess(req, companyId);
      const q = rangeQuery.parse(req.query);
      // Read-only: statuses follow the live return state via the merged specs.
      res.json(
        await listCalendar(companyId, {
          from: q.from,
          to: q.to,
          includeFirmLinks: isFirmUser(req),
        })
      );
    })
  );

  app.get(
    "/api/companies/:companyId/compliance-calendar/upcoming",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireCalendarAccess(req, companyId);
      const days = Math.min(366, Math.max(1, Number(req.query.days) || 30));
      res.json(await listUpcoming(companyId, { days }));
    })
  );

  app.post(
    "/api/companies/:companyId/compliance-calendar/generate",
    authMiddleware,
    requirePermission("tax.submit"),
    strictBody(generateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireCalendarAccess(req, companyId);
      const year = (req.body.year as number | undefined) ?? Number(uaeToday().slice(0, 4));
      const result = await generateObligations(companyId, year);
      res.json(result);
    })
  );

  app.post(
    "/api/companies/:companyId/compliance-calendar",
    authMiddleware,
    requirePermission("tax.submit"),
    strictBody(createEventSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await requireCalendarAccess(req, companyId);
      const body = createEventSchema.parse(req.body);
      if (body.linkedRequirementId) {
        if (!isFirmUser(req)) {
          throw new DomainError(
            "FIRM_ONLY_FIELD",
            403,
            { field: "linkedRequirementId" },
            "Document requirements are managed by the firm"
          );
        }
        // Cross-tenant guard: resolve the requirement scoped to this company.
        const linked = await getRequirement(companyId, body.linkedRequirementId);
        if (!linked) {
          throw new DomainError(
            "LINKED_REQUIREMENT_NOT_FOUND",
            400,
            undefined,
            "linkedRequirementId does not belong to this company"
          );
        }
      }
      const r = await pool.query(
        `INSERT INTO compliance_calendar
           (company_id, event_type, description, event_date, reminder_days, linked_requirement_id, source)
         VALUES ($1, $2, $3, $4::date, $5, $6, 'manual') RETURNING id`,
        [
          companyId,
          body.eventType,
          body.description,
          body.eventDate,
          (body.reminderDays ?? [30, 14, 7, 0]).join(","),
          body.linkedRequirementId ?? null,
        ]
      );
      const row = await getCalendarRow(companyId, r.rows[0].id, isFirmUser(req));
      res.status(201).json(row);
    })
  );

  app.patch(
    "/api/companies/:companyId/compliance-calendar/:eventId",
    authMiddleware,
    requirePermission("tax.submit"),
    strictBody(updateEventSchema, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      let { eventId } = req.params;
      await requireCalendarAccess(req, companyId);
      if (eventId.startsWith(PREVIEW_ID_PREFIX)) {
        // A computed-but-unstored obligation: store the calendar (a write), then act on it.
        const key = eventId.slice(PREVIEW_ID_PREFIX.length);
        if (!/^[a-z_]+(:[0-9a-z_-]+)?$/i.test(key)) throw new DomainError("NOT_FOUND", 404);
        await ensureGenerated(companyId);
        const stored = await getCalendarRowByKey(companyId, key);
        if (!stored) throw new DomainError("NOT_FOUND", 404);
        eventId = stored.id;
      }
      if (!zUuid.safeParse(eventId).success) throw new DomainError("NOT_FOUND", 404);
      const row = await getCalendarRow(companyId, eventId);
      if (!row) throw new DomainError("NOT_FOUND", 404);
      if (row.statusDerived) {
        throw new DomainError(
          "STATUS_DERIVED",
          409,
          { obligationType: row.obligationType },
          "This obligation's status follows the return; file the return to complete it"
        );
      }
      const status = req.body.status as "upcoming" | "completed" | "dismissed";
      await pool.query(
        `UPDATE compliance_calendar
            SET status = $3, completed_at = CASE WHEN $3 = 'completed' THEN now() END,
                updated_at = now()
          WHERE company_id = $1 AND id = $2`,
        [companyId, eventId, status]
      );
      const { recordAudit } = await import("../services/audit.service");
      await recordAudit({
        userId: req.user!.id,
        companyId,
        action: `compliance_obligation.${status}`,
        entityType: "compliance_calendar",
        entityId: eventId,
        before: { status: row.status },
        after: { status, note: req.body.note ?? null },
        req,
      });
      res.json(await getCalendarRow(companyId, eventId, isFirmUser(req)));
    })
  );
}
