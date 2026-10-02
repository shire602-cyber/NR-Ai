/**
 * WPS SIF file (UAE Wage Protection System, MOHRE / Central Bank).
 *
 * The Salary Information File is plain CSV, one record per line, with NO header line:
 *
 *   EDR  (Employee Detail Record), one per employee
 *     EDR, employee MOHRE person ID (14 digits), employee bank routing code, employee IBAN / account,
 *     pay start date, pay end date, days in the pay period, fixed income, variable income, days on leave
 *   SCR  (Salary Control Record), exactly one, LAST
 *     SCR, employer MOHRE establishment ID, employer bank routing code, file creation date, file creation time,
 *     salary month (MMYYYY), number of EDR records, total salary, payment currency (AED), reference
 *
 * Dates are YYYY-MM-DD, the time is HHMM, amounts have two decimals and no thousands separator. The fixed and variable
 * income of an employee add up to what is transferred to them (the net pay): deductions are not a column of the SIF.
 *
 * Not verified against the current MOHRE/CBUAE document (none is available offline): the exact field widths, the
 * file-name convention and whether a routing code must be 9 digits are taken from the specification as commonly
 * published; the bank may still reject a file for a rule not encoded here.
 */

export interface SifCompany {
  /** MOHRE establishment (employer) ID. */
  mohreEstablishmentId?: string | null;
  /** The employer's bank routing code. */
  routingCode?: string | null;
  /** Free-text reference for the SCR (optional). */
  reference?: string | null;
}

export interface SifRun {
  periodMonth: number;
  periodYear: number;
}

export interface SifItem {
  employeeId: string;
  /** Net pay (what is transferred). */
  netSalary: number | string;
  /** The part of the net that is variable pay (overtime): reported as variable income, the rest as fixed. */
  overtime: number | string;
  /** Days paid on the 30-day basis for a part month; null/undefined = the whole month. */
  daysWorked?: number | string | null;
  /** Days of leave that cost pay (unpaid and half-pay days). */
  leaveDays?: number | string | null;
}

export interface SifEmployee {
  fullName: string;
  /** 14-digit MOHRE person ID. */
  molPersonId?: string | null;
  routingCode?: string | null;
  iban?: string | null;
  bankAccountNumber?: string | null;
  /** YYYY-MM-DD: a joiner's pay starts here (in the joining month). */
  joinYmd?: string | null;
  /** YYYY-MM-DD: a leaver's pay ends here (in the leaving month). */
  terminationYmd?: string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (v: number): string => (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const clean = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, "");

export interface SifProblem {
  scope: "company" | "employee";
  employeeId?: string;
  employeeName?: string;
  field: "mohreEstablishmentId" | "routingCode" | "molPersonId" | "iban";
  message: string;
}

/** Every identifier the file cannot be produced without; an empty list means the file can be generated. */
export function sifProblems(company: SifCompany, items: SifItem[], employees: Map<string, SifEmployee>): SifProblem[] {
  const problems: SifProblem[] = [];
  if (!clean(company.mohreEstablishmentId)) {
    problems.push({ scope: "company", field: "mohreEstablishmentId", message: "The company's MOHRE establishment ID is missing." });
  }
  if (!clean(company.routingCode)) {
    problems.push({ scope: "company", field: "routingCode", message: "The company's bank routing code is missing." });
  }
  for (const item of items) {
    const e = employees.get(item.employeeId);
    if (!e) continue;
    const base = { scope: "employee" as const, employeeId: item.employeeId, employeeName: e.fullName };
    if (!/^\d{14}$/.test(clean(e.molPersonId))) {
      problems.push({ ...base, field: "molPersonId", message: `${e.fullName}: the 14-digit MOHRE person ID is missing or not 14 digits.` });
    }
    if (!clean(e.routingCode)) {
      problems.push({ ...base, field: "routingCode", message: `${e.fullName}: the bank routing code is missing.` });
    }
    if (!clean(e.iban) && !clean(e.bankAccountNumber)) {
      problems.push({ ...base, field: "iban", message: `${e.fullName}: the IBAN or account number is missing.` });
    }
  }
  return problems;
}

/** The EDR line of one employee. */
export function edrLine(run: SifRun, item: SifItem, e: SifEmployee): string {
  const periodStart = `${run.periodYear}-${pad(run.periodMonth)}-01`;
  const periodEnd = `${run.periodYear}-${pad(run.periodMonth)}-${pad(lastDay(run.periodYear, run.periodMonth))}`;
  const daysInMonth = lastDay(run.periodYear, run.periodMonth);

  const joinedInPeriod = !!e.joinYmd && e.joinYmd > periodStart && e.joinYmd <= periodEnd;
  const leftInPeriod = !!e.terminationYmd && e.terminationYmd >= periodStart && e.terminationYmd < periodEnd;
  const start = joinedInPeriod ? e.joinYmd! : periodStart;
  const end = leftInPeriod ? e.terminationYmd! : periodEnd;
  // A full month reports the calendar days; a part month reports the days paid (30-day basis), the same figure the pay used.
  const partMonth = item.daysWorked !== null && item.daysWorked !== undefined && num(item.daysWorked) > 0 && num(item.daysWorked) < 30;
  const days = partMonth ? Math.round(num(item.daysWorked)) : daysInMonth;

  const net = num(item.netSalary);
  const variable = Math.min(Math.max(0, num(item.overtime)), Math.max(0, net));
  const fixed = net - variable;

  return [
    "EDR",
    clean(e.molPersonId),
    clean(e.routingCode),
    clean(e.iban) || clean(e.bankAccountNumber),
    start,
    end,
    String(days),
    money(fixed),
    money(variable),
    String(Math.round(num(item.leaveDays))),
  ].join(",");
}

export interface SifFileInput {
  company: SifCompany;
  run: SifRun;
  items: SifItem[];
  employees: Map<string, SifEmployee>;
  /** For the creation date and time; defaults to now. */
  now?: Date;
}

/** The whole file: one EDR per employee, then one SCR. Check sifProblems() first. */
export function generateSIFFile(input: SifFileInput): string {
  const now = input.now ?? new Date();
  const edrs: string[] = [];
  let total = 0;
  for (const item of input.items) {
    const e = input.employees.get(item.employeeId);
    if (!e) continue;
    edrs.push(edrLine(input.run, item, e));
    total += num(item.netSalary);
  }
  const scr = [
    "SCR",
    clean(input.company.mohreEstablishmentId),
    clean(input.company.routingCode),
    now.toISOString().slice(0, 10),
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`,
    `${pad(input.run.periodMonth)}${input.run.periodYear}`,
    String(edrs.length),
    money(total),
    "AED",
    (input.company.reference ?? "").trim(),
  ].join(",");
  return [...edrs, scr].join("\r\n");
}
