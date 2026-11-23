import { MARKETING_BRAND } from "../../../../../../shared/marketing-brand";
import type { Bilingual } from "../content";

interface EditorialPage {
  title: Bilingual;
  lead: Bilingual;
}

export const launchPages = {
  "/product": {
    title: [
      "Your books, invoices and VAT in one place",
      "دفاترك وفواتيرك وضريبة القيمة المضافة في مكان واحد",
    ],
    lead: [
      "Explore the daily tasks that take you from your first invoice to month-end.",
      "استكشف المهام اليومية من إصدار أول فاتورة إلى إقفال الشهر.",
    ],
  },
  "/tools": {
    title: ["Free tools for UAE businesses", "أدوات مجانية للشركات في الإمارات"],
    lead: [
      "Calculate VAT, download a sample tax invoice or work through an e-invoicing setup checklist.",
      "احسب ضريبة القيمة المضافة أو حمّل نموذج فاتورة ضريبية أو راجع خطوات إعداد الفوترة الإلكترونية.",
    ],
  },
  "/tools/invoice-template": {
    title: [
      "Download a sample bilingual UAE tax invoice",
      "حمّل نموذج فاتورة ضريبية إماراتية بالعربية والإنجليزية",
    ],
    lead: [
      "Inspect the seller and customer details, line items, VAT amounts and totals in a sample PDF.",
      "راجع بيانات البائع والعميل وبنود الفاتورة ومبالغ الضريبة والإجماليات في نموذج PDF.",
    ],
  },
  "/about": {
    title: [`About ${MARKETING_BRAND.name.en}`, `عن ${MARKETING_BRAND.name.ar}`],
    lead: [
      "Najma Al Raeda Accounting and Bookkeeping in Dubai operates the software and offers separate accounting services.",
      "تتولى نجمة الرائدة للمحاسبة ومسك الدفاتر في دبي تشغيل البرنامج وتقدّم خدمات محاسبية منفصلة.",
    ],
  },
  "/contact": {
    title: [`Contact ${MARKETING_BRAND.name.en}`, `تواصل مع ${MARKETING_BRAND.name.ar}`],
    lead: [
      "Request a walkthrough, ask about accounting services or contact support. Leave financial documents out of your initial message.",
      "اطلب عرضًا توضيحيًا أو استفسر عن الخدمات المحاسبية أو تواصل مع الدعم. تجنّب إرفاق المستندات المالية في رسالتك الأولى.",
    ],
  },
} as const satisfies Record<string, EditorialPage>;

export type LaunchPagePath = keyof typeof launchPages;

export function launchPagePath(path: string): LaunchPagePath | undefined {
  return Object.hasOwn(launchPages, path) ? (path as LaunchPagePath) : undefined;
}

export const editorialPages = {
  "/services": {
    title: ["Accounting services", "خدمات المحاسبة"],
    lead: [
      "Work with Najma Al Raeda Accounting and Bookkeeping in Dubai on your books, tax preparation and financial statements.",
      "تعاون مع نجمة الرائدة للمحاسبة ومسك الدفاتر في دبي لتنظيم دفاترك وإعداد إقراراتك وقوائمك المالية.",
    ],
  },
  "/services/bookkeeping": {
    title: ["Bookkeeping services", "خدمات مسك الدفاتر"],
    lead: [
      "Get help bringing overdue books up to date or keeping current records ready for month-end review.",
      "احصل على مساعدة في استدراك الفترات المحاسبية المتأخرة أو تجهيز سجلاتك الحالية لمراجعة نهاية الشهر.",
    ],
  },
  "/services/vat": {
    title: ["UAE VAT services", "خدمات ضريبة القيمة المضافة في الإمارات"],
    lead: [
      "Discuss VAT registration, deregistration or return preparation with the accounting team.",
      "ناقش مع فريق المحاسبة التسجيل في ضريبة القيمة المضافة أو إلغاء التسجيل أو إعداد الإقرار.",
    ],
  },
  "/services/corporate-tax": {
    title: ["UAE corporate tax services", "خدمات ضريبة الشركات في الإمارات"],
    lead: [
      "Get help with corporate tax registration, deregistration and preparing a return from your financial records.",
      "احصل على مساعدة في التسجيل في ضريبة الشركات أو إلغاء التسجيل وإعداد الإقرار بالاستناد إلى سجلاتك المالية.",
    ],
  },
  "/services/financial-reporting": {
    title: ["Financial reporting services", "خدمات إعداد التقارير المالية"],
    lead: [
      "Prepare financial statements from your ledger and organise supporting records for review.",
      "أعدّ قوائم مالية من دفتر الأستاذ ونظّم المستندات المؤيدة للمراجعة.",
    ],
  },
  "/resources": {
    title: ["Resources", "الموارد"],
    lead: [
      "Practical guides for reconciling bank transactions, reviewing VAT 201 and preparing for UAE e-invoicing.",
      "أدلة عملية لمطابقة المعاملات البنكية ومراجعة إقرار VAT 201 والاستعداد للفوترة الإلكترونية في الإمارات.",
    ],
  },
  "/resources/bank-reconciliation-checklist": {
    title: [
      "A month-end bank reconciliation checklist",
      "قائمة مراجعة المطابقة البنكية في نهاية الشهر",
    ],
    lead: [
      "Work through one account and one statement period at a time, from CSV export to the final balance check.",
      "راجع حسابًا واحدًا وفترة كشف واحدة في كل مرة، بدءًا من تصدير ملف CSV وحتى التحقق من الرصيد النهائي.",
    ],
  },
  "/resources/vat-201-checklist": {
    title: ["A checklist for reviewing VAT 201", "قائمة مراجعة إقرار VAT 201"],
    lead: [
      "Check the period, source transactions and supporting records before submitting your UAE VAT return.",
      "تحقّق من الفترة والمعاملات الأصلية والمستندات المؤيدة قبل تقديم إقرار ضريبة القيمة المضافة في الإمارات.",
    ],
  },
  "/resources/e-invoicing-readiness": {
    title: ["Preparing for UAE e-invoicing", "الاستعداد للفوترة الإلكترونية في الإمارات"],
    lead: [
      "Review your invoice data, confirm the provider available for your deployment and plan a test before going live.",
      "راجع بيانات فواتيرك وتحقّق من المزوّد المتاح لنسخة التطبيق لديك وخطّط لاختبار الاتصال قبل التشغيل الفعلي.",
    ],
  },
  "/compare": {
    title: ["Compare accounting software", "قارن برامج المحاسبة"],
    lead: [
      "Compare the workflows your team uses, then test them with a sample invoice, bank statement and month-end report.",
      "قارن مسارات العمل التي يستخدمها فريقك، ثم اختبرها بفاتورة وكشف بنكي وتقرير لنهاية الشهر.",
    ],
  },
  "/compare/wafeq": {
    title: ["Compare with Wafeq", "المقارنة مع وافق (Wafeq)"],
    lead: [
      "Compare invoicing, reconciliation and the records you need to take with you.",
      "قارن الفوترة والمطابقة البنكية والسجلات التي تحتاج إلى نقلها.",
    ],
  },
  "/compare/mazeed": {
    title: ["Compare with Mazeed", "المقارنة مع مزيد (Mazeed)"],
    lead: [
      "Compare the accounting workspace and how each option fits the way you work with an accountant.",
      "قارن مساحة العمل المحاسبية ومدى ملاءمة كل خيار لطريقة تعاونك مع المحاسب.",
    ],
  },
  "/compare/zoho": {
    title: ["Compare with Zoho Books", "المقارنة مع زوهو بوكس (Zoho Books)"],
    lead: [
      "Compare UAE invoicing and reporting workflows, including how each option handles bank data.",
      "قارن مسارات الفوترة وإعداد التقارير في الإمارات، بما في ذلك طريقة التعامل مع البيانات البنكية في كل خيار.",
    ],
  },
  "/migration-guides": {
    title: ["Migration guides", "أدلة الانتقال"],
    lead: [
      "Choose a cutover date, preserve your historical records and verify opening balances before posting in your new books.",
      "حدّد تاريخ الانتقال واحتفظ بسجلاتك السابقة وتحقّق من الأرصدة الافتتاحية قبل الترحيل في دفاترك الجديدة.",
    ],
  },
  "/migration-guides/excel": {
    title: ["Move your books from Excel", "انقل دفاترك من إكسل (Excel)"],
    lead: [
      "Keep a copy of the workbook and build clean CSV files using the app’s import templates.",
      "احتفظ بنسخة من المصنف وجهّز ملفات CSV مرتّبة باستخدام قوالب الاستيراد في التطبيق.",
    ],
  },
  "/migration-guides/wafeq": {
    title: ["Move your books from Wafeq", "انقل دفاترك من وافق (Wafeq)"],
    lead: [
      "Export your records, review the Wafeq column mappings and confirm your balances at cutover.",
      "صدّر سجلاتك وراجع تعيين أعمدة ملفات وافق وتحقّق من الأرصدة عند الانتقال.",
    ],
  },
  "/migration-guides/mazeed": {
    title: ["Move your books from Mazeed", "انقل دفاترك من مزيد (Mazeed)"],
    lead: [
      "Save your reports and use the app’s CSV templates to bring supported records into your new books.",
      "احفظ تقاريرك واستخدم قوالب CSV في التطبيق لنقل السجلات المدعومة إلى دفاترك الجديدة.",
    ],
  },
  "/migration-guides/zoho": {
    title: ["Move your books from Zoho Books", "انقل دفاترك من زوهو بوكس (Zoho Books)"],
    lead: [
      "Export your Zoho organisation data and review the trial balance, open documents and tax mappings before cutover.",
      "صدّر بيانات شركتك من زوهو وراجع ميزان المراجعة والمستندات المفتوحة وتعيين المعاملات الضريبية قبل الانتقال.",
    ],
  },
  "/trust": {
    title: ["Trust and security", "الثقة والأمان"],
    lead: [
      "See how workspace access, activity history and backup tools help you manage your accounting records.",
      "تعرّف على كيفية إدارة سجلاتك المحاسبية باستخدام صلاحيات الوصول وسجل النشاط وأدوات النسخ الاحتياطي.",
    ],
  },
} as const satisfies Record<string, EditorialPage>;

export type EditorialPath = keyof typeof editorialPages;

export const editorialIndexes = {
  "/services": [
    "/services/bookkeeping",
    "/services/vat",
    "/services/corporate-tax",
    "/services/financial-reporting",
  ],
  "/resources": [
    "/resources/bank-reconciliation-checklist",
    "/resources/vat-201-checklist",
    "/resources/e-invoicing-readiness",
  ],
  "/compare": ["/compare/wafeq", "/compare/mazeed", "/compare/zoho"],
  "/migration-guides": [
    "/migration-guides/excel",
    "/migration-guides/wafeq",
    "/migration-guides/mazeed",
    "/migration-guides/zoho",
  ],
} as const satisfies Partial<Record<EditorialPath, readonly EditorialPath[]>>;

export function editorialPath(path: string): EditorialPath | undefined {
  return Object.hasOwn(editorialPages, path) ? (path as EditorialPath) : undefined;
}
