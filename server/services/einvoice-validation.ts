/**
 * Pre-submission e-invoice validation: every issue here would make an ASP or the
 * FTA reject the document. Issues are structured so the UI can show a fix-it
 * list: a stable code, the field, English and Arabic text, and which party /
 * document / line they belong to.
 */

import type { Company, Invoice, InvoiceLine } from "../../shared/schema";
import { UAE_VAT_RATE } from "../constants";

export type EInvoiceIssueEntity = "seller" | "buyer" | "invoice" | "line" | "credit_note";

export interface EInvoiceIssue {
  code: string;
  /** Dotted / indexed path, e.g. `company.trnVatNumber`, `lines[2].quantity`. */
  field: string;
  entity: EInvoiceIssueEntity;
  /** Zero-based line index for `entity === "line"`. */
  lineIndex?: number;
  message: string;
  messageAr: string;
}

export interface EInvoiceValidationOptions {
  buyer?: {
    /** The buyer is a VAT-registered business (B2B), so its TRN and address are required. */
    buyerIsBusiness?: boolean;
    address?: string | null;
    city?: string | null;
  };
  original?: { number?: string | null };
}

const TRN_RE = /^[0-9]{15}$/;
const MISMATCH_TOLERANCE = 0.05;
const SUBTOTAL_ROUNDING_TOLERANCE = 0.02;

/** VAT category codes (UNCL5305 subset used by PINT AE): S standard · Z zero-rated · E exempt · O out of scope. */
export function vatCategoryFor(
  line: Pick<InvoiceLine, "vatSupplyType" | "vatRate">
): "S" | "Z" | "E" | "O" {
  switch (line.vatSupplyType) {
    case "zero_rated":
      return "Z";
    case "exempt":
      return "E";
    case "out_of_scope":
      return "O";
    default:
      return (line.vatRate ?? UAE_VAT_RATE) === 0 ? "Z" : "S";
  }
}

const round2 = (n: number): number => Math.round(n * 100 + (n < 0 ? -1e-7 : 1e-7)) / 100;
const money = (n: number): string => round2(n).toFixed(2);
const blank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === "";

type Text = { en: string; ar: string };

const TEXT = {
  SELLER_TRN_MISSING: (): Text => ({ en: "Supplier TRN is required for e-invoicing", ar: "رقم التسجيل الضريبي للبائع مطلوب للفوترة الإلكترونية" }),
  SELLER_TRN_INVALID: (): Text => ({ en: "Supplier TRN must be exactly 15 digits", ar: "يجب أن يتكون رقم التسجيل الضريبي للبائع من 15 رقمًا بالضبط" }),
  SELLER_NAME_MISSING: (): Text => ({ en: "Supplier legal name is required", ar: "الاسم القانوني للبائع مطلوب" }),
  SELLER_STREET_MISSING: (): Text => ({ en: "Supplier street address is required (company profile)", ar: "عنوان الشارع للبائع مطلوب (في ملف الشركة)" }),
  SELLER_CITY_MISSING: (): Text => ({ en: "Supplier city is required (company profile)", ar: "مدينة البائع مطلوبة (في ملف الشركة)" }),
  SELLER_EMIRATE_MISSING: (): Text => ({ en: "Supplier emirate is required (company profile)", ar: "إمارة البائع مطلوبة (في ملف الشركة)" }),
  BUYER_NAME_MISSING: (): Text => ({ en: "Buyer name is required", ar: "اسم المشتري مطلوب" }),
  BUYER_TRN_INVALID: (): Text => ({ en: "Buyer TRN must be exactly 15 digits when provided", ar: "يجب أن يتكون رقم التسجيل الضريبي للمشتري من 15 رقمًا بالضبط عند إدخاله" }),
  BUYER_TRN_MISSING: (): Text => ({ en: "Buyer TRN is required for a taxable supply to a business", ar: "رقم التسجيل الضريبي للمشتري مطلوب لتوريد خاضع للضريبة إلى منشأة أعمال" }),
  BUYER_STREET_MISSING: (): Text => ({ en: "Buyer street address is required for a business customer", ar: "عنوان الشارع للمشتري مطلوب لعميل من منشآت الأعمال" }),
  BUYER_CITY_MISSING: (): Text => ({ en: "Buyer city is required for a business customer", ar: "مدينة المشتري مطلوبة لعميل من منشآت الأعمال" }),
  INVOICE_NUMBER_MISSING: (): Text => ({ en: "Invoice number is required", ar: "رقم الفاتورة مطلوب" }),
  INVOICE_DATE_MISSING: (): Text => ({ en: "Invoice issue date is required", ar: "تاريخ إصدار الفاتورة مطلوب" }),
  CURRENCY_MISSING: (): Text => ({ en: "Document currency code is required", ar: "رمز عملة المستند مطلوب" }),
  NO_LINES: (): Text => ({ en: "At least one invoice line is required", ar: "يجب أن تحتوي الفاتورة على بند واحد على الأقل" }),
  LINE_DESCRIPTION_MISSING: (): Text => ({ en: "Line description is required", ar: "وصف البند مطلوب" }),
  LINE_QUANTITY_INVALID: (): Text => ({ en: "Line quantity must be positive", ar: "يجب أن تكون كمية البند أكبر من صفر" }),
  LINE_UNIT_PRICE_INVALID: (): Text => ({ en: "Line unit price is required and cannot be negative", ar: "سعر الوحدة للبند مطلوب ولا يمكن أن يكون سالبًا" }),
  VAT_CATEGORY_RATE_MISMATCH: (why: string, whyAr: string): Text => ({ en: `VAT category and rate disagree: ${why}`, ar: `فئة الضريبة ونسبتها غير متطابقتين: ${whyAr}` }),
  SUBTOTAL_MISMATCH: (a: number, b: number): Text => ({ en: `Line totals (${money(a)}) do not match the invoice subtotal (${money(b)})`, ar: `مجموع البنود (${money(a)}) لا يطابق المجموع الفرعي للفاتورة (${money(b)})` }),
  VAT_TOTAL_MISMATCH: (a: number, b: number): Text => ({ en: `Line VAT (${money(a)}) does not match the invoice VAT amount (${money(b)})`, ar: `ضريبة البنود (${money(a)}) لا تطابق مبلغ ضريبة الفاتورة (${money(b)})` }),
  TAX_SUBTOTAL_MISMATCH: (a: number, b: number): Text => ({ en: `The VAT per category adds up to ${money(a)} but the invoice VAT amount is ${money(b)}`, ar: `مجموع الضريبة حسب الفئة ${money(a)} بينما مبلغ ضريبة الفاتورة ${money(b)}` }),
  TOTAL_MISMATCH: (): Text => ({ en: "Subtotal plus VAT does not equal the invoice total", ar: "المجموع الفرعي مضافًا إليه الضريبة لا يساوي إجمالي الفاتورة" }),
  CREDIT_NOTE_ORIGINAL_MISSING: (): Text => ({ en: "A credit note must reference the original invoice it corrects", ar: "يجب أن يشير الإشعار الدائن إلى الفاتورة الأصلية التي يصححها" }),
  FX_RATE_MISSING: (): Text => ({ en: "A foreign-currency invoice needs its AED exchange rate to state the VAT total in AED", ar: "الفاتورة بعملة أجنبية تحتاج سعر صرف الدرهم لبيان إجمالي الضريبة بالدرهم" }),
} as const;

function issue(
  code: keyof typeof TEXT,
  field: string,
  entity: EInvoiceIssueEntity,
  text: Text,
  lineIndex?: number
): EInvoiceIssue {
  return { code, field, entity, ...(lineIndex !== undefined ? { lineIndex } : {}), message: text.en, messageAr: text.ar };
}

export function validateForEInvoicing(
  invoice: Invoice,
  lines: InvoiceLine[],
  company: Company,
  options: EInvoiceValidationOptions = {}
): EInvoiceIssue[] {
  const issues: EInvoiceIssue[] = [];
  const isCreditNote = (invoice as any).invoiceType === "credit_note";

  // ── seller ──
  if (!company.trnVatNumber) issues.push(issue("SELLER_TRN_MISSING", "company.trnVatNumber", "seller", TEXT.SELLER_TRN_MISSING()));
  else if (!TRN_RE.test(company.trnVatNumber)) issues.push(issue("SELLER_TRN_INVALID", "company.trnVatNumber", "seller", TEXT.SELLER_TRN_INVALID()));
  if (!company.name) issues.push(issue("SELLER_NAME_MISSING", "company.name", "seller", TEXT.SELLER_NAME_MISSING()));
  if (blank((company as any).addressStreet) && blank(company.businessAddress)) {
    issues.push(issue("SELLER_STREET_MISSING", "company.addressStreet", "seller", TEXT.SELLER_STREET_MISSING()));
  }
  if (blank((company as any).addressCity)) issues.push(issue("SELLER_CITY_MISSING", "company.addressCity", "seller", TEXT.SELLER_CITY_MISSING()));
  if (blank((company as any).emirate)) issues.push(issue("SELLER_EMIRATE_MISSING", "company.emirate", "seller", TEXT.SELLER_EMIRATE_MISSING()));

  // ── document ──
  if (!invoice.number) issues.push(issue("INVOICE_NUMBER_MISSING", "invoice.number", "invoice", TEXT.INVOICE_NUMBER_MISSING()));
  if (!invoice.date) issues.push(issue("INVOICE_DATE_MISSING", "invoice.date", "invoice", TEXT.INVOICE_DATE_MISSING()));
  if (!invoice.currency) issues.push(issue("CURRENCY_MISSING", "invoice.currency", "invoice", TEXT.CURRENCY_MISSING()));
  else if (invoice.currency !== "AED" && !(Number((invoice as any).exchangeRate) > 0)) {
    issues.push(issue("FX_RATE_MISSING", "invoice.exchangeRate", "invoice", TEXT.FX_RATE_MISSING()));
  }
  if (lines.length === 0) issues.push(issue("NO_LINES", "lines", "invoice", TEXT.NO_LINES()));

  if (isCreditNote && !(invoice as any).originalInvoiceId && blank(options.original?.number)) {
    issues.push(issue("CREDIT_NOTE_ORIGINAL_MISSING", "invoice.originalInvoiceId", "credit_note", TEXT.CREDIT_NOTE_ORIGINAL_MISSING()));
  }

  // ── buyer ──
  if (!invoice.customerName) issues.push(issue("BUYER_NAME_MISSING", "invoice.customerName", "buyer", TEXT.BUYER_NAME_MISSING()));
  const hasStandardLines = lines.some((l) => vatCategoryFor(l) === "S");
  const buyerIsBusiness = options.buyer?.buyerIsBusiness === true;
  if (invoice.customerTrn && !TRN_RE.test(invoice.customerTrn)) {
    issues.push(issue("BUYER_TRN_INVALID", "invoice.customerTrn", "buyer", TEXT.BUYER_TRN_INVALID()));
  } else if (!invoice.customerTrn && buyerIsBusiness && hasStandardLines) {
    issues.push(issue("BUYER_TRN_MISSING", "invoice.customerTrn", "buyer", TEXT.BUYER_TRN_MISSING()));
  }
  // Buyer address parts are checked when the caller supplied the buyer details (the routes always do).
  if (options.buyer && (buyerIsBusiness || invoice.customerTrn)) {
    if (blank(options.buyer?.address) && blank((invoice as any).customerAddress)) {
      issues.push(issue("BUYER_STREET_MISSING", "invoice.customerAddress", "buyer", TEXT.BUYER_STREET_MISSING()));
    }
    if (blank(options.buyer?.city)) {
      issues.push(issue("BUYER_CITY_MISSING", "buyer.city", "buyer", TEXT.BUYER_CITY_MISSING()));
    }
  }

  // ── lines ──
  let lineSum = 0;
  let lineVat = 0;
  const vatByGroup = new Map<string, number>();
  lines.forEach((line, i) => {
    if (blank(line.description)) issues.push(issue("LINE_DESCRIPTION_MISSING", `lines[${i}].description`, "line", TEXT.LINE_DESCRIPTION_MISSING(), i));
    // A credit note stores negative quantities; the magnitude must be non-zero.
    const q = Number(line.quantity);
    if (!Number.isFinite(q) || (isCreditNote ? q === 0 : !(q > 0))) {
      issues.push(issue("LINE_QUANTITY_INVALID", `lines[${i}].quantity`, "line", TEXT.LINE_QUANTITY_INVALID(), i));
    }
    const price = line.unitPrice as unknown;
    if (price === null || price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0) {
      issues.push(issue("LINE_UNIT_PRICE_INVALID", `lines[${i}].unitPrice`, "line", TEXT.LINE_UNIT_PRICE_INVALID(), i));
    }

    const category = vatCategoryFor(line);
    const rate = line.vatRate ?? UAE_VAT_RATE;
    if (category === "S" && Math.abs(Number(rate) - UAE_VAT_RATE) > 1e-9) {
      issues.push(issue("VAT_CATEGORY_RATE_MISMATCH", `lines[${i}].vatRate`, "line",
        TEXT.VAT_CATEGORY_RATE_MISMATCH(`standard-rated (S) must be ${UAE_VAT_RATE * 100}%, the line has ${(Number(rate) * 100).toFixed(2)}%`, `الفئة القياسية (S) يجب أن تكون ${UAE_VAT_RATE * 100}% بينما البند ${(Number(rate) * 100).toFixed(2)}%`), i));
    } else if (category !== "S" && Number(rate) > 0) {
      issues.push(issue("VAT_CATEGORY_RATE_MISMATCH", `lines[${i}].vatRate`, "line",
        TEXT.VAT_CATEGORY_RATE_MISMATCH(`category ${category} (${line.vatSupplyType}) carries no VAT, the line has ${(Number(rate) * 100).toFixed(2)}%`, `الفئة ${category} لا تحمل ضريبة بينما البند ${(Number(rate) * 100).toFixed(2)}%`), i));
    }

    const ext = (Number.isFinite(q) ? q : 0) * (Number.isFinite(Number(price)) ? Number(price) : 0);
    lineSum += ext;
    const vat = category === "S" ? ext * Number(rate) : 0;
    lineVat += vat;
    const key = `${category}:${category === "S" ? Number(rate) : 0}`;
    vatByGroup.set(key, (vatByGroup.get(key) ?? 0) + vat);
  });

  // ── totals ──
  let vatTotalIssue = false;
  if (lines.length > 0) {
    if (Math.abs(round2(lineSum) - round2(invoice.subtotal)) > MISMATCH_TOLERANCE) {
      issues.push(issue("SUBTOTAL_MISMATCH", "invoice.subtotal", "invoice", TEXT.SUBTOTAL_MISMATCH(lineSum, invoice.subtotal)));
    }
    if (Math.abs(round2(lineVat) - round2(invoice.vatAmount)) > MISMATCH_TOLERANCE) {
      vatTotalIssue = true;
      issues.push(issue("VAT_TOTAL_MISMATCH", "invoice.vatAmount", "invoice", TEXT.VAT_TOTAL_MISMATCH(lineVat, invoice.vatAmount)));
    }
    // The XML states VAT per (category, rate) subtotal, each rounded to fils; those must add up to the header.
    if (!vatTotalIssue) {
      const roundedGroups = [...vatByGroup.values()].reduce((s, v) => s + round2(v), 0);
      if (Math.abs(round2(roundedGroups) - round2(invoice.vatAmount)) > SUBTOTAL_ROUNDING_TOLERANCE) {
        issues.push(issue("TAX_SUBTOTAL_MISMATCH", "invoice.vatAmount", "invoice", TEXT.TAX_SUBTOTAL_MISMATCH(roundedGroups, invoice.vatAmount)));
      }
    }
  }
  if (Math.abs(round2(invoice.subtotal + invoice.vatAmount) - round2(invoice.total)) > MISMATCH_TOLERANCE) {
    issues.push(issue("TOTAL_MISMATCH", "invoice.total", "invoice", TEXT.TOTAL_MISMATCH()));
  }

  return issues;
}
