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
import { createSettlement, getSettlement, listSettlements, paySettlement, postSettlement, previewSettlement, voidSettlement } from "../services/final-settlement.service";
import { hrCompanyAccess } from "./hr-access";

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
    if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: false }))) return;
    res.json(await previewSettlement(req.params.companyId, req.body));
  }));

  app.get(
    "/api/companies/:companyId/final-settlements",
    ...base,
    validate({ query: z.object({ status: z.enum(["draft", "posted", "paid", "void", "all"]).optional(), ...paging }) }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: false }))) return;
      const q = req.query as any;
      res.json(await listSettlements(req.params.companyId, { status: q.status, limit: q.limit ?? 100, offset: q.offset ?? 0 }));
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
    if (!s || !(await storage.hasCompanyAccess(req.user!.id, s.companyId))) {
      res.status(404).json({ message: "Final settlement not found" });
      return null;
    }
    if (!(await hrCompanyAccess(req, res, s.companyId, { write }))) return null;
    return s;
  }

  app.get("/api/final-settlements/:id", ...base, asyncHandler(async (req: Request, res: Response) => {
    const s = await settlementFor(req, res, false);
    if (s) res.json(s);
  }));

  app.post("/api/final-settlements/:id/post", ...base, asyncHandler(async (req: Request, res: Response) => {
    const s = await settlementFor(req, res, true);
    if (!s) return;
    const updated = await postSettlement(s.id, req.user!.id);
    await recordAudit({ userId: req.user!.id, companyId: s.companyId, action: "final_settlement.post", entityType: "final_settlement", entityId: s.id, before: { status: s.status }, after: { status: updated!.status, netPayable: updated!.netPayable }, req });
    res.json(updated);
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
