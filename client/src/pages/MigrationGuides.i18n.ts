import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "MigrationGuides",
  {
    moveFromMazeed: "Move from mazeed",
    exportCustomersSuppliersChartOfAccounts:
      "Export customers, suppliers, chart of accounts, invoices, bills, expenses, tax summaries, and report packs from mazeed.",
    chooseAGoLiveDateAnd:
      "Choose a go-live date and keep pre-migration mazeed exports read-only for audit reference.",
    importContactsAndStartFutureInvoices:
      "Import contacts and start future invoices, receipts, and bank statements in Muhasib.ai.",
    recreateActiveRecurringInvoicesPaymentReminders:
      "Recreate active recurring invoices, payment reminders, and approval routines after opening balances are agreed.",
    compareOpeningPLBalanceSheet:
      "Compare opening P&L, balance sheet, AR, AP, VAT, and corporate tax support schedules before using live books.",
    moveFromWafeq: "Move from Wafeq",
    exportCustomersSuppliersInvoicesBillsChart:
      "Export customers, suppliers, invoices, bills, chart of accounts, and VAT reports from Wafeq.",
    importContactsThroughTheCustomerContacts:
      "Import contacts through the customer contacts template.",
    setOpeningBalancesInTheChart:
      "Set opening balances in the chart of accounts before posting new transactions.",
    importCurrentPeriodBankStatementsAnd:
      "Import current-period bank statements and reconcile from the migration date forward.",
    keepHistoricalWafeqExportsInDocument:
      "Keep historical Wafeq exports in Document Vault for audit reference.",
    moveFromZohoBooks: "Move from Zoho Books",
    exportCustomersVendorsItemsInvoicesBills:
      "Export customers, vendors, items, invoices, bills, credit notes, and account balances from Zoho.",
    mapZohoTaxCodesToUae:
      "Map Zoho tax codes to UAE VAT treatment before importing live transactions.",
    useMuhasibAiForFuturePeriod:
      "Use Muhasib.ai for future-period VAT workflows; keep prior Zoho filings as archived support.",
    recreateRecurringInvoicesAndPaymentReminders:
      "Recreate recurring invoices and payment reminders after the opening balance date.",
    validatePLBalanceSheetAr:
      "Validate P&L, balance sheet, AR, AP, and VAT control balances before go-live.",
    moveFromExcel: "Move from Excel",
    cleanCustomerSupplierInvoiceReceiptAnd:
      "Clean customer, supplier, invoice, receipt, and bank-statement sheets into one row per record.",
    useXlsxOrCsvFilesLegacy:
      "Use .xlsx or CSV files; legacy .xls files should be saved as .xlsx first.",
    createTheCompanyAndReviewThe:
      "Create the company and review the default UAE chart of accounts.",
    importContactsAndStartNewInvoices:
      "Import contacts and start new invoices/receipts from the go-live date.",
    attachPriorSpreadsheetsInDocumentVault:
      "Attach prior spreadsheets in Document Vault for continuity.",
    pickAGoLiveDateAnd: "Pick a go-live date and stop editing old books after that date.",
    exportAllSourceSystemReportsBefore:
      "Export all source-system reports before cancelling competitor accounts.",
    reconcileOpeningBankArApVat:
      "Reconcile opening bank, AR, AP, VAT, and retained earnings balances.",
    runOneTestInvoiceReceiptVat:
      "Run one test invoice, receipt, VAT summary, and bank import before live use.",
    keepSourceSystemBackupsForThe: "Keep source-system backups for the statutory retention period.",
    pricing: "Pricing",
    trust: "Trust",
    help: "Help",
    startFree: "Start Free",
    migrationGuides: "Migration Guides",
    switchFromMazeedWafeqZohoBooks:
      "Switch from mazeed, Wafeq, Zoho Books, or Excel without losing audit trail.",
    startCleanFromAGoLive:
      "Start clean from a go-live date, preserve old records, and validate balances before posting live transactions in Muhasib.ai.",
    goLiveChecklist: "Go-live checklist",
    thisChecklistIsTheMinimumWe:
      "This checklist is the minimum we recommend before moving real books from another platform.",
    supportedImportFiles: "Supported import files",
    customerContactImportsSupportXlsxAnd:
      "Customer/contact imports support .xlsx and CSV. Bank reconciliation supports CSV formats from Emirates NBD, ADCB, FAB, Mashreq, and generic statement layouts. Prior-system report packs from mazeed, Wafeq, Zoho Books, or Excel should be stored in Document Vault as read-only support files.",
    bankReconciliationAfterMigration: "Bank reconciliation after migration",
    importBankStatementsFromTheGo:
      "Import bank statements from the go-live date forward, review suggested matches, and create journal entries only for transactions that are not already represented in the opening balances.",
    startMigration: "Start Migration",
  },
  {
    moveFromMazeed: "الانتقال من mazeed",
    exportCustomersSuppliersChartOfAccounts:
      "صدّر العملاء والموردين ودليل الحسابات والفواتير وفواتير المشتريات والمصروفات والملخصات الضريبية وحزم التقارير من mazeed.",
    chooseAGoLiveDateAnd:
      "اختر تاريخ بدء التشغيل الفعلي وأبقِ ملفات mazeed المصدَّرة قبل الانتقال للقراءة فقط للرجوع إليها في التدقيق.",
    importContactsAndStartFutureInvoices:
      "استورد جهات الاتصال وابدأ الفواتير والإيصالات وكشوف الحسابات البنكية المستقبلية في Muhasib.ai.",
    recreateActiveRecurringInvoicesPaymentReminders:
      "أعد إنشاء الفواتير المتكررة النشطة وتذكيرات الدفع وروتين الاعتمادات بعد الاتفاق على الأرصدة الافتتاحية.",
    compareOpeningPLBalanceSheet:
      "قارن جداول الدعم الافتتاحية للأرباح والخسائر والميزانية العمومية والذمم المدينة والذمم الدائنة وضريبة القيمة المضافة وضريبة الشركات قبل استخدام الدفاتر الفعلية.",
    moveFromWafeq: "الانتقال من Wafeq",
    exportCustomersSuppliersInvoicesBillsChart:
      "صدّر العملاء والموردين والفواتير وفواتير المشتريات ودليل الحسابات وتقارير ضريبة القيمة المضافة من Wafeq.",
    importContactsThroughTheCustomerContacts: "استورد جهات الاتصال عبر قالب جهات اتصال العملاء.",
    setOpeningBalancesInTheChart:
      "اضبط الأرصدة الافتتاحية في دليل الحسابات قبل ترحيل أي معاملات جديدة.",
    importCurrentPeriodBankStatementsAnd:
      "استورد كشوف الحسابات البنكية للفترة الحالية وأجرِ التسوية من تاريخ الانتقال فصاعدًا.",
    keepHistoricalWafeqExportsInDocument:
      "احتفظ بملفات Wafeq التاريخية المصدَّرة في خزنة المستندات للرجوع إليها في التدقيق.",
    moveFromZohoBooks: "الانتقال من Zoho Books",
    exportCustomersVendorsItemsInvoicesBills:
      "صدّر العملاء والموردين والأصناف والفواتير وفواتير المشتريات والإشعارات الدائنة وأرصدة الحسابات من Zoho.",
    mapZohoTaxCodesToUae:
      "طابق رموز الضريبة في Zoho مع المعالجة الضريبية لضريبة القيمة المضافة في الإمارات قبل استيراد المعاملات الفعلية.",
    useMuhasibAiForFuturePeriod:
      "استخدم Muhasib.ai لمسارات ضريبة القيمة المضافة في الفترات المستقبلية؛ واحتفظ بإقرارات Zoho السابقة كمستندات داعمة مؤرشفة.",
    recreateRecurringInvoicesAndPaymentReminders:
      "أعد إنشاء الفواتير المتكررة وتذكيرات الدفع بعد تاريخ الرصيد الافتتاحي.",
    validatePLBalanceSheetAr:
      "تحقق من الأرباح والخسائر والميزانية العمومية وأرصدة الحسابات الرقابية للذمم المدينة والذمم الدائنة وضريبة القيمة المضافة قبل التشغيل الفعلي.",
    moveFromExcel: "الانتقال من Excel",
    cleanCustomerSupplierInvoiceReceiptAnd:
      "نظّف أوراق العملاء والموردين والفواتير والإيصالات وكشوف الحسابات البنكية بحيث يكون لكل سجل صف واحد.",
    useXlsxOrCsvFilesLegacy:
      "استخدم ملفات ‎.xlsx أو CSV؛ يجب حفظ ملفات ‎.xls القديمة بصيغة ‎.xlsx أولًا.",
    createTheCompanyAndReviewThe: "أنشئ الشركة وراجع دليل الحسابات الافتراضي للإمارات.",
    importContactsAndStartNewInvoices:
      "استورد جهات الاتصال وابدأ الفواتير والإيصالات الجديدة من تاريخ بدء التشغيل الفعلي.",
    attachPriorSpreadsheetsInDocumentVault:
      "أرفق جداول البيانات السابقة في خزنة المستندات لضمان الاستمرارية.",
    pickAGoLiveDateAnd: "اختر تاريخ بدء التشغيل الفعلي وتوقف عن تعديل الدفاتر القديمة بعده.",
    exportAllSourceSystemReportsBefore:
      "صدّر جميع تقارير النظام المصدر قبل إلغاء حسابات المنافسين.",
    reconcileOpeningBankArApVat:
      "سوِّ أرصدة البنك والذمم المدينة والذمم الدائنة وضريبة القيمة المضافة والأرباح المحتجزة الافتتاحية.",
    runOneTestInvoiceReceiptVat:
      "جرّب فاتورة وإيصالًا وملخص ضريبة قيمة مضافة واستيرادًا بنكيًا تجريبيًا قبل الاستخدام الفعلي.",
    keepSourceSystemBackupsForThe:
      "احتفظ بنسخ النظام المصدر الاحتياطية طوال فترة الاحتفاظ النظامية.",
    pricing: "الأسعار",
    trust: "الثقة",
    help: "المساعدة",
    startFree: "ابدأ مجانًا",
    migrationGuides: "أدلة الانتقال",
    switchFromMazeedWafeqZohoBooks:
      "انتقل من mazeed أو Wafeq أو Zoho Books أو Excel دون فقدان مسار التدقيق.",
    startCleanFromAGoLive:
      "ابدأ من صفحة نظيفة اعتبارًا من تاريخ بدء التشغيل الفعلي، واحتفظ بالسجلات القديمة، وتحقق من الأرصدة قبل ترحيل المعاملات الفعلية في Muhasib.ai.",
    goLiveChecklist: "قائمة فحص بدء التشغيل الفعلي",
    thisChecklistIsTheMinimumWe:
      "هذه القائمة هي الحد الأدنى الذي نوصي به قبل نقل الدفاتر الفعلية من منصة أخرى.",
    supportedImportFiles: "ملفات الاستيراد المدعومة",
    customerContactImportsSupportXlsxAnd:
      "يدعم استيراد العملاء وجهات الاتصال صيغتي ‎.xlsx وCSV. وتدعم التسوية البنكية صيغ CSV من بنك الإمارات دبي الوطني وبنك أبوظبي التجاري وبنك أبوظبي الأول وبنك المشرق وتخطيطات الكشوف العامة. ينبغي حفظ حزم التقارير من الأنظمة السابقة (mazeed أو Wafeq أو Zoho Books أو Excel) في خزنة المستندات كملفات دعم للقراءة فقط.",
    bankReconciliationAfterMigration: "التسوية البنكية بعد الانتقال",
    importBankStatementsFromTheGo:
      "استورد كشوف الحسابات البنكية من تاريخ بدء التشغيل الفعلي فصاعدًا، وراجع المطابقات المقترحة، وأنشئ قيود يومية فقط للمعاملات غير الممثلة أصلًا في الأرصدة الافتتاحية.",
    startMigration: "ابدأ الانتقال",
  }
);
