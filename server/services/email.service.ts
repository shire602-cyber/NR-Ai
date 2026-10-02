import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { Invoice, Company } from "../../shared/schema";
import { getEnv } from "../config/env";
import { createLogger } from "../config/logger";
import { AppError } from "../errors";
import {
  bilingualSubject,
  emailLanguages,
  formatEmailDate,
  htmlSections,
  localized,
  tx,
  EMAIL_TEXT,
  type EmailLocale,
} from "./email-i18n";

const logger = createLogger("email");

export type EmailProvider = "resend" | "smtp";

/** Typed outcome of every send path. Callers must look at `sent`. */
export interface SendEmailResult {
  sent: boolean;
  provider?: EmailProvider;
  /** Set when `sent` is false. */
  code?: "EMAIL_NOT_CONFIGURED" | "EMAIL_SEND_FAILED";
  error?: string;
}

export interface EmailStatus {
  configured: boolean;
  provider: EmailProvider | null;
}

export const EMAIL_NOT_CONFIGURED_MESSAGE =
  "Email is not configured on this server, so nothing was sent. Ask the administrator to set RESEND_API_KEY (or SMTP_HOST, SMTP_USER and SMTP_PASS).";

export class EmailNotConfiguredError extends AppError {
  constructor() {
    super({ message: EMAIL_NOT_CONFIGURED_MESSAGE, statusCode: 503, code: "EMAIL_NOT_CONFIGURED" });
  }
}

export class EmailSendFailedError extends AppError {
  constructor(detail?: string) {
    super({
      message: `The email could not be sent${detail ? `: ${detail}` : "."}`,
      statusCode: 502,
      code: "EMAIL_SEND_FAILED",
    });
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

// ─── Provider detection ───────────────────────────────────────
export function hasSmtpConfig(): boolean {
  try {
    const env = getEnv();
    return !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  } catch {
    return false;
  }
}

export function hasResendConfig(): boolean {
  try {
    return !!getEnv().RESEND_API_KEY;
  } catch {
    return false;
  }
}

export function hasEmailProvider(): boolean {
  return hasResendConfig() || hasSmtpConfig();
}

/** Single source of truth for "can this server send email, and through what". */
export function emailStatus(): EmailStatus {
  if (hasResendConfig()) return { configured: true, provider: "resend" };
  if (hasSmtpConfig()) return { configured: true, provider: "smtp" };
  return { configured: false, provider: null };
}

/** Features that silently do nothing without an email provider (startup WARN, docs). */
export function emailDisabledCapabilities(): string[] {
  return [
    "password reset emails",
    "invoice emailing",
    "payment reminder / chasing emails",
    "firm client emails and VAT reminders",
  ];
}

/**
 * For user-initiated sends: convert a failed result into a typed AppError so the
 * error handler answers 503 EMAIL_NOT_CONFIGURED (or 502 EMAIL_SEND_FAILED)
 * instead of the route reporting success.
 */
export function assertEmailSent(result: SendEmailResult): void {
  if (result.sent) return;
  if (result.code === "EMAIL_NOT_CONFIGURED") throw new EmailNotConfiguredError();
  throw new EmailSendFailedError(result.error);
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

/**
 * The one place mail leaves the process. Resend is preferred, SMTP is the
 * fallback, and with neither configured this returns EMAIL_NOT_CONFIGURED
 * rather than pretending. Never throws.
 */
async function deliver(msg: OutgoingEmail): Promise<SendEmailResult> {
  const { provider } = emailStatus();
  if (!provider) {
    logger.warn(`Email not sent (no provider configured): "${msg.subject}"`);
    return { sent: false, code: "EMAIL_NOT_CONFIGURED", error: EMAIL_NOT_CONFIGURED_MESSAGE };
  }

  try {
    if (provider === "resend") {
      const resend = new Resend(getEnv().RESEND_API_KEY!);
      const response: any = await resend.emails.send({
        from: getResendFrom(msg.fromName),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
        ...(msg.attachments
          ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content })) }
          : {}),
      });
      if (response?.error) {
        throw new Error(response.error.message || "Resend rejected the message");
      }
    } else {
      await createTransporter().sendMail({
        from: getFromAddress(),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
        ...(msg.attachments ? { attachments: msg.attachments } : {}),
      });
    }
    logger.info(`Email sent via ${provider}: "${msg.subject}"`);
    return { sent: true, provider };
  } catch (err: any) {
    logger.error({ err: err?.message, provider }, `Email send via ${provider} failed`);
    return { sent: false, provider, code: "EMAIL_SEND_FAILED", error: err?.message ?? "Send failed" };
  }
}

// ─── Transport / from-address helpers ─────────────────────────
function createTransporter() {
  const env = getEnv();
  return nodemailer.createTransport({
    host: env.SMTP_HOST!,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth: {
      user: env.SMTP_USER!,
      pass: env.SMTP_PASS!,
    },
  });
}

function getFromAddress(): string {
  const env = getEnv();
  return env.SMTP_FROM || env.SMTP_USER || "noreply@muhasib.ai";
}

function getResendFrom(fromName?: string): string {
  try {
    const env = getEnv();
    if (env.RESEND_FROM) return env.RESEND_FROM;
  } catch {}
  const name = fromName || "NR Accounting";
  return `${escapeHtml(name)} <noreply@muhasib.ai>`;
}

function formatCurrency(amount: number, currency = "AED"): string {
  return `${currency} ${amount.toFixed(2)}`;
}

// ─── Generic plain-text → HTML wrapper ────────────────────────
function wrapPlainTextInHtml(body: string, fromName?: string): string {
  const safeBody = escapeHtml(body).replace(/\n/g, "<br>");
  const safeFromName = escapeHtml(fromName || "NR Accounting");
  const footerText = bilingualSubject(EMAIL_TEXT.genericFooter);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#1E40AF;padding:24px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">${safeFromName}</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="color:#374151;font-size:14px;line-height:1.7;margin:0;">${safeBody}</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:16px 40px;border-top:1px solid #E5E7EB;">
          <p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">${footerText}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
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

// ─── Domain emails ────────────────────────────────────────────
//
// Every template is bilingual (Arabic block, then English; see email-i18n.ts). The builders are pure so they can be
// tested without a mail provider; the send functions only deliver what the builders return.

function emailShell(args: { headerBg: string; header: string; body: string; footer: string }): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:${args.headerBg};padding:32px 40px;">
          ${args.header}
        </td></tr>
        <tr><td style="padding:32px 40px;">
          ${args.body}
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 40px;border-top:1px solid #E5E7EB;">
          ${args.footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The value column sits at the far end of the row: right in English, left in Arabic (right-to-left). */
const endAlign = (lang: EmailLocale) => (lang === "ar" ? "left" : "right");

const summaryRow = (lang: EmailLocale, label: string, value: string, opts: { bold?: boolean; color?: string } = {}) => `<tr>
                  <td style="color:#6B7280;font-size:13px;">${label}</td>
                  <td style="color:${opts.color ?? "#111827"};font-size:13px;${opts.bold ? "font-weight:bold;" : ""}text-align:${endAlign(lang)};">${value}</td>
                </tr>`;

export interface BuiltEmail {
  subject: string;
  html: string;
}

export function buildInvoiceEmail(args: {
  invoice: Invoice;
  company: Company;
  subject?: string;
  message?: string;
  locale?: EmailLocale | null;
}): BuiltEmail {
  const { invoice, company, locale } = args;
  const safeCompanyName = escapeHtml(company.name);
  const safeCustomerName = escapeHtml(invoice.customerName);
  const safeInvoiceNumber = escapeHtml(invoice.number);
  const safeContactEmail = escapeHtml(company.contactEmail || "");
  const safeTrn = escapeHtml(company.trnVatNumber || "");
  const safeAddress = escapeHtml(company.businessAddress || "");

  const subject =
    args.subject ||
    bilingualSubject(localized("invoiceSubject", { number: invoice.number, company: company.name }), locale);
  const customMessage = args.message
    ? `<p style="color:#374151;">${escapeHtml(args.message).replace(/\n/g, "<br>")}</p>`
    : "";

  const section = (lang: EmailLocale) => `
          <p style="color:#374151;font-size:16px;margin:0 0 16px;">${tx("dear", lang, { name: safeCustomerName })}</p>
          <p style="color:#374151;font-size:14px;margin:0 0 24px;">${tx("invoiceAttached", lang, { company: safeCompanyName })}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:6px;border:1px solid #E5E7EB;margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="4" cellspacing="0">
                ${summaryRow(lang, tx("invoiceNumber", lang), safeInvoiceNumber, { bold: true })}
                ${summaryRow(lang, tx("invoiceDate", lang), formatEmailDate(invoice.date, lang))}
                ${invoice.dueDate ? summaryRow(lang, tx("dueDate", lang), formatEmailDate(invoice.dueDate, lang), { bold: true, color: "#DC2626" }) : ""}
                ${summaryRow(lang, tx("subtotal", lang), formatCurrency(invoice.subtotal, invoice.currency))}
                ${summaryRow(lang, tx("vat5", lang), formatCurrency(invoice.vatAmount, invoice.currency))}
                <tr style="border-top:2px solid #E5E7EB;">
                  <td style="color:#111827;font-size:15px;font-weight:bold;padding-top:12px;">${tx("totalDue", lang)}</td>
                  <td style="color:#1E40AF;font-size:15px;font-weight:bold;text-align:${endAlign(lang)};padding-top:12px;">${formatCurrency(invoice.total, invoice.currency)}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="color:#6B7280;font-size:13px;margin:0 0 8px;">${tx("pdfAttached", lang)}</p>
          ${
            company.contactEmail
              ? `<p style="color:#6B7280;font-size:13px;margin:0;">${tx("queries", lang, {
                  email: `<a href="mailto:${safeContactEmail}" style="color:#1E40AF;">${safeContactEmail}</a>`,
                })}</p>`
              : ""
          }`;

  const html = emailShell({
    headerBg: "#1E40AF",
    header: `<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">${safeCompanyName}</h1>
          <p style="margin:8px 0 0;color:#BFDBFE;font-size:14px;">${emailLanguages(locale).map((l) => tx("taxInvoice", l)).join(" | ")}</p>`,
    body: `${customMessage}${htmlSections(locale, section)}`,
    footer: `<p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">
            ${safeCompanyName}${company.trnVatNumber ? ` · ${emailLanguages(locale).map((l) => tx("trn", l)).join(" | ")}: ${safeTrn}` : ""}
            ${company.businessAddress ? ` · ${safeAddress}` : ""}
          </p>
          <p style="color:#9CA3AF;font-size:10px;margin:8px 0 0;text-align:center;">
            ${emailLanguages(locale).map((l) => tx("automated", l)).join("<br>")}
          </p>`,
  });
  return { subject, html };
}

export async function sendInvoiceEmail(
  to: string,
  invoice: Invoice,
  company: Company,
  pdfBuffer: Buffer,
  subject?: string,
  message?: string,
  locale?: EmailLocale | null
): Promise<SendEmailResult> {
  const built = buildInvoiceEmail({ invoice, company, subject, message, locale });
  return deliver({
    to,
    subject: built.subject,
    html: built.html,
    fromName: company.name,
    attachments: [
      {
        filename: `invoice-${invoice.number}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}

export function buildPaymentReminderEmail(args: {
  invoice: Invoice;
  company: Company;
  reminderNumber: number;
  locale?: EmailLocale | null;
  now?: Date;
}): BuiltEmail {
  const { invoice, company, reminderNumber, locale } = args;
  const isOverdue = !!invoice.dueDate && new Date(invoice.dueDate) < (args.now ?? new Date());
  const amount = formatCurrency(invoice.total, invoice.currency);
  const subject = isOverdue
    ? bilingualSubject(localized("reminderOverdueSubject", { number: invoice.number, amount }), locale)
    : bilingualSubject(
        {
          en: tx("reminderSubject", "en", { number: invoice.number, due: invoice.dueDate ? formatEmailDate(invoice.dueDate, "en") : tx("soon", "en") }),
          ar: tx("reminderSubject", "ar", { number: invoice.number, due: invoice.dueDate ? formatEmailDate(invoice.dueDate, "ar") : tx("soon", "ar") }),
        },
        locale
      );
  const toneKey = reminderNumber === 1 ? "tone1" : reminderNumber === 2 ? "tone2" : "tone3";

  const safeCompanyName = escapeHtml(company.name);
  const safeCustomerName = escapeHtml(invoice.customerName);
  const safeInvoiceNumber = escapeHtml(invoice.number);
  const safeContactEmail = escapeHtml(company.contactEmail || "");
  const safeTrn = escapeHtml(company.trnVatNumber || "");

  const section = (lang: EmailLocale) => {
    const state = isOverdue
      ? tx("stateOverdue", lang)
      : invoice.dueDate
        ? tx("stateDueOn", lang, { date: formatEmailDate(invoice.dueDate, lang) })
        : tx("stateAwaiting", lang);
    return `
          <p style="color:#374151;font-size:16px;margin:0 0 16px;">${tx("dear", lang, { name: safeCustomerName })}</p>
          <p style="color:#374151;font-size:14px;margin:0 0 24px;">
            ${tx("reminderBody", lang, {
              tone: tx(toneKey, lang),
              number: safeInvoiceNumber,
              amount,
              state,
              count: reminderNumber > 1 ? tx("reminderCount", lang, { n: reminderNumber }) : "",
            })}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#FEF2F2;border-radius:6px;border:1px solid ${isOverdue ? "#FECACA" : "#E5E7EB"};margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="4" cellspacing="0">
                ${summaryRow(lang, tx("invoiceNumber", lang), safeInvoiceNumber, { bold: true })}
                ${summaryRow(lang, tx("invoiceDate", lang), formatEmailDate(invoice.date, lang))}
                ${invoice.dueDate ? summaryRow(lang, tx("dueDate", lang), formatEmailDate(invoice.dueDate, lang), { bold: true, color: "#DC2626" }) : ""}
                <tr style="border-top:2px solid #E5E7EB;">
                  <td style="color:#111827;font-size:15px;font-weight:bold;padding-top:12px;">${tx("amountDue", lang)}</td>
                  <td style="color:#DC2626;font-size:15px;font-weight:bold;text-align:${endAlign(lang)};padding-top:12px;">${amount}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="color:#374151;font-size:14px;margin:0 0 16px;">${tx("reminderDisregard", lang)}</p>
          ${
            company.contactEmail
              ? `<p style="color:#6B7280;font-size:13px;margin:0;">${tx("reminderQuestions", lang, {
                  email: `<a href="mailto:${safeContactEmail}" style="color:#1E40AF;">${safeContactEmail}</a>`,
                })}</p>`
              : ""
          }`;
  };

  const titleKey = isOverdue ? "reminderOverdueTitle" : "reminderTitle";
  const html = emailShell({
    headerBg: isOverdue ? "#DC2626" : "#1E40AF",
    header: `<h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">${emailLanguages(locale).map((l) => tx(titleKey, l)).join(" | ")}</h1>
          <p style="margin:8px 0 0;color:${isOverdue ? "#FCA5A5" : "#BFDBFE"};font-size:14px;">${safeCompanyName}</p>`,
    body: htmlSections(locale, section),
    footer: `<p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">
            ${safeCompanyName}${company.trnVatNumber ? ` · ${emailLanguages(locale).map((l) => tx("trn", l)).join(" | ")}: ${safeTrn}` : ""}
          </p>`,
  });
  return { subject, html };
}

export async function sendPaymentReminderEmail(
  to: string,
  invoice: Invoice,
  company: Company,
  pdfBuffer: Buffer,
  reminderNumber: number,
  locale?: EmailLocale | null
): Promise<SendEmailResult> {
  const built = buildPaymentReminderEmail({ invoice, company, reminderNumber, locale });
  return deliver({
    to,
    subject: built.subject,
    html: built.html,
    fromName: company.name,
    attachments: [
      {
        filename: `invoice-${invoice.number}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}

export async function sendGenericEmail(
  to: string,
  subject: string,
  body: string,
  fromName?: string
): Promise<SendEmailResult> {
  return deliver({ to, subject, html: wrapPlainTextInHtml(body, fromName), text: body, fromName });
}

export function buildPasswordResetEmail(resetUrl: string, locale?: EmailLocale | null): BuiltEmail {
  // Token is server-generated hex appended to a config URL; escape anyway so
  // a misconfigured base URL can never inject markup.
  const safeUrl = escapeHtml(resetUrl);
  const section = (lang: EmailLocale) => `
          <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">${tx("resetBody", lang)}</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="${safeUrl}" style="display:inline-block;background:#1E40AF;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 28px;border-radius:6px;">${tx("resetButton", lang)}</a>
          </p>
          <p style="color:#6B7280;font-size:12px;line-height:1.6;margin:0 0 8px;">${tx("resetCopy", lang)}</p>
          <p dir="ltr" style="color:#1E40AF;font-size:12px;word-break:break-all;margin:0 0 16px;text-align:left;">${safeUrl}</p>
          <p style="color:#6B7280;font-size:12px;line-height:1.6;margin:0;">${tx("resetIgnore", lang)}</p>`;
  const html = emailShell({
    headerBg: "#1E40AF",
    header: `<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">Muhasib.ai</h1>`,
    body: htmlSections(locale, section),
    footer: `<p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">${emailLanguages(locale).map((l) => tx("resetFooter", l)).join("<br>")}</p>`,
  });
  return { subject: bilingualSubject(localized("resetSubject"), locale), html };
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, locale?: EmailLocale | null): Promise<SendEmailResult> {
  const built = buildPasswordResetEmail(resetUrl, locale);
  return deliver({ to, subject: built.subject, html: built.html });
}

export function buildWelcomeEmail(name: string, companyName?: string, locale?: EmailLocale | null): BuiltEmail {
  const safeName = escapeHtml(name);
  const safeCompanyName = escapeHtml(companyName || "");
  const section = (lang: EmailLocale) => `
          <p style="color:#374151;font-size:16px;margin:0 0 16px;">${tx("dear", lang, { name: safeName })}</p>
          <p style="color:#374151;font-size:14px;margin:0 0 16px;">${tx("welcomeIntro", lang, {
            setup: companyName ? tx("welcomeSetupCompany", lang, { company: safeCompanyName }) : tx("welcomeSetup", lang),
          })}</p>
          <p style="color:#374151;font-size:14px;margin:0 0 24px;">${tx("welcomeUse", lang)}</p>
          <p style="color:#6B7280;font-size:13px;margin:0;">${tx("welcomeHelp", lang)}</p>`;
  const html = emailShell({
    headerBg: "#1E40AF",
    header: `<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">${emailLanguages(locale).map((l) => tx("welcomeSubject", l)).join(" | ")}</h1>
          <p style="margin:8px 0 0;color:#BFDBFE;font-size:14px;">${emailLanguages(locale).map((l) => tx("welcomeTagline", l)).join(" | ")}</p>`,
    body: htmlSections(locale, section),
    footer: `<p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">${emailLanguages(locale).map((l) => tx("welcomeFooter", l)).join("<br>")}</p>`,
  });
  return { subject: bilingualSubject(localized("welcomeSubject"), locale), html };
}

export async function sendWelcomeEmail(
  to: string,
  name: string,
  companyName?: string,
  locale?: EmailLocale | null
): Promise<SendEmailResult> {
  const built = buildWelcomeEmail(name, companyName, locale);
  return deliver({ to, subject: built.subject, html: built.html });
}

/**
 * Send a plain-text email via Resend (preferred) or SMTP fallback.
 * Returns a typed result and never throws: { sent: false, code } when no
 * provider is configured (EMAIL_NOT_CONFIGURED) or the provider rejects it
 * (EMAIL_SEND_FAILED). User-initiated callers should pass the result to
 * assertEmailSent() so the user sees the failure.
 *
 * @param to          Recipient email address
 * @param subject     Email subject line
 * @param body        Plain text body (auto-wrapped + escaped if html not provided)
 * @param options.fromName  Display name for the sender
 * @param options.html      Pre-rendered HTML body - caller MUST escape user input
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options?: { fromName?: string; html?: string }
): Promise<SendEmailResult> {
  const fromName = options?.fromName;
  return deliver({
    to,
    subject,
    html: options?.html ?? wrapPlainTextInHtml(body, fromName),
    text: body,
    fromName,
  });
}

/** A customer statement of account as a PDF attachment. Never throws; check `sent`. */
export async function sendStatementEmail(args: {
  to: string;
  subject: string;
  message: string;
  fromName?: string;
  pdf: Buffer;
  filename: string;
}): Promise<SendEmailResult> {
  return deliver({
    to: args.to,
    subject: args.subject,
    html: wrapPlainTextInHtml(args.message, args.fromName),
    text: args.message,
    fromName: args.fromName,
    attachments: [{ filename: args.filename, content: args.pdf, contentType: "application/pdf" }],
  });
}

/** A scheduled report (PDF, CSV or XLSX) as an attachment (Phase 8 D4). Never throws; check `sent`. */
export async function sendReportEmail(args: {
  to: string;
  subject: string;
  message: string;
  fromName?: string;
  file: Buffer;
  filename: string;
  contentType: string;
}): Promise<SendEmailResult> {
  return deliver({
    to: args.to,
    subject: args.subject,
    html: wrapPlainTextInHtml(args.message, args.fromName),
    text: args.message,
    fromName: args.fromName,
    attachments: [{ filename: args.filename, content: args.file, contentType: args.contentType }],
  });
}
