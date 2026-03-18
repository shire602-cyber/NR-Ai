/**
 * Payroll / WPS Compliance Routes
 * ────────────────────────────────
 * CRUD for employees, payroll runs, payroll items,
 * SIF file generation, and gratuity calculation.
 */

import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { storage } from '../storage';
import { db } from '../db';
import { generateSIFFile } from '../services/wps-sif.service';
import { createLogger } from '../config/logger';

const log = createLogger('payroll');

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

export function registerPayrollRoutes(app: Express) {
  // =============================================
  // EMPLOYEES
  // =============================================

  // List all employees for a company
  app.get("/api/companies/:companyId/employees", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const employees = await query(
      'SELECT * FROM employees WHERE company_id = $1 ORDER BY created_at DESC',
      [companyId]
    );
    res.json(employees);
  }));

  // Get single employee
  app.get("/api/employees/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const employee = await queryOne('SELECT * FROM employees WHERE id = $1', [id]);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, employee.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(employee);
  }));

  // Create employee
  app.post("/api/companies/:companyId/employees", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      employeeNumber, fullName, fullNameAr, nationality,
      passportNumber, visaNumber, laborCardNumber,
      bankName, bankAccountNumber, iban, routingCode,
      department, designation, joinDate,
      basicSalary, housingAllowance, transportAllowance, otherAllowance,
      status,
    } = req.body;

    const basic = parseFloat(basicSalary) || 0;
    const housing = parseFloat(housingAllowance) || 0;
    const transport = parseFloat(transportAllowance) || 0;
    const other = parseFloat(otherAllowance) || 0;
    const totalSalary = basic + housing + transport + other;

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
        companyId, employeeNumber || null, fullName, fullNameAr || null, nationality || null,
        passportNumber || null, visaNumber || null, laborCardNumber || null,
        bankName || null, bankAccountNumber || null, iban || null, routingCode || null,
        department || null, designation || null, joinDate || null,
        basic, housing, transport, other,
        totalSalary, status || 'active',
      ]
    );

    log.info({ employeeId: employee.id, companyId }, 'Employee created');
    res.json(employee);
  }));

  // Update employee
  app.patch("/api/employees/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const employee = await queryOne('SELECT * FROM employees WHERE id = $1', [id]);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, employee.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Build dynamic SET clause from provided fields
    const allowedFields: Record<string, string> = {
      employeeNumber: 'employee_number',
      fullName: 'full_name',
      fullNameAr: 'full_name_ar',
      nationality: 'nationality',
      passportNumber: 'passport_number',
      visaNumber: 'visa_number',
      laborCardNumber: 'labor_card_number',
      bankName: 'bank_name',
      bankAccountNumber: 'bank_account_number',
      iban: 'iban',
      routingCode: 'routing_code',
      department: 'department',
      designation: 'designation',
      joinDate: 'join_date',
      basicSalary: 'basic_salary',
      housingAllowance: 'housing_allowance',
      transportAllowance: 'transport_allowance',
      otherAllowance: 'other_allowance',
      status: 'status',
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

    // Recalculate total salary if any salary field changed
    const basic = req.body.basicSalary !== undefined ? parseFloat(req.body.basicSalary) : parseFloat(employee.basic_salary);
    const housing = req.body.housingAllowance !== undefined ? parseFloat(req.body.housingAllowance) : parseFloat(employee.housing_allowance);
    const transport = req.body.transportAllowance !== undefined ? parseFloat(req.body.transportAllowance) : parseFloat(employee.transport_allowance);
    const other = req.body.otherAllowance !== undefined ? parseFloat(req.body.otherAllowance) : parseFloat(employee.other_allowance);
    const totalSalary = basic + housing + transport + other;

    setClauses.push(`"total_salary" = $${paramIndex}`);
    values.push(totalSalary);
    paramIndex++;

    if (setClauses.length === 0) {
      return res.json(employee);
    }

    values.push(id);
    const updated = await queryOne(
      `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    log.info({ employeeId: id }, 'Employee updated');
    res.json(updated);
  }));

  // Delete employee
  app.delete("/api/employees/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const employee = await queryOne('SELECT * FROM employees WHERE id = $1', [id]);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, employee.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await query('DELETE FROM employees WHERE id = $1', [id]);
    log.info({ employeeId: id }, 'Employee deleted');
    res.json({ message: 'Employee deleted successfully' });
  }));

  // =============================================
  // PAYROLL RUNS
  // =============================================

  // List payroll runs for a company
  app.get("/api/companies/:companyId/payroll-runs", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const runs = await query(
      'SELECT * FROM payroll_runs WHERE company_id = $1 ORDER BY period_year DESC, period_month DESC',
      [companyId]
    );
    res.json(runs);
  }));

  // Get single payroll run
  app.get("/api/payroll-runs/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const run = await queryOne('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run) {
      return res.status(404).json({ message: 'Payroll run not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(run);
  }));

  // Create payroll run
  app.post("/api/companies/:companyId/payroll-runs", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { periodMonth, periodYear } = req.body;

    if (!periodMonth || !periodYear) {
      return res.status(400).json({ message: 'periodMonth and periodYear are required' });
    }

    // Check for duplicate run in same period
    const existing = await queryOne(
      'SELECT id FROM payroll_runs WHERE company_id = $1 AND period_month = $2 AND period_year = $3',
      [companyId, periodMonth, periodYear]
    );
    if (existing) {
      return res.status(409).json({ message: 'A payroll run already exists for this period' });
    }

    const [run] = await query(
      `INSERT INTO payroll_runs (company_id, period_month, period_year, status)
       VALUES ($1, $2, $3, 'draft') RETURNING *`,
      [companyId, periodMonth, periodYear]
    );

    log.info({ payrollRunId: run.id, companyId, periodMonth, periodYear }, 'Payroll run created');
    res.json(run);
  }));

  // Update payroll run
  app.patch("/api/payroll-runs/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const run = await queryOne('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run) {
      return res.status(404).json({ message: 'Payroll run not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (run.status === 'approved') {
      return res.status(400).json({ message: 'Cannot modify an approved payroll run' });
    }

    const allowedFields: Record<string, string> = {
      periodMonth: 'period_month',
      periodYear: 'period_year',
      status: 'status',
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
      `UPDATE payroll_runs SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    log.info({ payrollRunId: id }, 'Payroll run updated');
    res.json(updated);
  }));

  // =============================================
  // PAYROLL CALCULATION & APPROVAL
  // =============================================

  // Calculate payroll — auto-populate payroll items from active employees
  app.post("/api/payroll-runs/:id/calculate", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const run = await queryOne('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run) {
      return res.status(404).json({ message: 'Payroll run not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (run.status === 'approved') {
      return res.status(400).json({ message: 'Cannot recalculate an approved payroll run' });
    }

    // Delete existing payroll items for this run (recalculate fresh)
    await query('DELETE FROM payroll_items WHERE payroll_run_id = $1', [id]);

    // Get all active employees for this company
    const employees = await query(
      "SELECT * FROM employees WHERE company_id = $1 AND status = 'active'",
      [run.company_id]
    );

    if (employees.length === 0) {
      return res.status(400).json({ message: 'No active employees found for this company' });
    }

    let totalBasic = 0;
    let totalAllowances = 0;
    let totalNet = 0;

    // Create a payroll item for each active employee
    for (const emp of employees) {
      const basic = parseFloat(emp.basic_salary) || 0;
      const housing = parseFloat(emp.housing_allowance) || 0;
      const transport = parseFloat(emp.transport_allowance) || 0;
      const other = parseFloat(emp.other_allowance) || 0;
      const netSalary = basic + housing + transport + other;

      await query(
        `INSERT INTO payroll_items (
          payroll_run_id, employee_id,
          basic_salary, housing_allowance, transport_allowance, other_allowance,
          overtime, deductions, net_salary, payment_mode, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, 'bank_transfer', 'pending')`,
        [id, emp.id, basic, housing, transport, other, netSalary]
      );

      totalBasic += basic;
      totalAllowances += housing + transport + other;
      totalNet += netSalary;
    }

    // Update the payroll run totals
    const updated = await queryOne(
      `UPDATE payroll_runs SET
        total_basic = $1, total_allowances = $2, total_deductions = 0,
        total_net = $3, employee_count = $4, status = 'calculated'
       WHERE id = $5 RETURNING *`,
      [totalBasic, totalAllowances, totalNet, employees.length, id]
    );

    log.info({ payrollRunId: id, employeeCount: employees.length }, 'Payroll calculated');
    res.json(updated);
  }));

  // Approve payroll run
  app.post("/api/payroll-runs/:id/approve", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const run = await queryOne('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run) {
      return res.status(404).json({ message: 'Payroll run not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (run.status === 'approved') {
      return res.status(400).json({ message: 'Payroll run is already approved' });
    }

    if (run.status === 'draft') {
      return res.status(400).json({ message: 'Please calculate payroll before approving' });
    }

    const updated = await queryOne(
      `UPDATE payroll_runs SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2 RETURNING *`,
      [userId, id]
    );

    // Mark all payroll items as paid
    await query(
      "UPDATE payroll_items SET status = 'paid' WHERE payroll_run_id = $1",
      [id]
    );

    log.info({ payrollRunId: id, approvedBy: userId }, 'Payroll run approved');
    res.json(updated);
  }));

  // =============================================
  // SIF FILE GENERATION
  // =============================================

  // Generate WPS SIF file
  app.get("/api/payroll-runs/:id/generate-sif", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const run = await queryOne('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run) {
      return res.status(404).json({ message: 'Payroll run not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get company details
    const company = await queryOne('SELECT * FROM companies WHERE id = $1', [run.company_id]);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Get payroll items
    const items = await query(
      'SELECT * FROM payroll_items WHERE payroll_run_id = $1',
      [id]
    );

    if (items.length === 0) {
      return res.status(400).json({ message: 'No payroll items found. Please calculate payroll first.' });
    }

    // Get all employees referenced in payroll items
    const employeeIds = items.map((item: any) => item.employee_id);
    const employeePlaceholders = employeeIds.map((_: any, i: number) => `$${i + 1}`).join(',');
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

    // Map payroll items to SIF format
    const sifItems = items.map((item: any) => ({
      employeeId: item.employee_id,
      basicSalary: item.basic_salary,
      housingAllowance: item.housing_allowance,
      transportAllowance: item.transport_allowance,
      otherAllowance: item.other_allowance,
      overtime: item.overtime,
      deductions: item.deductions,
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
    await query('UPDATE payroll_runs SET sif_file_content = $1 WHERE id = $2', [sifContent, id]);

    // Return as downloadable text file
    const filename = `SIF_${company.name.replace(/[^a-zA-Z0-9]/g, '_')}_${run.period_year}_${String(run.period_month).padStart(2, '0')}.SIF`;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(sifContent);
  }));

  // =============================================
  // PAYROLL ITEMS
  // =============================================

  // List payroll items for a run
  app.get("/api/payroll-runs/:id/items", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const run = await queryOne('SELECT * FROM payroll_runs WHERE id = $1', [id]);
    if (!run) {
      return res.status(404).json({ message: 'Payroll run not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, run.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
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
  }));

  // Update individual payroll item (overtime, deductions)
  app.patch("/api/payroll-items/:id", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const item = await queryOne(
      `SELECT pi.*, pr.company_id, pr.status as run_status
       FROM payroll_items pi
       JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
       WHERE pi.id = $1`,
      [id]
    );

    if (!item) {
      return res.status(404).json({ message: 'Payroll item not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, item.company_id);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (item.run_status === 'approved') {
      return res.status(400).json({ message: 'Cannot modify items in an approved payroll run' });
    }

    const overtime = req.body.overtime !== undefined ? parseFloat(req.body.overtime) : parseFloat(item.overtime);
    const deductions = req.body.deductions !== undefined ? parseFloat(req.body.deductions) : parseFloat(item.deductions);
    const deductionNotes = req.body.deductionNotes !== undefined ? req.body.deductionNotes : item.deduction_notes;

    // Recalculate net salary
    const basic = parseFloat(item.basic_salary) || 0;
    const housing = parseFloat(item.housing_allowance) || 0;
    const transport = parseFloat(item.transport_allowance) || 0;
    const other = parseFloat(item.other_allowance) || 0;
    const netSalary = basic + housing + transport + other + overtime - deductions;

    const updated = await queryOne(
      `UPDATE payroll_items
       SET overtime = $1, deductions = $2, deduction_notes = $3, net_salary = $4
       WHERE id = $5 RETURNING *`,
      [overtime, deductions, deductionNotes, netSalary, id]
    );

    // Recalculate payroll run totals
    const runTotals = await queryOne(
      `SELECT
         SUM(basic_salary) as total_basic,
         SUM(housing_allowance + transport_allowance + other_allowance + overtime) as total_allowances,
         SUM(deductions) as total_deductions,
         SUM(net_salary) as total_net,
         COUNT(*) as employee_count
       FROM payroll_items WHERE payroll_run_id = $1`,
      [item.payroll_run_id]
    );

    if (runTotals) {
      await query(
        `UPDATE payroll_runs SET
          total_basic = $1, total_allowances = $2, total_deductions = $3,
          total_net = $4, employee_count = $5
         WHERE id = $6`,
        [
          runTotals.total_basic, runTotals.total_allowances,
          runTotals.total_deductions, runTotals.total_net,
          runTotals.employee_count, item.payroll_run_id,
        ]
      );
    }

    log.info({ payrollItemId: id }, 'Payroll item updated');
    res.json(updated);
  }));

  // =============================================
  // GRATUITY CALCULATOR
  // =============================================

  // Calculate end-of-service gratuity per UAE labor law
  app.post("/api/companies/:companyId/payroll/gratuity-calculator", authMiddleware, requireCustomer, asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    const userId = (req as any).user.id;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { employeeId, terminationDate } = req.body;

    if (!employeeId) {
      return res.status(400).json({ message: 'employeeId is required' });
    }

    const employee = await queryOne('SELECT * FROM employees WHERE id = $1 AND company_id = $2', [employeeId, companyId]);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    if (!employee.join_date) {
      return res.status(400).json({ message: 'Employee join date is not set' });
    }

    const joinDate = new Date(employee.join_date);
    const endDate = terminationDate ? new Date(terminationDate) : new Date();

    // Calculate years of service
    const diffMs = endDate.getTime() - joinDate.getTime();
    const totalDays = diffMs / (1000 * 60 * 60 * 24);
    const totalYears = totalDays / 365.25;

    if (totalYears < 1) {
      return res.json({
        employeeId: employee.id,
        employeeName: employee.full_name,
        joinDate: employee.join_date,
        terminationDate: endDate.toISOString(),
        yearsOfService: Math.round(totalYears * 100) / 100,
        basicSalary: parseFloat(employee.basic_salary),
        dailyWage: 0,
        firstFiveYearsGratuity: 0,
        remainingYearsGratuity: 0,
        totalGratuity: 0,
        note: 'Employee must complete at least 1 year of service to be eligible for gratuity.',
      });
    }

    // UAE labor law gratuity calculation:
    // - First 5 years: 21 days basic salary per year
    // - After 5 years: 30 days basic salary per year
    // Daily wage = basic salary / 30
    const basicSalary = parseFloat(employee.basic_salary) || 0;
    const dailyWage = basicSalary / 30;

    const yearsFirst5 = Math.min(totalYears, 5);
    const yearsAfter5 = Math.max(0, totalYears - 5);

    const firstFiveYearsGratuity = yearsFirst5 * 21 * dailyWage;
    const remainingYearsGratuity = yearsAfter5 * 30 * dailyWage;
    const totalGratuity = firstFiveYearsGratuity + remainingYearsGratuity;

    // Total gratuity cannot exceed 2 years' total salary
    const maxGratuity = basicSalary * 24; // 2 years
    const cappedGratuity = Math.min(totalGratuity, maxGratuity);

    res.json({
      employeeId: employee.id,
      employeeName: employee.full_name,
      joinDate: employee.join_date,
      terminationDate: endDate.toISOString(),
      yearsOfService: Math.round(totalYears * 100) / 100,
      basicSalary,
      dailyWage: Math.round(dailyWage * 100) / 100,
      firstFiveYears: Math.round(yearsFirst5 * 100) / 100,
      remainingYears: Math.round(yearsAfter5 * 100) / 100,
      firstFiveYearsGratuity: Math.round(firstFiveYearsGratuity * 100) / 100,
      remainingYearsGratuity: Math.round(remainingYearsGratuity * 100) / 100,
      totalGratuity: Math.round(cappedGratuity * 100) / 100,
      uncappedGratuity: Math.round(totalGratuity * 100) / 100,
      maxGratuity: Math.round(maxGratuity * 100) / 100,
      isCapped: totalGratuity > maxGratuity,
    });
  }));
}
