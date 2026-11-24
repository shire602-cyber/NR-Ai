import { expect, it } from "vitest";
import { freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
const nrFirmId = "00000000-0000-4000-8000-000000000001";
const timersPath = "/api/firm/time-entries";

async function setupTimer(name: string, remainingRole?: "unassigned" | "assigned") {
  const admin = await h.createTenant({ isAdmin: true });
  const staff = await h.createTenant({ isAdmin: true });
  const client = await admin.as.post("/api/firm/clients", { name });
  expect(client.status, client.text).toBe(201);
  const companyId = client.body.id as string;
  if (remainingRole) {
    // Membership-only staff use their assigned client scope once platform access is removed.
    await h.sql("INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'preparer')", [
      nrFirmId,
      staff.user.id,
    ]);
  }
  if (remainingRole === "assigned") {
    const assigned = await admin.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
      staffUserId: staff.user.id,
      action: "assign",
    });
    expect(assigned.status, assigned.text).toBe(200);
  }
  const cutoff = new Date();
  const restore = freezeTime(cutoff.getTime() - 13 * 60_000);
  try {
    const started = await staff.as.post(`${timersPath}/start`, { companyId, hourlyRate: 60 });
    expect(started.status, started.text).toBe(201);
    return { admin, staff, companyId, cutoff, timerId: started.body.entry.id as string };
  } finally {
    restore();
  }
}

async function changeAdmin(admin: Tenant, staff: Tenant, isAdmin: boolean, time: Date | number) {
  const restore = freezeTime(time);
  try {
    const changed = await admin.as.patch(`/api/admin/users/${staff.user.id}`, { isAdmin });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body.isAdmin).toBe(isAdmin);
  } finally {
    restore();
  }
}

const timerState = (timerId: string, cutoff: Date) =>
  h.sql(
    `SELECT status, minutes, billable, stopped_at IS NOT NULL AS stopped,
            stopped_at = $2::timestamp AS stopped_at_cutoff
       FROM firm_time_entries WHERE id = $1`,
    [timerId, cutoff.toISOString()]
  );

it.each([undefined, "unassigned"] as const)(
  "settles authorized time on admin removal with remaining client access %s",
  async (role) => {
    const { admin, staff, cutoff, timerId } = await setupTimer(`Admin cutoff ${role}`, role);
    await changeAdmin(admin, staff, false, cutoff);
    const settled = [
      { status: "logged", minutes: 13, billable: true, stopped: true, stopped_at_cutoff: true },
    ];
    expect(await timerState(timerId, cutoff)).toEqual(settled);

    const later = cutoff.getTime() + 60 * 60_000;
    await changeAdmin(admin, staff, true, later);
    const restore = freezeTime(later);
    try {
      const stopped = await staff.as.post(`${timersPath}/${timerId}/stop`, {});
      expect(stopped.status, stopped.text).toBe(409);
      expect(stopped.body.code).toBe("TIMER_NOT_RUNNING");
    } finally {
      restore();
    }
    expect(await timerState(timerId, cutoff)).toEqual(settled);
  }
);

it("keeps a timer running when firm staff retain access to the assigned client", async () => {
  const { admin, staff, cutoff, timerId } = await setupTimer("Admin assigned timer", "assigned");
  await changeAdmin(admin, staff, false, cutoff);
  expect(await timerState(timerId, cutoff)).toEqual([
    { status: "running", minutes: 0, billable: true, stopped: false, stopped_at_cutoff: null },
  ]);

  const restore = freezeTime(cutoff.getTime() + 7 * 60_000);
  try {
    const stopped = await staff.as.post(`${timersPath}/${timerId}/stop`, {});
    expect(stopped.status, stopped.text).toBe(200);
    expect(stopped.body.entry.minutes).toBe(20);
  } finally {
    restore();
  }
});

it("writes off a stranded timer when its original access cutoff is unknown", async () => {
  const { admin, staff, companyId, cutoff, timerId } = await setupTimer("Stranded admin timer");
  // Simulate a client archived before archive and timer settlement were atomic.
  await h.sql("UPDATE companies SET deleted_at = $2::timestamp WHERE id = $1", [
    companyId,
    new Date(cutoff.getTime() - 8 * 60_000).toISOString(),
  ]);
  await changeAdmin(admin, staff, false, cutoff);
  expect(await timerState(timerId, cutoff)).toEqual([
    { status: "written_off", minutes: 0, billable: false, stopped: true, stopped_at_cutoff: true },
  ]);
});

it("settles an assigned timer if demotion activates an unmet company MFA policy", async () => {
  const { admin, staff, companyId, cutoff, timerId } = await setupTimer(
    "Admin MFA cutoff",
    "assigned"
  );
  await h.sql(
    "INSERT INTO company_security_policies (company_id, require_mfa) VALUES ($1, 'all')",
    [companyId]
  );
  await changeAdmin(admin, staff, false, cutoff);
  expect(await timerState(timerId, cutoff)).toEqual([
    { status: "logged", minutes: 13, billable: true, stopped: true, stopped_at_cutoff: true },
  ]);
});
