import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

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
});
