import { planDefinition } from "@shared/plans";
import { BANK_RECONCILIATION_COPY } from "@shared/bank-reconciliation-copy";

export const starterPrice = planDefinition("starter").monthlyPrice;
export type { SiteLocale } from "./routes";
export type Bilingual = readonly [string, string];

export const bankCopy: Bilingual = [BANK_RECONCILIATION_COPY.en, BANK_RECONCILIATION_COPY.ar];
export const vatCopy: Bilingual = [
  "Prepare and review VAT 201 in the app, then submit it in EmaraTax.",
  "أعدّ وراجع إقرار ضريبة القيمة المضافة VAT 201 في التطبيق، ثم قدّمه عبر EmaraTax.",
];

interface Feature {
  slug: string;
  title: Bilingual;
  lead: Bilingual;
  steps: readonly Bilingual[];
  image?: string;
}

const featureData = [
  {
    slug: "invoicing",
    title: ["Invoicing", "الفوترة"],
    image: "invoices",
    lead: [
      "Create bilingual UAE tax invoices and track what customers owe.",
      "أنشئ فواتير ضريبية إماراتية ثنائية اللغة وتابع مستحقات العملاء.",
    ],
    steps: [
      [
        "Set up your customer, items and tax treatment.",
        "أضف العميل والبنود وحدد المعاملة الضريبية.",
      ],
      ["Choose a template and share the invoice.", "اختر قالبًا وشارك الفاتورة."],
      ["Record payments and check outstanding balances.", "سجّل الدفعات وراجع الأرصدة المستحقة."],
    ],
  },
  {
    slug: "accounting",
    title: ["Accounting", "المحاسبة"],
    image: "dashboard",
    lead: [
      "Keep sales, purchases and journal entries in a double-entry ledger.",
      "اجمع المبيعات والمشتريات والقيود في دفتر أستاذ بنظام القيد المزدوج.",
    ],
    steps: [
      [
        "Set up your chart of accounts and opening balances.",
        "أعدّ دليل الحسابات والأرصدة الافتتاحية.",
      ],
      ["Review and post journal entries.", "راجع القيود اليومية ورحّلها."],
      [
        "Check the trial balance and financial statements.",
        "راجع ميزان المراجعة والقوائم المالية.",
      ],
    ],
  },
  {
    slug: "vat",
    title: ["VAT 201", "إقرار VAT 201"],
    image: "vat",
    lead: vatCopy,
    steps: [
      [
        "Select the filing period and review the VAT boxes.",
        "حدد الفترة الضريبية وراجع خانات الإقرار.",
      ],
      [
        "Review the reconciliation to your VAT ledger and export the workbook.",
        "راجع المطابقة مع حسابات الضريبة وصدّر ملف العمل.",
      ],
      ["Submit your reviewed return in EmaraTax.", "قدّم الإقرار بعد مراجعته عبر EmaraTax."],
    ],
  },
  {
    slug: "reporting",
    title: ["Reporting", "التقارير"],
    image: "aging",
    lead: [
      "Review profit and loss, balance sheet, cash flow and ageing from your books.",
      "راجع الأرباح والخسائر والميزانية العمومية والتدفقات النقدية وأعمار الديون من دفاترك.",
    ],
    steps: [
      ["Choose a report and reporting period.", "اختر التقرير وفترة إعداد التقارير."],
      [
        "Review balances and compare periods where supported.",
        "راجع الأرصدة وقارن الفترات في التقارير التي تدعم المقارنة.",
      ],
      ["Export reports to share with your team.", "صدّر التقارير لمشاركتها مع فريقك."],
    ],
  },
  {
    slug: "expenses",
    title: ["Expenses", "المصروفات"],
    image: "receipts",
    lead: [
      "Capture receipts and review employee expense claims.",
      "احفظ الإيصالات وراجع مطالبات مصروفات الموظفين.",
    ],
    steps: [
      ["Upload supporting receipts.", "ارفع الإيصالات المؤيدة للمصروفات."],
      ["Review the amounts and VAT treatment.", "راجع المبالغ والمعاملة الضريبية."],
      [
        "Approve or reject submitted expense claims.",
        "وافق على مطالبات المصروفات المقدمة أو ارفضها.",
      ],
    ],
  },
  {
    slug: "bookkeeping",
    title: ["Bookkeeping", "مسك الدفاتر"],
    image: "dashboard",
    lead: [
      "Maintain day-to-day records and use a checklist to work through month-end.",
      "حدّث السجلات اليومية وتابع خطوات إقفال الشهر بقائمة مراجعة.",
    ],
    steps: [
      [
        "Record sales, bills and receipts throughout the month.",
        "سجّل المبيعات وفواتير الموردين والإيصالات خلال الشهر.",
      ],
      bankCopy,
      [
        "Review outstanding items on the month-end checklist.",
        "راجع البنود المفتوحة في قائمة إقفال الشهر.",
      ],
    ],
  },
  {
    slug: "inventory",
    title: ["Inventory", "المخزون"],
    lead: [
      "Track stock levels and review inventory valuation.",
      "تابع مستويات المخزون وراجع تقييمه.",
    ],
    steps: [
      ["Set up products and item costs.", "أضف المنتجات وتكاليفها."],
      ["Record stock movements and adjustments.", "سجّل حركات المخزون وتسوياته."],
      [
        "Review items with low stock or missing costs.",
        "راجع الأصناف منخفضة المخزون أو التي لم تُسجّل تكلفتها.",
      ],
    ],
  },
  {
    slug: "bank-reconciliation",
    title: ["Bank reconciliation", "المطابقة البنكية"],
    image: "bank",
    lead: bankCopy,
    steps: [
      [
        "Choose the account and preview the CSV before importing.",
        "اختر الحساب وعاين ملف CSV قبل استيراده.",
      ],
      [
        "Review suggestions and resolve unmatched entries.",
        "راجع المطابقات المقترحة وعالج الحركات غير المطابقة.",
      ],
    ],
  },
  {
    slug: "receipt-scanning",
    title: ["AI receipt scanning", "مسح الإيصالات بالذكاء الاصطناعي"],
    image: "receipts",
    lead: [
      "Use OCR to extract receipt details and review them before posting.",
      "استخرج بيانات الإيصالات بالتعرّف الضوئي على الحروف وراجعها قبل الترحيل.",
    ],
    steps: [
      ["Upload a receipt image.", "ارفع صورة الإيصال."],
      [
        "Check the extracted supplier, date and amounts.",
        "تحقّق من اسم المورد والتاريخ والمبالغ المستخرجة.",
      ],
      ["Correct the details before posting the receipt.", "صحّح البيانات قبل ترحيل الإيصال."],
    ],
  },
  {
    slug: "payroll",
    title: ["Payroll", "الرواتب"],
    lead: [
      "Calculate and review payroll runs and generate a WPS salary information file.",
      "احسب مسيرات الرواتب وراجعها وأنشئ ملف معلومات الرواتب لنظام حماية الأجور.",
    ],
    steps: [
      ["Set up employees, allowances and deductions.", "أضف الموظفين والبدلات والاستقطاعات."],
      ["Calculate and review the payroll run.", "احسب مسير الرواتب وراجعه."],
      ["Generate the SIF for submission through your bank.", "أنشئ ملف SIF لتقديمه عبر البنك."],
    ],
  },
  {
    slug: "client-portal",
    title: ["Client portal", "بوابة العملاء"],
    image: "portal",
    lead: [
      "Invite clients into a dedicated portal to view invoices and statements.",
      "ادعُ عملاءك إلى بوابة مخصصة لعرض الفواتير وكشوف الحساب.",
    ],
    steps: [
      [
        "Send a portal invitation to an eligible client contact.",
        "أرسل دعوة إلى جهة الاتصال لدى العميل.",
      ],
      ["Clients accept the invitation and sign in.", "يقبل العميل الدعوة ويسجّل الدخول."],
      [
        "Clients can view invoices, statements and shared documents.",
        "يمكن للعملاء عرض الفواتير وكشوف الحساب والمستندات المشتركة.",
      ],
    ],
  },
  {
    slug: "e-invoicing",
    title: ["UAE e-invoicing", "الفوترة الإلكترونية في الإمارات"],
    lead: [
      "Prepare for UAE e-invoicing with the accredited provider configured for your deployment, either A-Cube or Complyance.",
      "استعد للفوترة الإلكترونية في الإمارات مع مزوّد الخدمة المعتمد المُعدّ لنسخة التطبيق لديك، إما A-Cube أو Complyance.",
    ],
    steps: [
      ["Review your company and customer tax details.", "راجع البيانات الضريبية لشركتك وعملائك."],
      [
        "Confirm which provider is enabled for your deployment and complete its setup.",
        "تحقّق من مزوّد الخدمة المفعّل لنسخة التطبيق لديك وأكمل إعداده.",
      ],
      [
        "Validate invoice data and test the provider connection before going live.",
        "تحقّق من بيانات الفاتورة واختبر اتصال المزوّد قبل التشغيل الفعلي.",
      ],
    ],
  },
] as const satisfies readonly Feature[];

export const features: readonly Feature[] = featureData;
type FeatureSlug = (typeof featureData)[number]["slug"];

export function featureBySlug(slug: FeatureSlug): Feature {
  return features.find((feature) => feature.slug === slug)!;
}

export const tools = [
  { slug: "vat-calculator", title: ["VAT calculator", "حاسبة ضريبة القيمة المضافة"] },
  {
    slug: "corporate-tax-estimator",
    title: ["Corporate tax estimator", "حاسبة تقديرية لضريبة الشركات"],
  },
  {
    slug: "e-invoicing-readiness",
    title: ["E-invoicing readiness checker", "فحص الجاهزية للفوترة الإلكترونية"],
  },
] as const;
