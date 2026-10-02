import { describe, expect, it } from "vitest";
import { bilingualSubject, bilingualText, emailLanguages, EMAIL_TEXT, fill, htmlSections, tx } from "../../server/services/email-i18n";
import { buildInvoiceEmail, buildPasswordResetEmail, buildPaymentReminderEmail, buildWelcomeEmail } from "../../server/services/email.service";

const ARABIC = /[؀-ۿ]/;
const company: any = { name: "Pearl Trading", contactEmail: "ar@pearl.test", trnVatNumber: "100123456700003", businessAddress: "Dubai" };
const invoice: any = {
  number: "INV-0007",
  customerName: "Al Noor <script>",
  date: new Date("2026-09-01"),
  dueDate: new Date("2026-09-15"),
  currency: "AED",
  subtotal: 1000,
  vatAmount: 50,
  total: 1050,
};

describe("bilingual email helpers", () => {
  it("sends Arabic first, then English, unless the language is known", () => {
    expect(emailLanguages()).toEqual(["ar", "en"]);
    expect(emailLanguages(null)).toEqual(["ar", "en"]);
    expect(emailLanguages("en")).toEqual(["en"]);
    expect(emailLanguages("ar")).toEqual(["ar"]);
  });

  it("joins subjects and bodies in that order, one language when the locale is known", () => {
    const s = { en: "Hello", ar: "مرحباً" };
    expect(bilingualSubject(s)).toBe("مرحباً | Hello");
    expect(bilingualSubject(s, "en")).toBe("Hello");
    expect(bilingualText(s).indexOf("مرحباً")).toBeLessThan(bilingualText(s).indexOf("Hello"));
    expect(bilingualText(s, "ar")).toBe("مرحباً");
  });

  it("wraps the Arabic section right-to-left and the English left-to-right", () => {
    const html = htmlSections(null, (lang) => `<p>${lang}</p>`);
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'));
    expect(htmlSections("en", (lang) => lang)).not.toContain("rtl");
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    expect(fill("a {x} b {y}", { x: 1 })).toBe("a 1 b {y}");
  });

  it("every table entry has both languages with the same placeholders", () => {
    const placeholders = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [key, entry] of Object.entries(EMAIL_TEXT)) {
      expect(entry.en.length, key).toBeGreaterThan(0);
      expect(entry.ar.length, key).toBeGreaterThan(0);
      expect(ARABIC.test(entry.ar), `${key} has Arabic`).toBe(true);
      expect(placeholders(entry.ar), `${key} placeholders`).toBe(placeholders(entry.en));
    }
  });
});

describe("system email templates", () => {
  it("invoice: Arabic block then English block, escaped customer name, Arabic subject", () => {
    const { subject, html } = buildInvoiceEmail({ invoice, company });
    expect(subject).toContain("فاتورة INV-0007 من Pearl Trading");
    expect(subject).toContain("Invoice INV-0007 from Pearl Trading");
    expect(html.indexOf("الإجمالي المستحق")).toBeGreaterThan(-1);
    expect(html.indexOf("الإجمالي المستحق")).toBeLessThan(html.indexOf("Total Due"));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("invoice: a known recipient language sends one language only; a typed subject is kept", () => {
    const en = buildInvoiceEmail({ invoice, company, locale: "en", subject: "My subject" });
    expect(en.subject).toBe("My subject");
    expect(ARABIC.test(en.html)).toBe(false);
    const ar = buildInvoiceEmail({ invoice, company, locale: "ar" });
    expect(ar.html).toContain("الإجمالي المستحق");
    expect(ar.html).not.toContain("Total Due");
  });

  it("reminder: overdue and due-soon both read in Arabic and English, with the reminder number", () => {
    const overdue = buildPaymentReminderEmail({ invoice, company, reminderNumber: 2, now: new Date("2026-10-01") });
    expect(overdue.subject).toContain("تذكير بفاتورة متأخرة السداد");
    expect(overdue.subject).toContain("Overdue Invoice Reminder");
    expect(overdue.html).toContain("أصبحت متأخرة السداد");
    expect(overdue.html).toContain("is now overdue");
    expect(overdue.html).toContain("التذكير رقم 2");
    expect(overdue.html).toContain("reminder #2");
    const upcoming = buildPaymentReminderEmail({ invoice, company, reminderNumber: 1, now: new Date("2026-09-10") });
    expect(upcoming.subject).toContain("تذكير بالدفع");
    expect(upcoming.html).toContain("تستحق السداد بتاريخ");
    expect(upcoming.html).toContain("is due on");
  });

  it("password reset and welcome are bilingual, the link stays intact", () => {
    const reset = buildPasswordResetEmail("https://app.test/reset?token=abc123");
    expect(reset.subject).toBe("إعادة تعيين كلمة مرور محاسب.ai | Reset your Muhasib.ai password");
    expect(reset.html).toContain("https://app.test/reset?token=abc123");
    expect(reset.html).toContain("إعادة تعيين كلمة المرور");
    expect(reset.html).toContain("Reset password");
    const welcome = buildWelcomeEmail("Layla", "Pearl Trading");
    expect(welcome.subject).toBe("مرحباً بك في محاسب.ai | Welcome to Muhasib.ai");
    expect(welcome.html).toContain("تم إعداد حسابك لشركة");
    expect(welcome.html).toContain("has been set up successfully");
    expect(tx("welcomeSetup", "en")).toContain("created");
  });
});
