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
import { ledgerTotals, useHarness, type Tenant } from "./harness";

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

  it("rolls back the client and its setup when provisioning the firm link fails", async () => {
    const owner = await nrOwner();
    const single = "Single client link rollback";
    const bulk = "Bulk client link rollback";
    await h.sql(`CREATE FUNCTION fail_provisioning_link() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM companies WHERE id = NEW.company_id AND
          name IN ('Single client link rollback', 'Bulk client link rollback')) THEN
          RAISE EXCEPTION 'test link insert failure';
        END IF;
        RETURN NEW;
      END; $$`);
    await h.sql(`CREATE TRIGGER fail_provisioning_link BEFORE INSERT ON firm_client_links
      FOR EACH ROW EXECUTE FUNCTION fail_provisioning_link()`);
    try {
      const failed = await owner.as.post("/api/firm/clients", { name: single });
      expect(failed.status, failed.text).toBe(500);
      const imported = await owner.as.post("/api/firm/clients/import", { rows: [{ name: bulk }] });
      expect(imported.status, imported.text).toBe(200);
      expect(imported.body.created).toHaveLength(0);
      expect(imported.body.errors).toHaveLength(1);
      expect(
        await h.sql("SELECT id FROM companies WHERE name IN ($1, $2)", [single, bulk])
      ).toEqual([]);
    } finally {
      await h.sql("DROP TRIGGER fail_provisioning_link ON firm_client_links");
      await h.sql("DROP FUNCTION fail_provisioning_link()");
    }
    const retried = await createClient(owner, single);
    expect(
      await h.sql("SELECT status FROM firm_client_links WHERE company_id = $1", [retried.id])
    ).toEqual([{ status: "active" }]);
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

  it.each(["accept", "revoke"] as const)(
    "does not %s a firm link after the authorizing client owner is demoted",
    async (action) => {
      if (!h.concurrencySupported) return;
      const firm = await nrOwner();
      const client = await h.createTenant();
      const companyId = client.company.id;
      const invitation = await firm.as.post("/api/firm/client-links", {
        inviteeEmail: client.email,
      });
      const linkId = invitation.body.link.id;
      const acceptPath = `/api/firm-invitations/${linkId}/accept`;
      if (action === "revoke")
        expect((await client.as.post(acceptPath, { companyId })).status).toBe(200);
      const { db } = await import("../../server/db");
      const { and, eq, sql } = await import("drizzle-orm");
      const { companyUsers } = await import("../../shared/schema");
      const request = await db.transaction(async (tx) => {
        const {
          rows: [backend],
        } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        await tx
          .update(companyUsers)
          .set({ role: "viewer" })
          .where(
            and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, client.user.id))
          );
        const write =
          action === "accept"
            ? client.as.post(acceptPath, { companyId })
            : client.as.post(`/api/companies/${companyId}/firm-links/${linkId}/revoke`, {});
        await Promise.race([
          write,
          vi.waitFor(
            async () => {
              expect(
                await h.sql(
                  "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
                  [backend.pid]
                )
              ).not.toHaveLength(0);
            },
            { timeout: 6000 }
          ),
        ]);
        return { write };
      });
      const rejected = await request.write;
      expect(rejected.status, rejected.text).toBe(403);
      expect(rejected.body.code).toBe("COMPANY_OWNER_REQUIRED");
      expect(await h.sql("SELECT status FROM firm_client_links WHERE id = $1", [linkId])).toEqual([
        { status: action === "accept" ? "invited" : "active" },
      ]);
    }
  );

  it("revalidates firm authority before withdrawing a client invitation", async () => {
    const firm = await nrOwner();
    const client = await h.createTenant();
    const { resolveFirmContext } = await import("../../server/services/firm/scope");
    const { withdrawFirmLink } = await import("../../server/services/firm/clients.service");
    const snapshot = (await resolveFirmContext({ id: firm.user.id }))!;
    const invitation = await firm.as.post("/api/firm/client-links", { inviteeEmail: client.email });
    await h.sql("UPDATE users SET firm_role = 'viewer' WHERE id = $1", [firm.user.id]);
    await expect(withdrawFirmLink(snapshot, invitation.body.link.id)).rejects.toMatchObject({
      code: "FIRM_PERMISSION_DENIED",
    });
    expect(
      await h.sql("SELECT status FROM firm_client_links WHERE id = $1", [invitation.body.link.id])
    ).toEqual([{ status: "invited" }]);
  });

  it.each([
    "demoted after acceptance",
    "demoted before acceptance",
    "removed after acceptance",
  ] as const)(
    "reconstructs a historical direct grant from the inviter's role at acceptance (%s)",
    async (history) => {
      const firm = await firmB();
      const client = await h.createTenant();
      const inviter = await h.createTenant();
      const companyId = client.company.id;
      // Existing external firm invitations may predate the NR-only staff surface.
      const [link] = await h.sql<{ id: string }>(
        "INSERT INTO firm_client_links (firm_id, invitee_email, status) VALUES ($1, $2, 'invited') RETURNING id",
        [firm.firmId, client.email]
      );
      expect(
        (await client.as.post(`/api/firm-invitations/${link.id}/accept`, { companyId })).status
      ).toBe(200);
      const [admin] = await h.sql<{ id: string }>(
        "INSERT INTO company_users (company_id,user_id,role) VALUES ($1,$2,'admin') RETURNING id",
        [companyId, inviter.user.id]
      );
      const teamPath = `/api/companies/${companyId}/team`;
      const invited = await inviter.as.post(`${teamPath}/invite`, {
        email: firm.owner.email,
        role: "viewer",
      });
      expect(invited.status, invited.text).toBe(201);
      const demote = async () =>
        expect((await client.as.put(`${teamPath}/${admin.id}`, { role: "viewer" })).status).toBe(
          200
        );
      if (history === "demoted before acceptance") await demote();
      if (history === "removed after acceptance") {
        // A role audit establishes the retired membership's ID before acceptance.
        expect((await client.as.put(`${teamPath}/${admin.id}`, { role: "admin" })).status).toBe(
          200
        );
      }
      // Older acceptance recorded the invite but left the existing firm accountant role unchanged.
      await h.sql(
        "UPDATE company_invitations SET status = 'accepted', accepted_user_id = $1, accepted_at = now() WHERE id = $2",
        [firm.owner.user.id, invited.body.invitation.id]
      );
      const { recordAudit } = await import("../../server/services/audit.service");
      await recordAudit({
        userId: firm.owner.user.id,
        companyId,
        action: "team.invite_accept",
        entityType: "company_invitation",
        entityId: invited.body.invitation.id,
        after: { role: "viewer" },
      });
      if (history === "demoted after acceptance") await demote();
      if (history === "demoted before acceptance") {
        expect((await client.as.put(`${teamPath}/${admin.id}`, { role: "admin" })).status).toBe(
          200
        );
      }
      if (history === "removed after acceptance") {
        expect((await client.as.delete(`${teamPath}/${admin.id}`)).status).toBe(204);
      }
      const revoked = await client.as.post(
        `/api/companies/${companyId}/firm-links/${link.id}/revoke`,
        {}
      );
      expect(revoked.status, revoked.text).toBe(200);
      expect(
        await h.sql("SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2", [
          companyId,
          firm.owner.user.id,
        ])
      ).toEqual(history === "demoted before acceptance" ? [] : [{ role: "viewer" }]);
    }
  );

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

  it.each(["current", "removed"] as const)(
    "[R15-12] revoking an NR link preserves only a direct invitation for the %s membership",
    async (directMembership) => {
      const firm = await nrOwner();
      const client = await h.createTenant();
      const staff = await nrStaff("firm_admin");
      const companyId = client.company.id;
      const accounts = `/api/companies/${companyId}/accounts`;

      const link = await firm.as.post("/api/firm/client-links", { inviteeEmail: client.email });
      expect(link.status, link.text).toBe(201);
      const linked = await client.as.post(`/api/firm-invitations/${link.body.link.id}/accept`, {
        companyId,
      });
      expect(linked.status, linked.text).toBe(200);
      const invited = await client.as.post(`/api/companies/${companyId}/team/invite`, {
        email: staff.email,
        role: "viewer",
      });
      expect(invited.status, invited.text).toBe(201);
      const token = new URL(invited.body.inviteUrl).searchParams.get("teamInvite");
      const accepted = await staff.as.post(`/api/team-invitations/${token}/accept`, {});
      expect(accepted.status, accepted.text).toBe(200);

      const membershipQuery =
        "SELECT id, role FROM company_users WHERE company_id = $1 AND user_id = $2";
      const membershipKey = [companyId, staff.user.id];
      const [direct] = await h.sql<{ id: string; role: string }>(membershipQuery, membershipKey);
      expect(direct.role).toBe("viewer");
      if (directMembership === "removed") {
        const removed = await client.as.delete(`/api/companies/${companyId}/team/${direct.id}`);
        expect(removed.status, removed.text).toBe(204);
      }

      const assigned = await firm.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
        staffUserId: staff.user.id,
        action: "assign",
      });
      expect(assigned.status, assigned.text).toBe(200);
      const [assignedMembership] = await h.sql<{ id: string; role: string }>(
        membershipQuery,
        membershipKey
      );
      if (directMembership === "removed") {
        expect(assignedMembership.id).not.toBe(direct.id);
        expect(assignedMembership.role).toBe("accountant");
      } else {
        expect(assignedMembership).toEqual(direct);
      }
      // Mimic an assignment from before grant provenance was recorded.
      await h.sql(
        "DELETE FROM firm_company_grants WHERE company_id = $1 AND user_id = $2",
        membershipKey
      );
      expect((await staff.as.get(accounts)).status).toBe(200);
      const revoked = await client.as.post(
        `/api/companies/${companyId}/firm-links/${link.body.link.id}/revoke`,
        {}
      );
      expect(revoked.status, revoked.text).toBe(200);
      const remaining = await h.sql(membershipQuery, membershipKey);
      expect(remaining).toEqual(directMembership === "current" ? [direct] : []);
      const response = await staff.as.get(accounts);
      if (directMembership === "current") expect(response.status, response.text).toBe(200);
      else expect([403, 404]).toContain(response.status);
      expect((await client.as.get(accounts)).status).toBe(200);
    }
  );

  it("[R15-12] rolls back link revocation if removing a firm membership fails", async () => {
    const firm = await nrOwner();
    const client = await h.createTenant();
    const staff = await nrStaff("firm_admin");
    const companyId = client.company.id;
    const link = await firm.as.post("/api/firm/client-links", { inviteeEmail: client.email });
    expect(link.status, link.text).toBe(201);
    const linked = await client.as.post(`/api/firm-invitations/${link.body.link.id}/accept`, {
      companyId,
    });
    expect(linked.status, linked.text).toBe(200);
    const assigned = await firm.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
      staffUserId: staff.user.id,
      action: "assign",
    });
    expect(assigned.status, assigned.text).toBe(200);
    const revoke = () =>
      client.as.post(`/api/companies/${companyId}/firm-links/${link.body.link.id}/revoke`, {});
    await h.sql(`
      CREATE FUNCTION test_fail_firm_company_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected cleanup failure';
      END
      $$;
      CREATE TRIGGER test_fail_firm_company_user_delete BEFORE DELETE ON company_users
        FOR EACH ROW EXECUTE FUNCTION test_fail_firm_company_user_delete();
    `);
    try {
      expect((await revoke()).status).toBe(500);
      expect(
        await h.sql("SELECT status FROM firm_client_links WHERE id = $1", [link.body.link.id])
      ).toEqual([{ status: "active" }]);
    } finally {
      await h.sql("DROP TRIGGER test_fail_firm_company_user_delete ON company_users");
      await h.sql("DROP FUNCTION test_fail_firm_company_user_delete()");
    }

    const succeeded = await revoke();
    expect(succeeded.status, succeeded.text).toBe(200);
    expect([403, 404]).toContain(
      (await staff.as.get(`/api/companies/${companyId}/accounts`)).status
    );
  });

  it("[R15-12] does not activate an external firm link before its grants commit", async () => {
    const { owner, firmId } = await firmB();
    const client = await h.createTenant();
    const companyId = client.company.id;
    const [link] = await h.sql<{ id: string }>(
      "INSERT INTO firm_client_links (firm_id, invitee_email, status) VALUES ($1, $2, 'invited') RETURNING id",
      [firmId, client.email]
    );
    const accept = () => client.as.post(`/api/firm-invitations/${link.id}/accept`, { companyId });
    await h.sql(`
      CREATE FUNCTION test_fail_firm_company_user_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected grant failure';
      END
      $$;
      CREATE TRIGGER test_fail_firm_company_user_insert BEFORE INSERT ON company_users
        FOR EACH ROW EXECUTE FUNCTION test_fail_firm_company_user_insert();
    `);
    try {
      expect((await accept()).status).toBe(500);
      expect(await h.sql("SELECT status FROM firm_client_links WHERE id = $1", [link.id])).toEqual([
        { status: "invited" },
      ]);
    } finally {
      await h.sql("DROP TRIGGER test_fail_firm_company_user_insert ON company_users");
      await h.sql("DROP FUNCTION test_fail_firm_company_user_insert()");
    }

    const accepted = await accept();
    expect(accepted.status, accepted.text).toBe(200);
    const revoked = await client.as.post(
      `/api/companies/${companyId}/firm-links/${link.id}/revoke`,
      {}
    );
    expect(revoked.status, revoked.text).toBe(200);
    expect([403, 404]).toContain(
      (await owner.as.get(`/api/companies/${companyId}/accounts`)).status
    );
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
