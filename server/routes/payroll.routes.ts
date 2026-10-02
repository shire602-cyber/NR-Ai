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
import { AppError } from "../errors";
import { storage } from "../storage";
import { db } from "../db";
import { generateSIFFile, sifProblems, type SifEmployee, type SifItem } from "../services/wps-sif.service";
import { generatePayslipPDF } from "../services/pdf-payslip.service";
import { createLogger } from "../config/logger";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import { calculateGratuityForEmployee, completedYearsBetween, isUaeOrGccNational, round2 } from "../services/gratuity";
import { leaveDeductionsForMonth, unpaidServiceDays } from "../services/leave.service";
import { markRunInstalmentsDeducted, releaseRunInstalments, reserveInstalmentsForItem } from "../services/employee-loan.service";
import { ensureEmployeeLoansAccount } from "../services/hr-journal";
import { buildPayrollRegister, registerToCsv } from "../services/payroll-register.service";
import { ROLE_RANK } from "../services/approval-rules";
import { allowEmployee, hrCompanyAccess, hrFullAccess, hrReadScope } from "./hr-access";
import { LOCK_NS, withDocumentLock } from "../services/document-lock";
import { localWallDateToUtcMidnight } from "../utils/date";
import { prorateComponents, prorateMonth, type Proration } from "../services/payroll-proration";
import { employeeDayInput, employeeOut } from "../services/employee-dates";
import { bookPriorServiceCatchup, priorServiceMissing, priorServiceWarning } from "../services/prior-service.service";
import { ensureLeaveProvisionAccounts, leaveProvisionDeltas, leaveProvisionEnabled, recordRunProvisions } from "../services/leave-provision.service";
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

/** What an employee-role user may see of a payroll run: the month and its status, no company totals. */
function redactRunForEmployee(run: any) {
  return {
    id: run.id,
    company_id: run.company_id,
    period_month: run.period_month,
    period_year: run.period_year,
    status: run.status,
    run_date: run.run_date,
  };
}

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
  // A calendar day: "YYYY-MM-DD" is kept, an ISO instant becomes its Dubai day (employee-dates.ts).
  joinDate: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : employeeDayInput(v) ?? "invalid"),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The join date is not a real date").optional()
  ),
  basicSalary: z.coerce.number().positive(BASIC_SALARY_POSITIVE_MESSAGE),
  housingAllowance: z.coerce.number().nonnegative().default(0),
  transportAllowance: z.coerce.number().nonnegative().default(0),
  otherAllowance: z.coerce.number().nonnegative().default(0),
  status: z.enum(["active", "inactive", "terminated"]).optional(),
  // The login this record belongs to (an employee-role user then sees only this record). Must be a member of the company.
  userId: z.string().uuid().nullable().optional(),
  // The 14-digit MOHRE person code the WPS (SIF) file reports for the employee.
  molPersonId: z.string().trim().regex(/^\d{14}$/, "The MOHRE person code is 14 digits").nullable().optional().or(z.literal("").transform(() => null)),
  // End-of-service provision already held for the employee when they came on to the system (part of the opening 2036 balance).
  openingGratuityProvision: z.coerce.number().nonnegative().max(100_000_000).optional(),
  // Prior service (0128): the leave days and leave-pay provision the company already held, as of a date.
  openingLeaveDays: z.coerce.number().nonnegative().max(1000).optional(),
  openingLeaveProvision: z.coerce.number().nonnegative().max(100_000_000).optional(),
  openingProvisionsAsOf: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : employeeDayInput(v) ?? "invalid"),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The as-of date is not a real date").optional()
  ),
});

/** 422 body when `userId` is not a member of the company; null when it is fine (or absent / cleared). */
async function employeeUserLinkProblem(companyId: string, userId: unknown): Promise<{ message: string; code: string } | null> {
  if (userId === undefined || userId === null) return null;
  if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) return { message: "userId must be a user id.", code: "INVALID_USER" };
  const member = await queryOne("SELECT 1 AS ok FROM company_users WHERE company_id = $1 AND user_id = $2", [companyId, userId]);
  return member ? null : { message: "That user is not a member of this company.", code: "INVALID_USER" };
}

const isUniqueViolation = (err: any) => err?.code === "23505" || err?.cause?.code === "23505";

/** Share of a month's service left once unpaid-leave days are taken out (paid days = the days the month pays for). */
function serviceFactorOf(unpaidDays: number, paidDays: number): number {
  if (!(unpaidDays > 0) || !(paidDays > 0)) return 1;
  return Math.max(0, (paidDays - unpaidDays) / paidDays);
}

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
  // Share of the month that counts as service (1 = all of it): unpaid leave days are not service (Decree-Law 33/2021).
  serviceFactor?: number;
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
    : round2(((annualGratuityDays * basic) / DAYS_PER_YEAR_30D) * Math.min(1, Math.max(0, input.serviceFactor ?? 1)));

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

const FIELD_CODE: Record<string, string> = { fullName: "FULL_NAME", employeeNumber: "EMPLOYEE_NUMBER", basicSalary: "BASIC_SALARY", joinDate: "JOIN_DATE", openingProvisionsAsOf: "AS_OF_DATE" };

/** A refused employee body: the first problem as a code the client can translate (FULL_NAME_REQUIRED, ...) and its field. */
function employeeValidationBody(issues: z.ZodIssue[]) {
  const first = issues[0];
  const field = String(first?.path?.[0] ?? "");
  const base = FIELD_CODE[field] ?? field.replace(/([A-Z])/g, "_$1").toUpperCase();
  const missing = first?.code === "invalid_type" || (first?.code === "too_small" && (first as any).minimum === 1);
  return {
    message: first?.message && first.message !== "Required" ? first.message : `${field || "A required field"} is required`,
    code: field ? `${base}_${missing ? "REQUIRED" : "INVALID"}` : "VALIDATION_ERROR",
    field: field || undefined,
    errors: issues,
  };
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

      const hasAccess = await storage.hasCompanyAccess(userId, companyId, { employeeSelfService: true });
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // An employee-role user sees only the employee record linked to their own login.
      const scope = await hrReadScope(req, res, companyId);
      if (!scope) return;
      const employees = scope.all
        ? await query("SELECT * FROM employees WHERE company_id = $1 ORDER BY created_at DESC", [companyId])
        : scope.employeeIds.length === 0
          ? []
          : await query("SELECT * FROM employees WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY created_at DESC", [companyId, scope.employeeIds]);
      res.json(employees.map((row: any) => employeeOut(row)));
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

      const hasAccess = await storage.hasCompanyAccess(userId, employee.company_id, { employeeSelfService: true });
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      const scope = await hrReadScope(req, res, employee.company_id);
      if (!scope || !allowEmployee(res, scope, employee.id)) return;

      res.json(employeeOut(employee));
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

      if (!(await hrCompanyAccess(req, res, companyId, { write: true }))) return;

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
      if (!parsed.success) return res.status(400).json(employeeValidationBody(parsed.error.errors));
      const data = parsed.data;
      const linkProblem = await employeeUserLinkProblem(companyId, data.userId);
      if (linkProblem) return res.status(422).json(linkProblem);

      const totalSalary =
        data.basicSalary + data.housingAllowance + data.transportAllowance + data.otherAllowance;

      const [employee] = await query(
        `INSERT INTO employees (
        company_id, employee_number, full_name, full_name_ar, nationality,
        passport_number, visa_number, labor_card_number,
        bank_name, bank_account_number, iban, routing_code,
        department, designation, join_date,
        basic_salary, housing_allowance, transport_allowance, other_allowance,
        total_salary, status, user_id, mol_person_id, opening_gratuity_provision,
        opening_leave_days, opening_leave_provision, opening_provisions_as_of
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
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
          data.userId ?? null,
          data.molPersonId ?? null,
          data.openingGratuityProvision ?? 0,
          data.openingLeaveDays ?? 0,
          data.openingLeaveProvision ?? 0,
          data.openingProvisionsAsOf ?? null,
        ]
      ).catch((err) => {
        if (isUniqueViolation(err)) throw new AppError({ message: "That user is already linked to another employee.", statusCode: 409, code: "USER_ALREADY_LINKED" });
        throw err;
      });

      log.info({ employeeId: employee.id, companyId }, "Employee created");
      res.status(201).json(employeeOut(employee));
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

      if (!(await hrCompanyAccess(req, res, employee.company_id, { write: true }))) return;

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

      if (req.body.molPersonId !== undefined && req.body.molPersonId !== null && req.body.molPersonId !== "" && !/^\d{14}$/.test(String(req.body.molPersonId).trim())) {
        return res.status(400).json({ message: "The MOHRE person code is 14 digits", code: "INVALID_MOL_PERSON_ID" });
      }
      if (req.body.molPersonId === "") req.body.molPersonId = null;
      // Calendar days: date-only strings are kept, ISO instants become their Dubai day, nonsense is refused.
      for (const key of ["joinDate", "openingProvisionsAsOf"] as const) {
        const v = req.body[key];
        if (v === undefined) continue;
        if (v === null || v === "") {
          req.body[key] = null;
          continue;
        }
        const day = employeeDayInput(v);
        if (!day) return res.status(400).json({ message: "That date does not exist.", code: "INVALID_DATE", field: key });
        req.body[key] = day;
      }
      if (req.body.openingGratuityProvision !== undefined) {
        const opening = Number(req.body.openingGratuityProvision);
        if (!Number.isFinite(opening) || opening < 0) {
          return res.status(400).json({ message: "The opening gratuity provision must be zero or more", code: "INVALID_OPENING_PROVISION" });
        }
        req.body.openingGratuityProvision = opening;
      }

      for (const key of ["openingLeaveDays", "openingLeaveProvision"] as const) {
        if (req.body[key] === undefined) continue;
        const v = Number(req.body[key]);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ message: "Opening provisions must be zero or more", code: "INVALID_OPENING_PROVISION" });
        req.body[key] = v;
      }
      if (req.body.openingProvisionsAsOf === "") req.body.openingProvisionsAsOf = null;
      if (req.body.openingProvisionsAsOf && !/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.openingProvisionsAsOf))) {
        return res.status(400).json({ message: "The as-of date is YYYY-MM-DD", code: "INVALID_AS_OF" });
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
        molPersonId: "mol_person_id",
        openingGratuityProvision: "opening_gratuity_provision",
        openingLeaveDays: "opening_leave_days",
        openingLeaveProvision: "opening_leave_provision",
        openingProvisionsAsOf: "opening_provisions_as_of",
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

      // The login link: validated against the company's members, cleared with null.
      if (req.body.userId !== undefined) {
        const linkProblem = await employeeUserLinkProblem(employee.company_id, req.body.userId);
        if (linkProblem) return res.status(422).json(linkProblem);
        setClauses.push(`"user_id" = $${paramIndex}`);
        values.push(req.body.userId);
        paramIndex++;
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
        return res.json(employeeOut(employee));
      }

      values.push(id);
      const updated = await queryOne(
        `UPDATE employees SET ${setClauses.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        values
      ).catch((err) => {
        if (isUniqueViolation(err)) throw new AppError({ message: "That user is already linked to another employee.", statusCode: 409, code: "USER_ALREADY_LINKED" });
        throw err;
      });

      log.info({ employeeId: id }, "Employee updated");
      res.json(employeeOut(updated));
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

      if (!(await hrCompanyAccess(req, res, employee.company_id, { write: true }))) return;

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

      const hasAccess = await storage.hasCompanyAccess(userId, companyId, { employeeSelfService: true });
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const runs = await query(
        "SELECT * FROM payroll_runs WHERE company_id = $1 ORDER BY period_year DESC, period_month DESC",
        [companyId]
      );
      const scope = await hrReadScope(req, res, companyId);
      if (!scope) return;
      // An employee sees which months were run, never the company totals.
      res.json(scope.all ? runs : runs.map(redactRunForEmployee));
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

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id, { employeeSelfService: true });
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }
      const scope = await hrReadScope(req, res, run.company_id);
      if (!scope) return;

      res.json(scope.all ? run : redactRunForEmployee(run));
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

      if (!(await hrCompanyAccess(req, res, companyId, { write: true }))) return;

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
        `INSERT INTO payroll_runs (company_id, period_month, period_year, status, created_by)
       VALUES ($1, $2, $3, 'draft', $4) RETURNING *`,
        [companyId, periodMonth, periodYear, userId]
      );

      await recordAudit({ userId, companyId, action: "payroll_run.create", entityType: "payroll_run", entityId: run.id, after: { periodMonth, periodYear }, req });
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

      if (!(await hrCompanyAccess(req, res, run.company_id, { write: true }))) return;

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

      if (!(await hrCompanyAccess(req, res, run.company_id, { write: true }))) return;

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
      // The same pro-rata facts as structured notes, so the screen can word them in the reader's language.
      const proRataNotes: Array<{ code: string; name: string; days: number; basis: number; date: string | null }> = [];
      let otherWarnings: string[] = [];
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

        // Active employees, plus a leaver whose last month this is (paid up to the last day worked).
        const activeEmployees = await tq(
          `SELECT * FROM employees WHERE company_id = $1
              AND (status = 'active' OR (status = 'terminated' AND termination_date >= make_date($2::int, $3::int, 1)))`,
          [run.company_id, run.period_year, run.period_month]
        );

        // Zero-salary employees are excluded (with a warning) rather than
        // failing the whole run.
        const partition = partitionPayrollEligible(activeEmployees);
        warnings = [...partition.warnings];
        otherWarnings = [...partition.warnings];

        // A joiner or leaver is paid for the days of the month worked, on the 30-day basis (join on the 15th = 16/30);
        // nobody is paid for a month before they joined or after they left. Each case is named in the warnings.
        const prorations = new Map<string, Proration>();
        const employees = partition.eligible.filter((e: any) => {
          const join = e.join_date ? (localWallDateToUtcMidnight(new Date(e.join_date)) as Date).toISOString().slice(0, 10) : null;
          const left = e.termination_date ? (localWallDateToUtcMidnight(new Date(e.termination_date)) as Date).toISOString().slice(0, 10) : null;
          const p = prorateMonth({ joinYmd: join, terminationYmd: left, year: run.period_year, month: run.period_month });
          if (p.daysWorked === 0) {
            proRataNotes.push({ code: p.reason === "not_yet_joined" ? "not_yet_joined" : "left_before", name: e.full_name, days: 0, basis: p.basis, date: p.reason === "not_yet_joined" ? join : left });
            warnings.push(
              p.reason === "not_yet_joined"
                ? `${e.full_name} is not paid: the join date (${join}) is after this month.`
                : `${e.full_name} is not paid: they left (${left}) before this month.`
            );
            return false;
          }
          if (p.factor < 1) {
            proRataNotes.push({ code: p.reason === "joined" ? "joined" : "left", name: e.full_name, days: p.daysWorked, basis: p.basis, date: p.reason === "joined" ? join : left });
            warnings.push(
              `${e.full_name} is pro-rated: ${p.daysWorked}/${p.basis} days (${p.reason === "joined" ? `joined ${join}` : `last day ${left}`}).`
            );
          }
          prorations.set(e.id, p);
          return true;
        });

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

        // Approved leave of the month (unpaid, half-pay and sick-leave tiers) takes wage/30 or wage/60 a day, where the
        // wage is the full monthly wage (basic plus allowances).
        const wageOf = (e: any) =>
          (parseFloat(e.basic_salary) || 0) + (parseFloat(e.housing_allowance) || 0) + (parseFloat(e.transport_allowance) || 0) + (parseFloat(e.other_allowance) || 0);
        const leaveByEmployee = await leaveDeductionsForMonth(run.company_id, run.period_year, run.period_month, [
          ...employees.filter((e: any) => !preservedEmployeeIds.has(e.id)).map((e: any) => ({ id: e.id, wage: wageOf(e) })),
          ...preservedItems.map((it: any) => ({ id: it.employee_id, wage: wageOf(it) })),
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

          const proration = prorations.get(emp.id)!;
          // The month's pay is rounded once as a line; the parts add up to it exactly.
          const part = prorateComponents(
            {
              basic: parseFloat(emp.basic_salary) || 0,
              housing: parseFloat(emp.housing_allowance) || 0,
              transport: parseFloat(emp.transport_allowance) || 0,
              other: parseFloat(emp.other_allowance) || 0,
            },
            proration.factor
          );
          const rawLeave = leaveByEmployee.get(emp.id) ?? { unpaidDays: 0, halfDays: 0, deduction: 0 };
          const calc = calculatePayrollLine({
            ...part,
            overtime: 0,
            generalDeductions: 0,
            isGccNational: isUaeOrGccNational(emp.nationality),
            tenureYears,
            // Unpaid absence is not service: it takes its share off the month's gratuity accrual.
            serviceFactor: serviceFactorOf(rawLeave.unpaidDays, proration.partial ? Math.min(30, proration.daysWorked) : 30),
          });

          // Whatever the leave, a month never deducts more than the pay of the days worked.
          const leave = { ...rawLeave, deduction: Math.min(rawLeave.deduction, round2(calc.basic + calc.housing + calc.transport + calc.other)) };
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
            leave_deduction, unpaid_leave_days, half_pay_leave_days, days_worked
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'bank_transfer', 'pending', false, $13, $14, $15, $16)
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
              proration.partial ? proration.daysWorked : null,
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

        // Whoever first calculates a run prepared it (a run made by another keeps its creator).
        await tq("UPDATE payroll_runs SET created_by = COALESCE(created_by, $2) WHERE id = $1", [id, userId]);

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
      // Employees with prior service and no opening provisions are named, never silently caught up.
      const priorService = { missing: await priorServiceMissing(run.company_id) };
      const priorWarning = priorServiceWarning(priorService.missing);
      if (priorWarning) {
        warnings.push(priorWarning);
        otherWarnings.push(priorWarning);
      }
      await recordAudit({
        userId,
        companyId: run.company_id,
        action: "payroll_run.calculate",
        entityType: "payroll_run",
        entityId: id,
        after: { employeeCount, totalNet: updated?.total_net, preserved: preservedItems.length },
        req,
      });
      res.json({ ...updated, warnings, proRataNotes, otherWarnings, priorServiceMissing: priorService.missing });
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
      const periodEndDate = new Date(Date.UTC(run.period_year, run.period_month, 0));
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
        ? await beginApprovalStep(tx, approvalDoc, approvalActor, { previousStatus: run.status, acknowledgeSoleApprover: req.body?.acknowledgeSoleApprover === true })
        : ({ kind: "none" } as const);
      if (approvalStep.kind === "none" && approvalActor.rank < ROLE_RANK.accountant) {
        // No rule applies: the plain approval still belongs to an accountant or above, never to the employee role.
        return res.status(403).json({ message: "Only an accountant, CFO or owner can approve a payroll run.", code: "ROLE_REQUIRED" });
      }
      if (approvalStep.kind === "step" && !approvalStep.isFinal) {
        const request = await recordApprovalStep(tx, approvalStep, approvalActor);
        const waiting = await queryOne("UPDATE payroll_runs SET status = 'pending_approval' WHERE id = $1 RETURNING *", [id]);
        await auditApprovalStep({ req, actor: approvalActor, doc: approvalDoc!, request, stepNumber: approvalStep.stepNumber, decision: "approved" });
        // The first signature on a run under approval rules is its submission: the trail names who submitted it.
        await recordAudit({ userId, companyId: run.company_id, action: "payroll_run.submit", entityType: "payroll_run", entityId: id, after: { step: approvalStep.stepNumber, requiredSteps: approvalStep.requiredSteps }, req });
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

      // Leave-pay provision: this month's accrual (2.5 days x daily wage, less unpaid absence, less annual leave taken)
      // is booked with the run. What an employee brought with them is NOT: it is an opening provision or an explicit catch-up.
      const existingJeBeforeProvision = (await storage.getJournalEntriesBySource(run.company_id, "system", id)).find((e) => e.status === "posted");
      let provisionDeltas: Awaited<ReturnType<typeof leaveProvisionDeltas>> = [];
      if (!existingJeBeforeProvision && (await leaveProvisionEnabled(run.company_id))) {
        const periodStartYmd = `${run.period_year}-${String(run.period_month).padStart(2, "0")}-01`;
        provisionDeltas = await leaveProvisionDeltas(run.company_id, id, periodStartYmd, new Date(Date.UTC(run.period_year, run.period_month, 0)).toISOString().slice(0, 10));
        const net = round2(provisionDeltas.reduce((s, d) => s + d.delta, 0));
        if (net !== 0) {
          const accountsForProvision = await ensureLeaveProvisionAccounts(run.company_id);
          jeLines.push(
            { accountId: accountsForProvision.expenseId, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, description: `Leave pay provision - payroll ${periodLabel}` },
            { accountId: accountsForProvision.provisionId, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0, description: `Leave pay provision - payroll ${periodLabel}` }
          );
        }
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

      // Items are APPROVED, not paid: no money has moved until the run's payment is recorded (record-payment).
      await query(
        "UPDATE payroll_items SET status = 'approved', journal_entry_id = $1 WHERE payroll_run_id = $2",
        [journalEntry.id, id]
      );
      if (provisionDeltas.length > 0) await recordRunProvisions(run.company_id, id, provisionDeltas);
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

  // Record the bank payment of an approved run: Dr 2030 Salaries Payable / Cr the bank. Approving a run posts the
  // salary liability; only this step moves it, and only now are the run and its items "paid".
  app.post(
    "/api/payroll-runs/:id/record-payment",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const run = /^[0-9a-f-]{36}$/i.test(id) ? await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]) : undefined;
      if (!run || !(await storage.hasCompanyAccess(userId, run.company_id))) {
        return res.status(404).json({ message: "Payroll run not found" });
      }
      if (!(await hrCompanyAccess(req, res, run.company_id, { write: true }))) return;

      const body = z
        .object({
          paymentAccountId: z.string().uuid(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .safeParse(req.body);
      if (!body.success) return res.status(400).json({ message: "paymentAccountId is required", code: "VALIDATION_ERROR" });

      const result = await withDocumentLock(id, LOCK_NS.APPROVAL, async () => {
        const fresh = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
        if (!fresh || fresh.status === "paid") return { status: 409, body: { message: "This run's payment is already recorded.", code: "PAYROLL_ALREADY_PAID" } };
        if (fresh.status !== "approved") return { status: 409, body: { message: "Approve the payroll run before recording its payment.", code: "PAYROLL_NOT_APPROVED" } };
        const { assertCashOrBankAccount, postHrJournal } = await import("../services/hr-journal");
        await assertCashOrBankAccount(fresh.company_id, body.data.paymentAccountId);
        const dateYmd = body.data.date ?? new Date().toISOString().slice(0, 10);
        if (dateYmd > new Date().toISOString().slice(0, 10)) {
          return { status: 422, body: { message: "The payment date cannot be in the future.", code: "PAYMENT_IN_FUTURE" } };
        }
        const accounts = await storage.getAccountsByCompanyId(fresh.company_id);
        const payable = accounts.find((a) => a.code === "2030" && !a.isArchived);
        if (!payable) return { status: 422, body: { message: "Salaries Payable (2030) is missing from the chart of accounts.", code: "CHART_ACCOUNT_MISSING" } };
        const net = round2(
          Number((await query("SELECT COALESCE(SUM(net_salary), 0) AS net FROM payroll_items WHERE payroll_run_id = $1", [id]))[0].net)
        );
        const label = `${String(fresh.period_month).padStart(2, "0")}/${fresh.period_year}`;
        const je = await postHrJournal({
          companyId: fresh.company_id,
          dateYmd,
          memo: `Payroll ${label} paid`,
          source: "payroll_payment",
          sourceId: id,
          userId,
          lines: [
            { accountId: payable.id, debit: net, credit: 0, description: `Salaries paid - payroll ${label}` },
            { accountId: body.data.paymentAccountId, debit: 0, credit: net, description: `Salaries paid - payroll ${label}` },
          ],
        });
        await query("UPDATE payroll_items SET status = 'paid' WHERE payroll_run_id = $1", [id]);
        const updated = await queryOne("UPDATE payroll_runs SET status = 'paid' WHERE id = $1 RETURNING *", [id]);
        await recordAudit({ userId, companyId: fresh.company_id, action: "payroll.payment", entityType: "payroll_run", entityId: id, after: { net, journalEntryId: je.id, date: dateYmd }, req });
        return { status: 200, body: { ...updated, paymentJournalEntryId: je.id } };
      });
      res.status(result.status).json(result.body);
    })
  );

  // "Book prior-service catch-up journal": what employees with prior service earned before the first payroll period,
  // booked as its own journal (never inside a run's journal). Accountant or above; once per employee.
  app.post(
    "/api/payroll-runs/:id/book-prior-service-catchup",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const run = /^[0-9a-f-]{36}$/i.test(id) ? await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]) : undefined;
      if (!run || !(await storage.hasCompanyAccess(userId, run.company_id))) {
        return res.status(404).json({ message: "Payroll run not found" });
      }
      if (!(await hrCompanyAccess(req, res, run.company_id, { write: true }))) return;
      const result = await withDocumentLock(run.company_id, LOCK_NS.APPROVAL, () => bookPriorServiceCatchup({ companyId: run.company_id, runId: id, userId }));
      await recordAudit({
        userId,
        companyId: run.company_id,
        action: "payroll_run.prior_service_catchup",
        entityType: "payroll_run",
        entityId: id,
        after: { journalEntryId: result.journalEntryId, total: result.total, employees: result.employees.length },
        req,
      });
      res.json(result);
    })
  );

  // Delete a run that has posted nothing (draft or calculated): its loan reservations are given back.
  app.delete(
    "/api/payroll-runs/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const run = /^[0-9a-f-]{36}$/i.test(id) ? await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]) : undefined;
      if (!run || !(await storage.hasCompanyAccess(userId, run.company_id))) {
        return res.status(404).json({ message: "Payroll run not found" });
      }
      if (!(await hrCompanyAccess(req, res, run.company_id, { write: true }))) return;
      const result = await withDocumentLock(id, LOCK_NS.APPROVAL, async () => {
        const fresh = await queryOne("SELECT * FROM payroll_runs WHERE id = $1", [id]);
        if (!fresh) return { status: 404, body: { message: "Payroll run not found" } };
        if (fresh.status === "pending_approval") return { status: 409, body: { message: "This run is waiting for approval. Reject it first.", code: "APPROVAL_IN_PROGRESS" } };
        if ((fresh.status !== "draft" && fresh.status !== "calculated") || fresh.journal_entry_id) {
          return { status: 409, body: { message: "A run that has been approved has posted to the ledger and cannot be deleted.", code: "PAYROLL_RUN_POSTED" } };
        }
        await releaseRunInstalments(id);
        await query("DELETE FROM approval_requests WHERE document_type = 'payroll_run' AND document_id = $1 AND status <> 'approved'", [id]);
        await query("DELETE FROM payroll_runs WHERE id = $1", [id]);
        await recordAudit({ userId, companyId: fresh.company_id, action: "payroll.run_delete", entityType: "payroll_run", entityId: id, before: { status: fresh.status, period: `${fresh.period_year}-${fresh.period_month}` }, req });
        return { status: 200, body: { message: "Payroll run deleted" } };
      });
      res.status(result.status).json(result.body);
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

      if (!(await hrFullAccess(req, res, run.company_id))) return;

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

      // The people the file reports: MOHRE person ID, bank routing code, IBAN and the dates that bound a part month.
      const ymdOf = (v: unknown) => (v ? (localWallDateToUtcMidnight(new Date(v as any)) as Date).toISOString().slice(0, 10) : null);
      const employeeMap = new Map<string, SifEmployee>();
      for (const emp of employeeRows) {
        employeeMap.set(emp.id, {
          fullName: emp.full_name,
          molPersonId: emp.mol_person_id,
          routingCode: emp.routing_code,
          iban: emp.iban,
          bankAccountNumber: emp.bank_account_number,
          joinYmd: ymdOf(emp.join_date),
          terminationYmd: ymdOf(emp.termination_date),
        });
      }
      const sifItems: SifItem[] = items.map((item: any) => ({
        employeeId: item.employee_id,
        netSalary: item.net_salary,
        overtime: item.overtime,
        daysWorked: item.days_worked,
        leaveDays: (parseFloat(item.unpaid_leave_days) || 0) + (parseFloat(item.half_pay_leave_days) || 0),
      }));
      const sifCompany = {
        mohreEstablishmentId: company.mohre_establishment_id,
        routingCode: company.wps_employer_routing_code,
        reference: `PAYROLL-${run.period_year}-${String(run.period_month).padStart(2, "0")}`,
      };

      // A file with a blank employer ID or a missing person ID is rejected by the bank: say what is missing instead.
      const missing = sifProblems(sifCompany, sifItems, employeeMap);
      if (missing.length > 0) {
        return res.status(422).json({
          message: `The WPS file cannot be produced yet: ${missing.length} identifier(s) are missing. ${missing.map((m) => m.message).join(" ")}`,
          code: "SIF_MISSING_IDS",
          missing,
        });
      }

      const sifContent = generateSIFFile({ company: sifCompany, run: { periodMonth: run.period_month, periodYear: run.period_year }, items: sifItems, employees: employeeMap });

      // Store the SIF content on the payroll run
      await query("UPDATE payroll_runs SET sif_file_content = $1 WHERE id = $2", [sifContent, id]);

      // Return as downloadable text file
      const filename = `SIF_${company.name.replace(/[^a-zA-Z0-9]/g, "_")}_${run.period_year}_${String(run.period_month).padStart(2, "0")}.SIF`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
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

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id, { employeeSelfService: true });
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const scope = await hrReadScope(req, res, run.company_id);
      if (!scope) return;
      const items = await query(
        `SELECT pi.*, e.full_name as employee_name, e.full_name_ar as employee_name_ar,
              e.employee_number, e.department, e.designation
       FROM payroll_items pi
       JOIN employees e ON e.id = pi.employee_id
       WHERE pi.payroll_run_id = $1
       ORDER BY e.full_name`,
        [id]
      );

      // An employee sees only their own pay line.
      res.json(scope.all ? items : items.filter((i: any) => scope.employeeIds.includes(i.employee_id)));
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

      const hasAccess = await storage.hasCompanyAccess(userId, run.company_id, { employeeSelfService: true });
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Every stage after the calculation has a slip. Before approval it carries a "DRAFT - not yet approved" banner;
      // an approved or paid run's slip is the issued one.
      if (!["calculated", "pending_approval", "approved", "paid", "posted"].includes(run.status)) {
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
      const scope = await hrReadScope(req, res, run.company_id);
      if (!scope || !allowEmployee(res, scope, row.employee_id)) return;

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
        // The payment's own date (what the bank paid on), not the day it was recorded; "-" until a payment is recorded.
        payDate: (
          await queryOne(
            `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE company_id = $1 AND source = 'payroll_payment' AND source_id = $2 AND status = 'posted' ORDER BY created_at DESC LIMIT 1`,
            [run.company_id, id]
          )
        )?.d ?? null,
        draft: run.status === "calculated" || run.status === "pending_approval",
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
      if (!(await hrFullAccess(req, res, run.company_id))) return;
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

      if (!(await hrCompanyAccess(req, res, item.company_id, { write: true }))) return;

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
        serviceFactor: serviceFactorOf(parseFloat(item.unpaid_leave_days) || 0, item.days_worked != null ? Math.min(30, parseFloat(item.days_worked)) : 30),
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

      const hasAccess = await storage.hasCompanyAccess(userId, companyId, { employeeSelfService: true });
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { employeeId, terminationDate } = req.body;

      if (!employeeId) {
        return res.status(400).json({ message: "employeeId is required" });
      }
      const gratuityScope = await hrReadScope(req, res, companyId);
      if (!gratuityScope || !allowEmployee(res, gratuityScope, employeeId)) return;

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

      // Calendar days as UTC midnights (the join date is a date-only value read in server-local time).
      const joinDate = localWallDateToUtcMidnight(new Date(employee.join_date)) as Date;
      const endDate = terminationDate
        ? new Date(`${String(terminationDate).slice(0, 10)}T00:00:00Z`)
        : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const basicSalary = parseFloat(employee.basic_salary) || 0;
      const housing = parseFloat(employee.housing_allowance) || 0;
      const transport = parseFloat(employee.transport_allowance) || 0;
      const other = parseFloat(employee.other_allowance) || 0;
      const totalWage = basicSalary + housing + transport + other;
      const isGcc = isUaeOrGccNational(employee.nationality);

      // Unpaid leave is not service: approved unpaid days in the service period come off it.
      const unpaidDays = await unpaidServiceDays(companyId, employee.id, joinDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10));
      const result = calculateGratuityForEmployee({
        joinDate,
        endDate,
        basicSalary,
        totalWage,
        isGccNational: isGcc,
        unpaidDays,
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
