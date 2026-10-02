/**
 * Leave: types, derived balances (with overrides) and requests. A Professional feature with payroll
 * (requireFeature("payroll")). Business rules are in leave.service.ts and leave-math.ts.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { validate } from "../middleware/validate";
import { recordAudit } from "../services/audit.service";
import {
  createLeaveRequest,
  createLeaveType,
  decideLeaveRequest,
  findLeaveType,
  getLeaveBalances,
  getLeaveRequest,
  listLeaveRequests,
  listLeaveTypes,
  setLeaveBalanceOverride,
  updateLeaveType,
} from "../services/leave.service";
import { toCalendarYmd } from "../utils/date";
import { employeeFilterFor, hrCompanyAccess, hrOwnRecordWrite, hrReadScope } from "./hr-access";
import { storage } from "../storage";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, "Not a real date");
const uuid = z.string().uuid();
const typeFields = {
  nameEn: z.string().trim().min(1).max(100),
  nameAr: z.string().trim().min(1).max(100),
  payPolicy: z.enum(["full", "sick_tiered", "half", "unpaid", "manual"]),
  annualDays: z.coerce.number().min(0).max(366),
  accrual: z.enum(["monthly_service", "annual", "none"]),
  carryForwardMaxDays: z.coerce.number().min(0).max(366),
  allowNegative: z.boolean(),
};
const typeCreateSchema = z.object({ code: z.string().trim().min(1).max(32).regex(/^[a-z0-9_]+$/i), ...typeFields }).partial({ annualDays: true, accrual: true, carryForwardMaxDays: true, allowNegative: true });
const typeUpdateSchema = z.object({ ...typeFields, isActive: z.boolean() }).partial();
const overrideSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  year: z.coerce.number().int().min(2000).max(2100),
  openingDays: z.coerce.number().min(-366).max(366).nullable().optional(),
  adjustmentDays: z.coerce.number().min(-366).max(366).optional(),
  note: z.string().max(500).nullable().optional(),
});
const requestSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  startDate: ymd,
  endDate: ymd,
  days: z.coerce.number().min(0.5).max(366).optional(),
  reason: z.string().max(500).nullable().optional(),
});
const paging = { limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() };

export function registerLeaveRoutes(app: Express) {
  const base = [authMiddleware, requireCustomer, requireFeature("payroll")] as const;

  app.get("/api/companies/:companyId/leave-types", ...base, asyncHandler(async (req: Request, res: Response) => {
    if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: false }))) return;
    res.json(await listLeaveTypes(req.params.companyId));
  }));

  app.post("/api/companies/:companyId/leave-types", ...base, validate({ body: typeCreateSchema }), asyncHandler(async (req: Request, res: Response) => {
    if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: true }))) return;
    const created = await createLeaveType(req.params.companyId, req.body);
    await recordAudit({ userId: req.user!.id, companyId: req.params.companyId, action: "leave_type.create", entityType: "leave_type", entityId: created.id, after: created, req });
    res.status(201).json(created);
  }));

  app.patch("/api/leave-types/:id", ...base, validate({ body: typeUpdateSchema }), asyncHandler(async (req: Request, res: Response) => {
    const type = await findLeaveType(req.params.id);
    if (!type || !(await storage.hasCompanyAccess(req.user!.id, type.companyId))) return res.status(404).json({ message: "Leave type not found" });
    if (!(await hrCompanyAccess(req, res, type.companyId, { write: true }))) return;
    const updated = await updateLeaveType(type.id, req.body);
    await recordAudit({ userId: req.user!.id, companyId: type.companyId, action: "leave_type.update", entityType: "leave_type", entityId: type.id, before: type, after: updated, req });
    res.json(updated);
  }));

  app.get(
    "/api/companies/:companyId/leave-balances",
    ...base,
    validate({ query: z.object({ asOf: ymd.optional(), employeeId: uuid.optional() }) }),
    asyncHandler(async (req: Request, res: Response) => {
      const scope = await hrReadScope(req, res, req.params.companyId);
      if (!scope) return;
      const q = req.query as any;
      const filter = employeeFilterFor(res, scope, q.employeeId);
      if (!filter) return;
      if (filter.empty) return res.json([]);
      res.json(await getLeaveBalances(req.params.companyId, { asOfYmd: q.asOf ?? toCalendarYmd(new Date()), employeeId: filter.employeeId }));
    })
  );

  app.put("/api/companies/:companyId/leave-balances", ...base, validate({ body: overrideSchema }), asyncHandler(async (req: Request, res: Response) => {
    if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: true }))) return;
    await setLeaveBalanceOverride(req.params.companyId, req.body);
    await recordAudit({ userId: req.user!.id, companyId: req.params.companyId, action: "leave_balance.override", entityType: "employee", entityId: req.body.employeeId, after: req.body, req });
    res.json({ message: "Leave balance saved" });
  }));

  app.get(
    "/api/companies/:companyId/leave-requests",
    ...base,
    validate({ query: z.object({ status: z.enum(["pending", "approved", "rejected", "cancelled", "all"]).optional(), employeeId: uuid.optional(), ...paging }) }),
    asyncHandler(async (req: Request, res: Response) => {
      const scope = await hrReadScope(req, res, req.params.companyId);
      if (!scope) return;
      const q = req.query as any;
      const filter = employeeFilterFor(res, scope, q.employeeId);
      if (!filter) return;
      if (filter.empty) return res.json([]);
      res.json(await listLeaveRequests(req.params.companyId, { status: q.status, employeeId: filter.employeeId, limit: q.limit ?? 100, offset: q.offset ?? 0 }));
    })
  );

  app.post("/api/companies/:companyId/leave-requests", ...base, validate({ body: requestSchema }), asyncHandler(async (req: Request, res: Response) => {
    if (!(await hrOwnRecordWrite(req, res, req.params.companyId, req.body.employeeId))) return;
    const created = await createLeaveRequest(req.params.companyId, req.user!.id, req.body);
    await recordAudit({ userId: req.user!.id, companyId: req.params.companyId, action: "leave.request", entityType: "leave_request", entityId: created.id, after: created, req });
    res.status(201).json(created);
  }));

  for (const decision of ["approve", "reject", "cancel"] as const) {
    app.post(`/api/leave-requests/:id/${decision}`, ...base, asyncHandler(async (req: Request, res: Response) => {
      const found = await getLeaveRequest(req.params.id);
      if (!found || !(await storage.hasCompanyAccess(req.user!.id, found.companyId, { employeeSelfService: true }))) return res.status(404).json({ message: "Leave request not found" });
      // An employee may cancel their own request; approving and rejecting stay with accountant and above.
      const allowed = decision === "cancel" ? await hrOwnRecordWrite(req, res, found.companyId, found.employeeId) : await hrCompanyAccess(req, res, found.companyId, { write: true });
      if (!allowed) return;
      const updated = await decideLeaveRequest(found.id, req.user!.id, decision);
      await recordAudit({ userId: req.user!.id, companyId: found.companyId, action: `leave.${decision}`, entityType: "leave_request", entityId: found.id, before: { status: found.status }, after: { status: updated.status }, req });
      res.json(updated);
    }));
  }
}
