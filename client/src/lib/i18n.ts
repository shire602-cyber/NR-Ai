// Internationalization utilities for English/Arabic support
import { siteLocale } from "@/components/marketing/phase/routes";
import { BANK_RECONCILIATION_COPY } from "@shared/bank-reconciliation-copy";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { FIRM_FIRST_SCREEN_NAMESPACES, LOCALE_COOKIE, firmFirstScreen } from "@shared/firm-boot";

export type Locale = "en" | "ar";

/**
 * Put the locale's direction and language on <html>. main.tsx calls it before the first render
 * (and theme-init.js does the same from the stored preference before the first paint), so an
 * Arabic page never starts left-to-right and flips after mount.
 */
export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.lang = locale;
  html.dir = locale === "ar" ? "rtl" : "ltr";
  html.classList.toggle("rtl", locale === "ar");
  html.classList.toggle("ltr", locale !== "ar");
}

interface I18nStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18n = create<I18nStore>()(
  persist(
    (set) => ({
      locale: "en",
      setLocale: (locale) => {
        set({ locale });
        applyDocumentLocale(locale);
        // S5: namespace catalogs are code-split; fetch the new locale's chunks on switch
        // (D1b: only the namespaces the current route needs).
        void loadLocaleForCurrentRoute(locale);
      },
    }),
    {
      name: "i18n-storage",
      // Only the locale is persisted (never the catalog version below).
      partialize: (state) => ({ locale: state.locale }) as I18nStore,
    }
  )
);

/** Bumped whenever a locale's namespace catalogs finish loading, so hooks re-render. */
const useCatalogVersion = create<{ version: number }>()(() => ({ version: 0 }));

// Base translation dictionary (legacy flat keys). New strings belong in the
// per-namespace catalogs under client/src/locales/{en,ar}/<namespace>.json,
// which are merged over this object below.
const baseT = {
  en: {
    // Navigation
    dashboard: "Dashboard",
    companies: "Companies",
    chartOfAccounts: "Chart of accounts",
    accounts: "Manage accounts",
    invoices: "Invoices",
    receipts: "Expenses",
    receiptAutopilot: "Receipt autopilot",
    recurringInvoices: "Recurring invoices",
    quotes: "Quotes",
    filingPulse: "Filing pulse",
    welcomeBack: "Welcome back",
    financialOverview: "Your financial overview — revenue, expenses, and outstanding receivables.",
    netProfitThisMonth: "Net profit · this month",
    positive: "Positive",
    negative: "Negative",
    margin: "Margin",
    scanReceipt: "Scan receipt",
    auditReadyBooks: "No open items — audit-ready books.",
    openItemsToResolve: "open items to resolve",
    manageInvoices: "Manage invoices and customize their appearance",
    invoiceBranding: "Invoice branding",
    filterByDate: "Filter by date:",
    noInvoicesYet: "No invoices yet",
    newInvoiceCta: "New invoice",
    createFirstInvoice:
      "Create your first invoice — VAT, sequential numbering, and PDFs are handled automatically.",
    dateRange: "Date range",
    thisMonth: "This month",
    lastMonth: "Last month",
    thisQuarter: "This quarter",
    lastQuarter: "Last quarter",
    thisYear: "This year",
    lastYear: "Last year",
    custom: "Custom",
    startDate: "Start date",
    endDate: "End date",
    dateTo: "to",
    reportCenter: "Report center",
    financialReportsSubtitle: "Financial statements, tax reports and comparisons from your books",
    chooseOneReport:
      "Choose one report from a category. Reports open one at a time with the right period, export, and review context.",
    chooseAReport: "Choose a report",
    groupedByCategory: "Grouped by category",
    viewProof: "Audit evidence",
    period: "Period",
    quotesSubtitle: "Create and manage quotes for your customers",
    noQuotesYet: "No quotes yet",
    quotesEmptyDesc:
      "Send a professional quote in minutes — accepted quotes convert to invoices with one click.",
    newQuote: "New quote",
    creditNotesSubtitle: "View credit notes created from invoices",
    noCreditNotesYet: "No credit notes yet",
    creditNotesEmptyDesc:
      "Issue a credit note to correct or refund an invoice — it posts to your ledger and VAT return automatically.",
    newCreditNote: "New credit note",
    purchaseOrdersSubtitle: "Create and manage purchase orders for your vendors",
    noPurchaseOrdersYet: "No purchase orders yet",
    purchaseOrdersEmptyDesc:
      "Track what you've ordered from suppliers and match deliveries to bills when they arrive.",
    newPurchaseOrder: "New purchase order",
    billPaySubtitle: "Manage vendor bills, approvals, and payments",
    receiptScannerSubtitle: "Upload receipts or enter an expense",
    noExpenseClaimsYet: "No expense claims yet",
    expenseClaimsEmptyDesc: "Submit your first reimbursement to get started.",
    financialStatementsCenter: "Financial statements center",
    financialStatementsCenterDesc:
      "Open the clean statement workspace for P&L, Balance Sheet, and Cash Flow.",
    reportCategoryCardDesc:
      "Open a report from this category. Persona ranking changes recommendations, not report names.",
    eyebrowSettings: "Settings",
    eyebrowAccounting: "Accounting",
    eyebrowFirm: "Firm",
    eyebrowAdmin: "Admin",
    eyebrowSales: "Sales",
    eyebrowWorkspace: "Workspace",
    eyebrowInsights: "Insights",
    eyebrowCompliance: "Compliance",
    eyebrowPurchases: "Purchases",
    eyebrowOperations: "Operations",
    eyebrowReports: "Reports",
    eyebrowPayroll: "HR & payroll",
    eyebrowAi: "AI hub",
    complianceEyebrow: "Compliance",
    auditReadiness: "Audit readiness",
    nextDue: "Next due",
    noReturnFiledYet: "No return filed yet",
    onTrack: "On track",
    dueSoon: "Due soon",
    overdue: "Overdue",
    openVatWorkspace: "Open VAT workspace",
    openTaxWorkpaper: "Open tax workpaper",
    calendarLink: "Calendar",
    raiseYourScore: "Raise your score",
    corporateTaxLabel: "Corporate tax",
    booksReadyTitle: "Books ready in 90 seconds.",
    companyNameLabel: "Company name",
    emirateLabel: "Emirate",
    trnOptionalLabel: "TRN (optional)",
    setUpMyBooks: "Set up my books now",
    settingUpBooks: "Setting up your books…",
    invoiceTemplates: "Invoice templates",
    documentVersions: "Document versions",
    developerSettings: "Developer settings",
    notificationPreferences: "Notification preferences",
    subscription: "Subscription",
    creditNotes: "Credit notes",
    purchaseOrders: "Purchase orders",
    employees: "Employees",
    costCenters: "Cost centers",
    exchangeRates: "Exchange rates",
    financialStatements: "Financial statements",
    reconciliationRules: "Reconciliation rules",
    paymentChasing: "Payment chasing",
    journal: "Journal entries",
    reports: "Financial reports",
    ownerReports: "Owner / solo reports",
    freelancerReports: "Freelancer reports",
    accountantReports: "Accountant reports",
    ownerAutomationCenter: "Owner / solo automations",
    freelancerAutomationCenter: "Freelancer automations",
    accountantAutomationCenter: "Accountant automations",
    aiTools: "AI tools",
    settings: "Settings",
    logout: "Logout",
    contacts: "Customer contacts",
    inventory: "Inventory",

    // Sidebar sections
    smartAccounting: "Smart accounting",
    overview: "Overview",
    myPortal: "My portal",
    reportsSection: "Reports",
    accounting: "Accounting",
    clientPortal: "Client portal",
    adminPanel: "Admin panel",

    // Client portal items
    documentVault: "Document vault",
    taxReturnArchive: "Tax return archive",
    complianceCalendar: "Compliance calendar",
    taskCenter: "Task center",
    newsFeed: "UAE tax news",

    // Compliance
    compliance: "Compliance",
    documentChasing: "Document chasing",
    emailIntake: "Email intake",

    // Settings items
    history: "Activity history",
    backupRestore: "Backup & restore",

    // NRA Center items
    firmCommandCenter: "Command center",
    valueOps: "Value Ops",
    clientPortfolio: "Client portfolio",
    staffManagement: "Staff management",
    bulkOperations: "Bulk operations",
    firmAnalytics: "Firm analytics",
    leadPipeline: "Lead pipeline",

    // Firm Analytics
    firmAnalyticsDesc: "Revenue, utilization, and client health overview",
    totalMRR: "Total MRR",
    revenueGrowth: "Revenue growth",
    vsLastMonth: "vs. last 30 days",
    avgRevenuePerClient: "Avg revenue / client",
    totalClients: "Total clients",
    staffMembers: "staff members",
    revenueByClient: "Revenue by client (top 10)",
    clientHealthSummary: "Client health",
    healthyClients: "Healthy",
    attentionClients: "Needs attention",
    criticalClients: "Critical",
    topIssues: "Top issues",
    staffUtilization: "Staff utilization",
    totalStaff: "Total staff",
    clientsPerStaff: "Clients / staff",
    avgClientsPerAdmin: "Avg clients / admin",

    // Health Dashboard
    healthDashboardDesc: "At-a-glance health status for all managed clients",
    needsAttention: "Needs attention",
    healthy: "Healthy",
    critical: "Critical",
    clientHealthTable: "Client health overview",
    overallHealth: "Overall health",
    client: "Client",
    vatStatus: "VAT status",
    arHealth: "AR health",
    bankRec: "Bank rec.",
    trialBalance: "Trial balance",
    lastActivity: "Last activity",
    upcomingDeadlines: "Upcoming deadlines",
    noDeadlines: "No upcoming deadlines — all clients are on track",
    noClients: "No clients found",

    // Admin items
    adminDashboard: "Admin dashboard",
    clientManagement: "Client management",
    clientDocuments: "Client documents",
    userInvitations: "Invitations",
    clientImport: "Import clients",
    userManagement: "User management",
    activityLogs: "Activity logs",
    systemSettings: "System settings",

    // Auth
    login: "Login",
    register: "Register",
    email: "Email",
    password: "Password",
    name: "Full name",
    signIn: "Sign In",
    signUp: "Sign Up",
    dontHaveAccount: "Don't have an account?",
    alreadyHaveAccount: "Already have an account?",

    // Company
    createCompany: "Create company",
    companyName: "Company name",
    baseCurrency: "Base currency",
    language: "Language",
    english: "English",
    arabic: "Arabic",
    switchCompany: "Switch company",

    // Dashboard
    revenue: "Revenue",
    expenses: "Expenses",
    profit: "Profit",
    outstanding: "Outstanding",
    recentInvoices: "Recent invoices",
    expenseBreakdown: "Expense breakdown",

    // Invoices
    newInvoice: "New invoice",
    invoiceNumber: "Invoice number",
    customerName: "Customer name",
    customerTRN: "Customer TRN",
    date: "Date",
    status: "Status",
    draft: "Draft",
    sent: "Sent",
    paid: "Paid",
    void: "Void",
    subtotal: "Subtotal",
    vat: "VAT",
    total: "Total",
    addLine: "Add line",
    description: "Description",
    quantity: "Quantity",
    unitPrice: "Unit price",
    amount: "Amount",

    // Journal
    newEntry: "New entry",
    memo: "Memo",
    debit: "Debit",
    credit: "Credit",
    balance: "Balance",
    balanced: "Balanced",
    notBalanced: "Not balanced",

    // Accounts
    accountCode: "Account code",
    accountName: "Account name",
    type: "Type",
    asset: "Asset",
    liability: "Liability",
    equity: "Equity",
    income: "Income",
    expense: "Expense",

    // AI
    smartAssistant: "Smart Assistant",
    aiCategorize: "AI categorize",
    aiCfo: "AI CFO & financial advisor",
    aiFeatures: "AI automation",
    aiChat: "AI chat",
    hrPayroll: "HR & payroll",
    advancedAnalytics: "Analytics & forecasts",
    integrationsHub: "CRM & E-Commerce",
    integrations: "Integrations",
    whatsappInbox: "WhatsApp inbox",
    bankReconciliation: "Bank reconciliation",
    evidenceCenter: "Evidence center",
    vatFiling: "VAT filing",
    vatAutopilot: "VAT autopilot",
    corporateTax: "Corporate Tax",
    teamManagement: "Team management",
    advancedReports: "Advanced reports",

    // Engagement
    notifications: "Notifications",
    reminders: "Payment reminders",
    referrals: "Referral program",
    feedback: "Feedback",
    analytics: "Usage analytics",
    transactionDescription: "Transaction description",
    suggestedAccount: "Suggested account",
    confidence: "Confidence",
    categorize: "Categorize",

    // Reports
    profitLoss: "Profit & loss",
    balanceSheet: "Balance sheet",
    vatSummary: "VAT summary",
    export: "Export",

    // Common
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    search: "Search",
    filter: "Filter",
    loading: "Loading...",
    noData: "No data available",
    error: "Error",
    tryAgain: "Try again",
    invoiceDeleted: "Invoice deleted",
    invoiceDeletedDesc: "The invoice has been successfully deleted.",
    deleteFailed: "Delete failed",
    close: "Close",
    actions: "Actions",
    reference: "Reference",
    import: "Import",
    inactive: "Inactive",
    profile: "Profile",

    // Chart of Accounts
    chartOfAccountsDescription: "Manage and view all financial accounts for your company",
    addAccount: "Add account",
    searchAccounts: "Search accounts...",
    noResultsFound: "No results found",
    noAccountsYet: "No accounts yet",
    tryDifferentKeywords: "Try searching with different keywords",
    addAccountsToStart: "Add accounts to start tracking your finances",
    accountsCount: "accounts",
    balanceSummary: "Balance summary",

    // Smart Assistant
    askAnything: "Ask anything about your financial data in plain English",
    greeting: "Hi! How can I help you today?",
    askAboutFinancialData: "Ask me about sales, expenses, invoices, or any other financial data.",
    query: "Query",
    advice: "Advice",
    action: "Action",
    suggestedFollowUps: "Suggested follow-ups:",
    analyzing: "Analyzing...",
    typeYourQuestion: "Type your question...",
    typeYourQuestionExample: 'e.g., "What were our total sales this month?"',
    pressEnterToSend: "Press Enter to send • Supports both English and Arabic",

    // Bank Reconciliation
    bankReconciliationDescription: BANK_RECONCILIATION_COPY.en,
    autoMatch: "Auto-match",
    importCsv: "Import CSV",
    totalTransactions: "Total transactions",
    reconciled: "Reconciled",
    unreconciled: "Unreconciled",
    netAmount: "Net amount",
    bankTransactions: "Bank transactions",
    showReconciled: "Show reconciled",
    allAccounts: "All accounts",
    noTransactionsFound: "No transactions found. Import your bank statement to get started.",
    match: "Match",
    unmatched: "Unmatched",
    importBankStatement: "Import Bank Statement",
    uploadBankStatement: BANK_RECONCILIATION_COPY.en,
    bankAccount: "Bank Account",
    selectAccount: "Select account",
    bankStatementFile: "Bank Statement File (CSV)",
    supportedFormats: "Supported formats:",
    matchTransaction: "Match transaction",
    suggestedMatches: "Suggested matches",
    noMatchesFound: "No automatic matches found. You can create a manual journal entry.",

    // Receipts
    receiptScanner: "Receipt scanner",
    receiptScannerDescription: "Upload receipts or enter an expense",
    addExpenseManually: "Add expense manually",
    uploadReceipts: "Upload receipts",
    uploadReceiptsDescription:
      "Drag & drop receipt images or click to browse (supports bulk upload)",
    recentExpenses: "Recent expenses",
    recentExpensesDescription: "Previously scanned and saved expenses",

    // New modules
    payroll: "Payroll & WPS",
    billPay: "Bill Pay",
    fixedAssets: "Fixed assets",
    budgeting: "Budgets",
    expenseClaims: "Expense claims",
    cashFlowForecast: "Cash flow forecast",
    anomalyDetection: "Anomaly detection",
    autoReconcile: "Smart reconcile",
    aiInbox: "AI inbox",
    monthEndClose: "Month-end close",
    pricing: "Pricing",

    // Communications Hub
    communicationsHub: "Communications Hub",
    inbox: "Inbox",
    compose: "Compose",
    templates: "Templates",
    bulkActions: "Bulk actions",
    sendEmail: "Send email",
    sendWhatsApp: "Send WhatsApp",
    recipient: "Recipient",
    selectClient: "Select client",
    selectTemplate: "Select template",
    channel: "Channel",
    whatsapp: "WhatsApp",
    commsLog: "Communication Log",
    noCommsYet: "No communications yet",
    sendVatReminders: "Send VAT reminders",
    vatRemindersPreview: "Preview clients with upcoming VAT deadlines",
    daysAhead: "Days ahead",
    sendReminders: "Send reminders",
    previewReminders: "Preview",
    bulkRemindSuccess: "VAT reminders sent",
    templateName: "Template name",
    templateBody: "Template body",
    subjectTemplate: "Subject template",
    addTemplate: "Add template",
    editTemplate: "Edit template",
    noTemplates: "No templates yet",
    templateSaved: "Template saved",
    noClientsFound: "No clients with upcoming VAT deadlines",
    previewNote: "Preview only — no messages sent",

    // Sidebar group titles & new nav items
    sales: "Sales",
    purchases: "Purchases",
    nraCenter: "Practice command centre",
    companyProfile: "Company profile",
    companySettings: "Company settings",
    healthDashboard: "Health dashboard",
    communications: "Communications",
  },
  ar: {
    // Navigation
    dashboard: "لوحة التحكم",
    companies: "الشركات",
    chartOfAccounts: "دليل الحسابات",
    accounts: "إدارة الحسابات",
    invoices: "الفواتير",
    receipts: "المصروفات",
    receiptAutopilot: "الطيار الآلي للإيصالات",
    recurringInvoices: "الفواتير المتكررة",
    quotes: "عروض الأسعار",
    filingPulse: "نبض الإقرارات",
    welcomeBack: "مرحبًا بعودتك",
    financialOverview: "نظرة عامة على وضعك المالي — الإيرادات والمصروفات والمبالغ المستحقة.",
    netProfitThisMonth: "صافي الربح · هذا الشهر",
    positive: "موجب",
    negative: "سالب",
    margin: "الهامش",
    scanReceipt: "مسح إيصال",
    auditReadyBooks: "لا توجد بنود مفتوحة — دفاتر جاهزة للتدقيق.",
    openItemsToResolve: "بنود بحاجة للحل",
    manageInvoices: "إدارة الفواتير وتخصيص مظهرها",
    invoiceBranding: "هوية الفاتورة",
    filterByDate: "تصفية حسب التاريخ:",
    noInvoicesYet: "لا توجد فواتير بعد",
    newInvoiceCta: "فاتورة جديدة",
    createFirstInvoice:
      "أنشئ أول فاتورة لك — ضريبة القيمة المضافة والترقيم التسلسلي وملفات PDF تُعالَج تلقائيًا.",
    dateRange: "نطاق التاريخ",
    thisMonth: "هذا الشهر",
    lastMonth: "الشهر الماضي",
    thisQuarter: "هذا الربع",
    lastQuarter: "الربع الماضي",
    thisYear: "هذه السنة",
    lastYear: "السنة الماضية",
    custom: "مخصص",
    startDate: "تاريخ البدء",
    endDate: "تاريخ الانتهاء",
    dateTo: "إلى",
    reportCenter: "مركز التقارير",
    financialReportsSubtitle: "القوائم المالية والتقارير الضريبية والمقارنات من دفاترك",
    chooseOneReport:
      "اختر تقريرًا واحدًا من فئة. تُفتح التقارير واحدًا تلو الآخر مع الفترة الصحيحة والتصدير وسياق المراجعة.",
    chooseAReport: "اختر تقريرًا",
    groupedByCategory: "مُجمّعة حسب الفئة",
    viewProof: "أدلة التدقيق",
    period: "الفترة",
    quotesSubtitle: "أنشئ وأدر عروض الأسعار لعملائك",
    noQuotesYet: "لا توجد عروض أسعار بعد",
    quotesEmptyDesc:
      "أرسل عرض سعر احترافيًا في دقائق — تتحول العروض المقبولة إلى فواتير بنقرة واحدة.",
    newQuote: "عرض سعر جديد",
    creditNotesSubtitle: "عرض إشعارات الدائن المُنشأة من الفواتير",
    noCreditNotesYet: "لا توجد إشعارات دائنة بعد",
    creditNotesEmptyDesc:
      "أصدر إشعار دائن لتصحيح فاتورة أو ردّ مبلغها — يُقيَّد في دفترك وإقرار ضريبة القيمة المضافة تلقائيًا.",
    newCreditNote: "إشعار دائن جديد",
    purchaseOrdersSubtitle: "أنشئ وأدر أوامر الشراء لموردينك",
    noPurchaseOrdersYet: "لا توجد أوامر شراء بعد",
    purchaseOrdersEmptyDesc: "تابع ما طلبته من الموردين وطابِق التسليمات بالفواتير عند وصولها.",
    newPurchaseOrder: "أمر شراء جديد",
    billPaySubtitle: "إدارة فواتير الموردين والموافقات والمدفوعات",
    receiptScannerSubtitle: "ارفع الإيصالات أو أدخل مصروفًا",
    noExpenseClaimsYet: "لا توجد مطالبات مصروفات بعد",
    expenseClaimsEmptyDesc: "قدّم أول مطالبة استرداد للبدء.",
    financialStatementsCenter: "مركز البيانات المالية",
    financialStatementsCenterDesc:
      "افتح مساحة عمل البيانات النظيفة للأرباح والخسائر والميزانية والتدفقات النقدية.",
    reportCategoryCardDesc:
      "افتح تقريرًا من هذه الفئة. ترتيب الشخصية يغيّر التوصيات وليس أسماء التقارير.",
    eyebrowSettings: "الإعدادات",
    eyebrowAccounting: "المحاسبة",
    eyebrowFirm: "المكتب",
    eyebrowAdmin: "الإدارة",
    eyebrowSales: "المبيعات",
    eyebrowWorkspace: "مساحة العمل",
    eyebrowInsights: "الرؤى",
    eyebrowCompliance: "الامتثال",
    eyebrowPurchases: "المشتريات",
    eyebrowOperations: "العمليات",
    eyebrowReports: "التقارير",
    eyebrowPayroll: "الموارد البشرية والرواتب",
    eyebrowAi: "مركز الذكاء الاصطناعي",
    complianceEyebrow: "الامتثال",
    auditReadiness: "الجاهزية للتدقيق",
    nextDue: "الاستحقاق القادم",
    noReturnFiledYet: "لم يُقدَّم أي إقرار بعد",
    onTrack: "على المسار",
    dueSoon: "يستحق قريباً",
    overdue: "متأخر",
    openVatWorkspace: "فتح مساحة ضريبة القيمة المضافة",
    openTaxWorkpaper: "فتح ورقة عمل الضريبة",
    calendarLink: "التقويم",
    raiseYourScore: "ارفع درجتك",
    corporateTaxLabel: "ضريبة الشركات",
    booksReadyTitle: "دفاترك جاهزة في ٩٠ ثانية.",
    companyNameLabel: "اسم الشركة",
    emirateLabel: "الإمارة",
    trnOptionalLabel: "الرقم الضريبي (اختياري)",
    setUpMyBooks: "جهّز دفاتري الآن",
    settingUpBooks: "جارٍ تجهيز دفاترك…",
    invoiceTemplates: "قوالب الفواتير",
    documentVersions: "إصدارات المستندات",
    developerSettings: "إعدادات المطور",
    notificationPreferences: "تفضيلات الإشعارات",
    subscription: "الاشتراك",
    creditNotes: "إشعارات دائنة",
    purchaseOrders: "أوامر الشراء",
    employees: "الموظفون",
    costCenters: "مراكز التكلفة",
    exchangeRates: "أسعار الصرف",
    financialStatements: "القوائم المالية",
    reconciliationRules: "قواعد التسوية",
    paymentChasing: "متابعة المدفوعات",
    journal: "القيود",
    reports: "التقارير المالية",
    ownerReports: "تقارير المالك/رائد الأعمال الفردي",
    freelancerReports: "تقارير المستقل",
    accountantReports: "تقارير المحاسب",
    ownerAutomationCenter: "أتمتة المالك/رائد الأعمال الفردي",
    freelancerAutomationCenter: "أتمتة المستقل",
    accountantAutomationCenter: "أتمتة المحاسب",
    aiTools: "أدوات الذكاء الاصطناعي",
    settings: "الإعدادات",
    logout: "تسجيل الخروج",
    contacts: "جهات الاتصال",
    inventory: "المخزون",

    // Sidebar sections
    smartAccounting: "المحاسبة الذكية",
    overview: "نظرة عامة",
    myPortal: "بوابتي",
    reportsSection: "التقارير",
    accounting: "المحاسبة",
    clientPortal: "بوابة العميل",
    adminPanel: "لوحة الإدارة",

    // Client portal items
    documentVault: "خزنة المستندات",
    taxReturnArchive: "أرشيف الإقرارات",
    complianceCalendar: "تقويم الامتثال",
    taskCenter: "مركز المهام",
    newsFeed: "أخبار الضرائب",

    // Compliance
    compliance: "الامتثال",
    documentChasing: "متابعة المستندات",
    emailIntake: "استلام المستندات بالبريد",

    // Settings items
    history: "سجل النشاط",
    backupRestore: "النسخ الاحتياطي",

    // NRA Center items
    firmCommandCenter: "مركز القيادة",
    valueOps: "عمليات القيمة",
    clientPortfolio: "محفظة العملاء",
    staffManagement: "إدارة الموظفين",
    bulkOperations: "العمليات الجماعية",
    firmAnalytics: "تحليلات الشركة",
    leadPipeline: "خط أنابيب العملاء المحتملين",

    // Firm Analytics
    firmAnalyticsDesc: "نظرة عامة على الإيرادات والاستخدام وصحة العملاء",
    totalMRR: "إجمالي الإيرادات الشهرية",
    revenueGrowth: "نمو الإيرادات",
    vsLastMonth: "مقارنة بآخر 30 يوم",
    avgRevenuePerClient: "متوسط الإيرادات / العميل",
    totalClients: "إجمالي العملاء",
    staffMembers: "موظف",
    revenueByClient: "الإيرادات حسب العميل (أفضل 10)",
    clientHealthSummary: "صحة العملاء",
    healthyClients: "سليم",
    attentionClients: "يحتاج انتباه",
    criticalClients: "حرج",
    topIssues: "أبرز المشكلات",
    staffUtilization: "استخدام الموظفين",
    totalStaff: "إجمالي الموظفين",
    clientsPerStaff: "العملاء / الموظف",
    avgClientsPerAdmin: "متوسط العملاء / مسؤول",

    // Health Dashboard
    healthDashboardDesc: "نظرة شاملة على حالة جميع العملاء المُدارين",
    needsAttention: "يحتاج انتباه",
    healthy: "سليم",
    critical: "حرج",
    clientHealthTable: "نظرة عامة على صحة العملاء",
    overallHealth: "الصحة الإجمالية",
    client: "العميل",
    vatStatus: "حالة الضريبة",
    arHealth: "الذمم المدينة",
    bankRec: "التسوية البنكية",
    trialBalance: "ميزان المراجعة",
    lastActivity: "آخر نشاط",
    upcomingDeadlines: "المواعيد القادمة",
    noDeadlines: "لا توجد مواعيد قادمة — جميع العملاء في المسار الصحيح",
    noClients: "لا توجد عملاء",

    // Admin items
    adminDashboard: "لوحة تحكم المدير",
    clientManagement: "إدارة العملاء",
    clientDocuments: "مستندات العملاء",
    userInvitations: "الدعوات",
    clientImport: "استيراد العملاء",
    userManagement: "إدارة المستخدمين",
    activityLogs: "سجل النشاط",
    systemSettings: "إعدادات النظام",

    // Auth
    login: "تسجيل الدخول",
    register: "تسجيل حساب جديد",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    name: "الاسم الكامل",
    signIn: "دخول",
    signUp: "إنشاء حساب",
    dontHaveAccount: "ليس لديك حساب؟",
    alreadyHaveAccount: "لديك حساب؟",

    // Company
    createCompany: "إنشاء شركة",
    companyName: "اسم الشركة",
    baseCurrency: "العملة الأساسية",
    language: "اللغة",
    english: "الإنجليزية",
    arabic: "العربية",
    switchCompany: "تبديل الشركة",

    // Dashboard
    revenue: "الإيرادات",
    expenses: "المصروفات",
    profit: "الربح",
    outstanding: "المستحق",
    recentInvoices: "الفواتير الأخيرة",
    expenseBreakdown: "تفصيل المصروفات",

    // Invoices
    newInvoice: "فاتورة جديدة",
    invoiceNumber: "رقم الفاتورة",
    customerName: "اسم العميل",
    customerTRN: "الرقم الضريبي للعميل",
    date: "التاريخ",
    status: "الحالة",
    draft: "مسودة",
    sent: "مرسلة",
    paid: "مدفوعة",
    void: "ملغاة",
    subtotal: "المجموع الفرعي",
    vat: "ضريبة القيمة المضافة",
    total: "المجموع",
    addLine: "إضافة بند",
    description: "الوصف",
    quantity: "الكمية",
    unitPrice: "سعر الوحدة",
    amount: "المبلغ",

    // Journal
    newEntry: "قيد جديد",
    memo: "ملاحظة",
    debit: "مدين",
    credit: "دائن",
    balance: "الرصيد",
    balanced: "متوازن",
    notBalanced: "غير متوازن",

    // Accounts
    accountCode: "رمز الحساب",
    accountName: "اسم الحساب",
    type: "النوع",
    asset: "أصول",
    liability: "خصوم",
    equity: "حقوق ملكية",
    income: "إيرادات",
    expense: "مصروفات",

    // AI
    smartAssistant: "المساعد الذكي",
    aiCategorize: "التصنيف الذكي",
    aiCfo: "مستشار مالي بالذكاء الاصطناعي",
    aiFeatures: "الأتمتة الذكية",
    aiChat: "محادثة الذكاء الاصطناعي",
    hrPayroll: "الموارد البشرية والرواتب",
    advancedAnalytics: "التحليلات والتوقعات",
    integrationsHub: "إدارة العملاء والتجارة الإلكترونية",
    integrations: "التكاملات",
    whatsappInbox: "صندوق الواتساب",
    bankReconciliation: "التسوية البنكية",
    evidenceCenter: "مركز الأدلة",
    vatFiling: "إقرارات الضريبة",
    vatAutopilot: "الطيار الآلي للضريبة",
    corporateTax: "ضريبة الشركات",
    teamManagement: "إدارة الفريق",
    advancedReports: "التقارير المتقدمة",

    // Engagement
    notifications: "الإشعارات",
    reminders: "تذكيرات الدفع",
    referrals: "برنامج الإحالة",
    feedback: "التقييم",
    analytics: "تحليلات الاستخدام",
    transactionDescription: "وصف المعاملة",
    suggestedAccount: "الحساب المقترح",
    confidence: "مستوى الثقة",
    categorize: "تصنيف",

    // Reports
    profitLoss: "الأرباح والخسائر",
    balanceSheet: "الميزانية العمومية",
    vatSummary: "ملخص ضريبة القيمة المضافة",
    export: "تصدير",

    // Common
    save: "حفظ",
    cancel: "إلغاء",
    delete: "حذف",
    edit: "تعديل",
    search: "بحث",
    filter: "تصفية",
    loading: "جاري التحميل...",
    noData: "لا توجد بيانات",
    error: "خطأ",
    tryAgain: "حاول مرة أخرى",
    invoiceDeleted: "تم حذف الفاتورة",
    invoiceDeletedDesc: "تم حذف الفاتورة بنجاح.",
    deleteFailed: "فشل الحذف",
    close: "إغلاق",
    actions: "الإجراءات",
    reference: "المرجع",
    import: "استيراد",
    inactive: "غير نشط",
    profile: "الملف الشخصي",

    // Chart of Accounts
    chartOfAccountsDescription: "إدارة وعرض جميع الحسابات المالية لشركتك",
    addAccount: "إضافة حساب",
    searchAccounts: "البحث في الحسابات...",
    noResultsFound: "لا توجد نتائج",
    noAccountsYet: "لا توجد حسابات",
    tryDifferentKeywords: "حاول البحث بكلمات مختلفة",
    addAccountsToStart: "أضف حسابات لبدء تتبع ماليتك",
    accountsCount: "حسابات",
    balanceSummary: "ملخص الأرصدة",

    // Smart Assistant
    askAnything: "اسأل أي شيء عن بياناتك المالية باللغة الطبيعية",
    greeting: "مرحباً! كيف يمكنني مساعدتك اليوم؟",
    askAboutFinancialData: "اسألني عن المبيعات، المصروفات، الفواتير، أو أي بيانات مالية أخرى.",
    query: "استعلام",
    advice: "نصيحة",
    action: "إجراء",
    suggestedFollowUps: "متابعة مقترحة:",
    analyzing: "جاري التحليل...",
    typeYourQuestion: "اكتب سؤالك هنا...",
    typeYourQuestionExample: 'مثال: "ما هو إجمالي المبيعات هذا الشهر؟"',
    pressEnterToSend: "اضغط Enter للإرسال • يدعم اللغتين العربية والإنجليزية",

    // Bank Reconciliation
    bankReconciliationDescription: BANK_RECONCILIATION_COPY.ar,
    autoMatch: "مطابقة تلقائية",
    importCsv: "استيراد",
    totalTransactions: "إجمالي المعاملات",
    reconciled: "تمت التسوية",
    unreconciled: "غير مسوى",
    netAmount: "صافي المبلغ",
    bankTransactions: "معاملات البنك",
    showReconciled: "إظهار المسوى",
    allAccounts: "كل الحسابات",
    noTransactionsFound: "لا توجد معاملات. استورد كشف حسابك البنكي للبدء.",
    match: "مطابقة",
    unmatched: "غير مسوى",
    importBankStatement: "استيراد كشف حساب البنك",
    uploadBankStatement: BANK_RECONCILIATION_COPY.ar,
    bankAccount: "حساب البنك",
    selectAccount: "اختر الحساب",
    bankStatementFile: "ملف كشف الحساب (CSV)",
    supportedFormats: "الصيغ المدعومة:",
    matchTransaction: "مطابقة المعاملة",
    suggestedMatches: "المطابقات المقترحة",
    noMatchesFound: "لم يتم العثور على مطابقات تلقائية. يمكنك إنشاء قيد يدوي.",

    // Receipts
    receiptScanner: "ماسح الإيصالات",
    receiptScannerDescription: "ارفع إيصالات للاستخراج بالذكاء الاصطناعي أو أدخل يدوياً",
    addExpenseManually: "إضافة مصروف يدوياً",
    uploadReceipts: "رفع الإيصالات",
    uploadReceiptsDescription: "اسحب وأفلت صور الإيصالات أو انقر للتصفح (يدعم الرفع المتعدد)",
    recentExpenses: "المصروفات الأخيرة",
    recentExpensesDescription: "المصروفات الممسوحة والمحفوظة مسبقاً",

    // New modules
    payroll: "الرواتب والحماية",
    billPay: "دفع الفواتير",
    fixedAssets: "الأصول الثابتة",
    budgeting: "الميزانيات",
    expenseClaims: "مطالبات المصروفات",
    cashFlowForecast: "توقعات التدفق النقدي",
    anomalyDetection: "كشف الحالات الشاذة",
    autoReconcile: "التسوية الذكية",
    aiInbox: "صندوق الذكاء الاصطناعي",
    monthEndClose: "إقفال نهاية الشهر",
    pricing: "الأسعار",

    // Communications Hub
    communicationsHub: "مركز الاتصالات",
    inbox: "صندوق الوارد",
    compose: "إنشاء رسالة",
    templates: "القوالب",
    bulkActions: "الإجراءات الجماعية",
    sendEmail: "إرسال بريد إلكتروني",
    sendWhatsApp: "إرسال واتساب",
    recipient: "المستلم",
    selectClient: "اختر العميل",
    selectTemplate: "اختر القالب",
    channel: "القناة",
    whatsapp: "واتساب",
    commsLog: "سجل الاتصالات",
    noCommsYet: "لا توجد اتصالات بعد",
    sendVatReminders: "إرسال تذكيرات ضريبة القيمة المضافة",
    vatRemindersPreview: "معاينة العملاء مع مواعيد ضريبة القيمة المضافة القادمة",
    daysAhead: "الأيام القادمة",
    sendReminders: "إرسال التذكيرات",
    previewReminders: "معاينة",
    bulkRemindSuccess: "تم إرسال تذكيرات ضريبة القيمة المضافة",
    templateName: "اسم القالب",
    templateBody: "نص القالب",
    subjectTemplate: "قالب الموضوع",
    addTemplate: "إضافة قالب",
    editTemplate: "تعديل القالب",
    noTemplates: "لا توجد قوالب بعد",
    templateSaved: "تم حفظ القالب",
    noClientsFound: "لم يتم العثور على عملاء مع مواعيد قادمة",
    previewNote: "معاينة فقط — لن يتم إرسال رسائل",

    // Sidebar group titles & new nav items
    sales: "المبيعات",
    purchases: "المشتريات",
    nraCenter: "مركز قيادة المكتب",
    companyProfile: "ملف الشركة",
    companySettings: "إعدادات الشركة",
    healthDashboard: "لوحة الصحة",
    communications: "التواصل",
  },
};

type TranslationCatalog = Record<string, string>;

// Namespace catalogs: client/src/locales/<locale>/<namespace>.json. Every
// workstream appends to its own namespace file so catalogs never collide.
// Key convention: "<namespace>.<camelCaseKey>".
//
// S5 (bundle budget): the catalogs are code-split, one chunk per namespace and locale, and
// are NOT in the main bundle. main.tsx awaits loadLocale(<active locale>) before the first
// render, so `t[...]` / `<T k>` stay synchronous; Arabic chunks are fetched only when the
// active locale is "ar" (or the user switches to it).
// R18-02: Arabic report-catalog labels (client/src/locales/ar-catalog/) ride along with the
// Arabic namespaces; English falls back to client/src/lib/reportCatalog.ts (see reportCatalogText.ts).
const namespaceLoaders = {
  en: import.meta.glob("../locales/en/*.json", { import: "default" }),
  ar: import.meta.glob(["../locales/ar/*.json", "../locales/ar-catalog/*.json"], {
    import: "default",
  }),
} as Record<Locale, Record<string, () => Promise<TranslationCatalog>>>;

// Order: base (legacy flat keys) < namespaces (merged in on load; the former i18n-extended flat keys
// now live in locales/{en,ar}/shell.json).
export const t = {
  en: { ...baseT.en } as typeof baseT.en & TranslationCatalog,
  ar: { ...baseT.ar } as typeof baseT.ar & TranslationCatalog,
};

// ── Route-scoped loading (D1b) ──────────────────────────────────────────────
// Signed-out public pages (landing, pricing, auth, legal, help) only need a few
// namespaces; downloading all of them before first paint cost the landing page
// its mobile performance. main.tsx calls `setPublicBootScope(pathname)` when the
// app boots on a public path: while the visitor stays on public paths only the
// route's namespaces load. The first non-public path (or any boot on one, or any
// caller that never sets the scope, such as unit tests) loads every namespace,
// exactly as before.

/** Shared by every public page: the marketing shell, auth forms and shell chrome. */
const PUBLIC_CORE_NAMESPACES = ["marketing", "components", "shell"];
/** Extra namespaces used by the content-heavier public pages. */
const PUBLIC_EXTRA_NAMESPACES = [
  "pageLabels",
  "pages",
  "security",
  "portal",
  "banking",
  "invoices",
];
/** Public paths whose pages only read the core namespaces. */
const PUBLIC_CORE_ONLY = new Set(["/", "/pricing", "/services"]);
const PUBLIC_PATHS = new Set([
  "/",
  "/pricing",
  "/services",
  "/demo",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/auth/callback",
  // STEP5: the customer-portal invitation page (shell, auth copy and the portal catalog).
  "/portal/join",
  "/privacy",
  "/terms",
  "/cookies",
  "/help",
  "/trust",
  "/migration-guides",
]);

function normalisePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * No-login links a customer or approver opens from an e-mail: the customer portal
 * (`/portal/<token>`, `/portal/login`, `/portal/session`) and the EmaraTax approver page
 * (`/portal/einvoicing-approve/<token>`). They get the light public root and only their own
 * catalogs (a one-screen page should not download the signed-in app).
 */
const APPROVER_LINK_PATH = /^\/portal\/einvoicing-approve\/[^/]+$/;
const PORTAL_LINK_PATH = /^\/portal\/(?!join$|einvoicing-approve\/)[^/]+$/;
/** The shared-invoice page (`/view/invoice/<token>`) opened from an invoice or reminder e-mail. */
const INVOICE_LINK_PATH = /^\/view\/invoice\/[^/]+$/;

export function isCustomerLinkPath(pathname: string): boolean {
  const path = normalisePath(pathname);
  return (
    APPROVER_LINK_PATH.test(path) || PORTAL_LINK_PATH.test(path) || INVOICE_LINK_PATH.test(path)
  );
}

/**
 * The signed-in client portal pages (`/client-portal/dashboard|invoices|documents|statements|
 * messages`). They get their own light root (PortalApp) and only the catalogs they read, not
 * the whole signed-in app.
 */
const PORTAL_APP_PATH = /^\/client-portal\/(dashboard|invoices|documents|statements|messages|account)$/;
const PORTAL_APP_NAMESPACES = ["components", "portal", "shell", "toasts", "pages", "statements"];
/** Sign-in and password recovery read only these catalogs (not the help/legal ones). */
const AUTH_FORM_PATH = /^\/(login|forgot-password|reset-password|verify-email)$/;
const AUTH_FORM_NAMESPACES = [...PUBLIC_CORE_NAMESPACES, "pageLabels", "pages", "security"];

export function isPortalAppPath(pathname: string): boolean {
  return PORTAL_APP_PATH.test(normalisePath(pathname));
}

/**
 * The firm workspace (`/firm/*`, where NR staff land after sign-in) reads a fixed set of
 * catalogs. Booting on it loads only those; the first path outside it (a client's books) ends
 * the restricted scope and loads the rest, exactly like the public scope. Namespaces named
 * here are the ones the firm pages, the shell chrome and the shared UI read; the command
 * palette loads the full catalog the first time it opens.
 */
const FIRM_APP_PATH = /^\/firm(\/|$)/;
const FIRM_APP_NAMESPACES = [
  "common",
  "components",
  "shell",
  "pageLabels",
  "pages",
  "toasts",
  "forms",
  "firm",
  "firmOps",
  "clientsFirm",
  "marketing",
  "invoices",
  "banking",
  "consolidation",
  "reportCenter",
  "einvoicing",
  "aiAssistant",
  "launchProof",
  "screens",
];

export function isFirmAppPath(pathname: string): boolean {
  return FIRM_APP_PATH.test(normalisePath(pathname));
}

/**
 * Signed-in app users only: the chosen language rides along as a functional cookie so the server
 * can preload the right catalogs in the document (server/vite.ts); the stored preference stays
 * the source of truth.
 */
export function rememberLocaleCookie(value: Locale = useI18n.getState().locale): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax${secure}`;
  } catch {
    /* cookies blocked: the document simply preloads no catalogs */
  }
}

/** Load (once) the whole firm catalog set for `locale`; used after the first screen has painted. */
export function loadFirmNamespaces(locale: Locale): Promise<void> {
  return loadNamespaces(locale, FIRM_APP_NAMESPACES);
}

/** True for the signed-out marketing, auth, legal and help routes and the no-login links. */
export function isPublicPath(pathname: string): boolean {
  const path = normalisePath(pathname);
  return !!siteLocale(path) || PUBLIC_PATHS.has(path) || isCustomerLinkPath(path);
}

/** Namespaces a public path needs, or `null` for "every namespace" (app routes). */
export function namespacesForPath(pathname: string): string[] | null {
  const path = normalisePath(pathname);
  if (siteLocale(path)) return ["marketing"];
  if (path === "/portal/join") return [...AUTH_FORM_NAMESPACES, "portal", "serverErrors"];
  if (APPROVER_LINK_PATH.test(path)) return ["components", "einvoicing", "customerLink"];
  if (PORTAL_LINK_PATH.test(path) || INVOICE_LINK_PATH.test(path))
    return ["components", "portal", "customerLink"];
  if (path === "/client-portal/account") return [...PORTAL_APP_NAMESPACES, "security"];
  if (PORTAL_APP_PATH.test(path)) return PORTAL_APP_NAMESPACES;
  // The firm landing screens read only these catalogs (shared/firm-boot.ts), so booting on them
  // downloads six instead of nineteen; the rest warm after the first screen has painted
  // (`loadFirmNamespaces`), before staff can open another firm screen.
  if (firmFirstScreen(path)) return [...FIRM_FIRST_SCREEN_NAMESPACES];
  if (FIRM_APP_PATH.test(path)) return FIRM_APP_NAMESPACES;
  if (AUTH_FORM_PATH.test(path)) return AUTH_FORM_NAMESPACES;
  if (!PUBLIC_PATHS.has(path)) return null;
  return PUBLIC_CORE_ONLY.has(path)
    ? PUBLIC_CORE_NAMESPACES
    : [...PUBLIC_CORE_NAMESPACES, ...PUBLIC_EXTRA_NAMESPACES];
}

let publicScope = false;

/** Called once by main.tsx: restrict loading to route namespaces while on public paths. */
export function setPublicBootScope(pathname: string): void {
  publicScope = isPublicPath(pathname) || isPortalAppPath(pathname) || isFirmAppPath(pathname);
}

function currentPathname(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

/** Namespaces needed right now: the route's while in public scope, else all (`null`). */
function neededNamespaces(): string[] | null {
  if (!publicScope) return null;
  const needed = namespacesForPath(currentPathname());
  // Leaving the public site ends the restricted scope for good.
  if (needed === null) publicScope = false;
  return needed;
}

const namespaceOf = (path: string) => path.replace(/^.*\//, "").replace(/\.json$/, "");
const loadedPaths: Record<Locale, Set<string>> = { en: new Set(), ar: new Set() };
const pendingPaths = new Map<string, Promise<void>>();
const loadedLocales = new Set<Locale>();
const pendingLocales = new Map<Locale, Promise<void>>();

function pathsFor(locale: Locale, namespaces: string[] | null): string[] {
  const loaders = namespaceLoaders[locale] ?? {};
  const all = Object.keys(loaders).sort();
  if (namespaces === null) return all;
  // Route subsets come from the locale's own namespace folder (not ar-catalog/).
  return all.filter(
    (path) => !path.includes("/ar-catalog/") && namespaces.includes(namespaceOf(path))
  );
}

function loadPaths(locale: Locale, paths: string[]): Promise<void> {
  const loaders = namespaceLoaders[locale] ?? {};
  const jobs = paths
    .filter((path) => !loadedPaths[locale].has(path))
    .map((path) => {
      const key = `${locale}:${path}`;
      let job = pendingPaths.get(key);
      if (!job) {
        job = loaders[path]()
          .then((catalog) => {
            Object.assign(t[locale], catalog);
            loadedPaths[locale].add(path);
          })
          .finally(() => pendingPaths.delete(key));
        pendingPaths.set(key, job);
      }
      return job;
    });
  if (jobs.length === 0) return Promise.resolve();
  return Promise.all(jobs).then(() => {
    useCatalogVersion.setState((s) => ({ version: s.version + 1 }));
  });
}

function hasNamespaces(locale: Locale, namespaces: string[] | null): boolean {
  if (loadedLocales.has(locale)) return true;
  if (namespaces === null) return false;
  return pathsFor(locale, namespaces).every((path) => loadedPaths[locale].has(path));
}

/** True once every namespace catalog of `locale` is merged into `t[locale]`. */
export function isLocaleLoaded(locale: Locale): boolean {
  return loadedLocales.has(locale);
}

/**
 * Load (once) every namespace catalog of `locale` and merge it into `t[locale]` in sorted
 * file order. Resolves when the catalogs are in place; concurrent calls share one load.
 */
export function loadLocale(locale: Locale): Promise<void> {
  if (loadedLocales.has(locale)) return Promise.resolve();
  const pending = pendingLocales.get(locale);
  if (pending) return pending;
  const p = loadPaths(locale, pathsFor(locale, null))
    .then(() => {
      loadedLocales.add(locale);
    })
    .finally(() => pendingLocales.delete(locale));
  pendingLocales.set(locale, p);
  return p;
}

/**
 * D5b: load one namespace of a locale that is not the active one (the bilingual invoice
 * preview shows English and Arabic labels side by side). Resolves once merged into `t[locale]`.
 */
export function loadNamespace(locale: Locale, namespace: string): Promise<void> {
  return loadPaths(locale, pathsFor(locale, [namespace]));
}

/**
 * E3 (J2-r3 High): load (once) the given namespaces of `locale`. Components rendered on the
 * signed-out public routes declare the namespaces they read beyond their route's set through
 * `useTranslation([...])`; event handlers that read such a key await this first, so a key is
 * never looked up in a namespace that an in-page language switch did not fetch.
 */
export function loadNamespaces(locale: Locale, namespaces: readonly string[]): Promise<void> {
  if (loadedLocales.has(locale)) return Promise.resolve();
  return loadPaths(locale, pathsFor(locale, [...namespaces]));
}

/** Load only the namespaces `pathname` needs (every namespace for app routes). */
export function loadLocaleForPath(locale: Locale, pathname: string): Promise<void> {
  const namespaces = namespacesForPath(pathname);
  return namespaces === null ? loadLocale(locale) : loadPaths(locale, pathsFor(locale, namespaces));
}

/** Load what the current route needs under the active scope (see setPublicBootScope). */
export function loadLocaleForCurrentRoute(locale: Locale): Promise<void> {
  const needed = neededNamespaces();
  return needed === null ? loadLocale(locale) : loadPaths(locale, pathsFor(locale, needed));
}

/**
 * Interpolate `{name}` placeholders. Use this instead of concatenating
 * translated fragments so word order stays correct in Arabic
 * (e.g. "{done}/{total} completed" instead of "{done}/{total}" + " completed").
 */
export function formatMessage(
  template: string | undefined,
  values: Record<string, string | number>
): string {
  // E3 (J2-r3): a key from a namespace that is not loaded reads as undefined; never throw on it.
  if (typeof template !== "string") return "";
  const withPlurals = template.includes(", plural,") ? expandPlurals(template, values) : template;
  return withPlurals.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}

/**
 * ICU-style plurals for counted nouns: `{count, plural, one {# invoice} other {# invoices}}`.
 * Categories follow CLDR for the active locale (Arabic has zero, one, two, few, many and other,
 * so "1 فواتير" cannot happen); `#` is the formatted number. A missing category falls back to
 * `other`.
 */
function expandPlurals(template: string, values: Record<string, string | number>): string {
  const { locale } = useI18n.getState();
  const rules = new Intl.PluralRules(locale === "ar" ? "ar" : "en");
  const head = /\{(\w+),\s*plural,\s*/g;
  let out = "";
  let last = 0;
  for (let m = head.exec(template); m; m = head.exec(template)) {
    // Walk the balanced braces of the whole plural block.
    let depth = 1;
    let i = m.index + m[0].length;
    const bodyStart = i;
    while (i < template.length && depth > 0) {
      if (template[i] === "{") depth++;
      else if (template[i] === "}") depth--;
      i++;
    }
    if (depth !== 0) break;
    const body = template.slice(bodyStart, i - 1);
    const forms: Record<string, string> = {};
    const formRe = /(\w+)\s*\{([^{}]*)\}/g;
    for (let f = formRe.exec(body); f; f = formRe.exec(body)) forms[f[1]] = f[2];
    const n = Number(values[m[1]]);
    const category = Number.isFinite(n) ? rules.select(n) : "other";
    const chosen = (n === 0 && forms.zero) || forms[category] || forms.other || "";
    out += template.slice(last, m.index) + chosen.replace(/#/g, String(values[m[1]] ?? ""));
    last = i;
    head.lastIndex = i;
  }
  return out + template.slice(last);
}

/**
 * Translate a catalog key outside React (model/helper code that cannot call hooks). Reads the
 * current locale from the store; callers that memoise the result must remount when the locale or
 * catalogs change (see the Reports page shell, which keys on `useCatalogRevision`).
 */
export function translateNow(key: string): string {
  const { locale } = useI18n.getState();
  return t[locale][key] ?? t.en[key] ?? key;
}

/** Bumps whenever namespace catalogs finish loading; use as a React `key` to refresh memoised copy. */
export function useCatalogRevision(): number {
  return useCatalogVersion((s) => s.version);
}

/**
 * E1: a lookup view over a catalog that may still be loading. A key missing from `locale` falls
 * back to the other locale's copy, then to the key itself, so `t[key]` is never undefined and
 * `.replace(...)` on it cannot throw while a catalog chunk is in flight (an Arabic -> English
 * switch with only the Arabic catalog loaded used to crash NotificationBell).
 */
function withFallback(locale: Locale): TranslationCatalog {
  const other: Locale = locale === "en" ? "ar" : "en";
  return new Proxy(t[locale] as TranslationCatalog, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      return target[prop] ?? t[other][prop] ?? prop;
    },
  });
}

const fallbackViews: Record<Locale, TranslationCatalog> = {
  en: withFallback("en"),
  ar: withFallback("ar"),
};

/**
 * The active catalog. `namespaces` (E3, J2-r3) declares the namespaces this component reads that
 * its route may not load (signed-out public routes load only a subset, see namespacesForPath):
 * they are fetched for the active locale, including after an in-page language switch, and the
 * fallback view is served until they land.
 */
export function useTranslation(namespaces?: readonly string[]) {
  const { locale } = useI18n();
  // Subscribing re-renders the caller once a lazily loaded catalog lands.
  useCatalogVersion((s) => s.version);
  const needed = neededNamespaces();
  const routeReady = hasNamespaces(locale, needed);
  const declaredMissing =
    !!namespaces?.length && !loadedLocales.has(locale) && !hasNamespaces(locale, [...namespaces]);
  if (declaredMissing) void loadNamespaces(locale, namespaces!);
  if (!routeReady || declaredMissing) {
    if (!routeReady) void loadLocaleForCurrentRoute(locale);
    // While a locale's chunks load after a switch, show the other loaded catalog's copy and
    // never hand out an undefined string.
    return { t: fallbackViews[locale], locale };
  }
  return { t: t[locale], locale };
}
