import type { SiteLocale } from "../../routes";

/**
 * The few invoice labels the hero shows when its invoice "flips" to the other language. A small
 * keyed const instead of a second catalog, so the hero only ever loads the active locale's text.
 * Wording mirrors the hxHeroInv* catalog entries.
 */
export interface InvoiceLabels {
  title: string;
  customer: string;
  line1: string;
  line2: string;
  subtotal: string;
  vat: string;
  total: string;
}

export const FLIP_INVOICE: Record<SiteLocale, InvoiceLabels> = {
  en: {
    title: "Tax invoice",
    customer: "Al Noor Retail FZCO",
    line1: "Monthly bookkeeping",
    line2: "VAT advisory session",
    subtotal: "Subtotal",
    vat: "VAT 5%",
    total: "Total",
  },
  ar: {
    title: "فاتورة ضريبية",
    customer: "النور للتجزئة ش.م.ح",
    line1: "مسك الدفاتر الشهري",
    line2: "جلسة استشارة في ضريبة القيمة المضافة",
    subtotal: "المجموع قبل الضريبة",
    vat: "ضريبة 5%",
    total: "الإجمالي",
  },
};
