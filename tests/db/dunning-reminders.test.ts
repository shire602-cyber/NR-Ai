/**
 * W4-D dunning: R16-02, R16-03, R16-12, R16-17, R16-08 (outbox status).
 *
 * The scheduler's dunning engine is driven by reminder_settings and contacts the CUSTOMER
 * through the durable email outbox, exactly once per level, with catch-up after missed runs.
 * The harness has no email provider, so every message is honestly `blocked_no_provider`.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function contact(t: Tenant, name: string, email: string | null = "ap@customer.example") {
  const r = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name,
    ...(email ? { email } : {}),
    phone: "0501234567",
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body.id as string;
}

async function invoice(
  t: Tenant,
  contactId: string,
  opts: { dueDaysAgo: number; issue?: boolean; status?: "void" } = { dueDaysAgo: 5 }
) {
  const date = iso(new Date(Date.now() - (opts.dueDaysAgo + 30) * DAY));
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId,
    date,
    lines: [{ description: "Retainer", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  const id = c.body.id as string;
  if (opts.issue !== false) {
    const s = await t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
    expect(s.status, s.text).toBe(200);
  }
  if (opts.status === "void") {
    const v = await t.as.patch(`/api/invoices/${id}/status`, { status: "void" });
    expect(v.status, v.text).toBe(200);
  }
  await h.sql(`UPDATE invoices SET due_date = now() - ($2::int * interval '1 day') WHERE id = $1`, [
    id,
    opts.dueDaysAgo,
  ]);
  return id;
}

async function setting(t: Tenant, body: Record<string, unknown>) {
  const r = await t.as.post(`/api/companies/${t.company.id}/reminder-settings`, {
    reminderType: "invoice_overdue",
    isEnabled: true,
    daysAfterDue: 1,
    sendEmail: true,
    sendInApp: false,
    sendSms: false,
    ...body,
  });
  expect(r.status, r.text).toBe(200);
  return r.body.id as string;
}

async function dun(now = new Date()) {
  const { runDunningScan } = await import("../../server/services/scheduler.service");
  return runDunningScan(now);
}

const outboxFor = (invoiceId: string) =>
  h.sql<{ id: string; status: string; to_address: string; subject: string; html: string }>(
    `SELECT id, status, to_address, subject, html FROM email_outbox
      WHERE related_entity_id = $1 AND category = 'reminder' ORDER BY created_at`,
    [invoiceId]
  );

describe("W4-D dunning engine", () => {
  it("[R16-02] enabled settings queue a level-1 customer email for an overdue issued invoice exactly once across three runs", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Late Payer LLC");
    const inv = await invoice(t, cid, { dueDaysAgo: 5 });
    const sid = await setting(t, {});

    for (let i = 0; i < 3; i++) await dun();

    const mails = await outboxFor(inv);
    expect(mails.length).toBe(1);
    expect(mails[0].to_address).toBe("ap@customer.example");
    // No provider in the harness: queued and honestly blocked, never "sent".
    expect(mails[0].status).toBe("blocked_no_provider");
    expect(mails[0].html).toContain('<div dir="ltr" lang="en"');
    expect(mails[0].html).toContain('<div dir="rtl" lang="ar"');
    expect(mails[0].html).toContain("عرض الفاتورة");
    expect(mails[0].html).not.toContain("ادفع الآن");
    const att = await h.sql(
      `SELECT filename, content_type, size_bytes FROM email_outbox_attachments WHERE outbox_id = $1`,
      [mails[0].id]
    );
    expect(att.length).toBe(1);
    expect(att[0].content_type).toBe("application/pdf");
    expect(Number(att[0].size_bytes)).toBeGreaterThan(500);
    const logs = await h.sql(
      `SELECT level, channel, status, outbox_id, contact_id FROM reminder_logs
        WHERE reminder_setting_id = $1 AND related_entity_id = $2`,
      [sid, inv]
    );
    expect(logs.length).toBe(1);
    expect(logs[0]).toMatchObject({ level: 1, channel: "email", status: "blocked_no_provider" });
    expect(logs[0].outbox_id).toBe(mails[0].id);
    expect(logs[0].contact_id).toBe(cid);

    // The staff log view reports the outbox status, not a fake "sent".
    const api = await t.as.get(`/api/companies/${t.company.id}/reminder-logs`);
    expect(api.status).toBe(200);
    expect(api.body[0].status).toBe("blocked_no_provider");
  });

  it("[R16-02] disabled settings send nothing", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Quiet Customer");
    const inv = await invoice(t, cid, { dueDaysAgo: 10 });
    await setting(t, { isEnabled: false });
    await dun();
    expect((await outboxFor(inv)).length).toBe(0);
    expect(
      (await h.sql(`SELECT 1 FROM reminder_logs WHERE related_entity_id = $1`, [inv])).length
    ).toBe(0);
  });

  it("[R16-03] catch-up after missed runs: the highest due level fires once, earlier ones are logged skipped", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Missed Runs Co");
    // Levels at +1, +8, +15 days; due 20 days ago and the scheduler never ran.
    const inv = await invoice(t, cid, { dueDaysAgo: 20 });
    const sid = await setting(t, { repeatIntervalDays: 7, maxReminders: 3 });
    await dun();
    await dun();
    const logs = await h.sql<{ level: number; status: string }>(
      `SELECT level, status FROM reminder_logs WHERE reminder_setting_id = $1 AND related_entity_id = $2
        ORDER BY level`,
      [sid, inv]
    );
    expect(logs.map((l) => [l.level, l.status])).toEqual([
      [1, "skipped"],
      [2, "skipped"],
      [3, "blocked_no_provider"],
    ]);
    const mails = await outboxFor(inv);
    expect(mails.length).toBe(1);
    expect(mails[0].html).toContain("reminder 3");
  });

  it("[R16-03] a level becomes due on a later day: one more email the next day, never a repeat", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Next Day Co");
    const inv = await invoice(t, cid, { dueDaysAgo: 2 });
    await setting(t, { repeatIntervalDays: 7, maxReminders: 3 });
    await dun();
    expect((await outboxFor(inv)).length).toBe(1);
    await dun(new Date(Date.now() + 8 * DAY)); // +1 → level 1 sent, +8 → level 2 due now
    await dun(new Date(Date.now() + 8 * DAY));
    expect((await outboxFor(inv)).length).toBe(2);
  });

  it("[R16-03] drafts, void invoices and do-not-chase contacts are never reminded; the customer is the contact id", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Status Co");
    const draft = await invoice(t, cid, { dueDaysAgo: 9, issue: false });
    const voided = await invoice(t, cid, { dueDaysAgo: 9, status: "void" });
    const optedOut = await contact(t, "Opted Out Co", "optout@customer.example");
    const optInv = await invoice(t, optedOut, { dueDaysAgo: 9 });
    await h.sql(`UPDATE customer_contacts SET do_not_chase = true WHERE id = $1`, [optedOut]);
    // The invoice's customer name drifts from the contact: the contact id still wins.
    const renamed = await invoice(t, cid, { dueDaysAgo: 9 });
    await h.sql(`UPDATE invoices SET customer_name = 'Someone Else Entirely' WHERE id = $1`, [
      renamed,
    ]);
    await setting(t, {});
    await dun();
    expect((await outboxFor(draft)).length).toBe(0);
    expect((await outboxFor(voided)).length).toBe(0);
    expect((await outboxFor(optInv)).length).toBe(0);
    const mails = await outboxFor(renamed);
    expect(mails.length).toBe(1);
    expect(mails[0].to_address).toBe("ap@customer.example");
  });

  it("[R16-17] bilingual customer template, honoured custom subject, SMS behind a requires-external adapter, no WhatsApp", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Bilingual Co");
    const inv = await invoice(t, cid, { dueDaysAgo: 4 });
    const sid = await setting(t, {
      sendSms: true,
      sendWhatsapp: true,
      emailSubject: "Reminder: {{invoiceNumber}} for {{customerName}}",
    });
    await dun();
    const [mail] = await outboxFor(inv);
    expect(mail.subject).toMatch(/^Reminder: INV-.* for Bilingual Co$/);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain("فاتورة");
    expect(mail.html).toContain("/view/invoice/");
    const logs = await h.sql<{ channel: string; status: string }>(
      `SELECT channel, status FROM reminder_logs WHERE reminder_setting_id = $1 ORDER BY channel`,
      [sid]
    );
    expect(logs).toEqual([
      { channel: "email", status: "blocked_no_provider" },
      { channel: "sms", status: "requires_external" },
    ]);
  });

  it("[R16-12] /api/deadlines uses the invoice due date, partial status and the remaining balance in the invoice currency", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Deadline Co");
    const inv = await invoice(t, cid, { dueDaysAgo: 3 });
    const bank = await h.sql(`SELECT id FROM accounts WHERE company_id = $1 AND code = '1020'`, [
      t.company.id,
    ]);
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${inv}/payments`, {
      date: iso(new Date()),
      method: "bank",
      paymentAccountId: bank[0].id,
      amount: 400,
    });
    expect(pay.status, pay.text).toBeLessThan(300);
    const r = await t.as.get(`/api/deadlines?companyId=${t.company.id}`);
    expect(r.status).toBe(200);
    const row = r.body.find((d: { relatedEntityId?: string }) => d.relatedEntityId === inv);
    expect(row).toBeTruthy();
    expect(row.type).toBe("invoice_overdue");
    expect(row.amountDue).toBe(650);
    expect(row.description).toContain("AED 650.00");
    expect(row.daysRemaining).toBeLessThanOrEqual(-2);
  });
});
