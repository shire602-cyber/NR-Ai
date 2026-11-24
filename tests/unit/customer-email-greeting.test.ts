/**
 * Arabic customer e-mails greet by an Arabic name, never by the Latin-script invoice snapshot.
 * Pure helper (every name combination) and all five customer senders' builders.
 */
import { describe, expect, it } from "vitest";
import type { Company, Invoice } from "../../shared/schema";
import {
  NEUTRAL_AR_GREETING,
  arabicGreeting,
  buildInvoiceEmail,
  buildQuoteEmail,
  buildReceiptEmail,
  buildReminderEmail,
  buildStatementEmail,
} from "../../server/services/customer-emails";

const company = { id: "c1", name: "Al Noor Trading LLC" } as unknown as Company;
const invoice = {
  id: "i1",
  number: "INV-1",
  customerName: "Desert Rose Catering",
  date: "2026-11-08",
  dueDate: "2026-12-08",
  currency: "AED",
  total: 100,
} as unknown as Invoice;
const AR = "شركة وردة الصحراء";

describe("arabicGreeting", () => {
  it("uses the contact's Arabic name when it exists", () => {
    expect(arabicGreeting({ name: "Desert Rose Catering", nameAr: AR })).toBe(
      `عزيزنا <bdi>${AR}</bdi>،`
    );
  });
  it("uses the company's Arabic name when the contact has none", () => {
    expect(arabicGreeting({ name: "Desert Rose", companyNameAr: AR })).toContain(AR);
  });
  it("uses an Arabic-script document name when no Arabic field is set", () => {
    expect(arabicGreeting({ name: AR })).toContain(AR);
  });
  it("is neutral when only an English name exists", () => {
    expect(arabicGreeting({ name: "Desert Rose Catering" })).toBe(NEUTRAL_AR_GREETING);
  });
  it("is neutral when no name exists at all", () => {
    expect(arabicGreeting({})).toBe(NEUTRAL_AR_GREETING);
    expect(arabicGreeting({ name: " ", nameAr: "", companyNameAr: null })).toBe(
      NEUTRAL_AR_GREETING
    );
  });
  it("never puts a Latin-script name in the greeting, even from an Arabic field", () => {
    const g = arabicGreeting({ name: "Desert Rose", nameAr: "Desert Rose LLC" });
    expect(g).toBe(NEUTRAL_AR_GREETING);
    expect(arabicGreeting({ name: "Rose", nameAr: "وردة Rose" })).toBe(NEUTRAL_AR_GREETING);
  });
  it("escapes markup in the name", () => {
    expect(arabicGreeting({ nameAr: "شركة <b>x</b>" })).not.toContain("<b>");
  });
});

describe("the five senders' builders", () => {
  const ctx = { customerName: "Desert Rose Catering" };
  const builders: Array<
    [string, (nameAr: string | null, language: "ar" | "en" | "bilingual") => string]
  > = [
    [
      "invoice",
      (n, l) =>
        buildInvoiceEmail(invoice, company, undefined, { language: l, customerNameAr: n }).html,
    ],
    [
      "reminder",
      (n, l) =>
        buildReminderEmail({
          invoice,
          company,
          ...ctx,
          customerNameAr: n,
          openFils: 10000,
          level: 1,
          daysOverdue: 3,
          language: l,
        }).html,
    ],
    [
      "receipt",
      (n, l) =>
        buildReceiptEmail({
          company,
          ...ctx,
          customerNameAr: n,
          invoiceNumber: "INV-1",
          amount: 100,
          currency: "AED",
          language: l,
        }).html,
    ],
    [
      "quote",
      (n, l) =>
        buildQuoteEmail({
          company,
          ...ctx,
          customerNameAr: n,
          quoteNumber: "QT-1",
          total: 100,
          currency: "AED",
          language: l,
        }).html,
    ],
    [
      "statement",
      (n, l) =>
        buildStatementEmail({
          company,
          ...ctx,
          customerNameAr: n,
          asOf: "2026-11-18",
          balances: [{ currency: "AED", closingBalance: 100 }],
          language: l,
        }).html,
    ],
  ];

  describe.each(builders)("%s", (_name, build) => {
    it("Arabic: the Arabic name, never the English one", () => {
      const html = build(AR, "ar");
      expect(html).toContain(`عزيزنا <bdi>${AR}</bdi>،`);
      expect(html).not.toContain("Desert Rose Catering");
    });
    it("Arabic with no Arabic name: neutral greeting, no Latin name", () => {
      const html = build(null, "ar");
      expect(html).toContain(NEUTRAL_AR_GREETING);
      expect(html).not.toContain("Desert Rose Catering");
    });
    it("English keeps the English name", () => {
      const html = build(AR, "en");
      expect(html).toContain("Dear <bdi>Desert Rose Catering</bdi>,");
      expect(html).not.toContain(AR);
    });
    it("bilingual: English block English name, Arabic block Arabic name", () => {
      const html = build(AR, "bilingual");
      expect(html).toContain("Dear <bdi>Desert Rose Catering</bdi>,");
      expect(html).toContain(`عزيزنا <bdi>${AR}</bdi>،`);
    });
  });
});

describe("approver request e-mail greeting (both languages)", () => {
  it("Latin approver name: English block names them, Arabic block is a neutral hello", async () => {
    const { buildApproverRequestEmail } = await import("../../server/services/customer-emails");
    const m = buildApproverRequestEmail({
      companyName: "Al Noor Trading LLC",
      approverName: "Khalid Al Mansoori",
      url: "https://app.example/portal/einvoicing-approve/abc",
      language: "bilingual",
    });
    expect(m.html).toContain("Dear <bdi>Khalid Al Mansoori</bdi>,");
    expect(m.html).toContain("مرحباً،");
    expect(m.html).not.toContain("عزيزنا العميل");
    expect(m.html).not.toMatch(/عزيزنا[^<]*Khalid/);
    expect(m.subject).toMatch(/[؀-ۿ]/);
    expect(m.subject).toMatch(/[A-Za-z]/);
    expect(m.text).toMatch(/[؀-ۿ]/);
  });
  it("Arabic approver name is used in the Arabic block", async () => {
    const { buildApproverRequestEmail } = await import("../../server/services/customer-emails");
    const m = buildApproverRequestEmail({
      companyName: "Al Noor Trading LLC",
      approverName: "خالد المنصوري",
      url: "https://app.example/portal/einvoicing-approve/abc",
    });
    expect(m.html).toContain("عزيزنا <bdi>خالد المنصوري</bdi>،");
  });
});
