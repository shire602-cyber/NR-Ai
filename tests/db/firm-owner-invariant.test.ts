import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const nrFirmId = "00000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  // The NR firm is shared by these fixtures so each scenario starts with just its own owners.
  await h.sql("DELETE FROM firm_members WHERE firm_id = $1 AND role = 'firm_owner'", [nrFirmId]);
  await h.sql("UPDATE users SET firm_role = NULL WHERE firm_role = 'firm_owner'");
});

afterEach(() => vi.unstubAllEnvs());

async function insertNrOwner(options: { legacy?: boolean; membership?: boolean } = {}) {
  const id = randomUUID();
  await h.sql(
    "INSERT INTO users (id, email, name, password_hash, firm_role) VALUES ($1, $2, 'Owner', 'fixture', $3)",
    [id, `${id}@example.test`, options.legacy === false ? null : "firm_owner"]
  );
  if (options.membership !== false) {
    await h.sql("INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'firm_owner')", [
      nrFirmId,
      id,
    ]);
  }
  return id;
}

type Response = Awaited<ReturnType<Tenant["as"]["post"]>>;
type Change = "demote" | "remove" | "delete-user";

function changeOwner(admin: Tenant, id: string, change: Change) {
  if (change === "demote") return admin.as.patch(`/api/firm/members/${id}`, { role: "firm_admin" });
  if (change === "remove") return admin.as.delete(`/api/firm/members/${id}`);
  return admin.as.delete(`/api/admin/users/${id}`);
}

async function waitForOwnerChanges(count: number, settled: () => boolean) {
  await vi.waitFor(
    async () => {
      const [row] = await h.sql<{ waiting: number }>(`SELECT count(*)::int AS waiting
      FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND (query ILIKE '%insert into "firm_members"%' OR query ILIKE '%update "users"%'
        OR query ILIKE '%delete from "users"%' OR query ILIKE '%firm_membership%')`);
      expect(row.waiting === count || settled()).toBe(true);
    },
    { timeout: 5000 }
  );
}

it.skipIf(process.env.HARNESS_MODE !== "postgres").each<[Change, Change]>([
  ["demote", "demote"],
  ["remove", "remove"],
  ["demote", "delete-user"],
])("serializes %s and %s so the NR firm retains one owner", async (firstChange, secondChange) => {
  const admin = await h.createTenant({ isAdmin: true });
  const first = await insertNrOwner({ membership: false });
  // Records that have only the newer membership are included in the same roster.
  const second = await insertNrOwner({ legacy: false });
  const { pool } = await import("../../server/db");
  const blocker = await pool.connect();
  let firstRequest: Promise<Response> | undefined;
  let secondRequest: Promise<Response> | undefined;
  let firstSettled = false;
  let secondSettled = false;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id = ANY($1::uuid[]) FOR UPDATE", [
      [first, second],
    ]);
    firstRequest = changeOwner(admin, first, firstChange).finally(() => {
      firstSettled = true;
    });
    await waitForOwnerChanges(1, () => firstSettled);
    expect(firstSettled).toBe(false);
    secondRequest = changeOwner(admin, second, secondChange).finally(() => {
      secondSettled = true;
    });
    await waitForOwnerChanges(2, () => secondSettled);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled([firstRequest, secondRequest]);
  }
  const completed = await firstRequest!;
  const refused = await secondRequest!;
  expect(completed.status, completed.text).toBe(200);
  expect(refused.status, refused.text).toBe(409);
  expect(refused.body.code).toBe("LAST_FIRM_OWNER");
  const roster = await admin.as.get("/api/firm/members");
  expect(roster.status, roster.text).toBe(200);
  expect(
    roster.body
      .filter((member: { firmRole: string }) => member.firmRole === "firm_owner")
      .map((member: { id: string }) => member.id)
  ).toEqual([second]);
});

it("refuses an admin deletion of the only owner in a pending firm", async () => {
  const admin = await h.createTenant({ isAdmin: true });
  const ownerId = await insertNrOwner({ legacy: false, membership: false });
  const firmId = randomUUID();
  await h.sql(
    "INSERT INTO firms (id, name, slug, status) VALUES ($1, 'Deletion fixture', $2, 'pending')",
    [firmId, `pending-${firmId}`]
  );
  await h.sql("INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'firm_owner')", [
    firmId,
    ownerId,
  ]);
  const response = await admin.as.delete(`/api/admin/users/${ownerId}`);
  expect(response.status, response.text).toBe(409);
  expect(response.body.code).toBe("LAST_FIRM_OWNER");
  expect(await h.sql("SELECT user_id FROM firm_members WHERE firm_id = $1", [firmId])).toEqual([
    { user_id: ownerId },
  ]);
});

it("preserves a pending firm's owner when adding that user to a different firm", async () => {
  vi.stubEnv("FIRM_SELF_SIGNUP", "true");
  const admin = await h.createTenant({ isAdmin: true });
  const applicant = await h.createTenant();
  const application = await applicant.as.post("/api/firms/apply", {
    name: "Owner relocation fixture",
  });
  expect(application.status, application.text).toBe(201);
  const firmId = application.body.firm.id as string;
  const response = await admin.as.post("/api/firm/members", {
    email: applicant.email,
    role: "firm_admin",
  });
  expect(response.status, response.text).toBe(409);
  expect(response.body.code).toBe("USER_IN_OTHER_FIRM");
  expect(await h.sql("SELECT user_id FROM firm_members WHERE firm_id = $1", [firmId])).toEqual([
    { user_id: applicant.user.id },
  ]);
});

it("refuses to activate a legacy firm that has no owner", async () => {
  const admin = await h.createTenant({ isAdmin: true });
  const firmId = randomUUID();
  await h.sql("INSERT INTO firms (id, name, slug, status) VALUES ($1, 'No owner', $2, 'pending')", [
    firmId,
    `ownerless-${firmId}`,
  ]);
  const response = await admin.as.post(`/api/admin/firms/${firmId}/decision`, {
    decision: "approve",
  });
  expect(response.status, response.text).toBe(409);
  expect(response.body.code).toBe("LAST_FIRM_OWNER");
  expect(await h.sql("SELECT status FROM firms WHERE id = $1", [firmId])).toEqual([
    { status: "pending" },
  ]);
});

it("keeps a non-NR owner in the firm when platform admin access would leave it ownerless", async () => {
  vi.stubEnv("FIRM_SELF_SIGNUP", "true");
  const admin = await h.createTenant({ isAdmin: true });
  const applicant = await h.createTenant();
  const replacement = await h.createTenant();
  const application = await applicant.as.post("/api/firms/apply", {
    name: "Platform promotion fixture",
  });
  expect(application.status, application.text).toBe(201);
  const firmId = application.body.firm.id as string;
  const activation = await admin.as.post(`/api/admin/firms/${firmId}/decision`, {
    decision: "approve",
  });
  expect(activation.status, activation.text).toBe(200);

  const promote = () => admin.as.patch(`/api/admin/users/${applicant.user.id}`, { isAdmin: true });
  const refused = await promote();
  expect(refused.status, refused.text).toBe(409);
  expect(refused.body.code).toBe("LAST_FIRM_OWNER");

  await h.sql("INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'firm_owner')", [
    firmId,
    replacement.user.id,
  ]);
  const promoted = await promote();
  expect(promoted.status, promoted.text).toBe(200);
  const removeReplacement = await admin.as.delete(`/api/admin/users/${replacement.user.id}`);
  expect(removeReplacement.status, removeReplacement.text).toBe(409);
  expect(removeReplacement.body.code).toBe("LAST_FIRM_OWNER");
});

it("refuses platform-owner revocation until the NR firm has a replacement", async () => {
  const { grantPlatformOwner, revokePlatformOwner } =
    await import("../../server/services/platform-owner.service");
  const candidate = await h.createTenant();
  const { email } = candidate;
  const options = { confirm: email };
  expect(await grantPlatformOwner(email, options)).toMatchObject({ ok: true, changed: true });
  expect(await revokePlatformOwner(email, options)).toEqual({ ok: false, code: "LAST_FIRM_OWNER" });
  const [preserved] = await h.sql("SELECT is_admin, firm_role FROM users WHERE id = $1", [
    candidate.user.id,
  ]);
  expect(preserved).toEqual({ is_admin: true, firm_role: "firm_owner" });
  await insertNrOwner({ membership: false });
  expect(await revokePlatformOwner(email, options)).toMatchObject({ ok: true, changed: true });
});

it("refuses a portal-only owner appointment through the firm roster or operator command", async () => {
  const admin = await h.createTenant({ isAdmin: true });
  const portal = await h.createTenant();
  await h.sql("UPDATE users SET user_type = 'client_portal' WHERE id = $1", [portal.user.id]);
  const appointment = await admin.as.post("/api/firm/members", {
    email: portal.email,
    role: "firm_owner",
  });
  expect(appointment.status, appointment.text).toBe(409);
  expect(appointment.body.code).toBe("FIRM_MEMBER_INELIGIBLE");
  const { grantPlatformOwner } = await import("../../server/services/platform-owner.service");
  expect(await grantPlatformOwner(portal.email, { confirm: portal.email })).toEqual({
    ok: false,
    code: "FIRM_MEMBER_INELIGIBLE",
  });
});

it("ignores a legacy portal-only owner when counting successors", async () => {
  const admin = await h.createTenant({ isAdmin: true });
  const ownerId = await insertNrOwner();
  const portal = await h.createTenant();
  await h.sql(
    "UPDATE users SET user_type = 'client_portal', firm_role = 'firm_owner' WHERE id = $1",
    [portal.user.id]
  );
  await h.sql("INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'firm_owner')", [
    nrFirmId,
    portal.user.id,
  ]);
  const deletion = await admin.as.delete(`/api/firm/members/${ownerId}`);
  expect(deletion.status, deletion.text).toBe(409);
  expect(deletion.body.code).toBe("LAST_FIRM_OWNER");
  const roster = await admin.as.get("/api/firm/members");
  expect(roster.status, roster.text).toBe(200);
  expect(
    roster.body
      .filter((member: { firmRole: string }) => member.firmRole === "firm_owner")
      .map((member: { id: string }) => member.id)
  ).toEqual([ownerId]);
});
