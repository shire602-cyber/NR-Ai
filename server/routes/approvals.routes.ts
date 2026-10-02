/**
 * Approvals: rules, the queue, per-document history, rejection, and submitting a journal for approval.
 * The approve actions themselves stay on each document's own route (bill, claim, purchase order, payroll
 * run, journal post); they call approval-gate.service.ts. Rules and the queue are a Professional feature.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { validate } from "../middleware/validate";
import { storage } from "../storage";
import { db } from "../db";
import { AppError } from "../errors";
import { approvalRules, approvalRequests, APPROVAL_DOCUMENT_TYPES } from "../../shared/schema-purchasing-hr";
import { approvalHistory, isApprovalDocumentType, listApprovalQueue, loadActiveRules, loadApprovalDocument, ruleForDocument } from "../services/approval-queue.service";
import { notifyApprovalProgress, rejectDocumentApproval, resolveActor, resubmitDocumentApproval } from "../services/approval-gate.service";
import { ruleInputProblem, unstaffedRoles } from "../services/approval-rules";
import { LOCK_NS, withDocumentLock } from "../services/document-lock";
import { recordAudit } from "../services/audit.service";

const ROLE = z.enum(["accountant", "cfo", "owner"]);

const ruleCreateSchema = z.object({
  documentType: z.enum(APPROVAL_DOCUMENT_TYPES),
  name: z.string().trim().min(1).max(120),
  thresholdAed: z.coerce.number().min(0).max(1_000_000_000),
  approverRoles: z.array(ROLE).min(1).max(2),
  isActive: z.boolean().optional(),
});
const ruleUpdateSchema = ruleCreateSchema.partial().omit({ documentType: true });

const rejectSchema = z.object({ comment: z.string().trim().max(1000).optional().nullable() });

const queueQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled", "all"]).optional(),
  documentType: z.enum(APPROVAL_DOCUMENT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function registerApprovalRoutes(app: Express) {
  const gate = requireFeature("approvals");

  /** Rules are the owner's: only a company owner may create, change or switch one off. */
  async function assertOwner(userId: string, companyId: string) {
    const membership = await storage.getUserRole(companyId, userId);
    if (membership?.role !== "owner") {
      throw new AppError({ message: "Only the company owner can manage approval rules.", statusCode: 403, code: "ROLE_REQUIRED" });
    }
  }

  /** A rule may only ask for roles the company has someone active to hold (422 ROLE_NOT_STAFFED, naming them). */
  async function assertRolesStaffed(companyId: string, roles: string[]) {
    const members = await storage.getCompanyUsersByCompanyId(companyId);
    const active: string[] = [];
    for (const m of members) {
      const user = await storage.getUser(m.userId);
      if (user && user.isActive !== false) active.push(m.role);
    }
    const missing = unstaffedRoles(roles, active);
    if (missing.length > 0) {
      const err = new AppError({
        message: `Nobody in this company can hold the ${missing.join(" and ")} role of this rule. Add a team member first.`,
        statusCode: 422,
        code: "ROLE_NOT_STAFFED",
        details: { roles: missing },
      });
      err.toJSON = () => ({ message: err.message, code: "ROLE_NOT_STAFFED", roles: missing, details: { roles: missing } });
      throw err;
    }
  }

  app.get(
    "/api/companies/:companyId/approval-rules",
    authMiddleware,
    requireCustomer,
    gate,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) return res.status(403).json({ message: "Access denied" });
      const rows = await db
        .select()
        .from(approvalRules)
        .where(eq(approvalRules.companyId, companyId))
        .orderBy(desc(approvalRules.createdAt));
      res.json(rows);
    })
  );

  app.post(
    "/api/companies/:companyId/approval-rules",
    authMiddleware,
    requireCustomer,
    gate,
    validate({ body: ruleCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) return res.status(403).json({ message: "Access denied" });
      await assertOwner(userId, companyId);
      const problem = ruleInputProblem(req.body);
      if (problem) return res.status(400).json(problem);
      await assertRolesStaffed(companyId, req.body.approverRoles);
      const [rule] = await db
        .insert(approvalRules)
        .values({
          companyId,
          documentType: req.body.documentType,
          name: req.body.name,
          thresholdAed: req.body.thresholdAed,
          approverRoles: req.body.approverRoles,
          isActive: req.body.isActive ?? true,
          createdBy: userId,
        })
        .returning();
      await recordAudit({ userId, companyId, action: "approval_rule.create", entityType: "approval_rule", entityId: rule.id, after: rule, req });
      res.status(201).json(rule);
    })
  );

  app.patch(
    "/api/approval-rules/:id",
    authMiddleware,
    requireCustomer,
    gate,
    validate({ body: ruleUpdateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const [existing] = await db.select().from(approvalRules).where(eq(approvalRules.id, req.params.id)).limit(1);
      // A rule of another company is indistinguishable from a missing one.
      if (!existing || !(await storage.hasCompanyAccess(userId, existing.companyId))) return res.status(404).json({ message: "Approval rule not found" });
      await assertOwner(userId, existing.companyId);
      const body = req.body as z.infer<typeof ruleUpdateSchema>;
      if (body.approverRoles !== undefined) await assertRolesStaffed(existing.companyId, body.approverRoles);
      const [rule] = await db
        .update(approvalRules)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.thresholdAed !== undefined ? { thresholdAed: body.thresholdAed } : {}),
          ...(body.approverRoles !== undefined ? { approverRoles: body.approverRoles } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(approvalRules.id, existing.id), eq(approvalRules.companyId, existing.companyId)))
        .returning();
      await recordAudit({ userId, companyId: existing.companyId, action: "approval_rule.update", entityType: "approval_rule", entityId: existing.id, before: existing, after: rule, req });
      res.json(rule);
    })
  );

  // Delete = deactivate: a request already in flight keeps the snapshot of the rule it started under.
  app.delete(
    "/api/approval-rules/:id",
    authMiddleware,
    requireCustomer,
    gate,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const [existing] = await db.select().from(approvalRules).where(eq(approvalRules.id, req.params.id)).limit(1);
      if (!existing || !(await storage.hasCompanyAccess(userId, existing.companyId))) return res.status(404).json({ message: "Approval rule not found" });
      await assertOwner(userId, existing.companyId);
      const [rule] = await db
        .update(approvalRules)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(approvalRules.id, existing.id), eq(approvalRules.companyId, existing.companyId)))
        .returning();
      await recordAudit({ userId, companyId: existing.companyId, action: "approval_rule.deactivate", entityType: "approval_rule", entityId: existing.id, before: existing, after: rule, req });
      res.json(rule);
    })
  );

  app.get(
    "/api/companies/:companyId/approvals",
    authMiddleware,
    requireCustomer,
    gate,
    validate({ query: queueQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) return res.status(403).json({ message: "Access denied" });
      const q = req.query as unknown as z.infer<typeof queueQuerySchema>;
      const actor = await resolveActor(req.user!, companyId);
      res.json(
        await listApprovalQueue({
          companyId,
          actor,
          status: q.status ?? "pending",
          documentType: q.documentType,
          limit: q.limit ?? 100,
          offset: q.offset ?? 0,
        })
      );
    })
  );

  /** Resolve a document and prove the caller may see its company; a stranger's document is a plain 404. */
  async function visibleDocument(req: Request, res: Response) {
    const { documentType, documentId } = req.params;
    if (!isApprovalDocumentType(documentType)) {
      res.status(400).json({ message: "Unknown document type", code: "INVALID_DOCUMENT_TYPE" });
      return null;
    }
    const doc = await loadApprovalDocument(documentType, documentId);
    if (!doc || !(await storage.hasCompanyAccess(req.user!.id, doc.companyId))) {
      res.status(404).json({ message: "Document not found" });
      return null;
    }
    return doc;
  }

  app.get(
    "/api/approvals/:documentType/:documentId",
    authMiddleware,
    requireCustomer,
    gate,
    asyncHandler(async (req: Request, res: Response) => {
      const doc = await visibleDocument(req, res);
      if (!doc) return;
      res.json({ documentType: doc.documentType, documentId: doc.documentId, status: doc.status, requests: await approvalHistory(doc.companyId, doc.documentType, doc.documentId) });
    })
  );

  app.post(
    "/api/approvals/:documentType/:documentId/reject",
    authMiddleware,
    requireCustomer,
    gate,
    validate({ body: rejectSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const doc = await visibleDocument(req, res);
      if (!doc) return;
      const actor = await resolveActor(req.user!, doc.companyId);
      const request = await rejectDocumentApproval({
        req,
        documentType: doc.documentType,
        documentId: doc.documentId,
        actor,
        comment: req.body?.comment ?? null,
      });
      res.json({ requestId: request.id, status: request.status });
    })
  );

  // The preparer's explicit resubmission of a rejected document: a new request with new steps.
  app.post(
    "/api/approvals/:documentType/:documentId/resubmit",
    authMiddleware,
    requireCustomer,
    gate,
    asyncHandler(async (req: Request, res: Response) => {
      const doc = await visibleDocument(req, res);
      if (!doc) return;
      const actor = await resolveActor(req.user!, doc.companyId);
      const request = await resubmitDocumentApproval({ req, documentType: doc.documentType, documentId: doc.documentId, actor });
      res.status(201).json({ requestId: request.id, status: request.status, requiredSteps: request.requiredSteps, completedSteps: request.completedSteps });
    })
  );

  // A draft manual journal goes to the approvers: it gets a pending request, which also freezes it (no edit or delete).
  app.post(
    "/api/journal/:id/submit-for-approval",
    authMiddleware,
    requireCustomer,
    gate,
    asyncHandler(async (req: Request, res: Response) => {
      const entry = await storage.getJournalEntryById(req.params.id);
      if (!entry || !(await storage.hasCompanyAccess(req.user!.id, entry.companyId))) return res.status(404).json({ message: "Journal entry not found" });
      const actor = await resolveActor(req.user!, entry.companyId);
      const result = await withDocumentLock(entry.id, LOCK_NS.APPROVAL, async (tx) => {
        const doc = await loadApprovalDocument("manual_journal", entry.id);
        if (!doc) throw new AppError({ message: "Only manual journal entries can be submitted for approval.", statusCode: 409, code: "NOT_MANUAL_JOURNAL" });
        if (doc.status !== "draft") throw new AppError({ message: "Only a draft journal can be submitted for approval.", statusCode: 409, code: "NOT_DRAFT" });
        const [existing] = await tx
          .select()
          .from(approvalRequests)
          .where(and(eq(approvalRequests.documentType, "manual_journal"), eq(approvalRequests.documentId, entry.id), eq(approvalRequests.status, "pending")))
          .limit(1);
        if (existing) return { request: existing, doc, created: false };
        const rule = ruleForDocument(await loadActiveRules(doc.companyId, "manual_journal"), doc);
        if (!rule) throw new AppError({ message: "No approval rule covers this journal; post it directly.", statusCode: 409, code: "APPROVAL_NOT_REQUIRED" });
        const [created] = await tx
          .insert(approvalRequests)
          .values({
            companyId: doc.companyId,
            documentType: "manual_journal",
            documentId: entry.id,
            ruleId: rule.id,
            ruleName: rule.name,
            requiredRoles: rule.approverRoles,
            amountAed: doc.amountAed,
            requiredSteps: rule.approverRoles.length,
            completedSteps: 0,
            status: "pending",
            previousStatus: "draft",
            requestedBy: actor.userId,
          })
          .returning();
        return { request: created, doc, created: true };
      });
      if (result.created) {
        await recordAudit({ userId: actor.userId, companyId: entry.companyId, action: "approval.requested", entityType: "manual_journal", entityId: entry.id, after: { requestId: result.request.id, amountAed: result.request.amountAed }, req });
        void notifyApprovalProgress({ doc: result.doc, request: result.request, actor, outcome: "needs_next_step" });
      }
      res.status(result.created ? 201 : 200).json({ requestId: result.request.id, status: result.request.status, requiredSteps: result.request.requiredSteps, completedSteps: result.request.completedSteps });
    })
  );
}
