import { MARKETING_BRAND } from "../../shared/marketing-brand";
import ExcelJS from "exceljs";

import {
  computeCtLiability,
  computeCtTotals,
  parseCtPasteRows,
  type CtWorkpaperRow,
} from "../../shared/ct-workpaper";
import type { Company, CorporateTaxReturn } from "../../shared/schema";

const BRAND_COLOR = "FF0F172A";
const HEADER_FONT_COLOR = "FFFFFFFF";
const ZEBRA_COLOR = "FFF8FAFC";
const SECTION_COLOR = "FFE6F1EC";
const TOTAL_COLOR = "FFF7EFDA";
const AED_FMT = '"AED" #,##0.00;[Red]-"AED" #,##0.00';

function isoDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_FONT_COLOR } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_COLOR } };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = { bottom: { style: "thin", color: { argb: "FF1E293B" } } };
  });
}

function addTitleBlock(
  sheet: ExcelJS.Worksheet,
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null,
  subtitle: string,
  width: number
): void {
  const title = sheet.addRow([`Muhasib.ai — ${subtitle}`]);
  title.getCell(1).font = { name: "Calibri", size: 15, bold: true };
  sheet.mergeCells(title.number, 1, title.number, width);

  const meta: string[][] = [
    ["Company", company?.name ?? "—", "TRN", company?.trnVatNumber ?? "—"],
    [
      "Tax period",
      `${isoDate(ctReturn.taxPeriodStart)} → ${isoDate(ctReturn.taxPeriodEnd)}`,
      "Status",
      String(ctReturn.status),
    ],
    ["Generated", new Date().toISOString().slice(0, 16).replace("T", " "), "", ""],
  ];
  for (const line of meta) {
    const row = sheet.addRow(line);
    row.getCell(1).font = { name: "Calibri", size: 10, bold: true };
    row.getCell(3).font = { name: "Calibri", size: 10, bold: true };
    row.getCell(2).font = { name: "Calibri", size: 10 };
    row.getCell(4).font = { name: "Calibri", size: 10 };
  }
  sheet.addRow([]);
}

function workpaperRows(ctReturn: CorporateTaxReturn): CtWorkpaperRow[] {
  const workpaper = ctReturn.workpaper as { rows?: CtWorkpaperRow[] } | null;
  return Array.isArray(workpaper?.rows) ? workpaper.rows : [];
}

function workpaperSourceLabel(ctReturn: CorporateTaxReturn): string {
  const source = (ctReturn.workpaper as { source?: string } | null)?.source;
  if (source === "manual_workpaper") return "Manual workpaper";
  if (source === "journal_calculation") return "Pulled from books";
  return "Not captured";
}

function addSupportNotesSheet(
  workbook: ExcelJS.Workbook,
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): void {
  const sheet = workbook.addWorksheet("Filing Support Notes", {
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = [
    { key: "field", width: 34 },
    { key: "value", width: 28 },
    { key: "note", width: 66 },
  ];

  addTitleBlock(sheet, ctReturn, company, "Corporate Tax Filing Support", 3);

  const headerRow = sheet.addRow(["Field", "Value", "Review note"]);
  styleHeaderRow(headerRow);

  const rows = workpaperRows(ctReturn);
  const taxableAmount = Math.max(
    0,
    money(ctReturn.taxableIncome) - money(ctReturn.exemptionThreshold)
  );
  const supportRows: Array<[string, string | number, string, "money" | "plain" | "percent"]> = [
    [
      "Submission note",
      "Support export only",
      "This workbook is prepared for review and manual filing support. It does not submit, file, or mark a return as filed.",
      "plain",
    ],
    ["Company", company?.name ?? "—", "Confirm legal entity before using the figures.", "plain"],
    ["TRN", company?.trnVatNumber ?? "—", "Shown for reference if available.", "plain"],
    [
      "Tax period",
      `${isoDate(ctReturn.taxPeriodStart)} to ${isoDate(ctReturn.taxPeriodEnd)}`,
      "Confirm the accounting period before filing.",
      "plain",
    ],
    ["Return status", String(ctReturn.status), "Status inside Muhasib.ai.", "plain"],
    [
      "Workpaper source",
      workpaperSourceLabel(ctReturn),
      "Source of the support schedule.",
      "plain",
    ],
    ["Workpaper rows", rows.length, "Revenue and expense lines included in the export.", "plain"],
    ["Total revenue", money(ctReturn.totalRevenue), "From the saved CT return.", "money"],
    ["Total expenses", money(ctReturn.totalExpenses), "From the saved CT return.", "money"],
    [
      "Taxable income",
      money(ctReturn.taxableIncome),
      "After saved deductions/adjustments.",
      "money",
    ],
    [
      "0% band threshold",
      money(ctReturn.exemptionThreshold),
      "Stored threshold for this return.",
      "money",
    ],
    ["Income above threshold", taxableAmount, "Amount subject to the stored CT rate.", "money"],
    [
      "Corporate tax rate",
      Number(ctReturn.taxRate ?? 0),
      "Stored rate for this return.",
      "percent",
    ],
    [
      "Corporate tax payable",
      money(ctReturn.taxPayable),
      "Final payable amount in this export.",
      "money",
    ],
    [
      "Loss brought forward",
      money(ctReturn.lossBroughtForward),
      "Prior-period loss pool used in the computation if applicable.",
      "money",
    ],
    [
      "Loss carried forward",
      money(ctReturn.lossCarriedForward),
      "Remaining loss pool after this computation if applicable.",
      "money",
    ],
    [
      "Small business relief",
      ctReturn.smallBusinessRelief ? "Elected/applied" : "Not applied",
      "Reflects the saved return state.",
      "plain",
    ],
    [
      "Related-party notes",
      ctReturn.relatedPartyNotes ?? "—",
      "Review transfer-pricing or related-party notes before filing.",
      "plain",
    ],
  ];

  supportRows.forEach(([field, value, note, kind], index) => {
    const row = sheet.addRow([field, value, note]);
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, bold: field === "Submission note" };
      cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
      if (index % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_COLOR } };
      }
      if (colNumber === 2 && kind === "money" && typeof cell.value === "number") {
        cell.numFmt = AED_FMT;
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      }
      if (colNumber === 2 && kind === "percent" && typeof cell.value === "number") {
        cell.numFmt = "0.00%";
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      }
      if (field === "Submission note") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };
      }
    });
  });

  sheet.pageSetup.orientation = "landscape";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
}

function addWorkpaperSheet(
  workbook: ExcelJS.Workbook,
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): void {
  const sheet = workbook.addWorksheet("CT Workpaper", { properties: { defaultRowHeight: 18 } });
  sheet.columns = [
    { key: "type", width: 12 },
    { key: "label", width: 44 },
    { key: "amount", width: 18 },
    { key: "notes", width: 36 },
  ];

  addTitleBlock(sheet, ctReturn, company, "Corporate Tax Workpaper", 4);

  const headerRow = sheet.addRow(["Type", "Line item", "Amount (AED)", "Notes"]);
  styleHeaderRow(headerRow);
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];

  const rows = workpaperRows(ctReturn);
  for (const section of ["revenue", "expense"] as const) {
    const sectionRows = rows.filter((row) => row.type === section);
    const sectionHeader = sheet.addRow([section === "revenue" ? "Revenue" : "Expenses"]);
    sheet.mergeCells(sectionHeader.number, 1, sectionHeader.number, 4);
    sectionHeader.getCell(1).font = { name: "Calibri", size: 10, bold: true };
    sectionHeader.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: SECTION_COLOR },
    };
    sectionHeader.getCell(1).alignment = { vertical: "middle", indent: 1 };

    sectionRows.forEach((row, idx) => {
      const dataRow = sheet.addRow([
        section === "revenue" ? "Revenue" : "Expense",
        row.label,
        money(row.amount),
        row.notes ?? "",
      ]);
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: "Calibri", size: 11 };
        cell.alignment = { vertical: "middle", indent: 1 };
        if (idx % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_COLOR } };
        }
        if (colNumber === 3) {
          cell.numFmt = AED_FMT;
          cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
        }
      });
    });

    const subtotal = sectionRows.reduce((sum, row) => sum + money(row.amount), 0);
    const subtotalRow = sheet.addRow([
      "",
      section === "revenue" ? "Total revenue" : "Total expenses",
      money(subtotal),
      "",
    ]);
    subtotalRow.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, bold: true };
      cell.border = { top: { style: "thin", color: { argb: "FF1E293B" } } };
      if (colNumber === 3) {
        cell.numFmt = AED_FMT;
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      }
    });
  }

  sheet.pageSetup.orientation = "portrait";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
}

function addComputationSheet(
  workbook: ExcelJS.Workbook,
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): void {
  const sheet = workbook.addWorksheet("CT Computation", { properties: { defaultRowHeight: 18 } });
  sheet.columns = [
    { key: "label", width: 46 },
    { key: "amount", width: 20 },
  ];

  addTitleBlock(sheet, ctReturn, company, "Corporate Tax Computation (copy-ready)", 2);

  const headerRow = sheet.addRow(["Item", "Amount (AED)"]);
  styleHeaderRow(headerRow);

  // Prefer the persisted bridge (full FDL 47/2022 schedule: add-backs, small
  // business relief, loss carryforward) when the return has been computed;
  // fall back to the simple liability formula for legacy returns.
  const computation = (ctReturn.workpaper as { computation?: unknown } | null | undefined)
    ?.computation as
    | { bridge?: Array<{ label: string; amount: number }>; taxRate?: number }
    | undefined;

  let lines: Array<[string, number | string, boolean?]>;
  if (computation?.bridge?.length) {
    const emphasizedLabels = /taxable income$|corporate tax payable/i;
    lines = computation.bridge.map(
      (line) =>
        [line.label, line.amount, emphasizedLabels.test(line.label)] as [string, number, boolean]
    );
    lines.splice(lines.length - 1, 0, [
      "Corporate tax rate",
      `${((computation.taxRate ?? Number(ctReturn.taxRate ?? 0.09)) * 100).toFixed(0)}%`,
    ]);
  } else {
    const liability = computeCtLiability({
      totalRevenue: money(ctReturn.totalRevenue),
      totalExpenses: money(ctReturn.totalExpenses),
      totalDeductions: money(ctReturn.totalDeductions),
      exemptionThreshold: money(ctReturn.exemptionThreshold),
      taxRate: Number(ctReturn.taxRate ?? 0.09),
    });
    lines = [
      ["Total revenue", money(ctReturn.totalRevenue)],
      ["Total expenses", money(ctReturn.totalExpenses)],
      ["Accounting profit / (loss)", money(ctReturn.totalRevenue) - money(ctReturn.totalExpenses)],
      ["Deductions / adjustments", money(ctReturn.totalDeductions)],
      ["Taxable income", liability.taxableIncome, true],
      ["Small-business relief threshold", liability.exemptionThreshold],
      ["Income above threshold", liability.taxableAmount],
      [`Corporate tax rate`, `${(liability.taxRate * 100).toFixed(0)}%`],
      ["Corporate tax payable", liability.taxPayable, true],
    ];
  }

  if (ctReturn.relatedPartyNotes) {
    lines.push(["Related-party / transfer-pricing notes", ctReturn.relatedPartyNotes]);
  }

  for (const [label, amount, emphasized] of lines) {
    const row = sheet.addRow([label, amount]);
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, bold: emphasized === true };
      cell.alignment = { vertical: "middle", indent: 1 };
      if (emphasized) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };
      }
      if (colNumber === 2 && typeof cell.value === "number") {
        cell.numFmt = AED_FMT;
        cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
      }
    });
  }

  sheet.pageSetup.orientation = "portrait";
  sheet.pageSetup.fitToPage = true;
}

// ─── EmaraTax-aligned return sheet (R08-20, R08-24) ────────────────────────

export const EMARATAX_MANUAL_UPLOAD_NOTICE = `Upload manually to EmaraTax. ${MARKETING_BRAND.name.en} has no FTA API connection: this workbook is not a submission and does not file the return.`;
export const EMARATAX_MANUAL_UPLOAD_NOTICE_AR = `يُرجى إدخال القيم يدوياً في منصة إمارات تاكس. لا يوجد لدى ${MARKETING_BRAND.name.ar} اتصال بواجهة الهيئة الاتحادية للضرائب: هذا الملف ليس تقديماً ولا يقدّم الإقرار.`;

export interface EmaraTaxField {
  section: string;
  sectionAr: string;
  field: string;
  fieldAr: string;
  value: string | number | boolean;
}

interface StoredComputation {
  accountingProfit?: number;
  adjustedTaxableIncome?: number;
  lossBroughtForward?: number;
  lossReliefApplied?: number;
  lossCarriedForward?: number;
  taxableIncome?: number;
  taxableAmount?: number;
  taxPayable?: number;
  smallBusinessRelief?: { elected?: boolean; applied?: boolean };
  interestLimitation?: { disallowed?: number; carriedForwardOut?: number } | null;
  qfzp?: { elected?: boolean; deMinimisPassed?: boolean; qualifyingTaxableIncome?: number } | null;
}

interface StoredAdjustment {
  category?: string;
  amount?: number;
}

function adjustmentTotal(adjustments: StoredAdjustment[], category: string, rate = 1): number {
  return money(
    adjustments
      .filter((a) => a.category === category)
      .reduce((sum, a) => sum + money(a.amount) * rate, 0)
  );
}

/**
 * Field list in the order of the EmaraTax corporate tax return, with English
 * and Arabic labels. Values come from the stored computation so the sheet
 * matches the UI and the computation sheet exactly.
 */
export function emaraTaxReturnFields(
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): EmaraTaxField[] {
  const wp = (ctReturn.workpaper ?? {}) as {
    computation?: StoredComputation;
    adjustments?: StoredAdjustment[];
    ledgerAdjustments?: StoredAdjustment[];
    transferPricing?: { disclosureFormRequired?: boolean; masterLocalFileRequired?: boolean };
  };
  const c = wp.computation ?? {};
  const adjustments = [...(wp.adjustments ?? []), ...(wp.ledgerAdjustments ?? [])];
  const corporateTaxId = (company as { corporateTaxId?: string | null } | null)?.corporateTaxId;
  const amendment = ctReturn.amendmentNumber ?? 0;
  const s1 = ["1. Taxable person", "١. الشخص الخاضع للضريبة"] as const;
  const s2 = ["2. Elections", "٢. الاختيارات"] as const;
  const s3 = ["3. Accounting income", "٣. الدخل المحاسبي"] as const;
  const s4 = ["4. Adjustments to accounting income", "٤. التعديلات على الدخل المحاسبي"] as const;
  const s5 = ["5. Tax losses", "٥. الخسائر الضريبية"] as const;
  const s6 = [
    "6. Taxable income and corporate tax",
    "٦. الدخل الخاضع للضريبة وضريبة الشركات",
  ] as const;
  const s7 = ["7. Transfer pricing", "٧. التسعير التحويلي"] as const;
  const f = (
    section: readonly [string, string],
    field: string,
    fieldAr: string,
    value: string | number | boolean
  ): EmaraTaxField => ({ section: section[0], sectionAr: section[1], field, fieldAr, value });
  const revenue = money(ctReturn.totalRevenue);
  const expenses = money(ctReturn.totalExpenses);
  return [
    f(s1, "Legal name", "الاسم القانوني", company?.name ?? ""),
    f(s1, "Corporate tax TRN", "رقم التسجيل الضريبي لضريبة الشركات", corporateTaxId ?? ""),
    f(s1, "Tax period start", "بداية الفترة الضريبية", isoDate(ctReturn.taxPeriodStart)),
    f(s1, "Tax period end", "نهاية الفترة الضريبية", isoDate(ctReturn.taxPeriodEnd)),
    f(
      s1,
      "Return type",
      "نوع الإقرار",
      amendment > 0 ? `Amendment ${amendment} / تعديل ${amendment}` : "Original return / إقرار أصلي"
    ),
    f(
      s2,
      "Small Business Relief elected",
      "اختيار إعفاء الأعمال الصغيرة",
      c.smallBusinessRelief?.elected === true
    ),
    f(
      s2,
      "Small Business Relief applied",
      "تطبيق إعفاء الأعمال الصغيرة",
      c.smallBusinessRelief?.applied === true
    ),
    f(s2, "Qualifying Free Zone Person", "شخص مؤهل في المنطقة الحرة", c.qfzp?.elected === true),
    f(
      s2,
      "QFZP de minimis met",
      "استيفاء الحد الأدنى للشخص المؤهل",
      c.qfzp?.deMinimisPassed === true
    ),
    f(s3, "Revenue", "الإيرادات", revenue),
    f(s3, "Expenditure", "المصروفات", expenses),
    f(
      s3,
      "Accounting net profit / (loss)",
      "صافي الربح / (الخسارة) المحاسبي",
      money(c.accountingProfit ?? revenue - expenses)
    ),
    f(
      s4,
      "Non-deductible entertainment (50%)",
      "مصروفات الضيافة غير القابلة للخصم (50٪)",
      adjustmentTotal(adjustments, "entertainment_50", 0.5)
    ),
    f(
      s4,
      "Fines and penalties",
      "الغرامات والجزاءات",
      adjustmentTotal(adjustments, "fines_penalties")
    ),
    f(
      s4,
      "Donations to non-qualifying entities",
      "التبرعات لجهات غير مؤهلة",
      adjustmentTotal(adjustments, "non_approved_donations")
    ),
    f(
      s4,
      "Transfer-pricing adjustment",
      "تعديل التسعير التحويلي",
      adjustmentTotal(adjustments, "related_party_excess")
    ),
    f(
      s4,
      "Other non-deductible expenditure",
      "مصروفات أخرى غير قابلة للخصم",
      money(
        adjustmentTotal(adjustments, "owner_drawings") +
          adjustmentTotal(adjustments, "other_addback")
      )
    ),
    f(
      s4,
      "Interest above the deduction limit",
      "الفوائد التي تتجاوز حد الخصم",
      money(c.interestLimitation?.disallowed ?? 0)
    ),
    f(s4, "Exempt income", "الدخل المعفى", adjustmentTotal(adjustments, "exempt_income")),
    f(
      s4,
      "Unrealised gains (realisation basis)",
      "الأرباح غير المحققة (أساس التحقق)",
      adjustmentTotal(adjustments, "unrealized_gains")
    ),
    f(
      s4,
      "Other deductions",
      "خصومات أخرى",
      money(adjustmentTotal(adjustments, "other_deduction") + money(ctReturn.totalDeductions))
    ),
    f(
      s4,
      "Taxable income before loss relief",
      "الدخل الخاضع للضريبة قبل تسوية الخسائر",
      money(c.adjustedTaxableIncome ?? ctReturn.taxableIncome)
    ),
    f(
      s5,
      "Tax losses brought forward",
      "الخسائر الضريبية المرحلة من فترات سابقة",
      money(c.lossBroughtForward ?? ctReturn.lossBroughtForward)
    ),
    f(
      s5,
      "Tax losses utilised (max 75%)",
      "الخسائر الضريبية المستخدمة (بحد أقصى 75٪)",
      money(c.lossReliefApplied ?? 0)
    ),
    f(
      s5,
      "Tax losses carried forward",
      "الخسائر الضريبية المرحلة للفترات اللاحقة",
      money(c.lossCarriedForward ?? ctReturn.lossCarriedForward)
    ),
    f(
      s6,
      "Taxable income",
      "الدخل الخاضع للضريبة",
      money(c.taxableIncome ?? ctReturn.taxableIncome)
    ),
    f(
      s6,
      "Qualifying income at 0% (QFZP)",
      "الدخل المؤهل بنسبة 0٪ (الشخص المؤهل)",
      money(c.qfzp?.qualifyingTaxableIncome ?? 0)
    ),
    f(s6, "Taxable income at 9%", "الدخل الخاضع للضريبة بنسبة 9٪", money(c.taxableAmount ?? 0)),
    f(
      s6,
      "Corporate tax payable",
      "ضريبة الشركات المستحقة",
      money(c.taxPayable ?? ctReturn.taxPayable)
    ),
    f(
      s7,
      "Transfer pricing disclosure form required",
      "نموذج إفصاح التسعير التحويلي مطلوب",
      wp.transferPricing?.disclosureFormRequired === true
    ),
    f(
      s7,
      "Master File / Local File required",
      "الملف الرئيسي / الملف المحلي مطلوب",
      wp.transferPricing?.masterLocalFileRequired === true
    ),
  ];
}

function addEmaraTaxSheet(
  workbook: ExcelJS.Workbook,
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): void {
  const sheet = workbook.addWorksheet("EmaraTax Return", {
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = [
    { key: "section", width: 40 },
    { key: "field", width: 44 },
    { key: "fieldAr", width: 44 },
    { key: "value", width: 24 },
  ];
  const notice = sheet.addRow([EMARATAX_MANUAL_UPLOAD_NOTICE]);
  notice.getCell(1).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFB91C1C" } };
  sheet.mergeCells(notice.number, 1, notice.number, 4);
  const noticeAr = sheet.addRow([EMARATAX_MANUAL_UPLOAD_NOTICE_AR]);
  noticeAr.getCell(1).alignment = { horizontal: "right", readingOrder: "rtl" };
  sheet.mergeCells(noticeAr.number, 1, noticeAr.number, 4);
  sheet.addRow([]);
  styleHeaderRow(sheet.addRow(["Section / القسم", "Field", "الحقل", "Value / القيمة"]));
  for (const field of emaraTaxReturnFields(ctReturn, company)) {
    const value =
      typeof field.value === "boolean" ? (field.value ? "Yes / نعم" : "No / لا") : field.value;
    const row = sheet.addRow([
      `${field.section} | ${field.sectionAr}`,
      field.field,
      field.fieldAr,
      value,
    ]);
    row.getCell(3).alignment = { horizontal: "right", readingOrder: "rtl" };
    if (typeof value === "number") {
      row.getCell(4).numFmt = AED_FMT;
      row.getCell(4).alignment = { horizontal: "right" };
    }
  }
}

export interface DeferredTaxNote {
  items: Array<{
    key: string;
    label: string;
    labelAr: string;
    amount: number;
    kind: "asset" | "liability";
    deferredTax: number;
  }>;
  net: number;
  rate: number;
}

/** Deferred-tax note schedule (R08-19): disclosure only, nothing is posted. */
function addDeferredTaxSheet(workbook: ExcelJS.Workbook, ctReturn: CorporateTaxReturn): void {
  const deferred = (ctReturn.workpaper as { deferredTax?: DeferredTaxNote } | null)?.deferredTax;
  const sheet = workbook.addWorksheet("Deferred Tax Note", {
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = [
    { key: "item", width: 60 },
    { key: "difference", width: 22 },
    { key: "kind", width: 16 },
    { key: "tax", width: 22 },
  ];
  sheet.addRow([
    "Note schedule only: no deferred tax journal is posted automatically. / جدول إيضاحي فقط: لا يتم ترحيل قيد للضريبة المؤجلة تلقائياً.",
  ]);
  sheet.addRow([]);
  styleHeaderRow(
    sheet.addRow(["Temporary difference", "Amount (AED)", "Asset / liability", "Deferred tax"])
  );
  for (const item of deferred?.items ?? []) {
    const row = sheet.addRow([
      `${item.label} / ${item.labelAr}`,
      item.amount,
      item.kind,
      item.deferredTax,
    ]);
    row.getCell(2).numFmt = AED_FMT;
    row.getCell(4).numFmt = AED_FMT;
  }
  const net = sheet.addRow(["Net deferred tax asset / (liability)", "", "", deferred?.net ?? 0]);
  net.font = { bold: true };
  net.getCell(4).numFmt = AED_FMT;
}

/** Downloadable Excel copy of a corporate-tax return: workpaper + computation. */
export async function buildCtReturnWorkbook(
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name" | "trnVatNumber"> | null
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muhasib.ai";
  workbook.title = "Muhasib Corporate Tax Workpaper";
  workbook.company = "Muhasib.ai";

  addSupportNotesSheet(workbook, ctReturn, company);
  addWorkpaperSheet(workbook, ctReturn, company);
  addComputationSheet(workbook, ctReturn, company);
  addEmaraTaxSheet(workbook, ctReturn, company);
  addDeferredTaxSheet(workbook, ctReturn);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

// Headers must round-trip through parseCtPasteRows (shared/ct-workpaper.ts).
const TEMPLATE_HEADERS = ["type", "label", "amount", "notes"];
const TEMPLATE_EXAMPLES: string[][] = [
  ["revenue", "Product sales", "450000.00", "Core trading income"],
  ["revenue", "Service income", "120000.00", ""],
  ["expense", "Salaries and wages", "210000.00", "Incl. WPS payroll"],
  ["expense", "Rent", "60000.00", ""],
];

/** Blank CT workpaper template whose rows paste/import back losslessly. */
export async function buildCtTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muhasib.ai";
  workbook.title = "Muhasib CT Workpaper Template";

  const sheet = workbook.addWorksheet("CT Rows", {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = TEMPLATE_HEADERS.map((header) => ({
    header,
    key: header,
    width: Math.max(14, header.length + 10),
  }));
  styleHeaderRow(sheet.getRow(1));
  for (const example of TEMPLATE_EXAMPLES) {
    const row = sheet.addRow(example);
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF64748B" } };
      cell.alignment = { vertical: "middle", indent: 1 };
    });
  }

  const reference = workbook.addWorksheet("Types");
  reference.columns = [
    { header: "Type", key: "type", width: 14 },
    { header: "Meaning", key: "meaning", width: 44 },
  ];
  styleHeaderRow(reference.getRow(1));
  reference.addRow(["revenue", "Income lines (also accepts income/sales)"]);
  reference.addRow(["expense", "Deductible expense lines (default for unknown types)"]);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

function workbookCellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value)
      return workbookCellText((value as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in value) {
      return (value as { richText: Array<{ text: string }> }).richText
        .map((part) => part.text)
        .join("");
    }
    if ("text" in value) return String((value as { text: string }).text);
    return String(value);
  }
  return String(value);
}

/** Reads an uploaded .xlsx and runs its first sheet through the shared parser. */
export async function parseCtWorkbookRows(buffer: Buffer): Promise<CtWorkpaperRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const lines: string[] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(workbookCellText(cell.value).replace(/\t/g, " "));
    });
    lines.push(cells.join("\t"));
  });

  return parseCtPasteRows(lines.join("\n"));
}

export function ctReturnExportFilename(
  ctReturn: CorporateTaxReturn,
  company: Pick<Company, "name"> | null
): string {
  const slug = (company?.name ?? "company")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `ct-workpaper-${slug}-${isoDate(ctReturn.taxPeriodEnd) || "period"}.xlsx`;
}

export { computeCtTotals };
