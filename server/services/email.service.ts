/**
 * Email service (W4-D, R16-08). Every email goes through the durable outbox (server/outbox):
 * sendEmail() enqueues the message (with attachments), makes the first delivery attempt when a
 * provider is configured, and reports exactly what happened:
 *
 *   { sent: true,  queued: true, status: "sent" }                 provider accepted it
 *   { sent: false, queued: true, status: "retrying" }             provider failed; worker retries
 *   { sent: false, queued: true, status: "blocked_no_provider" }  no Resend/SMTP configured
 *
 * "Email configured" means ANY provider: Resend or SMTP (hasEmailProvider()).
 * The domain helpers (sendInvoiceEmail, …) keep their historic contract of throwing when the
 * message was not sent; the thrown EmailNotSentError carries the outbox result.
 */
import type { Invoice, Company } from "../../shared/schema";
import { createLogger } from "../config/logger";
import {
  deliverOutboxMessage,
  enqueueEmail,
  hasResendConfigLive,
  hasSmtpConfigLive,
  type OutboxResult,
  type OutgoingAttachment,
} from "../outbox";
import type { EmailOutboxStatus } from "../../shared/schema";

const logger = createLogger("email");

export interface SendEmailResult {
  /** True only when a provider accepted the message. */
  sent: boolean;
  /** True when the message is durably stored in the outbox. */
  queued: boolean;
  /** Outbox row id. */
  id?: string;
  status: EmailOutboxStatus | "not_queued";
  provider?: string;
  error?: string;
}

export interface SendEmailOptions {
  fromName?: string;
  /** Pre-rendered HTML body — caller MUST escape user input. */
  html?: string;
  attachments?: OutgoingAttachment[];
  companyId?: string | null;
  category?: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  idempotencyKey?: string | null;
  replyTo?: string | null;
  cc?: string | null;
  sensitive?: boolean;
  /** Default true: make the first delivery attempt before returning. */
  deliverNow?: boolean;
}

export class EmailNotSentError extends Error {
  constructor(public readonly result: SendEmailResult) {
    super(
      result.status === "blocked_no_provider"
        ? "Email is not configured: set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS"
        : `Email was not sent (${result.status})${result.error ? `: ${result.error}` : ""}`
    );
    this.name = "EmailNotSentError";
  }
}

// ─── HTML escaping for user-supplied values ───────────────────
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]!);
}

// ─── Provider detection (read live from the environment) ───────
export function hasSmtpConfig(): boolean {
  return hasSmtpConfigLive();
}

export function hasResendConfig(): boolean {
  return hasResendConfigLive();
}

/** The send gate: true when Resend OR SMTP is configured. */
export function hasEmailProvider(): boolean {
  return hasResendConfig() || hasSmtpConfig();
}

function formatCurrency(amount: number, currency = "AED"): string {
  return `${currency} ${Number(amount).toFixed(2)}`;
}

function formatDate(date: Date | string | null | undefined, locale = "en-AE"): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

/** Plain-text placeholder substitution for subjects (no HTML escaping; no line breaks). */
export function renderPlainTemplate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : `{{${key}}}`))
    .replace(/[\r\n]+/g, " ")
    .slice(0, 300);
}

// ─── Layout ───────────────────────────────────────────────────

export type EmailLanguage = "en" | "ar" | "bilingual";

export interface BilingualBlock {
  en: string;
  ar: string;
}

export interface BilingualEmailContent {
  heading: BilingualBlock;
  /** Already-escaped HTML paragraphs per language. */
  paragraphs: { en: string[]; ar: string[] };
  summary?: Array<{ label: BilingualBlock; value: string; strong?: boolean }>;
  button?: { url: string; label: BilingualBlock };
  brandName: string;
  footer?: string;
  accent?: string;
}

function section(dir: "ltr" | "rtl", lang: "en" | "ar", c: BilingualEmailContent): string {
  const align = dir === "rtl" ? "right" : "left";
  const paragraphs = c.paragraphs[lang]
    .map((p) => `<p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 14px;">${p}</p>`)
    .join("");
  const summary = c.summary?.length
    ? `<table width="100%" cellpadding="6" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;margin:8px 0 18px;">${c.summary
        .map(
          (row) =>
            `<tr><td style="color:#6B7280;font-size:13px;text-align:${align};">${escapeHtml(
              row.label[lang]
            )}</td><td dir="ltr" style="color:#111827;font-size:13px;text-align:${
              dir === "rtl" ? "left" : "right"
            };${row.strong ? "font-weight:bold;" : ""}">${escapeHtml(row.value)}</td></tr>`
        )
        .join("")}</table>`
    : "";
  const button = c.button
    ? `<p style="text-align:center;margin:18px 0;"><a href="${escapeHtml(
        c.button.url
      )}" style="display:inline-block;background:${
        c.accent ?? "#1E40AF"
      };color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 28px;border-radius:6px;">${escapeHtml(
        c.button.label[lang]
      )}</a></p>`
    : "";
  return `<div dir="${dir}" lang="${lang}" style="text-align:${align};">
  ${c.heading[lang] ? `<h2 style="margin:0 0 14px;color:#111827;font-size:18px;">${escapeHtml(c.heading[lang])}</h2>` : ""}
  ${paragraphs}${summary}${button}
</div>`;
}

/** English, Arabic (RTL) or both, in one accessible HTML email. */
export function renderBilingualEmail(c: BilingualEmailContent, language: EmailLanguage): string {
  const parts: string[] = [];
  if (language !== "ar") parts.push(section("ltr", "en", c));
  if (language === "bilingual")
    parts.push('<hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;">');
  if (language !== "en") parts.push(section("rtl", "ar", c));
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,'Noto Naskh Arabic',Tahoma,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:${c.accent ?? "#1E40AF"};padding:24px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">${escapeHtml(c.brandName)}</h1>
        </td></tr>
        <tr><td style="padding:28px 40px;">${parts.join("\n")}</td></tr>
        <tr><td style="background:#F9FAFB;padding:16px 40px;border-top:1px solid #E5E7EB;">
          <p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">${escapeHtml(
            c.footer ?? c.brandName
          )}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function wrapPlainTextInHtml(body: string, fromName?: string): string {
  return renderBilingualEmail(
    {
      heading: { en: "", ar: "" },
      paragraphs: { en: [escapeHtml(body).replace(/\n/g, "<br>")], ar: [] },
      brandName: fromName || "Muhasib.ai",
      footer: "Muhasib.ai",
    },
    "en"
  );
}

function companyFooter(company: Company): string {
  return [
    company.name,
    company.trnVatNumber ? `TRN: ${company.trnVatNumber}` : null,
    company.businessAddress,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ─── Core send ────────────────────────────────────────────────

function fromOutbox(r: OutboxResult): SendEmailResult {
  return {
    sent: r.status === "sent" || r.status === "delivered",
    queued: true,
    id: r.id,
    status: r.status,
    ...(r.provider ? { provider: r.provider } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

/**
 * Enqueue an email in the outbox and make the first delivery attempt. Never throws for a
 * provider problem; the result says what happened.
 *
 * @param body Plain-text body (auto-wrapped + escaped when options.html is absent)
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options?: SendEmailOptions
): Promise<SendEmailResult> {
  const html = options?.html ?? wrapPlainTextInHtml(body, options?.fromName);
  let queued: OutboxResult;
  try {
    queued = await enqueueEmail({
      to,
      subject,
      html,
      text: body,
      fromName: options?.fromName ?? null,
      companyId: options?.companyId ?? null,
      category: options?.category ?? "generic",
      relatedEntityType: options?.relatedEntityType ?? null,
      relatedEntityId: options?.relatedEntityId ?? null,
      attachments: options?.attachments ?? [],
      idempotencyKey: options?.idempotencyKey ?? null,
      replyTo: options?.replyTo ?? null,
      cc: options?.cc ?? null,
      sensitive: options?.sensitive === true,
    });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, "Could not enqueue email");
    return { sent: false, queued: false, status: "not_queued", error: (err as Error)?.message };
  }
  if (queued.duplicate || queued.status === "blocked_no_provider") {
    if (queued.status === "blocked_no_provider") {
      logger.warn({ outboxId: queued.id }, "No email provider configured — email queued, not sent");
    }
    return fromOutbox(queued);
  }
  if (options?.deliverNow === false) return fromOutbox(queued);
  const delivered = await deliverOutboxMessage(queued.id);
  return fromOutbox(delivered ?? queued);
}

async function sendOrThrow(
  to: string,
  subject: string,
  text: string,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  const result = await sendEmail(to, subject, text, options);
  if (!result.sent) throw new EmailNotSentError(result);
  return result;
}

// ─── Domain emails ────────────────────────────────────────────

export interface InvoiceEmailOptions {
  payUrl?: string | null;
  portalUrl?: string | null;
  einvoiceUrl?: string | null;
  language?: EmailLanguage;
  /** Throw EmailNotSentError when not sent (default true, the historic contract). */
  throwOnFailure?: boolean;
}

export function buildInvoiceEmail(
  invoice: Invoice,
  company: Company,
  message?: string,
  opts: InvoiceEmailOptions = {}
): { html: string; text: string } {
  const custom = message ? [escapeHtml(message).replace(/\n/g, "<br>")] : [];
  const html = renderBilingualEmail(
    {
      brandName: company.name,
      footer: companyFooter(company),
      heading: { en: `Invoice ${invoice.number}`, ar: `فاتورة رقم ${invoice.number}` },
      paragraphs: {
        en: [
          `Dear ${escapeHtml(invoice.customerName)},`,
          `Please find attached invoice <strong>${escapeHtml(invoice.number)}</strong> from <strong>${escapeHtml(company.name)}</strong>.`,
          ...custom,
          ...(company.contactEmail
            ? [`For any queries, please contact ${escapeHtml(company.contactEmail)}.`]
            : []),
        ],
        ar: [
          `عزيزنا ${escapeHtml(invoice.customerName)}،`,
          `تجدون مرفقاً الفاتورة رقم <strong>${escapeHtml(invoice.number)}</strong> من <strong>${escapeHtml(company.name)}</strong>.`,
          ...(company.contactEmail
            ? [`للاستفسارات يرجى التواصل عبر ${escapeHtml(company.contactEmail)}.`]
            : []),
        ],
      },
      summary: [
        { label: { en: "Invoice date", ar: "تاريخ الفاتورة" }, value: formatDate(invoice.date) },
        ...(invoice.dueDate
          ? [
              {
                label: { en: "Due date", ar: "تاريخ الاستحقاق" },
                value: formatDate(invoice.dueDate),
              },
            ]
          : []),
        {
          label: { en: "Total", ar: "الإجمالي" },
          value: formatCurrency(invoice.total, invoice.currency),
          strong: true,
        },
      ],
      ...(opts.payUrl
        ? { button: { url: opts.payUrl, label: { en: "Pay now", ar: "ادفع الآن" } } }
        : opts.portalUrl
          ? { button: { url: opts.portalUrl, label: { en: "View invoice", ar: "عرض الفاتورة" } } }
          : {}),
    },
    opts.language ?? "bilingual"
  );
  const text = [
    `Invoice ${invoice.number} from ${company.name}`,
    `Total: ${formatCurrency(invoice.total, invoice.currency)}`,
    invoice.dueDate ? `Due: ${formatDate(invoice.dueDate)}` : "",
    message ?? "",
    opts.payUrl ? `Pay online: ${opts.payUrl}` : "",
    opts.einvoiceUrl ? `E-invoice status: ${opts.einvoiceUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { html, text };
}

export async function sendInvoiceEmail(
  to: string,
  invoice: Invoice,
  company: Company,
  pdfBuffer: Buffer,
  subject?: string,
  message?: string,
  opts: InvoiceEmailOptions = {}
): Promise<SendEmailResult> {
  const { html, text } = buildInvoiceEmail(invoice, company, message, opts);
  const options: SendEmailOptions = {
    fromName: company.name,
    html,
    companyId: company.id,
    category: "invoice",
    relatedEntityType: "invoice",
    relatedEntityId: invoice.id,
    replyTo: company.contactEmail ?? null,
    attachments: [
      {
        filename: `invoice-${invoice.number}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  };
  const subj = subject || `Invoice ${invoice.number} from ${company.name}`;
  if (opts.throwOnFailure === false) return sendEmail(to, subj, text, options);
  return sendOrThrow(to, subj, text, options);
}

export interface ReminderEmailInput {
  invoice: Invoice;
  company: Company;
  customerName: string;
  openFils: number;
  level: number;
  daysOverdue: number;
  payUrl?: string | null;
  portalUrl?: string | null;
  language?: EmailLanguage;
  customSubject?: string | null;
  customTemplate?: string | null;
}

export function reminderTemplateVars(i: ReminderEmailInput): Record<string, string> {
  const vars: Record<string, string> = {
    customerName: i.customerName,
    invoiceNumber: i.invoice.number,
    amountDue: formatCurrency(i.openFils / 100, i.invoice.currency),
    total: formatCurrency(i.invoice.total, i.invoice.currency),
    dueDate: formatDate(i.invoice.dueDate),
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

/** Bilingual dunning email for one reminder level. */
export function buildReminderEmail(i: ReminderEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const overdue = i.daysOverdue > 0;
  const vars = reminderTemplateVars(i);
  const amount = vars.amountDue;
  const subject = i.customSubject
    ? renderPlainTemplate(i.customSubject, vars)
    : overdue
      ? `Overdue: invoice ${i.invoice.number} — ${amount} / فاتورة متأخرة`
      : `Payment reminder: invoice ${i.invoice.number} — ${amount} / تذكير بالدفع`;
  const enBody = i.customTemplate
    ? [renderTemplate(i.customTemplate, vars).replace(/\n/g, "<br>")]
    : [
        `Dear ${escapeHtml(i.customerName)},`,
        overdue
          ? `Invoice <strong>${escapeHtml(i.invoice.number)}</strong> was due on ${escapeHtml(vars.dueDate)} and is now ${escapeHtml(vars.daysOverdue)} day(s) overdue. The outstanding balance is <strong>${escapeHtml(amount)}</strong>.`
          : `This is a friendly reminder that invoice <strong>${escapeHtml(i.invoice.number)}</strong> for <strong>${escapeHtml(amount)}</strong> is due on ${escapeHtml(vars.dueDate)}.`,
        i.level > 1 ? `This is reminder ${i.level}.` : "",
        "If you have already paid, please disregard this message.",
      ].filter(Boolean);
  const arBody = [
    `عزيزنا ${escapeHtml(i.customerName)}،`,
    overdue
      ? `استحقت الفاتورة رقم <strong>${escapeHtml(i.invoice.number)}</strong> بتاريخ ${escapeHtml(formatDate(i.invoice.dueDate, "ar-AE"))} وهي متأخرة منذ ${escapeHtml(vars.daysOverdue)} يوماً. الرصيد المستحق <strong dir="ltr">${escapeHtml(amount)}</strong>.`
      : `نذكّركم بأن الفاتورة رقم <strong>${escapeHtml(i.invoice.number)}</strong> بمبلغ <strong dir="ltr">${escapeHtml(amount)}</strong> تستحق بتاريخ ${escapeHtml(formatDate(i.invoice.dueDate, "ar-AE"))}.`,
    i.level > 1 ? `هذا هو التذكير رقم ${i.level}.` : "",
    "إذا كنتم قد سددتم المبلغ فيرجى تجاهل هذه الرسالة.",
  ].filter(Boolean);
  const html = renderBilingualEmail(
    {
      brandName: i.company.name,
      footer: companyFooter(i.company),
      accent: overdue ? "#B91C1C" : "#1E40AF",
      heading: overdue
        ? { en: "Overdue invoice", ar: "فاتورة متأخرة السداد" }
        : { en: "Payment reminder", ar: "تذكير بالدفع" },
      paragraphs: { en: enBody, ar: arBody },
      summary: [
        { label: { en: "Invoice", ar: "الفاتورة" }, value: i.invoice.number },
        { label: { en: "Due date", ar: "تاريخ الاستحقاق" }, value: vars.dueDate },
        { label: { en: "Amount due", ar: "المبلغ المستحق" }, value: amount, strong: true },
      ],
      ...(vars.payLink
        ? {
            button: {
              url: vars.payLink,
              label: i.payUrl
                ? { en: "Pay now", ar: "ادفع الآن" }
                : { en: "View invoice", ar: "عرض الفاتورة" },
            },
          }
        : {}),
    },
    i.language ?? "bilingual"
  );
  const text = [
    `Invoice ${i.invoice.number}: ${amount} ${overdue ? `overdue by ${vars.daysOverdue} day(s)` : `due ${vars.dueDate}`}.`,
    vars.payLink ? `Pay / view: ${vars.payLink}` : "",
    `${i.company.name}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, html, text };
}

export async function sendPaymentReminderEmail(
  to: string,
  invoice: Invoice,
  company: Company,
  pdfBuffer: Buffer,
  reminderNumber: number,
  opts: { openFils?: number; payUrl?: string | null; throwOnFailure?: boolean } = {}
): Promise<SendEmailResult> {
  const today = new Date();
  const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
  const daysOverdue = due ? Math.floor((today.getTime() - due.getTime()) / 86_400_000) : 0;
  const { subject, html, text } = buildReminderEmail({
    invoice,
    company,
    customerName: invoice.customerName,
    openFils: opts.openFils ?? Math.round(Number(invoice.total) * 100),
    level: reminderNumber,
    daysOverdue,
    payUrl: opts.payUrl ?? null,
  });
  const options: SendEmailOptions = {
    fromName: company.name,
    html,
    companyId: company.id,
    category: "reminder",
    relatedEntityType: "invoice",
    relatedEntityId: invoice.id,
    replyTo: company.contactEmail ?? null,
    attachments: [
      {
        filename: `invoice-${invoice.number}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  };
  if (opts.throwOnFailure === false) return sendEmail(to, subject, text, options);
  return sendOrThrow(to, subject, text, options);
}

export async function sendGenericEmail(
  to: string,
  subject: string,
  body: string,
  fromName?: string
): Promise<SendEmailResult> {
  return sendOrThrow(to, subject, body, { fromName, category: "generic" });
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string
): Promise<SendEmailResult> {
  const safeUrl = escapeHtml(resetUrl);
  const html = renderBilingualEmail(
    {
      brandName: "Muhasib.ai",
      footer: "Muhasib.ai — Smart Accounting",
      heading: { en: "Reset your password", ar: "إعادة تعيين كلمة المرور" },
      paragraphs: {
        en: [
          "We received a request to reset your password. This link expires in 1 hour and can only be used once.",
          `If the button doesn't work, copy this link into your browser: <span style="word-break:break-all;">${safeUrl}</span>`,
          "If you didn't request this, you can safely ignore this email.",
        ],
        ar: [
          "تلقينا طلباً لإعادة تعيين كلمة المرور. تنتهي صلاحية الرابط خلال ساعة ويمكن استخدامه مرة واحدة.",
          "إذا لم تطلب ذلك فيمكنك تجاهل هذه الرسالة.",
        ],
      },
      button: { url: resetUrl, label: { en: "Reset password", ar: "إعادة التعيين" } },
    },
    "bilingual"
  );
  return sendOrThrow(to, "Reset your Muhasib.ai password", `Reset your password: ${resetUrl}`, {
    html,
    category: "auth",
    sensitive: true,
  });
}

export async function sendWelcomeEmail(
  to: string,
  name: string,
  companyName?: string
): Promise<SendEmailResult> {
  const html = renderBilingualEmail(
    {
      brandName: "Welcome to Muhasib.ai",
      footer: "Muhasib.ai — Smart Accounting for UAE Businesses",
      heading: { en: `Dear ${name},`, ar: `عزيزنا ${name}،` },
      paragraphs: {
        en: [
          companyName
            ? `Your account for <strong>${escapeHtml(companyName)}</strong> has been set up successfully.`
            : "Your account has been created successfully.",
          "You can now manage your invoices, track expenses, and stay VAT-compliant — all in one place.",
        ],
        ar: [
          "تم إنشاء حسابك بنجاح. يمكنك الآن إدارة الفواتير والمصروفات والالتزام بضريبة القيمة المضافة.",
        ],
      },
    },
    "bilingual"
  );
  return sendOrThrow(to, "Welcome to Muhasib.ai", "Welcome to Muhasib.ai", {
    html,
    category: "welcome",
  });
}
