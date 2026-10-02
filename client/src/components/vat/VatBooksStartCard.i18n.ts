import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "VatBooksStartCard",
  {
    title: "VAT books start",
    description:
      "Muhasib books start from this VAT period. Earlier periods are left out of VAT Filing and VAT Autopilot, so returns you filed before moving to Muhasib are not listed as overdue.",
    label: "First VAT period kept in Muhasib",
    hint: "Enter the first day of the first period Muhasib keeps, for example 1 July 2026 for a quarter that starts then. Leave blank to list every period back to your VAT registration.",
    rule: "Enter the first day of a month.",
    save: "Save",
    saving: "Saving...",
    clear: "Clear",
    savedTitle: "VAT books start saved",
    savedDescription: "VAT Filing and VAT Autopilot now start from this period.",
    clearedDescription: "VAT Filing and VAT Autopilot list every period again.",
    failedTitle: "Could not save the VAT books start",
  },
  {
    title: "بداية دفاتر ضريبة القيمة المضافة",
    description:
      "تبدأ دفاتر مُحاسِب من هذه الفترة الضريبية. تُستبعد الفترات الأسبق من تقديم الإقرارات ومن الطيار الآلي للضريبة، فلا تظهر الإقرارات التي قدّمتها قبل الانتقال إلى مُحاسِب كمتأخرة.",
    label: "أول فترة ضريبية تُحفظ في مُحاسِب",
    hint: "أدخل أول يوم من أول فترة يحتفظ بها مُحاسِب، مثلًا 1 يوليو 2026 لربع يبدأ حينها. اتركه فارغًا لعرض كل الفترات منذ التسجيل في ضريبة القيمة المضافة.",
    rule: "أدخل أول يوم من الشهر.",
    save: "حفظ",
    saving: "جارٍ الحفظ...",
    clear: "مسح",
    savedTitle: "حُفظت بداية دفاتر الضريبة",
    savedDescription: "يبدأ تقديم الإقرارات والطيار الآلي للضريبة الآن من هذه الفترة.",
    clearedDescription: "يعرض تقديم الإقرارات والطيار الآلي للضريبة كل الفترات من جديد.",
    failedTitle: "تعذّر حفظ بداية دفاتر الضريبة",
  }
);
