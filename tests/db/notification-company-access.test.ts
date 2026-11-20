import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

async function removeMemberWithNotifications() {
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
  const removed = await owner.as.delete(`/api/companies/${owner.company.id}/team/${membership.id}`);
  expect(removed.status, removed.text).toBe(204);
  return { member, revoked, retained, personal, unreadBefore: before.body.unreadCount };
}

describe("Notification access after team removal", () => {
  it("hides revoked company notices from the list, unread count and update endpoints", async () => {
    const { member, revoked, retained, personal, unreadBefore } =
      await removeMemberWithNotifications();

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
    const { member } = await removeMemberWithNotifications();
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
