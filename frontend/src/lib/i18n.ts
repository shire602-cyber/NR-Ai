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
    chartOfAccounts: 'Chart of Accounts',
    accounts: 'Manage Accounts',
    invoices: 'Invoices',
    receipts: 'Expenses',
    journal: 'Journal Entries',
    reports: 'Financial Reports',
    aiTools: 'AI Tools',
    settings: 'Settings',
    logout: 'Logout',
    contacts: 'Customer Contacts',
    
    // Sidebar sections
    smartAccounting: 'Smart Accounting',
    overview: 'Overview',
    myPortal: 'My Portal',
    reportsSection: 'Reports',
    accounting: 'Accounting',
    clientPortal: 'Client Portal',
    adminPanel: 'Admin Panel',
    
    // Client portal items
    documentVault: 'Document Vault',
    taxReturnArchive: 'Tax Return Archive',
    complianceCalendar: 'Compliance Calendar',
    taskCenter: 'Task Center',
    newsFeed: 'UAE Tax News',
    
    // Settings items
    history: 'Activity History',
    backupRestore: 'Backup & Restore',
    
    // Admin items
    adminDashboard: 'Admin Dashboard',
    clientManagement: 'Client Management',
    clientDocuments: 'Client Documents',
    userInvitations: 'Invitations',
    clientImport: 'Import Clients',
    userManagement: 'User Management',
    activityLogs: 'Activity Logs',
    systemSettings: 'System Settings',
    
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
    smartAssistant: 'Smart Assistant',
    aiCategorize: 'AI Categorize',
    aiCfo: 'AI CFO & Financial Advisor',
    aiFeatures: 'AI Automation',
    advancedAnalytics: 'Analytics & Forecasts',
    integrationsHub: 'CRM & E-Commerce',
    integrations: 'Integrations',
    whatsappInbox: 'WhatsApp Inbox',
    bankReconciliation: 'Bank Reconciliation',
    vatFiling: 'VAT Filing',
    teamManagement: 'Team Management',
    advancedReports: 'Advanced Reports',
    
    // Engagement
    notifications: 'Notifications',
    reminders: 'Payment Reminders',
    referrals: 'Referral Program',
    feedback: 'Feedback',
    analytics: 'Usage Analytics',
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
    tryAgain: 'Try Again',
    invoiceDeleted: 'Invoice Deleted',
    invoiceDeletedDesc: 'The invoice has been successfully deleted.',
    deleteFailed: 'Delete Failed',
    close: 'Close',
    actions: 'Actions',
    reference: 'Reference',
    import: 'Import',
    inactive: 'Inactive',
    
    // Chart of Accounts
    chartOfAccountsDescription: 'Manage and view all financial accounts for your company',
    addAccount: 'Add Account',
    searchAccounts: 'Search accounts...',
    noResultsFound: 'No results found',
    noAccountsYet: 'No accounts yet',
    tryDifferentKeywords: 'Try searching with different keywords',
    addAccountsToStart: 'Add accounts to start tracking your finances',
    accountsCount: 'accounts',
    balanceSummary: 'Balance Summary',
    
    // Smart Assistant
    askAnything: 'Ask anything about your financial data in plain English',
    greeting: 'Hi! How can I help you today?',
    askAboutFinancialData: 'Ask me about sales, expenses, invoices, or any other financial data.',
    query: 'Query',
    advice: 'Advice',
    action: 'Action',
    suggestedFollowUps: 'Suggested follow-ups:',
    analyzing: 'Analyzing...',
    typeYourQuestion: 'Type your question...',
    typeYourQuestionExample: 'e.g., "What were our total sales this month?"',
    pressEnterToSend: 'Press Enter to send • Supports both English and Arabic',
    
    // Bank Reconciliation
    bankReconciliationDescription: 'Import and match bank transactions with your records',
    autoMatch: 'Auto-Match',
    importCsv: 'Import CSV',
    totalTransactions: 'Total Transactions',
    reconciled: 'Reconciled',
    unreconciled: 'Unreconciled',
    netAmount: 'Net Amount',
    bankTransactions: 'Bank Transactions',
    showReconciled: 'Show Reconciled',
    allAccounts: 'All Accounts',
    noTransactionsFound: 'No transactions found. Import your bank statement to get started.',
    match: 'Match',
    unmatched: 'Unmatched',
    importBankStatement: 'Import Bank Statement',
    uploadBankStatement: 'Upload a CSV or PDF file from your bank to import transactions',
    bankAccount: 'Bank Account',
    selectAccount: 'Select account',
    bankStatementFile: 'Bank Statement File (CSV or PDF)',
    supportedFormats: 'Supported formats:',
    bankStatementsAI: 'Bank statements (AI extraction)',
    matchTransaction: 'Match Transaction',
    suggestedMatches: 'Suggested Matches',
    noMatchesFound: 'No automatic matches found. You can create a manual journal entry.',
    
    // Receipts
    receiptScanner: 'Receipt Scanner',
    receiptScannerDescription: 'Upload receipts for AI extraction or enter manually',
    addExpenseManually: 'Add Expense Manually',
    uploadReceipts: 'Upload Receipts',
    uploadReceiptsDescription: 'Drag & drop receipt images or click to browse (supports bulk upload)',
    recentExpenses: 'Recent Expenses',
    recentExpensesDescription: 'Previously scanned and saved expenses',
  },
  ar: {
    // Navigation
    dashboard: 'لوحة التحكم',
    companies: 'الشركات',
    chartOfAccounts: 'دليل الحسابات',
    accounts: 'إدارة الحسابات',
    invoices: 'الفواتير',
    receipts: 'المصروفات',
    journal: 'القيود',
    reports: 'التقارير المالية',
    aiTools: 'أدوات الذكاء الاصطناعي',
    settings: 'الإعدادات',
    logout: 'تسجيل الخروج',
    contacts: 'جهات الاتصال',
    
    // Sidebar sections
    smartAccounting: 'المحاسبة الذكية',
    overview: 'نظرة عامة',
    myPortal: 'بوابتي',
    reportsSection: 'التقارير',
    accounting: 'المحاسبة',
    clientPortal: 'بوابة العميل',
    adminPanel: 'لوحة الإدارة',
    
    // Client portal items
    documentVault: 'خزنة المستندات',
    taxReturnArchive: 'أرشيف الإقرارات',
    complianceCalendar: 'تقويم الامتثال',
    taskCenter: 'مركز المهام',
    newsFeed: 'أخبار الضرائب',
    
    // Settings items
    history: 'سجل النشاط',
    backupRestore: 'النسخ الاحتياطي',
    
    // Admin items
    adminDashboard: 'لوحة تحكم المدير',
    clientManagement: 'إدارة العملاء',
    clientDocuments: 'مستندات العملاء',
    userInvitations: 'الدعوات',
    clientImport: 'استيراد العملاء',
    userManagement: 'إدارة المستخدمين',
    activityLogs: 'سجل النشاط',
    systemSettings: 'إعدادات النظام',
    
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
    smartAssistant: 'المساعد الذكي',
    aiCategorize: 'التصنيف الذكي',
    aiCfo: 'مستشار مالي بالذكاء الاصطناعي',
    aiFeatures: 'الأتمتة الذكية',
    advancedAnalytics: 'التحليلات والتوقعات',
    integrationsHub: 'إدارة العملاء والتجارة الإلكترونية',
    integrations: 'التكاملات',
    whatsappInbox: 'صندوق الواتساب',
    bankReconciliation: 'التسوية البنكية',
    vatFiling: 'إقرارات الضريبة',
    teamManagement: 'إدارة الفريق',
    advancedReports: 'التقارير المتقدمة',
    
    // Engagement
    notifications: 'الإشعارات',
    reminders: 'تذكيرات الدفع',
    referrals: 'برنامج الإحالة',
    feedback: 'التقييم',
    analytics: 'تحليلات الاستخدام',
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
    tryAgain: 'حاول مرة أخرى',
    invoiceDeleted: 'تم حذف الفاتورة',
    invoiceDeletedDesc: 'تم حذف الفاتورة بنجاح.',
    deleteFailed: 'فشل الحذف',
    close: 'إغلاق',
    actions: 'الإجراءات',
    reference: 'المرجع',
    import: 'استيراد',
    inactive: 'غير نشط',
    
    // Chart of Accounts
    chartOfAccountsDescription: 'إدارة وعرض جميع الحسابات المالية لشركتك',
    addAccount: 'إضافة حساب',
    searchAccounts: 'البحث في الحسابات...',
    noResultsFound: 'لا توجد نتائج',
    noAccountsYet: 'لا توجد حسابات',
    tryDifferentKeywords: 'حاول البحث بكلمات مختلفة',
    addAccountsToStart: 'أضف حسابات لبدء تتبع ماليتك',
    accountsCount: 'حسابات',
    balanceSummary: 'ملخص الأرصدة',
    
    // Smart Assistant
    askAnything: 'اسأل أي شيء عن بياناتك المالية باللغة الطبيعية',
    greeting: 'مرحباً! كيف يمكنني مساعدتك اليوم؟',
    askAboutFinancialData: 'اسألني عن المبيعات، المصروفات، الفواتير، أو أي بيانات مالية أخرى.',
    query: 'استعلام',
    advice: 'نصيحة',
    action: 'إجراء',
    suggestedFollowUps: 'متابعة مقترحة:',
    analyzing: 'جاري التحليل...',
    typeYourQuestion: 'اكتب سؤالك هنا...',
    typeYourQuestionExample: 'مثال: "ما هو إجمالي المبيعات هذا الشهر؟"',
    pressEnterToSend: 'اضغط Enter للإرسال • يدعم اللغتين العربية والإنجليزية',
    
    // Bank Reconciliation
    bankReconciliationDescription: 'استيراد ومطابقة معاملات البنك',
    autoMatch: 'مطابقة تلقائية',
    importCsv: 'استيراد',
    totalTransactions: 'إجمالي المعاملات',
    reconciled: 'تمت التسوية',
    unreconciled: 'غير مسوى',
    netAmount: 'صافي المبلغ',
    bankTransactions: 'معاملات البنك',
    showReconciled: 'إظهار المسوى',
    allAccounts: 'كل الحسابات',
    noTransactionsFound: 'لا توجد معاملات. استورد كشف حسابك البنكي للبدء.',
    match: 'مطابقة',
    unmatched: 'غير مسوى',
    importBankStatement: 'استيراد كشف حساب البنك',
    uploadBankStatement: 'قم بتحميل ملف CSV أو PDF من البنك لاستيراد المعاملات',
    bankAccount: 'حساب البنك',
    selectAccount: 'اختر الحساب',
    bankStatementFile: 'ملف كشف الحساب (CSV أو PDF)',
    supportedFormats: 'الصيغ المدعومة:',
    bankStatementsAI: 'كشوف حساب البنك (استخراج AI)',
    matchTransaction: 'مطابقة المعاملة',
    suggestedMatches: 'المطابقات المقترحة',
    noMatchesFound: 'لم يتم العثور على مطابقات تلقائية. يمكنك إنشاء قيد يدوي.',
    
    // Receipts
    receiptScanner: 'ماسح الإيصالات',
    receiptScannerDescription: 'ارفع إيصالات للاستخراج بالذكاء الاصطناعي أو أدخل يدوياً',
    addExpenseManually: 'إضافة مصروف يدوياً',
    uploadReceipts: 'رفع الإيصالات',
    uploadReceiptsDescription: 'اسحب وأفلت صور الإيصالات أو انقر للتصفح (يدعم الرفع المتعدد)',
    recentExpenses: 'المصروفات الأخيرة',
    recentExpensesDescription: 'المصروفات الممسوحة والمحفوظة مسبقاً',
  },
};

export function useTranslation() {
  const { locale } = useI18n();
  return { t: t[locale], locale };
}
