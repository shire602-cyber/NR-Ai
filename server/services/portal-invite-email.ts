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
  contact: Pick<CustomerContact, "name" | "nameAr"> & { contactPerson?: string | null };
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
  // Greet a person, never the company: with no contact person the greeting stays generic.
  const greetName = (invitation.name || contact.contactPerson || "").trim();
  const customerAr = contact.nameAr?.trim() || contact.name;
  const note = invitation.message?.trim() || "";
  const quote = (text: string, dir: "ltr" | "rtl") =>
    `<span style="display:block;border-${dir === "rtl" ? "right" : "left"}:3px solid #D1D5DB;padding:4px 12px;color:#4B5563;" dir="auto">${e(text).replace(/\n/g, "<br>")}</span>`;

  const paragraphs = {
    en: [
      greetName ? `Hi ${e(greetName)},` : "Hello,",
      `${e(company.name)} uses Muhasib to share your invoices with you. Set a password to see every invoice and credit note issued to ${e(contact.name)}, download PDFs and your statement of account${onlinePayment ? ", and pay online" : ""}.`,
      ...(note ? [quote(note, "ltr")] : []),
      `This invitation expires on ${e(formatInviteDate(invitation.expiresAt, "en"))}.`,
      "If you didn't expect this email, you can safely ignore it.",
    ],
    ar: [
      greetName ? `مرحبًا <bdi>${e(greetName)}</bdi>،` : "مرحبًا بكم،",
      `تستخدم <bdi>${e(company.name)}</bdi> منصة محاسب لمشاركة فواتيرك معك. عيّن كلمة مرور لتطّلع على كل الفواتير والإشعارات الدائنة الصادرة باسم <bdi>${e(customerAr)}</bdi>، وتنزّل ملفات PDF وكشف حسابك${onlinePayment ? "، وتسدّد عبر الإنترنت" : ""}.`,
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
    greetName ? `Hi ${greetName},` : "Hello,",
    "",
    `${company.name} uses Muhasib to share your invoices with you. Set a password to see every invoice and credit note issued to ${contact.name}, download PDFs and your statement of account${onlinePayment ? ", and pay online" : ""}.`,
    ...(note ? ["", note] : []),
    "",
    `Set up your account: ${url}`,
    `This invitation expires on ${formatInviteDate(invitation.expiresAt, "en")}.`,
    "If you didn't expect this email, you can safely ignore it.",
  ].join("\n");
  const textAr = [
    greetName ? `مرحبًا ${greetName}،` : "مرحبًا بكم،",
    "",
    `تستخدم ${company.name} منصة محاسب لمشاركة فواتيرك معك. عيّن كلمة مرور لتطّلع على كل الفواتير والإشعارات الدائنة الصادرة باسم ${customerAr}، وتنزّل ملفات PDF وكشف حسابك${onlinePayment ? "، وتسدّد عبر الإنترنت" : ""}.`,
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
