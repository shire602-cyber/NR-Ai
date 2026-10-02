import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "VatEmirateBreakdown",
  {
    title: "Standard-rated supplies by emirate (box 1)",
    hint: "Each supply is reported in the emirate it is made in, from the invoice's place of supply.",
    colBox: "Box",
    colEmirate: "Emirate",
    colAmount: "Amount (AED)",
    colVat: "VAT (AED)",
    colAdjustment: "Adjustment (AED)",
    total: "Total box 1",
    none: "No standard-rated supplies in this period.",
  },
  {
    title: "التوريدات الخاضعة للنسبة الأساسية حسب الإمارة (الخانة 1)",
    hint: "يُبلَّغ عن كل توريد في الإمارة التي يتم فيها، بحسب مكان التوريد في الفاتورة.",
    colBox: "الخانة",
    colEmirate: "الإمارة",
    colAmount: "المبلغ (درهم)",
    colVat: "الضريبة (درهم)",
    colAdjustment: "التسوية (درهم)",
    total: "إجمالي الخانة 1",
    none: "لا توجد توريدات خاضعة للنسبة الأساسية في هذه الفترة.",
  }
);
