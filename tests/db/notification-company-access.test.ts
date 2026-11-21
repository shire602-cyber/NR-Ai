import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import type { OutgoingEmail } from "../../server/outbox/providers";

const h = useHarness();

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
  return { member, revoked, retained, personal, unreadBefore: before.body.unreadCount, remove };
}

async function deliverPendingDigest(id: string) {
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
    const delivered = await deliverPendingDigest(queued.id);
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
       VALUES ($1, 'system', 'Bank feed sync failed', 'Retired English detail', 'bank.sync_failed:old'),
              ($1, 'system', 'الربط البنكي', 'Retired Arabic detail', NULL)`,
      [member.user.id]
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
        "<p><strong>Bank feed sync failed</strong> — Retired English detail</p>",
        "<p><strong>الربط البنكي</strong> — Retired Arabic detail</p>",
      ].join(""),
      text: "Revoked company detail, Retired English detail, Retired Arabic detail",
    });
    await remove();

    const delivered = await deliverPendingDigest(queued.id);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].subject).toMatch(/1 update\(s\)/);
    for (const body of [delivered[0].html, delivered[0].text]) {
      expect(body).toContain("Current company detail");
      expect(body).not.toMatch(
        /Revoked company detail|Retired English detail|Retired Arabic detail|Personal detail/
      );
    }
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

    expect(await deliverPendingDigest(queued.id)).toHaveLength(0);
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
