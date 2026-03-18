/**
 * WPS SIF File Generator
 * ──────────────────────
 * Generates UAE Central Bank Salary Information File (SIF)
 * for Wage Protection System (WPS) compliance.
 *
 * SIF Format:
 *   - SCR (Salary Control Record): Header with employer details
 *   - EDR (Employee Detail Record): One per employee with salary details
 *
 * Reference: UAE Central Bank WPS guidelines
 */

interface SIFCompany {
  name: string;
  registrationNumber?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  routingCode?: string | null;
}

interface SIFPayrollRun {
  id: string;
  periodMonth: number;
  periodYear: number;
  totalBasic: string | number;
  totalAllowances: string | number;
  totalDeductions: string | number;
  totalNet: string | number;
  employeeCount: number;
}

interface SIFEmployee {
  employeeNumber?: string | null;
  fullName: string;
  laborCardNumber?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  iban?: string | null;
  routingCode?: string | null;
}

interface SIFPayrollItem {
  employeeId: string;
  basicSalary: string | number;
  housingAllowance: string | number;
  transportAllowance: string | number;
  otherAllowance: string | number;
  overtime: string | number;
  deductions: string | number;
  netSalary: string | number;
  paymentMode: string;
}

/**
 * Pad a string to a fixed length, right-padded with spaces.
 */
function padRight(str: string, length: number): string {
  return (str || '').substring(0, length).padEnd(length, ' ');
}

/**
 * Pad a string to a fixed length, left-padded with zeros.
 */
function padLeft(str: string, length: number): string {
  return (str || '').substring(0, length).padStart(length, '0');
}

/**
 * Format an amount to 15-char fixed width with 2 decimal places (no decimal point).
 * Example: 5000.50 => "000000000500050"
 */
function formatAmount(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  const cents = Math.round((num || 0) * 100);
  return cents.toString().padStart(15, '0');
}

/**
 * Get the salary start date for a period (first day of month).
 */
function getSalaryStartDate(month: number, year: number): string {
  const m = month.toString().padStart(2, '0');
  return `${year}${m}01`;
}

/**
 * Get the salary end date for a period (last day of month).
 */
function getSalaryEndDate(month: number, year: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  const m = month.toString().padStart(2, '0');
  return `${year}${m}${lastDay.toString().padStart(2, '0')}`;
}

/**
 * Generate the complete SIF file content.
 *
 * @param company - Company details for the SCR header
 * @param payrollRun - Payroll run summary
 * @param payrollItems - Individual employee pay items
 * @param employees - Employee lookup (keyed by employee id)
 * @returns The full SIF file content as a string
 */
export function generateSIFFile(
  company: SIFCompany,
  payrollRun: SIFPayrollRun,
  payrollItems: SIFPayrollItem[],
  employees: Map<string, SIFEmployee>
): string {
  const lines: string[] = [];

  const salaryStart = getSalaryStartDate(payrollRun.periodMonth, payrollRun.periodYear);
  const salaryEnd = getSalaryEndDate(payrollRun.periodMonth, payrollRun.periodYear);
  const fileCreationDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const fileCreationTime = new Date().toISOString().slice(11, 19).replace(/:/g, '');

  // ── SCR (Salary Control Record) ─────────────────────────
  // Fixed-width header line with employer details
  const scrFields = [
    'SCR',                                                    // Record type (3)
    padRight(company.registrationNumber || '', 15),           // Employer reference / MOL establishment ID (15)
    padRight(company.routingCode || '', 9),                   // Employer bank routing code (9)
    padRight(company.bankAccountNumber || '', 34),            // Employer bank account/IBAN (34)
    salaryStart,                                              // Salary start date YYYYMMDD (8)
    salaryEnd,                                                // Salary end date YYYYMMDD (8)
    fileCreationDate,                                         // File creation date YYYYMMDD (8)
    fileCreationTime,                                         // File creation time HHMMSS (6)
    padLeft(payrollRun.employeeCount.toString(), 6),          // Total employee records (6)
    formatAmount(payrollRun.totalNet),                        // Total salary amount (15)
    padRight('AED', 3),                                       // Currency code (3)
    padRight(company.name, 50),                               // Employer name (50)
  ];
  lines.push(scrFields.join(''));

  // ── EDR (Employee Detail Records) ───────────────────────
  for (const item of payrollItems) {
    const employee = employees.get(item.employeeId);
    if (!employee) continue;

    const totalAllowances =
      (parseFloat(String(item.housingAllowance)) || 0) +
      (parseFloat(String(item.transportAllowance)) || 0) +
      (parseFloat(String(item.otherAllowance)) || 0) +
      (parseFloat(String(item.overtime)) || 0);

    const edrFields = [
      'EDR',                                                  // Record type (3)
      padRight(employee.laborCardNumber || '', 15),           // Labour card number (15)
      padRight(employee.routingCode || '', 9),                // Employee bank routing code (9)
      padRight(employee.iban || employee.bankAccountNumber || '', 34), // Employee IBAN/account (34)
      salaryStart,                                            // Salary period start YYYYMMDD (8)
      salaryEnd,                                              // Salary period end YYYYMMDD (8)
      padLeft(getDaysInMonth(payrollRun.periodMonth, payrollRun.periodYear).toString(), 4), // Number of days (4)
      formatAmount(item.basicSalary),                         // Fixed/basic salary (15)
      formatAmount(totalAllowances),                          // Total variable pay / allowances (15)
      formatAmount(0),                                        // Leave days (15) — placeholder
      formatAmount(item.deductions),                          // Deductions (15)
      formatAmount(item.netSalary),                           // Net salary (15)
      padRight('AED', 3),                                     // Currency code (3)
      padRight(employee.fullName, 50),                        // Employee name (50)
      padRight(employee.employeeNumber || '', 20),            // Employee reference (20)
    ];
    lines.push(edrFields.join(''));
  }

  return lines.join('\r\n');
}

/**
 * Number of days in a given month/year.
 */
function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}
