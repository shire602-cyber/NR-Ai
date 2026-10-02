/**
 * Server error messages in Arabic. The server answers in English with a machine-readable `code`; when the interface is Arabic
 * the message shown is ours for every code listed here (the sales codes come from the SalesShared table). An unknown code keeps
 * the server's own sentence, so nothing is hidden.
 */
import { messages as shared } from "@/components/sales/SalesShared.i18n";
import { salesErrorKey } from "@/lib/sales-api";

export const SERVER_ERRORS_AR: Record<string, string> = {
  VALIDATION_ERROR: "بعض المدخلات غير صالحة. راجع الحقول المظللة.",
  INSUFFICIENT_STOCK: "الكمية المتاحة في المخزون أقل من المطلوبة. سجّل تسوية مخزون إذا كان رقم المخزون الحالي غير صحيح.",
  PRODUCT_HAS_MOVEMENTS: "لا يمكن حذف هذا الصنف لأن له حركات مخزون.",
  STOCK_ALREADY_CONSUMED: "تم استهلاك هذا المخزون بالفعل، لذا لا يمكن عكس الحركة.",
  INVALID_PRODUCT: "الصنف المحدد لا يخص هذه الشركة.",
  INVALID_PROJECT: "المشروع المحدد غير صالح.",
  INVALID_PURCHASE_ORDER: "أمر الشراء المحدد غير صالح.",
  INVALID_ACCOUNT: "الحساب المحدد غير صالح.",
  FLAT_RATE_NOT_SUPPORTED: "لا يوجد نظام ضريبة بسعر مقطوع في الإمارات. اختر: قياسي أو غير مسجل أو أخرى.",
  ANNUAL_FILING_NOT_SUPPORTED: "تُقدَّم ضريبة القيمة المضافة شهرياً أو ربع سنوياً في الإمارات، وليس سنوياً.",
  FUTURE_DATE: "لا يمكن أن يكون التاريخ في المستقبل.",
  INVOICE_DATE_IN_FUTURE: "لا يمكن أن يكون تاريخ الفاتورة في المستقبل.",
  CREDIT_NOTE_DATE_BEFORE_INVOICE: "لا يمكن أن يسبق تاريخ الإشعار الدائن تاريخ الفاتورة التي يشعرها.",
  CREDIT_NOTE_DATE_IN_FUTURE: "لا يمكن أن يكون تاريخ الإشعار الدائن في المستقبل.",
  INVALID_CREDIT_NOTE_DATE: "تاريخ الإشعار الدائن غير صالح.",
  INVALID_CREDIT_LINES: "يجب أن تحتوي بنود الإشعار الدائن على بند واحد على الأقل.",
  CREDIT_EXCEEDS_VAT_BUCKET: "مبلغ الإشعار الدائن أكبر من الباقي من الفاتورة بهذه النسبة الضريبية.",
  CREDIT_EXCEEDS_ACCOUNT_BALANCE: "مبلغ الإشعار الدائن أكبر من الباقي من الفاتورة.",
  CREDIT_NOTE_LINES_MISMATCH: "لا تطابق بنود الإشعار الدائن ما تبقى من الفاتورة. أشعِر بالبنود المتبقية بالضبط أو اترك البنود فارغة لإشعار الرصيد المتبقي.",
  FULLY_CREDITED: "تم إشعار هذه الفاتورة دائناً بالكامل.",
  INVOICE_CREDITED_LOCKED: "لا يمكن تعديل فاتورة تم إشعارها دائناً.",
  INVOICE_NOT_POSTED: "لا يمكن إصدار إشعار دائن لفاتورة غير مرحّلة أو ملغاة.",
  INVOICE_NOTHING_OUTSTANDING: "لا يوجد رصيد مستحق على هذه الفاتورة.",
  INVOICE_NUMBER_EXISTS: "رقم الفاتورة مستخدم بالفعل.",
  INVOICE_POSTED_AMOUNT_LOCKED: "فاتورة مرحّلة: لا يمكن تغيير مبالغها. أصدر إشعاراً دائناً أو ألغها.",
  INVOICE_TYPE_NOT_EDITABLE: "لا يمكن تعديل هذا النوع من الفواتير.",
  INVOICE_TERMINAL: "هذه الفاتورة في حالة نهائية ولا يمكن تغييرها.",
  CREDITED_IS_AUTOMATIC: "حالة \"مُشعَرة دائناً\" تُحدَّد تلقائياً عند إصدار إشعار دائن.",
  INVALID_TRANSITION: "لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية.",
  BILL_NOT_EDITABLE: "لا يمكن تعديل فاتورة المورّد بعد اعتمادها.",
  BILL_NOT_APPROVED: "لم تُعتمد فاتورة المورّد بعد.",
  BILL_HAS_CREDIT_APPLICATIONS: "عُمّم على فاتورة المورّد إشعار دائن، لذا لا يمكن تغييرها.",
  APPROVAL_IN_PROGRESS: "هذا المستند قيد الموافقة.",
  VENDOR_TRN_MISSING: "الرقم الضريبي للمورّد مطلوب لهذه الفاتورة.",
  NO_EXCHANGE_RATE: "لا يوجد سعر صرف لهذا التاريخ. أضف سعر صرف أولاً.",
  CURRENCY_MISMATCH: "عملة المستند لا تطابق العملة المطلوبة.",
  OPENING_BALANCE_EXISTS: "تم ترحيل أرصدة افتتاحية بالفعل. اعكسها أولاً لإدخال غيرها.",
  OPENING_BALANCE_INVALID: "الأرصدة الافتتاحية غير متوازنة أو غير صالحة. راجع المعاينة.",
  OPENING_BALANCE_INVOICE: "هذه فاتورة رصيد افتتاحي ولا يوجد لها إيراد أو ضريبة لعكسهما.",
  OPENING_BALANCE_BILL: "هذه فاتورة مورّد برصيد افتتاحي ولا يوجد لها مصروف أو ضريبة لعكسهما.",
  OPENING_BALANCE_IN_USE: "تم استخدام الأرصدة الافتتاحية في مستندات أخرى فلا يمكن عكسها.",
  OPENING_BALANCE_VAT_FILED: "تم تقديم إقرار ضريبة القيمة المضافة لفترة الأرصدة الافتتاحية.",
  OPENING_BALANCE_NOT_FOUND: "لا توجد أرصدة افتتاحية.",
  OPENING_BALANCE_ALREADY_REVERSED: "تم عكس هذه الأرصدة الافتتاحية بالفعل.",
  CHART_OF_ACCOUNTS_MISSING: "دليل الحسابات غير مكتمل: أحد الحسابات المطلوبة غير موجود.",
  CLOSING_WINDOW_INVALID: "فترة الإقفال غير صالحة.",
  CLOSING_WINDOW_AFTER_ENTRY: "توجد قيود بعد فترة الإقفال المختارة.",
  YEAR_END_CLOSE_INCOMPLETE: "إقفال نهاية السنة غير مكتمل.",
  REASON_REQUIRED: "السبب مطلوب.",
  AMOUNT_OUT_OF_RANGE: "المبلغ خارج النطاق المسموح.",
  EMAIL_NOT_CONFIGURED: "البريد الإلكتروني غير مُهيأ على هذا الخادم، لذا لم يُرسل شيء.",
  EINVOICE_PROVIDER_NOT_CONFIGURED: "مزود الفاتورة الإلكترونية غير مُهيأ.",
  EINVOICE_VALIDATION_FAILED: "فشل التحقق من الفاتورة الإلكترونية. راجع التفاصيل.",
  ENDPOINT_DEPRECATED: "لم يعد هذا الإجراء متاحاً. استخدم الإصدار الجديد من الشاشة.",
  PERIOD_LOCKED: "هذه الفترة مقفلة. لا يمكن الترحيل فيها.",
  CSV_INVALID: "ملف CSV غير صالح.",
  ADVANCE_USE_REFUND: "لا يمكن إشعار فاتورة الدفعة المقدمة دائناً مباشرة. استرد الدفعة المقدمة بدلاً من ذلك.",
  INVALID_BANK_ACCOUNT: "الحساب المحدد لا يصلح لدفع المبلغ المسترد. اختر حساباً نقدياً أو بنكياً.",
  REFUND_ALREADY_VOID: "تم إلغاء هذا الرد بالفعل.",
  REFUND_NOT_FOUND: "لم يُعثر على عملية الرد.",
  CREDIT_NOTE_NOT_FOUND: "لم يُعثر على الإشعار الدائن.",
  EXCEEDS_CREDIT_BALANCE: "المبلغ أكبر من رصيد العميل المتاح.",
  INVALID_AMOUNT: "يجب أن يكون المبلغ أكبر من صفر.",
  CUSTOMER_NOT_FOUND: "لم يُعثر على العميل.",
  INVALID_VOID_DATE: "تاريخ العكس غير صالح.",
  VOID_DATE_BEFORE_DOCUMENT: "لا يمكن أن يسبق تاريخ العكس تاريخ المستند نفسه.",
  VOID_DATE_IN_FUTURE: "لا يمكن أن يكون تاريخ العكس في المستقبل.",
  VOID_DATE_PERIOD_LOCKED: "شهر تاريخ العكس مقفل. اختر تاريخاً في شهر مفتوح.",
  VOID_DATE_PERIOD_FILED: "يوجد إقرار ضريبي مقدّم يغطي هذا التاريخ. اختر تاريخاً بعده.",
  CREDIT_NOTE_HAS_REFUNDS: "هذا الإشعار الدائن عليه مبالغ مردودة. ألغِ الرد أولاً ثم ألغِ الإشعار الدائن.",
};

/** The message to show for a failed call: ours in Arabic for a known code, otherwise the server's sentence. */
export function localizeServerError(code: string | undefined | null, serverMessage: string, locale: string): string {
  if (!code) return serverMessage;
  const key = salesErrorKey(code);
  if (key) return shared.t(key);
  if (locale === "ar" && code === "PERIOD_LOCKED") {
    const period = serverMessage.match(/\((\d{2}\/\d{4})\)/)?.[1];
    return period ? `الفترة (${period}) مقفلة. لا يمكن الترحيل فيها. افتح الفترة أولاً.` : SERVER_ERRORS_AR[code];
  }
  if (locale === "ar") return SERVER_ERRORS_AR[code] ?? serverMessage;
  return serverMessage;
}
