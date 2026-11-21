import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();

async function createMfaClients(action: string) {
  const owner = await h.createTenant({ name: `MFA ${action} Firm Owner`, firmRole: "firm_owner" });
  const protectedClient = await owner.as.post("/api/firm/clients", {
    name: `MFA ${action} Client`,
  });
  const openClient = await owner.as.post("/api/firm/clients", { name: `MFA ${action}, LLC` });
  expect(protectedClient.status, protectedClient.text).toBe(201);
  expect(openClient.status, openClient.text).toBe(201);
  const protectedId: string = protectedClient.body.id;
  const openId: string = openClient.body.id;
  const { setCompanyMfaPolicy } = await import("../../server/services/security/policy");
  return { owner, protectedId, openId, setCompanyMfaPolicy };
}

async function assignClient(owner: Tenant, actor: Tenant, companyId: string) {
  const assigned = await owner.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
    staffUserId: actor.user.id,
    action: "assign",
  });
  expect(assigned.status, assigned.text).toBe(200);
}

describe("Company MFA on firm client actions", () => {
  it("checks the target company for named, body-scoped, and row-scoped firm writes", async () => {
    const owner = await h.createTenant({ name: "MFA Firm Owner", firmRole: "firm_owner" });
    const client = await owner.as.post("/api/firm/clients", { name: "MFA Protected Client" });
    expect(client.status).toBe(201);
    const companyId = client.body.id as string;
    const openClient = await owner.as.post("/api/firm/clients", { name: "MFA Optional Client" });
    expect(openClient.status).toBe(201);

    const actor = await h.createTenant({ name: "MFA Firm Staff", firmRole: "firm_admin" });
    const assigned = await owner.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
      staffUserId: actor.user.id,
      action: "assign",
    });
    expect(assigned.status).toBe(200);

    expect(
      await h.sql("SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2", [
        companyId,
        owner.user.id,
      ])
    ).toEqual([]);
    const { setCompanyMfaPolicy } = await import("../../server/services/security/policy");
    await setCompanyMfaPolicy(companyId, "owners_admins", owner.user.id);
    const timer = await actor.as.post("/api/firm/time-entries/start", { companyId });
    expect(timer.status).toBe(201);
    const timerId = timer.body.entry.id;
    const task = await owner.as.post("/api/firm/tasks", {
      companyId,
      title: "Close the books",
      dueDate: "2026-11-20",
    });
    expect(task.status).toBe(201);
    await setCompanyMfaPolicy(companyId, "all", owner.user.id);

    const cases = [
      await actor.as.post("/api/firm/time-entries", {
        companyId,
        entryDate: "2026-11-20",
        minutes: 10,
      }),
      await actor.as.post(`/api/firm/clients/${companyId}/requests`, {
        items: [{ title: "Bank statements" }],
      }),
      await actor.as.post(`/api/firm/time-entries/${timerId}/stop`, {
        companyId: openClient.body.id,
      }),
      await owner.as.post("/api/firm/time-entries/start", { companyId }),
      await owner.as.get(`/api/companies/${companyId}/accounts`),
      await owner.as.post("/api/firm/tasks/generate", { companyIds: [companyId] }),
      await owner.as.post("/api/firm/billing/run-recurring", {}),
      await owner.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
        staffUserId: actor.user.id,
        action: "unassign",
      }),
    ];
    for (const result of cases) {
      expect(result.status, result.text).toBe(403);
      expect(result.body).toMatchObject({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: { companyId },
      });
    }
    expect(
      await h.sql("SELECT status FROM firm_time_entries WHERE company_id = $1", [companyId])
    ).toEqual([{ status: "running" }]);
    expect(
      await h.sql("SELECT id FROM firm_document_requests WHERE company_id = $1", [companyId])
    ).toEqual([]);

    for (const [path, listKey] of [
      ["/api/firm/time-entries", "entries"],
      ["/api/firm/tasks", "tasks"],
    ] as const) {
      for (const url of [path, `${path}?companyId=${companyId}`]) {
        const result = await owner.as.get(url);
        expect(result.status, result.text).toBe(403);
        expect(result.body).toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });
        expect(result.body).not.toHaveProperty(listKey);
        expect((await owner.as.request("HEAD", url)).status).toBe(403);
      }
      const unaffected = await owner.as.get(`${path}?companyId=${openClient.body.id}`);
      expect(unaffected.status, unaffected.text).toBe(200);
      expect(unaffected.body[listKey]).toEqual([]);
    }
    for (const path of ["/api/firm/wip", "/api/firm/service-invoices"]) {
      const result = await owner.as.get(path);
      expect(result.status, result.text).toBe(403);
      expect(result.body).toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });
    }

    const denied = await actor.as.post("/api/firm/time-entries/start", {
      companyId: openClient.body.id,
    });
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe("CLIENT_NOT_FOUND");
    const own = await owner.as.post("/api/firm/time-entries/start", {
      companyId: openClient.body.id,
    });
    expect(own.status).toBe(201);
    expect((await actor.as.get("/api/auth/security/overview")).status).toBe(200);
  });

  it("requires MFA only for the selected companies in a bulk trial-balance export", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("Export");
    const actor = await h.createTenant({ name: "MFA Export Firm Admin", firmRole: "firm_admin" });
    for (const companyId of [protectedId, openId]) {
      const assigned = await owner.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
        staffUserId: actor.user.id,
        action: "assign",
      });
      expect(assigned.status, assigned.text).toBe(200);
    }
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);
    const path = "/api/firm/bulk/report-pack";
    for (const input of [{ companyIds: [protectedId, openId] }, {}]) {
      const result = await actor.as.post(path, input);
      expect(
        result.status,
        `${result.headers.get("content-type")} for ${JSON.stringify(input)}`
      ).toBe(403);
      expect(result.body).toMatchObject({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: { companyId: protectedId },
      });
    }
    const openPack = await actor.as.post(path, { companyIds: [openId] });
    expect(openPack.status).toBe(200);
    expect(openPack.headers.get("content-type")).toContain("application/zip");
    expect(openPack.headers.get("x-report-pack-files")).toBe("2");

    const other = await h.createTenant({ name: "MFA Export Unrelated Company" });
    await setCompanyMfaPolicy(other.company.id, "all", other.user.id);
    const denied = await actor.as.post(path, { companyIds: [other.company.id, protectedId] });
    expect(denied.status, denied.text).toBe(403);
    expect(denied.body).toMatchObject({ code: "BULK_COMPANY_FORBIDDEN" });
  });

  it("requires MFA before computing the bulk VAT queue for the selected clients", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("VAT Queue");
    const actor = await h.createTenant({ name: "VAT Queue Firm Admin", firmRole: "firm_admin" });
    const path = "/api/firm/bulk/vat-queue";
    await assignClient(owner, actor, openId);
    const outsideScope = await actor.as.post(path, { companyIds: [protectedId] });
    expect(outsideScope.status, outsideScope.text).toBe(403);
    expect(outsideScope.body).toMatchObject({ code: "BULK_COMPANY_FORBIDDEN" });

    await assignClient(owner, actor, protectedId);
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);
    for (const body of [{ companyIds: [protectedId, openId] }, {}]) {
      const denied = await actor.as.post(path, body);
      expect(denied.status, denied.text).toBe(403);
      expect(denied.body).toMatchObject({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: { companyId: protectedId },
      });
    }
    const openQueue = await actor.as.post(path, { companyIds: [openId] });
    expect(openQueue.status, openQueue.text).toBe(200);
    expect(openQueue.body).toMatchObject([{ companyId: openId }]);
  });

  it("requires MFA before listing VAT workpapers for the requested client scope", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } =
      await createMfaClients("Workpapers");
    const actor = await h.createTenant({ name: "Workpapers Firm Admin", firmRole: "firm_admin" });
    const path = "/api/firm/vat-workpapers";
    for (const companyId of [protectedId, openId]) {
      const created = await owner.as.post(path, {
        companyId,
        periodStart: "2026-07-01",
        periodEnd: "2026-09-30",
      });
      expect(created.status, created.text).toBe(201);
    }
    await assignClient(owner, actor, openId);
    const linked = await h.createTenant({ name: "Linked SaaS Customer" });
    const invite = await owner.as.post("/api/firm/client-links", { inviteeEmail: linked.email });
    expect(invite.status, invite.text).toBe(201);
    const accepted = await linked.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
      companyId: linked.company.id,
    });
    expect(accepted.status, accepted.text).toBe(200);
    await assignClient(owner, actor, linked.company.id);
    await setCompanyMfaPolicy(linked.company.id, "all", linked.user.id);

    const filteredPath = (companyId: string) => `${path}?companyId=${companyId}`;
    expect((await actor.as.get(filteredPath(protectedId))).status).toBe(404);
    const excluded = await actor.as.get(filteredPath(linked.company.id));
    expect(excluded.status, excluded.text).toBe(200);
    expect(excluded.body.workpapers).toEqual([]);
    const assignedOnly = await actor.as.get(path);
    expect(assignedOnly.status, assignedOnly.text).toBe(200);
    expect(assignedOnly.body.workpapers).toMatchObject([{ companyId: openId }]);

    await assignClient(owner, actor, protectedId);
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);
    for (const url of [path, filteredPath(protectedId)]) {
      const denied = await actor.as.get(url);
      expect(denied.status, denied.text).toBe(403);
      expect(denied.body).toMatchObject({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: { companyId: protectedId },
      });
      expect((await actor.as.request("HEAD", url)).status).toBe(403);
    }
    const openList = await actor.as.get(filteredPath(openId));
    expect(openList.status, openList.text).toBe(200);
    expect(openList.body.workpapers).toMatchObject([{ companyId: openId }]);
  });

  it("requires MFA for the client in audit and CFO packs", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("Audit");
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);
    for (const pack of ["audit-pack", "cfo-pack"]) {
      const path = (companyId: string) => `/api/firm/value-ops/clients/${companyId}/${pack}`;
      expect((await owner.as.get(path(openId))).status).toBe(200);
      const protectedPack = await owner.as.get(path(protectedId));
      expect(protectedPack.status, protectedPack.text).toBe(403);
      expect(protectedPack.body).toMatchObject({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: { companyId: protectedId },
      });
      const head = await fetch(h.baseUrl + path(protectedId), {
        method: "HEAD",
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(head.status).toBe(403);
    }
  });

  it("checks the assigned companies in value operations summaries", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("Summary");
    const actor = await h.createTenant({ name: "MFA Summary Firm Admin", firmRole: "firm_admin" });
    const assign = async (companyId: string) => {
      const result = await owner.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
        staffUserId: actor.user.id,
        action: "assign",
      });
      expect(result.status, result.text).toBe(200);
    };
    await assign(openId);
    const base = "/api/firm/value-ops";
    const aggregates = [base, `${base}/review-queue`, `${base}/action-brief`];
    const unassigned = await actor.as.get(`${base}/clients/${protectedId}/audit-pack`);
    expect(unassigned.status, unassigned.text).toBe(403);
    expect(unassigned.body.message).toBe("Access denied to this client");
    for (const path of aggregates) {
      const available = await actor.as.get(path);
      expect(available.status, available.text).toBe(200);
    }
    await assign(protectedId);
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);
    for (const path of aggregates) {
      const gated = await actor.as.get(path);
      expect(gated.status, gated.text).toBe(403);
      expect(gated.body).toMatchObject({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: { companyId: protectedId },
      });
    }
  });

  it("applies MFA to the actual clients resolved from the journal CSV and prevents partial posting", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("Import");
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);
    const header = "client,entry_ref,date,account_code,description,debit,credit";
    const entry = (client: string, ref: string) =>
      [
        `${client},${ref},2026-10-01,1020,Opening cash,50.00,`,
        `${client},${ref},2026-10-01,3010,Opening capital,,50.00`,
      ].join("\n");
    const path = "/api/firm/bulk/journal-import";
    // Use a quoted name with a comma and a header alias to exercise the same CSV resolution as posting.
    const openCsv = `${header}\n${entry('"mfa import, llc"', "MFA-open")}`;
    const posted = await owner.as.post(path, { csv: openCsv });
    expect(posted.status, posted.text).toBe(200);
    expect(posted.body.entries).toMatchObject([{ companyId: openId, status: "posted" }]);

    const mixedCsv = [
      header,
      entry(openId, "MFA-open-second"),
      entry(protectedId.toUpperCase(), "MFA-protected"),
    ].join("\n");
    for (const dryRun of [false, true]) {
      const denied = await owner.as.post(path, { csv: mixedCsv, dryRun });
      expect(denied.status, denied.text).toBe(403);
      expect(denied.body).toMatchObject({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: { companyId: protectedId },
      });
    }
    expect(
      await h.sql(
        `SELECT company_id, reference FROM journal_entries
          WHERE company_id = ANY($1::uuid[]) AND source = 'firm_bulk_import'`,
        [[openId, protectedId]]
      )
    ).toEqual([{ company_id: openId, reference: "MFA-open" }]);
  });
});
