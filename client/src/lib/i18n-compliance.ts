/**
 * English + Arabic strings for the Phase 4 compliance screens (tax filing
 * evidence, FTA Audit File download, opening balances, year-end close).
 * Kept apart from i18n.ts so the compliance work does not collide with other
 * translation work. Read with `useComplianceText()`; it follows the same
 * `locale` the rest of the app uses (`useTranslation()` from i18n.ts).
 *
 * Arabic wording follows the terminology already used on the VAT pages
 * (إقرار, ضريبة المخرجات, ضريبة المدخلات, الهيئة الاتحادية للضرائب).
 */

import { useTranslation } from "@/lib/i18n";

const en = {
  // shared
  cancel: "Cancel",
  close: "Close",
  working: "Working…",
  download: "Download",
  remove: "Remove",
  amount: "Amount",
  date: "Date",
  notes: "Notes (optional)",
  reference: "Reference",

  // filing record
  filingTitle: "Filing record",
  notFiledYet: "This return has not been recorded as filed.",
  notTransmitted:
    "Muhasib does not file with the FTA. File the return on EmaraTax, then record the filing here.",
  recordFiling: "Record filing",
  recordFilingDescription:
    "Enter the details from the FTA acknowledgement. This is your record of a filing you made on EmaraTax.",
  ftaReference: "FTA reference number",
  filedOn: "Filed on",
  acknowledgement: "FTA acknowledgement (PDF, PNG or JPEG)",
  filingLocksPeriod:
    "Recording the filing freezes these figures and locks the accounting months: {months}.",
  filingRecorded: "Filing recorded",
  filingRecordedBody: "The figures are frozen and the period is locked.",
  filingFailed: "Could not record the filing",
  staleTitle: "Your books changed since this draft was generated",
  staleBody:
    "This draft has figures you entered by hand, and your books now produce different figures. Nothing was filed. Choose which figures to record.",
  staleStoredColumn: "Stored draft",
  staleBooksColumn: "Recomputed from books",
  chooseStored: "File my stored (edited) figures",
  chooseStoredHint:
    "Allowed when the difference from your ledger is explained by the adjustments you recorded. The VAT accounts are cleared and the difference is posted to the irrecoverable VAT expense line with your reason.",
  chooseRecomputed: "File the figures recomputed from my books",
  chooseRecomputedHint: "Your hand-edited figures are replaced by the books' figures.",
  chooseFigures: "Choose which figures to file.",
  fileWithChoice: "Record filing with the chosen figures",
  recomputedTitle: "Filed with figures recomputed from your books",
  recomputedBody:
    "The draft was out of date. At the moment of filing the return was recomputed from your books, and these are the boxes that changed.",
  ledgerMismatchTitle: "The VAT accounts and the return disagree",
  referenceRequired: "Enter the FTA reference number.",
  dateRequired: "Enter the date the return was filed.",
  dateInFuture: "The filing date cannot be in the future.",
  dateBeforePeriodEnd: "The filing date cannot be before the end of the period.",
  filedBadge: "Filed",
  filedWithReference: "Filed with FTA reference {ref} on {date}",
  snapshotFingerprint: "Figures fingerprint (SHA-256)",
  filedBy: "Filed figures are frozen; later changes to your books do not change this return.",
  periodLocked: "Period locked",
  periodPartlyLocked: "Period partly locked",
  periodUnlocked: "Period unlocked",
  lockedMonths: "Locked: {months}",

  // drift
  driftTitle: "Your books changed after this return was filed",
  driftBody:
    "The figures shown are what you filed. Your books now produce different figures. Record an amendment (voluntary disclosure) to correct the difference with the FTA.",
  box: "Box",
  filedFigure: "Filed",
  booksNow: "Books now",
  difference: "Difference",
  driftUnavailable: "The live check against your books could not run: {message}",

  // evidence
  evidenceTitle: "Evidence",
  addEvidence: "Add file",
  noEvidence: "No acknowledgement attached yet.",
  evidenceAdded: "File added",
  evidenceAddFailed: "Could not add the file",
  removeEvidenceTitle: "Remove evidence file",
  removeEvidenceBody:
    "The file is kept for the 5-year FTA retention period and only hidden from this list. The removal is written to the audit log.",
  removalReason: "Reason for removal",
  reasonTooShort: "Give a reason of at least 5 characters.",
  evidenceRemoved: "File removed (retained in storage)",
  downloadFailed: "Download failed",

  // payments
  paymentsTitle: "Settlement with the FTA",
  recordPayment: "Record payment",
  recordRefund: "Record refund received",
  recordPaymentDescription:
    "Posts Dr VAT control / Cr bank. You can pay in instalments until the balance is settled.",
  recordRefundDescription: "Posts Dr bank / Cr control for a refund received from the FTA.",
  paymentDate: "Payment date",
  paidFrom: "Bank or cash account",
  received: "Received into",
  balanceDue: "Balance due",
  refundDue: "Refund due",
  settled: "Settled",
  nothingToSettle: "Nothing to settle",
  alreadyPaid: "Paid so far",
  noPayments: "No payments recorded yet.",
  paymentRecorded: "Payment recorded",
  paymentFailed: "Could not record the payment",
  amountInvalid: "Enter an amount greater than zero.",
  amountTooHigh: "The amount is more than the balance ({remaining}).",
  chooseAccount: "Choose an account",
  statusUnpaid: "Unpaid",
  statusPartial: "Partly paid",
  statusPaid: "Paid",
  statusNone: "Nothing to settle",

  // amendment
  amend: "Amend",
  amendReturn: "Amend (voluntary disclosure)",
  amendConfirmTitle: "Record an amendment?",
  amendConfirmBody:
    "This creates a new return for the same period from your current books. The filed return stays unchanged and only the difference is filed and paid.",
  amendCreated: "Amendment created",
  amendCreatedBody: "Review the differences, then record its filing.",
  amendFailed: "Could not create the amendment",
  amendmentBadge: "Amendment",
  amendsReference: "Amends the filing with reference {ref}",
  amendedBy: "Amended by",
  amendmentDifferences: "Difference against the filed return",
  noAmendmentDifferences: "No differences yet.",
  openAmendment: "Open amendment",

  // archive card
  filedReturnsTitle: "Returns filed with evidence",
  filedReturnsDescription:
    "Returns you recorded as filed in Muhasib, with the figures frozen at filing and the FTA acknowledgement attached.",
  noFiledReturns: "No return has been recorded as filed yet.",
  typeVat: "VAT",
  typeCorporateTax: "Corporate tax",
  colType: "Type",
  colPeriod: "Period",
  colReference: "FTA reference",
  colFiledOn: "Filed on",
  colEvidence: "Evidence",
  colSettlement: "Settlement",
  open: "Open",

  // FTA Audit File
  fafTab: "FTA Audit File",
  fafTitle: "FTA Audit File (FAF)",
  fafDescription:
    "The audit file the FTA can ask any VAT-registered business to produce: company details, purchase listing, supply listing and general ledger for a period, from your posted records.",
  fafFrom: "From",
  fafTo: "To",
  fafDownload: "Download FAF (CSV)",
  fafDownloading: "Preparing file…",
  fafNote:
    "Covers at most one financial year per file. Before sending it to the FTA, check it with the FTA's own FAF validation tool: the column layout follows the structure published by the FTA and must be confirmed against the current specification.",
  fafRangeInvalid: "Choose a valid period (from on or before to, at most one year).",
  fafFailed: "Could not produce the file",
  // year-end close
  yeTitle: "Year-end close",
  yeDescription:
    "Closes every income and expense account to retained earnings with one entry dated the last day of the financial year, and locks its twelve months. Reversible with a reason while no later year has filed returns.",
  yeYear: "Financial year",
  yeNetResult: "Net result",
  yeStatus: "Status",
  yeOpen: "Open",
  yeClosed: "Closed",
  yeCloseYear: "Close year",
  yeReopen: "Reopen",
  yeConfirmTitle: "Close the financial year {year}?",
  yeConfirmBody:
    "One closing entry dated {date} moves the result of {amount} to retained earnings and the twelve months are locked. Nothing more can be posted in this year until it is reopened.",
  yeClosedOn: "Closed {date}",
  yeReopenTitle: "Reopen the financial year {year}?",
  yeReopenBody:
    "The closing entry is reversed and the months are unlocked (months covered by a filed VAT return stay locked). Only a firm owner can do this, and it is written to the audit log.",
  yeReason: "Reason (at least 10 characters)",
  yeReasonShort: "Give a reason of at least 10 characters.",
  yeCloseDone: "Financial year closed",
  yeReopenDone: "Financial year reopened",
  yeNone: "No financial years to show yet.",
  yeFailed: "The year-end action failed",
  yeNoticeOpening: "Starting with balances from another system?",
  yeOpeningLink: "Enter opening balances",

  // opening balances
  obTitle: "Opening balances",
  obIntro:
    "Bring your balances in when you start using Muhasib: enter each account's balance as of the day before your first transaction. One entry is posted and any difference goes to Opening Balance Equity.",
  obDate: "Opening balance date",
  obSuggested: "Suggested: {date} (the day before your first transaction)",
  obGridTitle: "Account balances",
  obAccount: "Account",
  obDebit: "Debit",
  obCredit: "Credit",
  obTotals: "Totals",
  obBalancing: "Balancing amount to Opening Balance Equity: {amount} ({side})",
  obSideCredit: "credit",
  obSideDebit: "debit",
  obImportCsv: "Import CSV",
  obCsvHelp: "Columns: account code, debit, credit. Checked before anything is posted.",
  obInvoicesTitle: "Open customer invoices (optional)",
  obBillsTitle: "Open vendor bills (optional)",
  obDocsHelp:
    "So receivables and payables aging work from day one. Their totals must equal the Accounts Receivable / Accounts Payable balances above. They post no revenue, expense or VAT.",
  obCustomer: "Customer",
  obVendor: "Vendor",
  obNumber: "Number",
  obDocDate: "Date",
  obDocDue: "Due date",
  obDocAmount: "Amount",
  obDocCurrency: "Currency",
  obDocRate: "Rate to AED",
  obAddRow: "Add row",
  obRemoveRow: "Remove",
  obCheck: "Check",
  obPost: "Post opening balances",
  obChecking: "Checking…",
  obPosting: "Posting…",
  obCheckOk: "Everything checks out. You can post the opening balances.",
  obWarnTitle: "Worth knowing before you post",
  obGapWarning:
    "{imported} is in your invoice numbering format, so the next invoice you issue will be {next}. The numbers between {first} and {last} that you did not import ({gap} in all) will never be issued. UAE tax invoices must be numbered in sequence: keep a note of why (for example, those numbers were used in your previous system). Posting is still allowed.",
  obFixFirst: "Fix these before posting",
  obPosted: "Opening balances posted",
  obPostFailed: "Could not post the opening balances",
  obActiveTitle: "Opening balances are in place",
  obActiveBody: "Opening balances as of {date} were posted. {invoices} open invoices and {bills} open bills came with them.",
  obReverse: "Reverse opening balances",
  obReverseTitle: "Reverse the opening balances?",
  obReverseBody:
    "A reversing entry is posted and the opening invoices and bills are removed so you can enter them again. This is refused once the period is locked, a VAT return is filed for it, or payments are recorded against the opening documents.",
  obReversed: "Opening balances reversed",
  obReverseFailed: "Could not reverse the opening balances",
  obReason: "Reason",
  obNoAccounts: "Loading your chart of accounts…",
  obTieAr: "Receivables opening balance",
  obTieAp: "Payables opening balance",
  obOpenInvoicesTotal: "Open invoices total",
  obOpenBillsTotal: "Open bills total",

  // onboarding step
  obStepTitle: "Opening balances",
  obStepBody:
    "Already have books? Bring your balances in now so your reports and aging start correct on day one. It takes a few minutes and you can also do it later from the Month-End Close area.",
  obStepEnter: "Enter opening balances",
  obStepSkip: "Skip for now",
  obStepBack: "Back",
} as const;

export type ComplianceKey = keyof typeof en;

const ar: Record<ComplianceKey, string> = {
  cancel: "إلغاء",
  close: "إغلاق",
  working: "جارٍ التنفيذ…",
  download: "تنزيل",
  remove: "إزالة",
  amount: "المبلغ",
  date: "التاريخ",
  notes: "ملاحظات (اختياري)",
  reference: "المرجع",

  filingTitle: "سجل التقديم",
  notFiledYet: "لم يتم تسجيل هذا الإقرار كمُقدَّم.",
  notTransmitted:
    "منصة محاسب لا تقدّم الإقرارات إلى الهيئة الاتحادية للضرائب. قدّم الإقرار عبر إمارات تاكس ثم سجّل التقديم هنا.",
  recordFiling: "تسجيل التقديم",
  recordFilingDescription:
    "أدخل البيانات من إشعار استلام الهيئة. هذا سجلك للإقرار الذي قدّمته عبر إمارات تاكس.",
  ftaReference: "الرقم المرجعي للهيئة",
  filedOn: "تاريخ التقديم",
  acknowledgement: "إشعار استلام الهيئة (PDF أو PNG أو JPEG)",
  filingLocksPeriod: "تسجيل التقديم يجمّد هذه الأرقام ويقفل الأشهر المحاسبية: {months}.",
  filingRecorded: "تم تسجيل التقديم",
  filingRecordedBody: "تم تجميد الأرقام وقفل الفترة.",
  filingFailed: "تعذّر تسجيل التقديم",
  staleTitle: "تغيّرت دفاترك منذ إنشاء هذه المسودة",
  staleBody:
    "تحتوي هذه المسودة على أرقام أدخلتها يدويًا، ودفاترك تُنتج الآن أرقامًا مختلفة. لم يتم تقديم شيء. اختر الأرقام التي تريد تسجيلها.",
  staleStoredColumn: "المسودة المحفوظة",
  staleBooksColumn: "المُعاد احتسابها من الدفاتر",
  chooseStored: "تقديم أرقامي المحفوظة (المعدَّلة)",
  chooseStoredHint:
    "يُسمح بذلك عندما يكون الفرق عن دفترك مفسَّرًا بالتعديلات التي سجّلتها. تُصفَّر حسابات ضريبة القيمة المضافة ويُرحَّل الفرق إلى بند مصروف الضريبة غير القابلة للاسترداد مع سببك.",
  chooseRecomputed: "تقديم الأرقام المُعاد احتسابها من دفاتري",
  chooseRecomputedHint: "تُستبدل أرقامك المعدّلة يدويًا بأرقام الدفاتر.",
  chooseFigures: "اختر الأرقام التي تريد تقديمها.",
  fileWithChoice: "تسجيل التقديم بالأرقام المختارة",
  recomputedTitle: "تم التقديم بأرقام أُعيد احتسابها من دفاترك",
  recomputedBody:
    "كانت المسودة قديمة. لحظة التقديم أُعيد احتساب الإقرار من دفاترك، وهذه هي الخانات التي تغيّرت.",
  ledgerMismatchTitle: "حسابات ضريبة القيمة المضافة والإقرار غير متطابقة",
  referenceRequired: "أدخل الرقم المرجعي للهيئة.",
  dateRequired: "أدخل تاريخ تقديم الإقرار.",
  dateInFuture: "لا يمكن أن يكون تاريخ التقديم في المستقبل.",
  dateBeforePeriodEnd: "لا يمكن أن يسبق تاريخ التقديم نهاية الفترة.",
  filedBadge: "مُقدَّم",
  filedWithReference: "قُدِّم بالرقم المرجعي {ref} بتاريخ {date}",
  snapshotFingerprint: "بصمة الأرقام (SHA-256)",
  filedBy: "أرقام الإقرار المُقدَّم مجمّدة؛ أي تغيير لاحق في دفاترك لا يغيّر هذا الإقرار.",
  periodLocked: "الفترة مقفلة",
  periodPartlyLocked: "الفترة مقفلة جزئيًا",
  periodUnlocked: "الفترة غير مقفلة",
  lockedMonths: "مقفل: {months}",

  driftTitle: "تغيّرت دفاترك بعد تقديم هذا الإقرار",
  driftBody:
    "الأرقام المعروضة هي ما قدّمته. دفاترك تُنتج الآن أرقامًا مختلفة. سجّل تعديلًا (إفصاح طوعي) لتصحيح الفرق لدى الهيئة.",
  box: "الخانة",
  filedFigure: "المُقدَّم",
  booksNow: "الدفاتر الآن",
  difference: "الفرق",
  driftUnavailable: "تعذّر إجراء المقارنة الحية مع دفاترك: {message}",

  evidenceTitle: "المستندات الداعمة",
  addEvidence: "إضافة ملف",
  noEvidence: "لم يتم إرفاق إشعار استلام بعد.",
  evidenceAdded: "تمت إضافة الملف",
  evidenceAddFailed: "تعذّرت إضافة الملف",
  removeEvidenceTitle: "إزالة ملف مستند",
  removeEvidenceBody:
    "يُحتفظ بالملف طوال فترة الاحتفاظ لدى الهيئة (5 سنوات) ويُخفى فقط من هذه القائمة. تُسجَّل الإزالة في سجل التدقيق.",
  removalReason: "سبب الإزالة",
  reasonTooShort: "اكتب سببًا لا يقل عن 5 أحرف.",
  evidenceRemoved: "تمت إزالة الملف (محفوظ في التخزين)",
  downloadFailed: "فشل التنزيل",

  paymentsTitle: "التسوية مع الهيئة",
  recordPayment: "تسجيل دفعة",
  recordRefund: "تسجيل استرداد مستلم",
  recordPaymentDescription:
    "يُسجَّل قيد: مدين حساب مراقبة الضريبة / دائن البنك. يمكنك السداد على دفعات حتى تسوية الرصيد.",
  recordRefundDescription: "يُسجَّل قيد: مدين البنك / دائن حساب المراقبة لاسترداد مستلم من الهيئة.",
  paymentDate: "تاريخ الدفع",
  paidFrom: "الحساب البنكي أو النقدي",
  received: "المستلم في",
  balanceDue: "الرصيد المستحق",
  refundDue: "المبلغ المسترد المستحق",
  settled: "تمت التسوية",
  nothingToSettle: "لا شيء للتسوية",
  alreadyPaid: "المدفوع حتى الآن",
  noPayments: "لا توجد دفعات مسجّلة بعد.",
  paymentRecorded: "تم تسجيل الدفعة",
  paymentFailed: "تعذّر تسجيل الدفعة",
  amountInvalid: "أدخل مبلغًا أكبر من صفر.",
  amountTooHigh: "المبلغ أكبر من الرصيد ({remaining}).",
  chooseAccount: "اختر حسابًا",
  statusUnpaid: "غير مدفوع",
  statusPartial: "مدفوع جزئيًا",
  statusPaid: "مدفوع",
  statusNone: "لا شيء للتسوية",

  amend: "تعديل",
  amendReturn: "تعديل (إفصاح طوعي)",
  amendConfirmTitle: "تسجيل تعديل؟",
  amendConfirmBody:
    "سيُنشأ إقرار جديد للفترة نفسها من دفاترك الحالية. يبقى الإقرار المُقدَّم دون تغيير ويُقدَّم ويُسدَّد الفرق فقط.",
  amendCreated: "تم إنشاء التعديل",
  amendCreatedBody: "راجع الفروقات ثم سجّل تقديمه.",
  amendFailed: "تعذّر إنشاء التعديل",
  amendmentBadge: "تعديل",
  amendsReference: "يعدّل التقديم ذا الرقم المرجعي {ref}",
  amendedBy: "عُدِّل بواسطة",
  amendmentDifferences: "الفرق مقارنةً بالإقرار المُقدَّم",
  noAmendmentDifferences: "لا توجد فروقات بعد.",
  openAmendment: "فتح التعديل",

  filedReturnsTitle: "الإقرارات المُقدَّمة مع المستندات الداعمة",
  filedReturnsDescription:
    "الإقرارات التي سجّلتها كمُقدَّمة في محاسب، مع تجميد الأرقام وقت التقديم وإرفاق إشعار استلام الهيئة.",
  noFiledReturns: "لم يتم تسجيل أي إقرار كمُقدَّم بعد.",
  typeVat: "ضريبة القيمة المضافة",
  typeCorporateTax: "ضريبة الشركات",
  colType: "النوع",
  colPeriod: "الفترة",
  colReference: "الرقم المرجعي للهيئة",
  colFiledOn: "تاريخ التقديم",
  colEvidence: "المستندات",
  colSettlement: "التسوية",
  open: "فتح",

  fafTab: "ملف التدقيق الضريبي",
  fafTitle: "ملف التدقيق الضريبي (FAF)",
  fafDescription:
    "ملف التدقيق الذي يمكن للهيئة الاتحادية للضرائب أن تطلب من أي منشأة مسجّلة في ضريبة القيمة المضافة تقديمه: بيانات الشركة وقائمة المشتريات وقائمة المبيعات ودفتر الأستاذ العام عن فترة، من سجلاتك المرحّلة.",
  fafFrom: "من",
  fafTo: "إلى",
  fafDownload: "تنزيل ملف FAF (CSV)",
  fafDownloading: "جارٍ تجهيز الملف…",
  fafNote:
    "يغطي الملف الواحد سنة مالية كحد أقصى. قبل إرساله إلى الهيئة، تحقق منه بأداة التحقق الخاصة بالهيئة: ترتيب الأعمدة يتبع الهيكل المنشور من الهيئة ويجب تأكيده مقابل المواصفات الحالية.",
  fafRangeInvalid: "اختر فترة صحيحة (من قبل أو يساوي إلى، وبحد أقصى سنة).",
  fafFailed: "تعذّر إنشاء الملف",
  yeTitle: "إقفال نهاية السنة المالية",
  yeDescription:
    "يقفل كل حسابات الإيرادات والمصروفات إلى الأرباح المحتجزة بقيد واحد بتاريخ آخر يوم في السنة المالية، ويقفل أشهرها الاثني عشر. يمكن عكسه بذكر السبب ما دامت السنوات اللاحقة بلا إقرارات مُقدَّمة.",
  yeYear: "السنة المالية",
  yeNetResult: "صافي النتيجة",
  yeStatus: "الحالة",
  yeOpen: "مفتوحة",
  yeClosed: "مقفلة",
  yeCloseYear: "إقفال السنة",
  yeReopen: "إعادة فتح",
  yeConfirmTitle: "إقفال السنة المالية {year}؟",
  yeConfirmBody:
    "قيد إقفال واحد بتاريخ {date} ينقل النتيجة {amount} إلى الأرباح المحتجزة وتُقفل الأشهر الاثنا عشر. لن يمكن ترحيل أي قيد في هذه السنة حتى إعادة فتحها.",
  yeClosedOn: "أُقفلت في {date}",
  yeReopenTitle: "إعادة فتح السنة المالية {year}؟",
  yeReopenBody:
    "يُعكس قيد الإقفال وتُفتح الأشهر (تبقى مقفلة الأشهر التي يغطيها إقرار ضريبة قيمة مضافة مُقدَّم). لا يستطيع ذلك إلا مالك المكتب ويُسجَّل في سجل التدقيق.",
  yeReason: "السبب (10 أحرف على الأقل)",
  yeReasonShort: "اكتب سببًا لا يقل عن 10 أحرف.",
  yeCloseDone: "تم إقفال السنة المالية",
  yeReopenDone: "تمت إعادة فتح السنة المالية",
  yeNone: "لا توجد سنوات مالية لعرضها بعد.",
  yeFailed: "فشل إجراء نهاية السنة",
  yeNoticeOpening: "تبدأ بأرصدة من نظام آخر؟",
  yeOpeningLink: "أدخل الأرصدة الافتتاحية",

  obTitle: "الأرصدة الافتتاحية",
  obIntro:
    "أدخل أرصدتك عند بدء استخدام محاسب: رصيد كل حساب كما في اليوم السابق لأول معاملة. يُرحَّل قيد واحد وأي فرق يذهب إلى حساب حقوق الملكية للرصيد الافتتاحي.",
  obDate: "تاريخ الرصيد الافتتاحي",
  obSuggested: "المقترح: {date} (اليوم السابق لأول معاملة)",
  obGridTitle: "أرصدة الحسابات",
  obAccount: "الحساب",
  obDebit: "مدين",
  obCredit: "دائن",
  obTotals: "الإجمالي",
  obBalancing: "مبلغ الموازنة إلى حقوق الملكية للرصيد الافتتاحي: {amount} ({side})",
  obSideCredit: "دائن",
  obSideDebit: "مدين",
  obImportCsv: "استيراد CSV",
  obCsvHelp: "الأعمدة: رمز الحساب، مدين، دائن. يُفحص الملف قبل ترحيل أي شيء.",
  obInvoicesTitle: "فواتير العملاء المفتوحة (اختياري)",
  obBillsTitle: "فواتير الموردين المفتوحة (اختياري)",
  obDocsHelp:
    "لكي تعمل أعمار الذمم المدينة والدائنة من اليوم الأول. يجب أن يساوي إجماليها رصيدَي الذمم المدينة والدائنة أعلاه. لا تُرحِّل إيرادات أو مصروفات أو ضريبة.",
  obCustomer: "العميل",
  obVendor: "المورد",
  obNumber: "الرقم",
  obDocDate: "التاريخ",
  obDocDue: "تاريخ الاستحقاق",
  obDocAmount: "المبلغ",
  obDocCurrency: "العملة",
  obDocRate: "السعر مقابل الدرهم",
  obAddRow: "إضافة صف",
  obRemoveRow: "إزالة",
  obCheck: "فحص",
  obPost: "ترحيل الأرصدة الافتتاحية",
  obChecking: "جارٍ الفحص…",
  obPosting: "جارٍ الترحيل…",
  obCheckOk: "كل شيء سليم. يمكنك ترحيل الأرصدة الافتتاحية.",
  obWarnTitle: "أمور تستحق الانتباه قبل الترحيل",
  obGapWarning:
    "الرقم {imported} بنفس صيغة ترقيم فواتيرك، لذلك ستكون الفاتورة التالية التي تصدرها {next}. الأرقام الواقعة بين {first} و{last} التي لم تستوردها (وعددها {gap}) لن تُصدر أبداً. يجب ترقيم الفواتير الضريبية في دولة الإمارات بتسلسل متصل: احتفظ بملاحظة تشرح السبب (مثلاً أن هذه الأرقام استُخدمت في نظامك السابق). لا يزال الترحيل مسموحاً.",
  obFixFirst: "صحّح هذه الأمور قبل الترحيل",
  obPosted: "تم ترحيل الأرصدة الافتتاحية",
  obPostFailed: "تعذّر ترحيل الأرصدة الافتتاحية",
  obActiveTitle: "الأرصدة الافتتاحية قائمة",
  obActiveBody: "رُحِّلت الأرصدة الافتتاحية كما في {date}. رافقتها {invoices} فاتورة مفتوحة و{bills} فاتورة مورد مفتوحة.",
  obReverse: "عكس الأرصدة الافتتاحية",
  obReverseTitle: "عكس الأرصدة الافتتاحية؟",
  obReverseBody:
    "يُرحَّل قيد عكسي وتُزال الفواتير المفتوحة لتتمكن من إدخالها من جديد. يُرفض ذلك إذا أُقفلت الفترة أو قُدِّم إقرار ضريبي عنها أو سُجِّلت دفعات على المستندات الافتتاحية.",
  obReversed: "تم عكس الأرصدة الافتتاحية",
  obReverseFailed: "تعذّر عكس الأرصدة الافتتاحية",
  obReason: "السبب",
  obNoAccounts: "جارٍ تحميل دليل الحسابات…",
  obTieAr: "الرصيد الافتتاحي للذمم المدينة",
  obTieAp: "الرصيد الافتتاحي للذمم الدائنة",
  obOpenInvoicesTotal: "إجمالي الفواتير المفتوحة",
  obOpenBillsTotal: "إجمالي فواتير الموردين المفتوحة",

  obStepTitle: "الأرصدة الافتتاحية",
  obStepBody:
    "لديك دفاتر سابقة؟ أدخل أرصدتك الآن لتبدأ تقاريرك وأعمار الذمم صحيحة من اليوم الأول. تستغرق بضع دقائق ويمكنك القيام بها لاحقًا من قسم إقفال نهاية الشهر.",
  obStepEnter: "أدخل الأرصدة الافتتاحية",
  obStepSkip: "تخطَّ الآن",
  obStepBack: "رجوع",
};

export const complianceStrings = { en, ar } as const;

/** Replace `{name}` placeholders. */
export function fillTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function useComplianceText() {
  const { locale } = useTranslation();
  const dict: Record<ComplianceKey, string> = locale === "ar" ? ar : en;
  return {
    c: dict,
    locale,
    isAr: locale === "ar",
    f: (key: ComplianceKey, vars: Record<string, string | number>) => fillTemplate(dict[key], vars),
  };
}
