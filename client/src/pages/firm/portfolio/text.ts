// Locale helpers for the firm portfolio (bookkeeper command center, VAT workspace).
// Server dashboard sentences and helper labels are English source text; `fx` maps the known
// ones to the reader's language through the shared message templates (server-copy.ts) and
// leaves everything else (client names, free text) untouched.
import { localizeFirmText } from "@shared/server-copy";
import { useTranslation } from "@/lib/i18n";

const MONTH_AR: Record<string, string> = {
  Jan: "يناير",
  Feb: "فبراير",
  Mar: "مارس",
  Apr: "أبريل",
  May: "مايو",
  Jun: "يونيو",
  Jul: "يوليو",
  Aug: "أغسطس",
  Sep: "سبتمبر",
  Oct: "أكتوبر",
  Nov: "نوفمبر",
  Dec: "ديسمبر",
};

/** "Jan / Apr / Jul / Oct" -> Arabic month names (cohort labels come from the server in English). */
export function localizeMonths(text: string): string {
  return text.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (m) => MONTH_AR[m]);
}

const VAT_NAME_AR: Record<string, string> = {
  "Abu Dhabi": "أبوظبي",
  Dubai: "دبي",
  Sharjah: "الشارقة",
  Ajman: "عجمان",
  "Umm Al Quwain": "أم القيوين",
  UAQ: "أم القيوين",
  "Ras Al Khaimah": "رأس الخيمة",
  RAK: "رأس الخيمة",
  Fujairah: "الفجيرة",
  "Tourist refund": "استرداد السياح",
  "Tourist refunds": "استرداد السياح",
  "Reverse charge": "الاحتساب العكسي",
  "Reverse charge output": "مخرجات الاحتساب العكسي",
  "Reverse charge input": "مدخلات الاحتساب العكسي",
  "Zero-rated": "صفرية",
  "Zero-rated supplies": "توريدات صفرية",
  Exempt: "معفاة",
  "Exempt supplies": "توريدات معفاة",
  Imports: "الواردات",
  "Import adjustment": "تسوية الواردات",
  "Import adjustments": "تسويات الواردات",
  "Total output": "إجمالي المخرجات",
  "Standard expenses": "المصروفات القياسية",
  "Standard sales by emirate": "المبيعات القياسية حسب الإمارة",
  "Manual adjustment": "تسوية يدوية",
  "Total input": "إجمالي المدخلات",
  "Total recoverable": "إجمالي القابل للاسترداد",
  "Total due tax": "إجمالي الضريبة المستحقة",
  "Total recoverable tax": "إجمالي الضريبة القابلة للاسترداد",
  "Payable tax": "الضريبة المستحقة الدفع",
  "Box 1 Standard-Rated Supplies": "الخانة 1: التوريدات الخاضعة للنسبة الأساسية",
  "Boxes 2-8 Outputs": "الخانات 2–8: المخرجات",
  "Boxes 9-14 Inputs And Net VAT": "الخانات 9–14: المدخلات وصافي الضريبة",
};
const VAT_SUFFIX_AR: Record<string, string> = {
  amount: "المبلغ",
  VAT: "الضريبة",
  adjustment: "التسوية",
  "input VAT": "ضريبة المدخلات",
};

/** Arabic for VAT 201 box labels / categories / emirates ("1b Dubai amount" -> "1b دبي المبلغ"). */
export function localizeVatLabel(label: string): string {
  if (VAT_NAME_AR[label]) return VAT_NAME_AR[label];
  const m = /^(\d+[a-g]?)\s+(.*?)(?:\s+(amount|VAT|adjustment|input VAT))?$/.exec(label);
  if (!m) return label;
  const name = VAT_NAME_AR[m[2]];
  if (!name) return label;
  return `${m[1]} ${name}${m[3] ? ` — ${VAT_SUFFIX_AR[m[3]]}` : ""}`;
}

export function useFirmText() {
  const { t, locale } = useTranslation();
  const isAr = locale === "ar";
  const catalog = t as Record<string, string>;
  return {
    isAr,
    locale,
    /** Inline bilingual copy. */
    b: (en: string, ar: string) => (isAr ? ar : en),
    /** Localise a known firm dashboard / helper sentence; unknown text is returned as is. */
    fx: (text: string | null | undefined): string => {
      if (!text) return "";
      return isAr ? localizeMonths(localizeFirmText(text, catalog)) : text;
    },
    /** Workpaper / VAT row status word (draft, in_review, ...). */
    status: (value: string | null | undefined): string => {
      const key = String(value ?? "").toLowerCase();
      const ar: Record<string, string> = {
        draft: "مسودة",
        in_review: "قيد المراجعة",
        prepared: "مُعدّ",
        reviewed: "تمت المراجعة",
        filed: "مُقدَّم",
        locked: "مقفل",
        approved: "معتمد",
        excluded: "مستبعد",
        open: "مفتوح",
        ready: "جاهز",
      };
      if (!isAr) return String(value ?? "");
      return ar[key] ?? String(value ?? "");
    },
    /** VAT 201 box / category / emirate label in the reader's language. */
    vat: (label: string): string => (isAr ? localizeVatLabel(label) : label),
    /** Short date, e.g. "Oct 28" / "28 أكتوبر". */
    fdShort: (date: string | null | undefined): string => {
      if (!date) return "—";
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return "—";
      return new Intl.DateTimeFormat(isAr ? "ar-AE-u-nu-latn" : "en-US", {
        month: "short",
        day: "numeric",
      }).format(d);
    },
    /** Date + time, e.g. "Nov 16, 12:17". */
    fdTime: (date: string): string =>
      new Intl.DateTimeFormat(isAr ? "ar-AE-u-nu-latn" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(date)),
  };
}
