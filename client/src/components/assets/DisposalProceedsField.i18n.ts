import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "DisposalProceedsField",
  {
    label: "Proceeds received in",
    placeholder: "Cash (1010), the default",
    defaultOption: "Cash (1010), the default",
    hint: "The bank or cash account the sale money arrived in. Only active bank and cash accounts of this company are offered.",
  },
  {
    label: "المتحصلات مُودَعة في",
    placeholder: "الصندوق (1010)، الافتراضي",
    defaultOption: "الصندوق (1010)، الافتراضي",
    hint: "حساب البنك أو النقد الذي وصلت إليه أموال البيع. تُعرض حسابات البنك والنقد النشطة في هذه الشركة فقط.",
  }
);
