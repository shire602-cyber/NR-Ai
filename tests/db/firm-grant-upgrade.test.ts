import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();

it("recovers pre-provenance grants for downgrade and offboarding without adopting independent memberships", async () => {
  const firm = await h.createTenant({ firmRole: "firm_owner" });
  const client = await h.createTenant({ name: "Upgraded client" });
  const companyId = client.company.id;
  const invite = await firm.as.post("/api/firm/client-links", { inviteeEmail: client.email });
  expect(invite.status, invite.text).toBe(201);
  const accept = await client.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
    companyId,
  });
  expect(accept.status, accept.text).toBe(200);

  const original = await h.createTenant({ firmRole: "firm_admin" });
  const direct = await h.createTenant({ firmRole: "firm_admin" });
  const replacedBefore = await h.createTenant({ firmRole: "firm_admin" });
  const replacedAfter = await h.createTenant({ firmRole: "firm_admin" });
  const historical = await h.createTenant({ firmRole: "firm_admin" });
  const staff = [original, direct, replacedBefore, replacedAfter, historical];

  const membership = async (user: Tenant) => {
    const [row] = await h.sql<{ id: string; role: string }>(
      "SELECT id, role FROM company_users WHERE company_id = $1 AND user_id = $2",
      [companyId, user.user.id]
    );
    return row;
  };
  const grant = async (user: Tenant) => {
    const [row] = await h.sql<{ membership_id: string | null; created_membership: boolean }>(
      `SELECT membership_id, created_membership FROM firm_company_grants
       WHERE company_id = $1 AND user_id = $2`,
      [companyId, user.user.id]
    );
    return row;
  };
  const addDirect = (user: Tenant) =>
    h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')", [
      companyId,
      user.user.id,
    ]);
  const replaceDirect = async (user: Tenant) => {
    await h.sql("DELETE FROM company_users WHERE company_id = $1 AND user_id = $2", [
      companyId,
      user.user.id,
    ]);
    await addDirect(user);
  };
  await addDirect(direct);
  for (const user of staff) {
    const assigned = await firm.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
      staffUserId: user.user.id,
      action: "assign",
    });
    expect(assigned.status, assigned.text).toBe(200);
  }
  const ownMembership = await membership(original);
  const afterMembership = await membership(replacedAfter);
  expect((await grant(original)).membership_id).toBe(ownMembership.id);
  const [clock] = await h.sql<{ same_clock: boolean }>(
    `SELECT g.created_at = m.created_at AS same_clock FROM firm_company_grants g
     JOIN company_users m ON m.id = g.membership_id WHERE g.membership_id = $1`,
    [ownMembership.id]
  );
  expect(clock.same_clock).toBe(true);

  // Pre-0138 writes used the same timestamps but had only a boolean provenance flag.
  await h.sql("UPDATE firm_company_grants SET membership_id = NULL WHERE company_id = $1", [
    companyId,
  ]);
  await replaceDirect(replacedBefore);
  // The old 0108 blanket import marked every NR staff membership as created. Include a
  // coincident timestamp (legacy data imported in one transaction) without proof it was a grant.
  await h.sql(
    `UPDATE firm_company_grants g SET created_at = f.created_at FROM firms f
     WHERE g.firm_id = f.id AND g.company_id = $1 AND g.user_id = $2`,
    [companyId, historical.user.id]
  );
  await h.sql(
    `UPDATE company_users m SET created_at = g.created_at FROM firm_company_grants g
     WHERE g.company_id = m.company_id AND g.user_id = m.user_id
       AND m.company_id = $1 AND m.user_id = $2`,
    [companyId, historical.user.id]
  );

  const migration = readFileSync(
    new URL("../../migrations/0142_recover_firm_membership_provenance.sql", import.meta.url),
    "utf8"
  );
  await h.sql(migration);
  expect(await grant(original)).toEqual({
    created_membership: true,
    membership_id: ownMembership.id,
  });
  expect((await grant(replacedAfter)).membership_id).toBe(afterMembership.id);
  expect(await grant(direct)).toEqual({ created_membership: false, membership_id: null });
  expect((await grant(replacedBefore)).membership_id).toBeNull();
  expect((await grant(historical)).membership_id).toBeNull();
  await replaceDirect(replacedAfter);
  await h.sql(migration);
  expect((await grant(replacedAfter)).membership_id).toBeNull();

  const preserved = [direct, replacedBefore, replacedAfter, historical];
  const kept = await Promise.all(preserved.map(membership));
  const ambiguous = [historical, replacedBefore];
  for (const user of [original, direct, replacedAfter]) {
    const updated = await firm.as.patch(`/api/firm/members/${user.user.id}`, { role: "viewer" });
    expect(updated.status, updated.text).toBe(200);
  }
  expect(await membership(original)).toEqual({ ...ownMembership, role: "viewer" });
  expect(await Promise.all(preserved.map(membership))).toEqual(kept);
  for (const user of ambiguous) {
    const before = await membership(user);
    const downgrade = await firm.as.patch(`/api/firm/members/${user.user.id}`, { role: "viewer" });
    expect(downgrade.status, downgrade.text).toBe(409);
    expect(downgrade.body.code).toBe("UNRESOLVED_FIRM_ACCESS");
    expect(downgrade.body.details.membershipIds).toEqual([before.id]);
    expect(await membership(user)).toEqual(before);
    expect(await grant(user)).toEqual({ created_membership: true, membership_id: null });
    expect(await h.sql("SELECT firm_role FROM users WHERE id = $1", [user.user.id])).toEqual([
      { firm_role: "firm_admin" },
    ]);
  }
  const reviewPath = `/api/companies/${companyId}/team/firm-access-review`;
  for (const user of [historical, replacedBefore]) {
    const blocked = await firm.as.delete(`/api/firm/members/${user.user.id}`);
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.body.code).toBe("UNRESOLVED_FIRM_ACCESS");
    expect(blocked.body.details.membershipIds).toEqual([(await membership(user)).id]);
    expect(await grant(user)).toEqual({ created_membership: true, membership_id: null });
  }
  const review = await client.as.get(reviewPath);
  expect(review.status, review.text).toBe(200);
  expect(review.body.memberships.map((row: { membershipId: string }) => row.membershipId)).toEqual(
    expect.arrayContaining([
      (await membership(historical)).id,
      (await membership(replacedBefore)).id,
    ])
  );
  const unprivileged = await firm.as.post(reviewPath, {
    membershipId: (await membership(historical)).id,
    decision: "revoke",
  });
  expect(unprivileged.status, unprivileged.text).toBe(403);
  const independent = await client.as.post(reviewPath, {
    membershipId: (await membership(replacedBefore)).id,
    decision: "independent",
  });
  expect(independent.status, independent.text).toBe(200);
  const revoked = await client.as.post(reviewPath, {
    membershipId: (await membership(historical)).id,
    decision: "revoke",
  });
  expect(revoked.status, revoked.text).toBe(200);
  expect(await membership(historical)).toBeUndefined();
  for (const user of ambiguous) {
    const retried = await firm.as.patch(`/api/firm/members/${user.user.id}`, { role: "viewer" });
    expect(retried.status, retried.text).toBe(200);
  }
  for (const user of staff) {
    const removed = await firm.as.delete(`/api/firm/members/${user.user.id}`);
    expect(removed.status, removed.text).toBe(200);
    expect(await grant(user)).toBeUndefined();
  }
  expect(await membership(original)).toBeUndefined();
  expect((await original.as.get(`/api/companies/${companyId}/accounts`)).status).toBe(403);
  expect(await Promise.all(preserved.slice(0, -1).map(membership))).toEqual(kept.slice(0, -1));
});
