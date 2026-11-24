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

export function renderPortalInviteEmail(input: PortalInviteEmailInput): BuiltEmail {
  const { company, contact, invitation, url, onlinePayment } = input;
  const language = normaliseInviteLanguage(invitation.language);
  const supplier = isolateInline(company.name);
  const product = isolateInline(PRODUCT_NAME, "ltr");
  // Greet a person, never the company: with no contact person the English greeting is generic.
  const greetName = (invitation.name || contact.contactPerson || "").trim();
  const note = invitation.message?.trim();
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
          greetName ? `Hi ${isolateInline(greetName)},` : "Hello,",
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
