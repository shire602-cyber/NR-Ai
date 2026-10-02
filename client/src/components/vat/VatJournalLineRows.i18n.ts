import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "VatJournalLineRows",
  {
    journal: "Journal {number}",
    adjustmentBadge: "Adjustment",
    saleBadge: "Taxable sale by journal",
    purchaseBadge: "Purchase by journal",
    blockedPurchaseBadge: "Blocked input VAT",
    purchaseHint: "Recorded by manual journal: expense and input VAT in the same entry",
    blockedPurchaseHint: "Blocked category (Art. 53): not part of box 9, the VAT is part of the expense",
    noDescription: "(no description)",
    adjustmentHint: "Manual VAT journal, included in the adjustment column",
    saleHint: "Recorded by manual journal: revenue and output VAT in the same entry",
  },
  {
    journal: "قيد {number}",
    adjustmentBadge: "تسوية",
    saleBadge: "مبيعات خاضعة للضريبة بقيد يومية",
    purchaseBadge: "مشتريات بقيد يومية",
    blockedPurchaseBadge: "ضريبة مدخلات محظورة",
    purchaseHint: "مسجّلة بقيد يدوي: المصروف وضريبة المدخلات في القيد نفسه",
    blockedPurchaseHint: "فئة محظورة (المادة 53): ليست ضمن الخانة 9، والضريبة جزء من المصروف",
    noDescription: "(بدون وصف)",
    adjustmentHint: "قيد ضريبة يدوي، مشمول في عمود التسوية",
    saleHint: "مسجّل بقيد يدوي: الإيراد وضريبة المخرجات في القيد نفسه",
  }
);
