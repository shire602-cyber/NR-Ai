import { afterEach, describe, expect, it, vi } from "vitest";
import type { EInvoiceProvider } from "../../server/services/einvoice-provider";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();

afterEach(() => vi.unstubAllEnvs());

let emailProviderConfigured = false;
vi.mock("../../server/services/email.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/services/email.service")>()),
  hasEmailProvider: () => emailProviderConfigured,
}));
afterEach(() => {
  emailProviderConfigured = false;
});

async function issuedInvoice(owner: Tenant): Promise<string> {
  const buyer = await owner.as.post(`/api/companies/${owner.company.id}/customer-contacts`, {
    name: "Acme Gulf FZ-LLC",
    trnNumber: "100765432100003",
    address: "Building 7, Dubai Internet City",
    city: "Dubai",
    emirate: "dubai",
    country: "AE",
  });
  expect(buyer.status, buyer.text).toBeLessThan(300);
  const invoice = await owner.as.post(`/api/companies/${owner.company.id}/invoices`, {
    customerName: "Acme Gulf FZ-LLC",
    customerTrn: "100765432100003",
    contactId: buyer.body.id,
    paymentTerms: "net30",
    date: new Date().toISOString().slice(0, 10),
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(invoice.status, invoice.text).toBe(200);
  const status = await owner.as.patch(`/api/invoices/${invoice.body.id}/status`, {
    status: "sent",
  });
  expect(status.status, status.text).toBe(200);
  return invoice.body.id;
}

async function externalFirmClient(independentMembership = false, assign = true) {
  const owner = await h.createTenant();
  const staff = await h.createTenant();
  const customer = await h.createTenant({
    companyColumns: {
      trn_vat_number: "100123456700003",
      legal_name: "Pearl Trading L.L.C.",
      address_street: "Office 1204, Al Saqr Tower",
      address_city: "Dubai",
      address_country: "AE",
      emirate: "dubai",
      trade_licence_no: "CN-1234567",
      trade_licence_authority: "Dubai Department of Economy and Tourism",
    },
  });
  const platform = await h.createTenant({ isAdmin: true });
  const [firm] = await h.sql<{ id: string }>(
    "INSERT INTO firms (name, slug, status) VALUES ($1, $2, 'active') RETURNING id",
    ["External auditor test firm", `test-${owner.company.id}`]
  );
  await h.sql(
    "INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'firm_owner'), ($1, $3, 'reviewer')",
    [firm.id, owner.user.id, staff.user.id]
  );
  await h.sql(
    "INSERT INTO firm_client_links (firm_id, company_id, status) VALUES ($1, $2, 'active')",
    [firm.id, customer.company.id]
  );
  if (independentMembership) {
    await h.sql(
      "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')",
      [customer.company.id, staff.user.id]
    );
  }
  const { assignStaff } = await import("../../server/services/firm/staff.service");
  const context = {
    firmId: firm.id,
    userId: owner.user.id,
    isNr: false,
    role: "firm_owner",
    platformAdmin: false,
  } as const;
  if (assign) {
    const assigned = await assignStaff(context, {
      companyId: customer.company.id,
      staffUserId: staff.user.id,
      action: "assign",
    });
    expect(assigned.action).toBe("assign");
  }
  return {
    staff,
    customer,
    platform,
    context,
    firmId: firm.id,
    invoiceId: await issuedInvoice(customer),
  };
}

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

  it("honors a firm owner's direct role in their self-service company", async () => {
    const owner = await h.createTenant({
      isAdmin: true,
      firmRole: "firm_owner",
      userType: "admin",
      companyColumns: { company_type: "customer" },
    });
    const prefix = `/api/companies/${owner.company.id}/einvoicing`;

    for (const path of ["readiness", "settings", "inbound", "identity", "provider"]) {
      const response = await owner.as.get(`${prefix}/${path}`);
      expect(response.status, response.text).toBe(200);
    }
    const saved = await owner.as.put(`${prefix}/settings`, { tradeLicenceNo: "TEST-001" });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.identity.tradeLicenceNo).toBe("TEST-001");

    await h.sql("UPDATE company_users SET role = 'viewer' WHERE company_id = $1 AND user_id = $2", [
      owner.company.id,
      owner.user.id,
    ]);
    expect((await owner.as.get(`${prefix}/settings`)).status).toBe(200);
    const denied = await owner.as.put(`${prefix}/settings`, { tradeLicenceNo: "TEST-002" });
    expect(denied.status, denied.text).toBe(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
    expect((await owner.as.get(`${prefix}/settings`)).body.identity.tradeLicenceNo).toBe(
      "TEST-001"
    );
  });

  it("keeps another firm's linked customer behind the firm scope", async () => {
    const actor = await h.createTenant({ isAdmin: true, firmRole: "firm_owner" });
    const customer = await h.createSecondTenant({ companyColumns: { company_type: "customer" } });
    const [foreignFirm] = await h.sql(
      "INSERT INTO firms (name, slug, status) VALUES ('External Test Firm', 'external-einvoice', 'active') RETURNING id"
    );
    await h.sql(
      "INSERT INTO firm_client_links (firm_id, company_id, status) VALUES ($1, $2, 'active')",
      [foreignFirm.id, customer.company.id]
    );
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'admin')", [
      customer.company.id,
      actor.user.id,
    ]);
    const provider = await actor.as.get(
      `/api/companies/${customer.company.id}/einvoicing/provider`
    );
    expect(provider.status, provider.text).toBe(403);
    expect(provider.body.code).toBe("COMPANY_ACCESS_DENIED");
  });

  it("retains scoped provider reading for a platform admin without a firm role", async () => {
    const admin = await h.createTenant({ isAdmin: true });
    const client = await h.createSecondTenant();
    const provider = await admin.as.get(`/api/companies/${client.company.id}/einvoicing/provider`);
    expect(provider.status, provider.text).toBe(200);
    expect(provider.body.status).toBe("not_selected");
  });

  it("only tax.submit permits sending or resubmitting an issued e-invoice", async () => {
    const owner = await h.createTenant();
    const prefix = `/api/invoices/${await issuedInvoice(owner)}/einvoice`;
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

  it("rechecks firm-created roles on demotion, even when an old accountant row remains", async () => {
    const { context, staff, customer, invoiceId } = await externalFirmClient();
    const submit = () => staff.as.post(`/api/invoices/${invoiceId}/einvoice/submit`, {});
    expect((await submit()).body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");

    const { updateFirmMember } = await import("../../server/services/firm/staff.service");
    await updateFirmMember(context, staff.user.id, "preparer");
    const query = "SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2";
    const key = [customer.company.id, staff.user.id];
    expect(await h.sql(query, key)).toEqual([{ role: "bookkeeper" }]);
    expect((await submit()).body.code).toBe("PERMISSION_DENIED");

    await h.sql(
      "UPDATE company_users SET role = 'accountant' WHERE company_id = $1 AND user_id = $2",
      key
    );
    const stale = await submit();
    expect(stale.status, stale.text).toBe(403);
    expect(stale.body.code).toBe("PERMISSION_DENIED");
  });

  it.each([false, true])(
    "suspension preserves only independent company authority (direct membership = %s)",
    async (independentMembership) => {
      const { staff, platform, firmId, invoiceId } =
        await externalFirmClient(independentMembership);
      const submit = () => staff.as.post(`/api/invoices/${invoiceId}/einvoice/submit`, {});
      expect((await submit()).body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");

      const suspended = await platform.as.post(`/api/admin/firms/${firmId}/decision`, {
        decision: "suspend",
      });
      expect(suspended.status, suspended.text).toBe(200);
      const response = await submit();
      expect(response.status, response.text).toBe(independentMembership ? 503 : 404);
      expect(response.body.code).toBe(
        independentMembership ? "EINVOICE_PROVIDER_NOT_CONFIGURED" : "INVOICE_NOT_FOUND"
      );
      if (!independentMembership) {
        await h.sql("UPDATE users SET is_admin = true WHERE id = $1", [staff.user.id]);
        const dualRole = await submit();
        expect(dualRole.status, dualRole.text).toBe(404);
        expect(dualRole.body.code).toBe("INVOICE_NOT_FOUND");
      }
    }
  );

  it("records provenance when a removed independent membership is recreated through assignment", async () => {
    const { context, staff, customer, platform, firmId, invoiceId } =
      await externalFirmClient(true);
    const key = [customer.company.id, staff.user.id];
    await h.sql("DELETE FROM company_users WHERE company_id = $1 AND user_id = $2", key);
    const { assignStaff } = await import("../../server/services/firm/staff.service");
    await assignStaff(context, {
      companyId: customer.company.id,
      staffUserId: staff.user.id,
      action: "assign",
    });
    const provenance = await h.sql(
      "SELECT created_membership FROM firm_company_grants WHERE company_id = $1 AND user_id = $2",
      key
    );
    expect(provenance).toEqual([{ created_membership: true }]);
    const suspended = await platform.as.post(`/api/admin/firms/${firmId}/decision`, {
      decision: "suspend",
    });
    expect(suspended.status, suspended.text).toBe(200);
    const response = await staff.as.post(`/api/invoices/${invoiceId}/einvoice/submit`, {});
    expect(response.status, response.text).toBe(404);
    expect(response.body.code).toBe("INVOICE_NOT_FOUND");
  });

  it("rejects a stale external grant after staff and client move to the NR firm", async () => {
    const { staff, customer } = await externalFirmClient();
    await h.sql("UPDATE users SET firm_role = 'firm_admin', is_admin = true WHERE id = $1", [
      staff.user.id,
    ]);
    await h.sql("UPDATE firm_client_links SET firm_id = $1 WHERE company_id = $2", [
      "00000000-0000-4000-8000-000000000001",
      customer.company.id,
    ]);
    const response = await staff.as.get(
      `/api/companies/${customer.company.id}/einvoicing/provider`
    );
    expect(response.status, response.text).toBe(403);
    expect(response.body.code).toBe("COMPANY_ACCESS_DENIED");
  });

  it.each(["demotion", "suspension"])(
    "rechecks external firm authority at dispatch after %s",
    async (revokedBy) => {
      const { context, staff, customer, platform, firmId, invoiceId } = await externalFirmClient();
      await h.sql("UPDATE companies SET einvoice_partner = 'complyance' WHERE id = $1", [
        customer.company.id,
      ]);
      await h.sql(
        "INSERT INTO einvoice_legal_entities (company_id, provider, environment, tin, status) VALUES ($1, 'complyance', 'sandbox', '1001234567', 'active')",
        [customer.company.id]
      );
      const submit = vi.fn<EInvoiceProvider["submit"]>(async () => ({
        providerMessageId: "mock-tracked-document",
        status: "submitted",
      }));
      const { MockEInvoiceProvider } = await import("../../server/services/einvoice-provider");
      const provider: EInvoiceProvider = Object.assign(new MockEInvoiceProvider(), {
        name: "complyance",
        environment: "sandbox",
        requiresLegalEntity: true,
        submit,
      });
      const { storage } = await import("../../server/storage");
      const company = (await storage.getCompany(customer.company.id))!;
      const invoice = (await storage.getInvoice(invoiceId, customer.company.id))!;
      const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
        await import("../../server/services/einvoice/workflow");
      const now = new Date();
      const queued = await enqueueEInvoiceSubmission({
        company,
        invoice,
        provider,
        actorId: staff.user.id,
        now,
      });
      expect(queued.ok, JSON.stringify(queued)).toBe(true);
      if (revokedBy === "demotion") {
        const { updateFirmMember } = await import("../../server/services/firm/staff.service");
        await updateFirmMember(context, staff.user.id, "preparer");
      } else {
        const result = await platform.as.post(`/api/admin/firms/${firmId}/decision`, {
          decision: "suspend",
        });
        expect(result.status, result.text).toBe(200);
      }
      await runEInvoiceRetries(new Date(now.getTime() + 1000), () => provider);
      expect(submit).not.toHaveBeenCalled();
      expect(
        await h.sql(
          "SELECT status, last_error_code FROM einvoice_documents WHERE invoice_id = $1",
          [invoiceId]
        )
      ).toEqual([{ status: "failed", last_error_code: "PERMISSION_DENIED" }]);
    }
  );

  it("accepts a direct team invitation over a firm-created membership and keeps the direct role", async () => {
    const { context, staff, customer, platform, firmId, invoiceId } = await externalFirmClient();
    const invited = await customer.as.post(`/api/companies/${customer.company.id}/team/invite`, {
      email: staff.email,
      role: "accountant",
    });
    expect(invited.status, invited.text).toBe(201);
    const token = new URL(invited.body.inviteUrl).searchParams.get("teamInvite");
    const accepted = await staff.as.post(`/api/team-invitations/${token}/accept`, {});
    expect(accepted.status, accepted.text).toBe(200);

    const { updateFirmMember, assignStaff, removeFirmMember } =
      await import("../../server/services/firm/staff.service");
    await updateFirmMember(context, staff.user.id, "preparer");
    const memberAndGrant = await h.sql(
      `SELECT cu.role, g.created_membership
         FROM company_users cu JOIN firm_company_grants g USING (company_id, user_id)
        WHERE cu.company_id = $1 AND cu.user_id = $2`,
      [customer.company.id, staff.user.id]
    );
    expect(memberAndGrant).toEqual([{ role: "accountant", created_membership: false }]);

    const suspended = await platform.as.post(`/api/admin/firms/${firmId}/decision`, {
      decision: "suspend",
    });
    expect(suspended.status, suspended.text).toBe(200);
    const submit = () => staff.as.post(`/api/invoices/${invoiceId}/einvoice/submit`, {});
    expect((await submit()).body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");

    const resumed = await platform.as.post(`/api/admin/firms/${firmId}/decision`, {
      decision: "approve",
    });
    expect(resumed.status, resumed.text).toBe(200);
    await assignStaff(context, {
      companyId: customer.company.id,
      staffUserId: staff.user.id,
      action: "unassign",
    });
    expect((await submit()).body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");
    await removeFirmMember(context, staff.user.id);
    expect((await submit()).body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");
  });

  it("honors the originally invited role when firm assignment and revocation intervene", async () => {
    const { context, staff, customer, invoiceId } = await externalFirmClient(false, false);
    const companyId = customer.company.id;
    const invited = await customer.as.post(`/api/companies/${companyId}/team/invite`, {
      email: staff.email,
      role: "viewer",
    });
    expect(invited.status, invited.text).toBe(201);
    const token = new URL(invited.body.inviteUrl).searchParams.get("teamInvite");
    const { assignStaff, removeFirmMember } =
      await import("../../server/services/firm/staff.service");
    await assignStaff(context, { companyId, staffUserId: staff.user.id, action: "assign" });

    const { endClientLink } = await import("../../server/services/firm/clients.service");
    const [accepted] = await Promise.all([
      staff.as.post(`/api/team-invitations/${token}/accept`, {}),
      endClientLink(context, companyId, context.userId, null),
    ]);
    expect(accepted.status, accepted.text).toBe(200);
    await removeFirmMember(context, staff.user.id);
    expect(
      await h.sql("SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2", [
        companyId,
        staff.user.id,
      ])
    ).toEqual([{ role: "viewer" }]);
    const submit = await staff.as.post(`/api/invoices/${invoiceId}/einvoice/submit`, {});
    expect(submit.status, submit.text).toBe(403);
    expect(submit.body.code).toBe("PERMISSION_DENIED");
  });

  it("keeps a generated membership firm-scoped after an ordinary team role save", async () => {
    const { context, staff, customer, platform, firmId } = await externalFirmClient();
    const companyId = customer.company.id;
    const [member] = await h.sql<{ id: string }>(
      "SELECT id FROM company_users WHERE company_id = $1 AND user_id = $2",
      [companyId, staff.user.id]
    );
    const changed = await customer.as.put(`/api/companies/${companyId}/team/${member.id}`, {
      role: "admin",
    });
    expect(changed.status, changed.text).toBe(200);
    expect(
      await h.sql(
        "SELECT created_membership FROM firm_company_grants WHERE company_id = $1 AND user_id = $2",
        [companyId, staff.user.id]
      )
    ).toEqual([{ created_membership: true }]);
    const promote = await customer.as.put(`/api/companies/${companyId}/team/${member.id}`, {
      role: "owner",
    });
    expect(promote.status, promote.text).toBe(403);
    expect(promote.body.code).toBe("ROLE_NOT_GRANTABLE");
    const { updateFirmMember } = await import("../../server/services/firm/staff.service");
    await updateFirmMember(context, staff.user.id, "viewer");
    const suspended = await platform.as.post(`/api/admin/firms/${firmId}/decision`, {
      decision: "suspend",
    });
    expect(suspended.status, suspended.text).toBe(200);
    const selected = await staff.as.put(`/api/companies/${companyId}/einvoicing/partner`, {
      partner: "acube",
    });
    expect(selected.status, selected.text).toBe(403);
    expect(selected.body.code).toBe("PERMISSION_DENIED");
  });

  it("scopes invitation listing, revocation, and member removal to the assigned client", async () => {
    const firm = await h.createTenant({ firmRole: "firm_admin", isAdmin: true });
    const owner = await h.createTenant({ companyColumns: { company_type: "client" } });
    const person = await h.createTenant();
    const prefix = `/api/companies/${owner.company.id}/team`;
    const invited = await owner.as.post(`${prefix}/invite`, {
      email: person.email,
      role: "viewer",
    });
    expect(invited.status, invited.text).toBe(201);
    const invitation = `${prefix}/invitations/${invited.body.invitation.id}`;
    const [member] = await h.sql(
      "INSERT INTO company_users (company_id,user_id,role) VALUES ($1,$2,'viewer') RETURNING id",
      [owner.company.id, person.user.id]
    );
    for (const result of [
      await firm.as.get(`${prefix}/invitations`),
      await firm.as.delete(invitation),
      await firm.as.delete(`${prefix}/${member.id}`),
    ]) {
      expect(result.status, result.text).toBe(403);
      expect(result.body.code).toBe("COMPANY_ACCESS_DENIED");
    }
    expect((await owner.as.get(`${prefix}/invitations`)).body[0].status).toBe("pending");
    expect((await owner.as.delete(invitation)).status).toBe(200);
    expect((await owner.as.delete(`${prefix}/${member.id}`)).status).toBe(204);
  });

  it("reconciles a proven historic direct invitation through firm demotion and removal", async () => {
    const { context, staff, customer, invoiceId } = await externalFirmClient();
    const companyId = customer.company.id;
    const invited = await customer.as.post(`/api/companies/${companyId}/team/invite`, {
      email: staff.email,
      role: "viewer",
    });
    expect(invited.status, invited.text).toBe(201);
    const invitationId = invited.body.invitation.id;
    // Legacy acceptance recorded consent but left the already-present accountant role intact.
    await h.sql(
      "UPDATE company_invitations SET status = 'accepted', accepted_user_id = $1, accepted_at = now() WHERE id = $2",
      [staff.user.id, invitationId]
    );
    const { recordAudit } = await import("../../server/services/audit.service");
    await recordAudit({
      companyId,
      userId: staff.user.id,
      action: "team.invite_accept",
      entityType: "company_invitation",
      entityId: invitationId,
      after: { role: "viewer" },
    });
    const submit = () => staff.as.post(`/api/invoices/${invoiceId}/einvoice/submit`, {});
    expect((await submit()).body.code).toBe("PERMISSION_DENIED");
    const { updateFirmMember, removeFirmMember } =
      await import("../../server/services/firm/staff.service");
    await updateFirmMember(context, staff.user.id, "preparer");
    await removeFirmMember(context, staff.user.id);
    expect(
      await h.sql("SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2", [
        companyId,
        staff.user.id,
      ])
    ).toEqual([{ role: "viewer" }]);
    expect((await submit()).body.code).toBe("PERMISSION_DENIED");
  });

  it("repairs a false marker proven to come from an older Team role edit", async () => {
    const { context, staff, customer, invoiceId } = await externalFirmClient();
    const companyId = customer.company.id;
    const [member] = await h.sql<{ id: string }>(
      "UPDATE company_users SET role = 'admin' WHERE company_id = $1 AND user_id = $2 RETURNING id",
      [companyId, staff.user.id]
    );
    await h.sql(
      "UPDATE firm_company_grants SET created_membership = false WHERE company_id = $1 AND user_id = $2",
      [companyId, staff.user.id]
    );
    await h.sql(
      "INSERT INTO audit_logs (company_id, user_id, action, resource_type, resource_id, details) VALUES ($1, $2, 'team.role_change', 'company_user', $3, 'old unstructured audit')",
      [companyId, customer.user.id, member.id]
    );
    const { recordAudit } = await import("../../server/services/audit.service");
    await recordAudit({
      companyId,
      userId: customer.user.id,
      action: "team.role_change",
      entityType: "company_user",
      entityId: member.id,
      before: { userId: staff.user.id, role: "accountant" },
      after: { userId: staff.user.id, role: "admin" },
    });
    // A delegated NR firm owner has scoped Team access but the damaged marker is not a direct grant.
    const { NR_FIRM_ID } = await import("../../server/services/firm/scope");
    await h.sql("UPDATE users SET firm_role = 'firm_owner' WHERE id = $1", [staff.user.id]);
    await h.sql("UPDATE firm_client_links SET firm_id = $1 WHERE company_id = $2", [
      NR_FIRM_ID,
      companyId,
    ]);
    const stranger = await h.createTenant();
    const denied = await staff.as.post(`/api/companies/${companyId}/team/invite`, {
      email: stranger.email,
      role: "viewer",
    });
    expect(denied.status, denied.text).toBe(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
    await h.sql("UPDATE users SET firm_role = NULL WHERE id = $1", [staff.user.id]);
    await h.sql("UPDATE firm_client_links SET firm_id = $1 WHERE company_id = $2", [
      context.firmId,
      companyId,
    ]);
    const { removeFirmMember } = await import("../../server/services/firm/staff.service");
    await removeFirmMember(context, staff.user.id);
    expect(
      await h.sql("SELECT id FROM company_users WHERE company_id = $1 AND user_id = $2", [
        companyId,
        staff.user.id,
      ])
    ).toEqual([]);
    const submit = await staff.as.post(`/api/invoices/${invoiceId}/einvoice/submit`, {});
    expect(submit.status, submit.text).toBe(404);
  });

  it.each([false, true])(
    "preserves a direct NR client's role without treating it as a firm assignment (with previous firm grant = %s)",
    async (previouslyAssigned) => {
      const owner = await h.createTenant({ firmRole: "firm_owner" });
      const staff = await h.createTenant({ firmRole: "firm_admin", isAdmin: true });
      const customer = await h.createTenant({ companyColumns: { company_type: "client" } });
      const companyId = customer.company.id;
      const prefix = `/api/companies/${companyId}/einvoicing`;
      const { NR_FIRM_ID, canAccessFirmClient, resolveFirmContext } =
        await import("../../server/services/firm/scope");
      const context = {
        firmId: NR_FIRM_ID,
        userId: owner.user.id,
        isNr: true,
        role: "firm_owner",
        platformAdmin: false,
      } as const;
      const { assignStaff, removeFirmMember } =
        await import("../../server/services/firm/staff.service");
      const assignment = { companyId, staffUserId: staff.user.id };
      const staffFirm = (await resolveFirmContext({ id: staff.user.id }))!;
      if (previouslyAssigned) {
        await assignStaff(context, { ...assignment, action: "assign" });
        // Migration 0108 backfilled grant markers from legacy company memberships.
        await h.sql("DELETE FROM firm_staff_assignments WHERE company_id = $1 AND user_id = $2", [
          companyId,
          staff.user.id,
        ]);
        expect(await canAccessFirmClient(staffFirm, companyId)).toBe(true);
      }
      const invited = await customer.as.post(`/api/companies/${companyId}/team/invite`, {
        email: staff.email,
        role: "viewer",
      });
      expect(invited.status, invited.text).toBe(201);
      const token = new URL(invited.body.inviteUrl).searchParams.get("teamInvite");
      const accepted = await staff.as.post(`/api/team-invitations/${token}/accept`, {});
      expect(accepted.status, accepted.text).toBe(200);

      if (previouslyAssigned) await assignStaff(context, { ...assignment, action: "unassign" });
      expect(await canAccessFirmClient(staffFirm, companyId)).toBe(false);
      const directRead = await staff.as.get(`${prefix}/provider`);
      expect(directRead.status, directRead.text).toBe(200);
      const choose = () => staff.as.put(`${prefix}/partner`, { partner: "acube" });
      const directDenied = await choose();
      expect(directDenied.status, directDenied.text).toBe(403);
      expect(directDenied.body).toMatchObject({
        code: "PERMISSION_DENIED",
        details: { role: "viewer" },
      });

      await assignStaff(context, { ...assignment, action: "assign" });
      expect(await canAccessFirmClient(staffFirm, companyId)).toBe(true);
      expect((await choose()).status).toBe(200);
      await assignStaff(context, { ...assignment, action: "unassign" });
      await removeFirmMember(context, staff.user.id);
      expect((await staff.as.get(`${prefix}/provider`)).status).toBe(200);
      expect((await choose()).status).toBe(403);
      expect(
        await h.sql(
          "SELECT created_membership FROM firm_company_grants WHERE company_id = $1 AND user_id = $2",
          [companyId, staff.user.id]
        )
      ).toEqual([{ created_membership: false }]);
    }
  );

  it("requires verified email for each authorized transmission action", async () => {
    const owner = await h.createTenant();
    const invoiceId = await issuedInvoice(owner);
    await h.sql(
      "UPDATE users SET email_verified = false, created_at = '2025-01-01' WHERE id = $1",
      [owner.user.id]
    );
    emailProviderConfigured = true;
    vi.stubEnv("EMAIL_VERIFICATION_GRACE_DAYS", "0");
    for (const action of ["submit", "resubmit", "confirm-environment"]) {
      const response = await owner.as.post(`/api/invoices/${invoiceId}/einvoice/${action}`, {});
      expect(response.status, response.text).toBe(403);
      expect(response.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    }
  });
});
