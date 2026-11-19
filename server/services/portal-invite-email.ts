/**
 * The customer-portal invitation email (STEP5). English, Arabic or both in one message; every
 * supplier-controlled string (company, customer, note) is escaped, and the subject can never
 * carry a line break. The link carries the token in the URL fragment, so it never reaches server
 * logs or a Referer header.
 */
import type { Company, CustomerContact, CustomerPortalInvitation } from "../../shared/schema";
import {
  companyFooter,
  escapeHtml,
  renderBilingualEmail,
  renderPlainTemplate,
  type EmailLanguage,
} from "./email.service";

export interface PortalInviteEmailInput {
  company: Pick<Company, "name" | "trnVatNumber" | "businessAddress" | "contactEmail">;
  contact: Pick<CustomerContact, "name" | "nameAr">;
  invitation: Pick<CustomerPortalInvitation, "language" | "name" | "message" | "expiresAt">;
  url: string;
  onlinePayment: boolean;
}

/** Gregorian date with Latin digits, matching the app, in the reader's language. */
export function formatInviteDate(date: Date, lang: "en" | "ar"): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn-ca-gregory" : "en-AE", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Dubai",
  }).format(date);
}

/**
 * S5-SEC-4: the personal note is plain text from the sender. Anything a mail client would turn into
 * a link or an address (scheme URLs, www. hosts, bare domains, email addresses) is replaced, so the
 * note cannot carry a phishing link in a message that arrives from the platform.
 */
export function neutraliseInviteNote(note: string): string {
  return (
    note
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2060\ufeff]/g, "")
      .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/g, "[link removed]")
      .replace(/\b(?:mailto|tel|javascript|data):\S*/gi, "[link removed]")
      .replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g, "[link removed]")
      .replace(/\bwww\.\S*/gi, "[link removed]")
      .replace(/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/\S*)?/g, "[link removed]")
  );
}

export function normaliseInviteLanguage(value: string | null | undefined): EmailLanguage {
  return value === "ar" || value === "bilingual" ? value : "en";
}

export function renderPortalInviteEmail(input: PortalInviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { company, contact, invitation, url, onlinePayment } = input;
  const language = normaliseInviteLanguage(invitation.language);
  const e = escapeHtml;
  const greetName = (invitation.name || contact.name).trim();
  const customerAr = contact.nameAr?.trim() || contact.name;
  const note = neutraliseInviteNote(invitation.message?.trim() || "");
  const quote = (text: string, dir: "ltr" | "rtl") =>
    `<span style="display:block;border-${dir === "rtl" ? "right" : "left"}:3px solid #D1D5DB;padding:4px 12px;color:#4B5563;" dir="auto">${e(text).replace(/\n/g, "<br>")}</span>`;

  const paragraphs = {
    en: [
      `Hi ${e(greetName)},`,
      `${e(company.name)} uses Muhasib to share your invoices with you. Set a password to see every invoice and credit note issued to ${e(contact.name)}, download PDFs and your statement of account${onlinePayment ? ", and pay online" : ""}.`,
      ...(note ? [quote(note, "ltr")] : []),
      `This invitation expires on ${e(formatInviteDate(invitation.expiresAt, "en"))}.`,
      "If you didn't expect this email, you can safely ignore it.",
    ],
    ar: [
      `مرحبًا ${e(greetName)}،`,
      `تستخدم ${e(company.name)} منصة محاسب لمشاركة فواتيرك معك. عيّن كلمة مرور لتطّلع على كل الفواتير والإشعارات الدائنة الصادرة باسم ${e(customerAr)}، وتنزّل ملفات PDF وكشف حسابك${onlinePayment ? "، وتسدّد عبر الإنترنت" : ""}.`,
      ...(note ? [quote(note, "rtl")] : []),
      `تنتهي صلاحية هذه الدعوة في ${e(formatInviteDate(invitation.expiresAt, "ar"))}.`,
      "إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.",
    ],
  };

  const html = renderBilingualEmail(
    {
      heading: { en: "Your customer portal", ar: "بوابة العملاء الخاصة بك" },
      paragraphs,
      button: { url, label: { en: "Set up your account", ar: "أنشئ حسابك" } },
      brandName: company.name,
      footer: [
        companyFooter(company as Company),
        company.contactEmail ? company.contactEmail : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
    language
  );

  const subjects = {
    en: renderPlainTemplate("{{company}} invited you to view your invoices", {
      company: company.name,
    }),
    ar: renderPlainTemplate("دعتك {{company}} للاطلاع على فواتيرك", { company: company.name }),
  };
  const subject =
    language === "ar"
      ? subjects.ar
      : language === "bilingual"
        ? `${subjects.en} | ${subjects.ar}`
        : subjects.en;

  const textEn = [
    `Hi ${greetName},`,
    "",
    `${company.name} uses Muhasib to share your invoices with you. Set a password to see every invoice and credit note issued to ${contact.name}.`,
    ...(note ? ["", note] : []),
    "",
    `Set up your account: ${url}`,
    `This invitation expires on ${formatInviteDate(invitation.expiresAt, "en")}.`,
    "If you didn't expect this email, you can safely ignore it.",
  ].join("\n");
  const textAr = [
    `مرحبًا ${greetName}،`,
    "",
    `تستخدم ${company.name} منصة محاسب لمشاركة فواتيرك معك. عيّن كلمة مرور لتطّلع على كل الفواتير الصادرة باسم ${customerAr}.`,
    ...(note ? ["", note] : []),
    "",
    `أنشئ حسابك: ${url}`,
    `تنتهي صلاحية هذه الدعوة في ${formatInviteDate(invitation.expiresAt, "ar")}.`,
    "إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.",
  ].join("\n");
  const text =
    language === "ar"
      ? textAr
      : language === "bilingual"
        ? `${textEn}\n\n----\n\n${textAr}`
        : textEn;

  return { subject, html, text };
}
