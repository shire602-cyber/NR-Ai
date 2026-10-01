import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "CustomerStatementDialog",
  {
    title: "Statement of account",
    description:
      "Choose the period. The statement lists every invoice, credit note and payment with a running balance, then the closing balance and ageing.",
    from: "From",
    to: "To",
    invalidPeriod: "Choose a start date that is on or before the end date",
    downloadPdf: "Download PDF",
    sendEmail: "Send by email",
    sending: "Sending...",
    recipient: "Recipient email",
    recipientHint: "Leave empty to use the customer's email address",
    sent: "Statement sent",
    sendFailed: "The statement could not be sent",
    emailNotConfigured:
      "Email is not configured on this server, so nothing was sent. Ask the administrator to set it up.",
    pdfFailed: "Could not create the statement",
    close: "Close",
  },
  {
    title: "كشف حساب العميل",
    description:
      "اختر الفترة. يعرض الكشف كل فاتورة وإشعار دائن ودفعة مع الرصيد الجاري، ثم الرصيد الختامي وأعمار الديون.",
    from: "من",
    to: "إلى",
    invalidPeriod: "اختر تاريخ بداية لا يتجاوز تاريخ النهاية",
    downloadPdf: "تنزيل PDF",
    sendEmail: "إرسال بالبريد الإلكتروني",
    sending: "جارٍ الإرسال...",
    recipient: "البريد الإلكتروني للمستلم",
    recipientHint: "اتركه فارغاً لاستخدام البريد الإلكتروني للعميل",
    sent: "تم إرسال الكشف",
    sendFailed: "تعذر إرسال الكشف",
    emailNotConfigured:
      "البريد الإلكتروني غير مُعدّ على هذا الخادم، لذلك لم يُرسل شيء. اطلب من المسؤول إعداده.",
    pdfFailed: "تعذر إنشاء الكشف",
    close: "إغلاق",
  }
);
