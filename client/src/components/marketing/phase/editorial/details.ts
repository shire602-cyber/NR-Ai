import { marketingBrand, supportEmail } from "@shared/marketing-brand";
import { bankCopy, bankFeedCopy, featureBySlug, vatCopy, type Bilingual } from "../content";
import type { EditorialPath, editorialIndexes } from "./pages";

interface Section {
  title: Bilingual;
  body: Bilingual;
}

interface RelatedLink {
  title: Bilingual;
  path: string;
}

interface SourceLink {
  title: Bilingual;
  url: string | Bilingual;
}

interface Details {
  sections?: readonly Section[];
  comparison?: readonly [Section, Section];
  checklist?: { title: Bilingual; items: readonly Bilingual[] };
  related?: readonly RelatedLink[];
  sources?: readonly SourceLink[];
  email?: { title: Bilingual; address: string; subject?: Bilingual };
}

type IndexPath = keyof typeof editorialIndexes;
type DetailPath = Exclude<EditorialPath, IndexPath>;

const serviceEmail = {
  title: ["Ask about accounting services", "استفسر عن خدمات المحاسبة"],
  address: supportEmail,
  subject: ["Accounting services consultation", "استشارة بشأن خدمات المحاسبة"],
} satisfies NonNullable<Details["email"]>;

const books = { path: "/product/bookkeeping", title: featureBySlug("bookkeeping").title };
const reporting = { path: "/product/reporting", title: featureBySlug("reporting").title };
const banking = {
  path: "/product/bank-reconciliation",
  title: featureBySlug("bank-reconciliation").title,
};
const vat = { path: "/product/vat", title: featureBySlug("vat").title };
const einvoicing = { path: "/product/e-invoicing", title: featureBySlug("e-invoicing").title };
const planLink: RelatedLink = { path: "/pricing", title: ["View plans", "عرض الباقات"] };

const wafeqSales: SourceLink = {
  title: ["Sales invoices and exports in Wafeq", "فواتير المبيعات وتصديرها في وافق"],
  url: [
    "https://help.wafeq.com/hc/en-ae/articles/20859758405148-Creating-a-sales-invoice",
    "https://help.wafeq.com/hc/ar-ae/articles/20859758405148",
  ],
};
const wafeqBank: SourceLink = {
  title: ["Bank reconciliation in Wafeq", "المطابقة البنكية في وافق"],
  url: [
    "https://www.wafeq.com/en-ae/wafeq-help/bank-and-reconciliation/importing-your-bank-account-and-reconciling-transactions",
    "https://www.wafeq.com/ar-ae/مركز-المساعدة/المعاملات-المصرفية-و-التسوية/استيراد-حسابك-المصرفي-و-تسوية-المعاملات",
  ],
};
const mazeedReports: SourceLink = {
  title: ["Financial reporting and exports in Mazeed", "التقارير المالية وتصديرها في مزيد"],
  url: ["https://mazeed.com/financial-reporting/", "https://mazeed.com/ar/financial-reporting/"],
};
const zohoExport: SourceLink = {
  title: ["Import and export in Zoho Books", "الاستيراد والتصدير في زوهو بوكس (بالإنجليزية)"],
  url: "https://www.zoho.com/ae/books/help/import-export/",
};
const taxSubmission: SourceLink = {
  title: [
    "Tax return submission guidance from the Federal Tax Authority",
    "إرشادات الهيئة الاتحادية للضرائب لتقديم الإقرار الضريبي",
  ],
  url: [
    "https://tax.gov.ae/en/emaratax/process.key.message/submit.and.pay.tax.return.aspx",
    "https://tax.gov.ae/ar/emaratax/process.key.message/submit.and.pay.tax.return.aspx",
  ],
};
const providerList: SourceLink = {
  title: [
    "Accredited providers listed by the Ministry of Finance",
    "مزوّدو الخدمة المعتمدون لدى وزارة المالية",
  ],
  url: [
    "https://mof.gov.ae/en/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/",
    "https://mof.gov.ae/ar/about-us/initiatives/einvoicing/einvoicing-accredited-service-providers-asps/",
  ],
};

const appTitle: Bilingual = [marketingBrand, marketingBrand];
const bankWorkflow: Bilingual = [
  `${bankCopy[0]}. ${bankFeedCopy[0]}`,
  `${bankCopy[1]}. ${bankFeedCopy[1]}`,
];

const cutover: Section = {
  title: [
    "Bring over opening balances and open records",
    "انقل الأرصدة الافتتاحية والسجلات المفتوحة",
  ],
  body: [
    "In Import data, start with the chart of accounts, then the opening trial balance, customers, suppliers and items. If you need document-level ageing, choose the option to carry receivables and payables through open invoices and bills, then import those documents. Review the preview and validation results before committing each file.",
    "ابدأ في شاشة «استيراد البيانات» بدليل الحسابات، ثم ميزان المراجعة الافتتاحي والعملاء والموردين والأصناف. إذا احتجت إلى تقرير أعمار الديون لكل مستند، فاختر نقل الذمم المدينة والدائنة عبر الفواتير المفتوحة، ثم استوردها. راجع المعاينة ونتائج التحقق قبل اعتماد كل ملف.",
  ],
};
const verify: Section = {
  title: ["Verify the new books", "تحقّق من الدفاتر الجديدة"],
  body: [
    "Compare the new trial balance, open receivables and payables, bank balances and VAT control accounts to your records at cutover. Investigate any difference before posting new activity. Reconcile from the cutover date forward using a CSV exported from your bank. Keep prior tax returns and supporting documents with your historical exports.",
    "قارن ميزان المراجعة الجديد والذمم المدينة والدائنة المفتوحة والأرصدة البنكية وحسابات مراقبة الضريبة بالسجلات المؤرخة في يوم الانتقال. تحرَّ عن أي فرق قبل ترحيل معاملات جديدة. طابق المعاملات من تاريخ الانتقال فصاعدًا باستخدام ملف CSV مصدّر من البنك. احتفظ بالإقرارات السابقة والمستندات المؤيدة مع ملفات التصدير التاريخية.",
  ],
};

export const editorialDetails: Record<DetailPath, Details> & Partial<Record<IndexPath, Details>> = {
  "/services": { email: serviceEmail },
  "/resources": {
    related: [
      { path: "/compare", title: ["Compare accounting software", "قارن برامج المحاسبة"] },
      { path: "/migration-guides", title: ["Migration guides", "أدلة الانتقال"] },
    ],
  },
  "/services/bookkeeping": {
    sections: [
      {
        title: ["Catch up on overdue periods", "استدرك الفترات المحاسبية المتأخرة"],
        body: [
          "Bring your sales invoices, supplier bills, receipts and bank records. The accounting team can help record historical activity and identify transactions that need supporting documents or clarification.",
          "اجمع فواتير المبيعات وفواتير الموردين والإيصالات والسجلات البنكية. يمكن لفريق المحاسبة مساعدتك في تسجيل المعاملات السابقة وتحديد الحركات التي تحتاج إلى مستندات مؤيدة أو توضيح.",
        ],
      },
      {
        title: ["Set a monthly close routine", "ضع جدولًا لإقفال الحسابات شهريًا"],
        body: [
          "Agree when to share records, who will review exceptions and when to close the month. The team can record invoices, bills and receipts and reconcile bank transactions from the records you provide.",
          "اتفق على موعد مشاركة السجلات ومن يراجع الحالات الاستثنائية ومتى تُقفل حسابات الشهر. يمكن للفريق تسجيل فواتير المبيعات والمشتريات والإيصالات ومطابقة المعاملات البنكية استنادًا إلى السجلات التي تقدّمها.",
        ],
      },
    ],
    related: [books, banking],
    email: serviceEmail,
  },
  "/services/vat": {
    sections: [
      {
        title: ["Registration and deregistration", "التسجيل وإلغاء التسجيل"],
        body: [
          "Bring your business details, tax registration information and recent turnover records. The team can help review your situation and prepare the information needed for the relevant application.",
          "جهّز بيانات نشاطك التجاري ومعلومات التسجيل الضريبي وسجلات رقم الأعمال الأخيرة. يمكن للفريق مراجعة وضعك ومساعدتك في إعداد المعلومات اللازمة للطلب المناسب.",
        ],
      },
      {
        title: ["Return preparation", "إعداد الإقرار"],
        body: [
          `The team can help review sales, purchases and supporting documents for the period. ${vatCopy[0]}`,
          `يمكن للفريق مساعدتك في مراجعة المبيعات والمشتريات والمستندات المؤيدة للفترة. ${vatCopy[1]}`,
        ],
      },
    ],
    related: [vat],
    sources: [taxSubmission],
    email: serviceEmail,
  },
  "/services/corporate-tax": {
    sections: [
      {
        title: ["Review registration details", "راجع بيانات التسجيل"],
        body: [
          "Gather the trade licence, legal entity details and financial year dates. The team can help prepare your registration or review your circumstances if you need to apply for deregistration.",
          "اجمع الرخصة التجارية وبيانات الكيان القانوني وتواريخ السنة المالية. يمكن للفريق مساعدتك في إعداد طلب التسجيل أو مراجعة وضعك إذا احتجت إلى تقديم طلب إلغاء التسجيل.",
        ],
      },
      {
        title: ["Organise return working papers", "نظّم أوراق عمل الإقرار"],
        body: [
          "Start from the posted books and financial statements. Discuss what supporting schedules and adjustments your accountant needs to review before you submit the return.",
          "ابدأ بالدفاتر المرحّلة والقوائم المالية. ناقش الجداول المؤيدة والتعديلات التي يحتاج محاسبك إلى مراجعتها قبل تقديم الإقرار.",
        ],
      },
    ],
    related: [
      {
        path: "/tools/corporate-tax-estimator",
        title: ["Corporate tax estimator", "حاسبة تقديرية لضريبة الشركات"],
      },
    ],
    email: serviceEmail,
  },
  "/services/financial-reporting": {
    sections: [
      {
        title: ["Review statements from the ledger", "راجع القوائم المستخرجة من دفتر الأستاذ"],
        body: [
          "Agree on the reporting period and check that the underlying entries are posted. The team can prepare a profit and loss statement, balance sheet and cash flow statement from your ledger.",
          "حدّد فترة إعداد التقارير وتحقّق من ترحيل القيود الأساسية. يمكن للفريق إعداد قائمة الأرباح والخسائر والميزانية العمومية وقائمة التدفقات النقدية من دفتر الأستاذ.",
        ],
      },
      {
        title: ["Gather documents for review", "اجمع المستندات للمراجعة"],
        body: [
          "Match balances to supporting schedules and collect documents for open items. Discuss the records you need for an upcoming compliance check or audit.",
          "طابق الأرصدة مع الجداول المؤيدة واجمع مستندات البنود المفتوحة. ناقش السجلات اللازمة لفحص امتثال أو تدقيق مرتقب.",
        ],
      },
    ],
    related: [reporting, books],
    email: serviceEmail,
  },
  "/resources/bank-reconciliation-checklist": {
    sections: [{ title: banking.title, body: bankWorkflow }],
    checklist: {
      title: ["Month-end checks", "خطوات مراجعة نهاية الشهر"],
      items: [
        [
          "Export the statement directly from your bank. Verify the account, currency and dates before previewing the CSV.",
          "صدّر كشف الحساب من البنك مباشرةً. تحقّق من الحساب والعملة والتواريخ قبل معاينة ملف CSV.",
        ],
        [
          "Review the imported rows for missing or overlapping periods. Check the reference, date and amount on each suggested match.",
          "راجع الصفوف المستوردة بحثًا عن فترات ناقصة أو متداخلة. تحقّق من المرجع والتاريخ والمبلغ في كل مطابقة مقترحة.",
        ],
        [
          "Investigate unmatched fees, transfers and timing differences. Check whether the underlying entry already exists before recording anything new.",
          "تحرَّ عن الرسوم والتحويلات غير المطابقة والفروق الناتجة عن التوقيت. تحقّق مما إذا كان القيد موجودًا بالفعل قبل تسجيل أي قيد جديد.",
        ],
        [
          "Compare the closing statement balance to your books and retain the statement and reconciliation for review.",
          "قارن الرصيد الختامي في الكشف برصيد دفاترك واحتفظ بالكشف ونتيجة المطابقة للمراجعة.",
        ],
      ],
    },
    related: [banking, books],
  },
  "/resources/vat-201-checklist": {
    sections: [
      { title: ["From review to submission", "من المراجعة إلى تقديم الإقرار"], body: vatCopy },
    ],
    checklist: {
      title: ["Before submitting", "قبل تقديم الإقرار"],
      items: [
        [
          "Confirm the entity, tax registration number and reporting period against EmaraTax.",
          "طابق بيانات المنشأة ورقم التسجيل الضريبي وفترة الإقرار مع بيانات إمارات تاكس.",
        ],
        [
          "Review sales, purchases and credit notes in the period. Follow up on missing documents and unexpected VAT treatment.",
          "راجع المبيعات والمشتريات والإشعارات الدائنة للفترة. تابع المستندات الناقصة والمعاملات الضريبية غير المتوقعة.",
        ],
        [
          "Check the VAT 201 boxes against the VAT ledger and resolve differences. Export the reviewed workbook for your records.",
          "طابق خانات إقرار VAT 201 مع دفتر حسابات الضريبة وعالج الفروق. صدّر ملف العمل بعد المراجعة للاحتفاظ به ضمن سجلاتك.",
        ],
        [
          "Submit the reviewed return in EmaraTax and retain the acknowledgement with your supporting records.",
          "قدّم الإقرار بعد مراجعته عبر إمارات تاكس واحتفظ بإشعار الاستلام مع المستندات المؤيدة.",
        ],
      ],
    },
    related: [vat],
    sources: [taxSubmission],
  },
  "/resources/e-invoicing-readiness": {
    sections: [
      {
        title: ["Check the provider connection", "تحقّق من اتصال مزوّد الخدمة"],
        body: featureBySlug("e-invoicing").lead,
      },
    ],
    checklist: {
      title: ["Before going live", "قبل التشغيل الفعلي"],
      items: [
        [
          "Check which transactions and dates apply to your business in the Ministry of Finance guidance.",
          "راجع إرشادات وزارة المالية لمعرفة المعاملات والمواعيد التي تنطبق على نشاطك.",
        ],
        [
          "Review the legal names, addresses and tax identifiers on company and customer records. Check the line items and VAT treatment on a sample invoice.",
          "راجع الأسماء القانونية والعناوين وأرقام التعريف الضريبي في سجلات شركتك وعملائك. تحقّق من البنود والمعاملة الضريبية في فاتورة تجريبية.",
        ],
        [
          "Complete onboarding with the configured provider. Validate a sample structured invoice and review the provider response before sending live invoices.",
          "أكمل التسجيل لدى المزوّد المُعدّ في التطبيق. تحقّق من فاتورة إلكترونية منظّمة تجريبية وراجع استجابة المزوّد قبل إرسال فواتير فعلية.",
        ],
      ],
    },
    related: [
      einvoicing,
      { path: "/tools/e-invoicing-readiness", title: ["Check your readiness", "تحقّق من جاهزيتك"] },
    ],
    sources: [
      {
        title: [
          "UAE e-invoicing guidance from the Ministry of Finance",
          "إرشادات وزارة المالية للفوترة الإلكترونية",
        ],
        url: [
          "https://mof.gov.ae/en/about-us/initiatives/einvoicing/",
          "https://mof.gov.ae/ar/about-us/initiatives/einvoicing/",
        ],
      },
      providerList,
    ],
  },
  "/compare/wafeq": {
    comparison: [
      {
        title: appTitle,
        body: [
          `${featureBySlug("invoicing").lead[0]} ${bankWorkflow[0]}`,
          `${featureBySlug("invoicing").lead[1]} ${bankWorkflow[1]}`,
        ],
      },
      {
        title: ["Wafeq", "وافق"],
        body: [
          "Wafeq documents sales invoicing and invoice exports, as well as importing bank transactions and reconciling them against records in Wafeq.",
          "يوثّق وافق طريقة إعداد فواتير المبيعات وتصديرها، كما يشرح استيراد المعاملات البنكية ومطابقتها مع السجلات في وافق.",
        ],
      },
    ],
    checklist: {
      title: ["What to test", "ما يستحق الاختبار"],
      items: [
        [
          "Create a tax invoice with the fields and languages your customers expect.",
          "أنشئ فاتورة ضريبية تتضمن الحقول واللغات التي يتوقعها عملاؤك.",
        ],
        [
          "Reconcile a statement for one account and check how you review a suggested match or resolve an unmatched transaction.",
          "طابق كشفًا لحساب واحد وجرّب مراجعة مطابقة مقترحة أو معالجة معاملة غير مطابقة.",
        ],
        [
          "Export a trial balance and a list of open invoices. Check which formats and features are included in the plan you would use.",
          "صدّر ميزان مراجعة وقائمة بالفواتير المفتوحة. تحقّق من الصيغ والميزات المشمولة في الباقة التي ستستخدمها.",
        ],
      ],
    },
    related: [
      {
        path: "/migration-guides/wafeq",
        title: ["Wafeq migration guide", "دليل الانتقال من وافق"],
      },
      banking,
      planLink,
    ],
    sources: [wafeqSales, wafeqBank],
  },
  "/compare/mazeed": {
    comparison: [
      {
        title: appTitle,
        body: [
          "Record invoices and expenses, review reports from the books and grant your accountant company access. You can also ask Najma Al Raeda about bookkeeping and tax preparation services.",
          "سجّل الفواتير والمصروفات وراجع التقارير المستخرجة من الدفاتر وامنح محاسبك صلاحية الوصول إلى شركتك. يمكنك أيضًا الاستفسار من نجمة الرائدة عن خدمات مسك الدفاتر وإعداد الإقرارات الضريبية.",
        ],
      },
      {
        title: ["Mazeed", "مزيد"],
        body: [
          "Mazeed offers accounting software with invoicing and financial reporting. It also offers managed accounting and bookkeeping services through Mazeed OPS.",
          "يوفّر مزيد برنامج محاسبة يشمل الفوترة والتقارير المالية. كما يقدّم خدمات المحاسبة ومسك الدفاتر من خلال Mazeed OPS.",
        ],
      },
    ],
    checklist: {
      title: ["What to test", "ما يستحق الاختبار"],
      items: [
        [
          "Decide who will post transactions, follow up on missing receipts and sign off on month-end reports.",
          "حدّد من سيرحّل المعاملات ويتابع الإيصالات الناقصة ويعتمد تقارير نهاية الشهر.",
        ],
        [
          "Ask each firm for the scope and fee for any managed services, including which reports and tax work are covered.",
          "اطلب من كل مكتب تحديد نطاق الخدمات المحاسبية وأتعابها، بما في ذلك التقارير والأعمال الضريبية المشمولة.",
        ],
        [
          "Run and export the reports you need to share with your team or retain for later review.",
          "استخرج وصدّر التقارير التي تحتاج إلى مشاركتها مع فريقك أو الاحتفاظ بها للمراجعة لاحقًا.",
        ],
      ],
    },
    related: [
      {
        path: "/migration-guides/mazeed",
        title: ["Mazeed migration guide", "دليل الانتقال من مزيد"],
      },
      { path: "/services", title: ["Accounting services", "خدمات المحاسبة"] },
      planLink,
    ],
    sources: [
      mazeedReports,
      {
        title: [
          "Accounting and bookkeeping services from Mazeed OPS",
          "خدمات مزيد أوبس للمحاسبة ومسك الدفاتر",
        ],
        url: [
          "https://mazeed.com/accounting-and-bookkeeping-services/",
          "https://mazeed.com/ar/accounting-and-bookkeeping-services/",
        ],
      },
    ],
  },
  "/compare/zoho": {
    comparison: [
      {
        title: appTitle,
        body: [
          `${featureBySlug("reporting").lead[0]} ${bankWorkflow[0]}`,
          `${featureBySlug("reporting").lead[1]} ${bankWorkflow[1]}`,
        ],
      },
      {
        title: ["Zoho Books", "زوهو بوكس"],
        body: [
          "Zoho Books UAE documents manual bank statement imports and bank feeds for supported connections. It also supports exporting data from individual modules.",
          "يوثّق زوهو بوكس في الإمارات استيراد كشوف الحسابات يدويًا والربط البنكي المباشر للاتصالات المدعومة. كما يتيح تصدير البيانات من وحدات البرنامج كلٍّ على حدة.",
        ],
      },
    ],
    checklist: {
      title: ["What to test", "ما يستحق الاختبار"],
      items: [
        [
          "If a live bank feed is essential, check whether Zoho Books supports your bank and account type under the plan you would use.",
          "إذا كان الربط البنكي المباشر ضروريًا، فتحقّق من دعم زوهو بوكس لبنكك ونوع حسابك ضمن الباقة التي ستستخدمها.",
        ],
        [
          "Create a sample invoice, review the VAT treatment and check how the workflow fits the rest of your tools.",
          "أنشئ فاتورة تجريبية وراجع معاملتها الضريبية وتحقّق من ملاءمة مسار العمل مع أدواتك الأخرى.",
        ],
        [
          "Run a period-end report and check the export before committing to a cutover.",
          "استخرج تقريرًا لنهاية الفترة وتحقّق من ملف التصدير قبل اتخاذ قرار الانتقال.",
        ],
      ],
    },
    related: [
      {
        path: "/migration-guides/zoho",
        title: ["Zoho Books migration guide", "دليل الانتقال من زوهو بوكس"],
      },
      banking,
      planLink,
    ],
    sources: [
      {
        title: ["Banking in Zoho Books UAE", "الخدمات البنكية في زوهو بوكس الإمارات (بالإنجليزية)"],
        url: "https://www.zoho.com/ae/books/help/banking/",
      },
      zohoExport,
    ],
  },
  "/migration-guides/excel": {
    sections: [
      {
        title: ["Save the workbook and prepare CSVs", "احفظ المصنف وجهّز ملفات CSV"],
        body: [
          "Archive the original workbook and agree on its final date. Download the relevant templates from Import data and save each prepared sheet as CSV. Copy values out of formulas, remove subtotal rows and keep identifiers such as invoice numbers and account codes intact. Select Template / other in the import wizard.",
          "احتفظ بنسخة من المصنف الأصلي واتفق على آخر تاريخ للتسجيل فيه. نزّل القوالب المناسبة من شاشة «استيراد البيانات» واحفظ كل ورقة بعد تجهيزها بصيغة CSV. انسخ نتائج المعادلات كقيم، واحذف صفوف الإجماليات الفرعية، وحافظ على المعرّفات مثل أرقام الفواتير ورموز الحسابات. اختر «نموذج / أخرى» في معالج الاستيراد.",
        ],
      },
      cutover,
      verify,
    ],
    related: [banking, reporting],
  },
  "/migration-guides/wafeq": {
    sections: [
      {
        title: ["Export from Wafeq", "صدّر سجلاتك من وافق"],
        body: [
          "Save the trial balance as of cutover and export the chart of accounts, contacts and open sales invoices and bills. Save the original exports and supporting reports. Choose Wafeq in Import data and check the proposed column mapping for every file.",
          "احفظ ميزان المراجعة كما في تاريخ الانتقال وصدّر دليل الحسابات وجهات الاتصال وفواتير المبيعات والمشتريات المفتوحة. احتفظ بالملفات الأصلية والتقارير المؤيدة. اختر «وافق» في شاشة «استيراد البيانات» وراجع تعيين الأعمدة المقترح لكل ملف.",
        ],
      },
      cutover,
      verify,
    ],
    related: [
      { path: "/compare/wafeq", title: ["Compare with Wafeq", "المقارنة مع وافق"] },
      banking,
    ],
    sources: [
      {
        title: ["Trial balance and export in Wafeq", "ميزان المراجعة وتصديره في وافق"],
        url: [
          "https://help.wafeq.com/hc/en-sa/articles/21381428049564-Your-Guide-to-the-Trial-Balance-Balances-Movements-and-Retained-Earnings",
          "https://help.wafeq.com/hc/ar-ae/articles/21381428049564",
        ],
      },
      wafeqSales,
    ],
  },
  "/migration-guides/mazeed": {
    sections: [
      {
        title: ["Save reports and map the data", "احفظ التقارير وطابق حقول البيانات"],
        body: [
          "Export your cutover reports and gather your master records, open invoices and bills. If Mazeed manages your books, ask which files your accountant can supply and agree who closes the prior period. Copy supported records into the CSV templates and choose Template / other in Import data.",
          "صدّر تقارير تاريخ الانتقال واجمع سجلاتك الأساسية وفواتير المبيعات والمشتريات المفتوحة. إذا كان مزيد يدير دفاترك، فاسأل محاسبك عن الملفات التي يمكنه توفيرها واتفق معه على من سيقفل الفترة السابقة. انقل السجلات المدعومة إلى قوالب CSV واختر «نموذج / أخرى» في شاشة «استيراد البيانات».",
        ],
      },
      cutover,
      verify,
    ],
    related: [
      { path: "/compare/mazeed", title: ["Compare with Mazeed", "المقارنة مع مزيد"] },
      banking,
    ],
    sources: [mazeedReports],
  },
  "/migration-guides/zoho": {
    sections: [
      {
        title: ["Export the right Zoho organisation", "صدّر بيانات شركتك المعنية من زوهو"],
        body: [
          "Verify the organisation and cutover date before exporting the chart of accounts, trial balance, contacts, items and open documents. Keep a separate archive of the source records and filed returns. Choose Zoho Books in Import data and check account codes, document currencies and tax treatment in the mapped rows.",
          "تحقّق من الشركة وتاريخ الانتقال قبل تصدير دليل الحسابات وميزان المراجعة وجهات الاتصال والأصناف والمستندات المفتوحة. احتفظ بأرشيف منفصل للسجلات الأصلية والإقرارات المقدّمة. اختر «زوهو بوكس» في شاشة «استيراد البيانات» وتحقّق من رموز الحسابات وعملات المستندات ومعاملتها الضريبية في الصفوف التي جرى تعيينها.",
        ],
      },
      cutover,
      verify,
    ],
    related: [
      { path: "/compare/zoho", title: ["Compare with Zoho Books", "المقارنة مع زوهو بوكس"] },
      banking,
    ],
    sources: [zohoExport],
  },
  "/trust": {
    sections: [
      {
        title: ["Company access and sign-in", "الوصول إلى الشركة وتسجيل الدخول"],
        body: [
          "Workspace access is scoped to company membership and role. You can enable two-factor sign-in with an authenticator app, save recovery codes and review or sign out individual sessions.",
          "تُحدَّد صلاحيات الوصول إلى مساحة العمل وفق عضوية الشركة والدور الممنوح. يمكنك تفعيل المصادقة الثنائية عبر تطبيق مصادقة وحفظ رموز الاسترداد ومراجعة جلسات تسجيل الدخول أو إنهاء كل جلسة على حدة.",
        ],
      },
      {
        title: ["Audit history", "سجل التدقيق"],
        body: [
          "The audit log records actions including ledger postings and chart of accounts changes. Authorised users can review and export the log, and use its linked hashes to check the integrity of the recorded history.",
          "يسجّل سجل التدقيق إجراءات منها ترحيل القيود والتعديلات على دليل الحسابات. يمكن للمستخدمين المخوّلين مراجعة السجل وتصديره والتحقّق من سلامته باستخدام قيم التجزئة المترابطة.",
        ],
      },
      {
        title: ["In-app backups and restore", "النسخ الاحتياطي والاستعادة داخل التطبيق"],
        body: [
          "In-app backup snapshots are encrypted and checked for integrity. Before restoring, review the preview. The app creates a safety snapshot before applying the restore.",
          "يشفّر التطبيق النسخ الاحتياطية ويتحقّق من سلامتها. راجع المعاينة قبل الاستعادة. ينشئ التطبيق نسخة احتياطية إضافية قبل تنفيذ الاستعادة.",
        ],
      },
      {
        title: ["Operator and privacy", "الجهة المشغّلة والخصوصية"],
        body: [
          `${marketingBrand} is operated by Najma Al Raeda Accounting and Bookkeeping in Dubai. The privacy policy covers how personal information is used and how to make a privacy request.`,
          `تتولى نجمة الرائدة للمحاسبة ومسك الدفاتر في دبي تشغيل ${marketingBrand}. توضّح سياسة الخصوصية كيفية استخدام المعلومات الشخصية وتقديم طلب يتعلق بخصوصيتك.`,
        ],
      },
    ],
    related: [
      { path: "/services", title: ["Meet the accounting team", "تعرّف على خدمات فريق المحاسبة"] },
    ],
    sources: [{ title: ["Read the privacy policy", "اقرأ سياسة الخصوصية"], url: "/privacy" }],
    email: {
      title: ["Report a security issue", "أبلغ عن مشكلة أمنية"],
      address: "security@muhasib.ai",
    },
  },
};
