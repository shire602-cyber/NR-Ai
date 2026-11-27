/**
 * W4-D email outbox (R16-08): any provider passes the send gate (Resend-only included), no
 * provider means `blocked_no_provider` and never "sent", attachments travel with the message,
 * failures retry with backoff and dead-letter after max attempts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const resendSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

const h = useHarness();

afterEach(async () => {
  delete process.env.RESEND_API_KEY;
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
  resendSend.mockReset();
});

async function issued(t: Tenant) {
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Mail Co",
    date: dubaiToday(),
    lines: [{ description: "Work", quantity: 1, unitPrice: 200, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  return inv.body.id as string;
}

describe("W4-D email outbox", () => {
  it("shows normalized subjects for legacy notification events while preserving delivery history", async () => {
    const t = await h.createTenant();
    const subject = "Old review notification";
    const key = `notif:bank.sync_failed:fixture:${t.user.id}`;
    const [legacy] = await h.sql<{ id: string }>(
      `INSERT INTO email_outbox (company_id, to_address, subject, category, status, idempotency_key, sent_at)
       VALUES ($1, $2, $3, 'notification', 'delivered', $4, now()) RETURNING id`,
      [t.company.id, t.email, subject, key]
    );
    const [unrelated] = await h.sql<{ id: string }>(
      `INSERT INTO email_outbox (company_id, to_address, subject, category, status, idempotency_key, sent_at)
       VALUES ($1, $2, 'Task due tomorrow', 'notification', 'sent', $3, now()) RETURNING id`,
      [t.company.id, t.email, `notif:task.due:fixture:${t.user.id}`]
    );
    const reply = await t.as.get(`/api/companies/${t.company.id}/email-outbox`);
    expect(reply.status, reply.text).toBe(200);
    const visible = reply.body.find((row: { id: string }) => row.id === legacy.id);
    expect(visible).toMatchObject({ subject: BANK_RECONCILIATION_COPY.en, status: "delivered" });
    expect(visible).not.toHaveProperty("idempotencyKey");
    expect(reply.body.find((row: { id: string }) => row.id === unrelated.id)?.subject).toBe(
      "Task due tomorrow"
    );
    expect(
      await h.sql(`SELECT subject, status FROM email_outbox WHERE id = $1`, [legacy.id])
    ).toEqual([{ subject, status: "delivered" }]);
  });

  it("[R16-08] no provider: send-email is queued as blocked_no_provider with the PDF, never reported sent", async () => {
    const t = await h.createTenant();
    const id = await issued(t);
    const r = await t.as.post(`/api/companies/${t.company.id}/invoices/${id}/send-email`, {
      to: "client@mail.example",
    });
    expect(r.status, r.text).toBe(202);
    expect(r.body).toMatchObject({ sent: false, queued: true, status: "blocked_no_provider" });
    expect(r.body.message).toContain("Email not configured");
    const invoice = await t.as.get(`/api/invoices/${id}`);
    expect(invoice.body.number).toMatch(/^INV-/);
    expect(r.body.message).toContain(`Invoice ${invoice.body.number}`);
    const [row] = await h.sql(`SELECT status, attempts FROM email_outbox WHERE id = $1`, [
      r.body.outboxId,
    ]);
    expect(row.status).toBe("blocked_no_provider");
    const att = await h.sql(`SELECT filename FROM email_outbox_attachments WHERE outbox_id = $1`, [
      r.body.outboxId,
    ]);
    expect(att[0].filename).toMatch(/^invoice-.*\.pdf$/);
    const status = await t.as.get(`/api/companies/${t.company.id}/email-outbox/status`);
    expect(status.body.configured).toBe(false);
    const log = await h.sql(
      `SELECT description FROM activity_logs WHERE entity_id = $1 AND action = 'send'`,
      [id]
    );
    expect(log[0].description).toContain("queued");
  });

  it("[R16-08] a Resend-only deployment passes the gate and the attachment reaches the provider", async () => {
    process.env.RESEND_API_KEY = "re_test_only_resend";
    resendSend.mockResolvedValue({ data: { id: "re_msg_1" }, error: null });
    const t = await h.createTenant();
    const id = await issued(t);
    const r = await t.as.post(`/api/companies/${t.company.id}/invoices/${id}/send-email`, {
      to: "client@mail.example",
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ sent: true, status: "sent" });
    // W5-E: registration also sends a verification email; pick the invoice email.
    const sent = resendSend.mock.calls.map((c) => c[0]).find((m) => m.to === "client@mail.example");
    expect(sent.to).toBe("client@mail.example");
    expect(sent.attachments[0].filename).toMatch(/\.pdf$/);
    expect(Buffer.isBuffer(sent.attachments[0].content)).toBe(true);
    const [row] = await h.sql(
      `SELECT status, provider, provider_message_id FROM email_outbox WHERE id = $1`,
      [r.body.outboxId]
    );
    expect(row).toEqual({ status: "sent", provider: "resend", provider_message_id: "re_msg_1" });
  });

  it("[R16-08] provider errors retry with backoff, then dead-letter; a Resend error response is not 'sent'", async () => {
    process.env.RESEND_API_KEY = "re_test_only_resend";
    resendSend.mockResolvedValue({
      data: null,
      error: { message: "rate limited", statusCode: 429 },
    });
    const { sendEmail } = await import("../../server/services/email.service");
    const r = await sendEmail("x@retry.example", "Hello", "Body");
    expect(r.sent).toBe(false);
    expect(r.status).toBe("retrying");
    const { processOutbox } = await import("../../server/outbox");
    for (let i = 0; i < 6; i++) {
      await h.sql(
        `UPDATE email_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = $1`,
        [r.id]
      );
      await processOutbox();
    }
    const [row] = await h.sql(`SELECT status, attempts, dead_at FROM email_outbox WHERE id = $1`, [
      r.id,
    ]);
    expect(row.status).toBe("dead");
    expect(row.attempts).toBe(6);
    expect(row.dead_at).not.toBeNull();
    const events = await h.sql(
      `SELECT event_type FROM email_delivery_events WHERE outbox_id = $1`,
      [r.id]
    );
    expect(events.map((e) => e.event_type)).toContain("dead");

    // A permanent rejection (4xx) is dead at once.
    resendSend.mockResolvedValue({ data: null, error: { message: "invalid to", statusCode: 422 } });
    const p = await sendEmail("bad@address.example", "Hello", "Body");
    expect(p.status).toBe("dead");
  });

  it("[R16-17] delivery webhooks: bounce via signed Resend event, SMTP DSN with the shared secret", async () => {
    process.env.RESEND_API_KEY = "re_test_only_resend";
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from("w4d-secret").toString("base64")}`;
    process.env.EMAIL_DSN_WEBHOOK_SECRET = "dsn-secret";
    resendSend.mockResolvedValue({ data: { id: "re_bounce_1" }, error: null });
    const { sendEmail } = await import("../../server/services/email.service");
    const r = await sendEmail("bounce@bounce.example", "Hi", "Body");
    expect(r.status).toBe("sent");
    const crypto = await import("node:crypto");
    const body = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "re_bounce_1", bounce: { type: "Permanent", message: "mailbox unknown" } },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto
      .createHmac("sha256", Buffer.from("w4d-secret"))
      .update(`msg_1.${ts}.${body}`)
      .digest("base64");
    const bad = await h.anon.post("/api/webhooks/email-events/resend", undefined, {
      raw: body,
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_1",
        "svix-timestamp": ts,
        "svix-signature": "v1,AAAA",
      },
    });
    expect(bad.status).toBe(400);
    const ok = await h.anon.post("/api/webhooks/email-events/resend", undefined, {
      raw: body,
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_1",
        "svix-timestamp": ts,
        "svix-signature": `v1,${sig}`,
      },
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.matched).toBe(true);
    const [row] = await h.sql(`SELECT status, last_error FROM email_outbox WHERE id = $1`, [r.id]);
    expect(row.status).toBe("bounced");
    expect(row.last_error).toContain("mailbox unknown");

    const r2 = await sendEmail("dsn@smtp.example", "Hi", "Body");
    const dsn = [
      "Reporting-MTA: dns; mx.example",
      `Original-Message-ID: <outbox-${r2.id}@muhasib.ai>`,
      "",
      "Final-Recipient: rfc822; dsn@smtp.example",
      "Action: delivered",
      "Status: 2.0.0",
    ].join("\r\n");
    expect(
      (
        await h.anon.post("/api/webhooks/email-events/smtp-dsn", undefined, {
          raw: dsn,
          headers: { "Content-Type": "message/delivery-status", "x-webhook-secret": "wrong" },
        })
      ).status
    ).toBe(401);
    const d = await h.anon.post("/api/webhooks/email-events/smtp-dsn", undefined, {
      raw: dsn,
      headers: { "Content-Type": "message/delivery-status", "x-webhook-secret": "dsn-secret" },
    });
    expect(d.status, d.text).toBe(200);
    const [row2] = await h.sql(`SELECT status FROM email_outbox WHERE id = $1`, [r2.id]);
    expect(row2.status).toBe("delivered");
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.EMAIL_DSN_WEBHOOK_SECRET;
  });
});
