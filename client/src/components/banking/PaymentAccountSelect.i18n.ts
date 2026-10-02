import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "PaymentAccountSelect",
  {
    label: "Paid from",
    placeholder: "Select a bank or cash account",
    hint: "The bank or cash account the money leaves. It is the account the bank statement is matched against.",
    none: "There is no bank or cash account yet. Add a bank account first.",
  },
  {
    label: "المدفوع من",
    placeholder: "اختر حساب بنك أو نقد",
    hint: "حساب البنك أو النقد الذي يخرج منه المبلغ. وهو الحساب الذي يُطابق كشف البنك معه.",
    none: "لا يوجد حساب بنك أو نقد بعد. أضف حسابًا بنكيًا أولًا.",
  }
);
