/**
 * The customer-portal invitation email (STEP5). English, Arabic or both in one message; every
 * supplier-controlled string (company, customer, note) is escaped, and the subject can never
 * carry a line break. The link carries the token in the URL fragment, so it never reaches server
 * logs or a Referer header.
 */
import type { Company, CustomerContact, CustomerPortalInvitation } from "../../shared/schema";
import { marketingBrand as PRODUCT_NAME } from "../../shared/marketing-brand";
import {
  arabicGreeting,
  buildCustomerEmail,
  companyFooter,
  supplierEmailSubject,
  type BuiltEmail,
} from "./customer-emails";
import { escapeHtml, isolateInline, type EmailLanguage } from "./email-layout";

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

export function renderPortalInviteEmail(input: PortalInviteEmailInput): BuiltEmail {
  const { company, contact, invitation, url, onlinePayment } = input;
  const language = normaliseInviteLanguage(invitation.language);
  const supplier = isolateInline(company.name);
  const product = isolateInline(PRODUCT_NAME, "ltr");
  const greetName = (invitation.name || contact.name).trim();
  const note = invitation.message ? neutraliseInviteNote(invitation.message.trim()) : "";
  const quotedNote = note
    ? `<span dir="auto">${escapeHtml(note).replace(/\n/g, "<br>")}</span>`
    : null;

  return buildCustomerEmail(
    {
      heading: { en: "Your customer portal", ar: "بوابة العملاء الخاصة بك" },
      preheader: {
        en: `${company.name} invited you to view your invoices online.`,
        ar: `دعتك ${company.name} للاطلاع على فواتيرك عبر الإنترنت.`,
      },
      paragraphs: {
        en: [
          `Hi ${isolateInline(greetName)},`,
          `${supplier} uses ${product} to share your invoices. Set up your account to view invoices and credit notes, download PDFs, and access your statement of account.`,
          ...(onlinePayment ? ["You can also pay online when payment is available."] : []),
          ...(quotedNote ? [`<strong>Message from ${supplier}</strong><br>${quotedNote}`] : []),
          `This invitation expires on ${formatInviteDate(invitation.expiresAt, "en")}.`,
          "If you didn't expect this email, you can safely ignore it.",
        ],
        ar: [
          arabicGreeting({
            nameAr: invitation.name,
            name: contact.nameAr,
            companyNameAr: contact.name,
          }),
          `تستخدم ${supplier} منصة ${product} لمشاركة فواتيرك. أنشئ حسابك للاطلاع على الفواتير والإشعارات الدائنة وتنزيل ملفات PDF وعرض كشف حسابك.`,
          ...(onlinePayment ? ["يمكنك أيضًا السداد عبر الإنترنت عند توفر خيار الدفع."] : []),
          ...(quotedNote ? [`<strong>رسالة من ${supplier}</strong><br>${quotedNote}`] : []),
          `تنتهي صلاحية هذه الدعوة في ${formatInviteDate(invitation.expiresAt, "ar")}.`,
          "إذا لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.",
        ],
      },
      button: { url, label: { en: "Set up your account", ar: "أنشئ حسابك" } },
      brandName: company.name,
      footer: companyFooter(company),
      contactEmail: company.contactEmail,
    },
    language,
    supplierEmailSubject(company.name, language, (name) => ({
      en: `${name} invited you to view your invoices`,
      ar: `دعتك ${name} للاطلاع على فواتيرك`,
    }))
  );
}
