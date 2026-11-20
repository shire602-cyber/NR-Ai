import { afterEach, describe, expect, it } from "vitest";
import type { OutgoingEmail } from "../../server/outbox";
import { useHarness } from "./harness";

const h = useHarness();

afterEach(async () => {
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
});

describe("customer email delivery for an Arabic company", () => {
  it.each([
    { preferredLanguage: null, expected: "bilingual" },
    { preferredLanguage: "en", expected: "en" },
    { preferredLanguage: "ar", expected: "ar" },
  ])("sends invoice, reminder and invite in $expected", async ({ preferredLanguage, expected }) => {
    const t = await h.createTenant({ companyColumns: { locale: "ar" } });
    const base = `/api/companies/${t.company.id}`;
    const to = `customer-${expected}@example.test`;
    const contact = await t.as.post(`${base}/customer-contacts`, {
      name: "Gulf Retail",
      nameAr: "الخليج للتجزئة",
      email: to,
      preferredLanguage,
    });
    expect(contact.status, contact.text).toBe(200);
    const invoice = await t.as.post(`${base}/invoices`, {
      contactId: contact.body.id,
      date: new Date().toISOString().slice(0, 10),
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(invoice.status, invoice.text).toBe(200);
    const issue = await t.as.patch(`/api/invoices/${invoice.body.id}/status`, { status: "sent" });
    expect(issue.status, issue.text).toBe(200);

    const messages: OutgoingEmail[] = [];
    const { setEmailTransportOverride } = await import("../../server/outbox");
    setEmailTransportOverride({
      name: "test",
      send: async (message) => {
        messages.push(message);
        return { providerMessageId: `mock-message-${messages.length}` };
      },
    });

    const invoiceBase = `${base}/invoices/${invoice.body.id}`;
    const sent = await t.as.post(`${invoiceBase}/send-email`, { to });
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body.sent).toBe(true);
    const reminder = await t.as.post(`${invoiceBase}/send-reminder`, { to });
    expect(reminder.status, reminder.text).toBe(200);
    expect(reminder.body.sent).toBe(true);
    const invitation = await t.as.post(
      `${base}/customer-contacts/${contact.body.id}/portal-invitations`,
      {}
    );
    expect(invitation.status, invitation.text).toBe(201);
    expect(invitation.body.delivery).toBe("email");
    expect(invitation.body.invitation.language).toBe(expected);
    expect(invitation.body.inviteUrl).toBeUndefined();

    expect(messages).toHaveLength(3);
    const [invoiceMail, reminderMail, inviteMail] = messages;
    const hasEnglish = expected !== "ar";
    const hasArabic = expected !== "en";
    for (const mail of messages) {
      expect(mail.to).toBe(to);
      expect(mail.subject.includes(" | ")).toBe(expected === "bilingual");
      expect(mail.html.includes('<div dir="ltr" lang="en"')).toBe(hasEnglish);
      expect(mail.html.includes('<div dir="rtl" lang="ar"')).toBe(hasArabic);
      expect(mail.text!.includes("Gulf Retail")).toBe(hasEnglish);
      expect(mail.text!.includes("الخليج للتجزئة")).toBe(hasArabic);
    }
    for (const mail of [invoiceMail, reminderMail]) {
      expect(mail.attachments).toHaveLength(1);
      expect(mail.attachments[0].contentType).toBe("application/pdf");
      const token = mail.text!.match(/\/view\/invoice\/([0-9a-f]{32})/)?.[1];
      expect(token).toBeDefined();
      const publicInvoice = await h.anon.get(`/api/public/invoices/${token}`);
      expect(publicInvoice.status, publicInvoice.text).toBe(200);
      expect(publicInvoice.body.invoice.number).toBe(invoice.body.number);
    }
    const inviteToken = inviteMail.text!.match(/\/portal\/join#t=([0-9a-f]{64})/)?.[1];
    expect(inviteToken).toBeDefined();
    const publicInvite = await h.anon.get(`/api/portal-invitations/${inviteToken}`);
    expect(publicInvite.status, publicInvite.text).toBe(200);
    expect(publicInvite.body.language).toBe(expected);
  });
});
