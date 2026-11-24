import { describe, expect, it } from "vitest";
import {
  formatInviteDate,
  normaliseInviteLanguage,
  renderPortalInviteEmail,
} from "../../server/services/portal-invite-email";

const TOKEN = "ab".repeat(32);
const URL = `https://app.example.test/portal/join#t=${TOKEN}`;
const expiresAt = new Date("2026-12-01T10:00:00Z");

function render(
  overrides: Record<string, unknown> = {},
  onlinePayment = false,
  companyName = "Desert Rose <LLC>"
) {
  return renderPortalInviteEmail({
    company: {
      name: companyName,
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
    expect(m.html).toContain("Hi <bdi>Layla</bdi>,");
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
    expect(m.text).toContain("عزيزنا النور للتجارة،");
    expect(m.text).not.toContain("Layla");
  });

  it("bilingual carries both languages and a joined subject", () => {
    const m = render({ language: "bilingual" });
    expect(m.html).toContain('lang="en"');
    expect(m.html).toContain('lang="ar"');
    expect(m.subject).toContain(" | ");
  });

  it("preserves both invitation clauses for a maximum-length supplier name", () => {
    const name = "شركة ".repeat(39) + "النور";
    expect(name).toHaveLength(200);
    const mail = render({ language: "bilingual" }, false, name);
    expect(mail.subject.length).toBeLessThanOrEqual(300);
    expect(mail.subject).toMatch(
      /… invited you to view your invoices \| دعتك .+… للاطلاع على فواتيرك$/
    );
    expect(mail.html).toContain(name);
    expect(render({}, false, name).subject).toBe(`${name} invited you to view your invoices`);
  });

  it("labels the supplier note in each language in HTML and plain text", () => {
    const mail = render({ language: "bilingual", message: "Please review your invoice" });
    expect(mail.html).toContain("<strong>Message from <bdi>Desert Rose &lt;LLC&gt;</bdi></strong>");
    expect(mail.html).toContain("<strong>رسالة من <bdi>Desert Rose &lt;LLC&gt;</bdi></strong>");
    expect(mail.text).toContain("Message from Desert Rose <LLC>\nPlease review your invoice");
    expect(mail.text).toContain("رسالة من Desert Rose <LLC>\nPlease review your invoice");
    expect(render({ language: "bilingual" }).text).not.toContain("Message from");
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
    for (const content of [render({}, false).html, render({}, false).text]) {
      expect(content).not.toContain("pay online");
    }
    const mail = render({ language: "bilingual" }, true);
    for (const content of [mail.html, mail.text]) {
      expect(content).toContain("pay online");
      expect(content).toContain("السداد عبر الإنترنت");
      expect(content).toContain("statement of account");
      expect(content).toContain("عرض كشف حسابك");
    }
  });

  it("keeps the billing reply address and leaves the company tax number out of both parts", () => {
    const mail = render({ language: "bilingual" });
    for (const content of [mail.html, mail.text]) {
      expect(content).toContain("billing@desertrose.test");
      expect(content).not.toContain("100300000000003");
    }
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

  it("is fluid: a max-width card and a small-screen rule for 375px", () => {
    const m = render({ language: "bilingual" });
    // The fixed 600 table only exists inside the Outlook-only conditional comment.
    const visible = m.html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, "");
    expect(visible).not.toMatch(/<table[^>]*\swidth="600"/);
    expect(m.html).toContain("max-width:600px");
    expect(m.html).toContain('name="viewport"');
    expect(m.html).toContain("max-width:620px");
  });

  it("Arabic mail: the brand header is right-aligned and RTL", () => {
    const ar = render({ language: "ar" }).html;
    expect(ar).toMatch(/<td class="em-pad" dir="rtl"[^>]*align="right"/);
  });

  it("greets a person, never the company: no contact person gives a generic greeting", () => {
    const none = render({ name: null, language: "bilingual" }, false);
    expect(none.html).toContain("Hello,");
    expect(none.html).not.toContain("Hi Al Noor");
    expect(none.text).toContain("Hello,");
    expect(none.html).not.toMatch(/،<\/p>[^<]*<bdi>Al Noor/);
    const withPerson = renderPortalInviteEmail({
      company: {
        name: "Desert Rose",
        trnVatNumber: null,
        businessAddress: null,
        contactEmail: null,
      },
      contact: { name: "Al Noor Trading", nameAr: null, contactPerson: "Omar" },
      invitation: { language: "en", name: null, message: null, expiresAt } as never,
      url: URL,
      onlinePayment: false,
    });
    expect(withPerson.html).toContain("Hi ");
    expect(withPerson.html).toContain("Omar");
  });

  it("the English copy mentions PDFs and the statement of account in both parts", () => {
    const m = render({}, false);
    expect(m.text).toMatch(/download PDFs, and access your statement of account/);
    expect(m.html).toMatch(/download PDFs, and access your statement of account/);
    expect(render({ language: "ar" }).text).toContain("PDF");
    expect(render({ language: "ar" }).text).toContain("كشف حسابك");
  });
});
