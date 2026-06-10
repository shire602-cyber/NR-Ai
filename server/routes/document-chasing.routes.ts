import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import {
  CHASE_CHANNELS,
  CHASE_LEVELS,
  COMPLIANCE_EVENT_TYPES,
  DOCUMENT_TYPES,
  REQUIREMENT_STATUSES,
  type ChaseLevel,
} from "@shared/schema";
import {
  buildChaseQueue,
  createComplianceEvent,
  createRequirement,
  effectivenessReport,
  getRequirement,
  listChasesForRequirement,
  listComplianceEvents,
  listRequirements,
  markRequirementReceived,
  recordChaseSend,
  renderChaseMessage,
  updateRequirement,
  whatsappDeepLink,
  daysUntil,
  nextChaseLevel,
} from "../services/document-chasing.service";

// Centralised company-access check. Returns the company on success or null
// after writing the appropriate error response, so callers can early-return.
async function requireCompanyAccess(req: Request, res: Response, companyId: string) {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ message: "Authentication required" });
    return null;
  }
  const ok = await storage.hasCompanyAccess(userId, companyId);
  if (!ok) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  const company = await storage.getCompany(companyId);
  if (!company) {
    res.status(404).json({ message: "Company not found" });
    return null;
  }
  return company;
}

const documentTypeSchema = z.enum(DOCUMENT_TYPES);
const requirementStatusSchema = z.enum(REQUIREMENT_STATUSES);
const chaseChannelSchema = z.enum(CHASE_CHANNELS);
const chaseLevelSchema = z.enum(CHASE_LEVELS);
const complianceEventTypeSchema = z.enum(COMPLIANCE_EVENT_TYPES);

const createRequirementSchema = z.object({
  documentType: documentTypeSchema,
  description: z.string().max(500).optional().nullable(),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  isRecurring: z.boolean().optional().default(false),
  recurringIntervalDays: z.number().int().positive().max(3650).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const updateRequirementSchema = z.object({
  documentType: documentTypeSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  isRecurring: z.boolean().optional(),
  recurringIntervalDays: z.number().int().positive().max(3650).nullable().optional(),
  status: requirementStatusSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const sendChaseSchema = z.object({
  channel: chaseChannelSchema.optional().default("whatsapp"),
  recipientPhone: z.string().max(40).nullable().optional(),
  recipientEmail: z.string().email().max(200).nullable().optional(),
  overrideMessage: z.string().max(5000).optional(),
  overrideLevel: chaseLevelSchema.optional(),
});

const createComplianceEventSchema = z.object({
  eventType: complianceEventTypeSchema,
  description: z.string().min(1).max(500),
  eventDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  reminderDays: z.array(z.number().int().min(0).max(365)).optional(),
  linkedRequirementId: z.string().uuid().nullable().optional(),
});

// Path-param schemas. Drizzle parameterizes, but invalid UUIDs reach Postgres
// and surface as 500 (22P02). Validate at the edge so malformed input returns
// 400 deterministically and never touches the DB.
const companyIdParams = z.object({ companyId: z.string().uuid() });
const companyIdAndIdParams = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid(),
});
const companyIdAndRequirementIdParams = z.object({
  companyId: z.string().uuid(),
  requirementId: z.string().uuid(),
});

// Query-param schema for the compliance-calendar range. Reject anything that
// isn't a full ISO datetime or YYYY-MM-DD date instead of silently coercing
// "abc" to Invalid Date and dropping the filter.
const calendarRangeQuerySchema = z.object({
  from: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  to: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
});

// Parse path params via the given Zod schema; on failure write a 400 and
// return null so the caller can early-return.
function parsePathParams<S extends z.ZodTypeAny>(
  schema: S,
  params: unknown,
  res: Response,
): z.infer<S> | null {
  const result = schema.safeParse(params);
  if (!result.success) {
    res.status(400).json({ message: "Invalid path parameters" });
    return null;
  }
  return result.data;
}

export function registerDocumentChasingRoutes(app: Express) {
  // ─── Document Requirements ────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/document-requirements",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdParams, req.params, res);
      if (!params) return;
      const { companyId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const rows = await listRequirements(companyId);
      res.json(rows);
    }),
  );

  app.post(
    "/api/companies/:companyId/document-requirements",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdParams, req.params, res);
      if (!params) return;
      const { companyId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const validated = createRequirementSchema.parse(req.body);
      const row = await createRequirement({
        companyId,
        documentType: validated.documentType,
        description: validated.description ?? null,
        dueDate: validated.dueDate,
        isRecurring: validated.isRecurring,
        recurringIntervalDays: validated.recurringIntervalDays ?? null,
        notes: validated.notes ?? null,
      });
      res.status(201).json(row);
    }),
  );

  app.patch(
    "/api/companies/:companyId/document-requirements/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdAndIdParams, req.params, res);
      if (!params) return;
      const { companyId, id } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const patch = updateRequirementSchema.parse(req.body);
      const existing = await getRequirement(companyId, id);
      if (!existing) {
        res.status(404).json({ message: "Requirement not found" });
        return;
      }
      // If the patch flips status to 'received', also stamp receivedAt and
      // generate the next recurring instance.
      if (patch.status === "received") {
        const result = await markRequirementReceived(companyId, id);
        res.json(result.updated);
        return;
      }
      const row = await updateRequirement(companyId, id, patch);
      res.json(row);
    }),
  );

  // ─── Chase Queue ──────────────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/document-chases/queue",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdParams, req.params, res);
      if (!params) return;
      const { companyId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const queue = await buildChaseQueue(
        companyId,
        company.name,
        { phone: company.contactPhone ?? null, email: company.contactEmail ?? null },
      );
      res.json(queue);
    }),
  );

  app.get(
    "/api/companies/:companyId/document-chases/history/:requirementId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdAndRequirementIdParams, req.params, res);
      if (!params) return;
      const { companyId, requirementId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const rows = await listChasesForRequirement(companyId, requirementId);
      res.json(rows);
    }),
  );

  app.post(
    "/api/companies/:companyId/document-chases/send/:requirementId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdAndRequirementIdParams, req.params, res);
      if (!params) return;
      const { companyId, requirementId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const validated = sendChaseSchema.parse(req.body ?? {});
      const requirement = await getRequirement(companyId, requirementId);
      if (!requirement) {
        res.status(404).json({ message: "Requirement not found" });
        return;
      }
      const phone = validated.recipientPhone ?? company.contactPhone ?? null;
      const email = validated.recipientEmail ?? company.contactEmail ?? null;
      const dUntil = daysUntil(requirement.dueDate);
      const overdue = dUntil < 0 ? -dUntil : 0;
      const history = await listChasesForRequirement(companyId, requirementId);
      const lastLevel = history[0]?.chaseLevel as ChaseLevel | undefined;
      const computedLevel = nextChaseLevel(lastLevel ?? null, overdue);
      const level = validated.overrideLevel ?? computedLevel;
      const message =
        validated.overrideMessage ??
        renderChaseMessage(level, requirement.documentType, requirement.dueDate, company.name, overdue);
      const wa = whatsappDeepLink(phone, message);
      const chase = await recordChaseSend({
        companyId,
        requirementId,
        chaseLevel: level,
        sentVia: validated.channel,
        messageContent: message,
        recipientPhone: phone,
        recipientEmail: email,
      });
      res.status(201).json({ chase, whatsappLink: wa });
    }),
  );

  app.post(
    "/api/companies/:companyId/document-chases/bulk-send",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdParams, req.params, res);
      if (!params) return;
      const { companyId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const queue = await buildChaseQueue(
        companyId,
        company.name,
        { phone: company.contactPhone ?? null, email: company.contactEmail ?? null },
      );
      const sent = [] as Array<{ requirementId: string; chaseLevel: string; whatsappLink: string | null }>;
      for (const item of queue) {
        await recordChaseSend({
          companyId,
          requirementId: item.requirement.id,
          chaseLevel: item.nextLevel,
          sentVia: "whatsapp",
          messageContent: item.message,
          recipientPhone: company.contactPhone ?? null,
          recipientEmail: company.contactEmail ?? null,
        });
        sent.push({
          requirementId: item.requirement.id,
          chaseLevel: item.nextLevel,
          whatsappLink: item.whatsappLink,
        });
      }
      res.json({ sentCount: sent.length, sent });
    }),
  );

  app.get(
    "/api/companies/:companyId/document-chases/effectiveness",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdParams, req.params, res);
      if (!params) return;
      const { companyId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const report = await effectivenessReport(companyId);
      res.json(report);
    }),
  );

  // ─── Compliance Calendar ──────────────────────────────────────────
  app.get(
    "/api/companies/:companyId/compliance-calendar",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdParams, req.params, res);
      if (!params) return;
      const { companyId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const range = calendarRangeQuerySchema.parse(req.query);
      const fromQ = range.from ? new Date(range.from) : undefined;
      const toQ = range.to ? new Date(range.to) : undefined;
      const events = await listComplianceEvents(companyId, { from: fromQ, to: toQ });
      res.json(events);
    }),
  );

  app.post(
    "/api/companies/:companyId/compliance-calendar",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const params = parsePathParams(companyIdParams, req.params, res);
      if (!params) return;
      const { companyId } = params;
      const company = await requireCompanyAccess(req, res, companyId);
      if (!company) return;
      const validated = createComplianceEventSchema.parse(req.body);
      // Cross-tenant guard: a UUID-shaped linkedRequirementId is no proof of
      // ownership. Resolve it scoped to companyId so callers can never link
      // a calendar event in their tenant to a requirement row in another.
      if (validated.linkedRequirementId) {
        const linked = await getRequirement(companyId, validated.linkedRequirementId);
        if (!linked) {
          res
            .status(400)
            .json({ message: "linkedRequirementId does not belong to this company" });
          return;
        }
      }
      const row = await createComplianceEvent({
        companyId,
        eventType: validated.eventType,
        description: validated.description,
        eventDate: validated.eventDate,
        reminderDays: validated.reminderDays,
        linkedRequirementId: validated.linkedRequirementId ?? null,
      });
      res.status(201).json(row);
    }),
  );
}
