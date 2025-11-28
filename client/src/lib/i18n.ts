// Internationalization utilities for English/Arabic support
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Locale = 'en' | 'ar';

interface I18nStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18n = create<I18nStore>()(
  persist(
    (set) => ({
      locale: 'en',
      setLocale: (locale) => {
        set({ locale });
        document.documentElement.lang = locale;
        document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
      },
    }),
    {
      name: 'i18n-storage',
    }
  )
);

// Translation dictionary
export const t = {
  en: {
    // Navigation
    dashboard: 'Dashboard',
    companies: 'Companies',
    accounts: 'Chart of Accounts',
    invoices: 'Invoices',
    receipts: 'Expenses',
    journal: 'Journal Entries',
    reports: 'Reports',
    aiTools: 'AI Tools',
    settings: 'Settings',
    logout: 'Logout',
    
    // Auth
    login: 'Login',
    register: 'Register',
    email: 'Email',
    password: 'Password',
    name: 'Full Name',
    signIn: 'Sign In',
    signUp: 'Sign Up',
    dontHaveAccount: "Don't have an account?",
    alreadyHaveAccount: 'Already have an account?',
    
    // Company
    createCompany: 'Create Company',
    companyName: 'Company Name',
    baseCurrency: 'Base Currency',
    language: 'Language',
    english: 'English',
    arabic: 'Arabic',
    switchCompany: 'Switch Company',
    
    // Dashboard
    revenue: 'Revenue',
    expenses: 'Expenses',
    profit: 'Profit',
    outstanding: 'Outstanding',
    recentInvoices: 'Recent Invoices',
    expenseBreakdown: 'Expense Breakdown',
    
    // Invoices
    newInvoice: 'New Invoice',
    invoiceNumber: 'Invoice Number',
    customerName: 'Customer Name',
    customerTRN: 'Customer TRN',
    date: 'Date',
    status: 'Status',
    draft: 'Draft',
    sent: 'Sent',
    paid: 'Paid',
    void: 'Void',
    subtotal: 'Subtotal',
    vat: 'VAT',
    total: 'Total',
    addLine: 'Add Line',
    description: 'Description',
    quantity: 'Quantity',
    unitPrice: 'Unit Price',
    amount: 'Amount',
    
    // Journal
    newEntry: 'New Entry',
    memo: 'Memo',
    debit: 'Debit',
    credit: 'Credit',
    balance: 'Balance',
    balanced: 'Balanced',
    notBalanced: 'Not Balanced',
    
    // Accounts
    accountCode: 'Account Code',
    accountName: 'Account Name',
    type: 'Type',
    asset: 'Asset',
    liability: 'Liability',
    equity: 'Equity',
    income: 'Income',
    expense: 'Expense',
    
    // AI
    aiCategorize: 'AI Categorize',
    aiCfo: 'AI CFO & Financial Advisor',
    integrations: 'Integrations',
    whatsappInbox: 'WhatsApp Inbox',
    transactionDescription: 'Transaction Description',
    suggestedAccount: 'Suggested Account',
    confidence: 'Confidence',
    categorize: 'Categorize',
    
    // Reports
    profitLoss: 'Profit & Loss',
    balanceSheet: 'Balance Sheet',
    vatSummary: 'VAT Summary',
    export: 'Export',
    
    // Common
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    search: 'Search',
    filter: 'Filter',
    loading: 'Loading...',
    noData: 'No data available',
    error: 'Error',
  },
  ar: {
    // Navigation
    dashboard: 'لوحة التحكم',
    companies: 'الشركات',
    accounts: 'دليل الحسابات',
    invoices: 'الفواتير',
    receipts: 'المصروفات',
    journal: 'القيود',
    reports: 'التقارير',
    aiTools: 'أدوات الذكاء الاصطناعي',
    settings: 'الإعدادات',
    logout: 'تسجيل الخروج',
    
    // Auth
    login: 'تسجيل الدخول',
    register: 'تسجيل حساب جديد',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    name: 'الاسم الكامل',
    signIn: 'دخول',
    signUp: 'إنشاء حساب',
    dontHaveAccount: 'ليس لديك حساب؟',
    alreadyHaveAccount: 'لديك حساب؟',
    
    // Company
    createCompany: 'إنشاء شركة',
    companyName: 'اسم الشركة',
    baseCurrency: 'العملة الأساسية',
    language: 'اللغة',
    english: 'الإنجليزية',
    arabic: 'العربية',
    switchCompany: 'تبديل الشركة',
    
    // Dashboard
    revenue: 'الإيرادات',
    expenses: 'المصروفات',
    profit: 'الربح',
    outstanding: 'المستحق',
    recentInvoices: 'الفواتير الأخيرة',
    expenseBreakdown: 'تفصيل المصروفات',
    
    // Invoices
    newInvoice: 'فاتورة جديدة',
    invoiceNumber: 'رقم الفاتورة',
    customerName: 'اسم العميل',
    customerTRN: 'الرقم الضريبي للعميل',
    date: 'التاريخ',
    status: 'الحالة',
    draft: 'مسودة',
    sent: 'مرسلة',
    paid: 'مدفوعة',
    void: 'ملغاة',
    subtotal: 'المجموع الفرعي',
    vat: 'ضريبة القيمة المضافة',
    total: 'المجموع',
    addLine: 'إضافة بند',
    description: 'الوصف',
    quantity: 'الكمية',
    unitPrice: 'سعر الوحدة',
    amount: 'المبلغ',
    
    // Journal
    newEntry: 'قيد جديد',
    memo: 'ملاحظة',
    debit: 'مدين',
    credit: 'دائن',
    balance: 'الرصيد',
    balanced: 'متوازن',
    notBalanced: 'غير متوازن',
    
    // Accounts
    accountCode: 'رمز الحساب',
    accountName: 'اسم الحساب',
    type: 'النوع',
    asset: 'أصول',
    liability: 'خصوم',
    equity: 'حقوق ملكية',
    income: 'إيرادات',
    expense: 'مصروفات',
    
    // AI
    aiCategorize: 'التصنيف الذكي',
    aiCfo: 'مستشار مالي بالذكاء الاصطناعي',
    integrations: 'التكاملات',
    whatsappInbox: 'صندوق الواتساب',
    transactionDescription: 'وصف المعاملة',
    suggestedAccount: 'الحساب المقترح',
    confidence: 'مستوى الثقة',
    categorize: 'تصنيف',
    
    // Reports
    profitLoss: 'الأرباح والخسائر',
    balanceSheet: 'الميزانية العمومية',
    vatSummary: 'ملخص ضريبة القيمة المضافة',
    export: 'تصدير',
    
    // Common
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    search: 'بحث',
    filter: 'تصفية',
    loading: 'جاري التحميل...',
    noData: 'لا توجد بيانات',
    error: 'خطأ',
  },
};

export function useTranslation() {
  const { locale } = useI18n();
  return { t: t[locale], locale };
}
