/**
 * Employee loans and advances: preview the schedule, make a loan, cancel it (before any deduction) or repay it in
 * cash. Instalments are deducted by payroll runs (payroll.routes.ts). A Professional feature with payroll.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { validate } from "../middleware/validate";
import { storage } from "../storage";
import { recordAudit } from "../services/audit.service";
import { cancelLoan, createLoan, getLoan, listLoans, previewLoan, repayLoan } from "../services/employee-loan.service";
import { hrCompanyAccess } from "./hr-access";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, "Not a real date");
const uuid = z.string().uuid();
const previewSchema = z.object({
  employeeId: uuid,
  principal: z.coerce.number().positive().max(10_000_000),
  instalmentCount: z.coerce.number().int().min(1).max(120),
  firstPeriodYear: z.coerce.number().int().min(2000).max(2100),
  firstPeriodMonth: z.coerce.number().int().min(1).max(12),
});
const createSchema = previewSchema.extend({
  kind: z.enum(["loan", "advance"]).optional(),
  disbursementDate: ymd,
  paymentAccountId: uuid,
  notes: z.string().max(500).nullable().optional(),
});
const repaySchema = z.object({ paymentAccountId: uuid, date: ymd.optional() });
const paging = { limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() };

export function registerEmployeeLoanRoutes(app: Express) {
  const base = [authMiddleware, requireCustomer, requireFeature("payroll")] as const;

  app.post("/api/companies/:companyId/employee-loans/preview", ...base, validate({ body: previewSchema }), asyncHandler(async (req: Request, res: Response) => {
    if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: false }))) return;
    res.json(await previewLoan(req.params.companyId, req.body));
  }));

  app.get(
    "/api/companies/:companyId/employee-loans",
    ...base,
    validate({ query: z.object({ status: z.enum(["active", "settled", "cancelled", "all"]).optional(), employeeId: uuid.optional(), ...paging }) }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: false }))) return;
      const q = req.query as any;
      res.json(await listLoans(req.params.companyId, { status: q.status, employeeId: q.employeeId, limit: q.limit ?? 100, offset: q.offset ?? 0 }));
    })
  );

  app.post("/api/companies/:companyId/employee-loans", ...base, validate({ body: createSchema }), asyncHandler(async (req: Request, res: Response) => {
    if (!(await hrCompanyAccess(req, res, req.params.companyId, { write: true }))) return;
    const loan = await createLoan(req.params.companyId, req.user!.id, req.body);
    await recordAudit({ userId: req.user!.id, companyId: req.params.companyId, action: "employee_loan.create", entityType: "employee_loan", entityId: loan!.id, after: { loanNumber: loan!.loanNumber, principal: loan!.principal }, req });
    res.status(201).json(loan);
  }));

  /** A loan of a company the caller can use; a stranger's loan is a plain 404. */
  async function loanFor(req: Request, res: Response, write: boolean) {
    const loan = await getLoan(req.params.id);
    if (!loan || !(await storage.hasCompanyAccess(req.user!.id, loan.companyId))) {
      res.status(404).json({ message: "Loan not found" });
      return null;
    }
    if (!(await hrCompanyAccess(req, res, loan.companyId, { write }))) return null;
    return loan;
  }

  app.get("/api/employee-loans/:id", ...base, asyncHandler(async (req: Request, res: Response) => {
    const loan = await loanFor(req, res, false);
    if (loan) res.json(loan);
  }));

  app.post("/api/employee-loans/:id/cancel", ...base, asyncHandler(async (req: Request, res: Response) => {
    const loan = await loanFor(req, res, true);
    if (!loan) return;
    const updated = await cancelLoan(loan.id, req.user!.id);
    await recordAudit({ userId: req.user!.id, companyId: loan.companyId, action: "employee_loan.cancel", entityType: "employee_loan", entityId: loan.id, before: { status: loan.status }, after: { status: updated!.status }, req });
    res.json(updated);
  }));

  app.post("/api/employee-loans/:id/repay", ...base, validate({ body: repaySchema }), asyncHandler(async (req: Request, res: Response) => {
    const loan = await loanFor(req, res, true);
    if (!loan) return;
    const updated = await repayLoan(loan.id, req.user!.id, req.body);
    await recordAudit({ userId: req.user!.id, companyId: loan.companyId, action: "employee_loan.repay", entityType: "employee_loan", entityId: loan.id, after: { status: updated!.status }, req });
    res.json(updated);
  }));
}
