import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "PayrollRecordPayment",
  {
    title: "Record payment",
    help: "Record this after the bank has paid the salaries. It clears Salaries Payable (2030) against the bank account you choose, and only then are the payslips marked Paid.",
    account: "Paid from",
    accountPlaceholder: "Choose a bank or cash account",
    date: "Payment date",
    cancel: "Cancel",
    confirm: "Record payment",
    saving: "Recording...",
    recorded: "Payment recorded",
    recordedBody: "Salaries Payable is cleared and the payslips are marked Paid.",
    failed: "Payment not recorded",
  },
  {
    title: "تسجيل دفعة",
    help: "سجّل هذا بعد أن يدفع البنك الرواتب. يُقفل رصيد الرواتب المستحقة (2030) مقابل الحساب البنكي الذي تختاره، وعندها فقط تُوسم قسائم الرواتب كمدفوعة.",
    account: "المدفوع من",
    accountPlaceholder: "اختر حسابًا بنكيًا أو نقديًا",
    date: "تاريخ الدفع",
    cancel: "إلغاء",
    confirm: "تسجيل دفعة",
    saving: "جارٍ التسجيل...",
    recorded: "تم تسجيل الدفع",
    recordedBody: "تم إقفال الرواتب المستحقة ووسم قسائم الرواتب كمدفوعة.",
    failed: "لم يُسجَّل الدفع",
  },
);
