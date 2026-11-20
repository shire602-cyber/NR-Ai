import { afterEach, describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

afterEach(() => vi.unstubAllEnvs());

describe("Company-scoped e-invoicing permissions", () => {
  it.each([false, true])(
    "firm_admin with platform admin = %s needs the NR client assignment",
    async (isAdmin) => {
      const firm = await h.createTenant({ firmRole: "firm_admin", isAdmin });
      const client = await h.createSecondTenant({ companyColumns: { company_type: "client" } });
      const prefix = `/api/companies/${client.company.id}/einvoicing`;
      const callback = "https://callback.example.test";
      vi.stubEnv("ACUBE_WEBHOOK_BASE_URL", callback);
      vi.stubEnv("COMPLYANCE_WEBHOOK_BASE_URL", callback);

      for (const path of [
        "provider",
        "partner",
        "identity",
        "settings",
        "archive",
        "acube",
        "complyance",
      ]) {
        const response = await firm.as.get(`${prefix}/${path}`);
        expect(response.status, response.text).toBe(403);
        expect(response.body.code).toBe("COMPANY_ACCESS_DENIED");
      }
      const choice = await firm.as.put(`${prefix}/partner`, { partner: "complyance" });
      expect(choice.status, choice.text).toBe(403);
      for (const [path, body] of [
        ["acube/reserve", { approver: "me" }],
        ["acube/sync", {}],
        ["acube/webhooks", {}],
        ["complyance/connect", { adminEmail: "owner@example.test" }],
        ["complyance/sync", {}],
      ] as const) {
        const response = await firm.as.post(`${prefix}/${path}`, body);
        expect(response.status, response.text).toBe(403);
        expect(response.body.code).toBe("COMPANY_ACCESS_DENIED");
      }

      await h.sql("INSERT INTO firm_staff_assignments (user_id, company_id) VALUES ($1, $2)", [
        firm.user.id,
        client.company.id,
      ]);
      for (const provider of ["acube", "complyance"]) {
        const response = await firm.as.get(`${prefix}/${provider}`);
        expect(response.status, response.text).toBe(200);
        expect(response.body.webhook.url).toBe(
          `${callback}/api/webhooks/einvoice/${provider}/sandbox/${client.company.id}`
        );
      }
      const selected = await firm.as.put(`${prefix}/partner`, { partner: "complyance" });
      expect(selected.status, selected.text).toBe(200);
      expect(selected.body.chosen).toBe("complyance");
      const connect = await firm.as.post(`${prefix}/complyance/connect`, {
        adminEmail: "owner@example.test",
      });
      expect(connect.status, connect.text).toBe(503);
      expect(connect.body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");

      await h.sql("DELETE FROM firm_staff_assignments WHERE user_id = $1 AND company_id = $2", [
        firm.user.id,
        client.company.id,
      ]);
      const revoked = await firm.as.get(`${prefix}/provider`);
      expect(revoked.status, revoked.text).toBe(403);
    }
  );

  it("retains scoped provider reading for a platform admin without a firm role", async () => {
    const admin = await h.createTenant({ isAdmin: true });
    const client = await h.createSecondTenant();
    const provider = await admin.as.get(`/api/companies/${client.company.id}/einvoicing/provider`);
    expect(provider.status, provider.text).toBe(200);
    expect(provider.body.status).toBe("not_selected");
  });

  it("only tax.submit permits sending or resubmitting an issued e-invoice", async () => {
    const owner = await h.createTenant();
    const invoice = await owner.as.post(`/api/companies/${owner.company.id}/invoices`, {
      customerName: "Permissions test buyer",
      date: new Date().toISOString().slice(0, 10),
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    expect(invoice.status, invoice.text).toBe(200);
    const status = await owner.as.patch(`/api/invoices/${invoice.body.id}/status`, {
      status: "sent",
    });
    expect(status.status, status.text).toBe(200);
    const prefix = `/api/invoices/${invoice.body.id}/einvoice`;
    const setRole = (role: string) =>
      h.sql("UPDATE company_users SET role = $1 WHERE company_id = $2 AND user_id = $3", [
        role,
        owner.company.id,
        owner.user.id,
      ]);

    for (const mode of ["enforce", "off"]) {
      vi.stubEnv("RBAC_ENFORCE", mode);
      for (const role of ["employee", "bookkeeper"]) {
        await setRole(role);
        for (const action of ["submit", "resubmit"]) {
          const response = await owner.as.post(`${prefix}/${action}`, {});
          expect(response.status, response.text).toBe(403);
          expect(response.body).toMatchObject({
            code: "PERMISSION_DENIED",
            details: { permission: "tax.submit", role },
          });
        }
      }
    }

    await setRole("accountant");
    const submit = await owner.as.post(`${prefix}/submit`, {});
    expect(submit.status, submit.text).toBe(503);
    expect(submit.body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");
    const resubmit = await owner.as.post(`${prefix}/resubmit`, {});
    expect(resubmit.status, resubmit.text).toBe(409);
    expect(resubmit.body.code).toBe("EINVOICE_NOT_RESUBMITTABLE");
  });
});
