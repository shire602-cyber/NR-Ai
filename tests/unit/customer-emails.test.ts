/**
 * Customer e-mail templates (invoice, reminder, receipt, quote, statement, portal code,
 * EmaraTax approver, password reset): English, Arabic and bilingual output of the pure builders.
 */
import { describe, expect, it } from "vitest";
import type { Company, Invoice } from "../../shared/schema";
import {
  buildApproverDoneEmail,
  buildApproverRequestEmail,
  buildInvoiceEmail,
  buildPasswordResetEmail,
  buildPortalCodeEmail,
  buildQuoteEmail,
  buildReceiptEmail,
  buildReminderEmail,
  buildStatementEmail,
  arabicDays,
  type BuiltEmail,
} from "../../server/services/customer-emails";
import {
  emailDate,
  emailMoney,
  htmlToText,
  renderBilingualEmail,
  resolveEmailLanguage,
  type EmailLanguage,
} from "../../server/services/email-layout";
import { formatMoneyText } from "../../client/src/lib/format-money";

const company = {
  id: "c1",
  name: "Al Noor Trading LLC",
  trnVatNumber: "100123456700003",
  businessAddress: "Business Bay, Dubai",
  contactEmail: "billing@alnoor.example",
} as unknown as Company;

const invoice = {
  id: "i1",
  number: "INV-2026-00002",
  customerName: "Desert Rose Catering",
  date: "2026-11-08",
  dueDate: "2026-12-08",
  currency: "AED",
  total: 3886.05,
} as unknown as Invoice;

const PAY = "https://app.muhasib.example/view/invoice/abc123";
const LANGS: EmailLanguage[] = ["en", "ar", "bilingual"];

/** The Arabic section's visible text (HTML tags and entities removed). */
function arabicText(html: string): string {
  const start = html.indexOf('<div dir="rtl" lang="ar"');
  const rest = start < 0 ? "" : html.slice(html.indexOf(">", start));
  const end = rest.search(/<\/td>\s*<\/tr>\s*<tr><td class="em-pad" style="background:#F9FAFB/);
  return htmlToText(end < 0 ? rest : rest.slice(0, end));
}

/** Words that may stay Latin inside Arabic copy: names, numbers, brand, addresses, URLs. */
function stripAllowedLatin(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\S+@\S+/g, "")
    .replace(/Al Noor Trading LLC|Desert Rose Catering|Business Bay, Dubai|Muhasib\.ai/g, "")
    .replace(/INV-\d{4}-\d+|QT-\d{4}-\d+/g, "")
    .replace(/\bAED\b/g, "");
}

function expectShell(e: BuiltEmail, language: EmailLanguage) {
  expect(e.html).toMatch(/^<!DOCTYPE html>/);
  expect(e.html).toContain(
    `<html lang="${language === "ar" ? "ar" : "en"}" dir="${language === "ar" ? "rtl" : "ltr"}"`
  );
  expect(e.html).toContain('name="viewport"');
  expect(e.html).toContain("<title>");
  // A hidden preheader, and a fluid (not fixed 600px) card.
  expect(e.html).toMatch(/display:none;max-height:0;overflow:hidden/);
  expect(e.html).toContain("max-width:600px");
  // Only the Outlook ghost table (inside a conditional comment) has a fixed width.
  expect(e.html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, "")).not.toMatch(/width="600"/);
  if (language !== "ar") expect(e.html).toContain('<div dir="ltr" lang="en"');
  if (language !== "en") expect(e.html).toContain('<div dir="rtl" lang="ar"');
  if (language === "en") expect(e.html).not.toContain('lang="ar"');
  if (language === "ar") expect(e.html).not.toContain('lang="en"');
  expect(e.text.length).toBeGreaterThan(20);
  expect(e.subject).not.toMatch(/[\r\n]/);
}

describe("layout and formatters", () => {
  it("formats money and dates by the app's rules (Latin digits, د.إ in Arabic)", () => {
    expect(emailMoney(1250, "AED").en).toBe("AED \u2066" + "1,250.00\u2069");
    expect(emailMoney(1250, "AED").ar).toContain("د.إ");
    expect(emailMoney(1250, "AED").ar).toContain("1,250.00");
    expect(emailMoney(1250, "USD").ar).toContain("USD");
    expect(emailMoney(3886.05, "AED").en).toBe(formatMoneyText(3886.05, "AED", "en"));
    expect(emailDate("2026-11-16", "en")).toBe("16 Nov 2026");
    expect(emailDate("2026-11-16", "ar")).toBe("16 نوفمبر 2026");
    expect(emailDate(null)).toBe("—");
    // No Arabic-Indic digits anywhere.
    expect(emailDate("2026-11-16", "ar")).not.toMatch(/[٠-٩]/);
    expect(emailMoney(1234567.5, "AED").ar).not.toMatch(/[٠-٩]/);
  });

  it("resolves the language: explicit, then the customer's own, then both", () => {
    expect(resolveEmailLanguage("ar", "en")).toBe("ar");
    expect(resolveEmailLanguage(null, "ar")).toBe("ar");
    expect(resolveEmailLanguage(undefined, "fr")).toBe("bilingual");
    expect(resolveEmailLanguage()).toBe("bilingual");
    // The company's language no longer changes the rule (an Arabic company is still bilingual).
    expect(resolveEmailLanguage(null, null)).toBe("bilingual");
    expect(resolveEmailLanguage(null, "en")).toBe("en");
  });

  it("subjects and plain text carry no bidi control characters", () => {
    const e = buildReminderEmail({
      invoice,
      company,
      customerName: "X",
      openFils: 388605,
      level: 1,
      daysOverdue: 5,
      language: "bilingual",
    });
    expect(e.subject).not.toMatch(/[\u2066-\u2069]/);
    expect(e.text).not.toMatch(/[\u2066-\u2069]/);
    expect(e.subject).toContain("3,886.05 د.إ");
    // The HTML keeps the isolates so the figure stays in order inside Arabic text.
    expect(e.html).toMatch(/[\u2066-\u2069]/);
  });

  it("counts days in natural Arabic", () => {
    expect(arabicDays(1)).toBe("يوم واحد");
    expect(arabicDays(2)).toBe("يومين");
    expect(arabicDays(5)).toBe("5 أيام");
    expect(arabicDays(30)).toBe("30 يوماً");
  });

  it("escapes brand, values and the button URL (no markup injection)", () => {
    const html = renderBilingualEmail(
      {
        brandName: '<img src=x onerror="1">',
        heading: { en: "<b>h</b>", ar: "<b>ع</b>" },
        paragraphs: { en: ["ok"], ar: ["حسناً"] },
        summary: [{ label: { en: "<l>", ar: "<l>" }, value: "<v>" }],
        button: { url: 'https://x.example/"><script>', label: { en: "<go>", ar: "<go>" } },
        footer: "<f>",
      },
      "bilingual"
    );
    expect(html).not.toMatch(/<img |<script|<b>h|<l>|<v>|<go>|<f>/);
  });
});

describe.each(LANGS)("invoice email (%s)", (language) => {
  const e = buildInvoiceEmail(invoice, company, "Thank you for your business.\nSee you soon.", {
    payUrl: PAY,
    language,
  });

  it("has the responsive shell, language attributes and a preheader", () => {
    expectShell(e, language);
    expect(e.html).toMatch(/INV-2026-00002/);
  });

  it("uses the app's money and date format and links to the pay page", () => {
    if (language !== "ar") {
      expect(e.html).toContain("AED");
      expect(e.html).toContain("3,886.05");
      expect(e.html).toContain("8 Dec 2026");
    }
    if (language !== "en") {
      expect(e.html).toContain("د.إ");
      expect(e.html).toContain("8 ديسمبر 2026");
    }
    expect(e.html).toContain(`href="${PAY}"`);
    expect(e.text).toContain(PAY);
  });

  it("subject and plain-text follow the language", () => {
    if (language === "en") {
      expect(e.subject).toBe("Invoice INV-2026-00002 from Al Noor Trading LLC");
      expect(e.text).not.toMatch(/[؀-ۿ]/);
    } else if (language === "ar") {
      expect(e.subject).toBe("فاتورة رقم INV-2026-00002 من Al Noor Trading LLC");
      expect(stripAllowedLatin(e.text)).not.toMatch(/[A-Za-z]{3,}/);
    } else {
      expect(e.subject).toContain(" | ");
      expect(e.subject).toMatch(/[؀-ۿ]/);
      expect(e.text).toContain("---");
    }
  });

  it("never prints the seller TRN or the customer's message in Arabic", () => {
    expect(e.html).not.toContain("100123456700003");
    expect(e.text).not.toContain("100123456700003");
    expect(e.html).toContain("Business Bay, Dubai");
    expect(e.html).toContain("billing@alnoor.example");
  });
});

describe("invoice email details", () => {
  it("Arabic copy has no leaked English words", () => {
    const e = buildInvoiceEmail(invoice, company, undefined, { portalUrl: PAY, language: "ar" });
    const text = stripAllowedLatin(arabicText(e.html));
    expect(text).not.toMatch(/[A-Za-z]{3,}/);
    expect(e.html).toContain("عرض الفاتورة");
    expect(e.html).not.toContain("Pay now");
  });

  it("falls back to View invoice and prints the fallback link under the button", () => {
    const e = buildInvoiceEmail(invoice, company, undefined, { portalUrl: PAY, language: "en" });
    expect(e.html).toContain("View invoice");
    // button link and the visible plain link
    expect(
      e.html.match(new RegExp(PAY.replace(/[/.]/g, "\\$&"), "g"))!.length
    ).toBeGreaterThanOrEqual(3);
    expect(e.text).toContain(`View invoice: ${PAY}`);
  });

  it("button is a 48px-class bulletproof cell and stacks on phones", () => {
    const e = buildInvoiceEmail(invoice, company, undefined, { payUrl: PAY, language: "en" });
    expect(e.html).toMatch(/padding:14px 32px/);
    expect(e.html).toMatch(/@media only screen and \(max-width:620px\)/);
    expect(e.html).toContain('bgcolor="#');
  });

  it("escapes the customer name and the custom message", () => {
    const e = buildInvoiceEmail(
      { ...invoice, customerName: "<script>alert(1)</script>" } as Invoice,
      company,
      "<b>hi</b>",
      { language: "en" }
    );
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<b>hi</b>");
    expect(e.html).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });
});

describe.each(LANGS)("payment reminder (%s)", (language) => {
  const base = {
    invoice,
    company,
    customerName: "Desert Rose Catering",
    openFils: 388605,
    level: 2,
    payUrl: PAY,
    language,
  };
  it("overdue: red accent, localized subject, natural Arabic days", () => {
    const e = buildReminderEmail({ ...base, daysOverdue: 30 });
    expectShell(e, language);
    expect(e.html).toContain("#B91C1C");
    if (language === "en") {
      expect(e.subject).toBe("Overdue: invoice INV-2026-00002 — AED 3,886.05");
      expect(e.html).toContain("30 days overdue");
    }
    if (language === "ar") {
      expect(e.subject).toMatch(/^فاتورة متأخرة: INV-2026-00002 — /);
      expect(e.html).toContain("30 يوماً");
      expect(e.html).toContain("هذا هو التذكير رقم 2");
      expect(stripAllowedLatin(e.text)).not.toMatch(/[A-Za-z]{3,}/);
    }
    if (language === "bilingual") expect(e.subject).toContain(" | ");
    expect(e.text).toContain(PAY);
  });
  it("upcoming: neutral accent and a reminder subject", () => {
    const e = buildReminderEmail({ ...base, level: 1, daysOverdue: 0 });
    expect(e.html).not.toContain("#B91C1C");
    if (language === "en") expect(e.subject).toMatch(/^Payment reminder: invoice INV-2026-00002/);
    if (language === "ar") expect(e.subject).toMatch(/^تذكير بسداد الفاتورة INV-2026-00002/);
  });
});

describe("payment reminder custom wording", () => {
  it("custom subject and template replace the defaults, with escaped values", () => {
    const e = buildReminderEmail({
      invoice,
      company,
      customerName: "A & B <Co>",
      openFils: 100000,
      level: 1,
      daysOverdue: 3,
      language: "en",
      customSubject: "Hi {{customerName}}, {{invoiceNumber}} is due: {{amountDue}}",
      customTemplate: "Pay {{amountDue}} by {{dueDate}}",
    });
    expect(e.subject).toBe("Hi A & B <Co>, INV-2026-00002 is due: AED 1,000.00");
    expect(e.html).toContain("Pay AED");
    expect(e.html).not.toContain("<Co>");
  });
});

describe.each(LANGS)("receipt (%s)", (language) => {
  const e = buildReceiptEmail({
    company,
    customerName: "Desert Rose Catering",
    invoiceNumber: "INV-2026-00002",
    amount: 3886.05,
    currency: "AED",
    paidAt: "2026-11-18",
    language,
  });
  it("shows the amount and date, no provider ids", () => {
    expectShell(e, language);
    expect(e.html).toMatch(/3,886\.05/);
    expect(e.html).not.toMatch(/evt_|pi_|cs_|Reference/);
    if (language === "ar") {
      expect(e.subject).toBe("إيصال دفع: الفاتورة INV-2026-00002");
      expect(stripAllowedLatin(e.text)).not.toMatch(/[A-Za-z]{3,}/);
    }
    if (language === "en") expect(e.subject).toBe("Payment receipt: invoice INV-2026-00002");
  });
});

describe.each(LANGS)("quote (%s)", (language) => {
  const e = buildQuoteEmail({
    company,
    customerName: "Desert Rose Catering",
    quoteNumber: "QT-2026-00001",
    total: 3150,
    currency: "AED",
    expiryDate: "2026-12-16",
    message: "Valid for 28 days.",
    portalUrl: "https://app.muhasib.example/portal/tok",
    language,
  });
  it("has a respond button, expiry and language-matched subject/text", () => {
    expectShell(e, language);
    expect(e.html).toContain('href="https://app.muhasib.example/portal/tok"');
    expect(e.text).toContain("https://app.muhasib.example/portal/tok");
    if (language === "en") {
      expect(e.subject).toBe("Quote QT-2026-00001 from Al Noor Trading LLC");
      expect(e.html).toContain("16 Dec 2026");
      expect(e.text).not.toMatch(/[؀-ۿ]/);
    }
    if (language === "ar") {
      expect(e.subject).toBe("عرض سعر رقم QT-2026-00001 من Al Noor Trading LLC");
      expect(e.html).toContain("16 ديسمبر 2026");
      expect(stripAllowedLatin(arabicText(e.html).replace("Valid for 28 days.", ""))).not.toMatch(
        /[A-Za-z]{3,}/
      );
    }
  });
});

describe.each(LANGS)("statement (%s)", (language) => {
  const e = buildStatementEmail({
    company,
    customerName: "Desert Rose Catering",
    asOf: "2026-11-18",
    balances: [
      { currency: "AED", closingBalance: 21421.05 },
      { currency: "USD", closingBalance: 500 },
    ],
    language,
  });
  it("prints a formatted as-of date (not ISO) and every currency balance", () => {
    expectShell(e, language);
    expect(e.html).not.toContain("2026-11-18");
    expect(e.text).not.toContain("2026-11-18");
    expect(e.html).toContain("21,421.05");
    expect(e.html).toContain("USD");
    if (language === "ar") {
      expect(e.subject).toBe("كشف حساب من Al Noor Trading LLC");
      expect(e.html).toContain("18 نوفمبر 2026");
    }
    if (language === "en") expect(e.html).toContain("18 Nov 2026");
  });
});

describe.each(LANGS)("portal sign-in code (%s)", (language) => {
  const e = buildPortalCodeEmail({ companyName: company.name, code: "862692", language });
  it("puts the code in the subject, a left-to-right block and the preheader", () => {
    expectShell(e, language);
    expect(e.html).toContain('dir="ltr" style="display:inline-block;font-size:26px');
    expect(e.html).toContain("862692");
    expect(e.text).toContain("862692");
    if (language === "ar") expect(e.subject).toBe("رمز الدخول: 862692");
    if (language === "en") expect(e.subject).toBe("Your sign-in code: 862692");
  });
});

describe.each(LANGS)("EmaraTax approver emails (%s)", (language) => {
  const url = "https://app.muhasib.example/portal/einvoicing-approve/tok";
  const request = buildApproverRequestEmail({
    companyName: company.name,
    approverName: "Khalid Al Mansoori",
    url,
    language,
  });
  const done = buildApproverDoneEmail({
    companyName: company.name,
    who: "Khalid Al Mansoori",
    settingsUrl: "https://app.muhasib.example/settings/einvoicing",
    language,
  });
  it("request: styled, expiry note, absolute link, company name only (no TRN)", () => {
    expectShell(request, language);
    expect(request.html).toContain(`href="${url}"`);
    expect(request.text).toContain(url);
    expect(request.html).not.toMatch(/\b\d{15}\b|TRN/);
    if (language === "ar") {
      expect(request.html).toContain("إمارات تاكس");
      expect(request.subject).toContain("الموافقة على شريك الفوترة الإلكترونية");
    }
    if (language === "en") expect(request.html).toContain("14 days");
  });
  it("done: links to the e-invoicing settings", () => {
    expectShell(done, language);
    expect(done.text).toContain("/settings/einvoicing");
    if (language === "ar") expect(done.subject).toContain("تم تأكيد الموافقة على");
  });
});

describe("password reset", () => {
  const e = buildPasswordResetEmail("https://app.muhasib.example/reset-password?token=abc");
  it("is bilingual with the link printed once under the button and in the text part", () => {
    expectShell(e, "bilingual");
    expect(e.subject).toBe("Reset your Muhasib.ai password | إعادة تعيين كلمة مرور Muhasib.ai");
    expect(e.text).toContain("reset-password?token=abc");
    expect(e.html).toContain("إعادة تعيين كلمة المرور");
  });
});

describe("footers are consistent", () => {
  it("every customer template carries the automated note and the Muhasib.ai line", () => {
    const all = [
      buildInvoiceEmail(invoice, company, undefined, { language: "en" }),
      buildReminderEmail({
        invoice,
        company,
        customerName: "X",
        openFils: 100,
        level: 1,
        daysOverdue: 0,
        language: "en",
      }),
      buildQuoteEmail({
        company,
        customerName: "X",
        quoteNumber: "QT-2026-00001",
        total: 1,
        currency: "AED",
        language: "en",
      }),
      buildStatementEmail({
        company,
        customerName: "X",
        asOf: "2026-11-18",
        balances: [],
        language: "en",
      }),
    ];
    for (const e of all) {
      expect(e.html).toContain("This is an automated message from <bdi>Al Noor Trading LLC</bdi>.");
      expect(e.html).toContain("Questions? Write to <bdi>billing@alnoor.example</bdi>.");
      expect(e.html).toContain("Sent with <bdi>Muhasib.ai</bdi>");
      expect(e.text).toContain("This is an automated message from Al Noor Trading LLC.");
    }
  });
});

describe("email verification e-mail", () => {
  it("is bilingual with a bulletproof button, no raw link-only body, bilingual subject", async () => {
    const { buildEmailVerificationEmail } = await import("../../server/services/customer-emails");
    const m = buildEmailVerificationEmail(
      "https://app.example/verify-email?token=" + "a".repeat(64),
      "Omar"
    );
    expect(m.html).toContain('lang="en"');
    expect(m.html).toContain('lang="ar"');
    expect(m.html).toContain("em-btn");
    expect(m.html).toContain("word-break:break-all");
    expect(m.subject).toMatch(/[؀-ۿ]/);
    expect(m.text).toContain("https://app.example/verify-email?token=");
    expect(m.html).toContain("مرحباً،");
  });
});
