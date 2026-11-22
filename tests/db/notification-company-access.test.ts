import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import type { OutgoingEmail } from "../../server/outbox/providers";
import { BANK_RECONCILIATION_COPY } from "../../shared/bank-reconciliation-copy";
import { BANK_STATEMENT_REVIEW_TITLE } from "../../shared/notification-copy";

const h = useHarness();
const retiredArabicTitle = ["الربط", "البنكي"].join(" ");
const retiredEnglishTitle = ["Bank", "feed", "sync", "failed"].join(" ");
const legacyBankNotice = {
  title: "Continue bank reconciliation",
  message:
    "The bank connection could not sync. Upload a CSV exported from your bank, review suggested matches, and reconcile against your books.",
};

async function memberWithNotifications() {
  const owner = await h.createTenant({ name: "Notification company owner" });
  const member = await h.createSecondTenant({ name: "Notification company member" });
  const [membership] = await h.sql<{ id: string }>(
    `INSERT INTO company_users (company_id, user_id, role)
     VALUES ($1, $2, 'accountant') RETURNING id`,
    [owner.company.id, member.user.id]
  );
  const [revoked, retained, personal] = await h.sql<{ id: string }>(
    `INSERT INTO notifications (user_id, company_id, type, title, message)
     VALUES ($1, $2, 'system', 'Revoked company notice', 'Revoked company detail'),
            ($1, $3, 'system', 'Current company notice', 'Current company detail'),
            ($1, NULL, 'system', 'Personal notice', 'Personal detail')
     RETURNING id`,
    [member.user.id, owner.company.id, member.company.id]
  );

  const before = await member.as.get("/api/notifications");
  expect(before.status, before.text).toBe(200);
  expect(before.body.notifications).toContainEqual(expect.objectContaining({ id: revoked.id }));
  async function remove() {
    const removed = await owner.as.delete(
      `/api/companies/${owner.company.id}/team/${membership.id}`
    );
    expect(removed.status, removed.text).toBe(204);
  }
  return {
    owner,
    member,
    revoked,
    retained,
    personal,
    unreadBefore: before.body.unreadCount,
    remove,
  };
}

async function deliverPendingEmail(id: string) {
  const { setEmailTransportOverride } = await import("../../server/outbox/providers");
  const { processOutbox } = await import("../../server/outbox/outbox");
  const delivered: OutgoingEmail[] = [];
  setEmailTransportOverride({
    name: "test",
    send: async (email) => {
      if (email.outboxId === id) delivered.push(email);
      return { providerMessageId: email.outboxId };
    },
  });
  try {
    await processOutbox();
  } finally {
    setEmailTransportOverride(null);
  }
  return delivered;
}

describe("Notification access after team removal", () => {
  it.each(["access revoked", "email changed", "still authorized"] as const)(
    "checks the current recipient of a queued payment email when %s",
    async (scenario) => {
      const { owner, member, remove } = await memberWithNotifications();
      const preferences = await member.as.put("/api/notification-preferences", {
        inAppEnabled: false,
        emailEnabled: true,
        typePreferences: { "payment.received": { email: true } },
      });
      expect(preferences.status, preferences.text).toBe(200);
      const { emitDomainEvent, drainDomainEvents } =
        await import("../../server/platform/domain-events");
      await emitDomainEvent("payment.received", {
        companyId: owner.company.id,
        entityId: crypto.randomUUID(),
        amountFils: 472500,
      });
      await drainDomainEvents();
      const [queued] = await h.sql<{ id: string; status: string; html: string }>(
        `SELECT id, status, html FROM email_outbox
         WHERE company_id = $1 AND to_address = $2 AND category = 'notification'`,
        [owner.company.id, member.email]
      );
      expect(queued.status).toBe("blocked_no_provider");
      expect(queued.html).toContain("4,725.00");
      if (scenario === "access revoked") await remove();
      if (scenario === "email changed") {
        await h.sql("UPDATE users SET email = $2 WHERE id = $1", [
          member.user.id,
          `updated-${member.email}`,
        ]);
      }

      const delivered = await deliverPendingEmail(queued.id);
      if (scenario === "still authorized") {
        expect(delivered).toHaveLength(1);
        expect(delivered[0].to).toBe(member.email);
        expect(delivered[0].html).toContain("4,725.00");
      } else {
        expect(delivered).toEqual([]);
        expect(
          await h.sql("SELECT status, html, text_body FROM email_outbox WHERE id = $1", [queued.id])
        ).toEqual([{ status: "cancelled", html: null, text_body: null }]);
      }
    }
  );

  it("hides retired copy with no event key from the inbox and unread count", async () => {
    const t = await h.createTenant();
    const [arabic, english, current] = await h.sql<{ id: string }>(
      `INSERT INTO notifications (user_id, company_id, type, title, message)
       VALUES ($1, $2, 'system', $3, 'Legacy detail'),
              ($1, $2, 'system', 'Old alert', $4),
              ($1, $2, 'system', 'Statement imported', 'Your CSV is ready')
       RETURNING id`,
      [
        t.user.id,
        t.company.id,
        retiredArabicTitle,
        `Check your ${["bank", "feed"].join("-")} connection`,
      ]
    );
    const inbox = await t.as.get("/api/notifications");
    expect(inbox.status, inbox.text).toBe(200);
    expect(inbox.body.unreadCount).toBe(1);
    expect(inbox.body.notifications.map(({ id }: { id: string }) => id)).toEqual([current.id]);
    for (const { id } of [english, arabic]) {
      expect((await t.as.patch(`/api/notifications/${id}/read`)).status).toBe(404);
    }
  });

  it("sanitizes retired subjects in the company email log", async () => {
    const t = await h.createTenant();
    const [oldArabic, oldEnglish, retained] = await h.sql<{ id: string }>(
      `INSERT INTO email_outbox (company_id, to_address, subject, category, status, idempotency_key)
       VALUES ($1, $2, $3, 'notification', 'sent', NULL),
              ($1, $2, $4, 'notification', 'cancelled', NULL),
              ($1, $2, 'Invoice issued', 'notification', 'sent', NULL)
       RETURNING id`,
      [t.company.id, t.email, retiredArabicTitle, retiredEnglishTitle]
    );
    const log = await t.as.get(`/api/companies/${t.company.id}/email-outbox`);
    expect(log.status, log.text).toBe(200);
    expect(log.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: oldArabic.id, subject: BANK_RECONCILIATION_COPY.en }),
        expect.objectContaining({ id: oldEnglish.id, subject: BANK_RECONCILIATION_COPY.en }),
        expect.objectContaining({ id: retained.id, subject: "Invoice issued" }),
      ])
    );
    expect(log.text).not.toContain(retiredArabicTitle);
    expect(log.text).not.toContain(retiredEnglishTitle);
  });

  it("hides revoked company notices from the list, unread count and update endpoints", async () => {
    const { member, revoked, retained, personal, unreadBefore, remove } =
      await memberWithNotifications();
    await remove();

    const after = await member.as.get("/api/notifications");
    expect(after.status, after.text).toBe(200);
    expect(after.body.notifications).not.toContainEqual(
      expect.objectContaining({ id: revoked.id })
    );
    expect(after.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: retained.id }),
        expect.objectContaining({ id: personal.id }),
      ])
    );
    expect(after.body.unreadCount).toBe(unreadBefore - 1);
    for (const action of ["read", "dismiss"]) {
      const result = await member.as.patch(`/api/notifications/${revoked.id}/${action}`);
      expect(result.status, result.text).toBe(404);
    }
    const readAll = await member.as.post("/api/notifications/read-all");
    expect(readAll.status, readAll.text).toBe(200);
    expect(await h.sql(`SELECT is_read FROM notifications WHERE id = $1`, [revoked.id])).toEqual([
      { is_read: false },
    ]);
  });

  it("excludes revoked company details when creating a new daily digest", async () => {
    const { member, remove } = await memberWithNotifications();
    await remove();
    const preferences = await member.as.put("/api/notification-preferences", {
      digestFrequency: "daily",
      emailEnabled: true,
    });
    expect(preferences.status, preferences.text).toBe(200);
    const { sendDailyDigests } = await import("../../server/services/notification-engine.service");
    await sendDailyDigests();

    const digests = await h.sql<{ html: string }>(
      `SELECT html FROM email_outbox WHERE category = 'digest' AND to_address = $1`,
      [member.email]
    );
    expect(digests).toHaveLength(1);
    expect(digests[0].html).not.toContain("Revoked company detail");
    expect(digests[0].html).toContain("Current company detail");
    expect(digests[0].html).toContain("Personal detail");
  });

  it("rebuilds a queued digest after access changes without pulling in newer notifications", async () => {
    const { member, retained, remove } = await memberWithNotifications();
    const preferences = await member.as.put("/api/notification-preferences", {
      digestFrequency: "daily",
      emailEnabled: true,
    });
    expect(preferences.status, preferences.text).toBe(200);
    const { sendDailyDigests } = await import("../../server/services/notification-engine.service");
    await sendDailyDigests();
    const [queued] = await h.sql<{ id: string; status: string; html: string }>(
      `SELECT id, status, html FROM email_outbox WHERE category = 'digest' AND to_address = $1`,
      [member.email]
    );
    expect(queued.status).toBe("blocked_no_provider");
    expect(queued.html).toContain("Revoked company detail");

    await remove();
    await h.sql(`UPDATE notifications SET message = 'Updated company detail' WHERE id = $1`, [
      retained.id,
    ]);
    await h.sql(
      `INSERT INTO notifications (user_id, type, title, message)
       VALUES ($1, 'system', 'New notice', 'New detail')`,
      [member.user.id]
    );
    const delivered = await deliverPendingEmail(queued.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].subject).toMatch(/2 update\(s\)/);
    for (const body of [delivered[0].html, delivered[0].text]) {
      expect(body).toContain("Updated company detail");
      expect(body).toContain("Personal detail");
      expect(body).not.toContain("Revoked company detail");
      expect(body).not.toContain("Current company detail");
      expect(body).not.toContain("New detail");
    }
  });

  it("removes retired bilingual copy and revoked company details from an older queued digest", async () => {
    const { member, remove } = await memberWithNotifications();
    await h.sql(
      `INSERT INTO notifications (user_id, type, title, message, event_key)
       VALUES ($1, 'system', $2, 'Retired English detail', 'bank.sync_failed:old'),
              ($1, 'system', $3, 'Retired Arabic detail', NULL)`,
      [member.user.id, retiredEnglishTitle, retiredArabicTitle]
    );
    const { enqueueEmail } = await import("../../server/outbox/outbox");
    const day = new Date().toISOString().slice(0, 10);
    const queued = await enqueueEmail({
      to: member.email,
      subject: "Old daily summary",
      category: "digest",
      idempotencyKey: `digest:${member.user.id}:${day}`,
      html: [
        "<p><strong>Revoked company notice</strong> — Revoked company detail</p>",
        "<p><strong>Current company notice</strong> — Current company detail</p>",
        `<p><strong>${retiredEnglishTitle}</strong> — Retired English detail</p>`,
        `<p><strong>${retiredArabicTitle}</strong> — Retired Arabic detail</p>`,
      ].join(""),
      text: "Revoked company detail, Retired English detail, Retired Arabic detail",
    });
    await remove();

    const delivered = await deliverPendingEmail(queued.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].subject).toMatch(/1 update\(s\)/);
    for (const body of [delivered[0].html, delivered[0].text]) {
      expect(body).toContain("Current company detail");
      expect(body).not.toMatch(
        /Revoked company detail|Retired English detail|Retired Arabic detail|Personal detail/
      );
    }
  });

  it.each([false, true])(
    "replaces a stored reconciliation notice in the digest body and inbox preview (retry: %s)",
    async (retry) => {
      const tenant = await h.createTenant();
      const { enqueueEmail } = await import("../../server/outbox/outbox");
      const { renderBilingualEmail } = await import("../../server/services/email-layout");
      const day = new Date().toISOString().slice(0, 10);
      await h.sql(
        `INSERT INTO notifications (user_id, company_id, type, title, message, event_key)
       VALUES ($1, $2, 'system', $3, $4, 'bank.sync_failed:legacy-csv-reminder')`,
        [tenant.user.id, tenant.company.id, legacyBankNotice.title, legacyBankNotice.message]
      );
      const oldHtml = renderBilingualEmail(
        {
          brandName: "Muhasib.ai",
          heading: { en: "Daily summary", ar: "الملخص اليومي" },
          paragraphs: {
            en: [`<strong>${legacyBankNotice.title}</strong> — ${legacyBankNotice.message}`],
            ar: [],
          },
        },
        "bilingual"
      );
      const queued = await enqueueEmail({
        to: tenant.email,
        subject: "Old daily summary",
        category: "digest",
        idempotencyKey: `digest:${tenant.user.id}:${day}`,
        html: oldHtml,
        text: legacyBankNotice.message,
      });
      if (retry) {
        const { setEmailTransportOverride } = await import("../../server/outbox/providers");
        const { processOutbox } = await import("../../server/outbox/outbox");
        setEmailTransportOverride({
          name: "test",
          send: async () => {
            throw new Error("Temporary mail provider error");
          },
        });
        try {
          await processOutbox();
        } finally {
          setEmailTransportOverride(null);
        }
        const [failed] = await h.sql<{ status: string }>(
          "UPDATE email_outbox SET next_attempt_at = now() WHERE id = $1 RETURNING status",
          [queued.id]
        );
        expect(failed.status).toBe("retrying");
      }

      const delivered = await deliverPendingEmail(queued.id);
      expect(delivered).toHaveLength(1);
      const { html, text } = delivered[0];
      const preview = html.match(/mso-hide:all[^>]*>([^<]*)<\/div>/)?.[1];
      expect(preview).toContain(BANK_RECONCILIATION_COPY.en);
      expect(html).toContain(
        `<strong>${BANK_STATEMENT_REVIEW_TITLE.en}</strong> — ${BANK_RECONCILIATION_COPY.en}`
      );
      for (const body of [html, text]) {
        expect(body).toContain(BANK_RECONCILIATION_COPY.ar);
        expect(body).not.toContain("The bank connection could not sync");
      }
    }
  );

  it("preserves Arabic in a queued bank notice through delivery refresh", async () => {
    const tenant = await h.createTenant();
    const { notify } = await import("../../server/services/notification-engine.service");
    const prefs = await tenant.as.put("/api/notification-preferences", {
      emailEnabled: true,
      typePreferences: { "task.due": { email: true } },
    });
    expect(prefs.status, prefs.text).toBe(200);
    await notify({
      companyId: tenant.company.id,
      type: "task.due",
      entityId: crypto.randomUUID(),
      title: BANK_STATEMENT_REVIEW_TITLE.en,
      message: BANK_RECONCILIATION_COPY.en,
    });
    const [queued] = await h.sql<{ id: string; subject: string; html: string; text: string }>(
      `SELECT id, subject, html, text_body AS text FROM email_outbox
       WHERE company_id = $1 AND category = 'notification'`,
      [tenant.company.id]
    );
    expect(queued.subject).toContain(BANK_STATEMENT_REVIEW_TITLE.ar);
    expect(queued.html).toContain(BANK_RECONCILIATION_COPY.ar);
    expect(queued.text).toContain(BANK_RECONCILIATION_COPY.ar);

    const delivered = await deliverPendingEmail(queued.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      subject: queued.subject,
      html: queued.html,
      text: queued.text,
    });
  });

  it("cancels and clears a queued digest if its last company becomes inaccessible", async () => {
    const { member, remove, revoked } = await memberWithNotifications();
    const { enqueueEmail } = await import("../../server/outbox/outbox");
    const day = new Date().toISOString().slice(0, 10);
    const queued = await enqueueEmail({
      to: member.email,
      subject: "Daily summary",
      category: "digest",
      idempotencyKey: `digest:${member.user.id}:${day}`,
      notificationDigest: { userId: member.user.id, notificationIds: [revoked.id] },
      html: "<p><strong>Revoked company notice</strong> — Revoked company detail</p>",
      text: "Revoked company detail",
    });
    await remove();

    expect(await deliverPendingEmail(queued.id)).toHaveLength(0);
    expect(
      await h.sql(`SELECT status, html, text_body FROM email_outbox WHERE id = $1`, [queued.id])
    ).toEqual([{ status: "cancelled", html: null, text_body: null }]);
  });

  it("keeps client notices for an assigned firm admin until the assignment is removed", async () => {
    const staff = await h.createTenant({ name: "Notification firm admin", firmRole: "firm_admin" });
    const client = await h.createSecondTenant({ companyColumns: { company_type: "client" } });
    await h.sql(`INSERT INTO firm_staff_assignments (company_id, user_id) VALUES ($1, $2)`, [
      client.company.id,
      staff.user.id,
    ]);
    const [notice] = await h.sql<{ id: string }>(
      `INSERT INTO notifications (user_id, company_id, type, title, message)
       VALUES ($1, $2, 'system', 'Assigned client notice', 'Assigned client detail') RETURNING id`,
      [staff.user.id, client.company.id]
    );
    const before = await staff.as.get("/api/notifications");
    expect(before.status, before.text).toBe(200);
    expect(before.body.notifications).toContainEqual(expect.objectContaining({ id: notice.id }));

    await h.sql(`DELETE FROM firm_staff_assignments WHERE company_id = $1 AND user_id = $2`, [
      client.company.id,
      staff.user.id,
    ]);
    const after = await staff.as.get("/api/notifications");
    expect(after.status, after.text).toBe(200);
    expect(after.body.notifications).not.toContainEqual(expect.objectContaining({ id: notice.id }));
  });
});
