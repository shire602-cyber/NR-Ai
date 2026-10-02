// Bilingual system emails (Phase 9 follow-up B3).
//
// Every email the system writes itself goes out in Arabic and English: the Arabic block first, then the English, so a
// recipient reads their own language without us guessing it. Where the recipient's language is KNOWN (a locale passed
// by the caller: a scheduled report's language, a user setting) only that language is sent. Contacts and users carry
// no language today, so the default is both.
//
// Pure functions and string tables: no database, no I/O. Templates in email.service.ts and the services that write
// their own bodies take their words from here.

export type EmailLocale = "ar" | "en";
export type Localized = { en: string; ar: string };

/** The languages to send, Arabic first. A known locale narrows it to that one language. */
export function emailLanguages(locale?: EmailLocale | null): EmailLocale[] {
  return locale === "en" ? ["en"] : locale === "ar" ? ["ar"] : ["ar", "en"];
}

/** {name} placeholders. Values are inserted as given: callers escape for HTML before passing them. */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => (vars[key] !== undefined ? String(vars[key]) : m));
}

/** "Arabic | English" subject (one language when the locale is known). */
export function bilingualSubject(s: Localized, locale?: EmailLocale | null): string {
  return emailLanguages(locale).map((l) => s[l]).join(" | ");
}

const TEXT_DIVIDER = "\n\n————————\n\n";

/** Plain-text body: the Arabic block, a divider, the English block (one block when the locale is known). */
export function bilingualText(s: Localized, locale?: EmailLocale | null): string {
  return emailLanguages(locale).map((l) => s[l]).join(TEXT_DIVIDER);
}

/** HTML: one section per language, Arabic right-to-left, separated by a rule. */
export function htmlSections(locale: EmailLocale | null | undefined, build: (lang: EmailLocale) => string): string {
  const langs = emailLanguages(locale);
  return langs
    .map((lang, i) => {
      const inner = build(lang);
      const rule = i > 0 ? `<hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">` : "";
      return lang === "ar"
        ? `${rule}<div dir="rtl" lang="ar" style="text-align:right;">${inner}</div>`
        : `${rule}<div dir="ltr" lang="en" style="text-align:left;">${inner}</div>`;
    })
    .join("\n");
}

/** Dates in the email's language, Western digits in both. */
export function formatEmailDate(date: Date | string | null | undefined, lang: EmailLocale): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(lang === "ar" ? "ar-AE-u-nu-latn" : "en-AE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const BRAND = { en: "Muhasib.ai", ar: "محاسب.ai" } as const;

// ─── String tables ────────────────────────────────────────────────────────────

export const EMAIL_TEXT = {
  genericFooter: { en: "NR Accounting Management System", ar: "نظام NR لإدارة المحاسبة" },
  automated: {
    en: "This is an automated email. Please do not reply directly to this message.",
    ar: "هذه رسالة آلية. يرجى عدم الرد عليها مباشرة.",
  },
  trn: { en: "TRN", ar: "الرقم الضريبي" },
  dear: { en: "Dear {name},", ar: "عزيزي {name}،" },

  // invoice
  invoiceSubject: { en: "Invoice {number} from {company}", ar: "فاتورة {number} من {company}" },
  taxInvoice: { en: "Tax Invoice", ar: "فاتورة ضريبية" },
  invoiceAttached: {
    en: "Please find attached your invoice from <strong>{company}</strong>.",
    ar: "تجدون في المرفق فاتورتكم من <strong>{company}</strong>.",
  },
  invoiceNumber: { en: "Invoice Number", ar: "رقم الفاتورة" },
  invoiceDate: { en: "Invoice Date", ar: "تاريخ الفاتورة" },
  dueDate: { en: "Due Date", ar: "تاريخ الاستحقاق" },
  subtotal: { en: "Subtotal", ar: "المجموع قبل الضريبة" },
  vat5: { en: "VAT (5%)", ar: "ضريبة القيمة المضافة (5%)" },
  totalDue: { en: "Total Due", ar: "الإجمالي المستحق" },
  pdfAttached: {
    en: "The invoice PDF is attached to this email for your records.",
    ar: "ملف PDF للفاتورة مرفق بهذه الرسالة لسجلاتكم.",
  },
  queries: {
    en: "For any queries, please contact us at {email}.",
    ar: "لأي استفسار، يرجى التواصل معنا على {email}.",
  },

  // payment reminder
  reminderOverdueTitle: { en: "Overdue Invoice Reminder", ar: "تذكير بفاتورة متأخرة السداد" },
  reminderTitle: { en: "Payment Reminder", ar: "تذكير بالدفع" },
  reminderOverdueSubject: { en: "Overdue Invoice Reminder: {number} — {amount}", ar: "تذكير بفاتورة متأخرة السداد: {number} — {amount}" },
  reminderSubject: { en: "Payment Reminder: Invoice {number} Due {due}", ar: "تذكير بالدفع: الفاتورة {number} تستحق {due}" },
  soon: { en: "Soon", ar: "قريباً" },
  tone1: { en: "We hope this email finds you well. We wanted to gently remind you", ar: "نأمل أن تكونوا بخير. نود تذكيركم بلطف بأن" },
  tone2: { en: "We are following up regarding", ar: "نتابع معكم لإفادتكم بأن" },
  tone3: { en: "This is an important notice regarding", ar: "هذا إشعار مهم لإفادتكم بأن" },
  reminderBody: {
    en: "{tone} that invoice <strong>{number}</strong> for <strong>{amount}</strong> {state}.{count}",
    ar: "{tone} الفاتورة رقم <strong>{number}</strong> بمبلغ <strong>{amount}</strong> {state}.{count}",
  },
  stateOverdue: { en: "is now overdue", ar: "أصبحت متأخرة السداد" },
  stateDueOn: { en: "is due on {date}", ar: "تستحق السداد بتاريخ {date}" },
  stateAwaiting: { en: "is awaiting payment", ar: "بانتظار السداد" },
  reminderCount: { en: " This is reminder #{n}.", ar: " هذا هو التذكير رقم {n}." },
  amountDue: { en: "Amount Due", ar: "المبلغ المستحق" },
  reminderDisregard: {
    en: "Please find the invoice attached. If you have already made this payment, please disregard this notice.",
    ar: "تجدون الفاتورة في المرفق. إذا كنتم قد سددتم هذا المبلغ بالفعل، يرجى تجاهل هذا الإشعار.",
  },
  reminderQuestions: {
    en: "If you have any questions, please contact us at {email}.",
    ar: "إذا كانت لديكم أي أسئلة، يرجى التواصل معنا على {email}.",
  },

  // password reset
  resetSubject: { en: "Reset your Muhasib.ai password", ar: "إعادة تعيين كلمة مرور محاسب.ai" },
  resetBody: {
    en: "We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour and can only be used once.",
    ar: "تلقينا طلباً لإعادة تعيين كلمة المرور. اضغط على الزر أدناه لاختيار كلمة مرور جديدة. ينتهي هذا الرابط خلال ساعة واحدة ويمكن استخدامه مرة واحدة فقط.",
  },
  resetButton: { en: "Reset password", ar: "إعادة تعيين كلمة المرور" },
  resetCopy: {
    en: "If the button doesn't work, copy this link into your browser:",
    ar: "إذا لم يعمل الزر، انسخ هذا الرابط إلى متصفحك:",
  },
  resetIgnore: {
    en: "If you didn't request this, you can safely ignore this email — your password will not change.",
    ar: "إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان — لن تتغير كلمة مرورك.",
  },
  resetFooter: { en: "Muhasib.ai — Smart Accounting", ar: "محاسب.ai — محاسبة ذكية" },

  // welcome
  welcomeSubject: { en: "Welcome to Muhasib.ai", ar: "مرحباً بك في محاسب.ai" },
  welcomeTagline: { en: "Your AI-powered accounting platform", ar: "منصتك المحاسبية المدعومة بالذكاء الاصطناعي" },
  welcomeIntro: { en: "Welcome to Muhasib.ai! {setup}", ar: "مرحباً بك في محاسب.ai! {setup}" },
  welcomeSetupCompany: {
    en: "Your account for <strong>{company}</strong> has been set up successfully.",
    ar: "تم إعداد حسابك لشركة <strong>{company}</strong> بنجاح.",
  },
  welcomeSetup: { en: "Your account has been created successfully.", ar: "تم إنشاء حسابك بنجاح." },
  welcomeUse: {
    en: "You can now manage your invoices, track expenses, and stay VAT-compliant — all in one place.",
    ar: "يمكنك الآن إدارة فواتيرك وتتبع مصروفاتك والالتزام بضريبة القيمة المضافة — كل ذلك في مكان واحد.",
  },
  welcomeHelp: { en: "If you have any questions, our support team is here to help.", ar: "إذا كانت لديك أي أسئلة، فريق الدعم لدينا هنا لمساعدتك." },
  welcomeFooter: { en: "Muhasib.ai — Smart Accounting for UAE Businesses", ar: "محاسب.ai — محاسبة ذكية لأعمال دولة الإمارات" },

  // new sign-in
  newDeviceSubject: { en: "New sign-in to your Muhasib.ai account", ar: "تسجيل دخول جديد إلى حسابك في محاسب.ai" },
  newDeviceBody: {
    en: "Hello{name},\n\nYour account was just signed in to from {device} (IP {ip}).\n\nIf this was you, no action is needed. If it was not, change your password and revoke other sessions under Settings > Security right away.",
    ar: "مرحباً{name}،\n\nتم تسجيل الدخول إلى حسابك للتو من {device} (عنوان IP: {ip}).\n\nإذا كنت أنت من قام بذلك فلا حاجة لأي إجراء. وإذا لم تكن أنت، فغيّر كلمة مرورك وأنهِ الجلسات الأخرى من الإعدادات > الأمان فوراً.",
  },

  // export ready
  exportReadySubject: { en: "Your company data export is ready", ar: "ملف تصدير بيانات شركتك جاهز" },
  exportReadyBody: {
    en: "Your export is ready. Download it from Settings > Data & privacy within {hours} hours; after that the link expires and you can request a new one.",
    ar: "ملف التصدير جاهز. نزّله من الإعدادات > البيانات والخصوصية خلال {hours} ساعة؛ بعد ذلك ينتهي الرابط ويمكنك طلب ملف جديد.",
  },

  // approvals
  approvalNeededTitle: { en: "Approval needed", ar: "مطلوب اعتماد" },
  approvalNeededBody: {
    en: "{label} (AED {amount}) is waiting for a {role} to approve it (step {step} of {steps}).",
    ar: "{label} (بمبلغ {amount} درهم) بانتظار اعتماد {role} (الخطوة {step} من {steps}).",
  },
  approvalApproved: { en: "Approved", ar: "تمت الموافقة" },
  approvalRejected: { en: "Rejected", ar: "تم الرفض" },
  approvalOutcomeBody: { en: "{label} was {outcome}.", ar: "قرار بشأن {label}: {outcome}." },

  // quote
  quoteSubject: { en: "Quote {number} from {company}", ar: "عرض السعر {number} من {company}" },
  quoteBody: {
    en: "Please review quote <strong>{number}</strong> from {company} and accept or decline it online:",
    ar: "يرجى مراجعة عرض السعر <strong>{number}</strong> من {company} وقبوله أو رفضه عبر الإنترنت:",
  },

  // portal invitation
  inviteSubject: { en: "You are invited to the {company} client portal", ar: "أنت مدعو إلى بوابة عملاء {company}" },
  inviteBody: {
    en: "{inviter} at NR Accounting has invited you to the client portal for <strong>{company}</strong>.",
    ar: "دعاك {inviter} من NR Accounting إلى بوابة العملاء الخاصة بـ <strong>{company}</strong>.",
  },
  inviteWhat: {
    en: "The portal lets you view invoices and statements, upload documents and message your accountant.",
    ar: "تتيح لك البوابة عرض الفواتير وكشوف الحساب ورفع المستندات ومراسلة محاسبك.",
  },
  inviteButton: { en: "Accept invitation", ar: "قبول الدعوة" },
  inviteExpiry: {
    en: "This link works once and expires in {days} days. If the button does not work, copy this address into your browser:",
    ar: "يعمل هذا الرابط مرة واحدة وينتهي خلال {days} أيام. إذا لم يعمل الزر، انسخ هذا العنوان إلى متصفحك:",
  },

  // statements
  statementSubject: { en: "Statement of account from {company} ({period})", ar: "كشف حساب من {company} ({period})" },
  statementCustomerBody: {
    en: "Dear {name},\n\nPlease find attached your statement of account for {period}.\nClosing balance: AED {balance}.\n\nKind regards,\n{company}",
    ar: "عزيزي {name}،\n\nتجدون في المرفق كشف حسابكم عن الفترة {period}.\nالرصيد الختامي: {balance} درهم.\n\nمع خالص التحية،\n{company}",
  },
  statementVendorBody: {
    en: "Dear {name},\n\nPlease find attached our record of your account for {period}.\nBalance we show as payable to you: AED {balance}.\nPlease tell us if your records differ.\n\nKind regards,\n{company}",
    ar: "عزيزي {name}،\n\nتجدون في المرفق سجلنا لحسابكم عن الفترة {period}.\nالرصيد المستحق لكم حسب سجلاتنا: {balance} درهم.\nيرجى إبلاغنا إذا اختلفت سجلاتكم.\n\nمع خالص التحية،\n{company}",
  },

  // VAT return reminder from the firm
  vatReminderSubject: { en: "VAT Return Reminder — Due {date}", ar: "تذكير بإقرار ضريبة القيمة المضافة — الاستحقاق {date}" },
  vatReminderBody: {
    en: "Dear {name},\n\nThis is a reminder that your VAT return is due on {date}. Please ensure all documents are submitted to our team promptly.\n\nIf you have any questions, please do not hesitate to contact us.\n\nKind regards,\nNR Accounting Team",
    ar: "عزيزي {name}،\n\nنذكّركم بأن موعد استحقاق إقرار ضريبة القيمة المضافة هو {date}. يرجى التأكد من تسليم جميع المستندات إلى فريقنا في أقرب وقت.\n\nإذا كانت لديكم أي أسئلة فلا تترددوا في التواصل معنا.\n\nمع خالص التحية،\nفريق NR Accounting",
  },
} satisfies Record<string, Localized>;

export type EmailTextKey = keyof typeof EMAIL_TEXT;

/** One string of the table in one language, placeholders filled. */
export function tx(key: EmailTextKey, lang: EmailLocale, vars: Record<string, string | number> = {}): string {
  return fill(EMAIL_TEXT[key][lang], vars);
}

/** One table entry, both languages, placeholders filled (for subjects and plain-text bodies). */
export function localized(key: EmailTextKey, vars: Record<string, string | number> = {}, arVars?: Record<string, string | number>): Localized {
  return { en: fill(EMAIL_TEXT[key].en, vars), ar: fill(EMAIL_TEXT[key].ar, arVars ?? vars) };
}

export const ROLE_LABEL: Record<string, Localized> = {
  owner: { en: "owner", ar: "المالك" },
  cfo: { en: "CFO", ar: "المدير المالي" },
  accountant: { en: "accountant", ar: "المحاسب" },
  employee: { en: "employee", ar: "الموظف" },
};

export const DOCUMENT_LABEL: Record<string, Localized> = {
  bill: { en: "bill", ar: "فاتورة المورد" },
  vendor_bill: { en: "bill", ar: "فاتورة المورد" },
  expense_claim: { en: "expense claim", ar: "مطالبة المصروفات" },
  purchase_order: { en: "purchase order", ar: "أمر الشراء" },
  payroll_run: { en: "payroll run", ar: "مسيّر الرواتب" },
  journal_entry: { en: "journal entry", ar: "قيد اليومية" },
  journal: { en: "journal entry", ar: "قيد اليومية" },
  manual_journal: { en: "manual journal", ar: "قيد اليومية اليدوي" },
  final_settlement: { en: "final settlement", ar: "التسوية النهائية" },
};

export const OUTCOME_LABEL: Record<string, Localized> = {
  approved: { en: "approved", ar: "تمت الموافقة عليه" },
  rejected: { en: "rejected", ar: "تم رفضه" },
};
