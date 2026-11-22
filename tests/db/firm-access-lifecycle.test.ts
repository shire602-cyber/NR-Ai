import { expect, it, vi } from "vitest";
import { freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function linkedClient(name: string) {
  const firm = await h.createTenant({ firmRole: "firm_owner" });
  const client = await h.createTenant({ name });
  const invite = await firm.as.post("/api/firm/client-links", { inviteeEmail: client.email });
  expect(invite.status, invite.text).toBe(201);
  const linkId = invite.body.link.id as string;
  const accepted = await client.as.post(`/api/firm-invitations/${linkId}/accept`, {
    companyId: client.company.id,
  });
  expect(accepted.status, accepted.text).toBe(200);
  return { firm, client, linkId };
}

type Response = Awaited<ReturnType<Tenant["as"]["post"]>>;

async function waitForFirmLock(
  namespace: string,
  key: string,
  count: number,
  settled?: () => boolean
) {
  await vi.waitFor(
    async () => {
      if (settled?.()) return;
      const [row] = await h.sql<{ waiting: number }>(
        `SELECT count(*)::integer AS waiting FROM pg_locks
        WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND locktype = 'advisory' AND NOT granted
          AND classid = hashtext($1)::bit(32)::bigint
          AND objid = hashtext($2)::bit(32)::bigint`,
        [namespace, key]
      );
      expect(row.waiting).toBe(count);
    },
    { timeout: 5000 }
  );
}

it.skipIf(process.env.HARNESS_MODE !== "postgres")(
  "client revocation clears a staff assignment and access grant already in progress",
  async () => {
    const { firm, client, linkId } = await linkedClient("Revoked assignment");
    const staff = await h.createTenant({ firmRole: "preparer" });
    const companyId = client.company.id;
    const { pool } = await import("../../server/db");
    const blocker = await pool.connect();
    let assignment: Promise<Response> | undefined;
    let revocation: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      // Pause the assignment after it takes the company access lock and before the
      // staff row is revalidated and the assignment is written.
      await blocker.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [staff.user.id]);
      assignment = firm.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
        staffUserId: staff.user.id,
        action: "assign",
      });
      await vi.waitFor(
        async () => {
          const [row] = await h.sql<{ waiting: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND lower(query) LIKE '%from "users"%for update%'
        ) AS waiting`);
          expect(row.waiting).toBe(true);
        },
        { timeout: 5000 }
      );
      let revoked = false;
      revocation = client.as
        .post(`/api/companies/${companyId}/firm-links/${linkId}/revoke`, {})
        .finally(() => {
          revoked = true;
        });
      await waitForFirmLock("firm_client_access", companyId, 1, () => revoked);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled([assignment, revocation]);
    }
    const assigned = await assignment!;
    const revoked = await revocation!;
    expect(assigned.status, assigned.text).toBe(200);
    expect(revoked.status, revoked.text).toBe(200);
    const [remaining] = await h.sql(
      `SELECT EXISTS (SELECT 1 FROM firm_staff_assignments WHERE company_id = $1 AND user_id = $2) AS assignment,
              EXISTS (SELECT 1 FROM firm_company_grants WHERE company_id = $1 AND user_id = $2) AS grant,
              EXISTS (SELECT 1 FROM company_users WHERE company_id = $1 AND user_id = $2) AS membership`,
      [companyId, staff.user.id]
    );
    expect(remaining).toEqual({ assignment: false, grant: false, membership: false });
    expect((await staff.as.get(`/api/companies/${companyId}/accounts`)).status).toBe(403);
  }
);

it.skipIf(process.env.HARNESS_MODE !== "postgres")(
  "assignment rechecks the active client link after an earlier revocation wins",
  async () => {
    const { firm, client, linkId } = await linkedClient("Earlier revocation");
    const staff = await h.createTenant({ firmRole: "preparer" });
    const companyId = client.company.id;
    const { pool } = await import("../../server/db");
    const blocker = await pool.connect();
    let assignment: Promise<Response> | undefined;
    let revocation: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('firm_client_access'), hashtext($1))",
        [companyId]
      );
      revocation = client.as.post(`/api/companies/${companyId}/firm-links/${linkId}/revoke`, {});
      await waitForFirmLock("firm_client_access", companyId, 1);
      let assigned = false;
      assignment = firm.as
        .post(`/api/firm/clients/${companyId}/assign-staff`, {
          staffUserId: staff.user.id,
          action: "assign",
        })
        .finally(() => {
          assigned = true;
        });
      await waitForFirmLock("firm_client_access", companyId, 2, () => assigned);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled([assignment, revocation]);
    }
    const revoked = await revocation!;
    const assigned = await assignment!;
    expect(revoked.status, revoked.text).toBe(200);
    expect(assigned.status, assigned.text).toBe(404);
    expect(assigned.body.code).toBe("CLIENT_NOT_FOUND");
  }
);

it.skipIf(process.env.HARNESS_MODE !== "postgres")(
  "assignment rechecks staff membership if offboarding wins the user lock",
  async () => {
    const { firm, client } = await linkedClient("Earlier offboarding");
    const staff = await h.createTenant({ firmRole: "preparer" });
    const staffUserId = staff.user.id;
    const companyId = client.company.id;
    const { pool } = await import("../../server/db");
    const blocker = await pool.connect();
    let assignment: Promise<Response> | undefined;
    let removal: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('firm_timer_user'), hashtext($1))",
        [staffUserId]
      );
      removal = firm.as.delete(`/api/firm/members/${staffUserId}`);
      await waitForFirmLock("firm_timer_user", staffUserId, 1);
      let assigned = false;
      assignment = firm.as
        .post(`/api/firm/clients/${companyId}/assign-staff`, { staffUserId, action: "assign" })
        .finally(() => {
          assigned = true;
        });
      await waitForFirmLock("firm_timer_user", staffUserId, 2, () => assigned);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled([assignment, removal]);
    }
    const removed = await removal!;
    const assigned = await assignment!;
    expect(removed.status, removed.text).toBe(200);
    expect(assigned.status, assigned.text).toBe(400);
    expect(assigned.body.code).toBe("NOT_FIRM_STAFF");
  }
);

it("records a new firm-created membership when assigning after a direct membership ended", async () => {
  const { firm, client, linkId } = await linkedClient("Replaced membership");
  const staff = await h.createTenant({ firmRole: "preparer" });
  const companyId = client.company.id;
  const staffUserId = staff.user.id;
  const params = [companyId, staffUserId];
  await h.sql(
    "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')",
    params
  );
  const assign = () =>
    firm.as.post(`/api/firm/clients/${companyId}/assign-staff`, { staffUserId, action: "assign" });
  const grants = () =>
    h.sql(
      "SELECT created_membership FROM firm_company_grants WHERE company_id = $1 AND user_id = $2",
      params
    );
  expect((await assign()).status).toBe(200);
  expect(await grants()).toEqual([{ created_membership: false }]);
  await h.sql("DELETE FROM company_users WHERE company_id = $1 AND user_id = $2", params);
  expect((await assign()).status).toBe(200);
  expect(await grants()).toEqual([{ created_membership: true }]);
  expect(
    (await client.as.post(`/api/companies/${companyId}/firm-links/${linkId}/revoke`, {})).status
  ).toBe(200);
  expect(
    await h.sql("SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2", params)
  ).toEqual([]);
});

it("offboards authorized work at the cutoff and excludes stranded timers from billing", async () => {
  const { firm, client } = await linkedClient("Offboarding time");
  const companyId = client.company.id;
  const authorized = await h.createTenant({ firmRole: "preparer" });
  const stranded = await h.createTenant({ firmRole: "preparer" });
  for (const staff of [authorized, stranded]) {
    const result = await firm.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
      staffUserId: staff.user.id,
      action: "assign",
    });
    expect(result.status, result.text).toBe(200);
    const timer = await staff.as.post("/api/firm/time-entries/start", {
      companyId,
      hourlyRate: 60,
    });
    expect(timer.status, timer.text).toBe(201);
  }

  // The old client access loss predates timer-aware revocation. It has no recorded cutoff.
  await h.sql("DELETE FROM firm_staff_assignments WHERE company_id = $1 AND user_id = $2", [
    companyId,
    stranded.user.id,
  ]);
  await h.sql("DELETE FROM company_users WHERE company_id = $1 AND user_id = $2", [
    companyId,
    stranded.user.id,
  ]);
  const cutoff = new Date();
  await h.sql(
    "UPDATE firm_time_entries SET started_at = $3 WHERE company_id = $1 AND user_id = $2",
    [companyId, authorized.user.id, new Date(cutoff.getTime() - 13 * 60000).toISOString()]
  );
  await h.sql(
    "UPDATE firm_time_entries SET started_at = $3 WHERE company_id = $1 AND user_id = $2",
    [companyId, stranded.user.id, new Date(cutoff.getTime() - 2 * 86400000).toISOString()]
  );
  const restore = freezeTime(cutoff);
  try {
    for (const staff of [authorized, stranded]) {
      const removed = await firm.as.delete(`/api/firm/members/${staff.user.id}`);
      expect(removed.status, removed.text).toBe(200);
    }
  } finally {
    restore();
  }
  const timers = await h.sql(
    `SELECT user_id, status, minutes, billable, stopped_at = $2::timestamp AS stopped_at_cutoff
       FROM firm_time_entries WHERE company_id = $1`,
    [companyId, cutoff.toISOString()]
  );
  expect(timers).toHaveLength(2);
  expect(timers).toEqual(
    expect.arrayContaining([
      {
        user_id: authorized.user.id,
        status: "logged",
        minutes: 13,
        billable: true,
        stopped_at_cutoff: true,
      },
      {
        user_id: stranded.user.id,
        status: "written_off",
        minutes: 0,
        billable: false,
        stopped_at_cutoff: true,
      },
    ])
  );
  const wip = await firm.as.get("/api/firm/wip");
  expect(wip.status, wip.text).toBe(200);
  expect(wip.body.clients).toEqual([
    expect.objectContaining({ companyId, unbilledMinutes: 13, wipValue: "13.00" }),
  ]);
});

it("updates only firm-created company roles on downgrade and keeps independent memberships on removal", async () => {
  const { firm, client } = await linkedClient("Firm-created membership");
  const staff = await h.createTenant({ firmRole: "firm_admin" });
  const direct = await h.createTenant({ name: "Independent membership" });
  await h.sql("UPDATE companies SET company_type = 'client' WHERE id = $1", [direct.company.id]);
  await h.sql(
    "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')",
    [direct.company.id, staff.user.id]
  );
  const assigned = await firm.as.post(`/api/firm/clients/${client.company.id}/assign-staff`, {
    staffUserId: staff.user.id,
    action: "assign",
  });
  expect(assigned.status, assigned.text).toBe(200);

  const roles = () =>
    h.sql(
      "SELECT company_id, role FROM company_users WHERE user_id = $1 AND company_id = ANY($2::uuid[])",
      [staff.user.id, [client.company.id, direct.company.id]]
    );
  const changed = await firm.as.patch(`/api/firm/members/${staff.user.id}`, { role: "viewer" });
  expect(changed.status, changed.text).toBe(200);
  expect(await roles()).toEqual(
    expect.arrayContaining([
      { company_id: client.company.id, role: "viewer" },
      { company_id: direct.company.id, role: "accountant" },
    ])
  );
  const removed = await firm.as.delete(`/api/firm/members/${staff.user.id}`);
  expect(removed.status, removed.text).toBe(200);
  expect(await roles()).toEqual([{ company_id: direct.company.id, role: "accountant" }]);
  expect((await staff.as.get(`/api/companies/${direct.company.id}/accounts`)).status).toBe(200);
});

it.each(["downgrade", "offboard"] as const)(
  "does not %s a replacement membership granted independently",
  async (operation) => {
    const { firm, client } = await linkedClient("Independently replaced client access");
    const staff = await h.createTenant({ firmRole: "firm_admin" });
    const companyId = client.company.id;
    const params = [companyId, staff.user.id];
    const assigned = await firm.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
      staffUserId: staff.user.id,
      action: "assign",
    });
    expect(assigned.status, assigned.text).toBe(200);

    const [former] = await h.sql(
      "DELETE FROM company_users WHERE company_id = $1 AND user_id = $2 RETURNING id",
      params
    );
    const [replacement] = await h.sql(
      "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant') RETURNING id, role",
      params
    );
    expect(replacement.id).not.toBe(former.id);
    const memberships = () =>
      h.sql("SELECT id, role FROM company_users WHERE company_id = $1 AND user_id = $2", params);

    const changed =
      operation === "downgrade"
        ? await firm.as.patch(`/api/firm/members/${staff.user.id}`, { role: "viewer" })
        : await firm.as.delete(`/api/firm/members/${staff.user.id}`);
    expect(changed.status, changed.text).toBe(200);
    expect(await memberships()).toEqual([replacement]);
  }
);

it.each(["firm", "admin"] as const)(
  "%s archives a client and settles its timer before a new one starts",
  async (surface) => {
    const owner = await h.createTenant({ firmRole: "firm_owner", isAdmin: true });
    const staff = await h.createTenant({ firmRole: "preparer" });
    const clients = [];
    for (const name of ["Archived timer client", "Next timer client"]) {
      const created = await owner.as.post("/api/firm/clients", { name: `${surface} ${name}` });
      expect(created.status, created.text).toBe(201);
      const companyId = created.body.id as string;
      clients.push(companyId);
      const assigned = await owner.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
        staffUserId: staff.user.id,
        action: "assign",
      });
      expect(assigned.status, assigned.text).toBe(200);
    }
    const [companyId, nextCompanyId] = clients;
    const cutoff = new Date();
    const restoreStartedAt = freezeTime(new Date(cutoff.getTime() - 13 * 60_000));
    let entryId: string;
    try {
      const timer = await staff.as.post("/api/firm/time-entries/start", {
        companyId,
        hourlyRate: 60,
      });
      expect(timer.status, timer.text).toBe(201);
      entryId = timer.body.entry.id;
    } finally {
      restoreStartedAt();
    }
    const restoreCutoff = freezeTime(cutoff);
    try {
      const archived = await owner.as.delete(`/api/${surface}/clients/${companyId}`);
      expect(archived.status, archived.text).toBe(200);
    } finally {
      restoreCutoff();
    }
    const timers = () =>
      h.sql(
        `SELECT timer.status, timer.minutes, timer.billable, timer.stopped_at = company.deleted_at AS stopped_at_archive
     FROM firm_time_entries timer JOIN companies company ON company.id = timer.company_id WHERE timer.id = $1`,
        [entryId]
      );
    const settled = [{ status: "logged", minutes: 13, billable: true, stopped_at_archive: true }];
    expect(await timers()).toEqual(settled);
    const nextTimer = await staff.as.post("/api/firm/time-entries/start", {
      companyId: nextCompanyId,
    });
    expect(nextTimer.status, nextTimer.text).toBe(201);
    expect(await timers()).toEqual(settled);
  }
);
