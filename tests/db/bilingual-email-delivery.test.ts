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
    const sharePath = `/api/invoices/${invoice.body.id}/share`;
    const [firstShare, concurrentShare] = await Promise.all([
      t.as.post(sharePath),
      t.as.post(sharePath),
    ]);
    expect(firstShare.status, firstShare.text).toBe(200);
    expect(concurrentShare.status, concurrentShare.text).toBe(200);
    expect(concurrentShare.body).toEqual(firstShare.body);
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
      expect(token).toBe(firstShare.body.token);
      const publicInvoice = await h.anon.get(`/api/public/invoices/${token}`);
      expect(publicInvoice.status, publicInvoice.text).toBe(200);
      expect(publicInvoice.body.invoice.number).toBe(invoice.body.number);
    }
    const reopened = await t.as.post(sharePath);
    expect(reopened.status, reopened.text).toBe(200);
    expect(reopened.body).toEqual(firstShare.body);
    const originalLink = await h.anon.get(`/api/public/invoices/${firstShare.body.token}`);
    expect(originalLink.status, originalLink.text).toBe(200);
    const inviteToken = inviteMail.text!.match(/\/portal\/join#t=([0-9a-f]{64})/)?.[1];
    expect(inviteToken).toBeDefined();
    const csrf = await h.anon.get("/api/csrf-token");
    expect(csrf.status, csrf.text).toBe(200);
    const cookies = csrf.headers.getSetCookie().map((value) => value.split(";")[0]);
    const publicInvite = await h.anon.post(
      "/api/portal-invitations/lookup",
      { token: inviteToken },
      { headers: { cookie: cookies.join("; "), "x-csrf-token": csrf.body.csrfToken } }
    );
    expect(publicInvite.status, publicInvite.text).toBe(200);
    expect(publicInvite.body.language).toBe(expected);
  });
});
