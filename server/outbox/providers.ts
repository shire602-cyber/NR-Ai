/**
 * Email transport adapters behind the outbox (W4-D, R16-08).
 *
 * Provider choice is read from process.env at call time (Resend preferred, then SMTP), so a
 * deployment that only configures Resend is a working email deployment. Tests inject a transport
 * with setEmailTransportOverride().
 *
 * A transport never decides status: it returns a provider message id or throws an
 * EmailTransportError (permanent = do not retry, e.g. a rejected recipient).
 */
import nodemailer from "nodemailer";
import { Resend } from "resend";

export type EmailProviderName = "resend" | "smtp" | "test";

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingEmail {
  outboxId: string;
  to: string;
  cc?: string | null;
  replyTo?: string | null;
  fromName?: string | null;
  subject: string;
  html: string;
  text?: string | null;
  attachments: OutgoingAttachment[];
}

export interface EmailTransport {
  name: EmailProviderName;
  send(message: OutgoingEmail): Promise<{ providerMessageId: string | null }>;
}

export class EmailTransportError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean
  ) {
    super(message);
    this.name = "EmailTransportError";
  }
}

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

export function hasResendConfigLive(): boolean {
  return !!env("RESEND_API_KEY");
}

export function hasSmtpConfigLive(): boolean {
  return !!(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

let override: EmailTransport | null = null;

/** Tests only: route every delivery through `transport` (null restores real providers). */
export function setEmailTransportOverride(transport: EmailTransport | null): void {
  override = transport;
}

export function activeProviderName(): EmailProviderName | null {
  if (override) return override.name;
  if (hasResendConfigLive()) return "resend";
  if (hasSmtpConfigLive()) return "smtp";
  return null;
}

function resendFrom(fromName?: string | null): string {
  const configured = env("RESEND_FROM");
  if (configured) return configured;
  const name = (fromName || "Muhasib.ai").replace(/[<>"\r\n]/g, "").slice(0, 80);
  return `${name} <noreply@muhasib.ai>`;
}

function smtpFrom(fromName?: string | null): string {
  const address = env("SMTP_FROM") || env("SMTP_USER") || "noreply@muhasib.ai";
  if (address.includes("<") || !fromName) return address;
  const name = fromName.replace(/[<>"\r\n]/g, "").slice(0, 80);
  return `"${name}" <${address}>`;
}

const resendTransport: EmailTransport = {
  name: "resend",
  async send(m) {
    const resend = new Resend(env("RESEND_API_KEY")!);
    const { data, error } = await resend.emails.send({
      from: resendFrom(m.fromName),
      to: m.to,
      ...(m.cc ? { cc: m.cc } : {}),
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      subject: m.subject,
      html: m.html,
      ...(m.text ? { text: m.text } : {}),
      headers: { "X-Muhasib-Outbox-Id": m.outboxId },
      attachments: m.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    if (error) {
      const status = (error as { statusCode?: number }).statusCode ?? 0;
      // 4xx other than rate limiting means the message itself was refused.
      const permanent = status >= 400 && status < 500 && status !== 429;
      throw new EmailTransportError(error.message || "Resend rejected the message", permanent);
    }
    return { providerMessageId: data?.id ?? null };
  },
};

const smtpTransport: EmailTransport = {
  name: "smtp",
  async send(m) {
    const port = Number(env("SMTP_PORT") ?? 587);
    const transporter = nodemailer.createTransport({
      host: env("SMTP_HOST")!,
      port,
      secure: port === 465,
      auth: { user: env("SMTP_USER")!, pass: env("SMTP_PASS")! },
    });
    const messageId = `<outbox-${m.outboxId}@muhasib.ai>`;
    try {
      const info = await transporter.sendMail({
        from: smtpFrom(m.fromName),
        to: m.to,
        ...(m.cc ? { cc: m.cc } : {}),
        ...(m.replyTo ? { replyTo: m.replyTo } : {}),
        subject: m.subject,
        html: m.html,
        ...(m.text ? { text: m.text } : {}),
        messageId,
        headers: { "X-Muhasib-Outbox-Id": m.outboxId },
        attachments: m.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      return { providerMessageId: info.messageId || messageId };
    } catch (err) {
      const e = err as { responseCode?: number; message?: string };
      const permanent = typeof e.responseCode === "number" && e.responseCode >= 500;
      throw new EmailTransportError(e.message || "SMTP send failed", permanent);
    }
  },
};

/** The transport to use now, or null when no provider is configured. */
export function resolveTransport(): EmailTransport | null {
  if (override) return override;
  if (hasResendConfigLive()) return resendTransport;
  if (hasSmtpConfigLive()) return smtpTransport;
  return null;
}
