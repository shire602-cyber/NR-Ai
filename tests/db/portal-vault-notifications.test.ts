/**
 * W4-D: document vault (R16-09), document versions (R16-10), push endpoints (R16-11),
 * notification engine (R13-32, R13-33, R16-18).
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { bankStatementCopy } from "../../shared/bank-statement-copy";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex"
);

function multipart(
  fields: Record<string, string>,
  file: { name: string; type: string; data: Buffer }
) {
  const boundary = `----w4d${crypto.randomBytes(8).toString("hex")}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return {
    raw: Buffer.concat(parts),
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(
  t: Tenant,
  fields: Record<string, string>,
  file: { name: string; type: string; data: Buffer }
) {
  const m = multipart(fields, file);
  return t.as.post(`/api/companies/${t.company.id}/documents`, undefined, m);
}

describe("W4-D document vault", () => {
  it("[R16-09] multipart upload stores the bytes under a storage key; a mismatched or unknown type is rejected", async () => {
    const t = await h.createTenant();
    const ok = await upload(
      t,
      { name: "Trade licence", category: "trade_license" },
      {
        name: "licence.pdf",
        type: "application/pdf",
        data: PDF,
      }
    );
    expect(ok.status, ok.text).toBe(201);
    const [row] = await h.sql(
      `SELECT storage_key, file_url, file_size, mime_type, sha256, current_version FROM documents WHERE id = $1`,
      [ok.body.id]
    );
    expect(row.storage_key).toBeTruthy();
    expect(row.file_url).toBe(`/api/documents/${ok.body.id}/download`);
    expect(row.file_size).toBe(PDF.length);
    expect(row.mime_type).toBe("application/pdf");
    expect(row.sha256).toBe(crypto.createHash("sha256").update(PDF).digest("hex"));
    const dl = await t.as.get(`/api/documents/${ok.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dl.text).toBe(PDF.toString("latin1"));

    const mismatch = await upload(
      t,
      { name: "fake" },
      { name: "x.pdf", type: "application/pdf", data: PNG }
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.code).toBe("FILE_TYPE_MISMATCH");
    const junk = await upload(
      t,
      {},
      {
        name: "x.exe",
        type: "application/octet-stream",
        data: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0xff, 0x00, 0x00]),
      }
    );
    expect(junk.status).toBe(400);
    expect(junk.body.code).toBe("UNSUPPORTED_FILE");
    // A client can no longer assert an internal storage key or a script URL.
    const forged = await t.as.post(`/api/companies/${t.company.id}/documents`, {
      name: "d",
      fileUrl: "/uploads/someone-elses.pdf",
      fileName: "d.pdf",
    });
    expect(forged.status).toBe(400);
    expect(forged.body.code).toBe("UPLOAD_REQUIRED");
    // Server-owned keys are rejected on the multipart path too.
    expect(
      (await upload(t, { companyId: "x" }, { name: "a.pdf", type: "application/pdf", data: PDF }))
        .status
    ).toBe(400);

    // Versions, restore and soft delete.
    const v2 = await t.as.post(
      `/api/documents/${ok.body.id}/versions`,
      undefined,
      multipart(
        { note: "renewed" },
        {
          name: "licence-2026.pdf",
          type: "application/pdf",
          data: Buffer.concat([PDF, Buffer.from("v2")]),
        }
      )
    );
    expect(v2.status, v2.text).toBe(201);
    expect(v2.body.version).toBe(2);
    const restored = await t.as.post(`/api/documents/${ok.body.id}/versions/1/restore`);
    expect(restored.status).toBe(201);
    expect(restored.body.version).toBe(3);
    const versions = await t.as.get(`/api/documents/${ok.body.id}/versions`);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect((await t.as.delete(`/api/documents/${ok.body.id}`)).status).toBe(200);
    const list = await t.as.get(`/api/companies/${t.company.id}/documents`);
    expect(list.body.map((d: { id: string }) => d.id)).not.toContain(ok.body.id);
    const kept = await h.sql(`SELECT deleted_at FROM documents WHERE id = $1`, [ok.body.id]);
    expect(kept[0].deleted_at).not.toBeNull();
    const other = await h.createSecondTenant();
    expect((await other.as.get(`/api/documents/${ok.body.id}/download`)).status).toBe(404);
  });

  it("[R16-10] document versions: existence + ownership checked, server-side snapshot, unique numbers under parallel writes", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Versioned Co",
      date: new Date().toISOString().slice(0, 10),
      lines: [{ description: "Line", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    expect(inv.status).toBe(200);
    const url = `/api/companies/${t.company.id}/document-versions`;
    expect(
      (await t.as.post(url, { documentType: "invoice", documentId: crypto.randomUUID() })).status
    ).toBe(404);
    const otherInv = await other.as.post(`/api/companies/${other.company.id}/invoices`, {
      customerName: "Not yours",
      date: new Date().toISOString().slice(0, 10),
      lines: [{ description: "Line", quantity: 1, unitPrice: 1, vatRate: 5 }],
    });
    expect(
      (await t.as.post(url, { documentType: "invoice", documentId: otherInv.body.id })).status
    ).toBe(404);
    expect(
      (
        await t.as.post(url, {
          documentType: "invoice",
          documentId: inv.body.id,
          snapshotData: { total: 1 },
        })
      ).status
    ).toBe(400);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        t.as.post(url, {
          documentType: "invoice",
          documentId: inv.body.id,
          changeDescription: `edit ${i}`,
        })
      )
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const nums = results.map((r) => r.body.version).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const snap = JSON.parse(results[0].body.snapshotData);
    expect(snap.number).toBe(inv.body.number);
    expect(Array.isArray(snap.lines)).toBe(true);
    const diff = await t.as.get(
      `/api/companies/${t.company.id}/document-versions/invoice/${inv.body.id}/diff?from=1&to=2`
    );
    expect(diff.status).toBe(200);
    expect(diff.body.changes).toEqual([]);
  });
});

describe("W4-D push subscriptions", () => {
  it("[R16-11] push endpoints must be https on a public host; unsubscribe only touches the caller's own row", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const keys = { p256dh: "B".repeat(40), auth: "A".repeat(16) };
    for (const endpoint of [
      "http://169.254.169.254/latest/meta-data",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/push",
      "https://127.0.0.1/push",
      "javascript:alert(1)",
    ]) {
      const r = await a.as.post("/api/push/subscribe", { endpoint, keys });
      expect(r.status, endpoint).toBe(400);
    }
    const good = await a.as.post("/api/push/subscribe", {
      endpoint: "https://8.8.8.8/push/abc",
      keys,
    });
    expect(good.status, good.text).toBe(201);
    const again = await a.as.post("/api/push/subscribe", {
      endpoint: "https://8.8.8.8/push/abc",
      keys,
    });
    expect(again.body.id).toBe(good.body.id);
    await b.as.delete("/api/push/unsubscribe", { endpoint: "https://8.8.8.8/push/abc" });
    const [row] = await h.sql(`SELECT is_active FROM push_subscriptions WHERE id = $1`, [
      good.body.id,
    ]);
    expect(row.is_active).toBe(true);
    const mine = await a.as.delete("/api/push/unsubscribe", {
      endpoint: "https://8.8.8.8/push/abc",
    });
    expect(mine.body.unsubscribed).toBe(1);
    // VAPID missing: an honest capability answer, never a 500.
    const vapid = await h.anon.get("/api/push/vapid-key");
    expect(vapid.status).toBe(200);
    expect(vapid.body.configured).toBe(false);
    expect(vapid.body.publicKey).toBeNull();
  });
});

describe("W4-D notification engine", () => {
  async function emit(type: string, payload: Record<string, unknown>) {
    const { emitDomainEvent, drainDomainEvents } =
      await import("../../server/platform/domain-events");
    emitDomainEvent(type as never, payload as never);
    await drainDomainEvents();
  }

  it("[R13-32] compliance.deadline_due creates a staff notification once, and a disabled preference suppresses it", async () => {
    const t = await h.createTenant();
    const entityId = crypto.randomUUID();
    const payload = {
      companyId: t.company.id,
      entityId,
      obligation: "VAT return Q3",
      dueDate: "2026-10-28",
    };
    await emit("compliance.deadline_due", payload);
    await emit("compliance.deadline_due", payload);
    const rows = await h.sql(
      `SELECT type, title, priority FROM notifications WHERE user_id = $1 AND event_key LIKE 'compliance.deadline_due:%'`,
      [t.user.id]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe("deadline");
    expect(rows[0].priority).toBe("high");

    const u = await h.createSecondTenant();
    const pref = await u.as.put("/api/notification-preferences", {
      typePreferences: { "compliance.deadline_due": { inApp: false, email: false } },
    });
    expect(pref.status, pref.text).toBe(200);
    await emit("compliance.deadline_due", {
      ...payload,
      companyId: u.company.id,
      entityId: crypto.randomUUID(),
    });
    expect(
      (
        await h.sql(`SELECT 1 FROM notifications WHERE user_id = $1 AND event_key IS NOT NULL`, [
          u.user.id,
        ])
      ).length
    ).toBe(0);
    // The legacy category switch is honoured as well.
    const v = await h.createSecondTenant();
    await v.as.put("/api/notification-preferences", { vatDeadlines: false });
    await emit("compliance.deadline_due", {
      ...payload,
      companyId: v.company.id,
      entityId: crypto.randomUUID(),
    });
    expect(
      (
        await h.sql(`SELECT 1 FROM notifications WHERE user_id = $1 AND event_key IS NOT NULL`, [
          v.user.id,
        ])
      ).length
    ).toBe(0);
  });

  it("[R13-32] payment received, bank sync failure, task due and overdue invoices all notify staff", async () => {
    const t = await h.createTenant();
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Notify Co",
      date: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10),
      lines: [{ description: "Line", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const bank = await h.sql(`SELECT id FROM accounts WHERE company_id = $1 AND code = '1020'`, [
      t.company.id,
    ]);
    await t.as.post(`/api/companies/${t.company.id}/invoices/${inv.body.id}/payments`, {
      date: new Date().toISOString().slice(0, 10),
      method: "bank",
      paymentAccountId: bank[0].id,
      amount: 20,
    });
    await emit("bank.sync_failed", {
      companyId: t.company.id,
      entityId: crypto.randomUUID(),
      provider: "lean",
    });
    await emit("task.due", {
      companyId: t.company.id,
      entityId: crypto.randomUUID(),
      dueDate: "2026-12-01",
    });
    await h.sql(`UPDATE invoices SET due_date = now() - interval '3 days' WHERE id = $1`, [
      inv.body.id,
    ]);
    const { scanOverdueInvoices } =
      await import("../../server/services/notification-engine.service");
    await scanOverdueInvoices();
    await scanOverdueInvoices();
    const { drainDomainEvents } = await import("../../server/platform/domain-events");
    await drainDomainEvents();
    const keys = (
      await h.sql<{ event_key: string }>(
        `SELECT event_key FROM notifications WHERE user_id = $1 AND event_key IS NOT NULL ORDER BY event_key`,
        [t.user.id]
      )
    ).map((r) => r.event_key.split(":")[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        "bank.sync_failed",
        "invoice.issued",
        "invoice.overdue",
        "payment.received",
        "task.due",
      ])
    );
    expect(keys.filter((k) => k === "invoice.overdue").length).toBe(1);
  });

  it("[R16-18][R13-33] per-type email choice goes through the outbox with an honest status; daily digest batches", async () => {
    const t = await h.createTenant();
    await t.as.put("/api/notification-preferences", {
      typePreferences: { "task.due": { email: true } },
    });
    await emit("task.due", {
      companyId: t.company.id,
      entityId: crypto.randomUUID(),
      dueDate: "2026-12-01",
    });
    const mails = await h.sql(
      `SELECT status FROM email_outbox WHERE category = 'notification' AND to_address = $1`,
      [t.email.toLowerCase()]
    );
    expect(mails.map((m) => m.status)).toEqual(["blocked_no_provider"]);
    const prefs = await t.as.get("/api/notification-preferences");
    expect(prefs.body.channels.email.status).toBe("disabled");
    expect(prefs.body.channels.push.status).toBe("requires_external"); // S5: VAPID keys are external

    const d = await h.createSecondTenant();
    await d.as.put("/api/notification-preferences", { digestFrequency: "daily" });
    await emit("bank.sync_failed", { companyId: d.company.id, entityId: crypto.randomUUID() });
    await h.sql(
      `UPDATE notifications SET title = $2, message = $3
       WHERE user_id = $1 AND event_key LIKE 'bank.sync_failed:%'`,
      [
        d.user.id,
        "Bank feed sync failed",
        "The bank feed (lean) could not sync. Reconnect it under Banking.",
      ]
    );
    await emit("task.due", {
      companyId: d.company.id,
      entityId: crypto.randomUUID(),
      dueDate: "2026-12-02",
    });
    const immediate = await h.sql(
      `SELECT 1 FROM email_outbox WHERE category = 'notification' AND to_address = $1`,
      [d.email.toLowerCase()]
    );
    expect(immediate.length).toBe(0);
    const { sendDailyDigests } = await import("../../server/services/notification-engine.service");
    await sendDailyDigests();
    await sendDailyDigests();
    const digest = await h.sql(
      `SELECT subject, html FROM email_outbox WHERE category = 'digest' AND to_address = $1`,
      [d.email.toLowerCase()]
    );
    expect(digest.length).toBe(1);
    expect(digest[0].html).toContain(bankStatementCopy.en);
    expect(digest[0].html).toContain("Task due");
    expect(digest[0].html).not.toMatch(/bank feed|reconnect/i);
    expect(digest[0].subject).toContain("2 update(s)");
    expect(
      (await t.as.put("/api/notification-preferences", { digestFrequency: "hourly" })).status
    ).toBe(400);
  });
});
