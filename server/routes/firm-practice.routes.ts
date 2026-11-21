/**
 * Practice-management HTTP surface (W5-D): firm onboarding, members, client
 * links/invitations, task templates and tasks, request lists, engagement
 * letters / proposals, time tracking, WIP, billing and filing packs.
 *
 * Mounted at /api: every "/firm/..." path passes authMiddleware +
 * requireFirmAccess(). Paths outside /firm (onboarding, client-owner side)
 * mount authMiddleware per route.
 */
import { parsedBody } from "../http/parsed-body";
import { Router } from "express";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { firmContextOf, requireFirmAccess, requireFirmPermission } from "../middleware/rbac";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { recordAudit } from "../services/audit.service";
import { zDate } from "../../shared/validators/primitives";
import { FIRM_ROLES, firmRoleHasPermission } from "../../shared/access";
import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import { firmTaskTemplates, firmTasks } from "../../shared/schema";
import { zOptionalClientTrn } from "../services/firm-clients.service";
import {
  accessibleClientsQuery,
  canAccessFirmClient,
  listAccessibleClientIds,
  type FirmContext,
} from "../services/firm/scope";
import {
  addFirmMember,
  listFirmStaff,
  removeFirmMember,
  updateFirmMember,
} from "../services/firm/staff.service";
import {
  acceptInvitation,
  applyForFirm,
  declineInvitation,
  decideFirmApplication,
  getMyFirm,
  inviteClient,
  listCompanyLinks,
  listFirmLinks,
  listFirmsForAdmin,
  listInvitationsForUser,
  revokeLinkByClient,
  withdrawFirmLink,
} from "../services/firm/clients.service";
import {
  ensureDefaultTemplates,
  generateRecurringTasks,
  listFirmTasks,
} from "../services/firm/workflow.service";
import {
  billWip,
  createEngagementTemplate,
  createLetter,
  listEngagementTemplates,
  listLettersForClient,
  listLettersForFirm,
  listServiceInvoices,
  listTimeEntries,
  logTime,
  respondToLetter,
  runRecurringBilling,
  sendLetter,
  startTimer,
  stopTimer,
  wipReport,
  withdrawLetter,
} from "../services/firm/billing.service";
import {
  FILING_TYPES,
  buildFilingPack,
  createRequests,
  fulfilRequest,
  listFilings,
  listRequestsForClient,
  listRequestsForFirm,
  recordFiling,
  reviewRequest,
} from "../services/firm/practice.service";

const zId = z.string().guid();
const zShort = (max: number) => z.string().trim().min(1).max(max);

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (!zId.safeParse(value).success) throw new DomainError("INVALID_ID", 400, { param: name });
  return value;
}

async function requireClient(res: Response, companyId: string): Promise<FirmContext> {
  const ctx = firmContextOf(res);
  if (!(await canAccessFirmClient(ctx, companyId))) throw new DomainError("CLIENT_NOT_FOUND", 404);
  return ctx;
}

function requireAdmin(req: Request): void {
  if (req.user?.isAdmin !== true) throw new DomainError("PLATFORM_ADMIN_REQUIRED", 403);
}

function authUser(req: Request): {
  id: string;
  email: string;
  isAdmin: boolean;
  firmRole: string | null;
} {
  const u = req.user;
  if (!u) throw new DomainError("AUTH_REQUIRED", 401);
  return { id: u.id, email: u.email, isAdmin: u.isAdmin === true, firmRole: u.firmRole ?? null };
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const applySchema = z.object({
  name: zShort(200),
  trn: zOptionalClientTrn,
  contactEmail: z.string().trim().email().max(200).optional(),
  contactPhone: z.string().trim().max(40).optional(),
});
const decisionSchema = z.object({
  decision: z.enum(["approve", "reject", "suspend"]),
  reason: z.string().trim().max(500).optional(),
});
const memberSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(FIRM_ROLES),
});
const memberRoleSchema = z.object({ role: z.enum(FIRM_ROLES) });
const inviteSchema = z.object({
  inviteeEmail: z.string().trim().email().max(200),
  message: z.string().trim().max(1000).optional(),
});
const acceptSchema = z.object({ companyId: zId });
const revokeSchema = z.object({ reason: z.string().trim().max(500).optional() });
const generateSchema = z.object({
  asOf: zDate.optional(),
  horizonDays: z.number().int().min(1).max(400).optional(),
  companyIds: z.array(zId).max(500).optional(),
});
const templatePatchSchema = z.object({
  isActive: z.boolean().optional(),
  dueDaysAfterPeriod: z.number().int().min(0).max(400).optional(),
  title: zShort(200).optional(),
  titleAr: z.string().trim().max(200).optional(),
});
const taskCreateSchema = z.object({
  companyId: zId,
  title: zShort(300),
  dueDate: zDate,
  assigneeUserId: zId.optional(),
});
const taskStatus = z.enum(["open", "in_progress", "review", "done", "cancelled"]);
const taskListQuery = z
  .strictObject({
    companyId: zId.optional(),
    from: zDate.optional(),
    to: zDate.optional(),
    status: taskStatus.optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ["to"],
    message: "End date must be on or after the start date",
  });
const timeListQuery = z.strictObject({ companyId: zId.optional() });
const taskPatchSchema = z.object({
  status: taskStatus.optional(),
  assigneeUserId: zId.nullable().optional(),
  dueDate: zDate.optional(),
});
const requestListSchema = z.object({
  listName: z.string().trim().max(120).optional(),
  items: z
    .array(
      z.object({
        title: zShort(300),
        description: z.string().trim().max(2000).optional(),
        dueDate: zDate.optional(),
      })
    )
    .min(1)
    .max(100),
});
const requestReviewSchema = z.object({
  decision: z.enum(["accept", "reject", "cancel"]),
  note: z.string().trim().max(1000).optional(),
});
const fulfilSchema = z.object({ documentId: zId });
const engagementTemplateSchema = z.object({
  name: zShort(200),
  kind: z.enum(["engagement", "proposal"]).default("engagement"),
  body: zShort(20000),
});
const letterSchema = z.object({
  templateId: zId.optional(),
  kind: z.enum(["engagement", "proposal"]).default("engagement"),
  title: zShort(200),
  body: z.string().trim().min(1).max(20000).optional(),
  feeAmount: z.number().nonnegative().max(1e9).optional(),
  billingCycle: z.enum(["monthly", "quarterly", "annually"]).optional(),
  services: z.string().trim().max(1000).optional(),
});
const letterResponseSchema = z.object({
  decision: z.enum(["accept", "decline"]),
  typedName: z.string().trim().max(200).optional(),
});
const timeSchema = z.object({
  companyId: zId,
  taskId: zId.optional(),
  entryDate: zDate,
  minutes: z.number().int().min(1).max(1440),
  description: z.string().trim().max(1000).optional(),
  billable: z.boolean().optional(),
  hourlyRate: z.number().nonnegative().max(100000).optional(),
});
const timerStartSchema = z.object({
  companyId: zId,
  taskId: zId.optional(),
  description: z.string().trim().max(1000).optional(),
  hourlyRate: z.number().nonnegative().max(100000).optional(),
});
const billWipSchema = z.object({ invoiceDate: zDate.optional() });
const recurringSchema = z.object({ asOf: zDate.optional() });
const filingRecordSchema = z.object({
  filingType: z.enum(FILING_TYPES),
  periodStart: zDate,
  periodEnd: zDate,
  filedOn: zDate,
  referenceNumber: zShort(100),
  checklist: z.record(z.string(), z.boolean()).optional(),
  notes: z.string().trim().max(2000).optional(),
});
const filingPackQuery = z.object({
  filingType: z.enum(FILING_TYPES),
  periodStart: zDate,
  periodEnd: zDate,
});

const dateOf = (v: string | undefined) => (v ? new Date(`${v}T12:00:00Z`) : undefined);

export function registerFirmPracticeRoutes(app: Express): void {
  const router = Router();
  // Multi-firm practice tools: every /firm path needs an approved firm role.
  router.use("/firm", authMiddleware, requireFirmAccess());

  // ─── Firm onboarding (any signed-in user) ─────────────────────────────────
  router.get(
    "/firms/me",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ membership: await getMyFirm(authUser(req)) });
    })
  );

  // X6b: accounting-firm features are NR-internal (the owner's firm runs them). There is no public
  // firm sign-up: this endpoint stays closed unless FIRM_SELF_SIGNUP=true is set for a deliberate,
  // supervised onboarding; platform admins then approve each application.
  router.post(
    "/firms/apply",
    authMiddleware,
    strictBody(applySchema),
    asyncHandler(async (req: Request, res: Response) => {
      if (process.env.FIRM_SELF_SIGNUP !== "true") {
        throw new DomainError(
          "FIRM_SIGNUP_CLOSED",
          403,
          undefined,
          "Firm accounts are created by the platform team. There is no public firm sign-up."
        );
      }
      const user = authUser(req);
      const firm = await applyForFirm(user, parsedBody<z.output<typeof applySchema>>(req));
      res.status(201).json({ firm, status: firm.status });
    })
  );

  router.get(
    "/admin/firms",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json({ firms: await listFirmsForAdmin(status) });
    })
  );

  router.post(
    "/admin/firms/:firmId/decision",
    authMiddleware,
    strictBody(decisionSchema),
    asyncHandler(async (req: Request, res: Response) => {
      requireAdmin(req);
      const body = parsedBody<z.output<typeof decisionSchema>>(req);
      const firm = await decideFirmApplication(
        authUser(req).id,
        param(req, "firmId"),
        body.decision,
        body.reason
      );
      res.json({ firm });
    })
  );

  // ─── Firm context and members ────────────────────────────────────────────
  router.get(
    "/firm/context",
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ membership: await getMyFirm(authUser(req)) });
    })
  );

  router.get(
    "/firm/members",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(await listFirmStaff(firmContextOf(res)));
    })
  );

  router.post(
    "/firm/members",
    requireFirmPermission("firm.staff.manage"),
    strictBody(memberSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const out = await addFirmMember(
        firmContextOf(res),
        parsedBody<z.output<typeof memberSchema>>(req)
      );
      res.status(201).json(out);
    })
  );

  router.patch(
    "/firm/members/:userId",
    requireFirmPermission("firm.staff.manage"),
    strictBody(memberRoleSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { role } = parsedBody<z.output<typeof memberRoleSchema>>(req);
      await updateFirmMember(firmContextOf(res), param(req, "userId"), role);
      res.json({ success: true, role });
    })
  );

  router.delete(
    "/firm/members/:userId",
    requireFirmPermission("firm.staff.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      await removeFirmMember(firmContextOf(res), param(req, "userId"));
      res.json({ success: true });
    })
  );

  // ─── Client links (firm side) ────────────────────────────────────────────
  router.get(
    "/firm/client-links",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ links: await listFirmLinks(firmContextOf(res)) });
    })
  );

  router.post(
    "/firm/client-links",
    requireFirmPermission("firm.clients.link"),
    strictBody(inviteSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const link = await inviteClient(
        firmContextOf(res),
        parsedBody<z.output<typeof inviteSchema>>(req)
      );
      // No e-mail is sent from here: the client owner sees the invitation in
      // their account (GET /api/firm-invitations). Share the path yourself.
      res.status(201).json({ link, delivery: "in_app_only", acceptPath: "/firm-invitations" });
    })
  );

  router.delete(
    "/firm/client-links/:linkId",
    requireFirmPermission("firm.clients.link"),
    asyncHandler(async (req: Request, res: Response) => {
      await withdrawFirmLink(firmContextOf(res), param(req, "linkId"));
      res.json({ success: true });
    })
  );

  // ─── Client owner side ───────────────────────────────────────────────────
  router.get(
    "/firm-invitations",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await listInvitationsForUser(authUser(req)));
    })
  );

  router.post(
    "/firm-invitations/:linkId/accept",
    authMiddleware,
    strictBody(acceptSchema, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const user = authUser(req);
      const { companyId } = parsedBody<z.output<typeof acceptSchema>>(req);
      const link = await acceptInvitation(user, param(req, "linkId"), companyId);
      await recordAudit({
        userId: user.id,
        companyId,
        action: "firm_link_accept",
        entityType: "firm_client_link",
        entityId: link.id,
        req,
        extra: { firmId: link.firmId },
      });
      res.json({ link });
    })
  );

  router.post(
    "/firm-invitations/:linkId/decline",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      await declineInvitation(authUser(req), param(req, "linkId"));
      res.json({ success: true });
    })
  );

  router.get(
    "/companies/:companyId/firm-links",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ links: await listCompanyLinks(authUser(req).id, param(req, "companyId")) });
    })
  );

  router.post(
    "/companies/:companyId/firm-links/:linkId/revoke",
    authMiddleware,
    strictBody(revokeSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const user = authUser(req);
      const companyId = param(req, "companyId");
      const linkId = param(req, "linkId");
      const { reason } = parsedBody<z.output<typeof revokeSchema>>(req);
      await revokeLinkByClient(user.id, companyId, linkId, reason ?? null);
      await recordAudit({
        userId: user.id,
        companyId,
        action: "firm_link_revoke",
        entityType: "firm_client_link",
        entityId: linkId,
        req,
      });
      res.json({ success: true, revokedAt: new Date().toISOString() });
    })
  );

  router.get(
    "/companies/:companyId/firm-requests",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({
        requests: await listRequestsForClient(authUser(req).id, param(req, "companyId")),
      });
    })
  );

  router.post(
    "/companies/:companyId/firm-requests/:requestId/fulfil",
    authMiddleware,
    strictBody(fulfilSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { documentId } = parsedBody<z.output<typeof fulfilSchema>>(req);
      const request = await fulfilRequest(
        authUser(req).id,
        param(req, "companyId"),
        param(req, "requestId"),
        documentId
      );
      res.json({ request });
    })
  );

  router.get(
    "/companies/:companyId/engagement-letters",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ letters: await listLettersForClient(authUser(req).id, param(req, "companyId")) });
    })
  );

  router.post(
    "/companies/:companyId/engagement-letters/:letterId/respond",
    authMiddleware,
    strictBody(letterResponseSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const user = authUser(req);
      const companyId = param(req, "companyId");
      const body = parsedBody<z.output<typeof letterResponseSchema>>(req);
      const letter = await respondToLetter(user, companyId, param(req, "letterId"), {
        decision: body.decision,
        typedName: body.typedName,
        ip: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      await recordAudit({
        userId: user.id,
        companyId,
        action:
          body.decision === "accept" ? "engagement_letter_accept" : "engagement_letter_decline",
        entityType: "firm_engagement_letter",
        entityId: letter.id,
        req,
      });
      res.json({ letter });
    })
  );

  // ─── Workflow: templates and tasks ───────────────────────────────────────
  router.get(
    "/firm/task-templates",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ templates: await ensureDefaultTemplates(firmContextOf(res).firmId) });
    })
  );

  router.patch(
    "/firm/task-templates/:templateId",
    requireFirmPermission("firm.workflow.manage"),
    strictBody(templatePatchSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      const [row] = await db
        .update(firmTaskTemplates)
        .set({ ...parsedBody<z.output<typeof templatePatchSchema>>(req), updatedAt: new Date() })
        .where(
          and(
            eq(firmTaskTemplates.id, param(req, "templateId")),
            eq(firmTaskTemplates.firmId, ctx.firmId)
          )
        )
        .returning();
      if (!row) throw new DomainError("TEMPLATE_NOT_FOUND", 404);
      res.json({ template: row });
    })
  );

  router.post(
    "/firm/tasks/generate",
    requireFirmPermission("firm.workflow.manage"),
    strictBody(generateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      const body = parsedBody<z.output<typeof generateSchema>>(req);
      const accessible = await listAccessibleClientIds(ctx);
      const companyIds = body.companyIds
        ? body.companyIds.filter((id) => accessible.includes(id))
        : accessible;
      if (companyIds.length === 0) return res.json({ created: 0, tasks: [] });
      const out = await generateRecurringTasks(ctx, {
        asOf: dateOf(body.asOf),
        horizonDays: body.horizonDays,
        companyIds,
        actorId: ctx.userId,
      });
      res.json(out);
    })
  );

  router.get(
    "/firm/tasks",
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      const { companyId, ...filters } = taskListQuery.parse(req.query);
      const accessible = await listAccessibleClientIds(ctx);
      const ids = companyId
        ? accessible.filter((id) => id === companyId.toLowerCase())
        : accessible;
      const rows = await listFirmTasks(ctx, ids, filters);
      res.json({
        tasks: rows.map((r: { task: Record<string, unknown>; companyName: string }) => ({
          ...r.task,
          companyName: r.companyName,
        })),
      });
    })
  );

  router.post(
    "/firm/tasks",
    requireFirmPermission("firm.clients.write"),
    strictBody(taskCreateSchema, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof taskCreateSchema>>(req);
      const ctx = await requireClient(res, body.companyId);
      const [row] = await db
        .insert(firmTasks)
        .values({
          firmId: ctx.firmId,
          companyId: body.companyId,
          title: body.title,
          dueDate: body.dueDate,
          assigneeUserId: body.assigneeUserId ?? null,
          source: "manual",
          createdBy: ctx.userId,
        })
        .returning();
      res.status(201).json({ task: row });
    })
  );

  router.patch(
    "/firm/tasks/:taskId",
    strictBody(taskPatchSchema, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      if (
        !ctx.platformAdmin &&
        !firmRoleHasPermission(ctx.role, "firm.clients.write") &&
        !firmRoleHasPermission(ctx.role, "firm.workpapers.review")
      ) {
        throw new DomainError("FIRM_PERMISSION_DENIED", 403);
      }
      const taskId = param(req, "taskId");
      const body = parsedBody<z.output<typeof taskPatchSchema>>(req);
      const [row] = await db
        .update(firmTasks)
        .set({
          ...(body.status ? { status: body.status } : {}),
          ...(body.status === "done" ? { completedAt: new Date() } : {}),
          ...(body.assigneeUserId !== undefined ? { assigneeUserId: body.assigneeUserId } : {}),
          ...(body.dueDate ? { dueDate: body.dueDate } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(firmTasks.id, taskId),
            eq(firmTasks.firmId, ctx.firmId),
            inArray(firmTasks.companyId, accessibleClientsQuery(ctx))
          )
        )
        .returning();
      if (!row) throw new DomainError("TASK_NOT_FOUND", 404);
      res.json({ task: row });
    })
  );

  // ─── Request lists (firm side) ───────────────────────────────────────────
  router.get(
    "/firm/clients/:companyId/requests",
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = await requireClient(res, param(req, "companyId"));
      res.json({ requests: await listRequestsForFirm(ctx, param(req, "companyId")) });
    })
  );

  router.post(
    "/firm/clients/:companyId/requests",
    requireFirmPermission("firm.clients.write"),
    strictBody(requestListSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = param(req, "companyId");
      const ctx = await requireClient(res, companyId);
      const rows = await createRequests(
        ctx,
        companyId,
        parsedBody<z.output<typeof requestListSchema>>(req)
      );
      res.status(201).json({ requests: rows });
    })
  );

  router.post(
    "/firm/requests/:requestId/review",
    requireFirmPermission("firm.clients.write"),
    strictBody(requestReviewSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      const request = await reviewRequest(
        ctx,
        param(req, "requestId"),
        parsedBody<z.output<typeof requestReviewSchema>>(req)
      );
      res.json({ request });
    })
  );

  // ─── Engagement letters / proposals (firm side) ──────────────────────────
  router.get(
    "/firm/engagement-templates",
    asyncHandler(async (_req: Request, res: Response) => {
      res.json({ templates: await listEngagementTemplates(firmContextOf(res)) });
    })
  );

  router.post(
    "/firm/engagement-templates",
    requireFirmPermission("firm.billing.manage"),
    strictBody(engagementTemplateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const row = await createEngagementTemplate(
        firmContextOf(res),
        parsedBody<z.output<typeof engagementTemplateSchema>>(req)
      );
      res.status(201).json({ template: row });
    })
  );

  router.get(
    "/firm/clients/:companyId/engagement-letters",
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = param(req, "companyId");
      const ctx = await requireClient(res, companyId);
      res.json({ letters: await listLettersForFirm(ctx, companyId) });
    })
  );

  router.post(
    "/firm/clients/:companyId/engagement-letters",
    requireFirmPermission("firm.billing.manage"),
    strictBody(letterSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = param(req, "companyId");
      const ctx = await requireClient(res, companyId);
      const letter = await createLetter(
        ctx,
        companyId,
        parsedBody<z.output<typeof letterSchema>>(req)
      );
      res.status(201).json({ letter });
    })
  );

  router.post(
    "/firm/engagement-letters/:letterId/send",
    requireFirmPermission("firm.billing.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await sendLetter(firmContextOf(res), param(req, "letterId")));
    })
  );

  router.post(
    "/firm/engagement-letters/:letterId/withdraw",
    requireFirmPermission("firm.billing.manage"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ letter: await withdrawLetter(firmContextOf(res), param(req, "letterId")) });
    })
  );

  // ─── Time tracking, WIP and billing ──────────────────────────────────────
  router.get(
    "/firm/time-entries",
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      const { companyId } = timeListQuery.parse(req.query);
      const accessible = await listAccessibleClientIds(ctx);
      const ids = companyId
        ? accessible.filter((id) => id === companyId.toLowerCase())
        : accessible;
      res.json({ entries: await listTimeEntries(ctx, ids) });
    })
  );

  router.post(
    "/firm/time-entries",
    requireFirmPermission("firm.time.track"),
    strictBody(timeSchema, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof timeSchema>>(req);
      const ctx = await requireClient(res, body.companyId);
      res.status(201).json({ entry: await logTime(ctx, body) });
    })
  );

  router.post(
    "/firm/time-entries/start",
    requireFirmPermission("firm.time.track"),
    strictBody(timerStartSchema, { allowServerOwned: ["companyId"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = parsedBody<z.output<typeof timerStartSchema>>(req);
      const ctx = await requireClient(res, body.companyId);
      res.status(201).json({ entry: await startTimer(ctx, body) });
    })
  );

  router.post(
    "/firm/time-entries/:entryId/stop",
    requireFirmPermission("firm.time.track"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ entry: await stopTimer(firmContextOf(res), param(req, "entryId")) });
    })
  );

  router.get(
    "/firm/wip",
    asyncHandler(async (_req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      res.json({ clients: await wipReport(ctx, await listAccessibleClientIds(ctx)) });
    })
  );

  router.post(
    "/firm/clients/:companyId/bill-wip",
    requireFirmPermission("firm.billing.manage"),
    strictBody(billWipSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = param(req, "companyId");
      const ctx = await requireClient(res, companyId);
      const { invoiceDate } = parsedBody<z.output<typeof billWipSchema>>(req);
      res.status(201).json(await billWip(ctx, companyId, dateOf(invoiceDate)));
    })
  );

  router.post(
    "/firm/billing/run-recurring",
    requireFirmPermission("firm.billing.manage"),
    strictBody(recurringSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      const { asOf } = parsedBody<z.output<typeof recurringSchema>>(req);
      res.json(await runRecurringBilling(ctx, await listAccessibleClientIds(ctx), dateOf(asOf)));
    })
  );

  router.get(
    "/firm/service-invoices",
    asyncHandler(async (_req: Request, res: Response) => {
      const ctx = firmContextOf(res);
      res.json({ invoices: await listServiceInvoices(ctx, await listAccessibleClientIds(ctx)) });
    })
  );

  // ─── FTA filing packs (manual filing; no EmaraTax API) ───────────────────
  router.get(
    "/firm/clients/:companyId/filing-pack",
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = param(req, "companyId");
      const ctx = await requireClient(res, companyId);
      const parsed = filingPackQuery.safeParse(req.query);
      if (!parsed.success) throw new DomainError("VALIDATION_ERROR", 400, parsed.error.flatten());
      res.json(await buildFilingPack(ctx, companyId, parsed.data));
    })
  );

  router.get(
    "/firm/clients/:companyId/filings",
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = param(req, "companyId");
      const ctx = await requireClient(res, companyId);
      res.json({ filings: await listFilings(ctx, companyId) });
    })
  );

  router.post(
    "/firm/clients/:companyId/filings",
    requireFirmPermission("firm.filing.record"),
    strictBody(filingRecordSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = param(req, "companyId");
      const ctx = await requireClient(res, companyId);
      const record = await recordFiling(
        ctx,
        companyId,
        parsedBody<z.output<typeof filingRecordSchema>>(req)
      );
      await recordAudit({
        userId: ctx.userId,
        companyId,
        action: "firm_filing_recorded",
        entityType: "firm_filing_record",
        entityId: record.id,
        req,
        extra: { filingType: record.filingType, referenceNumber: record.referenceNumber },
      });
      res.status(201).json({ filing: record, submittedToFta: false });
    })
  );

  app.use("/api", router);
}
