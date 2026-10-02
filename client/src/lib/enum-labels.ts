// Labels for the short status and kind words the server sends as slugs ("draft", "sharjah", "quarterly"), so they read
// in the reader's language on the VAT, month-end and report screens. Pure data plus one lookup: a slug it does not know
// is shown as the server wrote it (tidied), never blank.

import type { Locale } from "./i18n";

export interface Label {
  en: string;
  ar: string;
}

const L = (en: string, ar: string): Label => ({ en, ar });

export const EMIRATE_LABELS: Record<string, Label> = {
  abu_dhabi: L("Abu Dhabi", "أبوظبي"),
  dubai: L("Dubai", "دبي"),
  sharjah: L("Sharjah", "الشارقة"),
  ajman: L("Ajman", "عجمان"),
  umm_al_quwain: L("Umm Al Quwain", "أم القيوين"),
  ras_al_khaimah: L("Ras Al Khaimah", "رأس الخيمة"),
  fujairah: L("Fujairah", "الفجيرة"),
};

/** The VAT workpaper row categories (shared/vat-workpaper-grid.ts keeps the English). */
export const VAT_ROW_CATEGORY_LABELS: Record<string, Label> = {
  standard_sale: L("Standard sales by emirate", "المبيعات الخاضعة للنسبة الأساسية حسب الإمارة"),
  tourist_refund: L("Tourist refunds", "استرداد السياح"),
  reverse_charge_output: L("Reverse charge output", "ضريبة المخرجات بآلية الاحتساب العكسي"),
  zero_rated_sale: L("Zero-rated supplies", "التوريدات الخاضعة لنسبة الصفر"),
  exempt_sale: L("Exempt supplies", "التوريدات المعفاة"),
  import: L("Imports", "الواردات"),
  import_adjustment: L("Import adjustments", "تسويات الواردات"),
  standard_expense: L("Standard expenses", "المصروفات الخاضعة للنسبة الأساسية"),
  reverse_charge_input: L("Reverse charge input", "ضريبة المدخلات بآلية الاحتساب العكسي"),
  manual_adjustment: L("Manual adjustment", "تسوية يدوية"),
};

/** Return, period and workpaper statuses, document statuses and filing frequencies. */
export const STATUS_LABELS: Record<string, Label> = {
  draft: L("Draft", "مسودة"),
  ready: L("Ready", "جاهز"),
  pending_review: L("In review", "قيد المراجعة"),
  review: L("In review", "قيد المراجعة"),
  submitted: L("Submitted", "مقدَّم"),
  accepted: L("Accepted", "مقبول"),
  filed: L("Filed", "مقدَّم للهيئة"),
  paid: L("Paid", "مدفوع"),
  amended: L("Amended", "معدَّل"),
  approved: L("Approved", "معتمد"),
  excluded: L("Excluded", "مستبعد"),
  void: L("Void", "ملغى"),
  voided: L("Void", "ملغى"),
  issued: L("Issued", "صادر"),
  sent: L("Sent", "مُرسل"),
  partial: L("Part paid", "مدفوع جزئيًا"),
  partially_paid: L("Part paid", "مدفوع جزئيًا"),
  overdue: L("Overdue", "متأخر"),
  pending: L("Pending", "قيد الانتظار"),
  open: L("Open", "مفتوح"),
  closed: L("Closed", "مُقفل"),
  locked: L("Locked", "مقفل"),
  unlocked: L("Open", "مفتوح"),
  active: L("Active", "نشط"),
  inactive: L("Inactive", "غير نشط"),
  cancelled: L("Cancelled", "ملغى"),
  completed: L("Completed", "مكتمل"),
  posted: L("Posted", "مرحَّل"),
  accrued: L("Accrued", "مستحق"),
  matched: L("Matched", "مطابق"),
  unmatched: L("Unmatched", "غير مطابق"),
  reconciled: L("Reconciled", "مسوّى"),
  monthly: L("Monthly", "شهري"),
  quarterly: L("Quarterly", "ربع سنوي"),
  annually: L("Annually", "سنوي"),
  yearly: L("Annually", "سنوي"),
  none: L("None", "لا يوجد"),
};

const tidy = (slug: string): string => {
  const t = slug.replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};

function lookup(
  table: Record<string, Label>,
  value: string | null | undefined,
  locale: Locale | string
): string {
  if (value === null || value === undefined || value === "") return "";
  const key = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const hit = table[key];
  if (!hit) return String(value);
  return locale === "ar" ? hit.ar : hit.en;
}

export const emirateLabel = (slug: string | null | undefined, locale: Locale | string): string =>
  lookup(EMIRATE_LABELS, slug, locale);
export const vatRowCategoryText = (
  slug: string | null | undefined,
  locale: Locale | string
): string => lookup(VAT_ROW_CATEGORY_LABELS, slug, locale);
export const statusLabel = (slug: string | null | undefined, locale: Locale | string): string =>
  lookup(STATUS_LABELS, slug, locale);

/** A report cell the server wrote as a slug in a status-like or emirate column; every other cell is left alone. */
export function localizeEnumCell(
  columnKey: string,
  value: string | number | null | undefined,
  locale: Locale | string
): string | number | null | undefined {
  if (typeof value !== "string" || value === "") return value;
  const key = columnKey.toLowerCase();
  if (key === "emirate") return emirateLabel(value, locale);
  if (key === "status" || key === "frequency" || key === "state")
    return lookup(STATUS_LABELS, value, locale);
  return value;
}

export { tidy as tidySlug };
