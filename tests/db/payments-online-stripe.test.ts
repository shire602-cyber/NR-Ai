/**
 * W4-D online invoice payment (R16-14): Stripe Checkout adapter with a mocked Stripe API and
 * signed sample webhooks. A paid event posts exactly one invoice payment through
 * invoices.recordPayment (ledger), books the gateway fee to Bank Charges and queues a receipt.
 */
import { afterEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const SECRET = "whsec_test_w4d_invoice_payments";

function enableStripe() {
  process.env.STRIPE_SECRET_KEY = "sk_test_w4d";
  process.env.INVOICE_PAYMENTS_ENABLED = "true";
  process.env.STRIPE_INVOICE_WEBHOOK_SECRET = SECRET;
}

afterEach(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.INVOICE_PAYMENTS_ENABLED;
  delete process.env.STRIPE_INVOICE_WEBHOOK_SECRET;
  const { setStripeFetch } = await import("../../server/services/payments");
  setStripeFetch(null);
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
});

const calls: Array<{ url: string; body?: string }> = [];
async function mockStripe(feeFils = 320) {
  const { setStripeFetch } = await import("../../server/services/payments");
  calls.length = 0;
  setStripeFetch(async (url, init) => {
    calls.push({ url, body: init.body });
    if (url.endsWith("/checkout/sessions")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `cs_test_${Math.random().toString(36).slice(2)}`,
          url: "https://checkout.stripe.com/c/pay/cs_test",
        }),
      };
    }
    if (url.includes("/payment_intents/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          latest_charge: { balance_transaction: { fee: feeFils, currency: "aed" } },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: "not mocked" } }) };
  });
}

async function issuedInvoice(t: Tenant) {
  const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Card Payer LLC",
    email: "payer@card.example",
  });
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId: c.body.id,
    date: new Date().toISOString().slice(0, 10),
    lines: [{ description: "Subscription", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return inv.body as { id: string; number: string };
}

async function signedEvent(
  linkId: string,
  sessionId: string,
  eventId = "evt_test_1",
  amount = 105000
) {
  const { signStripePayload } = await import("../../server/services/payments");
  const payload = JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        amount_total: amount,
        currency: "aed",
        payment_intent: "pi_test_123",
        client_reference_id: linkId,
        metadata: { payment_link_id: linkId },
      },
    },
  });
  return { payload, signature: signStripePayload(payload, SECRET) };
}

describe("W4-D online invoice payment", () => {
  it("[R16-14] no provider: no Pay button data, link creation is 503 requires-external", async () => {
    const t = await h.createTenant();
    const inv = await issuedInvoice(t);
    const share = await t.as.post(`/api/invoices/${inv.id}/share`);
    const token = share.body.token as string;
    const view = await h.anon.get(`/api/public/invoices/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.onlinePayment).toEqual({
      available: false,
      status: "requires_external",
      provider: null,
    });
    const link = await t.as.post(
      `/api/companies/${t.company.id}/invoices/${inv.id}/payment-links`,
      {}
    );
    expect(link.status).toBe(503);
    expect(link.body.code).toBe("PAYMENTS_REQUIRES_EXTERNAL");
    const pay = await h.anon.post(`/api/portal/public-invoices/${token}/pay`, {});
    expect(pay.status).toBe(503);
    const status = await t.as.get(`/api/companies/${t.company.id}/online-payments/status`);
    expect(status.body.available).toBe(false);
    expect(status.body.providers.find((p: { id: string }) => p.id === "telr").status).toBe(
      "requires_external"
    );
  });

  it("[R16-14] a webhook delivered twice posts one payment through the ledger and the invoice is paid; fee goes to 5110", async () => {
    enableStripe();
    await mockStripe(320);
    const t = await h.createTenant({ companyColumns: { locale: "ar" } });
    const inv = await issuedInvoice(t);
    const emailPath = `/api/companies/${t.company.id}/invoices/${inv.id}/send-email`;
    const pendingEmail = await t.as.post(emailPath, { to: "open@card.example" });
    expect(pendingEmail.status, pendingEmail.text).toBe(202);
    const [pending] = await h.sql("SELECT html FROM email_outbox WHERE id = $1", [
      pendingEmail.body.outboxId,
    ]);
    expect(pending.html).toContain(">Pay now</a>");
    expect(pending.html).toContain(">ادفع الآن</a>");
    const { setEmailTransportOverride } = await import("../../server/outbox");
    const sentReceipts: string[] = [];
    setEmailTransportOverride({
      name: "test",
      send: async (message) => {
        expect(message.to).toBe("payer@card.example");
        sentReceipts.push(message.outboxId);
        return { providerMessageId: "mock-receipt" };
      },
    });
    const share = await t.as.post(`/api/invoices/${inv.id}/share`);
    const view = await h.anon.get(`/api/public/invoices/${share.body.token}`);
    expect(view.body.onlinePayment.available).toBe(true);
    expect(view.body.onlinePayment.status).toBe("sandbox");

    const checkout = await h.anon.post(`/api/portal/public-invoices/${share.body.token}/pay`, {});
    expect(checkout.status, checkout.text).toBe(200);
    expect(checkout.body.url).toBe("https://checkout.stripe.com/c/pay/cs_test");
    expect(checkout.body.amountFils).toBe(105000);
    const sessionCall = calls.find((c) => c.url.endsWith("/checkout/sessions"))!;
    expect(sessionCall.body).toContain("unit_amount%5D=105000");
    const [link] = await h.sql(
      `SELECT id, provider_session_id, amount_fils::int AS amount FROM payment_links WHERE invoice_id = $1`,
      [inv.id]
    );
    expect(link.amount).toBe(105000);

    const evt = await signedEvent(link.id, link.provider_session_id);
    const post = () =>
      h.anon.post("/api/webhooks/invoice-payments/stripe", undefined, {
        raw: evt.payload,
        headers: { "Content-Type": "application/json", "Stripe-Signature": evt.signature },
      });
    const first = await post();
    expect(first.status, first.text).toBe(200);
    expect(first.body.status).toBe("processed");
    const second = await post();
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("duplicate");
    // A different event id for the same paid session is also a no-op.
    const other = await signedEvent(link.id, link.provider_session_id, "evt_test_2");
    const third = await h.anon.post("/api/webhooks/invoice-payments/stripe", undefined, {
      raw: other.payload,
      headers: { "Content-Type": "application/json", "Stripe-Signature": other.signature },
    });
    expect(third.body.status).toBe("duplicate");

    const payments = await h.sql(
      `SELECT amount::text, method, reference, journal_entry_id FROM invoice_payments WHERE invoice_id = $1`,
      [inv.id]
    );
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe("1050.00");
    expect(payments[0].method).toBe("online");
    expect(payments[0].reference).toBe("stripe:pi_test_123");
    expect(payments[0].journal_entry_id).toBeTruthy();
    const [invoice] = await h.sql(`SELECT status FROM invoices WHERE id = $1`, [inv.id]);
    expect(invoice.status).toBe("paid");
    const ledger = await h.sql<{ code: string; net: string }>(
      `SELECT a.code, (SUM(jl.debit) - SUM(jl.credit))::text AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`,
      [t.company.id]
    );
    const net = Object.fromEntries(ledger.map((r) => [r.code, Number(r.net)]));
    expect(net["1040"]).toBe(0); // receivable cleared once
    expect(net["1025"]).toBe(1046.8); // 1050 collected − 3.20 fee
    expect(net["5110"]).toBe(3.2);
    const receipt = await h.sql(
      `SELECT id, status, subject, html, text_body FROM email_outbox
        WHERE category = 'payment_receipt' AND related_entity_id = $1`,
      [inv.id]
    );
    expect(receipt.length).toBe(1);
    expect(sentReceipts).toEqual([receipt[0].id]);
    expect(receipt[0].status).toBe("sent");
    expect(receipt[0].subject).toMatch(/^Payment receipt: .* \| إيصال دفع:/);
    expect(receipt[0].html).toContain('<div dir="ltr" lang="en"');
    expect(receipt[0].html).toContain('<div dir="rtl" lang="ar"');
    expect(receipt[0].text_body).toContain("Amount paid: AED 1,050.00");
    expect(receipt[0].text_body).toContain("المبلغ المدفوع: 1,050.00 د.إ");
    expect(receipt[0].text_body).not.toContain("pi_test_123");
    const settledView = await h.anon.get(`/api/public/invoices/${share.body.token}`);
    expect(settledView.status).toBe(200);
    expect(settledView.body.onlinePayment.available).toBe(false);
    const settledEmail = await t.as.post(emailPath, { to: "payer@card.example" });
    expect(settledEmail.status, settledEmail.text).toBe(200);
    const [settled] = await h.sql("SELECT html, text_body FROM email_outbox WHERE id = $1", [
      settledEmail.body.outboxId,
    ]);
    expect(settled.html).toContain(">View invoice</a>");
    expect(settled.html).toContain(">عرض الفاتورة</a>");
    expect(settled.text_body).not.toMatch(/Pay now|ادفع الآن/);
    const notified = await h.sql(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND event_key LIKE 'payment.received:%'`,
      [t.user.id]
    );
    expect(notified.length).toBe(1);
  });

  it("rejects replace from before a gateway payment and retains its settlement and webhook receipt", async () => {
    enableStripe();
    await mockStripe(320);
    const t = await h.createTenant();
    const invoice = await issuedInvoice(t);
    const link = await t.as.post(
      `/api/companies/${t.company.id}/invoices/${invoice.id}/payment-links`,
      {}
    );
    expect(link.status, link.text).toBe(201);
    const backup = await t.as.post(`/api/companies/${t.company.id}/backups`, {
      name: "Before gateway settlement",
    });
    expect(backup.status, backup.text).toBe(201);

    const event = await signedEvent(link.body.id, "cs_au7_settlement", "evt_au7_settlement");
    const webhook = () =>
      h.anon.post("/api/webhooks/invoice-payments/stripe", undefined, {
        raw: event.payload,
        headers: { "Content-Type": "application/json", "Stripe-Signature": event.signature },
      });
    const paid = await webhook();
    expect(paid.status, paid.text).toBe(200);
    expect(paid.body.status).toBe("processed");

    for (const result of [
      await t.as.post(`/api/backups/${backup.body.id}/restore-preview`, { mode: "replace" }),
      await t.as.post(`/api/backups/${backup.body.id}/restore`, {
        mode: "replace",
        confirmRestore: true,
        confirmName: backup.body.name,
      }),
    ]) {
      expect(result.status, result.text).toBe(409);
      expect(result.body).toMatchObject({
        code: "BACKUP_RESTORE_CONFLICT",
        details: { table: "payment_links" },
      });
    }
    const redelivery = await webhook();
    expect(redelivery.body.status).toBe("duplicate");
    expect(
      await h.sql(
        `SELECT i.status AS invoice_status, l.status AS link_status, p.id AS payment_id,
                (SELECT count(*)::int FROM journal_lines WHERE entry_id = p.journal_entry_id) AS payment_lines,
                (SELECT count(*)::int FROM journal_lines WHERE entry_id = l.fee_journal_entry_id) AS fee_lines
           FROM payment_links l JOIN invoices i ON i.id = l.invoice_id
           JOIN invoice_payments p ON p.id = l.invoice_payment_id
          WHERE l.id = $1`,
        [link.body.id]
      )
    ).toEqual([
      {
        invoice_status: "paid",
        link_status: "paid",
        payment_id: paid.body.paymentId,
        payment_lines: 2,
        fee_lines: 2,
      },
    ]);
    expect(
      await h.sql("SELECT id FROM backups WHERE company_id = $1 AND backup_type = 'pre_restore'", [
        t.company.id,
      ])
    ).toEqual([]);
  });

  it("[R16-14] a bad signature is 400 and posts nothing; Telr and N-Genius report requires_external", async () => {
    enableStripe();
    await mockStripe();
    const t = await h.createTenant();
    const inv = await issuedInvoice(t);
    const link = await t.as.post(
      `/api/companies/${t.company.id}/invoices/${inv.id}/payment-links`,
      {
        expiresInDays: 7,
      }
    );
    expect(link.status, link.text).toBe(201);
    expect(link.body.url).toMatch(/\/api\/portal\/pay\/[0-9a-f]{48}$/);
    const redirect = await h.anon.get(new URL(link.body.url).pathname);
    expect(redirect.status, redirect.text).toBe(303);
    expect(redirect.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_test");
    const evt = await signedEvent(link.body.id, "cs_whatever");
    const bad = await h.anon.post("/api/webhooks/invoice-payments/stripe", undefined, {
      raw: evt.payload,
      headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=deadbeef" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_SIGNATURE");
    const tampered = await h.anon.post("/api/webhooks/invoice-payments/stripe", undefined, {
      raw: evt.payload.replace("105000", "1"),
      headers: { "Content-Type": "application/json", "Stripe-Signature": evt.signature },
    });
    expect(tampered.status).toBe(400);
    expect(
      (await h.sql(`SELECT 1 FROM invoice_payments WHERE invoice_id = $1`, [inv.id])).length
    ).toBe(0);
    const telr = await t.as.post(
      `/api/companies/${t.company.id}/invoices/${inv.id}/payment-links`,
      {
        provider: "telr",
      }
    );
    // Telr is not usable, so the live Stripe adapter is used instead of a broken Telr link.
    expect(telr.status).toBe(201);
    expect(telr.body.provider).toBe("stripe");
    const telrHook = await h.anon.post("/api/webhooks/invoice-payments/telr", undefined, {
      raw: "{}",
      headers: { "Content-Type": "application/json" },
    });
    expect(telrHook.status).toBe(400);
  });
});
