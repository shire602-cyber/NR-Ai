/**
 * Arabic localization for the report catalog (report names + decision
 * questions) and the Report Center categories.
 *
 * This is a render-time overlay keyed by report id / category, resolved in
 * Reports.tsx. The English catalog in reportCatalog.ts is the single source of
 * truth for structure, ids, links, personas, and automation metadata and is
 * deliberately NOT modified — this map only supplies Arabic display strings,
 * falling back to the English catalog value for any id not listed here.
 */

/** Arabic report display names, keyed by report id. */
export const reportNameAr: Record<string, string> = {
  "profit-loss": "الأرباح والخسائر",
  "balance-sheet": "الميزانية العمومية",
  "vat-summary": "ملخص ضريبة القيمة المضافة",
  "cash-flow": "قائمة التدفقات النقدية",
  "ar-aging": "أعمار الذمم المدينة",
  "ap-aging": "أعمار الذمم الدائنة",
  "trial-balance": "ميزان المراجعة",
  "vat-return": "إقرار ضريبة القيمة المضافة",
  "period-comparison": "مقارنة الفترات",
  "fx-gains-losses": "أرباح وخسائر الصرف",
  "general-ledger": "دفتر الأستاذ العام",
  "account-transactions": "حركات الحساب",
  "corporate-tax-estimate": "تقدير ضريبة الشركات",
  "customer-balances": "ملخص أرصدة العملاء",
  "vendor-balances": "ملخص أرصدة الموردين",
  "invoice-status": "حالة الفواتير",
  "budget-actual": "الموازنة مقابل الفعلي",
  "cash-flow-forecast": "توقعات التدفق النقدي",
  "revenue-customer": "الإيرادات حسب العميل",
  "sales-product-service": "المبيعات حسب المنتج/الخدمة",
  "expenses-vendor": "المصروفات حسب المورد",
  "expenses-category": "المصروفات حسب الفئة",
  "cost-center-profitability": "أرباح وخسائر مراكز التكلفة",
  "inventory-valuation": "تقييم المخزون",
  "inventory-movement": "حركة المخزون",
  "fixed-asset-register": "سجل الأصول الثابتة",
  "depreciation-schedule": "جدول الإهلاك",
  "payroll-summary": "ملخص الرواتب",
  "wps-sif-summary": "ملخص نظام حماية الأجور",
  "expense-claims": "مطالبات المصروفات",
  "month-end-close-status": "حالة إقفال نهاية الشهر",
  "audit-trail": "سجل التدقيق",
  "consolidated-statements": "التجميع الإداري",
};

/** Arabic decision questions, keyed by report id. */
export const reportQuestionAr: Record<string, string> = {
  "profit-loss": "هل حقق النشاط ربحًا خلال الفترة المحددة؟",
  "balance-sheet": "ما الذي يملكه النشاط ويدين به ويحتفظ به حتى هذا التاريخ؟",
  "vat-summary": "كم ضريبة القيمة المضافة المستحقة أو القابلة للاسترداد لهذه الفترة؟",
  "cash-flow": "من أين جاء النقد وأين ذهب خلال الفترة؟",
  "ar-aging": "أي عملاء عليهم مبالغ وما مدى تأخرهم؟",
  "ap-aging": "أي فواتير موردين مستحقة ومتى ينبغي سدادها؟",
  "trial-balance": "هل يتوازن المدين والدائن قبل الإقفال؟",
  "vat-return": "هل إقرار ضريبة القيمة المضافة جاهز للتقديم مع الإجماليات الداعمة؟",
  "period-comparison": "ما الذي تغيّر مقارنة بالفترة السابقة ولماذا؟",
  "fx-gains-losses": "كم أثّر تعرّض العملة على الأرباح أو الأرصدة؟",
  "general-ledger": "أي قيود دفترية تفسّر رصيد كل حساب؟",
  "account-transactions": "ما النشاط المصدري الذي يكوّن هذا الحساب؟",
  "corporate-tax-estimate": "ما تعرّض ضريبة الشركات الذي ينبغي التخطيط له؟",
  "customer-balances": "أي عملاء يقودون الذمم المدينة المفتوحة؟",
  "vendor-balances": "أي موردين يقودون الذمم الدائنة المفتوحة؟",
  "invoice-status": "أي فواتير مسودة أو مُرسَلة أو متأخرة أو مدفوعة؟",
  "budget-actual": "أين يتجاوز الأداء الموازنة أو يقل عنها؟",
  "cash-flow-forecast": "إلى متى يستطيع النشاط تغطية احتياجاته النقدية القادمة؟",
  "revenue-customer": "أي عملاء يقودون الإيرادات ومخاطر التركّز؟",
  "sales-product-service": "أي منتجات أو خدمات تقود مزيج المبيعات؟",
  "expenses-vendor": "أي موردين يقودون الإنفاق في هذه الفترة؟",
  "expenses-category": "أي فئات تدفع التكاليف فوق الخطة؟",
  "cost-center-profitability": "أي أقسام أو مراكز تكلفة تقود الربح أو الخسارة؟",
  "inventory-valuation": "ما قيمة المخزون المتوفر حاليًا؟",
  "inventory-movement": "ما المخزون الذي دخل أو خرج خلال الفترة؟",
  "fixed-asset-register": "أي أصول نشطة وما قيمتها؟",
  "depreciation-schedule": "ما الإهلاك الذي ينبغي قيده هذه الفترة؟",
  "payroll-summary": "ما تكلفة الرواتب وعدد الموظفين المتغيّر هذه الفترة؟",
  "wps-sif-summary": "هل مسير الرواتب جاهز لتقديم نظام حماية الأجور؟",
  "expense-claims": "أي مطالبات أو مبالغ استرداد تحتاج موافقة أو دفعًا؟",
  "month-end-close-status": "أي مهام إقفال مكتملة أو متعثرة؟",
  "audit-trail": "أي أنشطة مستخدمين تحتاج مراجعة تدقيق؟",
  "consolidated-statements": "كيف تتجمّع الكيانات المتاحة في عرض إداري واحد؟",
};

/** Arabic Report Center category labels, keyed by the English category key. */
export const reportCategoryAr: Record<string, string> = {
  "Financial Statements": "البيانات المالية",
  "Sales & Receivables": "المبيعات والذمم المدينة",
  "Purchases & Payables": "المشتريات والذمم الدائنة",
  Payroll: "الرواتب",
  "Accountant & Taxes": "المحاسب والضرائب",
  "Inventory & Assets": "المخزون والأصول",
  "Management & Planning": "الإدارة والتخطيط",
};
