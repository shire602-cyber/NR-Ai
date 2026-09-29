import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ChartOfAccounts",
  {
    assets: "Assets",
    liabilities: "Liabilities",
    equity: "Equity",
    revenue: "Revenue",
    expenses: "Expenses",
    setUpYourCompany: "Set up your company",
    youNeedACompanyBeforeYou: "You need a company before you can configure your Chart of Accounts.",
    createYourCompany: "Create your company",
    accounting: "Accounting",
    dr: "Dr: {formatCurrency}",
    cr: "Cr: {formatCurrency}",
  },
  {
    assets: "الأصول",
    liabilities: "الخصوم",
    equity: "حقوق الملكية",
    revenue: "الإيرادات",
    expenses: "المصروفات",
    setUpYourCompany: "جهّز شركتك",
    youNeedACompanyBeforeYou: "تحتاج إلى شركة قبل أن تتمكن من إعداد دليل الحسابات.",
    createYourCompany: "أنشئ شركتك",
    accounting: "المحاسبة",
    dr: "مدين: {formatCurrency}",
    cr: "دائن: {formatCurrency}",
  }
);
