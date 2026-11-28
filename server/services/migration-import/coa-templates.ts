/**
 * Industry chart-of-accounts templates for onboarding (W5-B, R19-18). Every
 * company starts from the UAE default chart (server/defaultChartOfAccounts.ts);
 * a template adds the accounts an industry needs on top of it. Existing codes
 * are never touched.
 */
import type { MappedAccountType } from "./mappers";

export interface TemplateAccount extends MappedAccountType {
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface CoaTemplate {
  id: string;
  label: { en: string; ar: string };
  accounts: TemplateAccount[];
}

const a = (
  code: string,
  nameEn: string,
  nameAr: string,
  type: TemplateAccount["type"],
  subType: string
): TemplateAccount => ({ code, nameEn, nameAr, type, subType });

export const COA_TEMPLATES: readonly CoaTemplate[] = [
  { id: "general", label: { en: "General business", ar: "نشاط تجاري عام" }, accounts: [] },
  {
    id: "trading",
    label: { en: "Trading / wholesale", ar: "تجارة / جملة" },
    accounts: [
      a("1075", "Goods in Transit", "بضائع بالطريق", "asset", "inventory"),
      a("4015", "Export Sales", "مبيعات التصدير", "income", "operating_revenue"),
      a("5006", "Freight & Customs Duty", "الشحن والرسوم الجمركية", "expense", "cost_of_sales"),
    ],
  },
  {
    id: "services",
    label: { en: "Professional services", ar: "خدمات مهنية" },
    accounts: [
      a("1085", "Unbilled Revenue (WIP)", "إيرادات غير مفوترة", "asset", "other_current_asset"),
      a("4025", "Retainer Fees", "أتعاب مقدمة", "income", "operating_revenue"),
      a("5075", "Subcontractor Costs", "تكاليف المقاولين من الباطن", "expense", "cost_of_sales"),
    ],
  },
  {
    id: "food_beverage",
    label: { en: "Restaurant / F&B", ar: "مطاعم / أغذية ومشروبات" },
    accounts: [
      a("1071", "Food & Beverage Inventory", "مخزون الأغذية والمشروبات", "asset", "inventory"),
      a("4016", "Delivery Platform Sales", "مبيعات منصات التوصيل", "income", "operating_revenue"),
      a("5008", "Food Cost", "تكلفة الأغذية", "expense", "cost_of_sales"),
      a(
        "5112",
        "Delivery Platform Commissions",
        "عمولات منصات التوصيل",
        "expense",
        "operating_expense"
      ),
    ],
  },
  {
    id: "construction",
    label: { en: "Construction / contracting", ar: "مقاولات وبناء" },
    accounts: [
      a("1086", "Retention Receivable", "محتجزات مستحقة القبض", "asset", "other_current_asset"),
      a("2046", "Retention Payable", "محتجزات مستحقة الدفع", "liability", "current_liability"),
      a("5009", "Direct Project Costs", "تكاليف المشاريع المباشرة", "expense", "cost_of_sales"),
    ],
  },
  {
    id: "ecommerce",
    label: { en: "E-commerce", ar: "تجارة إلكترونية" },
    accounts: [
      a("1025", "Payment Gateway Clearing", "حساب تسوية بوابات الدفع", "asset", "bank"),
      a("4017", "Online Store Sales", "مبيعات المتجر الإلكتروني", "income", "operating_revenue"),
      a("5113", "Payment Gateway Fees", "رسوم بوابات الدفع", "expense", "operating_expense"),
      a("5114", "Shipping & Fulfilment", "الشحن والتوصيل", "expense", "cost_of_sales"),
    ],
  },
];

/** UAE TRN: 15 digits; FTA-issued TRNs start with 100. */
export function validateTrnFormat(raw: string): {
  valid: boolean;
  normalized: string;
  reason: string | null;
} {
  const normalized = String(raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d{15}$/.test(normalized)) {
    return { valid: false, normalized, reason: "A UAE TRN has exactly 15 digits" };
  }
  if (!normalized.startsWith("100")) {
    return { valid: false, normalized, reason: "UAE TRNs issued by the FTA start with 100" };
  }
  return { valid: true, normalized, reason: null };
}
