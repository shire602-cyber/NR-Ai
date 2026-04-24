import { Resend } from 'resend';
import { createLogger } from '../config/logger';
import { hasSmtpConfig, sendGenericEmail } from './email.service';
import { getEnv } from '../config/env';

const logger = createLogger('emailService');

export interface SendEmailResult {
  sent: boolean;
  provider?: 'resend' | 'smtp';
  error?: string;
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

function getResendFrom(fromName?: string): string {
  try {
    const env = getEnv();
    if (env.RESEND_FROM) return env.RESEND_FROM;
  } catch {}
  const name = fromName || 'NR Accounting';
  return `${name} <noreply@muhasib.ai>`;
}

function wrapPlainTextInHtml(body: string, fromName?: string): string {
  const safeBody = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#1E40AF;padding:24px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">${fromName || 'NR Accounting'}</h1>
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
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/**
 * Send an email via Resend (preferred) or SMTP fallback.
 * Gracefully degrades — returns { sent: false } if no provider is configured.
 *
 * @param to          Recipient email address
 * @param subject     Email subject line
 * @param body        Plain text body (auto-wrapped in HTML if html not provided)
 * @param options.fromName  Display name for the sender
 * @param options.html      Pre-rendered HTML body (overrides auto-wrap)
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
