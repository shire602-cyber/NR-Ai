/**
 * W5-D firm practice management (report 15): one staff model (R15-03), client
 * validation (R15-04/05), bulk contract (R15-07), roles and per-client access
 * (R15-13), multi-firm tenancy + client links (R15-12), workflow templates
 * (R15-15), engagement letters / time / WIP / billing (R15-11), bulk journal
 * import + report pack (R15-16) and honest FTA filing packs (R15-14).
 */
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { freezeTime, ledgerTotals, useHarness, type Tenant } from "./harness";

// X6b: firm sign-up is closed by default (NR-internal); these tests onboard a second firm on purpose.
process.env.FIRM_SELF_SIGNUP = "true";

const h = useHarness();
const TRN = "100000000000003";

async function nrOwner() {
  return h.createTenant({ name: "NROwner", firmRole: "firm_owner" });
}

async function createClient(owner: Tenant, name: string, extra: Record<string, unknown> = {}) {
  const r = await owner.as.post("/api/firm/clients", { name, trnVatNumber: TRN, ...extra });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; name: string };
}

async function nrStaff(role: "firm_admin" | "preparer" | "reviewer" | "viewer", name = "Staff") {
  const t = await h.createTenant({ name });
  await h.sql(`UPDATE users SET firm_role = $2 WHERE id = $1`, [t.user.id, role]);
  return t;
}

async function linkClient(owner: Tenant, client: Tenant) {
  const invite = await owner.as.post("/api/firm/client-links", { inviteeEmail: client.email });
  expect(invite.status, invite.text).toBe(201);
  const linkId = invite.body.link.id as string;
  const joined = await client.as.post(`/api/firm-invitations/${linkId}/accept`, {
    companyId: client.company.id,
  });
  expect(joined.status, joined.text).toBe(200);
  return linkId;
}

async function queueAgainstLockedRow<T>(
  table: "firm_engagement_letters" | "firm_document_requests",
  id: string,
  first: () => Promise<T>,
  second: () => Promise<T>
): Promise<T[]> {
  const { pool } = await import("../../server/db");
  const blocker = await pool.connect();
  const waitForBlocked = (count: number) =>
    vi.waitFor(
      async () => {
        const [row] = await h.sql<{ waiting: number }>(
          `SELECT count(*)::integer AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1`,
          [`%"${table}"%`]
        );
        expect(row.waiting).toBe(count);
      },
      { timeout: 5000 }
    );
  const work: Promise<T>[] = [];
  try {
    await blocker.query("BEGIN");
    await blocker.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
    // Queue the firm decision first, then let the client request read the old committed row.
    work.push(first());
    await waitForBlocked(1);
    work.push(second());
    await waitForBlocked(2);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(work);
  }
  return Promise.all(work);
}

/** A second, non-NR accounting firm approved by a platform admin. */
async function firmB() {
  const owner = await h.createTenant({ name: "FirmBOwner" });
  const applied = await owner.as.post("/api/firms/apply", { name: "Second Firm LLC" });
  expect(applied.status, applied.text).toBe(201);
  expect(applied.body.status).toBe("pending");
  const pending = await owner.as.get("/api/firm/clients");
  expect(pending.status).toBe(403);
  const admin = await h.createTenant({ name: "PlatformAdmin", isAdmin: true });
  const decided = await admin.as.post(`/api/admin/firms/${applied.body.firm.id}/decision`, {
    decision: "approve",
  });
  expect(decided.status, decided.text).toBe(200);
  expect(decided.body.firm.status).toBe("active");
  return { owner, firmId: applied.body.firm.id as string };
}

describe("W5-D firm practice management", () => {
  it("[R15-03] a firm_admin is firm staff: listed by /firm/staff and assignable through both endpoints", async () => {
    const owner = await nrOwner();
    const admin = await nrStaff("firm_admin", "FirmAdmin");
    const c1 = await createClient(owner, "R1503 Client One LLC");
    const c2 = await createClient(owner, "R1503 Client Two LLC");

    const staff = await owner.as.get("/api/firm/staff");
    expect(staff.status).toBe(200);
    const ids = staff.body.map((s: { id: string }) => s.id);
    expect(ids).toContain(admin.user.id);
    expect(ids).toContain(owner.user.id);

    const viaClient = await owner.as.post(`/api/firm/clients/${c1.id}/assign-staff`, {
      staffUserId: admin.user.id,
      action: "assign",
    });
    expect(viaClient.status, viaClient.text).toBe(200);
    const viaCommandCenter = await owner.as.post("/api/firm/command-center/staff/assign", {
      userId: admin.user.id,
      companyId: c2.id,
      role: "reviewer",
    });
    expect(viaCommandCenter.status, viaCommandCenter.text).toBe(200);

    const after = await owner.as.get("/api/firm/staff");
    const row = after.body.find((s: { id: string }) => s.id === admin.user.id);
    expect(row.assignedClientCount).toBe(2);
    const workload = await owner.as.get("/api/firm/command-center/staff/workload");
    expect(workload.status).toBe(200);
    expect(JSON.stringify(workload.body)).toContain(admin.user.id);

    const visible = await admin.as.get("/api/firm/clients");
    expect(visible.body.map((c: { id: string }) => c.id).sort()).toEqual([c1.id, c2.id].sort());

    // A platform-style user with no firm role is never "staff".
    const outsider = await h.createTenant({ name: "Outsider" });
    const bad = await owner.as.post(`/api/firm/clients/${c1.id}/assign-staff`, {
      staffUserId: outsider.user.id,
      action: "assign",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("NOT_FIRM_STAFF");
    // firm_admin cannot assign (firm.staff.manage is owner-only).
    const denied = await admin.as.post("/api/firm/command-center/staff/assign", {
      userId: admin.user.id,
      companyId: c1.id,
    });
    expect(denied.status).toBe(403);
  });

  it("scopes request reviews and engagement actions to a staff member's assigned clients", async () => {
    const owner = await nrOwner();
    const staff = await nrStaff("firm_admin", "ScopedAdmin");
    const assigned = await createClient(owner, "Assigned Review Client");
    const other = await createClient(owner, "Unassigned Review Client");
    expect(
      (
        await owner.as.post(`/api/firm/clients/${assigned.id}/assign-staff`, {
          staffUserId: staff.user.id,
          action: "assign",
        })
      ).status
    ).toBe(200);

    const colleague = await nrStaff("viewer", "ScopedColleague");
    expect(
      (
        await owner.as.post(`/api/firm/clients/${other.id}/assign-staff`, {
          staffUserId: colleague.user.id,
          action: "assign",
        })
      ).status
    ).toBe(200);

    const roster = await staff.as.get("/api/firm/staff");
    expect(roster.status).toBe(200);
    expect(roster.body.find((member: { id: string }) => member.id === staff.user.id)).toMatchObject(
      { assignedClients: [{ companyId: assigned.id }] }
    );
    expect(
      roster.body.find((member: { id: string }) => member.id === colleague.user.id)
    ).toMatchObject({ assignedClients: [], assignedClientCount: 0 });
    expect(roster.text).not.toContain(other.id);

    for (const [client, allowed] of [
      [assigned, true],
      [other, false],
    ] as const) {
      const requests = await owner.as.post(`/api/firm/clients/${client.id}/requests`, {
        items: [{ title: "Bank statements" }],
      });
      const letters = await owner.as.post(`/api/firm/clients/${client.id}/engagement-letters`, {
        title: "Engagement",
      });
      expect(requests.status).toBe(201);
      expect(letters.status).toBe(201);
      const task = await owner.as.post("/api/firm/tasks", {
        companyId: client.id,
        title: "Review bank statements",
        dueDate: "2026-11-20",
      });
      expect(task.status).toBe(201);
      const taskId = task.body.task.id;
      expect((await staff.as.patch(`/api/firm/tasks/${taskId}`, { status: "done" })).status).toBe(
        allowed ? 200 : 404
      );
      expect(await h.sql("SELECT status FROM firm_tasks WHERE id = $1", [taskId])).toEqual([
        { status: allowed ? "done" : "open" },
      ]);
      const requestId = requests.body.requests[0].id;
      const letterId = letters.body.letter.id;
      expect(
        (
          await staff.as.post(`/api/firm/requests/${requestId}/review`, {
            decision: "cancel",
          })
        ).status
      ).toBe(allowed ? 200 : 404);
      const url = `/api/firm/engagement-letters/${letterId}`;
      expect((await staff.as.post(`${url}/send`)).status).toBe(allowed ? 200 : 404);
      expect((await staff.as.post(`${url}/withdraw`)).status).toBe(allowed ? 200 : 404);
      expect(
        await h.sql("SELECT status FROM firm_document_requests WHERE id = $1", [requestId])
      ).toEqual([{ status: allowed ? "cancelled" : "requested" }]);
      expect(
        await h.sql("SELECT status FROM firm_engagement_letters WHERE id = $1", [letterId])
      ).toEqual([{ status: allowed ? "withdrawn" : "draft" }]);
    }
  });

  it("validates firm task and timer scopes before reading or writing", async () => {
    const owner = await nrOwner();
    const first = await createClient(owner, "Timer Scope One");
    const second = await createClient(owner, "Timer Scope Two");
    const date = "2026-11-20";
    const task = await owner.as.post("/api/firm/tasks", {
      companyId: first.id,
      title: "Review task",
      dueDate: date,
    });
    expect(task.status).toBe(201);
    const taskId = task.body.task.id;

    for (const url of [
      "/api/firm/tasks?from=2026-02-30",
      "/api/firm/tasks?from=2026-11-20&to=2026-11-19",
      "/api/firm/tasks?status=unknown",
      `/api/firm/time-entries?companyId=${first.id}&companyId=${second.id}`,
    ]) {
      const result = await owner.as.get(url);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("VALIDATION_ERROR");
    }

    const log = { taskId, companyId: second.id, entryDate: date, minutes: 15 };
    expect((await owner.as.post("/api/firm/time-entries", log)).status).toBe(404);
    expect(
      (
        await owner.as.post("/api/firm/time-entries/start", {
          taskId,
          companyId: second.id,
        })
      ).status
    ).toBe(404);
    expect(
      await h.sql("SELECT id FROM firm_time_entries WHERE company_id = $1", [second.id])
    ).toEqual([]);
    expect(
      (await owner.as.post("/api/firm/time-entries", { ...log, companyId: first.id })).status
    ).toBe(201);

    const staff = await nrStaff("preparer", "ScopedPreparer");
    const { resolveFirmContext } = await import("../../server/services/firm/scope");
    const { logTime, startTimer } = await import("../../server/services/firm/billing.service");
    const ctx = await resolveFirmContext({ id: staff.user.id });
    expect(ctx).not.toBeNull();
    const assignments = `/api/firm/clients/${first.id}/assign-staff`;
    const assignment = { staffUserId: staff.user.id, action: "assign" };
    expect((await owner.as.post(assignments, assignment)).status).toBe(200);
    expect(
      (await owner.as.post(`/api/firm/clients/${second.id}/assign-staff`, assignment)).status
    ).toBe(200);
    const starts = await Promise.all(
      Array.from({ length: 2 }, () =>
        staff.as.post("/api/firm/time-entries/start", { companyId: first.id, taskId })
      )
    );
    expect(starts.map(({ status }) => status).sort()).toEqual([201, 409]);
    const timer = starts.find(({ status }) => status === 201)!;
    expect(starts.find(({ status }) => status === 409)?.body.details).toEqual({
      entryId: timer.body.entry.id,
    });
    const cutoff = new Date();
    const startedAt = new Date(cutoff.getTime() - 17 * 60_000);
    await h.sql("UPDATE firm_time_entries SET started_at = $1 WHERE id = $2", [
      startedAt.toISOString(),
      timer.body.entry.id,
    ]);
    const restore = freezeTime(cutoff);
    try {
      expect((await owner.as.post(assignments, { ...assignment, action: "unassign" })).status).toBe(
        200
      );
    } finally {
      restore();
    }
    // The write must recheck access even if the service has a previously resolved firm context.
    await expect(logTime(ctx!, { ...log, companyId: first.id })).rejects.toMatchObject({
      code: "CLIENT_NOT_FOUND",
    });
    await expect(startTimer(ctx!, { companyId: first.id, taskId })).rejects.toMatchObject({
      code: "CLIENT_NOT_FOUND",
    });
    const stop = `/api/firm/time-entries/${timer.body.entry.id}/stop`;
    expect((await staff.as.post(stop)).status).toBe(404);
    expect(
      await h.sql(
        "SELECT status, minutes, stopped_at = $2::timestamp AS stopped_at_cutoff FROM firm_time_entries WHERE id = $1",
        [timer.body.entry.id, cutoff.toISOString()]
      )
    ).toEqual([{ status: "logged", minutes: 17, stopped_at_cutoff: true }]);
    const next = await staff.as.post("/api/firm/time-entries/start", { companyId: second.id });
    expect(next.status, next.text).toBe(201);
    expect(next.body.entry).toMatchObject({ companyId: second.id, status: "running" });
    expect((await owner.as.post(assignments, assignment)).status).toBe(200);
    const alreadyStopped = await staff.as.post(stop);
    expect(alreadyStopped.status).toBe(409);
    expect(alreadyStopped.body.code).toBe("TIMER_NOT_RUNNING");
    expect((await staff.as.post(`/api/firm/time-entries/${next.body.entry.id}/stop`)).status).toBe(
      200
    );
  });

  it("recovers an inaccessible legacy timer without charging time or exposing its client", async () => {
    const owner = await nrOwner();
    const staff = await nrStaff("preparer", "TimerRecovery");
    const old = await createClient(owner, "Previous Timer Client");
    const available = await createClient(owner, "Next Timer Client");
    const assign = { staffUserId: staff.user.id, action: "assign" };
    for (const company of [old, available]) {
      expect(
        (await owner.as.post(`/api/firm/clients/${company.id}/assign-staff`, assign)).status
      ).toBe(200);
    }
    const entry = await staff.as.post("/api/firm/time-entries/start", { companyId: old.id });
    expect(entry.status, entry.text).toBe(201);
    const id = entry.body.entry.id;
    // Simulate a revocation from before timers were finalized by the access service.
    await h.sql("DELETE FROM firm_staff_assignments WHERE company_id = $1 AND user_id = $2", [
      old.id,
      staff.user.id,
    ]);
    await h.sql("DELETE FROM company_users WHERE company_id = $1 AND user_id = $2", [
      old.id,
      staff.user.id,
    ]);
    await h.sql(
      "UPDATE firm_time_entries SET started_at = now() - interval '2 days' WHERE id = $1",
      [id]
    );
    const next = await staff.as.post("/api/firm/time-entries/start", { companyId: available.id });
    expect(next.status, next.text).toBe(201);
    expect(next.body.entry).toMatchObject({ companyId: available.id, status: "running" });
    expect(next.text).not.toContain(id);
    expect(next.text).not.toContain(old.id);
    expect(
      await h.sql("SELECT status, minutes, billable FROM firm_time_entries WHERE id = $1", [id])
    ).toEqual([{ status: "written_off", minutes: 0, billable: false }]);
  });

  it("client unlink finalizes firm timers at the recorded revocation instant", async () => {
    const owner = await nrOwner();
    const client = await h.createTenant({ name: "TimerUnlinkClient" });
    const cid = client.company.id;
    const linkId = await linkClient(owner, client);
    const timer = await owner.as.post("/api/firm/time-entries/start", { companyId: cid });
    expect(timer.status, timer.text).toBe(201);
    const revoke = await client.as.post(`/api/companies/${cid}/firm-links/${linkId}/revoke`, {});
    expect(revoke.status, revoke.text).toBe(200);
    expect(
      await h.sql(
        `SELECT t.status, t.stopped_at = l.revoked_at AS stopped_at_revocation
         FROM firm_time_entries t JOIN firm_client_links l ON l.id = $2
        WHERE t.id = $1`,
        [timer.body.entry.id, linkId]
      )
    ).toEqual([{ status: "logged", stopped_at_revocation: true }]);
  });

  it("removing an all-client firm member finalizes their timer without an assignment", async () => {
    const owner = await nrOwner();
    const colleague = await nrOwner();
    const client = await createClient(owner, "Timer Member Removal Client");
    const timer = await colleague.as.post("/api/firm/time-entries/start", { companyId: client.id });
    expect(timer.status, timer.text).toBe(201);
    const removed = await owner.as.delete(`/api/firm/members/${colleague.user.id}`);
    expect(removed.status, removed.text).toBe(200);
    expect(
      await h.sql("SELECT status FROM firm_time_entries WHERE id = $1", [timer.body.entry.id])
    ).toEqual([{ status: "logged" }]);
    expect(
      (await colleague.as.post("/api/firm/time-entries/start", { companyId: client.id })).status
    ).toBe(403);
  });

  it.each([
    { via: "role update", assigned: true, role: "viewer" },
    { via: "member upsert", assigned: true, role: "viewer" },
    { via: "role update", assigned: false, role: "preparer" },
    { via: "member upsert", assigned: false, role: "preparer" },
  ])(
    "finalizes timers on $via to $role when authorized access ends",
    async ({ via, assigned, role }) => {
      const owner = await nrOwner();
      const staff = assigned ? await nrStaff("preparer", "ExistingTimerStaff") : await nrOwner();
      const client = await createClient(owner, `Timer Downgrade ${via} ${role}`);
      if (assigned) {
        const assignment = await owner.as.post(`/api/firm/clients/${client.id}/assign-staff`, {
          staffUserId: staff.user.id,
          action: "assign",
        });
        expect(assignment.status, assignment.text).toBe(200);
      }
      const started = await staff.as.post("/api/firm/time-entries/start", {
        companyId: client.id,
        hourlyRate: 75,
      });
      expect(started.status, started.text).toBe(201);
      const timerId = started.body.entry.id as string;
      const cutoff = new Date();
      const startedAt = new Date(cutoff.getTime() - 18 * 60_000);
      await h.sql("UPDATE firm_time_entries SET started_at = $1 WHERE id = $2", [
        startedAt.toISOString(),
        timerId,
      ]);
      const restore = freezeTime(cutoff);
      let changed;
      try {
        changed =
          via === "role update"
            ? await owner.as.patch(`/api/firm/members/${staff.user.id}`, { role })
            : await owner.as.post("/api/firm/members", { email: staff.email, role });
      } finally {
        restore();
      }
      expect(changed.status, changed.text).toBe(via === "role update" ? 200 : 201);
      expect(
        await h.sql(
          `SELECT status, minutes, billable, hourly_rate::text, stopped_at = $2::timestamp AS stopped_at_cutoff
         FROM firm_time_entries WHERE id = $1`,
          [timerId, cutoff.toISOString()]
        )
      ).toEqual([
        {
          status: "logged",
          minutes: 18,
          billable: true,
          hourly_rate: "75.00",
          stopped_at_cutoff: true,
        },
      ]);
      const denied = await staff.as.post("/api/firm/time-entries/start", { companyId: client.id });
      expect(denied.status).toBe(assigned ? 403 : 404);
    }
  );

  it("preserves a running timer when a downgraded member retains tracking and client access", async () => {
    const owner = await nrOwner();
    const staff = await nrOwner();
    const client = await createClient(owner, "Preserved Timer Client");
    const assigned = await owner.as.post(`/api/firm/clients/${client.id}/assign-staff`, {
      staffUserId: staff.user.id,
      action: "assign",
    });
    expect(assigned.status, assigned.text).toBe(200);
    const started = await staff.as.post("/api/firm/time-entries/start", { companyId: client.id });
    expect(started.status, started.text).toBe(201);
    const updated = await owner.as.patch(`/api/firm/members/${staff.user.id}`, {
      role: "preparer",
    });
    expect(updated.status, updated.text).toBe(200);
    const stop = await staff.as.post(`/api/firm/time-entries/${started.body.entry.id}/stop`);
    expect(stop.status, stop.text).toBe(200);
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "serializes a timer start and role downgrade under their shared user lock",
    async () => {
      const owner = await nrOwner();
      const staff = await nrStaff("preparer", "ConcurrentTimerStaff");
      const client = await createClient(owner, "Concurrent Timer Downgrade Client");
      const assigned = await owner.as.post(`/api/firm/clients/${client.id}/assign-staff`, {
        staffUserId: staff.user.id,
        action: "assign",
      });
      expect(assigned.status, assigned.text).toBe(200);
      const { pool } = await import("../../server/db");
      const blocker = await pool.connect();
      const calls: Array<ReturnType<Tenant["as"]["post"]>> = [];
      const waitForBlocked = (count: number) =>
        vi.waitFor(
          async () => {
            const [row] = await h.sql<{ waiting: number }>(`
            SELECT count(*)::integer AS waiting FROM pg_locks
             WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
               AND locktype = 'advisory' AND NOT granted
          `);
            expect(row.waiting).toBe(count);
          },
          { timeout: 5000 }
        );
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT pg_advisory_xact_lock(hashtext('firm_timer_user'), hashtext($1))",
          [staff.user.id]
        );
        calls.push(staff.as.post("/api/firm/time-entries/start", { companyId: client.id }));
        await waitForBlocked(1);
        calls.push(owner.as.patch(`/api/firm/members/${staff.user.id}`, { role: "viewer" }));
        await waitForBlocked(2);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.allSettled(calls);
      }
      const [start, downgrade] = await Promise.all(calls);
      expect(start.status, start.text).toBe(201);
      expect(downgrade.status, downgrade.text).toBe(200);
      expect(
        await h.sql("SELECT status FROM firm_time_entries WHERE id = $1", [start.body.entry.id])
      ).toEqual([{ status: "logged" }]);
    }
  );

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "a withdrawn letter cannot be accepted by an already waiting client",
    async () => {
      const owner = await nrOwner();
      const client = await h.createTenant({ name: "LetterRaceClient" });
      const cid = client.company.id;
      await linkClient(owner, client);
      const letter = await owner.as.post(`/api/firm/clients/${cid}/engagement-letters`, {
        title: "Letter race",
        feeAmount: 100,
      });
      expect(letter.status, letter.text).toBe(201);
      const id = letter.body.letter.id;
      expect((await owner.as.post(`/api/firm/engagement-letters/${id}/send`)).status).toBe(200);
      const [withdraw, accept] = await queueAgainstLockedRow(
        "firm_engagement_letters",
        id,
        () => owner.as.post(`/api/firm/engagement-letters/${id}/withdraw`),
        () =>
          client.as.post(`/api/companies/${cid}/engagement-letters/${id}/respond`, {
            decision: "accept",
            typedName: "Client Owner",
          })
      );
      expect(withdraw.status, withdraw.text).toBe(200);
      expect(accept.status, accept.text).toBe(409);
      expect(accept.body.code).toBe("TRANSACTION_CONFLICT");
      const [saved] = await h.sql(
        "SELECT status, accepted_by_user_id, engagement_id FROM firm_engagement_letters WHERE id = $1",
        [id]
      );
      expect(saved).toEqual({
        status: "withdrawn",
        accepted_by_user_id: null,
        engagement_id: null,
      });
      expect(await h.sql("SELECT id FROM engagements WHERE company_id = $1", [cid])).toEqual([]);
    }
  );

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "a cancelled document request cannot be fulfilled by an already waiting client",
    async () => {
      const owner = await nrOwner();
      const client = await h.createTenant({ name: "RequestRaceClient" });
      const cid = client.company.id;
      await linkClient(owner, client);
      const request = await owner.as.post(`/api/firm/clients/${cid}/requests`, {
        items: [{ title: "Request race" }],
      });
      expect(request.status, request.text).toBe(201);
      const id = request.body.requests[0].id;
      const [doc] = await h.sql(
        `INSERT INTO documents (company_id, name, category, file_url, file_name, uploaded_by)
         VALUES ($1, 'statement.pdf', 'bank_statement', '/uploads/x.pdf', 'statement.pdf', $2) RETURNING id`,
        [cid, client.user.id]
      );
      const [cancel, upload] = await queueAgainstLockedRow(
        "firm_document_requests",
        id,
        () => owner.as.post(`/api/firm/requests/${id}/review`, { decision: "cancel" }),
        () =>
          client.as.post(`/api/companies/${cid}/firm-requests/${id}/fulfil`, {
            documentId: doc.id,
          })
      );
      expect(cancel.status, cancel.text).toBe(200);
      expect(upload.status, upload.text).toBe(409);
      expect(upload.body.code).toBe("TRANSACTION_CONFLICT");
      expect(
        await h.sql("SELECT status, document_id FROM firm_document_requests WHERE id = $1", [id])
      ).toEqual([{ status: "cancelled", document_id: null }]);
    }
  );

  it("[R15-04] a duplicate client differing only by case or spacing is 409", async () => {
    const owner = await nrOwner();
    await createClient(owner, "Agent15 Client One LLC");
    for (const name of ["agent15 client one llc", "  AGENT15   Client One LLC "]) {
      const dup = await owner.as.post("/api/firm/clients", { name });
      expect(dup.status, dup.text).toBe(409);
      expect(dup.body.code).toBe("CLIENT_DUPLICATE");
    }
    const imported = await owner.as.post("/api/firm/clients/import", {
      rows: [{ name: "AGENT15 CLIENT ONE LLC" }],
    });
    expect(imported.body.created).toHaveLength(0);
    expect(imported.body.errors[0].error).toMatch(/already exists/);
  });

  it("[R15-05] TRN '123' is 400 on create/update and a per-row error on import", async () => {
    const owner = await nrOwner();
    const bad = await owner.as.post("/api/firm/clients", {
      name: "Bad TRN LLC",
      trnVatNumber: "123",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(bad.body.fields)).toContain("15 digits");
    const ok = await createClient(owner, "Good TRN LLC", { trnVatNumber: "100 000 000 000 003" });
    const row = await h.sql(`SELECT trn_vat_number FROM companies WHERE id = $1`, [ok.id]);
    expect(row[0].trn_vat_number).toBe(TRN);
    const upd = await owner.as.put(`/api/firm/clients/${ok.id}`, { trnVatNumber: "abc" });
    expect(upd.status).toBe(400);

    const imported = await owner.as.post("/api/firm/clients/import", {
      rows: [
        { name: "Import TRN Bad", TRN: "abc" },
        { name: "Import TRN Ok", TRN },
      ],
    });
    expect(imported.status).toBe(200);
    expect(imported.body.created.map((c: { name: string }) => c.name)).toEqual(["Import TRN Ok"]);
    expect(imported.body.errors).toEqual([
      expect.objectContaining({
        row: 1,
        field: "trnVatNumber",
        error: expect.stringMatching(/15 digits/),
      }),
    ]);
  });

  it("[R15-07] every bulk endpoint takes { companyIds?, period? } with consistent 400/403 answers", async () => {
    const owner = await nrOwner();
    const c = await createClient(owner, "Bulk Contract LLC");
    const noPeriod = await owner.as.post("/api/firm/bulk/period-close", { companyIds: [c.id] });
    expect(noPeriod.status, noPeriod.text).toBe(200);
    expect(noPeriod.body[0].period).toMatch(/^Q[1-4] \d{4}$/);
    const withPeriod = await owner.as.post("/api/firm/bulk/period-close", {
      companyIds: [c.id],
      period: "2026-Q3",
    });
    expect(withPeriod.body[0].period).toBe("Q3 2026");
    const queue = await owner.as.post("/api/firm/bulk/vat-queue", { period: "Q2 2026" });
    expect(queue.status).toBe(200);
    expect(queue.body.find((r: { companyId: string }) => r.companyId === c.id).period).toBe(
      "Q2 2026"
    );

    for (const [url, body] of [
      ["/api/firm/bulk/period-close", { companyIds: [c.id], period: "next quarter" }],
      ["/api/firm/bulk/vat-queue", { companyIds: [] }],
      ["/api/firm/bulk/invoices", { serviceDescription: "Fee", amount: 10 }],
      ["/api/firm/bulk/report-pack", { companyIds: ["not-a-uuid"] }],
    ] as const) {
      const r = await owner.as.post(url, body);
      expect(r.status, `${url} ${r.text}`).toBe(400);
      expect(r.body.code).toBe("VALIDATION_ERROR");
    }
    const foreign = await owner.as.post("/api/firm/bulk/period-close", {
      companyIds: [owner.company.id],
    });
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe("BULK_COMPANY_FORBIDDEN");
  });

  it("[R15-13] a preparer sees and edits only assigned clients and cannot archive; a viewer cannot write", async () => {
    const owner = await nrOwner();
    const preparer = await nrStaff("preparer", "Preparer");
    const viewer = await nrStaff("viewer", "Viewer");
    const c1 = await createClient(owner, "R1513 Assigned LLC");
    const c2 = await createClient(owner, "R1513 Other LLC");
    for (const s of [preparer, viewer]) {
      const r = await owner.as.post(`/api/firm/clients/${c1.id}/assign-staff`, {
        staffUserId: s.user.id,
        action: "assign",
      });
      expect(r.status, r.text).toBe(200);
    }

    const list = await preparer.as.get("/api/firm/clients");
    expect(list.status).toBe(200);
    expect(list.body.map((c: { id: string }) => c.id)).toEqual([c1.id]);
    expect((await preparer.as.get(`/api/firm/clients/${c2.id}/summary`)).status).toBe(403);
    expect(
      (await preparer.as.put(`/api/firm/clients/${c1.id}`, { industry: "Retail" })).status
    ).toBe(200);
    expect(
      (await preparer.as.put(`/api/firm/clients/${c2.id}`, { industry: "Retail" })).status
    ).toBe(403);
    const archive = await preparer.as.delete(`/api/firm/clients/${c1.id}`);
    expect(archive.status).toBe(403);
    expect(archive.body.code).toBe("FIRM_PERMISSION_DENIED");
    expect((await preparer.as.post("/api/firm/clients", { name: "Preparer New LLC" })).status).toBe(
      403
    );
    // Inside the client books the preparer is a bookkeeper on assigned clients only.
    expect((await preparer.as.get(`/api/companies/${c1.id}/accounts`)).status).toBe(200);
    expect([403, 404]).toContain(
      (await preparer.as.get(`/api/companies/${c2.id}/accounts`)).status
    );

    expect(
      (await viewer.as.get("/api/firm/clients")).body.map((c: { id: string }) => c.id)
    ).toEqual([c1.id]);
    const write = await viewer.as.put(`/api/firm/clients/${c1.id}`, { industry: "X" });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("FIRM_READ_ONLY");
    expect(
      (
        await viewer.as.post("/api/firm/tasks", {
          companyId: c1.id,
          title: "t",
          dueDate: "2026-12-01",
        })
      ).status
    ).toBe(403);
    expect(
      (await viewer.as.post(`/api/firm/clients/${c1.id}/requests`, { items: [{ title: "x" }] }))
        .status
    ).toBe(403);
    // NR-only surfaces stay read-only for a viewer too.
    expect(
      (await viewer.as.post("/api/integrations/whatsapp/log-message", { to: "+971500000000" }))
        .status
    ).toBe(403);
    const row = await h.sql(`SELECT industry FROM companies WHERE id = $1`, [c1.id]);
    expect(row[0].industry).toBe("Retail");
  });

  it("[R15-12] accounting-firm tools are NR-internal: an approved non-NR firm is refused on every /api/firm surface", async () => {
    const owner = await nrOwner();
    const admin = await nrStaff("firm_admin", "NRAdmin");
    const a1 = await createClient(owner, "Firm A Secret Client LLC");
    const prospect = await h.createTenant({ name: "Prospect" });
    const lead = await owner.as.post("/api/firm/pipeline/leads", {
      userId: prospect.user.id,
      notes: "A lead",
    });
    expect(lead.status, lead.text).toBe(201);
    const { owner: b } = await firmB();

    const refused = async (res: { status: number; text: string; body: { code?: string } }) => {
      expect(res.status, res.text).toBe(403);
      expect(res.text).not.toContain(a1.id);
    };
    // Same door for every verb and surface: 403 NR_FIRM_ONLY before any handler runs.
    const list = await b.as.get("/api/firm/clients");
    await refused(list);
    expect(list.body.code).toBe("NR_FIRM_ONLY");
    expect((await b.as.post("/api/firm/clients", { name: "B Own Client LLC" })).status).toBe(403);
    await refused(await b.as.get(`/api/firm/clients/${a1.id}/summary`));
    await refused(await b.as.put(`/api/firm/clients/${a1.id}`, { industry: "Hacked" }));
    await refused(await b.as.delete(`/api/firm/clients/${a1.id}`));
    await refused(await b.as.get("/api/firm/staff"));
    await refused(
      await b.as.post(`/api/firm/clients/${a1.id}/assign-staff`, {
        staffUserId: admin.user.id,
        action: "assign",
      })
    );
    await refused(await b.as.get("/api/firm/pipeline/leads"));
    await refused(await b.as.put(`/api/firm/pipeline/leads/${lead.body.id}`, { notes: "x" }));
    await refused(await b.as.get("/api/firm/command-center/alerts"));
    await refused(await b.as.get("/api/firm/analytics/revenue"));
    await refused(await b.as.post("/api/firm/vat-workpapers", { companyId: a1.id }));
    for (const url of [
      "/api/whatsapp/status",
      "/api/firm/value-ops",
      "/api/firm/pipeline/saas-prospects",
      "/api/firm/comms/log",
    ]) {
      expect((await b.as.get(url)).status, url).toBe(403);
    }
    // Firm A's data is untouched; NR still sees its own client.
    const nr = await owner.as.get("/api/firm/clients");
    expect(nr.status).toBe(200);
    expect(nr.body.map((c: { id: string }) => c.id)).toContain(a1.id);
    const a1Row = await h.sql(`SELECT industry, deleted_at FROM companies WHERE id = $1`, [a1.id]);
    expect(a1Row[0]).toEqual({ industry: null, deleted_at: null });
    expect((await h.sql(`SELECT 1 FROM firm_leads WHERE id = $1`, [lead.body.id])).length).toBe(1);
  });

  it("[R15-12] route matrix: a non-NR firm probing every /api/firm route gets 403 and no NR data", async () => {
    const owner = await nrOwner();
    const admin = await nrStaff("firm_admin", "MatrixAdmin");
    const a1 = await createClient(owner, "Matrix Firm A Client LLC");
    await owner.as.post(`/api/firm/clients/${a1.id}/assign-staff`, {
      staffUserId: admin.user.id,
      action: "assign",
    });
    const lead = await owner.as.post("/api/firm/pipeline/leads", { userId: admin.user.id });
    const task = await owner.as.post("/api/firm/tasks", {
      companyId: a1.id,
      title: "A task",
      dueDate: "2026-12-01",
    });
    const reqs = await owner.as.post(`/api/firm/clients/${a1.id}/requests`, {
      items: [{ title: "Bank statements" }],
    });
    const letter = await owner.as.post(`/api/firm/clients/${a1.id}/engagement-letters`, {
      title: "A letter",
    });
    const time = await owner.as.post("/api/firm/time-entries", {
      companyId: a1.id,
      entryDate: "2026-11-01",
      minutes: 30,
      hourlyRate: 100,
    });
    const templates = await owner.as.get("/api/firm/task-templates");
    const wp = await owner.as.post("/api/firm/vat-workpapers", {
      companyId: a1.id,
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    const { owner: b } = await firmB();
    const markers = [a1.id, "Matrix Firm A Client LLC", admin.user.id];
    const ids: Record<string, string> = {
      companyId: a1.id,
      clientId: a1.id,
      userId: admin.user.id,
      id: lead.body.id,
      taskId: task.body.task.id,
      requestId: reqs.body.requests[0].id,
      letterId: letter.body.letter.id,
      entryId: time.body.entry.id,
      templateId: templates.body.templates[0].id,
      workpaperId: wp.body?.id ?? randomUUID(),
    };
    const body = {
      companyId: a1.id,
      companyIds: [a1.id],
      userId: admin.user.id,
      staffUserId: admin.user.id,
      action: "assign",
      name: "xt-probe",
      title: "xt-probe",
      role: "viewer",
    };
    const routes = h
      .routes()
      .filter(
        (r) => r.path.startsWith("/api/firm/") && !r.path.includes("/vat-workpapers/template")
      );
    expect(routes.length).toBeGreaterThan(60);
    const leaks: string[] = [];
    const notRefused: string[] = [];
    for (const r of routes) {
      const url = r.path.replace(
        /:(\w+)\??/g,
        (_m, name: string) =>
          ids[name] ??
          (name === "id" && r.path.includes("vat-workpapers") ? ids.workpaperId : randomUUID())
      );
      const res = await b.as.request(r.method, url, r.method === "GET" ? undefined : body);
      if (res.status !== 403) notRefused.push(`${r.method} ${r.path} -> ${res.status}`);
      const hit = markers.find((m) => res.text.includes(m));
      if (hit) leaks.push(`${r.method} ${r.path} -> ${res.status} leaks ${hit}`);
    }
    expect(leaks).toEqual([]);
    // NR-only: every /api/firm route refuses a non-NR firm outright.
    expect(notRefused).toEqual([]);
    const a1Row = await h.sql(`SELECT name, deleted_at FROM companies WHERE id = $1`, [a1.id]);
    expect(a1Row[0]).toEqual({ name: "Matrix Firm A Client LLC", deleted_at: null });
    const fsa = await h.sql(`SELECT user_id FROM firm_staff_assignments WHERE company_id = $1`, [
      a1.id,
    ]);
    expect(fsa.map((x: { user_id: string }) => x.user_id)).toEqual([admin.user.id]);
    const stillAdmin = await h.sql(`SELECT firm_role FROM users WHERE id = $1`, [admin.user.id]);
    expect(stillAdmin[0].firm_role).toBe("firm_admin");
    expect((await h.sql(`SELECT 1 FROM firm_leads WHERE id = $1`, [lead.body.id])).length).toBe(1);
    expect(
      (await h.sql(`SELECT status FROM firm_tasks WHERE id = $1`, [task.body.task.id]))[0].status
    ).toBe("open");
  });

  it("[R15-12] a client owner accepts a firm invitation and revoking it ends the firm's access immediately", async () => {
    const b = await nrOwner();
    const client = await h.createTenant({ name: "ClientOwner" });
    const invite = await b.as.post("/api/firm/client-links", { inviteeEmail: client.email });
    expect(invite.status, invite.text).toBe(201);
    expect(invite.body.delivery).toBe("in_app_only");
    const inbox = await client.as.get("/api/firm-invitations");
    expect(inbox.body.invitations.map((i: { id: string }) => i.id)).toEqual([invite.body.link.id]);
    const stranger = await h.createTenant({ name: "Stranger" });
    expect(
      (
        await stranger.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
          companyId: stranger.company.id,
        })
      ).status
    ).toBe(404);
    const accept = await client.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
      companyId: client.company.id,
    });
    expect(accept.status, accept.text).toBe(200);

    expect((await b.as.get("/api/firm/clients")).body.map((c: { id: string }) => c.id)).toContain(
      client.company.id
    );
    expect((await b.as.get(`/api/companies/${client.company.id}/accounts`)).status).toBe(200);
    // Another firm member cannot be told about this link via the client's API.
    expect((await stranger.as.get(`/api/companies/${client.company.id}/firm-links`)).status).toBe(
      403
    );

    const revoke = await client.as.post(
      `/api/companies/${client.company.id}/firm-links/${invite.body.link.id}/revoke`,
      { reason: "Changed accountant" }
    );
    expect(revoke.status, revoke.text).toBe(200);
    expect([403, 404]).toContain(
      (await b.as.get(`/api/companies/${client.company.id}/accounts`)).status
    );
    expect(
      (await b.as.get("/api/firm/clients")).body.map((c: { id: string }) => c.id)
    ).not.toContain(client.company.id);
    // Once the link ends the company is outside firm B: another tenant, so 404 (not 403).
    expect((await b.as.get(`/api/firm/clients/${client.company.id}/summary`)).status).toBe(404);
    const grants = await h.sql(
      `SELECT 1 FROM company_users WHERE company_id = $1 AND user_id = $2`,
      [client.company.id, b.user.id]
    );
    expect(grants).toHaveLength(0);
    // The client's own owner membership is untouched.
    expect((await client.as.get(`/api/companies/${client.company.id}/accounts`)).status).toBe(200);
  });

  it("[R15-12] an NR client whose link is revoked leaves the NR firm_owner's scope", async () => {
    const owner = await nrOwner();
    const c = await createClient(owner, "NR Revocable LLC");
    const clientOwner = await h.createTenant({ name: "NRClientOwner" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      c.id,
      clientOwner.user.id,
    ]);
    const links = await clientOwner.as.get(`/api/companies/${c.id}/firm-links`);
    expect(links.body.links).toHaveLength(1);
    const r = await clientOwner.as.post(
      `/api/companies/${c.id}/firm-links/${links.body.links[0].id}/revoke`,
      {}
    );
    expect(r.status, r.text).toBe(200);
    // The revoked client is outside the NR firm's set: another tenant, so 404 (not 403).
    expect((await owner.as.get(`/api/firm/clients/${c.id}/summary`)).status).toBe(404);
    expect([403, 404]).toContain((await owner.as.get(`/api/companies/${c.id}/accounts`)).status);
  });

  it("[R15-15] the VAT template generates a task per stagger period for a quarterly VAT client, idempotently", async () => {
    const owner = await nrOwner();
    const c = await createClient(owner, "Quarterly Stagger LLC", {
      vatFilingFrequency: "quarterly",
      vatPeriodStartMonth: 2,
    });
    const templates = await owner.as.get("/api/firm/task-templates");
    expect(templates.body.templates.map((t: { code: string }) => t.code).sort()).toEqual([
      "ct_return",
      "monthly_bookkeeping",
      "payroll",
      "vat_return",
    ]);
    const gen = await owner.as.post("/api/firm/tasks/generate", {
      asOf: "2026-05-10",
      horizonDays: 90,
      companyIds: [c.id],
    });
    expect(gen.status, gen.text).toBe(200);
    const vat = gen.body.tasks.filter((t: { title: string }) => t.title.startsWith("VAT return"));
    expect(vat).toHaveLength(1);
    expect(vat[0]).toMatchObject({
      companyId: c.id,
      periodStart: "2026-02-01",
      periodEnd: "2026-04-30",
      dueDate: "2026-05-28",
    });
    expect(
      gen.body.tasks.some((t: { title: string }) => t.title.startsWith("Monthly bookkeeping"))
    ).toBe(true);
    const again = await owner.as.post("/api/firm/tasks/generate", {
      asOf: "2026-05-10",
      horizonDays: 90,
      companyIds: [c.id],
    });
    expect(again.body.created).toBe(0);
    const listed = await owner.as.get(`/api/firm/tasks?companyId=${c.id}`);
    expect(listed.body.tasks.length).toBe(gen.body.created);
  });

  it("[R15-11] engagement letter acceptance is recorded; time rolls into WIP and service invoices; recurring billing", async () => {
    const b = await nrOwner();
    const client = await h.createTenant({ name: "EngagedClient" });
    const invite = await b.as.post("/api/firm/client-links", { inviteeEmail: client.email });
    await client.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
      companyId: client.company.id,
    });
    const cid = client.company.id;

    const created = await b.as.post(`/api/firm/clients/${cid}/engagement-letters`, {
      title: "Bookkeeping engagement",
      feeAmount: 1500,
      billingCycle: "monthly",
      services: "Bookkeeping, VAT",
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body.letter.body).toContain("AED 1500.00");
    expect(
      (await client.as.get(`/api/companies/${cid}/engagement-letters`)).body.letters
    ).toHaveLength(0);
    const sent = await b.as.post(`/api/firm/engagement-letters/${created.body.letter.id}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.esign).toBe("requires_external");
    expect(sent.body.delivery).toBe("client_portal_only");
    const noName = await client.as.post(
      `/api/companies/${cid}/engagement-letters/${created.body.letter.id}/respond`,
      {
        decision: "accept",
      }
    );
    expect(noName.status).toBe(400);
    const accepted = await client.as.post(
      `/api/companies/${cid}/engagement-letters/${created.body.letter.id}/respond`,
      { decision: "accept", typedName: "Client Owner" },
      { headers: { "User-Agent": "harness-agent" } }
    );
    expect(accepted.status, accepted.text).toBe(200);
    const [rec] = await h.sql(
      `SELECT status, accepted_name, accepted_ip, accepted_user_agent, responded_at, engagement_id
         FROM firm_engagement_letters WHERE id = $1`,
      [created.body.letter.id]
    );
    expect(rec.status).toBe("accepted");
    expect(rec.accepted_name).toBe("Client Owner");
    expect(rec.accepted_ip).toBeTruthy();
    expect(rec.accepted_user_agent).toBe("harness-agent");
    expect(rec.responded_at).toBeTruthy();
    expect(rec.engagement_id).toBeTruthy();

    const recurring = await b.as.post("/api/firm/billing/run-recurring", {});
    expect(recurring.status, recurring.text).toBe(200);
    expect(recurring.body.created).toBe(1);
    expect(Number(recurring.body.invoices[0].total)).toBe(1575);
    expect((await b.as.post("/api/firm/billing/run-recurring", {})).body.created).toBe(0);

    const t1 = await b.as.post("/api/firm/time-entries", {
      companyId: cid,
      entryDate: "2026-11-01",
      minutes: 90,
      hourlyRate: 400,
      description: "Ledger review",
    });
    expect(t1.status, t1.text).toBe(201);
    await b.as.post("/api/firm/time-entries", {
      companyId: cid,
      entryDate: "2026-11-02",
      minutes: 30,
      hourlyRate: 400,
    });
    const timer = await b.as.post("/api/firm/time-entries/start", {
      companyId: cid,
      hourlyRate: 400,
    });
    expect(timer.status).toBe(201);
    expect((await b.as.post("/api/firm/time-entries/start", { companyId: cid })).status).toBe(409);
    const stopped = await b.as.post(`/api/firm/time-entries/${timer.body.entry.id}/stop`);
    expect(stopped.body.entry.status).toBe("logged");
    expect(stopped.body.entry.minutes).toBeGreaterThanOrEqual(1);
    await h.sql(`UPDATE firm_time_entries SET minutes = 15 WHERE id = $1`, [timer.body.entry.id]);

    const wip = await b.as.get("/api/firm/wip");
    const row = wip.body.clients.find((c: { companyId: string }) => c.companyId === cid);
    expect(row).toMatchObject({ unbilledMinutes: 135, wipValue: "900.00", realisationRate: null });

    const bill = await b.as.post(`/api/firm/clients/${cid}/bill-wip`, {});
    expect(bill.status, bill.text).toBe(201);
    expect(bill.body.entriesBilled).toBe(3);
    expect(Number(bill.body.invoice.subtotal)).toBe(900);
    expect(Number(bill.body.invoice.vatAmount)).toBe(45);
    expect(Number(bill.body.invoice.total)).toBe(945);
    const after = (await b.as.get("/api/firm/wip")).body.clients.find(
      (c: { companyId: string }) => c.companyId === cid
    );
    expect(after).toMatchObject({
      unbilledMinutes: 0,
      wipValue: "0.00",
      billedAmount: "900.00",
      realisationRate: 1,
    });
    expect((await b.as.post(`/api/firm/clients/${cid}/bill-wip`, {})).status).toBe(409);
    const invoices = await b.as.get("/api/firm/service-invoices");
    expect(invoices.body.invoices).toHaveLength(2);
  });

  it("[R15-11] request lists: the firm requests, the client attaches a document, the firm reviews", async () => {
    const b = await nrOwner();
    const client = await h.createTenant({ name: "RequestClient" });
    const invite = await b.as.post("/api/firm/client-links", { inviteeEmail: client.email });
    await client.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
      companyId: client.company.id,
    });
    const cid = client.company.id;
    const list = await b.as.post(`/api/firm/clients/${cid}/requests`, {
      listName: "Year-end",
      items: [
        { title: "December bank statement", dueDate: "2026-12-31" },
        { title: "Trade licence" },
      ],
    });
    expect(list.status, list.text).toBe(201);
    const seen = await client.as.get(`/api/companies/${cid}/firm-requests`);
    expect(seen.body.requests).toHaveLength(2);
    const [doc] = await h.sql(
      `INSERT INTO documents (company_id, name, category, file_url, file_name, uploaded_by)
       VALUES ($1, 'statement.pdf', 'bank_statement', '/uploads/x.pdf', 'statement.pdf', $2) RETURNING id`,
      [cid, client.user.id]
    );
    const reqId = list.body.requests[0].id;
    const up = await client.as.post(`/api/companies/${cid}/firm-requests/${reqId}/fulfil`, {
      documentId: doc.id,
    });
    expect(up.status, up.text).toBe(200);
    expect(up.body.request.status).toBe("uploaded");
    const rev = await b.as.post(`/api/firm/requests/${reqId}/review`, { decision: "accept" });
    expect(rev.body.request.status).toBe("accepted");
    const other = await h.createTenant({ name: "OtherClient" });
    expect((await other.as.get(`/api/companies/${cid}/firm-requests`)).status).toBe(403);
  });

  it("[R15-16] bulk journal import posts balanced entries per client through the ledger and reports row errors", async () => {
    const owner = await nrOwner();
    const a = await createClient(owner, "Bulk Journal Alpha LLC");
    const b = await createClient(owner, "Bulk Journal Beta LLC");
    const csv = [
      "company,entry_ref,date,account_code,description,debit,credit",
      `Bulk Journal Alpha LLC,JE-1,2026-10-01,1020,Opening cash,500.00,`,
      `Bulk Journal Alpha LLC,JE-1,2026-10-01,3010,Opening capital,,500.00`,
      `${b.id},JE-1,2026-10-02,1020,Cash in,250,`,
      `${b.id},JE-1,2026-10-02,3010,Capital,,250`,
      `${b.id},JE-2,2026-10-03,1020,Unbalanced,100,`,
      `${b.id},JE-2,2026-10-03,3010,Unbalanced,,90`,
      `${b.id},JE-3,2026-10-03,9999,Unknown account,10,`,
      `${b.id},JE-3,2026-10-03,3010,,,10`,
      `Not Our Client LLC,JE-1,2026-10-03,1020,x,1,`,
      `Not Our Client LLC,JE-1,2026-10-03,3010,x,,1`,
      `${b.id},JE-4,03/10/2026,1020,bad date,5,5`,
    ].join("\n");
    const dry = await owner.as.post("/api/firm/bulk/journal-import", { csv, dryRun: true });
    expect(dry.status, dry.text).toBe(200);
    expect(dry.body.summary).toMatchObject({ posted: 0, invalid: 4 });
    expect(await ledgerTotals(a.id)).toEqual({ debit: 0, credit: 0 });

    const run = await owner.as.post("/api/firm/bulk/journal-import", { csv });
    expect(run.status, run.text).toBe(200);
    expect(run.body.summary).toMatchObject({ entries: 6, posted: 2, invalid: 4, failed: 0 });
    expect(await ledgerTotals(a.id)).toEqual({ debit: 500, credit: 500 });
    expect(await ledgerTotals(b.id)).toEqual({ debit: 250, credit: 250 });
    const byRef = (company: string, ref: string) =>
      run.body.entries.find(
        (e: { company: string; entryRef: string }) => e.company === company && e.entryRef === ref
      );
    expect(byRef("Bulk Journal Beta LLC", "JE-2").errors[0].message).toMatch(/not balanced/);
    expect(byRef("Bulk Journal Beta LLC", "JE-3").errors[0]).toMatchObject({
      row: 8,
      field: "account_code",
    });
    expect(byRef("Not Our Client LLC", "JE-1").errors[0].field).toBe("company");
    expect(
      run.body.rowErrors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`)
    ).toEqual(expect.arrayContaining(["12:date", "12:debit"]));
    const src = await h.sql(
      `SELECT DISTINCT source FROM journal_entries WHERE company_id = ANY($1)`,
      [[a.id, b.id]]
    );
    expect(src).toEqual([{ source: "firm_bulk_import" }]);
    const replay = await owner.as.post("/api/firm/bulk/journal-import", { csv });
    expect(replay.body.summary).toMatchObject({ posted: 0, replayed: 2 });
    expect(await ledgerTotals(a.id)).toEqual({ debit: 500, credit: 500 });

    // Cross-client report pack: one trial balance workbook per client.
    const res = await fetch(`${h.baseUrl}/api/firm/bulk/report-pack`, {
      method: "POST",
      headers: { Authorization: `Bearer ${owner.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ companyIds: [a.id, b.id], period: "2026-Q4" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/zip");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files);
    expect(names.filter((n) => n.endsWith(".xlsx"))).toHaveLength(2);
    const index = strFromU8(files["index.csv"]);
    expect(index).toContain("Bulk Journal Alpha LLC");
    expect(index).toMatch(/Alpha LLC",[0-9a-f-]+,[^,]+,true,500,500/);
  });

  it("[R15-14] filing packs are manual: format-only TRN check, FTA link, recorded filing reference", async () => {
    const owner = await nrOwner();
    const c = await createClient(owner, "Filing Pack LLC");
    const pack = await owner.as.get(
      `/api/firm/clients/${c.id}/filing-pack?filingType=vat201&periodStart=2026-07-01&periodEnd=2026-09-30`
    );
    expect(pack.status, pack.text).toBe(200);
    expect(pack.body.submission).toMatchObject({ mode: "manual", ftaApi: "not_available" });
    expect(pack.body.submission.note.en).toMatch(/does not submit/);
    expect(pack.body.submission.note.ar).toBeTruthy();
    expect(pack.body.trn).toMatchObject({ formatValid: true, verification: "format_only" });
    expect(pack.body.trn.lookupUrl).toMatch(/^https:\/\/tax\.gov\.ae/);
    expect(
      pack.body.exports.find((e: { key: string }) => e.key === "vat201_export").available
    ).toBe(false);
    const faf = await owner.as.get(
      `/api/firm/clients/${c.id}/filing-pack?filingType=faf&periodStart=2026-01-01&periodEnd=2026-12-31`
    );
    expect(faf.body.exports.find((e: { key: string }) => e.key === "faf_export").available).toBe(
      false
    );

    const future = await owner.as.post(`/api/firm/clients/${c.id}/filings`, {
      filingType: "vat201",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      filedOn: "2099-01-01",
      referenceNumber: "FTA-REF-1",
    });
    expect(future.status).toBe(400);
    const rec = await owner.as.post(`/api/firm/clients/${c.id}/filings`, {
      filingType: "vat201",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      filedOn: "2026-10-20",
      referenceNumber: "FTA-REF-1",
    });
    expect(rec.status, rec.text).toBe(201);
    expect(rec.body.submittedToFta).toBe(false);
    const dup = await owner.as.post(`/api/firm/clients/${c.id}/filings`, {
      filingType: "vat201",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      filedOn: "2026-10-21",
      referenceNumber: "FTA-REF-2",
    });
    expect(dup.status).toBe(409);
    const again = await owner.as.get(
      `/api/firm/clients/${c.id}/filing-pack?filingType=vat201&periodStart=2026-07-01&periodEnd=2026-09-30`
    );
    expect(again.body.filed).toMatchObject({ referenceNumber: "FTA-REF-1", filedOn: "2026-10-20" });
  });
});

describe("X6b accounting-firm features are NR-internal", () => {
  it("[X6b-firm-signup-closed] a signed-in user cannot apply for a firm account unless sign-up is opened on purpose", async () => {
    const previous = process.env.FIRM_SELF_SIGNUP;
    delete process.env.FIRM_SELF_SIGNUP;
    try {
      const user = await h.createTenant({ name: "X6bWouldBeFirm" });
      const res = await user.as.post("/api/firms/apply", { name: "Public Firm LLC" });
      expect(res.status, res.text).toBe(403);
      expect(res.body.code ?? res.body.error).toBe("FIRM_SIGNUP_CLOSED");
      const me = await user.as.get("/api/firms/me");
      expect(me.body.membership).toBeNull();
    } finally {
      process.env.FIRM_SELF_SIGNUP = previous ?? "true";
    }
  });
});
