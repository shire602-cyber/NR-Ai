/**
 * UAE WPS Salary Information File (SIF) — R09-03, R09-04, R09-18.
 * ─────────────────────────────────────────────────────────────────
 * The Central Bank of the UAE Wage Protection System SIF is a comma-separated
 * text file: one EDR (Employee Detail Record) per employee followed by one SCR
 * (Salary Control Record).
 *
 *   EDR,<employee MOHRE person id: 14 digits>,<agent/bank routing code: 9 digits>,
 *       <employee IBAN>,<pay start YYYY-MM-DD>,<pay end YYYY-MM-DD>,<days in period>,
 *       <income fixed component>,<income variable component>,<days on leave>
 *   SCR,<employer MOHRE establishment id: 13 digits>,<employer bank routing code: 9 digits>,
 *       <file creation date YYYY-MM-DD>,<file creation time HHMM>,<salary month MMYYYY>,
 *       <EDR count>,<total salary>,AED[,<employer reference>]
 *
 * File name: <13-digit employer id><YYMMDDHHMMSS>.SIF.
 *
 * Amounts are AED with two decimals and no thousands separators. The fixed
 * component is the net salary less the variable component; the variable
 * component is overtime/variable pay (capped at the net amount), so
 * fixed + variable = the amount transferred. Lines end with CRLF.
 *
 * EXTERNAL BOUNDARY: this module produces and validates the file. Submitting
 * it to the employer's bank or exchange house (the WPS agent) happens outside
 * Muhasib.ai; individual agents publish their own variants (header rows,
 * card-account formats) that must be confirmed with the agent. Nothing here
 * marks salaries as submitted or paid.
 */
import { DomainError } from "../errors";
import { ibanMod97Valid } from "../../shared/validators/primitives";
import { fromFils, toFils } from "../../shared/money";

export interface SifEmployeeLine {
  employeeId: string;
  employeeName: string;
  molPersonId: string | null | undefined;
  routingCode: string | null | undefined;
  iban: string | null | undefined;
  /** Net amount transferred (AED fils). */
  netFils: number;
  /** Variable component (overtime etc., AED fils). */
  variableFils: number;
  /** Days on unpaid leave in the period (paid annual leave is not reported). */
  leaveDays: number;
}

export interface SifInput {
  employer: {
    name: string;
    molEstablishmentId: string | null | undefined;
    routingCode: string | null | undefined;
    reference?: string | null;
  };
  periodMonth: number;
  periodYear: number;
  lines: SifEmployeeLine[];
  createdAt: Date;
}

export interface SifIssue {
  scope: "employer" | "employee";
  employeeId?: string;
  employeeName?: string;
  field: string;
  message: string;
}

export interface SifFile {
  content: string;
  fileName: string;
  edrCount: number;
  totalFils: number;
}

const EOL = "\r\n";
const RE = {
  person: /^\d{14}$/,
  establishment: /^\d{13}$/,
  routing: /^\d{9}$/,
  iban: /^AE\d{21}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^([01]\d|2[0-3])[0-5]\d$/,
  month: /^(0[1-9]|1[0-2])\d{4}$/,
  amount: /^\d{1,13}\.\d{2}$/,
  int: /^\d{1,3}$/,
};

const clean = (v: string | null | undefined) => (v ?? "").replace(/[\s-]/g, "").toUpperCase();
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Pre-validation report (R09-04): every blank or malformed identifier, per employee. */
export function prevalidateSif(input: SifInput): SifIssue[] {
  const issues: SifIssue[] = [];
  const est = clean(input.employer.molEstablishmentId);
  if (!est) {
    issues.push({
      scope: "employer",
      field: "mohreEstablishmentId",
      message: "Employer MOHRE establishment id is not set (Company settings → WPS)",
    });
  } else if (!RE.establishment.test(est)) {
    issues.push({
      scope: "employer",
      field: "mohreEstablishmentId",
      message: "Employer MOHRE establishment id must be 13 digits",
    });
  }
  const routing = clean(input.employer.routingCode);
  if (!routing) {
    issues.push({
      scope: "employer",
      field: "wpsEmployerRoutingCode",
      message: "Employer bank routing code is not set (Company settings → WPS)",
    });
  } else if (!RE.routing.test(routing)) {
    issues.push({
      scope: "employer",
      field: "wpsEmployerRoutingCode",
      message: "Employer bank routing code must be 9 digits",
    });
  }
  if (input.lines.length === 0) {
    issues.push({ scope: "employer", field: "lines", message: "The run has no employees" });
  }
  for (const line of input.lines) {
    const who = {
      scope: "employee" as const,
      employeeId: line.employeeId,
      employeeName: line.employeeName,
    };
    const person = clean(line.molPersonId);
    if (!person) issues.push({ ...who, field: "molPersonId", message: "MOL person id is blank" });
    else if (!RE.person.test(person))
      issues.push({ ...who, field: "molPersonId", message: "MOL person id must be 14 digits" });
    const r = clean(line.routingCode);
    if (!r) issues.push({ ...who, field: "routingCode", message: "Bank routing code is blank" });
    else if (!RE.routing.test(r))
      issues.push({ ...who, field: "routingCode", message: "Bank routing code must be 9 digits" });
    const iban = clean(line.iban);
    if (!iban) issues.push({ ...who, field: "iban", message: "IBAN is blank" });
    else if (!RE.iban.test(iban) || !ibanMod97Valid(iban))
      issues.push({ ...who, field: "iban", message: "IBAN is not a valid UAE IBAN" });
    if (!(line.netFils > 0))
      issues.push({ ...who, field: "netSalary", message: "Net salary must be greater than zero" });
  }
  return issues;
}

/** Build the SIF. Throws 422 SIF_PREVALIDATION_FAILED with the issue list when anything is missing. */
export function buildSif(input: SifInput): SifFile {
  const issues = prevalidateSif(input);
  if (issues.length) {
    throw new DomainError(
      "SIF_PREVALIDATION_FAILED",
      422,
      { issues },
      `The SIF cannot be generated: ${issues.length} problem(s) must be fixed first`
    );
  }
  const { start, end, days } = monthBounds(input.periodMonth, input.periodYear);
  const lines: string[] = [];
  let totalFils = 0;
  for (const l of input.lines) {
    const variable = Math.max(0, Math.min(l.variableFils, l.netFils));
    const fixed = l.netFils - variable;
    totalFils += l.netFils;
    lines.push(
      [
        "EDR",
        clean(l.molPersonId),
        clean(l.routingCode),
        clean(l.iban),
        start,
        end,
        String(days),
        fromFils(fixed),
        fromFils(variable),
        String(Math.max(0, Math.round(l.leaveDays))),
      ].join(",")
    );
  }
  const c = input.createdAt;
  const date = `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
  const time = `${pad(c.getUTCHours())}${pad(c.getUTCMinutes())}`;
  const est = clean(input.employer.molEstablishmentId);
  const reference = (input.employer.reference ?? "")
    .replace(/[,\r\n]/g, " ")
    .trim()
    .slice(0, 35);
  const scr = [
    "SCR",
    est,
    clean(input.employer.routingCode),
    date,
    time,
    `${pad(input.periodMonth)}${input.periodYear}`,
    String(input.lines.length),
    fromFils(totalFils),
    "AED",
  ];
  if (reference) scr.push(reference);
  lines.push(scr.join(","));
  const stamp =
    `${pad(c.getUTCFullYear() % 100)}${pad(c.getUTCMonth() + 1)}${pad(c.getUTCDate())}` +
    `${pad(c.getUTCHours())}${pad(c.getUTCMinutes())}${pad(c.getUTCSeconds())}`;
  return {
    content: lines.join(EOL) + EOL,
    fileName: `${est}${stamp}.SIF`,
    edrCount: input.lines.length,
    totalFils,
  };
}

function monthBounds(month: number, year: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(last)}`,
    days: last,
  };
}

// ─── Parser / validator ──────────────────────────────────────────────────────

export interface ParsedEdr {
  line: number;
  personId: string;
  routingCode: string;
  iban: string;
  payStart: string;
  payEnd: string;
  daysInPeriod: number;
  fixedFils: number;
  variableFils: number;
  leaveDays: number;
}

export interface ParsedScr {
  line: number;
  establishmentId: string;
  routingCode: string;
  creationDate: string;
  creationTime: string;
  salaryMonth: string;
  edrCount: number;
  totalFils: number;
  currency: string;
  reference: string | null;
}

export interface SifValidationResult {
  valid: boolean;
  edrs: ParsedEdr[];
  scr: ParsedScr | null;
  errors: Array<{ line: number; field: string; message: string }>;
}

function realDate(s: string): boolean {
  if (!RE.date.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Parse a SIF back field by field and check it (validator endpoint + golden test). */
export function parseSif(content: string): SifValidationResult {
  const errors: SifValidationResult["errors"] = [];
  const edrs: ParsedEdr[] = [];
  let scr: ParsedScr | null = null;
  const rows = content.split(/\r?\n/);
  const err = (line: number, field: string, message: string) =>
    errors.push({ line, field, message });
  const money = (line: number, field: string, v: string): number => {
    if (!RE.amount.test(v)) {
      err(line, field, `${field} must be a decimal with 2 places`);
      return 0;
    }
    return toFils(v);
  };

  rows.forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === "") return;
    const f = raw.split(",").map((x) => x.trim());
    if (f[0] === "EDR") {
      if (scr) err(line, "recordType", "EDR after the SCR record");
      if (f.length !== 10) {
        err(line, "fieldCount", `EDR must have 10 fields, found ${f.length}`);
        return;
      }
      if (!RE.person.test(f[1])) err(line, "personId", "Employee person id must be 14 digits");
      if (!RE.routing.test(f[2])) err(line, "routingCode", "Routing code must be 9 digits");
      if (!RE.iban.test(f[3]) || !ibanMod97Valid(f[3])) err(line, "iban", "IBAN is invalid");
      if (!realDate(f[4])) err(line, "payStart", "Pay start must be YYYY-MM-DD");
      if (!realDate(f[5])) err(line, "payEnd", "Pay end must be YYYY-MM-DD");
      if (realDate(f[4]) && realDate(f[5]) && f[5] < f[4])
        err(line, "payEnd", "Pay end before start");
      if (!RE.int.test(f[6])) err(line, "daysInPeriod", "Days in period must be a number");
      if (!RE.int.test(f[9])) err(line, "leaveDays", "Days on leave must be a number");
      edrs.push({
        line,
        personId: f[1],
        routingCode: f[2],
        iban: f[3],
        payStart: f[4],
        payEnd: f[5],
        daysInPeriod: Number(f[6]),
        fixedFils: money(line, "fixed", f[7]),
        variableFils: money(line, "variable", f[8]),
        leaveDays: Number(f[9]),
      });
    } else if (f[0] === "SCR") {
      if (scr) err(line, "recordType", "More than one SCR record");
      if (f.length !== 9 && f.length !== 10) {
        err(line, "fieldCount", `SCR must have 9 or 10 fields, found ${f.length}`);
        return;
      }
      if (!RE.establishment.test(f[1]))
        err(line, "establishmentId", "Employer establishment id must be 13 digits");
      if (!RE.routing.test(f[2])) err(line, "routingCode", "Routing code must be 9 digits");
      if (!realDate(f[3])) err(line, "creationDate", "File creation date must be YYYY-MM-DD");
      if (!RE.time.test(f[4])) err(line, "creationTime", "File creation time must be HHMM");
      if (!RE.month.test(f[5])) err(line, "salaryMonth", "Salary month must be MMYYYY");
      if (!/^\d{1,6}$/.test(f[6])) err(line, "edrCount", "EDR count must be a number");
      if (f[8] !== "AED") err(line, "currency", "Currency must be AED");
      scr = {
        line,
        establishmentId: f[1],
        routingCode: f[2],
        creationDate: f[3],
        creationTime: f[4],
        salaryMonth: f[5],
        edrCount: Number(f[6]),
        totalFils: money(line, "totalSalary", f[7]),
        currency: f[8],
        reference: f[9] ?? null,
      };
    } else {
      err(line, "recordType", `Unknown record type "${f[0]}"`);
    }
  });

  const finalScr = scr as ParsedScr | null;
  if (!finalScr) {
    errors.push({ line: 0, field: "scr", message: "The file has no SCR record" });
  } else {
    if (finalScr.edrCount !== edrs.length) {
      err(finalScr.line, "edrCount", `SCR says ${finalScr.edrCount} EDRs, file has ${edrs.length}`);
    }
    const sum = edrs.reduce((a, e) => a + e.fixedFils + e.variableFils, 0);
    if (sum !== finalScr.totalFils) {
      err(
        finalScr.line,
        "totalSalary",
        `SCR total ${fromFils(finalScr.totalFils)} != EDR sum ${fromFils(sum)}`
      );
    }
  }
  if (edrs.length === 0)
    errors.push({ line: 0, field: "edr", message: "The file has no EDR records" });
  return { valid: errors.length === 0, edrs, scr: finalScr, errors };
}
