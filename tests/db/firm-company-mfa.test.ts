import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
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

  it("requires MFA for authorized banking and health reads even when a dashboard is cached", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("Health");
    const actor = await h.createTenant({ name: "MFA Health Firm Admin", firmRole: "firm_admin" });
    await assignClient(owner, actor, openId);
    await assignClient(owner, actor, protectedId);
    const dashboard = "/api/firm/command-center/dashboard";
    const health = "/api/firm/command-center/clients";
    const bank = "/api/firm/bulk/bank-import-status";
    const warmed = await actor.as.get(dashboard);
    expect(warmed.status, warmed.text).toBe(200);
    expect(warmed.body.summary.totalClients).toBe(2);

    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);
    const protectedPaths = [
      bank,
      `${health}/health`,
      `${health}/${protectedId}/health`,
      dashboard,
      `${dashboard}?skipCache=true`,
    ];
    const gated = await Promise.all(protectedPaths.map((path) => actor.as.get(path)));
    expect(gated.map(({ status, body }) => [status, body.code, body.details?.companyId])).toEqual(
      protectedPaths.map(() => [403, "MFA_ENROLLMENT_REQUIRED", protectedId])
    );
    const heads = await Promise.all(protectedPaths.map((path) => actor.as.request("HEAD", path)));
    expect(heads.map(({ status }) => status)).toEqual(protectedPaths.map(() => 403));
    const open = await actor.as.get(`${health}/${openId}/health`);
    expect(open.status, open.text).toBe(200);
    expect(open.body.snapshot.companyId).toBe(openId);
  });

  it("refreshes a cached dashboard after assignment loss and scopes its alert counts", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("Cached");
    const actor = await h.createTenant({ name: "MFA Cache Firm Admin", firmRole: "firm_admin" });
    await assignClient(owner, actor, protectedId);
    await assignClient(owner, actor, openId);
    await h.sql(
      `INSERT INTO firm_alerts (firm_id, company_id, alert_type, severity, message)
       VALUES ($1, $2, 'overdue_balance', 'critical', 'Client balance alert')`,
      [actor.user.id, protectedId]
    );
    const path = "/api/firm/command-center/dashboard";
    const warmed = await actor.as.get(path);
    expect(warmed.status, warmed.text).toBe(200);
    expect(warmed.body.summary).toMatchObject({ totalClients: 2, criticalAlertCount: 1 });

    const removed = await owner.as.post(`/api/firm/clients/${protectedId}/assign-staff`, {
      staffUserId: actor.user.id,
      action: "unassign",
    });
    expect(removed.status, removed.text).toBe(200);
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);

    const result = await actor.as.get(path);
    expect(result.status, result.text).toBe(200);
    expect(result.body.summary).toMatchObject({ totalClients: 1, criticalAlertCount: 0 });
    expect(result.body.healthScores).toMatchObject([{ companyId: openId }]);
    const bank = await actor.as.get("/api/firm/bulk/bank-import-status");
    expect(bank.status, bank.text).toBe(200);
    expect(bank.body).toMatchObject([{ companyId: openId }]);
    const health = await actor.as.get("/api/firm/command-center/clients/health");
    expect(health.status, health.text).toBe(200);
    expect(health.body).toMatchObject([{ companyId: openId }]);
  });

  it("requires MFA only for the client alerts included in the list", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("Alert MFA");
    await h.sql(
      `INSERT INTO firm_alerts (firm_id, company_id, alert_type, severity, message)
       VALUES ($1, $2, 'overdue_balance', 'critical', 'Protected client alert'),
              ($1, $3, 'overdue_balance', 'warning', 'Open client alert')`,
      [owner.user.id, protectedId, openId]
    );
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);

    const path = "/api/firm/command-center/alerts";
    const blocked = await owner.as.get(path);
    expect(blocked.status, blocked.text).toBe(403);
    expect(blocked.body).toMatchObject({
      code: "MFA_ENROLLMENT_REQUIRED",
      details: { companyId: protectedId },
    });
    expect((await owner.as.request("HEAD", path)).status).toBe(403);
    const warningOnly = await owner.as.get(`${path}?severity=warning`);
    expect(warningOnly.status, warningOnly.text).toBe(200);
    expect(warningOnly.body).toMatchObject([{ companyId: openId }]);
  });

  it("prevents alert updates after its client leaves the firm's scope", async () => {
    const { owner, protectedId, openId } = await createMfaClients("Alert archive");
    const [archivedAlert, openAlert] = await h.sql<{ id: string }>(
      `INSERT INTO firm_alerts (firm_id, company_id, alert_type, severity, message)
       VALUES ($1, $2, 'overdue_balance', 'critical', 'Archived client alert'),
              ($1, $3, 'overdue_balance', 'warning', 'Open client alert')
       RETURNING id`,
      [owner.user.id, protectedId, openId]
    );
    const removed = await owner.as.request("DELETE", `/api/firm/clients/${protectedId}`);
    expect(removed.status, removed.text).toBe(200);

    const path = "/api/firm/command-center/alerts";
    const remaining = await owner.as.get(path);
    expect(remaining.status, remaining.text).toBe(200);
    expect(remaining.body).toMatchObject([{ id: openAlert.id }]);
    for (const action of ["read", "resolve"]) {
      const denied = await owner.as.patch(`${path}/${archivedAlert.id}/${action}`, {});
      expect(denied.status, denied.text).toBe(404);
    }
    expect(
      await h.sql("SELECT is_read, resolved_at FROM firm_alerts WHERE id = $1", [archivedAlert.id])
    ).toEqual([{ is_read: false, resolved_at: null }]);
    const resolved = await owner.as.patch(`${path}/${openAlert.id}/resolve`, {});
    expect(resolved.status, resolved.text).toBe(200);
    expect(resolved.body).toMatchObject({ id: openAlert.id, isRead: true });
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

  it("resolves an approved non-NR firm's own summary scope and enforces MFA on granted company reads", async () => {
    const actor = await h.createTenant({ name: "MFA Other Firm Owner" });
    const protectedClient = await h.createTenant({ name: "MFA Other Firm Protected Client" });
    const openClient = await h.createTenant({ name: "MFA Other Firm Open Client" });
    const foreign = await h.createTenant({ name: "MFA Unrelated Client" });
    const [firm] = await h.sql<{ id: string }>(
      `INSERT INTO firms (name, slug, status) VALUES ($1, 'mfa-other-firm', 'active') RETURNING id`,
      ["MFA Other Firm"]
    );
    await h.sql(`INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'firm_owner')`, [
      firm.id,
      actor.user.id,
    ]);
    const { db } = await import("../../server/db");
    const { grantCompanyAccess, resolveFirmContext } =
      await import("../../server/services/firm/scope");
    for (const client of [protectedClient, openClient]) {
      await h.sql(
        `INSERT INTO firm_client_links (firm_id, company_id, status) VALUES ($1, $2, 'active')`,
        [firm.id, client.company.id]
      );
      await db.transaction((tx: typeof db) =>
        grantCompanyAccess(
          {
            firmId: firm.id,
            companyId: client.company.id,
            userId: actor.user.id,
            role: "firm_owner",
          },
          tx
        )
      );
    }

    const companyBase = `/api/companies/${protectedClient.company.id}`;
    const invoice = await protectedClient.as.post(`${companyBase}/invoices`, {
      date: "2026-11-20",
      customerName: "Protected Summary Customer",
      lines: [{ description: "Services", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    expect(invoice.status, invoice.text).toBe(200);
    const receipt = await protectedClient.as.post(`${companyBase}/receipts`, {
      merchant: "Protected Summary Merchant",
      date: "2026-11-20",
      amount: 100,
      vatAmount: 5,
      currency: "AED",
      category: "Office",
    });
    expect(receipt.status, receipt.text).toBe(200);
    for (const [type, id] of [
      ["invoices", invoice.body.id],
      ["receipts", receipt.body.id],
    ]) {
      const allowed = await actor.as.get(`${companyBase}/${type}`);
      expect(allowed.status, allowed.text).toBe(200);
      expect(allowed.text).toContain(id);
    }

    const { setCompanyMfaPolicy } = await import("../../server/services/security/policy");
    await setCompanyMfaPolicy(protectedClient.company.id, "all", protectedClient.user.id);
    await setCompanyMfaPolicy(foreign.company.id, "all", foreign.user.id);
    for (const type of ["invoices", "receipts"]) {
      const gated = await actor.as.get(`${companyBase}/${type}`);
      expect(gated.status, gated.text).toBe(403);
      expect(gated.body).toMatchObject({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: { companyId: protectedClient.company.id },
      });
      expect(gated.text).not.toContain("Protected Summary");
      expect((await actor.as.request("HEAD", `${companyBase}/${type}`)).status).toBe(403);
      expect((await actor.as.get(`/api/companies/${openClient.company.id}/${type}`)).status).toBe(
        200
      );
    }

    const summary = (id: string) => `/firm/clients/${id}/summary`;
    const disallowedSummary = await actor.as.get(`/api${summary(protectedClient.company.id)}`);
    expect(disallowedSummary.status, disallowedSummary.text).toBe(403);
    expect(disallowedSummary.body.code).toBe("NR_FIRM_ONLY");
    expect(disallowedSummary.text).not.toContain("Protected Summary");
    const openSummary = await actor.as.get(`/api${summary(openClient.company.id)}`);
    expect(openSummary.body.code).toBe("NR_FIRM_ONLY");

    const { firmMfaTargetCompanies } =
      await import("../../server/services/security/firm-mfa-targets");
    const authenticated: Express.User = {
      ...actor.user,
      isAdmin: false,
      userType: "customer",
      firmRole: null,
    };
    const targets = (id: string) =>
      firmMfaTargetCompanies(
        { method: "GET", path: summary(id), query: {} } as Request,
        authenticated
      );
    expect(await targets(protectedClient.company.id)).toEqual([protectedClient.company.id]);
    expect(await targets(foreign.company.id)).toEqual([]);

    // Exercise the handler with a real authorized firm context independently of the NR mount.
    const { handleGetFirmClientsSummary } = await import("../../server/routes/firm/clients");
    const context = await resolveFirmContext(authenticated);
    expect(context).toMatchObject({ firmId: firm.id, isNr: false });
    const req = {
      params: { companyId: protectedClient.company.id },
      user: authenticated,
    } as Request;
    const res = {
      locals: { firmContext: context },
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    await handleGetFirmClientsSummary(req, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "MFA_ENROLLMENT_REQUIRED",
        details: expect.objectContaining({ companyId: protectedClient.company.id }),
      })
    );
  });

  it("gates communications log and counts against the authorized client filter", async () => {
    const { owner, protectedId, openId, setCompanyMfaPolicy } = await createMfaClients("Comms");
    const actor = await h.createTenant({ name: "MFA Comms Firm Admin", firmRole: "firm_admin" });
    const unassigned = await h.createTenant({
      name: "MFA Comms Unassigned Firm Admin",
      firmRole: "firm_admin",
    });
    await assignClient(owner, actor, protectedId);
    await assignClient(owner, actor, openId);
    await assignClient(owner, unassigned, openId);
    await h.sql(
      `INSERT INTO client_communications (company_id, channel, recipient_email, body)
       VALUES ($1, 'email', 'private-client@example.test', 'Private client message'),
              ($2, 'email', 'open-client@example.test', 'Open client message')`,
      [protectedId, openId]
    );

    const path = "/api/firm/comms/log";
    const warmed = await actor.as.get(path);
    expect(warmed.status, warmed.text).toBe(200);
    expect(warmed.body.total).toBe(2);
    await setCompanyMfaPolicy(protectedId, "all", owner.user.id);
    const paths = [path, `${path}?companyId=${protectedId}`, `${path}/${protectedId}`];
    const blocked = await Promise.all(paths.map((url) => actor.as.get(url)));
    expect(blocked.map(({ status, body }) => [status, body.code, body.details?.companyId])).toEqual(
      paths.map(() => [403, "MFA_ENROLLMENT_REQUIRED", protectedId])
    );
    expect(blocked.map(({ text }) => text).join(" ")).not.toContain("Private client message");
    const heads = await Promise.all(paths.map((url) => actor.as.request("HEAD", url)));
    expect(heads.map(({ status }) => status)).toEqual(paths.map(() => 403));

    const openRow = {
      companyId: openId,
      recipientEmail: "open-client@example.test",
      body: "Open client message",
    };
    const filtered = await actor.as.get(`${path}?companyId=${openId}`);
    expect(filtered.status, filtered.text).toBe(200);
    expect(filtered.body).toMatchObject({ data: [openRow], total: 1 });
    const detail = await actor.as.get(`${path}/${openId}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body).toMatchObject([openRow]);
    const assignedOnly = await unassigned.as.get(path);
    expect(assignedOnly.status, assignedOnly.text).toBe(200);
    expect(assignedOnly.body).toMatchObject({ data: [openRow], total: 1 });
    const outOfScope = await unassigned.as.get(`${path}?companyId=${protectedId}`);
    expect(outOfScope.status, outOfScope.text).toBe(200);
    expect(outOfScope.body).toMatchObject({ data: [], total: 0 });

    const summary = (companyId: string) => `/api/firm/clients/${companyId}/summary`;
    const protectedSummary = await actor.as.get(summary(protectedId));
    expect(protectedSummary.status, protectedSummary.text).toBe(403);
    expect(protectedSummary.body.code).toBe("MFA_ENROLLMENT_REQUIRED");
    expect((await actor.as.request("HEAD", summary(protectedId))).status).toBe(403);
    expect((await actor.as.get(summary(openId))).status).toBe(200);
  });
});
