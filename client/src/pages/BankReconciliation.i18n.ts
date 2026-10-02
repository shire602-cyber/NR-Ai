import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "BankReconciliation",
  {
    accounting: "Accounting",
    tabTransactions: "Transactions",
    tabImport: "Import",
    tabFeeds: "Bank feeds",
    tabReconciliation: "Reconciliation",
    reviewSuggestions: "Review suggestions",
    importStatement: "Import statement",
    noBankAccountsTitle: "Add a bank account first",
    noBankAccountsBody: "Create a bank account linked to a ledger account before importing statements.",
    loadFailed: "Bank accounts could not be loaded.",
  },
  {
    accounting: "المحاسبة",
    tabTransactions: "المعاملات",
    tabImport: "استيراد",
    tabFeeds: "الربط البنكي",
    tabReconciliation: "التسوية",
    reviewSuggestions: "مراجعة الاقتراحات",
    importStatement: "استيراد كشف",
    noBankAccountsTitle: "أضف حسابًا بنكيًا أولًا",
    noBankAccountsBody: "أنشئ حسابًا بنكيًا مرتبطًا بحساب في دفتر الأستاذ قبل استيراد الكشوف.",
    loadFailed: "تعذّر تحميل الحسابات البنكية.",
  }
);
