import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "BankAccountsPanel",
  {
    title: "Bank accounts",
    description: "The accounts your statements belong to. Each one is linked to a ledger account.",
    add: "Add bank account",
    empty: "No bank accounts yet.",
    emptyHint: "Add one to import statements and reconcile.",
    edit: "Edit",
    colName: "Account",
    colBank: "Bank",
    colCurrency: "Currency",
    colLedger: "Ledger account",
    colFrom: "Reconcile from",
    colStatus: "Status",
    active: "Active",
    inactive: "Inactive",
    noLedger: "Not linked",
  },
  {
    title: "الحسابات البنكية",
    description: "الحسابات التي تنتمي إليها كشوفك. كل حساب مرتبط بحساب في دفتر الأستاذ.",
    add: "إضافة حساب بنكي",
    empty: "لا توجد حسابات بنكية بعد.",
    emptyHint: "أضف حسابًا لاستيراد الكشوف وإجراء التسوية.",
    edit: "تعديل",
    colName: "الحساب",
    colBank: "البنك",
    colCurrency: "العملة",
    colLedger: "حساب دفتر الأستاذ",
    colFrom: "التسوية من",
    colStatus: "الحالة",
    active: "نشط",
    inactive: "غير نشط",
    noLedger: "غير مرتبط",
  }
);
