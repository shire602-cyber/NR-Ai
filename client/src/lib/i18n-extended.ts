/**
 * Extended translations for Muhasib.ai new modules.
 *
 * This file supplements the base i18n.ts translations.
 * Merge these into the main `t` object in i18n.ts when ready:
 *
 *   import { extendedTranslations } from './i18n-extended';
 *   export const t = {
 *     en: { ...baseEn, ...extendedTranslations.en },
 *     ar: { ...baseAr, ...extendedTranslations.ar },
 *   };
 */

export const extendedTranslations = {
  en: {
    // ── Payroll & WPS ────────────────────────────────────────────
    payroll: 'Payroll & WPS',
    employees: 'Employees',
    payrollRuns: 'Payroll Runs',
    gratuityCalculator: 'Gratuity Calculator',
    generateSif: 'Generate SIF File',
    basicSalary: 'Basic Salary',
    housingAllowance: 'Housing Allowance',
    transportAllowance: 'Transport Allowance',
    totalSalary: 'Total Salary',
    netSalary: 'Net Salary',
    overtime: 'Overtime',
    deductions: 'Deductions',
    department: 'Department',
    designation: 'Designation',
    joinDate: 'Join Date',
    yearsOfService: 'Years of Service',

    // ── Bill Pay ─────────────────────────────────────────────────
    billPay: 'Bill Pay',
    vendorBills: 'Vendor Bills',
    vendorName: 'Vendor Name',
    billNumber: 'Bill Number',
    dueDate: 'Due Date',
    amountPaid: 'Amount Paid',
    recordPayment: 'Record Payment',
    paymentMethod: 'Payment Method',
    aging: 'Aging Report',
    overdue: 'Overdue',
    pending: 'Pending',
    approved: 'Approved',
    partial: 'Partial',

    // ── Fixed Assets ─────────────────────────────────────────────
    fixedAssets: 'Fixed Assets',
    assetName: 'Asset Name',
    purchaseCost: 'Purchase Cost',
    salvageValue: 'Salvage Value',
    usefulLife: 'Useful Life (Years)',
    depreciationMethod: 'Depreciation Method',
    straightLine: 'Straight Line',
    decliningBalance: 'Declining Balance',
    accumulatedDepreciation: 'Accumulated Depreciation',
    netBookValue: 'Net Book Value',
    runDepreciation: 'Run Depreciation',
    dispose: 'Dispose',

    // ── Budgets ──────────────────────────────────────────────────
    budgeting: 'Budgets',
    budgetName: 'Budget Name',
    fiscalYear: 'Fiscal Year',
    budgetVsActual: 'Budget vs Actual',
    variance: 'Variance',
    underBudget: 'Under Budget',
    overBudget: 'Over Budget',

    // ── Expense Claims ───────────────────────────────────────────
    expenseClaims: 'Expense Claims',
    myClaims: 'My Claims',
    reviewClaims: 'Review Claims',
    submitClaim: 'Submit Claim',
    approveClaim: 'Approve',
    rejectClaim: 'Reject',
    claimTitle: 'Claim Title',
    merchant: 'Merchant',

    // ── Cash Flow Forecast ───────────────────────────────────────
    cashFlowForecast: 'Cash Flow Forecast',
    currentBalance: 'Current Balance',
    projectedBalance: 'Projected Balance',
    expectedInflows: 'Expected Inflows',
    expectedOutflows: 'Expected Outflows',
    aiInsights: 'AI Insights',

    // ── Anomaly Detection ────────────────────────────────────────
    anomalyDetection: 'Anomaly Detection',
    scanForAnomalies: 'Scan for Anomalies',
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
    dismiss: 'Dismiss',

    // ── HR / Employee Details ────────────────────────────────────
    nationality: 'Nationality',
    passportNumber: 'Passport Number',
    visaNumber: 'Visa Number',
    laborCardNumber: 'Labor Card Number',
    bankName: 'Bank Name',
    iban: 'IBAN',

    // ── General / Shared ─────────────────────────────────────────
    active: 'Active',
    category: 'Category',
    serialNumber: 'Serial Number',
    location: 'Location',
    notes: 'Notes',
    month: 'Month',
    year: 'Year',
    week: 'Week',
    submitted: 'Submitted',
    rejected: 'Rejected',
    paidStatus: 'Paid',

    // ── PWA ──────────────────────────────────────────────────────
    installApp: 'Install App',
    offlineMessage: 'You are currently offline',
  },

  ar: {
    // ── Payroll & WPS ────────────────────────────────────────────
    payroll: 'الرواتب والحماية',
    employees: 'الموظفون',
    payrollRuns: 'دورات الرواتب',
    gratuityCalculator: 'حاسبة مكافأة نهاية الخدمة',
    generateSif: 'إنشاء ملف SIF',
    basicSalary: 'الراتب الأساسي',
    housingAllowance: 'بدل السكن',
    transportAllowance: 'بدل النقل',
    totalSalary: 'إجمالي الراتب',
    netSalary: 'صافي الراتب',
    overtime: 'العمل الإضافي',
    deductions: 'الخصومات',
    department: 'القسم',
    designation: 'المسمى الوظيفي',
    joinDate: 'تاريخ الالتحاق',
    yearsOfService: 'سنوات الخدمة',

    // ── Bill Pay ─────────────────────────────────────────────────
    billPay: 'دفع الفواتير',
    vendorBills: 'فواتير الموردين',
    vendorName: 'اسم المورد',
    billNumber: 'رقم الفاتورة',
    dueDate: 'تاريخ الاستحقاق',
    amountPaid: 'المبلغ المدفوع',
    recordPayment: 'تسجيل دفعة',
    paymentMethod: 'طريقة الدفع',
    aging: 'تقرير التقادم',
    overdue: 'متأخر',
    pending: 'قيد الانتظار',
    approved: 'معتمد',
    partial: 'جزئي',

    // ── Fixed Assets ─────────────────────────────────────────────
    fixedAssets: 'الأصول الثابتة',
    assetName: 'اسم الأصل',
    purchaseCost: 'تكلفة الشراء',
    salvageValue: 'قيمة الخردة',
    usefulLife: 'العمر الإنتاجي (سنوات)',
    depreciationMethod: 'طريقة الإهلاك',
    straightLine: 'القسط الثابت',
    decliningBalance: 'القسط المتناقص',
    accumulatedDepreciation: 'الإهلاك المتراكم',
    netBookValue: 'صافي القيمة الدفترية',
    runDepreciation: 'تشغيل الإهلاك',
    dispose: 'التخلص',

    // ── Budgets ──────────────────────────────────────────────────
    budgeting: 'الميزانيات',
    budgetName: 'اسم الميزانية',
    fiscalYear: 'السنة المالية',
    budgetVsActual: 'الميزانية مقابل الفعلي',
    variance: 'الفرق',
    underBudget: 'ضمن الميزانية',
    overBudget: 'تجاوز الميزانية',

    // ── Expense Claims ───────────────────────────────────────────
    expenseClaims: 'مطالبات المصروفات',
    myClaims: 'مطالباتي',
    reviewClaims: 'مراجعة المطالبات',
    submitClaim: 'تقديم مطالبة',
    approveClaim: 'اعتماد',
    rejectClaim: 'رفض',
    claimTitle: 'عنوان المطالبة',
    merchant: 'التاجر',

    // ── Cash Flow Forecast ───────────────────────────────────────
    cashFlowForecast: 'توقعات التدفق النقدي',
    currentBalance: 'الرصيد الحالي',
    projectedBalance: 'الرصيد المتوقع',
    expectedInflows: 'التدفقات المتوقعة',
    expectedOutflows: 'المصروفات المتوقعة',
    aiInsights: 'رؤى الذكاء الاصطناعي',

    // ── Anomaly Detection ────────────────────────────────────────
    anomalyDetection: 'كشف الحالات الشاذة',
    scanForAnomalies: 'فحص الحالات الشاذة',
    critical: 'حرج',
    warning: 'تحذير',
    info: 'معلومات',
    dismiss: 'تجاهل',

    // ── HR / Employee Details ────────────────────────────────────
    nationality: 'الجنسية',
    passportNumber: 'رقم الجواز',
    visaNumber: 'رقم التأشيرة',
    laborCardNumber: 'رقم بطاقة العمل',
    bankName: 'اسم البنك',
    iban: 'رقم الآيبان',

    // ── General / Shared ─────────────────────────────────────────
    active: 'نشط',
    category: 'الفئة',
    serialNumber: 'الرقم التسلسلي',
    location: 'الموقع',
    notes: 'ملاحظات',
    month: 'الشهر',
    year: 'السنة',
    week: 'الأسبوع',
    submitted: 'مقدّم',
    rejected: 'مرفوض',
    paidStatus: 'مدفوع',

    // ── PWA ──────────────────────────────────────────────────────
    installApp: 'تثبيت التطبيق',
    offlineMessage: 'أنت غير متصل بالإنترنت حالياً',
  },
} as const;

/** Type for the extended translation keys */
export type ExtendedTranslationKey = keyof typeof extendedTranslations.en;

/** Type-safe lookup helper. Falls back to key name if missing. */
export function getExtendedTranslation(
  locale: 'en' | 'ar',
  key: ExtendedTranslationKey,
): string {
  return extendedTranslations[locale][key] ?? key;
}
