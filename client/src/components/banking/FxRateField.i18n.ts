import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "FxRateField",
  {
    label: "Exchange rate on this day (AED per 1 {currency})",
    hintFound: "Rate on file for {date}. Change it to the rate the bank actually used.",
    hintMissing: "No {currency} rate is on file for this day. Enter the rate the bank used.",
    reset: "Use the rate on file",
    invalid: "Enter a positive rate.",
    inAed: "In AED",
    atDocument: "At the document rate",
    atPayment: "At this day's rate",
    gain: "Realised exchange gain",
    loss: "Realised exchange loss",
    none: "No exchange difference",
    booksTo: "Posted to {account}",
    account4090: "Exchange gain (4090)",
    account5140: "Exchange loss (5140)",
  },
  {
    label: "سعر الصرف في هذا اليوم (درهم لكل 1 {currency})",
    hintFound: "السعر المسجّل بتاريخ {date}. عدّله إلى السعر الذي استخدمه البنك فعلًا.",
    hintMissing: "لا يوجد سعر {currency} مسجّل لهذا اليوم. أدخل السعر الذي استخدمه البنك.",
    reset: "استخدام السعر المسجّل",
    invalid: "أدخل سعرًا موجبًا.",
    inAed: "بالدرهم",
    atDocument: "بسعر المستند",
    atPayment: "بسعر هذا اليوم",
    gain: "ربح صرف محقَّق",
    loss: "خسارة صرف محقَّقة",
    none: "لا يوجد فرق صرف",
    booksTo: "يُرحَّل إلى {account}",
    account4090: "أرباح الصرف (4090)",
    account5140: "خسائر الصرف (5140)",
  }
);
