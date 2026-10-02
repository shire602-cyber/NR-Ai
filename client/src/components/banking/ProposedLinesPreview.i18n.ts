import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ProposedLinesPreview",
  {
    heading: "What will be posted",
    account: "Account",
    debit: "Debit",
    credit: "Credit",
    total: "Total",
    linkOnly: "Links the bank line to an entry that is already posted. Nothing new is posted.",
  },
  {
    heading: "ما الذي سيُرحَّل",
    account: "الحساب",
    debit: "مدين",
    credit: "دائن",
    total: "الإجمالي",
    linkOnly: "يربط السطر البنكي بقيد مرحّل مسبقًا. لا يُرحَّل شيء جديد.",
  }
);
