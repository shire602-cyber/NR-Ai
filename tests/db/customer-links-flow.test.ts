/**
 * Customer links through the real routes (the route-level twin of tests/e2e/customer-links-flow.mjs):
 * the contact's preferred language is saved and then drives every message and the invoice page;
 * an Arabic company writes to customers without a preference in Arabic; a card payment sends the
 * receipt in the customer's language; the EmaraTax approver mail follows the company language and
 * shows no TRN; invalid and expired invoice links answer 404 / 410.
 */
import { afterEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const DATE = new Date().toISOString().slice(0, 10);
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const SECRET = "whsec_test_customer_links";
const TRN = "100300000000003";

afterEach(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.INVOICE_PAYMENTS_ENABLED;
  delete process.env.STRIPE_INVOICE_WEBHOOK_SECRET;
  const { setStripeFetch } = await import("../../server/services/payments");
  setStripeFetch(null);
});

async function contact(t: Tenant, extra: Record<string, unknown> = {}) {
  const r = await t.as.post(`${base(t)}/customer-contacts`, {
    name: "Gulf Retail LLC",
    nameAr: "الخليج للتجزئة",
    email: "ap@gulfretail.example",
    emirate: "dubai",
    ...extra,
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body as { id: string; preferredLanguage: string | null };
}

async function issued(t: Tenant, contactId: string) {
  const r = await t.as.post(`${base(t)}/invoices`, {
    contactId,
    date: DATE,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
  });
  expect(r.status, r.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${r.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return r.body as { id: string; number: string };
}

async function mail(category: string, to: string) {
  const rows = await h.sql<{ subject: string; html: string; text_body: string }>(
    `SELECT subject, html, text_body FROM email_outbox WHERE category = $1 AND to_address = $2 ORDER BY created_at DESC LIMIT 1`,
    [category, to]
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

const isArabic = (m: { html: string }) => /<html[^>]*lang="ar"[^>]*dir="rtl"/.test(m.html);
const isBoth = (m: { html: string }) =>
  m.html.includes('lang="en"') && m.html.includes('lang="ar"');

describe("contact language drives messages and the invoice page", () => {
  it("saves, changes and clears the preferred language through the contact routes", async () => {
    const t = await h.createTenant();
    const c = await contact(t, { preferredLanguage: "ar" });
    expect(c.preferredLanguage).toBe("ar");
    const en = await t.as.put(`${base(t)}/customer-contacts/${c.id}`, { preferredLanguage: "en" });
    expect(en.status, en.text).toBeLessThan(300);
    expect(en.body.preferredLanguage).toBe("en");
    const cleared = await t.as.put(`${base(t)}/customer-contacts/${c.id}`, {
      preferredLanguage: null,
    });
    expect(cleared.body.preferredLanguage).toBeNull();
    const bad = await t.as.put(`${base(t)}/customer-contacts/${c.id}`, { preferredLanguage: "fr" });
    expect(bad.status).toBe(400);
  });

  it("English company: no preference is both languages, an Arabic-preferring contact gets Arabic; the page reports both", async () => {
    const t = await h.createTenant();
    const none = await contact(t);
    const arabic = await contact(t, {
      name: "Arabic Pref",
      email: "ar@x.example",
      preferredLanguage: "ar",
    });
    const i1 = await issued(t, none.id);
    const i2 = await issued(t, arabic.id);
    await t.as.post(`${base(t)}/invoices/${i1.id}/send-email`, { to: "none@c.test" });
    await t.as.post(`${base(t)}/invoices/${i2.id}/send-email`, { to: "ar@c.test" });
    expect(isBoth(await mail("invoice", "none@c.test"))).toBe(true);
    const m = await mail("invoice", "ar@c.test");
    expect(isArabic(m)).toBe(true);
    // The link in the mail is absolute and the invoice page API reports the language to open in.
    const link = m.text_body.match(/https?:\/\/[^\s]+\/view\/invoice\/([0-9a-f]{32})/);
    expect(link).not.toBeNull();
    const view = await h.anon.get(`/api/public/invoices/${link![1]}`);
    expect(view.status).toBe(200);
    expect(view.body.preferredLanguage).toBe("ar");
    expect(view.body.companyLocale).toBe("en");
  });

  it("Arabic company: customers without a preference get Arabic invoice, reminder, quote, statement and approver mail", async () => {
    const t = await h.createTenant({ companyColumns: { locale: "ar" } });
    const c = await contact(t);
    const inv = await issued(t, c.id);
    await t.as.post(`${base(t)}/invoices/${inv.id}/send-email`, { to: "inv@c.test" });
    await t.as.post(`${base(t)}/invoices/${inv.id}/send-reminder`, { to: "rem@c.test" });
    const q = await t.as.post(`${base(t)}/quotes`, {
      contactId: c.id,
      date: DATE,
      lines: [{ description: "Setup", quantity: 1, unitPrice: 500, vatRate: 0.05 }],
    });
    expect(q.status, q.text).toBeLessThan(300);
    await t.as.patch(`/api/quotes/${q.body.id}/status`, { status: "sent" });
    await t.as.post(`/api/quotes/${q.body.id}/send-email`, { to: "quote@c.test" });
    await t.as.post(`${base(t)}/customer-statements/${c.id}/email`, { to: "st@c.test" });
    for (const [cat, to] of [
      ["invoice", "inv@c.test"],
      ["reminder", "rem@c.test"],
      ["quote", "quote@c.test"],
      ["statement", "st@c.test"],
    ]) {
      const m = await mail(cat, to);
      expect(isArabic(m), cat).toBe(true);
      expect(m.html + m.text_body, cat).not.toContain(TRN);
    }
    const view = await h.anon.get(
      `/api/public/invoices/${(await mail("invoice", "inv@c.test")).text_body.match(/view\/invoice\/([0-9a-f]{32})/)![1]}`
    );
    expect(view.body.companyLocale).toBe("ar");
    expect(view.body.preferredLanguage).toBeNull();

    // EmaraTax approval request: Arabic for an Arabic company, company name only, no TRN.
    await t.as.put(`${base(t)}/einvoicing/partner`, { partner: "acube" });
    const ap = await t.as.post(`${base(t)}/einvoicing/approver-links`, {
      approverName: "Khalid",
      approverEmail: "approver@c.test",
    });
    expect(ap.status, ap.text).toBeLessThan(300);
    const am = await mail("einvoice_approver_link", "approver@c.test");
    expect(isArabic(am)).toBe(true);
    expect(am.html + am.text_body).not.toContain(TRN);
    const token = (ap.body.url as string).split("/").pop()!;
    const approve = await h.anon.get(`/api/portal/einvoicing-approve/${token}`);
    expect(approve.status).toBe(200);
    expect(approve.text).not.toContain(TRN);
    const done = await h.anon.post(`/api/portal/einvoicing-approve/${token}/done`, {});
    expect(done.status, done.text).toBe(200);
  });

  it("a card payment sends the receipt in the customer's language", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_links";
    process.env.INVOICE_PAYMENTS_ENABLED = "true";
    process.env.STRIPE_INVOICE_WEBHOOK_SECRET = SECRET;
    const { setStripeFetch, signStripePayload } = await import("../../server/services/payments");
    setStripeFetch(async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith("/checkout/sessions")
          ? { id: "cs_test_links", url: "https://checkout.stripe.com/c/pay/cs_test" }
          : { latest_charge: { balance_transaction: { fee: 100, currency: "aed" } } },
    }));
    const t = await h.createTenant();
    const c = await contact(t, { email: "payer@c.test", preferredLanguage: "ar" });
    const inv = await issued(t, c.id);
    const share = await t.as.post(`/api/invoices/${inv.id}/share`);
    const page = await h.anon.get(`/api/public/invoices/${share.body.token}`);
    expect(page.body.onlinePayment.available).toBe(true);
    const checkout = await h.anon.post(`/api/portal/public-invoices/${share.body.token}/pay`, {});
    expect(checkout.status, checkout.text).toBe(200);
    const [link] = await h.sql(
      `SELECT id, provider_session_id FROM payment_links WHERE invoice_id = $1`,
      [inv.id]
    );
    const payload = JSON.stringify({
      id: "evt_links_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: link.provider_session_id,
          payment_status: "paid",
          amount_total: 105000,
          currency: "aed",
          payment_intent: "pi_links",
          client_reference_id: link.id,
          metadata: { payment_link_id: link.id },
        },
      },
    });
    const hook = await h.anon.post("/api/webhooks/invoice-payments/stripe", undefined, {
      raw: payload,
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": signStripePayload(payload, SECRET),
      },
    });
    expect(hook.body.status).toBe("processed");
    const receipt = await mail("payment_receipt", "payer@c.test");
    expect(isArabic(receipt)).toBe(true);
    expect(receipt.html + receipt.text_body).not.toContain("pi_links");
    expect(receipt.html + receipt.text_body).not.toContain("evt_links_1");
  });

  it("invalid and expired invoice links answer 404 and 410 (never 200 or 403)", async () => {
    const t = await h.createTenant();
    const c = await contact(t);
    const inv = await issued(t, c.id);
    const share = await t.as.post(`/api/invoices/${inv.id}/share`);
    expect((await h.anon.get(`/api/public/invoices/${"0".repeat(32)}`)).status).toBe(404);
    await h.sql(
      `UPDATE invoices SET share_token_expires_at = now() - interval '1 day' WHERE id = $1`,
      [inv.id]
    );
    expect((await h.anon.get(`/api/public/invoices/${share.body.token}`)).status).toBe(410);
  });
});
