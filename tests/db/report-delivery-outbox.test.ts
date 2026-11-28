/**
 * W5-A report delivery on the real app + Postgres (R12-01, R12-10).
 *
 * A queued delivery renders a PDF + XLSX pack server-side, stores both on
 * company_report_delivery_artifacts and sends them through the email outbox. The run status
 * reports only what happened: sent (provider accepted), failed (provider error; the outbox
 * retries), blocked (no provider: nothing sent). Google Sheets is refused (422) while the
 * integration is unconfigured.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const SUB = "owner-weekly-executive-delivery";

afterEach(async () => {
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
});

async function useTransport(send: (msg: unknown) => Promise<{ providerMessageId: string | null }>) {
  const { setEmailTransportOverride } = await import("../../server/outbox");
  const fn = vi.fn(send);
  setEmailTransportOverride({ name: "test", send: fn as never });
  return fn;
}

async function withBooks(): Promise<Tenant> {
  const t = await h.createTenant();
  const today = dubaiToday();
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Delivery Customer LLC",
    date: today,
    lines: [{ description: "Advisory", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return t;
}

describe("W5-A report delivery through the outbox", () => {
  it("[R12-01] queue renders PDF + XLSX artefacts and emails them to the recipients; run is sent", async () => {
    const t = await withBooks();
    const send = await useTransport(async () => ({ providerMessageId: "msg-1" }));
    const r = await t.as.post(
      `/api/companies/${t.company.id}/report-delivery/subscriptions/${SUB}/queue`,
      {}
    );
    expect(r.status, r.text).toBe(201);
    expect(r.body.run.status).toBe("sent");
    expect(r.body.run.recipientAddresses).toEqual([t.email.toLowerCase()]);
    expect(r.body.subscription.channel).toBe("Email with PDF and Excel attachments");
    expect(r.body.notification.title).toContain("Report delivery sent");

    const artifacts = await h.sql<{ kind: string; filename: string; size_bytes: number }>(
      `SELECT kind, filename, size_bytes FROM company_report_delivery_artifacts WHERE run_id = $1 ORDER BY kind`,
      [r.body.run.id]
    );
    expect(artifacts.map((a) => a.kind)).toEqual(["pdf", "xlsx"]);
    expect(artifacts.every((a) => a.size_bytes > 1000)).toBe(true);

    const outbox = await h.sql<{
      id: string;
      to_address: string;
      status: string;
      category: string;
    }>(`SELECT id, to_address, status, category FROM email_outbox WHERE related_entity_id = $1`, [
      r.body.run.id,
    ]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      to_address: t.email.toLowerCase(),
      status: "sent",
      category: "report_delivery",
    });
    const attachments = await h.sql<{ filename: string; content_type: string }>(
      `SELECT filename, content_type FROM email_outbox_attachments WHERE outbox_id = $1 ORDER BY filename`,
      [outbox[0].id]
    );
    expect(attachments.map((a) => a.filename.split(".").pop()).sort()).toEqual(["pdf", "xlsx"]);
    expect(send).toHaveBeenCalledTimes(1);

    const list = await t.as.get(
      `/api/companies/${t.company.id}/report-delivery/runs/${r.body.run.id}/artifacts`
    );
    expect(list.status, list.text).toBe(200);
    expect(list.body.artifacts).toHaveLength(2);
    const pdf = list.body.artifacts.find((a: { kind: string }) => a.kind === "pdf");
    const dl = await t.as.get(pdf.href);
    expect(dl.status).toBe(200);
    expect(dl.headers.get?.("content-type") ?? dl.headers["content-type"]).toContain(
      "application/pdf"
    );
  });

  it("[R12-01] provider failure marks the run failed with a scheduled retry; manual retry sends and supersedes it", async () => {
    const t = await withBooks();
    const { EmailTransportError } = await import("../../server/outbox");
    await useTransport(async () => {
      throw new EmailTransportError("provider down", false);
    });
    const r = await t.as.post(
      `/api/companies/${t.company.id}/report-delivery/subscriptions/${SUB}/queue`,
      {}
    );
    expect(r.status, r.text).toBe(201);
    expect(r.body.run.status).toBe("failed");
    expect(r.body.run.errorMessage).toContain("provider down");
    expect(r.body.run.retryScheduledAt).toBeTruthy();
    const [ob] = await h.sql<{ id: string; status: string }>(
      `SELECT id, status FROM email_outbox WHERE related_entity_id = $1`,
      [r.body.run.id]
    );
    expect(ob.status).toBe("retrying");

    // The failed run is a handoff gap: queueing again needs acknowledgement.
    const again = await t.as.post(
      `/api/companies/${t.company.id}/report-delivery/subscriptions/${SUB}/queue`,
      {}
    );
    expect(again.status).toBe(409);
    expect(again.body.handoffReview.gap).toBe("delivery-gaps");

    await useTransport(async () => ({ providerMessageId: "msg-2" }));
    const retry = await t.as.post(
      `/api/companies/${t.company.id}/report-delivery/runs/${r.body.run.id}/retry`,
      {}
    );
    expect(retry.status, retry.text).toBe(201);
    expect(retry.body.run.status).toBe("sent");
    expect(retry.body.run.retriedFromRunId).toBe(r.body.run.id);
    const [old] = await h.sql<{ status: string }>(`SELECT status FROM email_outbox WHERE id = $1`, [
      ob.id,
    ]);
    expect(old.status).toBe("cancelled");
  });

  it("[R12-01] no email provider: run is blocked (no_email_provider), artefacts kept, nothing sent", async () => {
    const t = await withBooks();
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    const r = await t.as.post(
      `/api/companies/${t.company.id}/report-delivery/subscriptions/${SUB}/queue`,
      {}
    );
    expect(r.status, r.text).toBe(201);
    expect(r.body.run.status).toBe("blocked");
    expect(r.body.run.blockedReason).toBe("no_email_provider");
    expect(r.body.notification.title).toContain("blocked");
    const outbox = await h.sql(`SELECT id FROM email_outbox WHERE related_entity_id = $1`, [
      r.body.run.id,
    ]);
    expect(outbox).toHaveLength(0);
    const artifacts = await h.sql(
      `SELECT id FROM company_report_delivery_artifacts WHERE run_id = $1`,
      [r.body.run.id]
    );
    expect(artifacts).toHaveLength(2);
    const channels = await t.as.get(`/api/companies/${t.company.id}/report-delivery/channels`);
    expect(channels.body).toMatchObject({
      email: { available: false },
      googleSheets: { available: false },
    });
  });

  it("[R12-10] Google Sheets channel is refused with 422 while the integration is unconfigured", async () => {
    const t = await h.createTenant();
    const r = await t.as.patch(
      `/api/companies/${t.company.id}/report-delivery/subscriptions/${SUB}/settings`,
      { channel: "Google Sheets workbook" }
    );
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("GOOGLE_SHEETS_NOT_CONFIGURED");
    const subs = await t.as.get(`/api/companies/${t.company.id}/report-delivery/subscriptions`);
    for (const s of subs.body.subscriptions) {
      expect(s.channel).not.toMatch(/sheets/i);
    }
  });

  it("[R12-01] another tenant cannot list or download a run's artefacts", async () => {
    const a = await withBooks();
    await useTransport(async () => ({ providerMessageId: "msg-3" }));
    const r = await a.as.post(
      `/api/companies/${a.company.id}/report-delivery/subscriptions/${SUB}/queue`,
      {}
    );
    expect(r.status, r.text).toBe(201);
    const b = await h.createSecondTenant();
    const leak = await b.as.get(
      `/api/companies/${a.company.id}/report-delivery/runs/${r.body.run.id}/artifacts`
    );
    expect([403, 404]).toContain(leak.status);
    const own = await b.as.get(
      `/api/companies/${b.company.id}/report-delivery/runs/${r.body.run.id}/artifacts`
    );
    expect(own.status).toBe(404);
  });
});
