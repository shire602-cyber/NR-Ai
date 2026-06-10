import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { Invoice, Company } from '../../shared/schema';
import { getEnv } from '../config/env';
import { createLogger } from '../config/logger';

const logger = createLogger('email');

export interface SendEmailResult {
  sent: boolean;
  provider?: 'resend' | 'smtp';
  error?: string;
}

// ─── HTML escaping for user-supplied values ───────────────────
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
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
  return env.SMTP_FROM || env.SMTP_USER || 'noreply@muhasib.ai';
}

function getResendFrom(fromName?: string): string {
  try {
    const env = getEnv();
    if (env.RESEND_FROM) return env.RESEND_FROM;
  } catch {}
  const name = fromName || 'NR Accounting';
  return `${escapeHtml(name)} <noreply@muhasib.ai>`;
}

function formatCurrency(amount: number, currency = 'AED'): string {
  return `${currency} ${amount.toFixed(2)}`;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-AE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ─── Generic plain-text → HTML wrapper ────────────────────────
function wrapPlainTextInHtml(body: string, fromName?: string): string {
  const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
  const safeFromName = escapeHtml(fromName || 'NR Accounting');
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
          <p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">NR Accounting Management System</p>
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

export async function sendInvoiceEmail(
  to: string,
  invoice: Invoice,
  company: Company,
  pdfBuffer: Buffer,
  subject?: string,
  message?: string
): Promise<void> {
  const transporter = createTransporter();
  const safeCompanyName = escapeHtml(company.name);
  const safeCustomerName = escapeHtml(invoice.customerName);
  const safeInvoiceNumber = escapeHtml(invoice.number);
  const safeContactEmail = escapeHtml(company.contactEmail || '');
  const safeTrn = escapeHtml(company.trnVatNumber || '');
  const safeAddress = escapeHtml(company.businessAddress || '');

  const invoiceSubject = subject || `Invoice ${invoice.number} from ${company.name}`;
  const customMessage = message
    ? `<p style="color:#374151;">${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr><td style="background:#1E40AF;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">${safeCompanyName}</h1>
          <p style="margin:8px 0 0;color:#BFDBFE;font-size:14px;">Tax Invoice</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <p style="color:#374151;font-size:16px;margin:0 0 16px;">Dear ${safeCustomerName},</p>
          <p style="color:#374151;font-size:14px;margin:0 0 24px;">
            Please find attached your invoice from <strong>${safeCompanyName}</strong>.
          </p>
          ${customMessage}
          <!-- Invoice Summary -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:6px;border:1px solid #E5E7EB;margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="4" cellspacing="0">
                <tr>
                  <td style="color:#6B7280;font-size:13px;">Invoice Number</td>
                  <td style="color:#111827;font-size:13px;font-weight:bold;text-align:right;">${safeInvoiceNumber}</td>
                </tr>
                <tr>
                  <td style="color:#6B7280;font-size:13px;">Invoice Date</td>
                  <td style="color:#111827;font-size:13px;text-align:right;">${formatDate(invoice.date)}</td>
                </tr>
                ${invoice.dueDate ? `<tr>
                  <td style="color:#6B7280;font-size:13px;">Due Date</td>
                  <td style="color:#DC2626;font-size:13px;font-weight:bold;text-align:right;">${formatDate(invoice.dueDate)}</td>
                </tr>` : ''}
                <tr>
                  <td style="color:#6B7280;font-size:13px;">Subtotal</td>
                  <td style="color:#111827;font-size:13px;text-align:right;">${formatCurrency(invoice.subtotal, invoice.currency)}</td>
                </tr>
                <tr>
                  <td style="color:#6B7280;font-size:13px;">VAT (5%)</td>
                  <td style="color:#111827;font-size:13px;text-align:right;">${formatCurrency(invoice.vatAmount, invoice.currency)}</td>
                </tr>
                <tr style="border-top:2px solid #E5E7EB;">
                  <td style="color:#111827;font-size:15px;font-weight:bold;padding-top:12px;">Total Due</td>
                  <td style="color:#1E40AF;font-size:15px;font-weight:bold;text-align:right;padding-top:12px;">${formatCurrency(invoice.total, invoice.currency)}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="color:#6B7280;font-size:13px;margin:0 0 8px;">
            The invoice PDF is attached to this email for your records.
          </p>
          ${company.contactEmail ? `<p style="color:#6B7280;font-size:13px;margin:0;">
            For any queries, please contact us at <a href="mailto:${safeContactEmail}" style="color:#1E40AF;">${safeContactEmail}</a>.
          </p>` : ''}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#F9FAFB;padding:20px 40px;border-top:1px solid #E5E7EB;">
          <p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">
            ${safeCompanyName}${company.trnVatNumber ? ` · TRN: ${safeTrn}` : ''}
            ${company.businessAddress ? ` · ${safeAddress}` : ''}
          </p>
          <p style="color:#9CA3AF;font-size:10px;margin:8px 0 0;text-align:center;">
            This is an automated email. Please do not reply directly to this message.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject: invoiceSubject,
    html,
    attachments: [
      {
        filename: `invoice-${invoice.number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

export async function sendPaymentReminderEmail(
  to: string,
  invoice: Invoice,
  company: Company,
  pdfBuffer: Buffer,
  reminderNumber: number
): Promise<void> {
  const transporter = createTransporter();
  const isOverdue = invoice.dueDate && new Date(invoice.dueDate) < new Date();
  const subject = isOverdue
    ? `Overdue Invoice Reminder: ${invoice.number} — ${formatCurrency(invoice.total, invoice.currency)}`
    : `Payment Reminder: Invoice ${invoice.number} Due ${invoice.dueDate ? formatDate(invoice.dueDate) : 'Soon'}`;

  const tone = reminderNumber === 1
    ? 'We hope this email finds you well. We wanted to gently remind you'
    : reminderNumber === 2
      ? 'We are following up regarding'
      : 'This is an important notice regarding';

  const safeCompanyName = escapeHtml(company.name);
  const safeCustomerName = escapeHtml(invoice.customerName);
  const safeInvoiceNumber = escapeHtml(invoice.number);
  const safeContactEmail = escapeHtml(company.contactEmail || '');
  const safeTrn = escapeHtml(company.trnVatNumber || '');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr><td style="background:${isOverdue ? '#DC2626' : '#1E40AF'};padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">${isOverdue ? 'Overdue Invoice Reminder' : 'Payment Reminder'}</h1>
          <p style="margin:8px 0 0;color:${isOverdue ? '#FCA5A5' : '#BFDBFE'};font-size:14px;">${safeCompanyName}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <p style="color:#374151;font-size:16px;margin:0 0 16px;">Dear ${safeCustomerName},</p>
          <p style="color:#374151;font-size:14px;margin:0 0 24px;">
            ${tone} that invoice <strong>${safeInvoiceNumber}</strong> for
            <strong>${formatCurrency(invoice.total, invoice.currency)}</strong>
            ${isOverdue ? 'is now overdue' : invoice.dueDate ? `is due on ${formatDate(invoice.dueDate)}` : 'is awaiting payment'}.
            ${reminderNumber > 1 ? ` This is reminder #${reminderNumber}.` : ''}
          </p>
          <!-- Invoice Summary -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#FEF2F2;border-radius:6px;border:1px solid ${isOverdue ? '#FECACA' : '#E5E7EB'};margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="4" cellspacing="0">
                <tr>
                  <td style="color:#6B7280;font-size:13px;">Invoice Number</td>
                  <td style="color:#111827;font-size:13px;font-weight:bold;text-align:right;">${safeInvoiceNumber}</td>
                </tr>
                <tr>
                  <td style="color:#6B7280;font-size:13px;">Invoice Date</td>
                  <td style="color:#111827;font-size:13px;text-align:right;">${formatDate(invoice.date)}</td>
                </tr>
                ${invoice.dueDate ? `<tr>
                  <td style="color:#6B7280;font-size:13px;">Due Date</td>
                  <td style="color:#DC2626;font-size:13px;font-weight:bold;text-align:right;">${formatDate(invoice.dueDate)}</td>
                </tr>` : ''}
                <tr style="border-top:2px solid #E5E7EB;">
                  <td style="color:#111827;font-size:15px;font-weight:bold;padding-top:12px;">Amount Due</td>
                  <td style="color:#DC2626;font-size:15px;font-weight:bold;text-align:right;padding-top:12px;">${formatCurrency(invoice.total, invoice.currency)}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="color:#374151;font-size:14px;margin:0 0 16px;">
            Please find the invoice attached. If you have already made this payment, please disregard this notice.
          </p>
          ${company.contactEmail ? `<p style="color:#6B7280;font-size:13px;margin:0;">
            If you have any questions, please contact us at <a href="mailto:${safeContactEmail}" style="color:#1E40AF;">${safeContactEmail}</a>.
          </p>` : ''}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#F9FAFB;padding:20px 40px;border-top:1px solid #E5E7EB;">
          <p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">
            ${safeCompanyName}${company.trnVatNumber ? ` · TRN: ${safeTrn}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject,
    html,
    attachments: [
      {
        filename: `invoice-${invoice.number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

export async function sendGenericEmail(
  to: string,
  subject: string,
  body: string,
  fromName?: string
): Promise<void> {
  const transporter = createTransporter();
  const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
  const safeFromName = escapeHtml(fromName || 'NR Accounting');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
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
          <p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">NR Accounting Management System</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject,
    html,
  });
}

export async function sendWelcomeEmail(to: string, name: string, companyName?: string): Promise<void> {
  const transporter = createTransporter();
  const safeName = escapeHtml(name);
  const safeCompanyName = escapeHtml(companyName || '');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#1E40AF;padding:32px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">Welcome to Muhasib.ai</h1>
          <p style="margin:8px 0 0;color:#BFDBFE;font-size:14px;">Your AI-powered accounting platform</p>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="color:#374151;font-size:16px;margin:0 0 16px;">Dear ${safeName},</p>
          <p style="color:#374151;font-size:14px;margin:0 0 16px;">
            Welcome to Muhasib.ai! ${companyName ? `Your account for <strong>${safeCompanyName}</strong> has been set up successfully.` : 'Your account has been created successfully.'}
          </p>
          <p style="color:#374151;font-size:14px;margin:0 0 24px;">
            You can now manage your invoices, track expenses, and stay VAT-compliant — all in one place.
          </p>
          <p style="color:#6B7280;font-size:13px;margin:0;">
            If you have any questions, our support team is here to help.
          </p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 40px;border-top:1px solid #E5E7EB;">
          <p style="color:#9CA3AF;font-size:11px;margin:0;text-align:center;">
            Muhasib.ai — Smart Accounting for UAE Businesses
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: getFromAddress(),
    to,
    subject: 'Welcome to Muhasib.ai',
    html,
  });
}

/**
 * Send an email via Resend (preferred) or SMTP fallback.
 * Gracefully degrades — returns { sent: false } if no provider is configured.
 *
 * @param to          Recipient email address
 * @param subject     Email subject line
 * @param body        Plain text body (auto-wrapped + escaped if html not provided)
 * @param options.fromName  Display name for the sender
 * @param options.html      Pre-rendered HTML body — caller MUST escape user input
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options?: { fromName?: string; html?: string }
): Promise<SendEmailResult> {
  const fromName = options?.fromName;
  const htmlBody = options?.html ?? wrapPlainTextInHtml(body, fromName);

  if (hasResendConfig()) {
    try {
      const env = getEnv();
      const resend = new Resend(env.RESEND_API_KEY!);
      await resend.emails.send({
        from: getResendFrom(fromName),
        to,
        subject,
        html: htmlBody,
        text: body,
      });
      logger.info(`Email sent via Resend to ${to}: "${subject}"`);
      return { sent: true, provider: 'resend' };
    } catch (err: any) {
      logger.error(`Resend send failed: ${err?.message}`);
      return { sent: false, provider: 'resend', error: err?.message };
    }
  }

  if (hasSmtpConfig()) {
    try {
      await sendGenericEmail(to, subject, body, fromName);
      logger.info(`Email sent via SMTP to ${to}: "${subject}"`);
      return { sent: true, provider: 'smtp' };
    } catch (err: any) {
      logger.error(`SMTP send failed: ${err?.message}`);
      return { sent: false, provider: 'smtp', error: err?.message };
    }
  }

  logger.warn('No email provider configured (RESEND_API_KEY or SMTP_HOST) — email saved to DB only');
  return { sent: false, error: 'No email provider configured — set RESEND_API_KEY or SMTP_HOST' };
}
