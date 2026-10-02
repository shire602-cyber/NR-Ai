import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "FiledElsewhereDialog",
  {
    action: "Filed outside Muhasib",
    title: "Mark {period} as filed outside Muhasib?",
    explained:
      "Use this for a return you already filed with the FTA from another system. Muhasib records the period as filed, posts nothing to your books and does not change any figures.",
    filingDateLabel: "Filing date",
    filingDateRule: "Pick the day you filed: on or after the period end and not in the future.",
    referenceLabel: "FTA reference (optional)",
    referencePlaceholder: "For example the FTA acknowledgement number",
    auditNote: "This is recorded in the audit log.",
    auditLink: "See these entries",
    cancel: "Cancel",
    confirm: "Mark as filed",
    saving: "Saving...",
    doneTitle: "Period marked as filed",
    doneDescription: "{period} is recorded as filed outside Muhasib.",
    failedTitle: "Could not mark the period as filed",
    errAlreadyFiled: "This period already has a filed return.",
    errNotEnded: "This VAT period has not ended yet, so it cannot be marked as filed.",
    errInvalidPeriod: "This is not a valid VAT period for this company.",
    errFilingDate: "The filing date cannot be before the period ended or in the future.",
  },
  {
    action: "قُدِّم خارج مُحاسِب",
    title: "تسجيل {period} كمُقدَّم خارج مُحاسِب؟",
    explained:
      "استخدم هذا لإقرار قدّمته بالفعل إلى الهيئة الاتحادية للضرائب من نظام آخر. يسجّل مُحاسِب الفترة كمُقدَّمة دون ترحيل أي قيود إلى دفاترك ودون تغيير أي أرقام.",
    filingDateLabel: "تاريخ التقديم",
    filingDateRule: "اختر يوم التقديم: في تاريخ نهاية الفترة أو بعده وليس في المستقبل.",
    referenceLabel: "رقم مرجع الهيئة (اختياري)",
    referencePlaceholder: "مثلًا رقم إشعار الاستلام من الهيئة",
    auditNote: "يُسجَّل هذا الإجراء في سجل التدقيق.",
    auditLink: "عرض هذه القيود",
    cancel: "إلغاء",
    confirm: "تسجيل كمُقدَّم",
    saving: "جارٍ الحفظ...",
    doneTitle: "سُجّلت الفترة كمُقدَّمة",
    doneDescription: "سُجّلت {period} كمُقدَّمة خارج مُحاسِب.",
    failedTitle: "تعذّر تسجيل الفترة كمُقدَّمة",
    errAlreadyFiled: "لهذه الفترة إقرار مُقدَّم بالفعل.",
    errNotEnded: "لم تنتهِ هذه الفترة الضريبية بعد، لذا لا يمكن تسجيلها كمُقدَّمة.",
    errInvalidPeriod: "هذه ليست فترة ضريبية صالحة لهذه الشركة.",
    errFilingDate: "لا يمكن أن يكون تاريخ التقديم قبل انتهاء الفترة أو في المستقبل.",
  }
);
