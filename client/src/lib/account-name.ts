/**
 * The standard chart's names in Arabic, for an account that was created without an Arabic name of its own
 * (an older company, an account added by hand with the standard English name).
 */
const STANDARD_NAMES_AR: Record<string, string> = {
  "Accounts Payable": "الذمم الدائنة",
  "Accounts Receivable": "الذمم المدينة",
  "Accrued Expenses": "المصروفات المستحقة",
  "Accumulated Depreciation": "الاستهلاك المتراكم",
  "Bad Debt Expense": "مصروف الديون المعدومة",
  "Bank Accounts": "الحسابات البنكية",
  "Bank Charges & Fees": "الرسوم والعمولات البنكية",
  "Bank Current": "الحساب البنكي الجاري",
  "Bank Current Account": "الحساب البنكي الجاري",
  "Cash on Hand": "النقد في الصندوق",
  "Computers & Software": "الحواسيب والبرمجيات",
  "Corporate Tax Expense": "مصروف ضريبة الشركات",
  "Corporate Tax Payable": "ضريبة الشركات المستحقة",
  "Cost of Goods Sold": "تكلفة البضاعة المباعة",
  "Customer Advances": "دفعات العملاء المقدمة",
  "Customer Credit": "رصيد دائن للعملاء",
  "Depreciation Expense": "مصروف الاستهلاك",
  "Discounts Given": "الخصومات الممنوحة",
  "Dividends / Owner Drawings": "توزيعات الأرباح / سحوبات المالك",
  "Employee Loans": "قروض الموظفين",
  "Employee Reimbursements Payable": "مستحقات الموظفين",
  "End-of-Service Gratuity Expense": "مصروف مكافأة نهاية الخدمة",
  "End-of-Service Gratuity Provision": "مخصص مكافأة نهاية الخدمة",
  "Exempt Sales": "مبيعات معفاة",
  "FTA VAT Control Account": "حساب مراقبة ضريبة القيمة المضافة - الهيئة الاتحادية للضرائب",
  "Fixed Assets at Cost": "الأصول الثابتة بالتكلفة",
  "Foreign Exchange Gain": "أرباح صرف العملات الأجنبية",
  "Foreign Exchange Loss": "خسائر صرف العملات الأجنبية",
  "Furniture & Fixtures": "الأثاث والتركيبات",
  "Gain on Asset Disposal": "ربح من بيع الأصول",
  "General Expenses": "مصروفات عامة",
  "Goods Received Not Invoiced": "بضاعة مستلمة لم تتم فوترتها",
  "Interest Income": "إيرادات الفوائد",
  "Inventory": "المخزون",
  "Inventory Adjustments": "تسويات المخزون",
  "Irrecoverable VAT Expense": "مصروف ضريبة القيمة المضافة غير القابلة للاسترداد",
  "Lease Liabilities": "التزامات الإيجار",
  "Leave Pay Expense": "مصروف أجور الإجازات",
  "Leave Pay Provision": "مخصص أجور الإجازات",
  "Loan Payable": "القروض المستحقة",
  "Loss on Asset Disposal": "خسارة من بيع الأصول",
  "Marketing & Advertising": "التسويق والإعلان",
  "Meals & Entertainment": "الوجبات والضيافة",
  "Office Equipment": "معدات المكتب",
  "Office Supplies": "اللوازم المكتبية",
  "Opening Balance Equity": "رصيد افتتاحي - حقوق الملكية",
  "Other Income": "إيرادات أخرى",
  "Owner's Capital / Share Capital": "رأس مال المالك / رأس المال",
  "Payment Gateway Clearing": "حساب تسوية بوابة الدفع",
  "Payroll Deductions Payable": "استقطاعات الرواتب المستحقة",
  "Pension Expense (Employer)": "مصروف المعاش (صاحب العمل)",
  "Pension Payable - GPSSA": "المعاش المستحق - الهيئة العامة للمعاشات",
  "Petty Cash": "النثرية",
  "Prepaid Expenses": "المصروفات المدفوعة مقدماً",
  "Product Sales": "مبيعات المنتجات",
  "Professional Services": "الخدمات المهنية",
  "Rent Expense": "مصروف الإيجار",
  "Retained Earnings": "الأرباح المحتجزة",
  "Salaries & Wages": "الرواتب والأجور",
  "Salaries Payable": "الرواتب المستحقة",
  "Service Revenue": "إيرادات الخدمات",
  "Shipping Income": "إيرادات الشحن",
  "Software Subscriptions": "اشتراكات البرمجيات",
  "Telephone & Internet": "الهاتف والإنترنت",
  "Travel & Meals": "السفر والوجبات",
  "Utilities": "المرافق",
  "VAT Adjustments": "تسويات ضريبة القيمة المضافة",
  "VAT Payable (Output VAT)": "ضريبة القيمة المضافة المستحقة",
  "VAT Receivable (Input VAT)": "ضريبة القيمة المضافة المستردة",
  "Zero-Rated Sales": "مبيعات بنسبة صفر",
};

/** An account's name in the reader's language: its own Arabic name, else the standard Arabic name for its English name, else the English name. */
export function accountName(
  account: { nameEn?: string | null; nameAr?: string | null; name?: string | null } | null | undefined,
  locale: string
): string {
  if (!account) return "";
  const ar = account.nameAr?.trim();
  const en = (account.nameEn || account.name || "").trim();
  if (locale === "ar") return ar || STANDARD_NAMES_AR[en] || en || "";
  return (en || ar || "") as string;
}
