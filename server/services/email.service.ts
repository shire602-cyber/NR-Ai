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

import {
  buildInvoiceEmail,
  buildPasswordResetEmail,
  buildReminderEmail,
  type InvoiceEmailOptions,
} from "./customer-emails";
import { escapeHtml, renderBilingualEmail, type EmailLanguage } from "./email-layout";

// The layout, formatters and templates live in email-layout.ts / customer-emails.ts; these
// re-exports keep the historic import path working.
export {
  escapeHtml,
  renderBilingualEmail,
  renderEmailText,
  type BilingualBlock,
  type BilingualEmailContent,
  type EmailLanguage,
} from "./email-layout";
export {
  buildApproverDoneEmail,
  buildApproverRequestEmail,
  buildInvoiceEmail,
  buildEmailVerificationEmail,
  buildPasswordResetEmail,
  buildPortalCodeEmail,
  buildQuoteEmail,
  buildReceiptEmail,
  buildReminderEmail,
  buildStatementEmail,
  renderPlainTemplate,
  renderTemplate,
  reminderTemplateVars,
  type InvoiceEmailOptions,
  type ReminderEmailInput,
} from "./customer-emails";

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

function wrapPlainTextInHtml(body: string, fromName?: string): string {
  return renderBilingualEmail(
    {
      heading: { en: "", ar: "" },
      paragraphs: { en: [escapeHtml(body).replace(/\n/g, "<br>")], ar: [] },
      brandName: fromName || "Muhasib.ai",
      footer: undefined,
    },
    "en"
  );
}

export function companyFooter(company: Company): string {
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
    const error = options?.sensitive ? "Could not store sensitive email" : (err as Error)?.message;
    logger.error({ err: error }, "Could not enqueue email");
    return { sent: false, queued: false, status: "not_queued", error };
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

export async function sendInvoiceEmail(
  to: string,
  invoice: Invoice,
  company: Company,
  pdfBuffer: Buffer,
  subject?: string,
  message?: string,
  opts: InvoiceEmailOptions = {}
): Promise<SendEmailResult> {
  const built = buildInvoiceEmail(invoice, company, message, opts);
  const options: SendEmailOptions = {
    fromName: company.name,
    html: built.html,
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
  const subj = subject || built.subject;
  if (opts.throwOnFailure === false) return sendEmail(to, subj, built.text, options);
  return sendOrThrow(to, subj, built.text, options);
}

export async function sendPaymentReminderEmail(
  to: string,
  invoice: Invoice,
  company: Company,
  pdfBuffer: Buffer,
  reminderNumber: number,
  opts: {
    openFils?: number;
    payUrl?: string | null;
    portalUrl?: string | null;
    language?: EmailLanguage;
    customerNameAr?: string | null;
    throwOnFailure?: boolean;
  } = {}
): Promise<SendEmailResult> {
  const today = new Date();
  const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
  const daysOverdue = due ? Math.floor((today.getTime() - due.getTime()) / 86_400_000) : 0;
  const { subject, html, text } = buildReminderEmail({
    invoice,
    company,
    customerName: invoice.customerName,
    customerNameAr: opts.customerNameAr ?? null,
    openFils: opts.openFils ?? Math.round(Number(invoice.total) * 100),
    level: reminderNumber,
    daysOverdue,
    payUrl: opts.payUrl ?? null,
    portalUrl: opts.portalUrl ?? null,
    ...(opts.language ? { language: opts.language } : {}),
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
  const built = buildPasswordResetEmail(resetUrl);
  return sendOrThrow(to, built.subject, built.text, {
    html: built.html,
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
