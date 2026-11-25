/**
 * Payroll / WPS / HR routes (W3-D).
 * ─────────────────────────────────
 * Thin HTTP layer: bodies are validated with strictBody + shared/validators/
 * payroll.ts, tenancy is checked per row, and all logic lives in
 * server/services/payroll/ (calc, runs, leave, payslip, settlement, gpssa,
 * wps) and server/services/wps-sif.service.ts. Journal entries are posted only
 * through server/ledger.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { storage } from "../storage";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { listJobs, registerJob } from "../platform/job-registry";
import { zDate, zUuid } from "../../shared/validators/primitives";
import {
  employeeCreateSchema,
  employeePatchSchema,
  employeeTerminateSchema,
  leaveDecisionSchema,
  leaveRequestCreateSchema,
  leaveTypeCreateSchema,
  payrollApproveSchema,
  payrollItemPatchSchema,
  payrollPaySchema,
  payrollReverseSchema,
  payrollRunCreateSchema,
  payrollRunPatchSchema,
  payrollWpsStatusSchema,
  payslipEmailSchema,
  pensionPaymentSchema,
  type PensionPaymentBody,
  settlementCreateSchema,
  sifValidateSchema,
  wpsSettingsSchema,
  type EmployeeCreateBody,
  type EmployeePatchBody,
  type PayrollItemPatchBody,
  type PayrollPayBody,
  type PayrollRunCreateBody,
  type PayrollRunPatchBody,
  type SettlementCreateBody,
} from "../../shared/validators/payroll";
import { calculateGratuityForEmployee, isValidDate } from "../services/payroll/calc";
import { bookOpeningGratuity, openingGratuityStatus } from "../services/payroll/opening-gratuity";
import {
  assertPayrollAccess,
  actorOf,
  companyMemberCount,
  loadPayrollSettings,
} from "../services/payroll/context";
import {
  DEFAULT_LEGAL_PARAMS,
  isUaeOrGccNational,
  legalParamsSchema,
} from "../services/payroll/legal-params";
import {
  listPensionPayments,
  payPension,
  pensionLiability,
  reversePensionPayment,
} from "../services/payroll/pension-payments";
import {
  archiveEmployee,
  createEmployee,
  deleteEmployee,
  salaryHistory,
  terminateEmployee,
  updateEmployee,
} from "../services/payroll/employees";
import {
  approveRun,
  calculateRun,
  editItem,
  loadRun,
  payRun,
  unapproveRun,
  unpayRun,
} from "../services/payroll/runs";
import { leaveBalances, requestSpanDays, unpaidLeaveDaysBetween } from "../services/payroll/leave";
import {
  createPayslipToken,
  emailPayslips,
  listPayslips,
  loadPayslip,
  payslipFilename,
  payslipLink,
  renderPayslipPdf,
  resolvePayslipToken,
} from "../services/payroll/payslip";
import { paySettlement, postSettlement, previewSettlement } from "../services/payroll/settlement";
import {
  gpssaContributionCsv,
  scanExpiryAlerts,
  upcomingExpiries,
} from "../services/payroll/gpssa";
import {
  downloadRunSif,
  generateRunSif,
  setWpsStatus,
  sifPrevalidation,
  wpsEvents,
} from "../services/payroll/wps";
import { parseSif } from "../services/wps-sif.service";
import { dayOf, q, q1, type Row } from "../services/payroll/sql";
import { createLogger } from "../config/logger";

// Back-compat exports for the R09-01 regression tests.
export { calculateGratuityForEmployee, completedAnniversaries } from "../services/payroll/calc";

const log = createLogger("payroll");

// ─── Access helpers ─────────────────────────────────────────────────────────

/** Company named in the URL: non-members get 403 (as before). */
async function companyAccess(req: Request): Promise<{ companyId: string; userId: string }> {
  const { companyId } = req.params;
  const user = actorOf(req);
  if (!(await storage.hasCompanyAccess(user.id, companyId))) {
    throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
  }
  return { companyId, userId: user.id };
}

async function employeeRow(req: Request): Promise<Row & { id: string; company_id: string }> {
  const id = req.params.id;
  const parsed = zUuid.safeParse(id);
  if (!parsed.success)
    throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
  const emp = await q1<Row & { id: string; company_id: string }>(
    `SELECT * FROM employees WHERE id = $1`,
    [parsed.data]
  );
  if (!emp) throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
  await assertPayrollAccess(req, emp.company_id);
  return emp;
}

async function runRow(req: Request, perms?: Parameters<typeof assertPayrollAccess>[2]) {
  const parsed = zUuid.safeParse(req.params.id);
  if (!parsed.success)
    throw new DomainError("PAYROLL_RUN_NOT_FOUND", 404, undefined, "Payroll run not found");
  const run = await loadRun(parsed.data);
  if (!run) throw new DomainError("PAYROLL_RUN_NOT_FOUND", 404, undefined, "Payroll run not found");
  const user = await assertPayrollAccess(req, run.company_id, perms);
  return { run, user };
}

async function itemCompany(req: Request, perms?: Parameters<typeof assertPayrollAccess>[2]) {
  const parsed = zUuid.safeParse(req.params.id);
  if (!parsed.success)
    throw new DomainError("PAYROLL_ITEM_NOT_FOUND", 404, undefined, "Payroll item not found");
  const row = await q1<{ company_id: string }>(
    `SELECT pr.company_id FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id WHERE pi.id = $1`,
    [parsed.data]
  );
  if (!row)
    throw new DomainError("PAYROLL_ITEM_NOT_FOUND", 404, undefined, "Payroll item not found");
  const user = await assertPayrollAccess(req, row.company_id, perms);
  return { itemId: parsed.data, companyId: row.company_id, user };
}

const gratuityCalculatorBodySchema = z.object({
  employeeId: zUuid,
  // "" from an empty <input type="date"> means "today".
  terminationDate: z.preprocess((v) => (v === "" || v === null ? undefined : v), zDate.optional()),
});
type GratuityCalculatorBody = z.output<typeof gratuityCalculatorBodySchema>;

const payrollSettingsSchema = z
  .object({
    legalParams: z.unknown().optional(),
    allowSingleOwnerApproval: z.boolean().optional(),
    adviserConfirmed: z.boolean().optional(),
    adviserNote: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().max(2000).nullable().optional()
    ),
  })
  .strict();

function registerPayrollJobs(): void {
  if (!listJobs().some((j) => j.name === "payroll.expiryAlerts")) {
    registerJob({
      name: "payroll.expiryAlerts",
      cron: "41 4 * * *",
      description: "Emit visa / labour card / passport / Emirates ID expiry alerts",
      run: async () => {
        await scanExpiryAlerts(null, 30);
      },
    });
  }
}

export function registerPayrollRoutes(app: Express) {
  registerPayrollJobs();

  // =============================================
  // EMPLOYEES
  // =============================================

  app.get(
    "/api/companies/:companyId/employees",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      const includeArchived = req.query.includeArchived === "true";
      const employees = await q(
        `SELECT * FROM employees WHERE company_id = $1 ${includeArchived ? "" : "AND archived_at IS NULL"}
          ORDER BY created_at DESC`,
        [companyId]
      );
      res.json(employees);
    })
  );

  app.get(
    "/api/employees/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await employeeRow(req));
    })
  );

  app.post(
    "/api/companies/:companyId/employees",
    authMiddleware,
    requireCustomer,
    strictBody(employeeCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      const employee = await createEmployee(companyId, userId, req.body as EmployeeCreateBody);
      res.status(201).json(employee);
    })
  );

  app.patch(
    "/api/employees/:id",
    authMiddleware,
    requireCustomer,
    strictBody(employeePatchSchema, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const emp = await employeeRow(req);
      const updated = await updateEmployee(
        emp.company_id,
        emp.id,
        actorOf(req).id,
        req.body as EmployeePatchBody
      );
      log.info({ employeeId: emp.id }, "Employee updated");
      res.json(updated);
    })
  );

  // R09-05: never cascades payroll history away — 409 once any exists.
  app.delete(
    "/api/employees/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const emp = await employeeRow(req);
      await deleteEmployee(emp.company_id, emp.id);
      log.info({ employeeId: emp.id }, "Employee deleted");
      res.json({ message: "Employee deleted successfully" });
    })
  );

  app.post(
    "/api/employees/:id/terminate",
    authMiddleware,
    requireCustomer,
    strictBody(employeeTerminateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const emp = await employeeRow(req);
      const { terminationDate, reason } = req.body as z.output<typeof employeeTerminateSchema>;
      res.json(await terminateEmployee(emp.company_id, emp.id, terminationDate, reason));
    })
  );

  app.post(
    "/api/employees/:id/archive",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const emp = await employeeRow(req);
      res.json(await archiveEmployee(emp.company_id, emp.id));
    })
  );

  app.get(
    "/api/employees/:id/salary-history",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const emp = await employeeRow(req);
      res.json(await salaryHistory(emp.company_id, emp.id));
    })
  );

  app.get(
    "/api/employees/:id/leave-balances",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const emp = await employeeRow(req);
      const asOf = zDate.safeParse(req.query.asOf ?? new Date().toISOString().slice(0, 10));
      if (!asOf.success)
        throw new DomainError("INVALID_DATE", 400, undefined, "asOf must be YYYY-MM-DD");
      res.json(await leaveBalances(emp.company_id, emp.id, asOf.data));
    })
  );

  // =============================================
  // PAYROLL RUNS
  // =============================================

  app.get(
    "/api/companies/:companyId/payroll-runs",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(
        await q(
          "SELECT * FROM payroll_runs WHERE company_id = $1 ORDER BY period_year DESC, period_month DESC",
          [companyId]
        )
      );
    })
  );

  app.get(
    "/api/payroll-runs/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req);
      res.json(run);
    })
  );

  // R09-08: period month 1..12 and year 1990..2100 (zPeriodMonth / zPeriodYear).
  app.post(
    "/api/companies/:companyId/payroll-runs",
    authMiddleware,
    requireCustomer,
    strictBody(payrollRunCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      const { periodMonth, periodYear, notes } = req.body as PayrollRunCreateBody;
      const existing = await q1(
        "SELECT id FROM payroll_runs WHERE company_id = $1 AND period_month = $2 AND period_year = $3",
        [companyId, periodMonth, periodYear]
      );
      if (existing) {
        throw new DomainError(
          "PAYROLL_RUN_EXISTS",
          409,
          undefined,
          "A payroll run already exists for this period"
        );
      }
      const run = await q1(
        `INSERT INTO payroll_runs (company_id, period_month, period_year, status, notes, created_by)
         VALUES ($1, $2, $3, 'draft', $4, $5) RETURNING *`,
        [companyId, periodMonth, periodYear, notes ?? null, userId]
      );
      log.info({ companyId, periodMonth, periodYear }, "Payroll run created");
      res.status(201).json(run);
    })
  );

  // R09-02: status is server-owned (strictBody answers 400); only notes and,
  // while draft, the period can change.
  app.patch(
    "/api/payroll-runs/:id",
    authMiddleware,
    requireCustomer,
    strictBody(payrollRunPatchSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req);
      const body = parsedBody<PayrollRunPatchBody>(req);
      if (!["draft", "calculated"].includes(run.status)) {
        throw new DomainError(
          "PAYROLL_RUN_LOCKED",
          409,
          { status: run.status },
          `A ${run.status} payroll run cannot be edited`
        );
      }
      if (
        (body.periodMonth !== undefined || body.periodYear !== undefined) &&
        run.status !== "draft"
      ) {
        throw new DomainError(
          "PAYROLL_RUN_LOCKED",
          409,
          undefined,
          "The period can only change while the run is a draft"
        );
      }
      const updated = await q1(
        `UPDATE payroll_runs SET period_month = COALESCE($2, period_month),
                period_year = COALESCE($3, period_year),
                notes = CASE WHEN $4::boolean THEN $5 ELSE notes END
          WHERE id = $1 AND status = $6 RETURNING *`,
        [
          run.id,
          body.periodMonth ?? null,
          body.periodYear ?? null,
          body.notes !== undefined,
          body.notes ?? null,
          run.status,
        ]
      );
      if (!updated)
        throw new DomainError("PAYROLL_RUN_CHANGED", 409, undefined, "The run changed; retry");
      res.json(updated);
    })
  );

  app.post(
    "/api/payroll-runs/:id/calculate",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { run, user } = await runRow(req, ["payroll.manage"]);
      res.json(await calculateRun(run.id, run.company_id, user.id, req));
    })
  );

  app.post(
    "/api/payroll-runs/:id/approve",
    authMiddleware,
    requireCustomer,
    strictBody(payrollApproveSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { run, user } = await runRow(req, ["payroll.approve"]);
      res.json(await approveRun(run.id, run.company_id, user.id, req));
    })
  );

  app.post(
    "/api/payroll-runs/:id/pay",
    authMiddleware,
    requireCustomer,
    strictBody(payrollPaySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { run, user } = await runRow(req, ["payroll.manage"]);
      res.json(await payRun(run.id, run.company_id, user.id, req.body as PayrollPayBody, req));
    })
  );

  app.post(
    "/api/payroll-runs/:id/unpay",
    authMiddleware,
    requireCustomer,
    strictBody(payrollReverseSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { run, user } = await runRow(req, ["payroll.approve"]);
      res.json(
        await unpayRun(
          run.id,
          run.company_id,
          user.id,
          (req.body as { reason: string }).reason,
          req
        )
      );
    })
  );

  app.post(
    "/api/payroll-runs/:id/unapprove",
    authMiddleware,
    requireCustomer,
    strictBody(payrollReverseSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { run, user } = await runRow(req, ["payroll.approve"]);
      res.json(
        await unapproveRun(
          run.id,
          run.company_id,
          user.id,
          (req.body as { reason: string }).reason,
          req
        )
      );
    })
  );

  // =============================================
  // PAYROLL ITEMS
  // =============================================

  app.get(
    "/api/payroll-runs/:id/items",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req);
      res.json(
        await q(
          `SELECT pi.*, e.full_name as employee_name, e.full_name_ar as employee_name_ar,
                  e.employee_number, e.department AS employee_department, e.designation
             FROM payroll_items pi JOIN employees e ON e.id = pi.employee_id
            WHERE pi.payroll_run_id = $1 ORDER BY e.full_name`,
          [run.id]
        )
      );
    })
  );

  // R09-11: overtime / deductions / leave days validated and bounded.
  app.patch(
    "/api/payroll-items/:id",
    authMiddleware,
    requireCustomer,
    strictBody(payrollItemPatchSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { itemId, companyId } = await itemCompany(req, ["payroll.manage"]);
      res.json(await editItem(itemId, companyId, req.body as PayrollItemPatchBody));
    })
  );

  // =============================================
  // WPS: SIF, pre-validation, status tracking
  // =============================================

  app.get(
    "/api/payroll-runs/:id/sif-prevalidation",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req);
      res.json(await sifPrevalidation(run.company_id, run.id));
    })
  );

  app.get(
    "/api/payroll-runs/:id/generate-sif",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req, ["payroll.manage"]);
      const file = await downloadRunSif(run.company_id, run.id);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
      res.send(file.content);
    })
  );

  app.post(
    "/api/payroll-runs/:id/generate-sif",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({}).strict()),
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req, ["payroll.manage"]);
      await generateRunSif(run.company_id, run.id);
      res.status(204).end();
    })
  );

  app.post(
    "/api/payroll-runs/:id/wps-status",
    authMiddleware,
    requireCustomer,
    strictBody(payrollWpsStatusSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { run, user } = await runRow(req, ["payroll.manage"]);
      const body = parsedBody<z.output<typeof payrollWpsStatusSchema>>(req);
      res.json(await setWpsStatus(run.company_id, run.id, user.id, body.wpsStatus, body.notes));
    })
  );

  app.get(
    "/api/payroll-runs/:id/wps-events",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req);
      res.json(await wpsEvents(run.company_id, run.id));
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/sif/validate",
    authMiddleware,
    requireCustomer,
    strictBody(sifValidateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      await companyAccess(req);
      res.json(parseSif((req.body as { content: string }).content));
    })
  );

  app.get(
    "/api/companies/:companyId/payroll/wps-settings",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(
        await q1(
          `SELECT mohre_establishment_id AS "mohreEstablishmentId",
                  wps_employer_routing_code AS "wpsEmployerRoutingCode",
                  wps_employer_iban AS "wpsEmployerIban",
                  wps_employer_bank_name AS "wpsEmployerBankName",
                  wps_agent_id AS "wpsAgentId"
             FROM companies WHERE id = $1`,
          [companyId]
        )
      );
    })
  );

  app.put(
    "/api/companies/:companyId/payroll/wps-settings",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company", "payroll.manage"),
    strictBody(wpsSettingsSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      const b = parsedBody<z.output<typeof wpsSettingsSchema>>(req);
      const cols: Array<[keyof typeof b, string]> = [
        ["mohreEstablishmentId", "mohre_establishment_id"],
        ["wpsEmployerRoutingCode", "wps_employer_routing_code"],
        ["wpsEmployerIban", "wps_employer_iban"],
        ["wpsEmployerBankName", "wps_employer_bank_name"],
        ["wpsAgentId", "wps_agent_id"],
      ];
      const sets: string[] = [];
      const params: unknown[] = [companyId];
      for (const [k, col] of cols) {
        if (b[k] === undefined) continue;
        params.push(b[k]);
        sets.push(`${col} = $${params.length}`);
      }
      if (sets.length) await q(`UPDATE companies SET ${sets.join(", ")} WHERE id = $1`, params);
      res.json({ ok: true });
    })
  );

  // =============================================
  // GPSSA, payslips
  // =============================================

  app.get(
    "/api/payroll-runs/:id/gpssa-export",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req);
      const file = await gpssaContributionCsv(
        run.company_id,
        run.id,
        req.query.fund === "adpf" ? "adpf" : "gpssa"
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
      res.send(file.content);
    })
  );

  app.get(
    "/api/payroll-runs/:id/payslips",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { run } = await runRow(req);
      res.json(await listPayslips(run.company_id, run.id));
    })
  );

  app.post(
    "/api/payroll-runs/:id/payslips/email",
    authMiddleware,
    requireCustomer,
    strictBody(payslipEmailSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { run, user } = await runRow(req, ["payroll.manage"]);
      if (!["approved", "paid"].includes(run.status)) {
        throw new DomainError(
          "PAYSLIP_NOT_READY",
          409,
          undefined,
          "Approve the run before sending payslips"
        );
      }
      const results = await emailPayslips(
        run.company_id,
        run.id,
        user.id,
        (req.body as { itemIds?: string[] }).itemIds
      );
      res.json({
        results,
        sent: results.filter((r) => r.sent).length,
        notSent: results.filter((r) => !r.sent).length,
      });
    })
  );

  app.get(
    "/api/payroll-items/:id/payslip.pdf",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { itemId, companyId } = await itemCompany(req);
      const payslip = await loadPayslip(itemId, companyId);
      const pdf = await renderPayslipPdf(payslip);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${payslipFilename(payslip)}"`);
      res.send(pdf);
    })
  );

  app.post(
    "/api/payroll-items/:id/payslip-link",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { itemId, companyId, user } = await itemCompany(req, ["payroll.manage"]);
      await loadPayslip(itemId, companyId); // 409 unless the run is approved
      const { token, expiresAt } = await createPayslipToken(companyId, itemId, user.id);
      res.status(201).json({ url: payslipLink(token), expiresAt });
    })
  );

  // Employee self-service (no login): the token itself is the credential.
  app.get(
    "/api/payslips/:token",
    asyncHandler(async (req: Request, res: Response) => {
      const { itemId, companyId } = await resolvePayslipToken(req.params.token);
      res.json(await loadPayslip(itemId, companyId));
    })
  );

  app.get(
    "/api/payslips/:token/pdf",
    asyncHandler(async (req: Request, res: Response) => {
      const { itemId, companyId } = await resolvePayslipToken(req.params.token);
      const pdf = await renderPayslipPdf(await loadPayslip(itemId, companyId));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="payslip.pdf"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(pdf);
    })
  );

  // =============================================
  // SETTINGS (legal parameters, approval policy)
  // =============================================

  // E2 (J3-r2): the opening gratuity provision in the GL, booked from the employee records.
  app.get(
    "/api/companies/:companyId/payroll/opening-gratuity",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(await openingGratuityStatus(companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/opening-gratuity/book",
    authMiddleware,
    requireCustomer,
    strictBody(z.object({}).strict()),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      await assertPayrollAccess(req, companyId, ["ledger.post"]);
      res.status(201).json(await bookOpeningGratuity(companyId, userId));
    })
  );

  app.get(
    "/api/companies/:companyId/payroll/settings",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      const s = await loadPayrollSettings(companyId);
      res.json({
        legalParams: s.params,
        defaults: DEFAULT_LEGAL_PARAMS,
        overrides: s.overrides,
        allowSingleOwnerApproval: s.allowSingleOwnerApproval,
        /** X4: the maker may approve their own run (single-member company with the setting on). */
        selfApprovalAllowed:
          s.allowSingleOwnerApproval && (await companyMemberCount(companyId)) <= 1,
        adviserConfirmed: s.adviserConfirmed,
        adviserConfirmedBy: s.adviserConfirmedBy,
        adviserConfirmedAt: s.adviserConfirmedAt,
        adviserNote: s.adviserNote,
        counselReview:
          "Statutory defaults are an engineering reading of UAE law pending counsel review (docs/payroll-legal-parameters.md).",
      });
    })
  );

  app.put(
    "/api/companies/:companyId/payroll/settings",
    authMiddleware,
    requireCustomer,
    requirePermission("settings.company"),
    strictBody(payrollSettingsSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      const b = parsedBody<z.output<typeof payrollSettingsSchema>>(req);
      const current = await loadPayrollSettings(companyId);
      let overrides = current.overrides;
      if (b.legalParams !== undefined) {
        // Validate the merged result strictly; reject unknown keys and bad values.
        const merged = legalParamsSchema.safeParse(
          deepMergeStrict(
            structuredClone(current.params) as unknown as Record<string, unknown>,
            b.legalParams
          )
        );
        if (!merged.success) {
          throw new DomainError(
            "INVALID_LEGAL_PARAMS",
            400,
            { issues: merged.error.issues },
            "Invalid payroll legal parameters"
          );
        }
        overrides = merged.data as unknown as Record<string, unknown>;
      }
      const confirmChanged =
        b.adviserConfirmed !== undefined && b.adviserConfirmed !== current.adviserConfirmed;
      await q(
        `INSERT INTO payroll_settings (company_id, legal_params, allow_single_owner_approval, adviser_confirmed,
                                       adviser_confirmed_by, adviser_confirmed_at, adviser_note, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (company_id) DO UPDATE SET
           legal_params = EXCLUDED.legal_params,
           allow_single_owner_approval = EXCLUDED.allow_single_owner_approval,
           adviser_confirmed = EXCLUDED.adviser_confirmed,
           adviser_confirmed_by = EXCLUDED.adviser_confirmed_by,
           adviser_confirmed_at = EXCLUDED.adviser_confirmed_at,
           adviser_note = EXCLUDED.adviser_note,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [
          companyId,
          JSON.stringify(overrides),
          b.allowSingleOwnerApproval ?? current.allowSingleOwnerApproval,
          b.adviserConfirmed ?? current.adviserConfirmed,
          confirmChanged ? (b.adviserConfirmed ? userId : null) : current.adviserConfirmedBy,
          confirmChanged ? (b.adviserConfirmed ? new Date() : null) : current.adviserConfirmedAt,
          b.adviserNote !== undefined ? b.adviserNote : current.adviserNote,
          userId,
        ]
      );
      const s = await loadPayrollSettings(companyId);
      res.json({
        legalParams: s.params,
        allowSingleOwnerApproval: s.allowSingleOwnerApproval,
        adviserConfirmed: s.adviserConfirmed,
        adviserConfirmedAt: s.adviserConfirmedAt,
        adviserNote: s.adviserNote,
      });
    })
  );

  // =============================================
  // LEAVE
  // =============================================

  app.get(
    "/api/companies/:companyId/payroll/leave-types",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(
        await q(`SELECT * FROM leave_types WHERE company_id = $1 ORDER BY code`, [companyId])
      );
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/leave-types",
    authMiddleware,
    requireCustomer,
    requirePermission("payroll.manage"),
    strictBody(leaveTypeCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      const b = parsedBody<z.output<typeof leaveTypeCreateSchema>>(req);
      const row = await q1(
        `INSERT INTO leave_types (company_id, code, name_en, name_ar, is_paid, annual_entitlement_days,
                                  accrual_method, carry_forward_max_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          companyId,
          b.code,
          b.nameEn,
          b.nameAr ?? null,
          b.isPaid,
          b.annualEntitlementDays,
          b.accrualMethod,
          b.carryForwardMaxDays,
        ]
      );
      res.status(201).json(row);
    })
  );

  app.get(
    "/api/companies/:companyId/payroll/leave-requests",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(
        await q(
          `SELECT r.*, e.full_name AS employee_name, t.code AS leave_code, t.name_en AS leave_name_en,
                  t.name_ar AS leave_name_ar, t.is_paid
             FROM leave_requests r
             JOIN employees e ON e.id = r.employee_id
             JOIN leave_types t ON t.id = r.leave_type_id
            WHERE r.company_id = $1 ORDER BY r.start_date DESC`,
          [companyId]
        )
      );
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/leave-requests",
    authMiddleware,
    requireCustomer,
    strictBody(leaveRequestCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      const b = parsedBody<z.output<typeof leaveRequestCreateSchema>>(req);
      const emp = await q1(`SELECT id FROM employees WHERE id = $1 AND company_id = $2`, [
        b.employeeId,
        companyId,
      ]);
      if (!emp) throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
      const type = await q1(
        `SELECT id FROM leave_types WHERE id = $1 AND company_id = $2 AND is_active = true`,
        [b.leaveTypeId, companyId]
      );
      if (!type)
        throw new DomainError("LEAVE_TYPE_NOT_FOUND", 404, undefined, "Leave type not found");
      const span = requestSpanDays(b.startDate, b.endDate);
      const days = b.days ?? span;
      if (days > span) {
        throw new DomainError(
          "LEAVE_DAYS_EXCEED_SPAN",
          400,
          { span },
          "Leave days exceed the requested dates"
        );
      }
      const overlap = await q1(
        `SELECT id FROM leave_requests WHERE employee_id = $1 AND status IN ('pending', 'approved')
            AND start_date <= $3::date AND end_date >= $2::date`,
        [b.employeeId, b.startDate, b.endDate]
      );
      if (overlap)
        throw new DomainError(
          "LEAVE_OVERLAP",
          409,
          undefined,
          "The employee already has leave in these dates"
        );
      const row = await q1(
        `INSERT INTO leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days,
                                     status, notes, requested_by)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, 'pending', $7, $8) RETURNING *`,
        [
          companyId,
          b.employeeId,
          b.leaveTypeId,
          b.startDate,
          b.endDate,
          days,
          b.notes ?? null,
          userId,
        ]
      );
      res.status(201).json(row);
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/leave-requests/:requestId/decision",
    authMiddleware,
    requireCustomer,
    requirePermission("payroll.manage", "payroll.approve"),
    strictBody(leaveDecisionSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      const id = zUuid.safeParse(req.params.requestId);
      if (!id.success)
        throw new DomainError("LEAVE_REQUEST_NOT_FOUND", 404, undefined, "Leave request not found");
      const b = parsedBody<z.output<typeof leaveDecisionSchema>>(req);
      const to =
        b.decision === "approve" ? "approved" : b.decision === "reject" ? "rejected" : "cancelled";
      const from = b.decision === "cancel" ? ["pending", "approved"] : ["pending"];
      const row = await q1(
        `UPDATE leave_requests SET status = $3, decided_by = $4, decided_at = NOW(), decision_notes = $5
          WHERE id = $1 AND company_id = $2 AND status = ANY($6::text[]) RETURNING *`,
        [id.data, companyId, to, userId, b.notes ?? null, from]
      );
      if (!row) {
        const exists = await q1(
          `SELECT status FROM leave_requests WHERE id = $1 AND company_id = $2`,
          [id.data, companyId]
        );
        if (!exists)
          throw new DomainError(
            "LEAVE_REQUEST_NOT_FOUND",
            404,
            undefined,
            "Leave request not found"
          );
        throw new DomainError(
          "INVALID_TRANSITION",
          409,
          { from: exists.status, to },
          `A ${String(exists.status)} request cannot be ${to}`
        );
      }
      res.json(row);
    })
  );

  // =============================================
  // END-OF-SERVICE SETTLEMENT
  // =============================================

  app.get(
    "/api/companies/:companyId/payroll/settlements",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(
        await q(
          `SELECT s.*, e.full_name AS employee_name FROM payroll_settlements s
             JOIN employees e ON e.id = s.employee_id
            WHERE s.company_id = $1 ORDER BY s.created_at DESC`,
          [companyId]
        )
      );
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/settlements/preview",
    authMiddleware,
    requireCustomer,
    strictBody(settlementCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(await previewSettlement(companyId, req.body as SettlementCreateBody));
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/settlements",
    authMiddleware,
    requireCustomer,
    requirePermission("payroll.approve"),
    strictBody(settlementCreateSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      res
        .status(201)
        .json(await postSettlement(companyId, userId, req.body as SettlementCreateBody, req));
    })
  );

  // X4 (J3): pay a posted final settlement from a cash / bank account.
  app.post(
    "/api/companies/:companyId/payroll/settlements/:settlementId/pay",
    authMiddleware,
    requireCustomer,
    requirePermission("payroll.approve"),
    strictBody(payrollPaySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      if (!zUuid.safeParse(req.params.settlementId).success) {
        throw new DomainError("SETTLEMENT_NOT_FOUND", 404, undefined, "Settlement not found");
      }
      res.json(
        await paySettlement(
          companyId,
          req.params.settlementId,
          userId,
          req.body as PayrollPayBody,
          req
        )
      );
    })
  );

  // =============================================
  // PENSION CONTRIBUTION PAYMENTS (A4: M14 — GPSSA / ADPF / GCC schemes)
  // =============================================

  app.get(
    "/api/companies/:companyId/payroll/pension-liability",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(await pensionLiability(companyId));
    })
  );

  app.get(
    "/api/companies/:companyId/payroll/pension-payments",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json(await listPensionPayments(companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/pension-payments",
    authMiddleware,
    requireCustomer,
    requirePermission("payroll.approve"),
    strictBody(pensionPaymentSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      res
        .status(201)
        .json(await payPension(companyId, userId, parsedBody<PensionPaymentBody>(req), req));
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/pension-payments/:paymentId/reverse",
    authMiddleware,
    requireCustomer,
    requirePermission("payroll.approve"),
    strictBody(payrollReverseSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, userId } = await companyAccess(req);
      if (!zUuid.safeParse(req.params.paymentId).success) {
        throw new DomainError("PENSION_PAYMENT_NOT_FOUND", 404);
      }
      const { reason } = parsedBody<{ reason: string }>(req);
      res.json(await reversePensionPayment(companyId, req.params.paymentId, userId, reason, req));
    })
  );

  // =============================================
  // EXPIRY ALERTS
  // =============================================

  app.get(
    "/api/companies/:companyId/payroll/expiries",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      const days = Math.min(365, Math.max(1, Number(req.query.days) || 60));
      res.json(await upcomingExpiries(companyId, days));
    })
  );

  app.post(
    "/api/companies/:companyId/payroll/expiries/scan",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = await companyAccess(req);
      res.json({ emitted: await scanExpiryAlerts(companyId, 30) });
    })
  );

  // =============================================
  // GRATUITY CALCULATOR (advisory)
  // =============================================

  // R09-01: the body is validated before any date arithmetic.
  app.post(
    "/api/companies/:companyId/payroll/gratuity-calculator",
    authMiddleware,
    requireCustomer,
    strictBody(gratuityCalculatorBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = actorOf(req).id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });
      }
      const { employeeId, terminationDate } = req.body as GratuityCalculatorBody;
      const employee = await q1<Row>("SELECT * FROM employees WHERE id = $1 AND company_id = $2", [
        employeeId,
        companyId,
      ]);
      if (!employee)
        return res.status(404).json({ message: "Employee not found", code: "EMPLOYEE_NOT_FOUND" });
      if (!employee.join_date)
        return res
          .status(400)
          .json({ message: "Employee join date is not set", code: "JOIN_DATE_REQUIRED" });

      const joinDate = new Date(employee.join_date as string);
      const endDate = terminationDate ? new Date(terminationDate) : new Date();
      if (!isValidDate(joinDate)) {
        return res
          .status(400)
          .json({ message: "Employee join date is invalid", code: "INVALID_JOIN_DATE" });
      }
      if (endDate.getTime() < joinDate.getTime()) {
        return res.status(400).json({
          message: "Termination date cannot be before the join date",
          code: "TERMINATION_BEFORE_JOIN",
        });
      }
      const num = (v: unknown) => Number(v) || 0;
      const basicSalary = num(employee.basic_salary);
      const totalWage =
        basicSalary +
        num(employee.housing_allowance) +
        num(employee.transport_allowance) +
        num(employee.other_allowance);
      const isGcc = isUaeOrGccNational(employee.nationality as string | null);
      const settings = await loadPayrollSettings(companyId);
      const joinIso = dayOf(employee.join_date);
      const unpaidLeaveDays =
        joinIso && settings.params.gratuity.excludeUnpaidLeave
          ? await unpaidLeaveDaysBetween(
              companyId,
              employeeId,
              joinIso,
              endDate.toISOString().slice(0, 10)
            )
          : 0;
      const result = calculateGratuityForEmployee({
        joinDate,
        endDate,
        basicSalary,
        totalWage,
        isGccNational: isGcc,
        unpaidLeaveDays,
        params: settings.params,
      });
      const base = {
        employeeId: employee.id,
        employeeName: employee.full_name,
        nationality: employee.nationality ?? null,
        isGccNational: isGcc,
        joinDate: employee.join_date,
        terminationDate: endDate.toISOString(),
        yearsOfService: Math.round(result.yearsOfService * 100) / 100,
        completedYears: result.completedYears,
        trailingDays: result.trailingDays,
        unpaidLeaveDays,
        basicSalary: Math.round(basicSalary * 100) / 100,
        totalWage: Math.round(totalWage * 100) / 100,
        dailyWage: result.dailyWage,
        maxGratuity: result.maxGratuity,
        adviserConfirmed: settings.adviserConfirmed,
      };
      if (!result.eligible) {
        return res.json({
          ...base,
          firstFiveYearsGratuity: 0,
          remainingYearsGratuity: 0,
          totalGratuity: 0,
          uncappedGratuity: 0,
          isCapped: false,
          note:
            result.reason === "gcc_national"
              ? "UAE/GCC nationals receive GPSSA pension benefits in lieu of end-of-service gratuity."
              : "Employee must complete at least 1 year of service to be eligible for gratuity.",
        });
      }
      res.json({
        ...base,
        firstFiveYearsGratuity: result.firstFiveYearsGratuity,
        remainingYearsGratuity: result.remainingYearsGratuity,
        totalGratuity: result.totalGratuity,
        uncappedGratuity: result.uncappedGratuity,
        isCapped: result.isCapped,
      });
    })
  );
}

/** Merge a client override onto the current params; unknown keys are kept so zod rejects them. */
function deepMergeStrict(
  target: Record<string, unknown>,
  source: unknown
): Record<string, unknown> {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new DomainError("INVALID_LEGAL_PARAMS", 400, undefined, "legalParams must be an object");
  }
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const current = target[key];
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      target[key] = deepMergeStrict({ ...(current as Record<string, unknown>) }, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}
