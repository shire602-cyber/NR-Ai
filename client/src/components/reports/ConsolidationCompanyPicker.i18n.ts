import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ConsolidationCompanyPicker",
  {
    title: "Companies to consolidate",
    hint: "Pick the group companies to combine. Intercompany balances are eliminated when accounts name the company on the other side.",
    statement: "Statement",
    profitLoss: "Profit and loss",
    balanceSheet: "Balance sheet",
    selectedCount: "{count} of {max} selected",
    none: "Choose at least one company.",
    tooMany: "At most {max} companies can be consolidated.",
    mixedCurrency:
      "These companies use different base currencies. Consolidation does not translate currencies, so choose companies with one base currency.",
    onlyOne:
      "You can access one company only. Consolidation needs two or more to eliminate intercompany balances.",
    currentCompany: "(current)",
    strictLabel: "Refuse the statement when intercompany balances do not match",
    strictHint:
      "By default a pair that does not match is left un-eliminated and shown as a warning row with its difference.",
  },
  {
    title: "الشركات المراد توحيدها",
    hint: "اختر شركات المجموعة المراد دمجها. تُستبعد الأرصدة بين الشركات عندما تحدد الحسابات الشركة المقابلة.",
    statement: "القائمة",
    profitLoss: "الأرباح والخسائر",
    balanceSheet: "الميزانية العمومية",
    selectedCount: "تم اختيار {count} من {max}",
    none: "اختر شركة واحدة على الأقل.",
    tooMany: "يمكن توحيد {max} شركة كحد أقصى.",
    mixedCurrency:
      "تستخدم هذه الشركات عملات أساسية مختلفة. لا يترجم التوحيد العملات، لذا اختر شركات بعملة أساسية واحدة.",
    onlyOne:
      "يمكنك الوصول إلى شركة واحدة فقط. يحتاج التوحيد إلى شركتين أو أكثر لاستبعاد الأرصدة بين الشركات.",
    currentCompany: "(الحالية)",
    strictLabel: "رفض القائمة عند عدم تطابق الأرصدة بين الشركات",
    strictHint: "افتراضيًا يُترك الزوج غير المتطابق دون استبعاد ويظهر كصف تحذير مع الفرق.",
  }
);
