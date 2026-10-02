/**
 * Payroll / WPS Compliance Routes
 * ────────────────────────────────
 * CRUD for employees, payroll runs, payroll items,
 * SIF file generation, and gratuity calculation.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { db } from "../db";
import { generateSIFFile } from "../services/wps-sif.service";
import { generatePayslipPDF } from "../services/pdf-payslip.service";
import { createLogger } from "../config/logger";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import { calculateGratuityForEmployee, completedYearsBetween, isUaeOrGccNational, round2 } from "../services/gratuity";
import { leaveDeductionsForMonth } from "../services/leave.service";
import { markRunInstalmentsDeducted, releaseRunInstalments, reserveInstalmentsForItem } from "../services/employee-loan.service";
import { ensureEmployeeLoansAccount } from "../services/hr-journal";
import { buildPayrollRegister, registerToCsv } from "../services/payroll-register.service";
import { LOCK_NS, withDocumentLock } from "../services/document-lock";
import { loadApprovalDocument } from "../services/approval-queue.service";
import {
  auditApprovalStep,
  beginApprovalStep,
  notifyApprovalProgress,
  pendingApprovalBody,
  recordApprovalStep,
  resolveActor,
} from "../services/approval-gate.service";
import {
  BASIC_SALARY_POSITIVE_MESSAGE,
  partitionPayrollEligible,
  validateBasicSalaryInput,
  parseBasicSalary,
  parseAllowanceFields,
} from "../services/payroll-eligibility.service";

const log = createLogger("payroll");

// ─── UAE / GCC pension constants (GPSSA & equivalents) ─────
// UAE Federal Decree-Law No. 57 of 2023 (and predecessor Law No. 7/1999):
// employees who are UAE/GCC nationals contribute 5% of pensionable wage and
// the employer 12.5%. The "Contribution Account Salary" defined by the law
// is *basic + housing only* — transport and other allowances are excluded
// from the pension base.
const PENSION_EMPLOYEE_RATE = 0.05;
const PENSION_EMPLOYER_RATE = 0.125;

// ─── Gratuity / 30-day-month convention ─────────────────────
// UAE Labour Law (Federal Decree-Law 33/2021, Art. 51) explicitly fixes the
// daily wage at basicSalary / 30 and uses 30-day months for proration. A
// 360-day "commercial year" follows from this.
const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;
const DAYS_PER_YEAR_30D = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 360

// Last day of the given (1-indexed) payroll period, in UTC. Day 0 of month
// `periodMonth` (0-indexed = periodMonth-1, then +1 month, day 0) lands on the
// last day of the period.
function periodEndDate(periodMonth: number, periodYear: number): Date {
  return new Date(Date.UTC(periodYear, periodMonth, 0));
}

// ─── Zod: employee create payload ──────────────────────────
// Trim + length-bound every text field; coerce numerics so HTML form posts
// (which send strings) round-trip cleanly. Only `fullName` is required —
// everything else is nullable on the underlying table.
const employeeCreateSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(64).optional(),
  fullName: z.string().trim().min(1, "fullName is required").max(255),
  fullNameAr: z.string().trim().max(255).optional(),
  nationality: z.string().trim().max(64).optional(),
  passportNumber: z.string().trim().max(64).optional(),
  visaNumber: z.string().trim().max(64).optional(),
  laborCardNumber: z.string().trim().max(64).optional(),
  bankName: z.string().trim().max(128).optional(),
  bankAccountNumber: z.string().trim().max(64).optional(),
  iban: z.string().trim().max(64).optional(),
  routingCode: z.string().trim().max(32).optional(),
  department: z.string().trim().max(128).optional(),
  designation: z.string().trim().max(128).optional(),
  joinDate: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.date().optional()
  ),
  basicSalary: z.coerce.number().positive(BASIC_SALARY_POSITIVE_MESSAGE),
  housingAllowance: z.coerce.number().nonnegative().default(0),
  transportAllowance: z.coerce.number().nonnegative().default(0),
  otherAllowance: z.coerce.number().nonnegative().default(0),
  status: z.enum(["active", "inactive", "terminated"]).optional(),
});

interface PayrollLineCalc {
  basic: number;
  housing: number;
  transport: number;
  other: number;
  overtime: number;
  pensionableWage: number; // basic + housing + transport
  pensionEmployee: number; // employee 5% deduction (UAE/GCC only)
  pensionEmployer: number; // employer 12.5% cost (UAE/GCC only)
  gratuityAccrual: number; // expat-only; 21 days/yr basic ÷ 12
  generalDeductions: number; // user-entered sundry deductions
  grossPay: number; // basic + allowances + overtime
  netSalary: number; // gross - employee pension - general deductions
}

/**
 * Compute a single employee's payroll line. Pure: takes raw numbers + the
 * employee's nationality, returns every monetary component. Used by both the
 * initial calculate-run and the per-item PATCH so they stay consistent.
 */
function calculatePayrollLine(input: {
  basic: number;
  housing: number;
  transport: number;
  other: number;
  overtime: number;
  generalDeductions: number;
  isGccNational: boolean;
  // Completed years of service at end of payroll period. Drives the
  // gratuity 21-day vs 30-day tier (Art. 51). Defaults to 0 — i.e. the
  // 21-day rate — when the caller can't determine tenure.
  tenureYears?: number;
}): PayrollLineCalc {
  const basic = input.basic || 0;
  const housing = input.housing || 0;
  const transport = input.transport || 0;
  const other = input.other || 0;
  const overtime = input.overtime || 0;
  const generalDeductions = input.generalDeductions || 0;
  const tenureYears = input.tenureYears ?? 0;

  const pensionableWage = basic + housing + transport;
  const pensionEmployee = input.isGccNational ? round2(pensionableWage * PENSION_EMPLOYEE_RATE) : 0;
  const pensionEmployer = input.isGccNational ? round2(pensionableWage * PENSION_EMPLOYER_RATE) : 0;

  // Expat end-of-service gratuity per UAE Federal Decree-Law 33/2021 Art. 51:
  //   daily wage = basic / 30 (30-day-month convention, NOT 365)
  //   first 5 years: 21 days/year of basic
  //   after 5 years: 30 days/year of basic
  // Monthly accrual = (annualDays × basic / 30) / 12 = annualDays × basic / 360.
  // Switches to 30/year as soon as the employee has 5 completed years at
  // period end, since service from the 6th year onward earns at the higher rate.
  const annualGratuityDays = tenureYears < 5 ? 21 : 30;
  const gratuityAccrual = input.isGccNational
    ? 0
    : round2((annualGratuityDays * basic) / DAYS_PER_YEAR_30D);

  const grossPay = round2(basic + housing + transport + other + overtime);
  const netSalary = round2(grossPay - pensionEmployee - generalDeductions);

  return {
    basic: round2(basic),
    housing: round2(housing),
    transport: round2(transport),
    other: round2(other),
    overtime: round2(overtime),
    pensionableWage: round2(pensionableWage),
    pensionEmployee,
    pensionEmployer,
    gratuityAccrual,
    generalDeductions: round2(generalDeductions),
    grossPay,
    netSalary,
  };
}

// ─── Inline table references for direct DB queries ─────────
// Since we are not modifying shared/schema.ts, we reference tables via raw SQL
// through the db query builder using sql template literals where needed,
// or use the db.execute pattern.

/**
 * Helper: execute a parameterized query and return rows.
 */
async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await (db as any).$client.query(text, params);
  return result.rows as T[];
}

/**
 * Helper: execute a parameterized query and return the first row.
 */
async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/** A calculation refused part-way: rolls the transaction back and answers 400 with this body. */
class CalcAbort extends Error {
  constructor(public readonly body: Record<string, unknown>) {
    super(String(body.message ?? "Payroll calculation refused"));
  }
}

export function registerPayrollRoutes(app: Express) {
  // =============================================
  // EMPLOYEES
  // =============================================

  // List all employees for a company
  app.get(
    "/api/companies/:companyId/employees",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const employees = await query(
        "SELECT * FROM employees WHERE company_id = $1 ORDER BY created_at DESC",
        [companyId]
      );
      res.json(employees);
    })
  );

  // Get single employee
  app.get(
    "/api/employees/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const employee = await queryOne("SELECT * FROM employees WHERE id = $1", [id]);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, employee.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(employee);
    })
  );

  // Create employee
  app.post(
    "/api/companies/:companyId/employees",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Money fields must be finite numbers / strict numeric strings; the
      // parsed numbers (never the raw text) are what zod and SQL see.
      const moneyBody: Record<string, unknown> = { ...req.body };
      if (req.body.basicSalary !== undefined) {
        const salaryError = validateBasicSalaryInput(req.body.basicSalary);
        if (salaryError) {
          return res.status(400).json({ message: salaryError, code: "INVALID_BASIC_SALARY" });
        }
        moneyBody.basicSalary = parseBasicSalary(req.body.basicSalary)!;
      }
      const allowances = parseAllowanceFields(req.body);
      if (!allowances.ok) {
        return res.status(400).json({
          message: allowances.message,
          code: "INVALID_ALLOWANCE",
          field: allowances.field,
        });
      }
      Object.assign(moneyBody, allowances.values);

      const parsed = employeeCreateSchema.safeParse(moneyBody);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Validation error",
          errors: parsed.error.errors,
        });
      }
      const data = parsed.data;

      const totalSalary =
        data.basicSalary + data.housingAllowance + data.transportAllowance + data.otherAllowance;

      const [employee] = await query(
        `INSERT INTO employees (
        company_id, employee_number, full_name, full_name_ar, nationality,
        passport_number, visa_number, labor_card_number,
        bank_name, bank_account_number, iban, routing_code,
        department, designation, join_date,
        basic_salary, housing_allowance, transport_allowance, other_allowance,
        total_salary, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      ) RETURNING *`,
        [
          companyId,
          data.employeeNumber ?? null,
          data.fullName,
          data.fullNameAr ?? null,
          data.nationality ?? null,
          data.passportNumber ?? null,
          data.visaNumber ?? null,
          data.laborCardNumber ?? null,
          data.bankName ?? null,
          data.bankAccountNumber ?? null,
          data.iban ?? null,
          data.routingCode ?? null,
          data.department ?? null,
          data.designation ?? null,
          data.joinDate ?? null,
          data.basicSalary,
          data.housingAllowance,
          data.transportAllowance,
          data.otherAllowance,
          totalSalary,
          data.status ?? "active",
        ]
      );

      log.info({ employeeId: employee.id, companyId }, "Employee created");
      res.status(201).json(employee);
    })
  );

  // Update employee
  app.patch(
    "/api/employees/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const employee = await queryOne("SELECT * FROM employees WHERE id = $1", [id]);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, employee.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Only a finite number / strict numeric string is accepted, and the
      // PARSED number (never the raw string) is what reaches SQL below.
      let basicSalary: number | undefined;
      if (req.body.basicSalary !== undefined) {
        const salaryError = validateBasicSalaryInput(req.body.basicSalary);
        if (salaryError) {
          return res.status(400).json({ message: salaryError, code: "INVALID_BASIC_SALARY" });
        }
        basicSalary = parseBasicSalary(req.body.basicSalary)!;
      }
      const allowances = parseAllowanceFields(req.body);
      if (!allowances.ok) {
        return res.status(400).json({
          message: allowances.message,
          code: "INVALID_ALLOWANCE",
          field: allowances.field,
        });
      }

      // Build dynamic SET clause from provided fields
      const allowedFields: Record<string, string> = {
        employeeNumber: "employee_number",
        fullName: "full_name",
        fullNameAr: "full_name_ar",
        nationality: "nationality",
        passportNumber: "passport_number",
        visaNumber: "visa_number",
        laborCardNumber: "labor_card_number",
        bankName: "bank_name",
        bankAccountNumber: "bank_account_number",
        iban: "iban",
        routingCode: "routing_code",
        department: "department",
        designation: "designation",
        joinDate: "join_date",
        basicSalary: "basic_salary",
        housingAllowance: "housing_allowance",
        transportAllowance: "transport_allowance",
        otherAllowance: "other_allowance",
        status: "status",
      };

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      for (const [jsKey, dbCol] of Object.entries(allowedFields)) {
        if (jsKey === "basicSalary") {
          if (basicSalary === undefined) continue;
          setClauses.push(`"${dbCol}" = $${paramIndex}`);
          values.push(basicSalary);
          paramIndex++;
        } else if (jsKey.endsWith("Allowance")) {
          // Only parsed, supplied allowances reach SQL; blank ones stay unchanged.
          const parsedValue = (allowances.values as Record<string, number>)[jsKey];
          if (parsedValue === undefined) continue;
          setClauses.push(`"${dbCol}" = $${paramIndex}`);
          values.push(parsedValue);
          paramIndex++;
        } else if (req.body[jsKey] !== undefined) {
          setClauses.push(`"${dbCol}" = $${paramIndex}`);
          values.push(req.body[jsKey]);
          paramIndex++;
        }
      }

      // Recalculate total salary if any salary field changed
      const basic =
        basicSalary !== undefined ? basicSalary : parseFloat(employee.basic_salary);
      const housing =
        allowances.values.housingAllowance ?? parseFloat(employee.housing_allowance);
      const transport =
        allowances.values.transportAllowance ?? parseFloat(employee.transport_allowance);
      const other =
        allowances.values.otherAllowance ?? parseFloat(employee.other_allowance);
      const totalSalary = basic + housing + transport + other;

      setClauses.push(`"total_salary" = $${paramIndex}`);
      values.push(totalSalary);
      paramIndex++;

      if (setClauses.length === 0) {
        return res.json(employee);
      }

      values.push(id);
      const updated = await queryOne(
        `UPDATE employees SET ${setClauses.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      log.info({ employeeId: id }, "Employee updated");
      res.json(updated);
    })
  );

  // Delete employee
  app.delete(
    "/api/employees/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const employee = await queryOne("SELECT * FROM employees WHERE id = $1", [id]);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, employee.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      await query("DELETE FROM employees WHERE id = $1", [id]);
      log.info({ employeeId: id }, "Employee deleted");
      res.json({ message: "Employee deleted successfully" });
    })
  );

  // =============================================
  // PAYROLL RUNS
  // =============================================

  // List payroll runs for a company
  app.get(
    "/api/companies/:companyId/payroll-runs",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const runs = await query(
        "SELECT * FROM payroll_runs WHERE company_id = $1 ORDER BY period_year DESC, period_month DESC",
        [companyId]
      );
      res.json(runs);
    })
  );

  // Get single payroll run
  app.get(
    "/api/payroll-runs/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const run = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(run);
    })
  );

  // Create payroll run
  app.post(
    "/api/companies/:companyId/payroll-runs",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { periodMonth, periodYear } = req.body;

      if (!periodMonth || !periodYear) {
        return res.status(400).json({ message: "periodMonth and periodYear are required" });
      }

      // Check for duplicate run in same period
      const existing = await queryOne(
        "SELECT id FROM payroll_runs WHERE company_id = $1 AND period_month = $2 AND period_year = $3",
        [companyId, periodMonth, periodYear]
      );
      if (existing) {
        return res.status(409).json({ message: "A payroll run already exists for this period" });
      }

      const [run] = await query(
        `INSERT INTO payroll_runs (company_id, period_month, period_year, status)
       VALUES ($1, $2, $3, 'draft') RETURNING *`,
        [companyId, periodMonth, periodYear]
      );

      log.info({ payrollRunId: run.id, companyId, periodMonth, periodYear }, "Payroll run created");
      res.json(run);
    })
  );

  // Update payroll run
  app.patch(
    "/api/payroll-runs/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const run = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (run.status === "pending_approval") {
        return res.status(409).json({
          message: "This payroll run is waiting for approval and cannot be edited. Reject it first.",
          code: "APPROVAL_IN_PROGRESS",
        });
      }
      if (run.status === "approved") {
        return res.status(400).json({ message: "Cannot modify an approved payroll run" });
      }

      // The status is never set from a request: it moves through calculate and approve (which post the ledger
      // and honour the approval rules), so a PATCH cannot approve a run around them.
      const allowedFields: Record<string, string> = {
        periodMonth: "period_month",
        periodYear: "period_year",
      };

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      for (const [jsKey, dbCol] of Object.entries(allowedFields)) {
        if (req.body[jsKey] !== undefined) {
          setClauses.push(`"${dbCol}" = $${paramIndex}`);
          values.push(req.body[jsKey]);
          paramIndex++;
        }
      }

      if (setClauses.length === 0) {
        return res.json(run);
      }

      values.push(id);
      const updated = await queryOne(
        `UPDATE payroll_runs SET ${setClauses.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      log.info({ payrollRunId: id }, "Payroll run updated");
      res.json(updated);
    })
  );

  // =============================================
  // PAYROLL CALCULATION & APPROVAL
  // =============================================

  // Calculate payroll — auto-populate payroll items from active employees
  app.post(
    "/api/payroll-runs/:id/calculate",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const run = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (run.status === "pending_approval") {
        return res.status(409).json({
          message: "This payroll run is waiting for approval and cannot be recalculated. Reject it first.",
          code: "APPROVAL_IN_PROGRESS",
        });
      }
      if (run.status === "approved") {
        return res.status(400).json({ message: "Cannot recalculate an approved payroll run" });
      }

      // The whole recalculation is one transaction: a failure part-way (a negative net, a lock) leaves the run,
      // its items and the loan reservations exactly as they were.
      const calcClient = await (db as any).$client.connect();
      const client = calcClient;
      const tq = async (text: string, params: any[] = []) => (await client.query(text, params)).rows as any[];
      const tqOne = async (text: string, params: any[] = []) => (await tq(text, params))[0];
      let preservedItems: any[] = [];
      let warnings: any = [];
      let employeeCount = 0;
      let updated: any;
      try {
        await client.query("BEGIN");
        // A recalculation gives back the loan instalments this run had reserved; they are reserved again below.
        await releaseRunInstalments(id, client);

        // Preserve manually-edited items: only recreate the un-edited ones so
        // accountants don't lose hand-entered overtime/deductions on every recalc.
        preservedItems = await tq(
          "SELECT * FROM payroll_items WHERE payroll_run_id = $1 AND manually_edited = true",
          [id]
        );
        const preservedEmployeeIds = new Set(preservedItems.map((it: any) => it.employee_id));

        await tq(
          "DELETE FROM payroll_items WHERE payroll_run_id = $1 AND manually_edited = false",
          [id]
        );

        // Get all active employees for this company
        const activeEmployees = await tq(
          "SELECT * FROM employees WHERE company_id = $1 AND status = 'active'",
          [run.company_id]
        );

        // Zero-salary employees are excluded (with a warning) rather than
        // failing the whole run.
        const partition = partitionPayrollEligible(activeEmployees);
        const employees = partition.eligible;
        warnings = partition.warnings;

        if (employees.length === 0 && preservedItems.length === 0) {
          throw new CalcAbort({
            message:
              activeEmployees.length === 0
                ? "No active employees found for this company"
                : "No active employees with a basic salary above zero found for this company",
            warnings,
          });
        }

        let totalBasic = 0;
        let totalAllowances = 0;
        let totalDeductions = 0;
        let totalNet = 0;
        let totalPensionEmployee = 0;
        let totalPensionEmployer = 0;
        let totalGratuityAccrual = 0;
        let totalLeaveDeductions = 0;
        let totalLoanDeductions = 0;

        // End of the payroll period — used to choose the gratuity tier (21 vs 30
        // days/year) per Art. 51 based on the employee's tenure at period close.
        const periodEnd = periodEndDate(run.period_month, run.period_year);

        // Approved leave of the month (unpaid, half-pay and sick-leave tiers) takes basic/30 or basic/60 a day.
        const leaveByEmployee = await leaveDeductionsForMonth(run.company_id, run.period_year, run.period_month, [
          ...employees.filter((e: any) => !preservedEmployeeIds.has(e.id)).map((e: any) => ({ id: e.id, basic: parseFloat(e.basic_salary) || 0 })),
          ...preservedItems.map((it: any) => ({ id: it.employee_id, basic: parseFloat(it.basic_salary) || 0 })),
        ]);

        // Re-include preserved (manually edited) items in the run totals. Leave and loan deductions and the net are
        // always recomputed, even for an edited item: the hand-entered overtime and deductions stay as typed.
        for (const item of preservedItems) {
          const gross =
            (parseFloat(item.basic_salary) || 0) +
            (parseFloat(item.housing_allowance) || 0) +
            (parseFloat(item.transport_allowance) || 0) +
            (parseFloat(item.other_allowance) || 0) +
            (parseFloat(item.overtime) || 0);
          const leave = leaveByEmployee.get(item.employee_id) ?? { unpaidDays: 0, halfDays: 0, deduction: 0 };
          const loan = await reserveInstalmentsForItem({
            client,
            companyId: run.company_id,
            runId: id,
            itemId: item.id,
            employeeId: item.employee_id,
            periodYear: run.period_year,
            periodMonth: run.period_month,
            grossPay: gross,
            generalDeductions: parseFloat(item.deductions) || 0,
          });
          const net = round2(gross - leave.deduction - loan - (parseFloat(item.pension_employee) || 0) - (parseFloat(item.deductions) || 0));
          if (net < 0) {
            throw new CalcAbort({
              message: `Net salary is negative for employee ${item.employee_id}. Leave, loan and other deductions exceed gross pay.`,
              employeeId: item.employee_id,
              grossPay: round2(gross),
            });
          }
          await tq(
            `UPDATE payroll_items SET leave_deduction = $2, loan_deduction = $3, unpaid_leave_days = $4, half_pay_leave_days = $5, net_salary = $6 WHERE id = $1`,
            [item.id, leave.deduction, loan, leave.unpaidDays, leave.halfDays, net]
          );
          totalBasic += parseFloat(item.basic_salary) || 0;
          totalAllowances +=
            (parseFloat(item.housing_allowance) || 0) +
            (parseFloat(item.transport_allowance) || 0) +
            (parseFloat(item.other_allowance) || 0) +
            (parseFloat(item.overtime) || 0);
          totalDeductions +=
            (parseFloat(item.deductions) || 0) + (parseFloat(item.pension_employee) || 0) + leave.deduction + loan;
          totalNet += net;
          totalPensionEmployee += parseFloat(item.pension_employee) || 0;
          totalPensionEmployer += parseFloat(item.pension_employer) || 0;
          totalGratuityAccrual += parseFloat(item.gratuity_accrual) || 0;
          totalLeaveDeductions += leave.deduction;
          totalLoanDeductions += loan;
        }

        // Calculate a fresh payroll item for each active employee that wasn't
        // preserved manually.
        for (const emp of employees) {
          if (preservedEmployeeIds.has(emp.id)) continue;

          const tenureYears = emp.join_date
            ? completedYearsBetween(new Date(emp.join_date), periodEnd)
            : 0;

          const calc = calculatePayrollLine({
            basic: parseFloat(emp.basic_salary) || 0,
            housing: parseFloat(emp.housing_allowance) || 0,
            transport: parseFloat(emp.transport_allowance) || 0,
            other: parseFloat(emp.other_allowance) || 0,
            overtime: 0,
            generalDeductions: 0,
            isGccNational: isUaeOrGccNational(emp.nationality),
            tenureYears,
          });

          const leave = leaveByEmployee.get(emp.id) ?? { unpaidDays: 0, halfDays: 0, deduction: 0 };
          if (round2(calc.netSalary - leave.deduction) < 0) {
            throw new CalcAbort({
              message: `Net salary is negative for employee ${emp.full_name} (${emp.employee_number ?? emp.id}). Deductions exceed gross pay.`,
              employeeId: emp.id,
              grossPay: calc.grossPay,
              deductions: calc.generalDeductions + calc.pensionEmployee + leave.deduction,
            });
          }

          const [insertedItem] = await tq(
            `INSERT INTO payroll_items (
            payroll_run_id, employee_id,
            basic_salary, housing_allowance, transport_allowance, other_allowance,
            overtime, deductions, pension_employee, pension_employer, gratuity_accrual,
            net_salary, payment_mode, status, manually_edited,
            leave_deduction, unpaid_leave_days, half_pay_leave_days
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'bank_transfer', 'pending', false, $13, $14, $15)
          RETURNING id`,
            [
              id,
              emp.id,
              calc.basic,
              calc.housing,
              calc.transport,
              calc.other,
              calc.overtime,
              calc.generalDeductions,
              calc.pensionEmployee,
              calc.pensionEmployer,
              calc.gratuityAccrual,
              round2(calc.netSalary - leave.deduction),
              leave.deduction,
              leave.unpaidDays,
              leave.halfDays,
            ]
          );

          // Loan instalments due by this period come off the pay, up to 50 % of gross with the other deductions.
          const loan = await reserveInstalmentsForItem({
            client,
            companyId: run.company_id,
            runId: id,
            itemId: insertedItem.id,
            employeeId: emp.id,
            periodYear: run.period_year,
            periodMonth: run.period_month,
            grossPay: calc.grossPay,
            generalDeductions: calc.generalDeductions,
          });
          const net = round2(calc.netSalary - leave.deduction - loan);
          if (loan > 0) await tq("UPDATE payroll_items SET loan_deduction = $2, net_salary = $3 WHERE id = $1", [insertedItem.id, loan, net]);

          totalBasic += calc.basic;
          totalAllowances += calc.housing + calc.transport + calc.other + calc.overtime;
          totalDeductions += calc.generalDeductions + calc.pensionEmployee + leave.deduction + loan;
          totalNet += net;
          totalLeaveDeductions += leave.deduction;
          totalLoanDeductions += loan;
          totalPensionEmployee += calc.pensionEmployee;
          totalPensionEmployer += calc.pensionEmployer;
          totalGratuityAccrual += calc.gratuityAccrual;
        }

        employeeCount =
          preservedItems.length +
          employees.filter((e: any) => !preservedEmployeeIds.has(e.id)).length;

        // Update the payroll run totals
        updated = await tqOne(
          `UPDATE payroll_runs SET
          total_basic = $1, total_allowances = $2, total_deductions = $3,
          total_net = $4, total_pension_employee = $5, total_pension_employer = $6,
          total_gratuity_accrual = $7,
          employee_count = $8, status = 'calculated',
          total_leave_deductions = $10, total_loan_deductions = $11
         WHERE id = $9 RETURNING *`,
          [
            round2(totalBasic),
            round2(totalAllowances),
            round2(totalDeductions),
            round2(totalNet),
            round2(totalPensionEmployee),
            round2(totalPensionEmployer),
            round2(totalGratuityAccrual),
            employeeCount,
            id,
            round2(totalLeaveDeductions),
            round2(totalLoanDeductions),
          ]
        );
        await client.query("COMMIT");
      } catch (calcError) {
        await client.query("ROLLBACK").catch(() => {});
        if (calcError instanceof CalcAbort) return res.status(400).json(calcError.body);
        throw calcError;
      } finally {
        calcClient.release();
      }

      log.info(
        {
          payrollRunId: id,
          employeeCount,
          preservedCount: preservedItems.length,
          excludedCount: warnings.length,
        },
        "Payroll calculated"
      );
      res.json({ ...updated, warnings });
    })
  );

  // Approve payroll run
  app.post(
    "/api/payroll-runs/:id/approve",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const run = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // The status check, the approval rules and the posting run under the run's approval lock with the run
      // re-read inside it: ten parallel approves post one journal entry, not ten.
      return await withDocumentLock(id, LOCK_NS.APPROVAL, async (tx) => {
      const run = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }

      if (run.status === "approved") {
        return res.status(400).json({ message: "Payroll run is already approved" });
      }

      if (run.status === "draft") {
        return res.status(400).json({ message: "Please calculate payroll before approving" });
      }

      // Approving a payroll run posts wage/salary journal entries for the
      // period — block if that period is locked. Use the last day of the
      // payroll period as the JE date.
      const periodEndDate = new Date(run.period_year, run.period_month, 0);
      await assertPeriodNotLocked(run.company_id, periodEndDate);

      // Aggregate the post-able amounts from the items themselves so the JE
      // matches what's actually saved (in case totals on the run drifted).
      const items = await query(
        `SELECT basic_salary, housing_allowance, transport_allowance, other_allowance,
              overtime, deductions, pension_employee, pension_employer,
              gratuity_accrual, net_salary, leave_deduction, loan_deduction
         FROM payroll_items WHERE payroll_run_id = $1`,
        [id]
      );

      if (items.length === 0) {
        return res.status(400).json({
          message: "Cannot approve a payroll run with no items. Calculate first.",
        });
      }

      // Approval rules (amount and role): none = the single-step approval this route always had.
      const approvalDoc = await loadApprovalDocument("payroll_run", id);
      const approvalActor = await resolveActor((req as any).user, run.company_id);
      const approvalStep = approvalDoc
        ? await beginApprovalStep(tx, approvalDoc, approvalActor, { previousStatus: run.status })
        : ({ kind: "none" } as const);
      if (approvalStep.kind === "step" && !approvalStep.isFinal) {
        const request = await recordApprovalStep(tx, approvalStep, approvalActor);
        const waiting = await queryOne("UPDATE payroll_runs SET status = 'pending_approval' WHERE id = $1 RETURNING *", [id]);
        await auditApprovalStep({ req, actor: approvalActor, doc: approvalDoc!, request, stepNumber: approvalStep.stepNumber, decision: "approved" });
        void notifyApprovalProgress({ doc: approvalDoc!, request, actor: approvalActor, outcome: "needs_next_step" });
        return res.json({ ...waiting, ...pendingApprovalBody(approvalStep) });
      }

      let grossComp = 0; // basic + allowances + overtime — debit to 5020
      let netPay = 0; // credit to 2030 Salaries Payable
      let pensionEmployee = 0; // employee withholding (already in net delta)
      let pensionEmployer = 0; // debit 5025 / additional credit to 2032
      let gratuityAccrual = 0; // debit 5028 / credit 2036
      let generalDeductions = 0; // credit 2034
      let leaveDeductions = 0; // unpaid / half-pay / sick-tier leave: not an expense (reduces the debit to 5020)
      let loanDeductions = 0; // credit 1080 Employee Loans: instalments recovered from pay

      for (const it of items) {
        const basic = parseFloat(it.basic_salary) || 0;
        const housing = parseFloat(it.housing_allowance) || 0;
        const transport = parseFloat(it.transport_allowance) || 0;
        const other = parseFloat(it.other_allowance) || 0;
        const overtime = parseFloat(it.overtime) || 0;
        grossComp += basic + housing + transport + other + overtime;
        netPay += parseFloat(it.net_salary) || 0;
        pensionEmployee += parseFloat(it.pension_employee) || 0;
        pensionEmployer += parseFloat(it.pension_employer) || 0;
        gratuityAccrual += parseFloat(it.gratuity_accrual) || 0;
        generalDeductions += parseFloat(it.deductions) || 0;
        leaveDeductions += parseFloat(it.leave_deduction) || 0;
        loanDeductions += parseFloat(it.loan_deduction) || 0;
      }

      grossComp = round2(grossComp);
      netPay = round2(netPay);
      pensionEmployee = round2(pensionEmployee);
      pensionEmployer = round2(pensionEmployer);
      gratuityAccrual = round2(gratuityAccrual);
      generalDeductions = round2(generalDeductions);
      leaveDeductions = round2(leaveDeductions);
      loanDeductions = round2(loanDeductions);
      // What the company actually pays out as salary cost: gross less the pay withheld for leave.
      const salaryCost = round2(grossComp - leaveDeductions);

      // Look up the accounts we need. Migration 0030 backfills these for every
      // existing company; new companies get them via defaultChartOfAccounts.
      const accounts = await storage.getAccountsByCompanyId(run.company_id);
      const acct = (code: string) => accounts.find((a) => a.code === code && !a.isArchived);

      const salariesExpense = acct("5020");
      const salariesPayable = acct("2030");
      const pensionExpense = acct("5025");
      const pensionPayable = acct("2032");
      const gratuityExpense = acct("5028");
      const gratuityProvision = acct("2036");
      const deductionsPayable = acct("2034");

      if (!salariesExpense || !salariesPayable) {
        return res.status(500).json({
          message:
            "Required payroll accounts (5020 Salaries & Wages, 2030 Salaries Payable) are missing from the chart of accounts. Run database migrations and try again.",
        });
      }
      if (pensionEmployer > 0 && (!pensionExpense || !pensionPayable)) {
        return res.status(500).json({
          message:
            "Pension accounts (5025 / 2032) are missing from the chart of accounts. Run database migrations and try again.",
        });
      }
      if (gratuityAccrual > 0 && (!gratuityExpense || !gratuityProvision)) {
        return res.status(500).json({
          message:
            "Gratuity accounts (5028 / 2036) are missing from the chart of accounts. Run database migrations and try again.",
        });
      }
      if (generalDeductions > 0 && !deductionsPayable) {
        return res.status(500).json({
          message:
            "Deductions Payable account (2034) is missing from the chart of accounts. Run database migrations and try again.",
        });
      }

      // Build the JE. Pattern:
      //   Dr Salaries & Wages Expense  (gross compensation)
      //   Dr Pension Expense (Employer share)
      //   Dr Gratuity Expense (period accrual)
      //     Cr Salaries Payable     (net pay to employees)
      //     Cr Pension Payable      (employee withholding + employer share)
      //     Cr Deductions Payable   (sundry deductions)
      //     Cr Gratuity Provision   (period accrual)
      const periodLabel = `${String(run.period_month).padStart(2, "0")}/${run.period_year}`;
      const jeLines: Array<{
        accountId: string;
        debit: number;
        credit: number;
        description: string;
      }> = [];

      if (salaryCost > 0) {
        jeLines.push({
          accountId: salariesExpense.id,
          debit: salaryCost,
          credit: 0,
          description: `Salaries & wages expense - payroll ${periodLabel}`,
        });
      }
      if (pensionEmployer > 0 && pensionExpense) {
        jeLines.push({
          accountId: pensionExpense.id,
          debit: pensionEmployer,
          credit: 0,
          description: `Employer pension contribution (GPSSA) - payroll ${periodLabel}`,
        });
      }
      if (gratuityAccrual > 0 && gratuityExpense) {
        jeLines.push({
          accountId: gratuityExpense.id,
          debit: gratuityAccrual,
          credit: 0,
          description: `End-of-service gratuity accrual - payroll ${periodLabel}`,
        });
      }
      if (netPay > 0) {
        jeLines.push({
          accountId: salariesPayable.id,
          debit: 0,
          credit: netPay,
          description: `Net salaries payable - payroll ${periodLabel}`,
        });
      }
      const totalPensionPayable = round2(pensionEmployee + pensionEmployer);
      if (totalPensionPayable > 0 && pensionPayable) {
        jeLines.push({
          accountId: pensionPayable.id,
          debit: 0,
          credit: totalPensionPayable,
          description: `Pension payable to GPSSA (employee + employer) - payroll ${periodLabel}`,
        });
      }
      if (generalDeductions > 0 && deductionsPayable) {
        jeLines.push({
          accountId: deductionsPayable.id,
          debit: 0,
          credit: generalDeductions,
          description: `Payroll deductions payable - payroll ${periodLabel}`,
        });
      }
      if (gratuityAccrual > 0 && gratuityProvision) {
        jeLines.push({
          accountId: gratuityProvision.id,
          debit: 0,
          credit: gratuityAccrual,
          description: `End-of-service gratuity provision - payroll ${periodLabel}`,
        });
      }
      if (loanDeductions > 0) {
        jeLines.push({
          accountId: await ensureEmployeeLoansAccount(run.company_id),
          debit: 0,
          credit: loanDeductions,
          description: `Employee loan instalments recovered - payroll ${periodLabel}`,
        });
      }

      // Idempotent: a run whose journal is already on the ledger (an approve that failed after posting) is not posted twice.
      const existingJe = (await storage.getJournalEntriesBySource(run.company_id, "system", id)).find((e) => e.status === "posted");
      const entryNumber = existingJe?.entryNumber ?? (await storage.generateEntryNumber(run.company_id, periodEndDate));
      const journalEntry = existingJe ?? await storage.createJournalEntry(
        {
          companyId: run.company_id,
          date: periodEndDate,
          memo: `Payroll ${periodLabel} - ${items.length} employee(s)`,
          entryNumber,
          status: "posted",
          source: "system",
          sourceId: id,
          createdBy: userId,
          postedBy: userId,
          postedAt: periodEndDate,
        },
        jeLines
      );

      const updated = await queryOne(
        `UPDATE payroll_runs SET status = 'approved', approved_by = $1, approved_at = NOW(),
            journal_entry_id = $2
       WHERE id = $3 RETURNING *`,
        [userId, journalEntry.id, id]
      );

      // Mark all payroll items as paid and back-link the JE for traceability.
      await query(
        "UPDATE payroll_items SET status = 'paid', journal_entry_id = $1 WHERE payroll_run_id = $2",
        [journalEntry.id, id]
      );
      // The loan instalments this run reserved are now deducted; a loan with nothing left owed is settled.
      await markRunInstalmentsDeducted(id);

      if (approvalStep.kind === "step") {
        const request = await recordApprovalStep(tx, approvalStep, approvalActor);
        await auditApprovalStep({ req, actor: approvalActor, doc: approvalDoc!, request, stepNumber: approvalStep.stepNumber, decision: "approved" });
        void notifyApprovalProgress({ doc: approvalDoc!, request, actor: approvalActor, outcome: "approved" });
      }

      await recordAudit({
        userId,
        companyId: run.company_id,
        action: "payroll.approve",
        entityType: "payroll_run",
        entityId: id,
        before: { status: run.status },
        after: {
          status: "approved",
          journalEntryId: journalEntry.id,
          entryNumber,
          grossComp,
          netPay,
          pensionEmployee,
          pensionEmployer,
          gratuityAccrual,
          generalDeductions,
          leaveDeductions,
          loanDeductions,
        },
        req,
      });

      log.info(
        {
          payrollRunId: id,
          approvedBy: userId,
          journalEntryId: journalEntry.id,
          entryNumber,
          grossComp,
          netPay,
        },
        "Payroll run approved and journal entry posted"
      );
      return res.json(updated);
      });
    })
  );

  // =============================================
  // SIF FILE GENERATION
  // =============================================

  // Generate WPS SIF file
  app.get(
    "/api/payroll-runs/:id/generate-sif",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const run = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // The bank file pays the employees: it is only produced for a run that was approved (and therefore posted).
      if (run.status !== "approved" && run.status !== "paid") {
        return res.status(409).json({
          message: "Approve the payroll run before generating the WPS file.",
          code: "PAYROLL_NOT_APPROVED",
        });
      }

      // Get company details
      const company = await queryOne("SELECT * FROM companies WHERE id = $1", [run.company_id]);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Get payroll items
      const items = await query("SELECT * FROM payroll_items WHERE payroll_run_id = $1", [id]);

      if (items.length === 0) {
        return res
          .status(400)
          .json({ message: "No payroll items found. Please calculate payroll first." });
      }

      // Get all employees referenced in payroll items
      const employeeIds = items.map((item: any) => item.employee_id);
      const employeePlaceholders = employeeIds.map((_: any, i: number) => `$${i + 1}`).join(",");
      const employeeRows = await query(
        `SELECT * FROM employees WHERE id IN (${employeePlaceholders})`,
        employeeIds
      );

      // Build employee lookup map
      const employeeMap = new Map<string, any>();
      for (const emp of employeeRows) {
        employeeMap.set(emp.id, {
          employeeNumber: emp.employee_number,
          fullName: emp.full_name,
          laborCardNumber: emp.labor_card_number,
          bankName: emp.bank_name,
          bankAccountNumber: emp.bank_account_number,
          iban: emp.iban,
          routingCode: emp.routing_code,
        });
      }

      // Map payroll items to SIF format. SIF requires gross − deductions = net,
      // so the SIF "deductions" column must include the employee pension share
      // along with sundry deductions; otherwise WPS validation fails.
      const sifItems = items.map((item: any) => ({
        employeeId: item.employee_id,
        basicSalary: item.basic_salary,
        housingAllowance: item.housing_allowance,
        transportAllowance: item.transport_allowance,
        otherAllowance: item.other_allowance,
        overtime: item.overtime,
        deductions: round2(
          (parseFloat(item.deductions) || 0) +
            (parseFloat(item.pension_employee) || 0) +
            (parseFloat(item.leave_deduction) || 0) +
            (parseFloat(item.loan_deduction) || 0)
        ),
        netSalary: item.net_salary,
        paymentMode: item.payment_mode,
      }));

      const sifContent = generateSIFFile(
        {
          name: company.name,
          registrationNumber: company.registration_number,
          bankName: null,
          bankAccountNumber: null,
          routingCode: null,
        },
        {
          id: run.id,
          periodMonth: run.period_month,
          periodYear: run.period_year,
          totalBasic: run.total_basic,
          totalAllowances: run.total_allowances,
          totalDeductions: run.total_deductions,
          totalNet: run.total_net,
          employeeCount: run.employee_count,
        },
        sifItems,
        employeeMap
      );

      // Store the SIF content on the payroll run
      await query("UPDATE payroll_runs SET sif_file_content = $1 WHERE id = $2", [sifContent, id]);

      // Return as downloadable text file
      const filename = `SIF_${company.name.replace(/[^a-zA-Z0-9]/g, "_")}_${run.period_year}_${String(run.period_month).padStart(2, "0")}.SIF`;
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(sifContent);
    })
  );

  // =============================================
  // PAYROLL ITEMS
  // =============================================

  // List payroll items for a run
  app.get(
    "/api/payroll-runs/:id/items",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const run = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const items = await query(
        `SELECT pi.*, e.full_name as employee_name, e.full_name_ar as employee_name_ar,
              e.employee_number, e.department, e.designation
       FROM payroll_items pi
       JOIN employees e ON e.id = pi.employee_id
       WHERE pi.payroll_run_id = $1
       ORDER BY e.full_name`,
        [id]
      );

      res.json(items);
    })
  );

  // Payslip PDF for one employee of a calculated or approved run
  app.get(
    "/api/payroll-runs/:id/payslips/:itemId/pdf",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id, itemId } = req.params;
      const userId = (req as any).user.id;

      const run = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
      if (!run) {
        return res.status(404).json({ message: "Payroll run not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (run.status !== "calculated" && run.status !== "pending_approval" && run.status !== "approved") {
        return res.status(409).json({
          message: "Payslips are available once the payroll run has been calculated.",
          code: "PAYROLL_RUN_NOT_CALCULATED",
        });
      }

      const row = await queryOne(
        `SELECT pi.*, e.full_name, e.full_name_ar, e.employee_number, e.designation, e.iban
           FROM payroll_items pi
           JOIN employees e ON e.id = pi.employee_id
          WHERE pi.id = $1 AND pi.payroll_run_id = $2`,
        [itemId, id]
      );
      if (!row) {
        return res.status(404).json({ message: "Payroll item not found" });
      }

      const company = await storage.getCompany(run.company_id);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      const pdf = await generatePayslipPDF({
        company,
        employee: {
          id: row.employee_id,
          fullName: row.full_name,
          fullNameAr: row.full_name_ar,
          employeeNumber: row.employee_number,
          designation: row.designation,
          iban: row.iban,
        },
        periodMonth: run.period_month,
        periodYear: run.period_year,
        payDate: run.approved_at ?? null,
        item: {
          basicSalary: row.basic_salary,
          housingAllowance: row.housing_allowance,
          transportAllowance: row.transport_allowance,
          otherAllowance: row.other_allowance,
          overtime: row.overtime,
          deductions: row.deductions,
          deductionNotes: row.deduction_notes,
          pensionEmployee: row.pension_employee,
          pensionEmployer: row.pension_employer,
          gratuityAccrual: row.gratuity_accrual,
          netSalary: row.net_salary,
          leaveDeduction: row.leave_deduction,
          loanDeduction: row.loan_deduction,
          unpaidLeaveDays: row.unpaid_leave_days,
          halfPayLeaveDays: row.half_pay_leave_days,
        },
      });

      const fileKey = String(row.employee_number ?? row.employee_id).replace(/[^A-Za-z0-9_-]/g, "_");
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="payslip-${run.period_year}-${String(run.period_month).padStart(2, "0")}-${fileKey}.pdf"`,
        "Content-Length": pdf.length.toString(),
      });
      res.send(pdf);
    })
  );

  // Payroll register: every pay component per employee, the totals and a tie-out to the posted journal.
  app.get(
    "/api/payroll-runs/:id/register",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const run = /^[0-9a-f-]{36}$/i.test(id) ? await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]) : undefined;
      if (!run || !(await storage.hasCompanyAccess(userId, run.company_id))) {
        return res.status(404).json({ message: "Payroll run not found" });
      }
      const register = await buildPayrollRegister(run);
      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="payroll-register-${run.period_year}-${String(run.period_month).padStart(2, "0")}.csv"`);
        return res.send(registerToCsv(register));
      }
      res.json(register);
    })
  );

  // Update individual payroll item (overtime, deductions)
  app.patch(
    "/api/payroll-items/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const item = await queryOne(
        `SELECT pi.*, pr.company_id, pr.status as run_status,
              pr.period_month, pr.period_year
       FROM payroll_items pi
       JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
       WHERE pi.id = $1`,
        [id]
      );

      if (!item) {
        return res.status(404).json({ message: "Payroll item not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, item.company_id);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (item.run_status === "pending_approval") {
        return res.status(409).json({
          message: "This payroll run is waiting for approval and its items cannot be changed. Reject it first.",
          code: "APPROVAL_IN_PROGRESS",
        });
      }
      if (item.run_status === "approved") {
        return res.status(400).json({ message: "Cannot modify items in an approved payroll run" });
      }

      // Look up the employee for nationality (drives pension applicability) and
      // join_date (drives the 21/30-day gratuity tier).
      const emp = await queryOne("SELECT nationality, join_date FROM employees WHERE id = $1", [
        item.employee_id,
      ]);
      const isGcc = isUaeOrGccNational(emp?.nationality);
      const periodEnd = periodEndDate(item.period_month, item.period_year);
      const tenureYears = emp?.join_date
        ? completedYearsBetween(new Date(emp.join_date), periodEnd)
        : 0;

      const overtime =
        req.body.overtime !== undefined ? parseFloat(req.body.overtime) : parseFloat(item.overtime);
      const generalDeductions =
        req.body.deductions !== undefined
          ? parseFloat(req.body.deductions)
          : parseFloat(item.deductions);
      const deductionNotes =
        req.body.deductionNotes !== undefined ? req.body.deductionNotes : item.deduction_notes;

      const calc = calculatePayrollLine({
        basic: parseFloat(item.basic_salary) || 0,
        housing: parseFloat(item.housing_allowance) || 0,
        transport: parseFloat(item.transport_allowance) || 0,
        other: parseFloat(item.other_allowance) || 0,
        overtime,
        generalDeductions,
        isGccNational: isGcc,
        tenureYears,
      });

      // Leave and loan deductions are set by the calculation; an edit keeps them and recomputes the net around them.
      const leaveDeduction = parseFloat(item.leave_deduction) || 0;
      const loanDeduction = parseFloat(item.loan_deduction) || 0;
      const netAfterHr = round2(calc.netSalary - leaveDeduction - loanDeduction);
      if (netAfterHr < 0) {
        return res.status(400).json({
          message: "Net salary cannot be negative — deductions exceed gross pay.",
          grossPay: calc.grossPay,
          deductions: calc.generalDeductions + calc.pensionEmployee + leaveDeduction + loanDeduction,
          netSalary: netAfterHr,
        });
      }

      const updated = await queryOne(
        `UPDATE payroll_items
         SET overtime = $1, deductions = $2, deduction_notes = $3,
             pension_employee = $4, pension_employer = $5, gratuity_accrual = $6,
             net_salary = $7, manually_edited = true
       WHERE id = $8 RETURNING *`,
        [
          calc.overtime,
          calc.generalDeductions,
          deductionNotes,
          calc.pensionEmployee,
          calc.pensionEmployer,
          calc.gratuityAccrual,
          netAfterHr,
          id,
        ]
      );

      // Recalculate payroll run totals from the items table so they stay in sync.
      const runTotals = await queryOne(
        `SELECT
         SUM(basic_salary) as total_basic,
         SUM(housing_allowance + transport_allowance + other_allowance + overtime) as total_allowances,
         SUM(deductions + pension_employee + leave_deduction + loan_deduction) as total_deductions,
         SUM(leave_deduction) as total_leave_deductions,
         SUM(loan_deduction) as total_loan_deductions,
         SUM(net_salary) as total_net,
         SUM(pension_employee) as total_pension_employee,
         SUM(pension_employer) as total_pension_employer,
         SUM(gratuity_accrual) as total_gratuity_accrual,
         COUNT(*) as employee_count
       FROM payroll_items WHERE payroll_run_id = $1`,
        [item.payroll_run_id]
      );

      if (runTotals) {
        await query(
          `UPDATE payroll_runs SET
          total_basic = $1, total_allowances = $2, total_deductions = $3,
          total_net = $4, total_pension_employee = $5, total_pension_employer = $6,
          total_gratuity_accrual = $7, employee_count = $8,
          total_leave_deductions = $10, total_loan_deductions = $11
         WHERE id = $9`,
          [
            runTotals.total_basic ?? 0,
            runTotals.total_allowances ?? 0,
            runTotals.total_deductions ?? 0,
            runTotals.total_net ?? 0,
            runTotals.total_pension_employee ?? 0,
            runTotals.total_pension_employer ?? 0,
            runTotals.total_gratuity_accrual ?? 0,
            runTotals.employee_count ?? 0,
            item.payroll_run_id,
            runTotals.total_leave_deductions ?? 0,
            runTotals.total_loan_deductions ?? 0,
          ]
        );
      }

      log.info({ payrollItemId: id }, "Payroll item updated");
      res.json(updated);
    })
  );

  // =============================================
  // GRATUITY CALCULATOR
  // =============================================

  // Calculate end-of-service gratuity per UAE labor law
  app.post(
    "/api/companies/:companyId/payroll/gratuity-calculator",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { employeeId, terminationDate } = req.body;

      if (!employeeId) {
        return res.status(400).json({ message: "employeeId is required" });
      }

      const employee = await queryOne("SELECT * FROM employees WHERE id = $1 AND company_id = $2", [
        employeeId,
        companyId,
      ]);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      if (!employee.join_date) {
        return res.status(400).json({ message: "Employee join date is not set" });
      }

      const joinDate = new Date(employee.join_date);
      const endDate = terminationDate ? new Date(terminationDate) : new Date();
      const basicSalary = parseFloat(employee.basic_salary) || 0;
      const housing = parseFloat(employee.housing_allowance) || 0;
      const transport = parseFloat(employee.transport_allowance) || 0;
      const other = parseFloat(employee.other_allowance) || 0;
      const totalWage = basicSalary + housing + transport + other;
      const isGcc = isUaeOrGccNational(employee.nationality);

      const result = calculateGratuityForEmployee({
        joinDate,
        endDate,
        basicSalary,
        totalWage,
        isGccNational: isGcc,
      });

      if (!result.eligible) {
        const note =
          result.reason === "gcc_national"
            ? "UAE/GCC nationals receive GPSSA pension benefits in lieu of end-of-service gratuity."
            : "Employee must complete at least 1 year of service to be eligible for gratuity.";
        return res.json({
          employeeId: employee.id,
          employeeName: employee.full_name,
          nationality: employee.nationality ?? null,
          isGccNational: isGcc,
          joinDate: employee.join_date,
          terminationDate: endDate.toISOString(),
          yearsOfService: Math.round(result.yearsOfService * 100) / 100,
          completedYears: result.completedYears,
          trailingDays: result.trailingDays,
          basicSalary: round2(basicSalary),
          totalWage: round2(totalWage),
          dailyWage: result.dailyWage,
          firstFiveYearsGratuity: 0,
          remainingYearsGratuity: 0,
          totalGratuity: 0,
          uncappedGratuity: 0,
          maxGratuity: result.maxGratuity,
          isCapped: false,
          note,
        });
      }

      res.json({
        employeeId: employee.id,
        employeeName: employee.full_name,
        nationality: employee.nationality ?? null,
        isGccNational: isGcc,
        joinDate: employee.join_date,
        terminationDate: endDate.toISOString(),
        yearsOfService: Math.round(result.yearsOfService * 100) / 100,
        completedYears: result.completedYears,
        trailingDays: result.trailingDays,
        basicSalary: round2(basicSalary),
        totalWage: round2(totalWage),
        dailyWage: result.dailyWage,
        firstFiveYearsGratuity: result.firstFiveYearsGratuity,
        remainingYearsGratuity: result.remainingYearsGratuity,
        totalGratuity: result.totalGratuity,
        uncappedGratuity: result.uncappedGratuity,
        maxGratuity: result.maxGratuity,
        isCapped: result.isCapped,
      });
    })
  );
}
