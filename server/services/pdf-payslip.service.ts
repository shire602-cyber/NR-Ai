import { createPdfDocument } from "./pdf-fonts";
import { fitFontSize } from "./pdf-layout";
import { formatMoney, formatPdfDate, monthName } from "./pdf-format";

export interface PayslipInput {
  company: {
    name: string;
    trnVatNumber?: string | null;
    businessAddress?: string | null;
  };
  employee: {
    fullName: string;
    fullNameAr?: string | null;
    employeeNumber?: string | null;
    id?: string;
    designation?: string | null;
    department?: string | null;
    iban?: string | null;
  };
  periodMonth: number;
  periodYear: number;
  payDate?: Date | string | null;
  /** The run is not approved yet: the slip is marked "DRAFT - not yet approved" (English and Arabic). */
  draft?: boolean;
  item: {
    basicSalary: number | string;
    housingAllowance: number | string;
    transportAllowance: number | string;
    otherAllowance: number | string;
    overtime: number | string;
    deductions: number | string;
    deductionNotes?: string | null;
    pensionEmployee: number | string;
    pensionEmployer: number | string;
    gratuityAccrual: number | string;
    netSalary: number | string;
    /** Phase 8 D2: pay withheld for unpaid, half-pay and sick-tier leave, and the loan instalment recovered. */
    leaveDeduction?: number | string | null;
    loanDeduction?: number | string | null;
    unpaidLeaveDays?: number | string | null;
    halfPayLeaveDays?: number | string | null;
  };
}

/** Bank details on a slip show only the last four characters. */
export function maskIban(iban: string | null | undefined): string {
  const clean = (iban ?? "").replace(/\s+/g, "");
  if (!clean) return "-";
  if (clean.length <= 4) return "*".repeat(clean.length);
  return `**** **** **** ${clean.slice(-4)}`;
}

const n = (v: number | string | null | undefined): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const PAGE_WIDTH = 595.28;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const ROW_HEIGHT = 22;

interface Row {
  en: string;
  ar: string;
  amount: number;
  bold?: boolean;
  note?: string | null;
}

/**
 * Payslip PDF, one A4 page. English and Arabic labels sit on the same slip
 * (UAE norm): English on the left, Arabic right-aligned beside the amount.
 */
export async function generatePayslipPDF(input: PayslipInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const { company, employee, item } = input;
      const doc = createPdfDocument({
        size: "A4",
        margin: MARGIN,
        info: {
          Title: `Payslip ${monthName(input.periodMonth)} ${input.periodYear} - ${employee.fullName}`,
          Author: company.name,
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const basic = n(item.basicSalary);
      const earnings: Row[] = [
        { en: "Basic Salary", ar: "الراتب الأساسي", amount: basic },
        { en: "Housing Allowance", ar: "بدل السكن", amount: n(item.housingAllowance) },
        { en: "Transport Allowance", ar: "بدل المواصلات", amount: n(item.transportAllowance) },
        { en: "Other Allowance", ar: "بدلات أخرى", amount: n(item.otherAllowance) },
        { en: "Overtime", ar: "العمل الإضافي", amount: n(item.overtime) },
      ].filter((r, i) => i === 0 || r.amount !== 0);
      const gross = earnings.reduce((s, r) => s + r.amount, 0);

      const leaveNote = [
        n(item.unpaidLeaveDays) > 0 ? `${n(item.unpaidLeaveDays)} unpaid day(s)` : "",
        n(item.halfPayLeaveDays) > 0 ? `${n(item.halfPayLeaveDays)} half-pay day(s)` : "",
      ].filter(Boolean).join(", ");
      const deductions: Row[] = [
        { en: "Deductions", ar: "خصومات", amount: n(item.deductions), note: item.deductionNotes },
        { en: "Employee Pension Contribution", ar: "اشتراك المعاش للموظف", amount: n(item.pensionEmployee) },
        { en: "Leave Deduction", ar: "خصم الإجازة", amount: n(item.leaveDeduction), note: leaveNote || undefined },
        { en: "Loan Instalment", ar: "قسط القرض", amount: n(item.loanDeduction) },
      ].filter((r) => r.amount !== 0);
      const totalDeductions = n(item.deductions) + n(item.pensionEmployee) + n(item.leaveDeduction) + n(item.loanDeduction);

      // --- Header bar ---
      doc.rect(0, 0, PAGE_WIDTH, 100).fill("#1E40AF");
      doc.fontSize(20).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text(company.name, MARGIN, 30, { width: CONTENT_WIDTH * 0.6, align: "left" });
      doc.fontSize(16).text("PAYSLIP", MARGIN, 35, { width: CONTENT_WIDTH, align: "right" });
      doc.fontSize(12).fillColor("#DBEAFE").font("Helvetica");
      doc.text("قسيمة الراتب", MARGIN, 57, { width: CONTENT_WIDTH, align: "right" });

      // --- Draft banner: a slip of a run that is not approved yet is never mistaken for the issued one ---
      if (input.draft) {
        doc.rect(0, 100, PAGE_WIDTH, 22).fill("#B91C1C");
        doc.fontSize(10).fillColor("#FFFFFF").font("Helvetica-Bold");
        doc.text("DRAFT - not yet approved", MARGIN, 106, { width: CONTENT_WIDTH * 0.55, align: "left", lineBreak: false });
        doc.fontSize(10).text("مسودة - لم تُعتمد بعد", MARGIN + CONTENT_WIDTH * 0.45, 105, { width: CONTENT_WIDTH * 0.55, align: "right", lineBreak: false });
      }

      // --- Company details ---
      let y = input.draft ? 130 : 112;
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      if (company.trnVatNumber) {
        doc.text(`TRN: ${company.trnVatNumber}`, MARGIN, y);
        y += 11;
      }
      if (company.businessAddress) {
        doc.text(company.businessAddress, MARGIN, y, { width: CONTENT_WIDTH * 0.7 });
        y += doc.heightOfString(company.businessAddress, { width: CONTENT_WIDTH * 0.7 }) + 2;
      }
      y = Math.max(y + 8, 150);

      // --- Employee box ---
      const boxTop = y;
      const info: Array<[string, string, string]> = [
        ["Employee Name", "اسم الموظف", employee.fullName],
        ["Employee ID", "رقم الموظف", employee.employeeNumber || (employee.id ? employee.id.slice(0, 8) : "-")],
        ["Designation", "المسمى الوظيفي", employee.designation || "-"],
        ["Pay Period", "فترة الراتب", `${monthName(input.periodMonth)} ${input.periodYear}`],
        ["Pay Date", "تاريخ الدفع", formatPdfDate(input.payDate)],
        ["Bank Account (IBAN)", "الحساب البنكي", maskIban(employee.iban)],
      ];
      const leftCol = info.slice(0, 3);
      const rightCol = info.slice(3);
      const boxHeight = 12 + 3 * 30;
      doc.rect(MARGIN, boxTop, CONTENT_WIDTH, boxHeight).fill("#F9FAFB").stroke("#E5E7EB");
      const drawInfo = (col: Array<[string, string, string]>, x: number, width: number) => {
        let cy = boxTop + 10;
        for (const [en, ar, value] of col) {
          doc.fontSize(7.5).fillColor("#6B7280").font("Helvetica");
          doc.text(en, x, cy, { width: width * 0.55, lineBreak: false });
          doc.text(ar, x + width * 0.45, cy, { width: width * 0.55, align: "right", lineBreak: false });
          const arabicName = en === "Employee Name" ? employee.fullNameAr : null;
          const valueWidth = arabicName ? width * 0.55 : width;
          doc.fontSize(fitFontSize(doc, value, valueWidth, 10)).fillColor("#1F2937").font("Helvetica-Bold");
          doc.text(value, x, cy + 11, { width: valueWidth, lineBreak: false });
          if (arabicName) {
            doc.fontSize(fitFontSize(doc, arabicName, width * 0.42, 10)).font("Helvetica");
            doc.text(arabicName, x + width * 0.58, cy + 10, { width: width * 0.42, align: "right", lineBreak: false });
          }
          cy += 30;
        }
      };
      drawInfo(leftCol, MARGIN + 12, CONTENT_WIDTH / 2 - 24);
      drawInfo(rightCol, MARGIN + CONTENT_WIDTH / 2 + 12, CONTENT_WIDTH / 2 - 24);
      y = boxTop + boxHeight + 16;

      // --- Table helpers ---
      const colEn = MARGIN + 10;
      const colAr = MARGIN + 190;
      const colAmount = MARGIN + CONTENT_WIDTH - 130;
      const sectionHeader = (en: string, ar: string) => {
        doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill("#1E40AF");
        doc.fontSize(9).fillColor("#FFFFFF").font("Helvetica-Bold");
        doc.text(en, colEn, y + 7, { width: 200, lineBreak: false });
        doc.text(ar, colAr, y + 6, { width: 160, align: "right", lineBreak: false });
        doc.text("AED", colAmount, y + 7, { width: 120, align: "right", lineBreak: false });
        y += ROW_HEIGHT;
      };
      const drawRow = (row: Row, shade: boolean) => {
        doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill(row.bold ? "#EFF6FF" : shade ? "#F9FAFB" : "#FFFFFF");
        doc.fontSize(9).fillColor("#1F2937").font(row.bold ? "Helvetica-Bold" : "Helvetica");
        const label = row.note ? `${row.en} (${row.note})` : row.en;
        doc.text(label, colEn, y + 7, { width: 180, lineBreak: false });
        doc.text(row.ar, colAr, y + 6, { width: 160, align: "right", lineBreak: false });
        doc.text(formatMoney(row.amount), colAmount, y + 7, { width: 120, align: "right", lineBreak: false });
        y += ROW_HEIGHT;
      };
      const section = (en: string, ar: string, rows: Row[], total: Row) => {
        const top = y;
        sectionHeader(en, ar);
        rows.forEach((r, i) => drawRow(r, i % 2 === 1));
        drawRow(total, false);
        doc.rect(MARGIN, top, CONTENT_WIDTH, y - top).stroke("#E5E7EB");
        y += 12;
      };

      section("EARNINGS", "المستحقات", earnings, { en: "Gross Pay", ar: "إجمالي الراتب", amount: gross, bold: true });
      section(
        "DEDUCTIONS",
        "الاستقطاعات",
        deductions.length ? deductions : [{ en: "No deductions", ar: "لا توجد استقطاعات", amount: 0 }],
        { en: "Total Deductions", ar: "إجمالي الاستقطاعات", amount: totalDeductions, bold: true }
      );

      // --- Net pay ---
      doc.rect(MARGIN, y, CONTENT_WIDTH, 34).fill("#1E40AF");
      doc.fontSize(13).fillColor("#FFFFFF").font("Helvetica-Bold");
      doc.text("NET PAY", colEn, y + 10, { width: 150, lineBreak: false });
      doc.fontSize(11).text("صافي الراتب", colAr, y + 10, { width: 160, align: "right", lineBreak: false });
      doc.fontSize(13).text(`AED ${formatMoney(item.netSalary)}`, colAmount - 20, y + 10, {
        width: 140,
        align: "right",
        lineBreak: false,
      });
      y += 34 + 18;

      // --- Employer contributions (not deducted from the employee) ---
      section(
        "EMPLOYER CONTRIBUTIONS",
        "مساهمات صاحب العمل",
        [
          { en: "Employer Pension Contribution", ar: "اشتراك المعاش لصاحب العمل", amount: n(item.pensionEmployer) },
          { en: "Gratuity Accrual", ar: "مخصص مكافأة نهاية الخدمة", amount: n(item.gratuityAccrual) },
        ],
        {
          en: "Total Employer Contributions",
          ar: "إجمالي مساهمات صاحب العمل",
          amount: n(item.pensionEmployer) + n(item.gratuityAccrual),
          bold: true,
        }
      );
      doc.fontSize(7.5).fillColor("#6B7280").font("Helvetica");
      doc.text("Employer contributions are paid by the company and are not deducted from your pay.", MARGIN, y - 6, {
        width: CONTENT_WIDTH,
        lineBreak: false,
      });

      // --- Footer ---
      doc.fontSize(8).fillColor("#6B7280").font("Helvetica");
      doc.text("This is a computer-generated payslip and does not require a signature.", MARGIN, 770, {
        width: CONTENT_WIDTH,
        align: "center",
      });
      doc.text("هذه القسيمة صادرة إلكترونياً ولا تحتاج إلى توقيع", MARGIN, 782, {
        width: CONTENT_WIDTH,
        align: "center",
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
