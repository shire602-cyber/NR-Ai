/**
 * Content of every customer-facing system e-mail: invoice, payment reminder, payment receipt,
 * quote, statement, portal sign-in code, EmaraTax approver request and password reset.
 *
 * Pure functions: each returns `{ subject, html, text }` for one language choice
 * (`en`, `ar` or `bilingual`) using the shared layout in `email-layout.ts`; nothing here sends
 * or reads the database (sending goes through `sendEmail` and the outbox). The subject, the
 * HTML and the plain-text part always follow the same language, so an Arabic message has an
 * Arabic subject and an Arabic plain-text alternative.
 *
 * Seller TRN and internal ids (payment-provider event ids, database ids) never appear in the
 * body or footer; the attached PDF carries the tax-invoice particulars.
 */
import type { Company, Invoice } from "../../shared/schema";
import { DOCUMENT_ACCENT_DEFAULT } from "../../shared/document-accent";
import {
  emailDate,
  emailDateBlock,
  emailMoney,
  escapeHtml,
  isolateInline,
  pickText,
  renderBilingualEmail,
  renderEmailText,
  type BilingualBlock,
  type BilingualEmailContent,
  type EmailLanguage,
} from "./email-layout";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/** Plain strings (subject, text part) carry no bidi isolates: some clients show them as boxes. */
const stripBidi = (value: string) => value.replace(/[\u2066-\u2069]/g, "");

function build(
  content: BilingualEmailContent,
  language: EmailLanguage,
  subject: BilingualBlock
): BuiltEmail {
  return {
    subject: stripBidi(pickText(subject, language))
      .replace(/[\r\n]+/g, " ")
      .slice(0, 300),
    html: renderBilingualEmail(content, language),
    text: stripBidi(renderEmailText(content, language)),
  };
}

/** Company line for the footer: name and address (no TRN). */
export function companyFooter(company: Pick<Company, "name" | "businessAddress">): string {
  return [company.name, company.businessAddress].filter(Boolean).join(" · ");
}

function brandFields(company: Company) {
  return {
    brandName: company.name,
    footer: companyFooter(company),
    contactEmail: company.contactEmail ?? null,
  };
}

/** Arabic count noun for days: يوم واحد / يومان / ٣ أيام / ١١ يوماً (digits stay Latin). */
export function arabicDays(n: number): string {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومين";
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

function englishDays(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/;

/** A name fit for an Arabic greeting: has Arabic letters and no Latin-script letters. */
function arabicOnly(name: string | null | undefined): string | null {
  const v = name?.trim();
  return v && ARABIC_SCRIPT.test(v) && !LATIN_LETTER.test(v) ? v : null;
}

export interface GreetingNames {
  /** The name on the document (invoice/quote snapshot, contact name). */
  name?: string | null;
  /** The contact's Arabic name (customer_contacts.name_ar). */
  nameAr?: string | null;
  /** The customer company's Arabic name, when it is a separate field from the contact's. */
  companyNameAr?: string | null;
}

/** Neutral Arabic greeting used when no Arabic-script name is known. */
export const NEUTRAL_AR_GREETING = "عزيزنا العميل،";

/**
 * The Arabic greeting line: the contact's Arabic name, else an Arabic-script document name,
 * else the company's Arabic name, else a neutral greeting. A Latin-script name is never used.
 */
export function arabicGreeting(names: GreetingNames): string {
  const who = arabicOnly(names.nameAr) ?? arabicOnly(names.name) ?? arabicOnly(names.companyNameAr);
  return who ? `عزيزنا ${isolateInline(who)}،` : NEUTRAL_AR_GREETING;
}

const greeting = (
  name: string,
  nameAr?: string | null,
  companyNameAr?: string | null
): BilingualBlock => ({
  en: `Dear ${isolateInline(name)},`,
  ar: arabicGreeting({ name, nameAr, companyNameAr }),
});

// ─── Invoice ─────────────────────────────────────────────────────

export interface InvoiceEmailOptions {
  payUrl?: string | null;
  portalUrl?: string | null;
  einvoiceUrl?: string | null;
  language?: EmailLanguage;
  /** The contact's Arabic name, for the Arabic greeting. */
  customerNameAr?: string | null;
  /** Throw EmailNotSentError when not sent (default true, the historic contract). */
  throwOnFailure?: boolean;
}

export function buildInvoiceEmail(
  invoice: Invoice,
  company: Company,
  message?: string,
  opts: InvoiceEmailOptions = {}
): BuiltEmail {
  const language = opts.language ?? "bilingual";
  const total = emailMoney(invoice.total, invoice.currency);
  const number = isolateInline(invoice.number);
  const co = isolateInline(company.name);
  const custom = message ? [escapeHtml(message).replace(/\n/g, "<br>")] : [];
  const contact = company.contactEmail ? isolateInline(company.contactEmail) : null;
  const url = opts.payUrl || opts.portalUrl || null;
  const content: BilingualEmailContent = {
    ...brandFields(company),
    heading: { en: `Invoice ${invoice.number}`, ar: `فاتورة رقم ${invoice.number}` },
    preheader: {
      en: `${company.name} sent you invoice ${invoice.number} for ${total.en}`,
      ar: `أرسلت لكم ${company.name} الفاتورة رقم ${invoice.number} بمبلغ ${total.ar}`,
    },
    paragraphs: {
      en: [
        greeting(invoice.customerName, opts.customerNameAr).en,
        `Please find attached invoice <strong>${number}</strong> from <strong>${co}</strong> for <strong>${escapeHtml(total.en)}</strong>.`,
        ...custom,
        ...(opts.einvoiceUrl ? [`E-invoice status: ${escapeHtml(opts.einvoiceUrl)}`] : []),
        ...(contact ? [`For any queries, please contact ${contact}.`] : []),
      ],
      ar: [
        greeting(invoice.customerName, opts.customerNameAr).ar,
        `تجدون مرفقاً الفاتورة رقم <strong>${number}</strong> من <strong>${co}</strong> بمبلغ <strong>${escapeHtml(total.ar)}</strong>.`,
        ...(contact ? [`للاستفسار يرجى التواصل عبر ${contact}.`] : []),
      ],
    },
    summary: [
      { label: { en: "Invoice date", ar: "تاريخ الفاتورة" }, value: emailDateBlock(invoice.date) },
      ...(invoice.dueDate
        ? [
            {
              label: { en: "Due date", ar: "تاريخ الاستحقاق" },
              value: emailDateBlock(invoice.dueDate),
            },
          ]
        : []),
      { label: { en: "Total", ar: "الإجمالي" }, value: total, strong: true },
    ],
    ...(opts.payUrl
      ? { button: { url: opts.payUrl, label: { en: "Pay now", ar: "ادفع الآن" } } }
      : url
        ? { button: { url, label: { en: "View invoice", ar: "عرض الفاتورة" } } }
        : {}),
  };
  return build(content, language, {
    en: `Invoice ${invoice.number} from ${company.name}`,
    ar: `فاتورة رقم ${invoice.number} من ${company.name}`,
  });
}

// ─── Payment reminder ────────────────────────────────────────────

export interface ReminderEmailInput {
  invoice: Invoice;
  company: Company;
  customerName: string;
  /** The contact's Arabic name, for the Arabic greeting. */
  customerNameAr?: string | null;
  openFils: number;
  level: number;
  daysOverdue: number;
  payUrl?: string | null;
  portalUrl?: string | null;
  language?: EmailLanguage;
  customSubject?: string | null;
  customTemplate?: string | null;
}

/** Plain-text placeholder substitution for subjects (no HTML escaping; no line breaks). */
export function renderPlainTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : `{{${key}}}`))
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

/**
 * Render a template string by substituting {{variable}} placeholders.
 * Values are HTML-escaped to prevent injection.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? escapeHtml(vars[key]) : `{{${key}}}`
  );
}

export function reminderTemplateVars(i: ReminderEmailInput): Record<string, string> {
  const vars: Record<string, string> = {
    customerName: i.customerName,
    invoiceNumber: i.invoice.number,
    amountDue: emailMoney(i.openFils / 100, i.invoice.currency).en,
    total: emailMoney(i.invoice.total, i.invoice.currency).en,
    dueDate: emailDate(i.invoice.dueDate, "en"),
    daysOverdue: String(Math.max(0, i.daysOverdue)),
    companyName: i.company.name,
    payLink: i.payUrl ?? i.portalUrl ?? "",
    level: String(i.level),
  };
  // snake_case aliases ({{invoice_number}}) for templates written in that style.
  for (const [k, v] of Object.entries({ ...vars })) {
    vars[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  }
  return vars;
}

/** Dunning email for one reminder level, in one language or both. */
export function buildReminderEmail(i: ReminderEmailInput): BuiltEmail {
  const language = i.language ?? "bilingual";
  const overdue = i.daysOverdue > 0;
  const days = Math.max(0, i.daysOverdue);
  const vars = reminderTemplateVars(i);
  const amount = emailMoney(i.openFils / 100, i.invoice.currency);
  const number = isolateInline(i.invoice.number);
  const due = emailDateBlock(i.invoice.dueDate);
  const link = i.payUrl ?? i.portalUrl ?? null;

  const defaultSubject: BilingualBlock = overdue
    ? {
        en: `Overdue: invoice ${i.invoice.number} — ${amount.en}`,
        ar: `فاتورة متأخرة: ${i.invoice.number} — ${amount.ar}`,
      }
    : {
        en: `Payment reminder: invoice ${i.invoice.number} — ${amount.en}`,
        ar: `تذكير بسداد الفاتورة ${i.invoice.number} — ${amount.ar}`,
      };
  // A custom subject is the company's own wording (one language): it replaces the default.
  const customSubject = i.customSubject ? renderPlainTemplate(i.customSubject, vars) : null;

  const enBody = i.customTemplate
    ? [renderTemplate(i.customTemplate, vars).replace(/\n/g, "<br>")]
    : [
        greeting(i.customerName, i.customerNameAr).en,
        overdue
          ? `Invoice <strong>${number}</strong> was due on ${escapeHtml(due.en)} and is now ${englishDays(days)} overdue. The outstanding balance is <strong>${escapeHtml(amount.en)}</strong>.`
          : `This is a friendly reminder that invoice <strong>${number}</strong> for <strong>${escapeHtml(amount.en)}</strong> is due on ${escapeHtml(due.en)}.`,
        i.level > 1 ? `This is reminder ${i.level}.` : "",
        "If you have already paid, please disregard this message.",
      ].filter(Boolean);
  const arBody = [
    greeting(i.customerName, i.customerNameAr).ar,
    overdue
      ? `استحقت الفاتورة رقم <strong>${number}</strong> بتاريخ ${escapeHtml(due.ar)} وقد مضى على استحقاقها ${arabicDays(days)}. الرصيد المستحق <strong>${escapeHtml(amount.ar)}</strong>.`
      : `نذكّركم بأن الفاتورة رقم <strong>${number}</strong> بمبلغ <strong>${escapeHtml(amount.ar)}</strong> تستحق بتاريخ ${escapeHtml(due.ar)}.`,
    i.level > 1 ? `هذا هو التذكير رقم ${i.level}.` : "",
    "إذا كنتم قد سدّدتم المبلغ فيرجى تجاهل هذه الرسالة.",
  ].filter(Boolean);

  const content: BilingualEmailContent = {
    ...brandFields(i.company),
    accent: overdue ? "#B91C1C" : DOCUMENT_ACCENT_DEFAULT,
    heading: overdue
      ? { en: "Overdue invoice", ar: "فاتورة متأخرة السداد" }
      : { en: "Payment reminder", ar: "تذكير بالسداد" },
    preheader: overdue
      ? {
          en: `Invoice ${i.invoice.number} is ${englishDays(days)} overdue: ${amount.en} outstanding`,
          ar: `الفاتورة ${i.invoice.number} متأخرة ${arabicDays(days)}: المستحق ${amount.ar}`,
        }
      : {
          en: `Invoice ${i.invoice.number} for ${amount.en} is due on ${due.en}`,
          ar: `الفاتورة ${i.invoice.number} بمبلغ ${amount.ar} تستحق بتاريخ ${due.ar}`,
        },
    paragraphs: { en: enBody, ar: arBody },
    summary: [
      { label: { en: "Invoice", ar: "الفاتورة" }, value: i.invoice.number },
      { label: { en: "Due date", ar: "تاريخ الاستحقاق" }, value: due },
      { label: { en: "Amount due", ar: "المبلغ المستحق" }, value: amount, strong: true },
    ],
    ...(link
      ? {
          button: {
            url: link,
            label: i.payUrl
              ? { en: "Pay now", ar: "ادفع الآن" }
              : { en: "View invoice", ar: "عرض الفاتورة" },
          },
        }
      : {}),
  };
  const built = build(content, language, defaultSubject);
  return customSubject ? { ...built, subject: stripBidi(customSubject) } : built;
}

// ─── Payment receipt ─────────────────────────────────────────────

export interface ReceiptEmailInput {
  company: Pick<Company, "name" | "businessAddress" | "contactEmail">;
  customerName: string;
  /** The contact's Arabic name, for the Arabic greeting. */
  customerNameAr?: string | null;
  invoiceNumber: string;
  amount: number;
  currency: string;
  /** The payer-visible reference (card/bank reference); never the provider's event id. */
  reference?: string | null;
  paidAt?: Date | string | null;
  language?: EmailLanguage;
}

export function buildReceiptEmail(i: ReceiptEmailInput): BuiltEmail {
  const language = i.language ?? "bilingual";
  const amount = emailMoney(i.amount, i.currency);
  const number = isolateInline(i.invoiceNumber);
  const content: BilingualEmailContent = {
    brandName: i.company.name,
    footer: companyFooter(i.company),
    contactEmail: i.company.contactEmail ?? null,
    heading: { en: "Payment received, thank you", ar: "تم استلام الدفعة، شكراً لكم" },
    preheader: {
      en: `We received ${amount.en} for invoice ${i.invoiceNumber}`,
      ar: `استلمنا ${amount.ar} عن الفاتورة ${i.invoiceNumber}`,
    },
    paragraphs: {
      en: [
        greeting(i.customerName, i.customerNameAr).en,
        `We received your online payment of <strong>${escapeHtml(amount.en)}</strong> for invoice <strong>${number}</strong>.`,
      ],
      ar: [
        greeting(i.customerName, i.customerNameAr).ar,
        `استلمنا دفعتكم الإلكترونية بمبلغ <strong>${escapeHtml(amount.ar)}</strong> عن الفاتورة رقم <strong>${number}</strong>.`,
      ],
    },
    summary: [
      { label: { en: "Invoice", ar: "الفاتورة" }, value: i.invoiceNumber },
      { label: { en: "Amount paid", ar: "المبلغ المدفوع" }, value: amount, strong: true },
      ...(i.paidAt
        ? [{ label: { en: "Date", ar: "التاريخ" }, value: emailDateBlock(i.paidAt) }]
        : []),
      ...(i.reference ? [{ label: { en: "Reference", ar: "المرجع" }, value: i.reference }] : []),
    ],
  };
  return build(content, language, {
    en: `Payment receipt: invoice ${i.invoiceNumber}`,
    ar: `إيصال دفع: الفاتورة ${i.invoiceNumber}`,
  });
}

// ─── Quote ───────────────────────────────────────────────────────

export interface QuoteEmailInput {
  company: Company;
  customerName: string;
  /** The contact's Arabic name, for the Arabic greeting. */
  customerNameAr?: string | null;
  quoteNumber: string;
  total: number;
  currency: string;
  expiryDate?: Date | string | null;
  /** The customer's own message (escaped here); falls back to the standard sentence. */
  message?: string | null;
  portalUrl?: string | null;
  language?: EmailLanguage;
}

export function buildQuoteEmail(i: QuoteEmailInput): BuiltEmail {
  const language = i.language ?? "bilingual";
  const total = emailMoney(i.total, i.currency);
  const number = isolateInline(i.quoteNumber);
  const co = isolateInline(i.company.name);
  const custom = i.message?.trim() ? [escapeHtml(i.message.trim()).replace(/\n/g, "<br>")] : [];
  const content: BilingualEmailContent = {
    ...brandFields(i.company),
    heading: { en: `Quote ${i.quoteNumber}`, ar: `عرض سعر رقم ${i.quoteNumber}` },
    preheader: {
      en: `${i.company.name} sent you quote ${i.quoteNumber} for ${total.en}`,
      ar: `أرسلت لكم ${i.company.name} عرض السعر رقم ${i.quoteNumber} بمبلغ ${total.ar}`,
    },
    paragraphs: {
      en: [
        greeting(i.customerName, i.customerNameAr).en,
        `Please find attached quote <strong>${number}</strong> from <strong>${co}</strong> for <strong>${escapeHtml(total.en)}</strong>.`,
        ...custom,
        ...(i.portalUrl ? ["You can review it online and accept or decline it there."] : []),
      ],
      ar: [
        greeting(i.customerName, i.customerNameAr).ar,
        `تجدون مرفقاً عرض السعر رقم <strong>${number}</strong> من <strong>${co}</strong> بمبلغ <strong>${escapeHtml(total.ar)}</strong>.`,
        ...(i.portalUrl ? ["يمكنكم مراجعته عبر الإنترنت وقبوله أو رفضه من هناك."] : []),
      ],
    },
    summary: [
      { label: { en: "Quote", ar: "عرض السعر" }, value: i.quoteNumber },
      ...(i.expiryDate
        ? [{ label: { en: "Valid until", ar: "صالح حتى" }, value: emailDateBlock(i.expiryDate) }]
        : []),
      { label: { en: "Total", ar: "الإجمالي" }, value: total, strong: true },
    ],
    ...(i.portalUrl
      ? {
          button: {
            url: i.portalUrl,
            label: { en: "View and respond", ar: "عرض العرض والرد عليه" },
          },
        }
      : {}),
  };
  return build(content, language, {
    en: `Quote ${i.quoteNumber} from ${i.company.name}`,
    ar: `عرض سعر رقم ${i.quoteNumber} من ${i.company.name}`,
  });
}

// ─── Statement of account ────────────────────────────────────────

export interface StatementEmailInput {
  company: Pick<Company, "name" | "businessAddress" | "contactEmail">;
  customerName: string;
  /** The contact's Arabic name, for the Arabic greeting. */
  customerNameAr?: string | null;
  asOf: string;
  balances: Array<{ currency: string; closingBalance: number }>;
  message?: string | null;
  language?: EmailLanguage;
}

export function buildStatementEmail(i: StatementEmailInput): BuiltEmail {
  const language = i.language ?? "bilingual";
  const asOf = emailDateBlock(i.asOf);
  const balances = i.balances.map((b) => emailMoney(b.closingBalance, b.currency));
  const join = (lang: "en" | "ar") =>
    balances.map((b) => b[lang]).join(lang === "ar" ? "، " : ", ");
  const custom = i.message?.trim() ? [escapeHtml(i.message.trim()).replace(/\n/g, "<br>")] : [];
  const content: BilingualEmailContent = {
    brandName: i.company.name,
    footer: companyFooter(i.company),
    contactEmail: i.company.contactEmail ?? null,
    heading: { en: "Statement of account", ar: "كشف حساب" },
    preheader: {
      en: `Your statement as of ${asOf.en}: ${join("en") || "no balance"}`,
      ar: `كشف حسابكم حتى ${asOf.ar}: ${join("ar") || "لا يوجد رصيد"}`,
    },
    paragraphs: {
      en: [
        greeting(i.customerName, i.customerNameAr).en,
        `Please find attached your statement of account with <strong>${isolateInline(i.company.name)}</strong> as of ${escapeHtml(asOf.en)}.`,
        ...custom,
      ],
      ar: [
        greeting(i.customerName, i.customerNameAr).ar,
        `تجدون مرفقاً كشف حسابكم لدى <strong>${isolateInline(i.company.name)}</strong> حتى ${escapeHtml(asOf.ar)}.`,
      ],
    },
    summary: [
      { label: { en: "As of", ar: "حتى تاريخ" }, value: asOf },
      ...balances.map((b, idx) => ({
        label: { en: "Balance", ar: "الرصيد" },
        value: b,
        strong: idx === 0,
      })),
    ],
  };
  return build(content, language, {
    en: `Statement of account from ${i.company.name}`,
    ar: `كشف حساب من ${i.company.name}`,
  });
}

// ─── Customer portal sign-in code ────────────────────────────────

export function buildPortalCodeEmail(input: {
  companyName: string;
  code: string;
  language?: EmailLanguage;
}): BuiltEmail {
  const language = input.language ?? "bilingual";
  const code = `<strong dir="ltr" style="display:inline-block;font-size:26px;letter-spacing:6px;">${escapeHtml(input.code)}</strong>`;
  const content: BilingualEmailContent = {
    brandName: input.companyName,
    contactEmail: null,
    heading: { en: "Your sign-in code", ar: "رمز الدخول الخاص بكم" },
    preheader: {
      en: `${input.code} is your sign-in code. It expires in 10 minutes.`,
      ar: `${input.code} هو رمز الدخول. تنتهي صلاحيته خلال 10 دقائق.`,
    },
    paragraphs: {
      en: [
        "Use this code to open your customer portal. It expires in 10 minutes.",
        `<span style="display:block;text-align:center;">${code}</span>`,
        "If you did not ask for it, you can ignore this message.",
      ],
      ar: [
        "استخدموا هذا الرمز للدخول إلى بوابة العملاء. تنتهي صلاحيته خلال 10 دقائق.",
        `<span style="display:block;text-align:center;">${code}</span>`,
        "إذا لم تطلبوا الرمز فيمكنكم تجاهل هذه الرسالة.",
      ],
    },
  };
  return build(content, language, {
    en: `Your sign-in code: ${input.code}`,
    ar: `رمز الدخول: ${input.code}`,
  });
}

// ─── EmaraTax approver ───────────────────────────────────────────

export function buildApproverRequestEmail(input: {
  companyName: string;
  approverName?: string | null;
  url: string;
  language?: EmailLanguage;
}): BuiltEmail {
  const language = input.language ?? "bilingual";
  const co = isolateInline(input.companyName);
  const content: BilingualEmailContent = {
    brandName: input.companyName,
    contactEmail: null,
    heading: {
      en: "Approve the e-invoicing partner in EmaraTax",
      ar: "الموافقة على شريك الفوترة الإلكترونية في إمارات تاكس",
    },
    preheader: {
      en: `${input.companyName} needs you to approve its e-invoicing partner in EmaraTax`,
      ar: `تطلب ${input.companyName} موافقتكم على شريك الفوترة الإلكترونية في إمارات تاكس`,
    },
    paragraphs: {
      en: [
        input.approverName ? greeting(input.approverName).en : "Hello,",
        `<strong>${co}</strong> asked you to approve its e-invoicing partner in EmaraTax. The page shows the steps; you do not need an account with us.`,
      ],
      ar: [
        input.approverName ? greeting(input.approverName).ar : "مرحباً،",
        `طلبت <strong>${co}</strong> منكم الموافقة على شريك الفوترة الإلكترونية في إمارات تاكس. تعرض الصفحة الخطوات المطلوبة، ولا تحتاجون إلى حساب لدينا.`,
      ],
    },
    button: { url: input.url, label: { en: "Open the steps", ar: "فتح الخطوات" } },
    note: {
      en: "The link works for 14 days and can be revoked by the company at any time.",
      ar: "يعمل الرابط لمدة 14 يوماً، وللشركة إلغاؤه في أي وقت.",
    },
  };
  return build(content, language, {
    en: `${input.companyName}: approve the e-invoicing partner in EmaraTax`,
    ar: `${input.companyName}: الموافقة على شريك الفوترة الإلكترونية في إمارات تاكس`,
  });
}

export function buildApproverDoneEmail(input: {
  companyName: string;
  who: string | null;
  settingsUrl?: string | null;
  language?: EmailLanguage;
}): BuiltEmail {
  const language = input.language ?? "bilingual";
  const who = input.who ? isolateInline(input.who) : null;
  const co = isolateInline(input.companyName);
  const content: BilingualEmailContent = {
    brandName: input.companyName,
    contactEmail: null,
    heading: {
      en: "EmaraTax approval marked as done",
      ar: "تم تأكيد الموافقة في إمارات تاكس",
    },
    preheader: {
      en: `${input.who ?? "Your approver"} marked the EmaraTax approval step as done`,
      ar: `${input.who ?? "المسؤول عن الموافقة"} أكّد إتمام خطوة الموافقة في إمارات تاكس`,
    },
    paragraphs: {
      en: [
        `${who ?? "Your approver"} marked the EmaraTax approval step as done for <strong>${co}</strong>.`,
        "Open Settings, then E-invoicing, to verify it with your partner.",
      ],
      ar: [
        `أكّد ${who ?? "المسؤول عن الموافقة"} إتمام خطوة الموافقة في إمارات تاكس لصالح <strong>${co}</strong>.`,
        "افتحوا الإعدادات ثم الفوترة الإلكترونية للتحقق منها مع الشريك.",
      ],
    },
    ...(input.settingsUrl
      ? {
          button: {
            url: input.settingsUrl,
            label: { en: "Open e-invoicing settings", ar: "فتح إعدادات الفوترة الإلكترونية" },
          },
        }
      : {}),
  };
  return build(content, language, {
    en: `${input.companyName}: the e-invoicing partner approval is marked done`,
    ar: `${input.companyName}: تم تأكيد الموافقة على شريك الفوترة الإلكترونية`,
  });
}

// ─── Password reset ──────────────────────────────────────────────

export function buildPasswordResetEmail(resetUrl: string): BuiltEmail {
  const content: BilingualEmailContent = {
    brandName: "Muhasib.ai",
    footer: "Muhasib.ai",
    heading: { en: "Reset your password", ar: "إعادة تعيين كلمة المرور" },
    preheader: {
      en: "Use this link to choose a new password. It expires in 1 hour.",
      ar: "استخدموا هذا الرابط لاختيار كلمة مرور جديدة. تنتهي صلاحيته خلال ساعة.",
    },
    paragraphs: {
      en: [
        "We received a request to reset your password. This link expires in 1 hour and can only be used once.",
        "If you didn't request this, you can safely ignore this email.",
      ],
      ar: [
        "تلقينا طلباً لإعادة تعيين كلمة المرور. تنتهي صلاحية الرابط خلال ساعة ويمكن استخدامه مرة واحدة.",
        "إذا لم تطلبوا ذلك فيمكنكم تجاهل هذه الرسالة.",
      ],
    },
    button: { url: resetUrl, label: { en: "Reset password", ar: "إعادة تعيين كلمة المرور" } },
  };
  return build(content, "bilingual", {
    en: "Reset your Muhasib.ai password",
    ar: "إعادة تعيين كلمة مرور Muhasib.ai",
  });
}
