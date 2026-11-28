/**
 * Customer e-mails through the real routes and the outbox: the language follows the customer's
 * own preference (subject, HTML and plain text), amounts and dates use the app's formatters,
 * links are absolute from the configured base, and no TRN or internal id leaks.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const DATE = dubaiToday();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function contact(t: Tenant, extra: Record<string, unknown> = {}) {
  const r = await t.as.post(`${base(t)}/customer-contacts`, {
    name: "Gulf Retail LLC",
    nameAr: "الخليج للتجزئة",
    email: "ap@gulfretail.example",
    emirate: "dubai",
    ...extra,
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body as { id: string };
}

async function issued(t: Tenant, contactId: string, unitPrice = 1250) {
  const r = await t.as.post(`${base(t)}/invoices`, {
    contactId,
    date: DATE,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 1, unitPrice, vatRate: 0.05 }],
  });
  expect(r.status, r.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${r.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return r.body as { id: string; number: string };
}

async function outbox(category: string, to: string) {
  const rows = await h.sql<{ subject: string; html: string; text_body: string }>(
    `SELECT subject, html, text_body FROM email_outbox
      WHERE category = $1 AND to_address = $2 ORDER BY created_at DESC LIMIT 1`,
    [category, to]
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("customer e-mails: language follows the customer", () => {
  it("invoice e-mail to an Arabic-preferring customer is Arabic end to end, with grouped amounts", async () => {
    const t = await h.createTenant();
    await h.sql(`UPDATE companies SET trn_vat_number = '100123456700003' WHERE id = $1`, [
      t.company.id,
    ]);
    const c = await contact(t, { preferredLanguage: "ar" });
    const inv = await issued(t, c.id);
    const r = await t.as.post(`${base(t)}/invoices/${inv.id}/send-email`, {
      to: "ar-customer@example.test",
    });
    expect(r.status, r.text).toBe(202);
    const row = await outbox("invoice", "ar-customer@example.test");
    expect(row.subject).toMatch(/^فاتورة رقم /);
    expect(row.subject).not.toContain(" | ");
    expect(row.html).toContain('<html lang="ar" dir="rtl"');
    expect(row.html).not.toContain('lang="en"');
    expect(row.html).toContain("د.إ");
    expect(row.html).toContain("1,312.50");
    expect(row.text_body).toMatch(/[؀-ۿ]/);
    expect(row.text_body).not.toContain("Total:");
    // The seller TRN stays on the attached PDF only.
    expect(row.html + row.text_body).not.toContain("100123456700003");
  });

  it("a draft or cancelled invoice cannot be e-mailed and nothing is queued", async () => {
    const t = await h.createTenant();
    const c = await contact(t);
    const draft = await t.as.post(`${base(t)}/invoices`, {
      contactId: c.id,
      date: DATE,
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
    });
    expect(draft.status, draft.text).toBe(200);
    const r1 = await t.as.post(`${base(t)}/invoices/${draft.body.id}/send-email`, {
      to: "draft@example.test",
    });
    expect(r1.status, r1.text).toBe(409);
    expect(r1.body.code).toBe("INVOICE_NOT_ISSUED");
    await h.sql(`UPDATE invoices SET status = 'cancelled' WHERE id = $1`, [draft.body.id]);
    const r2 = await t.as.post(`${base(t)}/invoices/${draft.body.id}/send-email`, {
      to: "draft@example.test",
    });
    expect(r2.status, r2.text).toBe(409);
    const rows = await h.sql(`SELECT 1 FROM email_outbox WHERE to_address = $1`, [
      "draft@example.test",
    ]);
    expect(rows).toHaveLength(0);
  });

  it("an Arabic company sends both languages when there is no preference and honors an explicit override", async () => {
    const t = await h.createTenant({ companyColumns: { locale: "ar" } });
    const c = await contact(t);
    const inv = await issued(t, c.id);
    const sent = await t.as.post(`${base(t)}/invoices/${inv.id}/send-email`, {
      to: "both@example.test",
    });
    expect(sent.status, sent.text).toBe(202);
    const both = await outbox("invoice", "both@example.test");
    expect(both.subject).toMatch(/Invoice .+\| فاتورة رقم /);
    expect(both.text_body).toContain("Gulf Retail LLC");
    expect(both.text_body).toContain("الخليج للتجزئة");
    expect(both.html).toContain('<div dir="ltr" lang="en"');
    expect(both.html).toContain('<div dir="rtl" lang="ar"');
    await t.as.post(`${base(t)}/invoices/${inv.id}/send-email`, {
      to: "en@example.test",
      language: "en",
    });
    const en = await outbox("invoice", "en@example.test");
    expect(en.html).toContain('<html lang="en" dir="ltr"');
    expect(en.text_body).not.toMatch(/[؀-ۿ]/);
  });

  it("reminder to an Arabic customer links to the invoice with an absolute URL and a localized subject", async () => {
    const t = await h.createTenant();
    const c = await contact(t, { preferredLanguage: "ar" });
    const inv = await issued(t, c.id);
    const r = await t.as.post(`${base(t)}/invoices/${inv.id}/send-reminder`, {
      to: "rem@example.test",
    });
    expect(r.status, r.text).toBe(202);
    const row = await outbox("reminder", "rem@example.test");
    expect(row.subject).toMatch(/^(تذكير بسداد الفاتورة|فاتورة متأخرة:) /);
    expect(row.html).toContain('lang="ar"');
    expect(row.text_body).toMatch(/https?:\/\/[^\s]+\/view\/invoice\/[0-9a-f]{32}/);
    // Online payment is not configured in tests: the button must not promise "Pay now".
    expect(row.html).not.toContain("ادفع الآن");
    expect(row.html).toContain("عرض الفاتورة");
  });

  it("quote e-mail is a styled message with the portal link, in the customer's language", async () => {
    const t = await h.createTenant();
    const c = await contact(t, { preferredLanguage: "ar" });
    const q = await t.as.post(`${base(t)}/quotes`, {
      contactId: c.id,
      customerName: "Gulf Retail LLC",
      date: DATE,
      lines: [{ description: "Fit-out", quantity: 1, unitPrice: 5000, vatRate: 0.05 }],
    });
    expect(q.status, q.text).toBeLessThan(300);
    const send = await t.as.post(`/api/quotes/${q.body.id}/send-email`, {
      to: "quote@example.test",
    });
    expect(send.status, send.text).toBe(202);
    const row = await outbox("quote", "quote@example.test");
    expect(row.subject).toMatch(/^عرض سعر رقم /);
    expect(row.html).toContain("5,250.00");
    expect(row.html).toMatch(/href="https?:\/\/[^"]+\/portal\/[0-9a-f]{64}"/);
    expect(row.text_body).toMatch(/\/portal\/[0-9a-f]{64}/);
  });

  it("statement e-mail prints a formatted as-of date, never an ISO date", async () => {
    const t = await h.createTenant();
    const c = await contact(t);
    await issued(t, c.id, 800);
    const r = await t.as.post(`${base(t)}/customer-statements/${c.id}/email`, {
      to: "st@example.test",
      language: "en",
    });
    expect(r.status, r.text).toBe(202);
    const row = await outbox("statement", "st@example.test");
    expect(row.subject).toMatch(/^Statement of account from /);
    expect(row.html).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(row.html).toMatch(/\b\d{1,2} [A-Z][a-z]{2} 20\d\d\b/);
    expect(row.html).toContain("840.00");
  });

  it("EmaraTax approver request is a branded, bilingual, absolute-link e-mail with the company name only", async () => {
    const t = await h.createTenant({
      companyColumns: {
        trn_vat_number: "100123456700003",
        legal_name: "Pearl Trading L.L.C.",
        emirate: "dubai",
      },
    });
    const partners = (await t.as.get(`${base(t)}/einvoicing/partner`)).body.partners as Array<{
      id: string;
    }>;
    await t.as.put(`${base(t)}/einvoicing/partner`, { partner: partners[0].id });
    const created = await t.as.post(`${base(t)}/einvoicing/approver-links`, {
      approverName: "Huda",
      approverEmail: "huda@example.test",
    });
    expect(created.status, created.text).toBe(201);
    const row = await outbox("einvoice_approver_link", "huda@example.test");
    expect(row.subject).toContain("EmaraTax");
    expect(row.subject).toContain("إمارات تاكس");
    expect(row.html).toContain('<div dir="rtl" lang="ar"');
    expect(row.html).toContain(`href="${created.body.url}"`);
    expect(created.body.url).toMatch(/^https?:\/\/[^/]+\/portal\/einvoicing-approve\/[\w-]{30,}$/);
    expect(row.text_body).toContain(created.body.url);
    expect(row.html + row.text_body).not.toMatch(/100123456700003|\bTRN\b/);
  });
});

describe("customer e-mails: Arabic greeting uses the Arabic name", () => {
  it("invoice and reminder in Arabic greet by the contact's Arabic name, never the English snapshot", async () => {
    const t = await h.createTenant();
    const c = await contact(t, { preferredLanguage: "ar" });
    const inv = await issued(t, c.id);
    expect(
      (await t.as.post(`${base(t)}/invoices/${inv.id}/send-email`, { to: "g1@example.test" }))
        .status
    ).toBe(202);
    const sent = await outbox("invoice", "g1@example.test");
    expect(sent.html).toContain("عزيزنا <bdi>الخليج للتجزئة</bdi>،");
    expect(sent.html).not.toContain("Gulf Retail LLC");
    expect(sent.text_body).toContain("الخليج للتجزئة");

    const rem = await t.as.post(`${base(t)}/invoices/${inv.id}/send-reminder`, {
      to: "g2@example.test",
    });
    expect(rem.status, rem.text).toBeLessThan(300);
    const reminder = await outbox("reminder", "g2@example.test");
    expect(reminder.html).toContain("عزيزنا <bdi>الخليج للتجزئة</bdi>،");
    expect(reminder.html).not.toContain("Gulf Retail LLC");
  });

  it("with no Arabic name the Arabic greeting is neutral; English keeps the English name", async () => {
    const t = await h.createTenant();
    const c = await contact(t, { nameAr: null, preferredLanguage: "ar" });
    const inv = await issued(t, c.id);
    await t.as.post(`${base(t)}/invoices/${inv.id}/send-email`, { to: "g3@example.test" });
    const ar = await outbox("invoice", "g3@example.test");
    expect(ar.html).toContain("عزيزنا العميل،");
    expect(ar.html).not.toContain("Gulf Retail LLC");
    await t.as.post(`${base(t)}/invoices/${inv.id}/send-email`, {
      to: "g4@example.test",
      language: "en",
    });
    const en = await outbox("invoice", "g4@example.test");
    expect(en.html).toContain("Dear <bdi>Gulf Retail LLC</bdi>,");
  });
});
