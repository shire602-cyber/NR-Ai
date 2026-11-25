import type { Bilingual } from "./content";

export const audiences = [
  {
    slug: "small-business",
    title: ["Small and medium businesses", "الشركات الصغيرة والمتوسطة"],
    lead: [
      "Send your invoices, capture expenses and give your accountant access to the same books.",
      "أرسل فواتيرك وسجّل مصروفاتك وامنح محاسبك وصولاً إلى الدفاتر نفسها.",
    ],
    links: ["invoicing", "receipt-scanning", "vat", "bank-reconciliation"],
  },
  {
    slug: "accounting-firms",
    title: ["Accounting firms", "مكاتب المحاسبة"],
    lead: [
      "Work across client companies, review their books and invite clients to the portal.",
      "اعمل عبر شركات عملائك وراجع دفاترهم وادعهم إلى بوابة العملاء.",
    ],
    links: ["bookkeeping", "reporting", "vat", "client-portal"],
  },
] as const satisfies readonly {
  slug: string;
  title: Bilingual;
  lead: Bilingual;
  links: readonly string[];
}[];
