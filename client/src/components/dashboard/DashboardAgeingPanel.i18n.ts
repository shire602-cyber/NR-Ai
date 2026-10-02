import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "DashboardAgeingPanel",
  {
    periodLabel: "Period",
    monthToDate: "This month",
    yearToDate: "Fiscal year to date",
    periodRange: "{from} to {to}",
    receivables: "Receivables",
    payables: "Payables",
    totalOpen: "Open",
    overdue: "Overdue",
    notYetDue: "Not yet due",
    days1to30: "1 to 30 days late",
    days31to60: "31 to 60 days late",
    days61to90: "61 to 90 days late",
    days90plus: "Over 90 days late",
    missingDueDate:
      "{count} open invoices have no due date. They are aged as issue date plus 30 days.",
    missingDueDateOne: "1 open invoice has no due date. It is aged as issue date plus 30 days.",
    payablesNote:
      "Approved vendor bills only, net of payments and vendor credits. It equals Accounts payable in the ledger.",
    receivablesNote:
      "Issued invoices less payments and credit notes. It equals Accounts receivable for AED invoices.",
    openAgingReport: "Open the full ageing report",
    nothingOpen: "Nothing open.",
    vatDueNext: "VAT due next",
    vatAmountDue: "Net VAT payable",
    vatPeriodEnd: "Period ending {date}",
    vatDueOn: "Due {date}",
    vatDaysLeft: "{count} days left",
    vatDueToday: "Due today",
    vatOverdue: "{count} days overdue",
    vatOpenFiling: "Open VAT filing",
    vatNoTrn: "Add your tax registration number to see the VAT you owe next.",
    vatNoEmirate: "Set your emirate so the VAT return can be worked out.",
    vatUnavailable: "The next VAT payment could not be worked out right now.",
    vatFixSettings: "Open company profile",
    periodNote:
      "Revenue, expenses and profit are for the selected period. Cash, receivables and payables are as at today.",
  },
  {
    periodLabel: "الفترة",
    monthToDate: "هذا الشهر",
    yearToDate: "السنة المالية حتى تاريخه",
    periodRange: "من {from} إلى {to}",
    receivables: "الذمم المدينة",
    payables: "الذمم الدائنة",
    totalOpen: "المفتوح",
    overdue: "متأخرة",
    notYetDue: "لم يحن موعده",
    days1to30: "متأخر من 1 إلى 30 يومًا",
    days31to60: "متأخر من 31 إلى 60 يومًا",
    days61to90: "متأخر من 61 إلى 90 يومًا",
    days90plus: "متأخر أكثر من 90 يومًا",
    missingDueDate:
      "{count} فواتير مفتوحة بلا تاريخ استحقاق. تُصنَّف أعمارها بتاريخ الإصدار زائد 30 يومًا.",
    missingDueDateOne:
      "فاتورة مفتوحة واحدة بلا تاريخ استحقاق. يُصنَّف عمرها بتاريخ الإصدار زائد 30 يومًا.",
    payablesNote:
      "فواتير الموردين المعتمدة فقط، بعد خصم الدفعات وإشعارات المورّدين. تساوي الذمم الدائنة في دفتر الأستاذ.",
    receivablesNote:
      "الفواتير الصادرة مطروحًا منها الدفعات والإشعارات الدائنة. تساوي الذمم المدينة للفواتير بالدرهم.",
    openAgingReport: "فتح تقرير الأعمار الكامل",
    nothingOpen: "لا شيء مفتوح.",
    vatDueNext: "ضريبة القيمة المضافة المستحقة تاليًا",
    vatAmountDue: "صافي ضريبة القيمة المضافة المستحقة",
    vatPeriodEnd: "الفترة المنتهية في {date}",
    vatDueOn: "تستحق في {date}",
    vatDaysLeft: "متبقٍ {count} يومًا",
    vatDueToday: "تستحق اليوم",
    vatOverdue: "متأخرة {count} يومًا",
    vatOpenFiling: "فتح تقديم الإقرار",
    vatNoTrn: "أضف رقم التسجيل الضريبي لترى ضريبة القيمة المضافة المستحقة تاليًا.",
    vatNoEmirate: "حدد الإمارة حتى يمكن احتساب الإقرار الضريبي.",
    vatUnavailable: "تعذر احتساب الدفعة الضريبية التالية الآن.",
    vatFixSettings: "فتح ملف الشركة",
    periodNote:
      "الإيرادات والمصروفات والربح للفترة المحددة. أما النقد والذمم المدينة والدائنة فكما في اليوم.",
  }
);
