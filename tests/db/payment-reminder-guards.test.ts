/**
 * Payment reminders go only to issued, open, opted-in invoices: a draft, a cancelled invoice or a
 * customer / invoice marked do-not-chase never gets an e-mail, and nothing is queued for them.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const DATE = new Date().toISOString().slice(0, 10);
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function setup(t: Tenant, status: string | null) {
  const c = await t.as.post(`${base(t)}/customer-contacts`, {
    name: "Gulf Retail LLC",
    email: "ap@gulfretail.example",
    emirate: "dubai",
  });
  expect(c.status, c.text).toBeLessThan(300);
  const r = await t.as.post(`${base(t)}/invoices`, {
    contactId: c.body.id,
    date: DATE,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
  });
  expect(r.status, r.text).toBe(200);
  if (status) {
    const s = await t.as.patch(`/api/invoices/${r.body.id}/status`, { status });
    expect(s.status, s.text).toBe(200);
  }
  return { contactId: c.body.id as string, invoiceId: r.body.id as string };
}

async function reminderRows(to: string) {
  return h.sql(`SELECT 1 FROM email_outbox WHERE category = 'reminder' AND to_address = $1`, [to]);
}

describe("payment reminder guards", () => {
  it("refuses a reminder for a draft invoice", async () => {
    const t = await h.createTenant();
    const { invoiceId } = await setup(t, null);
    const r = await t.as.post(`${base(t)}/invoices/${invoiceId}/send-reminder`, {
      to: "draft@example.test",
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVOICE_NOT_CHASEABLE");
    expect(await reminderRows("draft@example.test")).toHaveLength(0);
  });

  it("refuses a reminder when the customer is marked do-not-chase", async () => {
    const t = await h.createTenant();
    const { invoiceId, contactId } = await setup(t, "sent");
    await h.sql(`UPDATE customer_contacts SET do_not_chase = true WHERE id = $1`, [contactId]);
    const r = await t.as.post(`${base(t)}/invoices/${invoiceId}/send-reminder`, {
      to: "dnc@example.test",
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVOICE_NOT_CHASEABLE");
    expect(await reminderRows("dnc@example.test")).toHaveLength(0);
  });

  it("refuses a reminder when the invoice is marked do-not-chase", async () => {
    const t = await h.createTenant();
    const { invoiceId } = await setup(t, "sent");
    await h.sql(`UPDATE invoices SET do_not_chase = true WHERE id = $1`, [invoiceId]);
    const r = await t.as.post(`${base(t)}/invoices/${invoiceId}/send-reminder`, {
      to: "inv-dnc@example.test",
    });
    expect(r.status).toBe(400);
    expect(await reminderRows("inv-dnc@example.test")).toHaveLength(0);
  });

  it("still sends for an issued, open invoice", async () => {
    const t = await h.createTenant();
    const { invoiceId } = await setup(t, "sent");
    const r = await t.as.post(`${base(t)}/invoices/${invoiceId}/send-reminder`, {
      to: "ok@example.test",
    });
    expect(r.status, r.text).toBeLessThan(300);
  });

  it.each(["contact flag", "chase config"])(
    "the single chase endpoint reports the customer opt-out from the %s",
    async (source) => {
      const t = await h.createTenant();
      const { invoiceId, contactId } = await setup(t, "sent");
      if (source === "contact flag") {
        await h.sql(`UPDATE customer_contacts SET do_not_chase = true WHERE id = $1`, [contactId]);
      } else {
        const config = await t.as.patch(`/api/chasing/config/${t.company.id}`, {
          doNotChaseContactIds: [contactId],
        });
        expect(config.status, config.text).toBe(200);
      }
      await h.sql(`UPDATE invoices SET due_date = now() - interval '10 days' WHERE id = $1`, [
        invoiceId,
      ]);
      const r = await t.as.post(`/api/chasing/send/${invoiceId}`, { method: "manual" });
      expect(r.status, r.text).toBe(409);
      expect(r.body.code).toBe("CUSTOMER_DO_NOT_CHASE");
    }
  );

  it("excludes opted-out customers from the queue and the 200-invoice bulk cap", async () => {
    const t = await h.createTenant();
    const eligible = await setup(t, "sent");
    const optedOut = await t.as.post(`${base(t)}/customer-contacts`, {
      name: "Opted-out customer",
      emirate: "dubai",
    });
    expect(optedOut.status, optedOut.text).toBeLessThan(300);
    await h.sql(
      `UPDATE customer_contacts SET do_not_chase = true, is_active = false WHERE id = $1`,
      [optedOut.body.id]
    );
    await h.sql(
      `UPDATE invoices SET date = now() - interval '30 days', due_date = now() - interval '5 days'
       WHERE id = $1`,
      [eligible.invoiceId]
    );
    // Invoices are loaded newest first. All 201 opted-out invoices precede the eligible one.
    await h.sql(
      `INSERT INTO invoices
         (company_id, contact_id, number, customer_name, date, due_date, issued_at, status, total)
       SELECT $1, $2, 'DNC-' || n, 'Opted-out customer', now() - interval '15 days',
              now() - interval '10 days', now() - interval '15 days', 'sent', 100
       FROM generate_series(1, 201) AS n`,
      [t.company.id, optedOut.body.id]
    );

    const queue = await t.as.get(`/api/chasing/queue/${t.company.id}`);
    expect(queue.status, queue.text).toBe(200);
    expect(queue.body.queue).toMatchObject([{ invoice: { id: eligible.invoiceId }, nextLevel: 1 }]);

    const bulk = await t.as.post(`/api/chasing/bulk-send/${t.company.id}`, {
      method: "manual",
      language: "en",
    });
    expect(bulk.status, bulk.text).toBe(200);
    expect(bulk.body).toMatchObject({
      eligibleTotal: 1,
      truncated: false,
      sent: 1,
      skipped: 0,
      failed: 0,
      results: [{ invoiceId: eligible.invoiceId, level: 1, status: "sent" }],
    });
    const history = await t.as.get(`/api/chasing/history/${t.company.id}`);
    expect(history.status, history.text).toBe(200);
    expect(history.body).toMatchObject([{ invoiceId: eligible.invoiceId }]);
  });
});
