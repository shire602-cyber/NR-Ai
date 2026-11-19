import { describe, expect, it } from "vitest";
import {
  formatInviteDate,
  normaliseInviteLanguage,
  renderPortalInviteEmail,
} from "../../server/services/portal-invite-email";

const TOKEN = "ab".repeat(32);
const URL = `https://app.example.test/portal/join#t=${TOKEN}`;
const expiresAt = new Date("2026-12-01T10:00:00Z");

function render(overrides: Record<string, unknown> = {}, onlinePayment = false) {
  return renderPortalInviteEmail({
    company: {
      name: "Desert Rose <LLC>",
      trnVatNumber: "100300000000003",
      businessAddress: "Dubai",
      contactEmail: "billing@desertrose.test",
    },
    contact: { name: "Al Noor Trading", nameAr: "النور للتجارة" },
    invitation: {
      language: "en",
      name: "Layla",
      message: null,
      expiresAt,
      ...overrides,
    } as never,
    url: URL,
    onlinePayment,
  });
}

describe("STEP5 portal invitation email", () => {
  it("English: subject, greeting, button link with the fragment token, expiry date", () => {
    const m = render();
    expect(m.subject).toBe("Desert Rose <LLC> invited you to view your invoices");
    expect(m.html).toContain("Hi Layla,");
    expect(m.html).toContain("Set up your account");
    expect(m.html).toContain(`href="${URL}"`);
    expect(m.html).toContain("1 December 2026");
    expect(m.html).not.toContain('dir="rtl"');
    expect(m.text).toContain(URL);
  });

  it("Arabic: RTL section, Arabic subject, button and date in Arabic", () => {
    const m = render({ language: "ar" });
    expect(m.subject).toMatch(/^دعتك .* للاطلاع على فواتيرك$/);
    expect(m.html).toContain('dir="rtl" lang="ar"');
    expect(m.html).toContain("أنشئ حسابك");
    expect(m.html).toContain("النور للتجارة");
    expect(m.html).not.toContain("Set up your account");
    expect(m.html).toContain(`href="${URL}"`);
    expect(m.text).toContain("أنشئ حسابك");
  });

  it("bilingual carries both languages and a joined subject", () => {
    const m = render({ language: "bilingual" });
    expect(m.html).toContain('lang="en"');
    expect(m.html).toContain('lang="ar"');
    expect(m.subject).toContain(" | ");
  });

  it("escapes supplier-controlled text and keeps the subject on one line", () => {
    const m = render({ message: "<script>alert(1)</script>\nsecond line", name: "<img src=x>" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<img src=x>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("Desert Rose &lt;LLC&gt;");
    expect(m.html).toContain("<br>");
    const injected = renderPortalInviteEmail({
      company: {
        name: "Evil\r\nBcc: x@y",
        trnVatNumber: null,
        businessAddress: null,
        contactEmail: null,
      },
      contact: { name: "C", nameAr: null },
      invitation: { language: "en", name: null, message: null, expiresAt } as never,
      url: URL,
      onlinePayment: false,
    });
    expect(injected.subject).not.toMatch(/[\r\n]/);
  });

  it("mentions paying online only when a gateway is available", () => {
    expect(render({}, false).html).not.toContain("pay online");
    expect(render({}, true).html).toContain("pay online");
    expect(render({ language: "ar" }, true).html).toContain("وتسدّد عبر الإنترنت");
  });

  it("formats dates in the reader's language with Latin digits and normalises the language", () => {
    expect(formatInviteDate(expiresAt, "en")).toBe("1 December 2026");
    expect(formatInviteDate(expiresAt, "ar")).toMatch(/^1 ديسمبر 2026$/);
    expect(normaliseInviteLanguage("ar")).toBe("ar");
    expect(normaliseInviteLanguage("bilingual")).toBe("bilingual");
    expect(normaliseInviteLanguage("fr")).toBe("en");
    expect(normaliseInviteLanguage(null)).toBe("en");
  });

  it("never replaces the support address", () => {
    expect(render().html).not.toContain("support@");
  });

  it("is fluid: no fixed 600px table, a max-width cap and room at 375px", () => {
    const m = render({ language: "bilingual" });
    expect(m.html).not.toMatch(/<table[^>]*\swidth="600"/);
    expect(m.html).toContain("max-width:600px");
    expect(m.html).toContain('name="viewport"');
    // Every table is 100% wide, so nothing can exceed a 375px viewport.
    for (const t of m.html.match(/<table[^>]*>/g) ?? []) expect(t).toContain('width="100%"');
    expect(m.html).not.toMatch(/padding:\d+px 40px/);
  });

  it("Arabic mail: the brand header is right-aligned and RTL", () => {
    const ar = render({ language: "ar" }).html;
    const header = ar.slice(ar.indexOf("<h1"), ar.indexOf("</h1>"));
    expect(header).toContain("text-align:right");
    expect(ar).toMatch(/<td dir="rtl" style="background:[^"]*text-align:right/);
    const en = render({ language: "en" }).html;
    expect(en).toMatch(/<td dir="ltr" style="background:[^"]*text-align:left/);
  });

  it("greets a person, never the company: no contact person gives a generic greeting", () => {
    const none = render({ name: null, language: "bilingual" }, false);
    expect(none.html).toContain("Hello,");
    expect(none.html).not.toContain("Hi Al Noor");
    expect(none.html).toContain("مرحبًا بكم،");
    expect(none.text).toContain("Hello,");
    expect(none.text).toContain("مرحبًا بكم،");
    // A contact person on the contact is used when the invitation has no name.
    const withPerson = renderPortalInviteEmail({
      company: {
        name: "Desert Rose",
        trnVatNumber: null,
        businessAddress: null,
        contactEmail: null,
      },
      contact: { name: "Al Noor Trading", nameAr: null, contactPerson: "Omar" },
      invitation: { language: "ar", name: null, message: null, expiresAt } as never,
      url: URL,
      onlinePayment: false,
    });
    expect(withPerson.html).toContain("مرحبًا <bdi>Omar</bdi>،");
  });

  it("the plain-text English copy mentions PDFs and the statement of account", () => {
    const m = render({}, false);
    expect(m.text).toMatch(/download PDFs and your statement of account/);
    expect(m.html).toMatch(/download PDFs and your statement of account/);
    expect(render({ language: "ar" }).text).toContain("PDF");
    expect(render({ language: "ar" }).text).toContain("كشف حسابك");
  });
});
