/**
 * Final settlements: preview, draft, post (gratuity true-up, leave, loan recovery), pay and void.
 * A Professional feature with payroll. Business rules are in final-settlement.service.ts.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { validate } from "../middleware/validate";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";
import { createSettlement, getSettlement, listSettlements, paySettlement, postSettlement, previewSettlement, refreshDraftSettlement, voidSettlement } from "../services/final-settlement.service";
import { auditApprovalStep, beginApprovalStep, notifyApprovalProgress, pendingApprovalBody, recordApprovalStep, resolveActor } from "../services/approval-gate.service";
import { loadApprovalDocument } from "../services/approval-queue.service";
import { LOCK_NS, withDocumentLock } from "../services/document-lock";
import { allowEmployee, employeeFilterFor, hrCompanyAccess, hrReadScope } from "./hr-access";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, "Not a real date");
const uuid = z.string().uuid();
const requestSchema = z.object({
  employeeId: uuid,
  terminationDate: ymd,
  reason: z.enum(["resignation", "termination", "end_of_contract"]).optional(),
  provisionUsed: z.coerce.number().min(0).max(100_000_000).nullable().optional(),
  leaveDays: z.coerce.number().min(0).max(366).nullable().optional(),
  otherDeductions: z.coerce.number().min(0).max(100_000_000).optional(),
  notes: z.string().max(500).nullable().optional(),
});
const paySchema = z.object({ paymentAccountId: uuid, date: ymd.optional() });
const paging = { limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() };

export function registerFinalSettlementRoutes(app: Express) {
  const base = [authMiddleware, requireCustomer, requireFeature("payroll")] as const;

  app.post("/api/companies/:companyId/final-settlements/preview", ...base, validate({ body: requestSchema }), asyncHandler(async (req: Request, res: Response) => {
    const scope = await hrReadScope(req, res, req.params.companyId);
    if (!scope || !allowEmployee(res, scope, req.body.employeeId)) return;
    res.json(await previewSettlement(req.params.companyId, req.body));
  }));

  app.get(
    "/api/companies/:companyId/final-settlements",
    ...base,
    validate({ query: z.object({ status: z.enum(["draft", "posted", "paid", "void", "all"]).optional(), ...paging }) }),
    asyncHandler(async (req: Request, res: Response) => {
      const scope = await hrReadScope(req, res, req.params.companyId);
      if (!scope) return;
      const q = req.query as any;
      const filter = employeeFilterFor(res, scope, undefined);
      if (!filter) return;
      if (filter.empty) return res.json([]);
      res.json(await listSettlements(req.params.companyId, { status: q.status, employeeId: filter.employeeId, limit: q.limit ?? 100, offset: q.offset ?? 0 }));
    })
  );

  app.post("/api/companies/:companyId/final-settlements", ...base, validate({ body: requestSchema }), asyncHandler(async (req: Request, res: Response) => {
    if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: true }))) return;
    const created = await createSettlement(req.params.companyId, req.user!.id, req.body);
    await recordAudit({ userId: req.user!.id, companyId: req.params.companyId, action: "final_settlement.create", entityType: "final_settlement", entityId: created!.id, after: { netPayable: created!.netPayable }, req });
    res.status(201).json(created);
  }));

  async function settlementFor(req: Request, res: Response, write: boolean) {
    const s = await getSettlement(req.params.id);
    if (!s || !(await storage.hasCompanyAccess(req.user!.id, s.companyId, { employeeSelfService: true }))) {
      res.status(404).json({ message: "Final settlement not found" });
      return null;
    }
    if (!(await hrCompanyAccess(req, res, s.companyId, { write }))) return null;
    if (!write) {
      const scope = await hrReadScope(req, res, s.companyId);
      if (!scope || !allowEmployee(res, scope, s.employeeId)) return null;
    }
    return s;
  }

  app.get("/api/final-settlements/:id", ...base, asyncHandler(async (req: Request, res: Response) => {
    const s = await settlementFor(req, res, false);
    // A draft is current on every read (see refreshDraftSettlement).
    if (s) res.json(await refreshDraftSettlement(s));
  }));

  app.post("/api/final-settlements/:id/post", ...base, asyncHandler(async (req: Request, res: Response) => {
    const s = await settlementFor(req, res, true);
    if (!s) return;
    // Approval rules (amount and role): none = the single post this route always had. A rule needs a second person
    // for the posting; the preparer never approves their own settlement.
    const actor = await resolveActor(req.user!, s.companyId);
    const outcome = await withDocumentLock(s.id, LOCK_NS.APPROVAL, async (tx) => {
      const doc = await loadApprovalDocument("final_settlement", s.id);
      const step = doc
        ? await beginApprovalStep(tx, doc, actor, { previousStatus: s.status, acknowledgeSoleApprover: req.body?.acknowledgeSoleApprover === true })
        : ({ kind: "none" } as const);
      if (step.kind === "step" && !step.isFinal) {
        const request = await recordApprovalStep(tx, step, actor);
        await auditApprovalStep({ req, actor, doc: doc!, request, stepNumber: step.stepNumber, decision: "approved" });
        void notifyApprovalProgress({ doc: doc!, request, actor, outcome: "needs_next_step" });
        return { pending: pendingApprovalBody(step) } as const;
      }
      const updated = await postSettlement(s.id, req.user!.id);
      await recordAudit({ userId: req.user!.id, companyId: s.companyId, action: "final_settlement.post", entityType: "final_settlement", entityId: s.id, before: { status: s.status }, after: { status: updated!.status, netPayable: updated!.netPayable }, req });
      if (step.kind === "step") {
        const request = await recordApprovalStep(tx, step, actor);
        await auditApprovalStep({ req, actor, doc: doc!, request, stepNumber: step.stepNumber, decision: "approved" });
        void notifyApprovalProgress({ doc: doc!, request, actor, outcome: "approved" });
      }
      return { updated } as const;
    });
    if ("pending" in outcome) return res.json({ ...s, ...outcome.pending });
    res.json(outcome.updated);
  }));

  app.post("/api/final-settlements/:id/pay", ...base, validate({ body: paySchema }), asyncHandler(async (req: Request, res: Response) => {
    const s = await settlementFor(req, res, true);
    if (!s) return;
    const updated = await paySettlement(s.id, req.user!.id, req.body);
    await recordAudit({ userId: req.user!.id, companyId: s.companyId, action: "final_settlement.pay", entityType: "final_settlement", entityId: s.id, before: { status: s.status }, after: { status: updated!.status }, req });
    res.json(updated);
  }));

  app.post("/api/final-settlements/:id/void", ...base, asyncHandler(async (req: Request, res: Response) => {
    const s = await settlementFor(req, res, true);
    if (!s) return;
    const updated = await voidSettlement(s.id, req.user!.id);
    await recordAudit({ userId: req.user!.id, companyId: s.companyId, action: "final_settlement.void", entityType: "final_settlement", entityId: s.id, before: { status: s.status }, after: { status: updated!.status }, req });
    res.json(updated);
  }));
}
