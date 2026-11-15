/**
 * Payslips (R09-16): bilingual PDF (server/services/pdf-fonts.ts), email via
 * the existing email service with an honest per-employee result, and an
 * employee self-service read link (random token, stored as a SHA-256 hash,
 * 90-day expiry).
 */
import crypto from "node:crypto";
// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";
import { DomainError } from "../../errors";
import { getEnv } from "../../config/env";
import { escapeHtml, sendEmail } from "../email.service";
import { bilingual, pdfLocale, preparePdfDocument } from "../pdf-fonts";
import { fromFils } from "../../../shared/money";
import { dayOf, fils, num, q, q1, type Row } from "./sql";

const TOKEN_TTL_DAYS = 90;

export interface PayslipData {
  company: { id: string; name: string; locale: string | null };
  run: { id: string; periodMonth: number; periodYear: number; status: string };
  employee: {
    id: string;
    name: string;
    nameAr: string | null;
    employeeNumber: string | null;
    designation: string | null;
    department: string | null;
    iban: string | null;
  };
  lines: {
    basic: string;
    housing: string;
    transport: string;
    other: string;
    overtime: string;
    unpaidLeaveDeduction: string;
    unpaidLeaveDays: number;
    paidLeaveDays: number;
    pensionEmployee: string;
    deductions: string;
    deductionNotes: string | null;
    gross: string;
    net: string;
    currency: string;
    exchangeRate: string;
    netForeign: string | null;
  };
}

const PAYSLIP_RUN_STATES = new Set(["approved", "paid"]);

export async function loadPayslip(itemId: string, companyId?: string): Promise<PayslipData> {
  const row = await q1<Row>(
    `SELECT pi.*, pr.company_id, pr.period_month, pr.period_year, pr.status AS run_status,
            e.full_name, e.full_name_ar, e.employee_number, e.designation, e.department AS emp_department,
            e.iban, c.name AS company_name, c.locale AS company_locale
       FROM payroll_items pi
       JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
       JOIN employees e ON e.id = pi.employee_id
       JOIN companies c ON c.id = pr.company_id
      WHERE pi.id = $1 ${companyId ? "AND pr.company_id = $2" : ""}`,
    companyId ? [itemId, companyId] : [itemId]
  );
  if (!row) throw new DomainError("PAYSLIP_NOT_FOUND", 404, undefined, "Payslip not found");
  if (!PAYSLIP_RUN_STATES.has(String(row.run_status))) {
    throw new DomainError(
      "PAYSLIP_NOT_READY",
      409,
      { status: row.run_status },
      "Payslips are available once the payroll run is approved"
    );
  }
  const gross =
    fils(row.basic_salary) +
    fils(row.housing_allowance) +
    fils(row.transport_allowance) +
    fils(row.other_allowance) +
    fils(row.overtime) -
    fils(row.unpaid_leave_deduction);
  const iban = row.iban ? String(row.iban) : null;
  return {
    company: {
      id: String(row.company_id),
      name: String(row.company_name),
      locale: (row.company_locale as string) ?? null,
    },
    run: {
      id: String(row.payroll_run_id),
      periodMonth: Number(row.period_month),
      periodYear: Number(row.period_year),
      status: String(row.run_status),
    },
    employee: {
      id: String(row.employee_id),
      name: String(row.full_name),
      nameAr: (row.full_name_ar as string) ?? null,
      employeeNumber: (row.employee_number as string) ?? null,
      designation: (row.designation as string) ?? null,
      department: ((row.department ?? row.emp_department) as string) ?? null,
      // Mask the IBAN on the payslip: only the last 4 digits are shown.
      iban: iban ? `${iban.slice(0, 4)}…${iban.slice(-4)}` : null,
    },
    lines: {
      basic: fromFils(fils(row.basic_salary)),
      housing: fromFils(fils(row.housing_allowance)),
      transport: fromFils(fils(row.transport_allowance)),
      other: fromFils(fils(row.other_allowance)),
      overtime: fromFils(fils(row.overtime)),
      unpaidLeaveDeduction: fromFils(fils(row.unpaid_leave_deduction)),
      unpaidLeaveDays: num(row.unpaid_leave_days),
      paidLeaveDays: num(row.paid_leave_days),
      pensionEmployee: fromFils(fils(row.pension_employee)),
      deductions: fromFils(fils(row.deductions)),
      deductionNotes: (row.deduction_notes as string) ?? null,
      gross: fromFils(gross),
      net: fromFils(fils(row.net_salary)),
      currency: String(row.salary_currency ?? "AED"),
      exchangeRate: String(row.exchange_rate ?? "1"),
      netForeign:
        row.net_salary_foreign === null || row.net_salary_foreign === undefined
          ? null
          : fromFils(fils(row.net_salary_foreign)),
    },
  };
}

export async function renderPayslipPdf(p: PayslipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Payslip ${p.employee.name} ${p.run.periodMonth}/${p.run.periodYear}`,
          Author: p.company.name,
        },
      });
      preparePdfDocument(doc);
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const L = (en: string, ar: string) => bilingual(pdfLocale(p.company), en, ar);
      const period = `${String(p.run.periodMonth).padStart(2, "0")}/${p.run.periodYear}`;
      const width = 495;

      doc.rect(0, 0, 595.28, 90).fill("#1E3A8A");
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(p.company.name, 50, 28, { width: 300 });
      doc.fontSize(14).text(L("PAYSLIP", "قسيمة الراتب"), 50, 32, { width, align: "right" });
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(`${L("Period", "الفترة")}: ${period}`, 50, 56, { width, align: "right" });

      let y = 110;
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11);
      doc.text(
        p.employee.nameAr ? `${p.employee.name} / ${p.employee.nameAr}` : p.employee.name,
        50,
        y,
        { width }
      );
      y += 18;
      doc.font("Helvetica").fontSize(9).fillColor("#374151");
      const meta = [
        p.employee.employeeNumber
          ? `${L("Employee no.", "رقم الموظف")}: ${p.employee.employeeNumber}`
          : null,
        p.employee.designation
          ? `${L("Designation", "المسمى الوظيفي")}: ${p.employee.designation}`
          : null,
        p.employee.department ? `${L("Department", "القسم")}: ${p.employee.department}` : null,
        p.employee.iban ? `IBAN: ${p.employee.iban}` : null,
      ].filter(Boolean) as string[];
      for (const m of meta) {
        doc.text(m, 50, y, { width });
        y += 14;
      }

      const row = (label: string, value: string, bold = false) => {
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(10)
          .fillColor("#111827");
        doc.text(label, 50, y, { width: 330 });
        doc.text(value, 380, y, { width: 165, align: "right" });
        y += 18;
      };
      const cur = "AED";
      y += 12;
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#1E3A8A")
        .text(L("Earnings", "الاستحقاقات"), 50, y);
      y += 20;
      row(L("Basic salary", "الراتب الأساسي"), `${cur} ${p.lines.basic}`);
      row(L("Housing allowance", "بدل السكن"), `${cur} ${p.lines.housing}`);
      row(L("Transport allowance", "بدل المواصلات"), `${cur} ${p.lines.transport}`);
      row(L("Other allowances", "بدلات أخرى"), `${cur} ${p.lines.other}`);
      row(L("Overtime", "العمل الإضافي"), `${cur} ${p.lines.overtime}`);
      if (Number(p.lines.unpaidLeaveDeduction) > 0) {
        row(
          `${L("Unpaid leave", "إجازة بدون راتب")} (${p.lines.unpaidLeaveDays})`,
          `- ${cur} ${p.lines.unpaidLeaveDeduction}`
        );
      }
      row(L("Gross pay", "إجمالي الراتب"), `${cur} ${p.lines.gross}`, true);
      y += 8;
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#1E3A8A")
        .text(L("Deductions", "الاستقطاعات"), 50, y);
      y += 20;
      row(
        L("Pension (GPSSA) employee share", "حصة الموظف في المعاش"),
        `${cur} ${p.lines.pensionEmployee}`
      );
      row(
        p.lines.deductionNotes
          ? `${L("Other deductions", "استقطاعات أخرى")} — ${p.lines.deductionNotes}`
          : L("Other deductions", "استقطاعات أخرى"),
        `${cur} ${p.lines.deductions}`
      );
      y += 8;
      doc.rect(50, y - 4, width, 26).fill("#EEF2FF");
      row(L("Net pay", "صافي الراتب"), `${cur} ${p.lines.net}`, true);
      if (p.lines.netForeign && p.lines.currency !== "AED") {
        row(
          `${L("Contract currency", "عملة العقد")} ${p.lines.currency} @ ${p.lines.exchangeRate}`,
          `${p.lines.currency} ${p.lines.netForeign}`
        );
      }
      if (p.lines.paidLeaveDays > 0)
        row(L("Paid leave days", "أيام الإجازة المدفوعة"), String(p.lines.paidLeaveDays));
      y += 20;
      doc.font("Helvetica").fontSize(8).fillColor("#6B7280");
      doc.text(
        L(
          "This payslip is generated from the approved payroll run. Salary transfer is made through the employer's WPS agent.",
          "صدرت هذه القسيمة من مسير الرواتب المعتمد. يتم تحويل الراتب عبر وكيل نظام حماية الأجور لدى صاحب العمل."
        ),
        50,
        y,
        { width }
      );
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Self-service tokens ─────────────────────────────────────────────────────

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function createPayslipToken(
  companyId: string,
  itemId: string,
  actorId: string | null
): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000);
  await q(
    `INSERT INTO payslip_tokens (company_id, payroll_item_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [companyId, itemId, hash(token), expires, actorId]
  );
  return { token, expiresAt: expires.toISOString() };
}

export async function resolvePayslipToken(
  token: string
): Promise<{ itemId: string; companyId: string }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    throw new DomainError("PAYSLIP_NOT_FOUND", 404, undefined, "Payslip not found");
  }
  const row = await q1<{ payroll_item_id: string; company_id: string; expires_at: Date }>(
    `UPDATE payslip_tokens SET last_viewed_at = NOW()
      WHERE token_hash = $1 AND expires_at > NOW()
      RETURNING payroll_item_id, company_id, expires_at`,
    [hash(token)]
  );
  if (!row)
    throw new DomainError(
      "PAYSLIP_NOT_FOUND",
      404,
      undefined,
      "Payslip link is invalid or expired"
    );
  return { itemId: row.payroll_item_id, companyId: row.company_id };
}

export function payslipLink(token: string): string {
  const env = getEnv();
  const base = (env.FRONTEND_URL ?? env.AUTH_PUBLIC_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/payslips/${token}/pdf`;
}

export interface PayslipEmailResult {
  itemId: string;
  employeeId: string;
  employeeName: string;
  email: string | null;
  sent: boolean;
  error?: string;
}

/** Email each employee a self-service link. `sent` is true only when the provider accepted it. */
export async function emailPayslips(
  companyId: string,
  runId: string,
  actorId: string,
  itemIds?: string[]
): Promise<PayslipEmailResult[]> {
  const items = await q<{
    id: string;
    employee_id: string;
    full_name: string;
    email: string | null;
    period_month: number;
    period_year: number;
    company_name: string;
  }>(
    `SELECT pi.id, pi.employee_id, e.full_name, e.email, pr.period_month, pr.period_year, c.name AS company_name
       FROM payroll_items pi
       JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
       JOIN employees e ON e.id = pi.employee_id
       JOIN companies c ON c.id = pr.company_id
      WHERE pr.id = $1 AND pr.company_id = $2 AND pr.status IN ('approved', 'paid')
        ${itemIds?.length ? "AND pi.id = ANY($3::uuid[])" : ""}
      ORDER BY e.full_name`,
    itemIds?.length ? [runId, companyId, itemIds] : [runId, companyId]
  );
  const results: PayslipEmailResult[] = [];
  for (const it of items) {
    if (!it.email) {
      results.push({
        itemId: it.id,
        employeeId: it.employee_id,
        employeeName: it.full_name,
        email: null,
        sent: false,
        error: "Employee has no email address",
      });
      continue;
    }
    const { token } = await createPayslipToken(companyId, it.id, actorId);
    const link = payslipLink(token);
    const period = `${String(it.period_month).padStart(2, "0")}/${it.period_year}`;
    const subject = `Payslip ${period} - ${it.company_name}`;
    const body = `Dear ${it.full_name},\n\nYour payslip for ${period} is available at:\n${link}\n\nThe link expires in ${TOKEN_TTL_DAYS} days.\n\n${it.company_name}`;
    const html = `<p>Dear ${escapeHtml(it.full_name)},</p><p>Your payslip for ${escapeHtml(period)} is available here: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>The link expires in ${TOKEN_TTL_DAYS} days.</p><p dir="rtl">قسيمة راتبك للفترة ${escapeHtml(period)} متاحة على الرابط أعلاه.</p><p>${escapeHtml(it.company_name)}</p>`;
    const r = await sendEmail(it.email, subject, body, { fromName: it.company_name, html });
    if (r.sent)
      await q(`UPDATE payroll_items SET payslip_emailed_at = NOW() WHERE id = $1`, [it.id]);
    results.push({
      itemId: it.id,
      employeeId: it.employee_id,
      employeeName: it.full_name,
      email: it.email,
      sent: r.sent,
      ...(r.sent ? {} : { error: r.error ?? "Email was not sent" }),
    });
  }
  return results;
}

/** For the payslips list in the UI. */
export async function listPayslips(companyId: string, runId: string) {
  return q(
    `SELECT pi.id, pi.employee_id, e.full_name AS employee_name, e.email, pi.net_salary,
            pi.payslip_emailed_at, pr.status AS run_status
       FROM payroll_items pi
       JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
       JOIN employees e ON e.id = pi.employee_id
      WHERE pr.id = $1 AND pr.company_id = $2
      ORDER BY e.full_name`,
    [runId, companyId]
  ).then((rows) => rows.map((r) => ({ ...r, payslip_emailed_at: dayOf(r.payslip_emailed_at) })));
}
