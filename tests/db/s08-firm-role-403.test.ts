// S08 — firm role matrix: firm_admin is blocked from assign-staff (requires firm.staff.manage).
//
// Source-inspection tests (tests/unit/role-matrix.test.ts) confirm the permission table, but they
// cannot prove the middleware fires on a live HTTP request. This file proves it end-to-end:
//   1. firm_admin → POST /api/firm/clients/:companyId/assign-staff → 403 FIRM_PERMISSION_DENIED
//   2. firm_owner → same endpoint → 200 and assignment persists
//   3. invalid bearer token → 401 TOKEN_INVALID
//
// The assign-staff route sits behind requireFirmAccess() (router-level) and then
// requireFirmPermission("firm.staff.manage"). firm_admin has firm access but not staff.manage.
import { expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

/** Create a firm_owner, link a client, and return both. */
async function linkedClient() {
  const owner = await h.createTenant({ firmRole: "firm_owner" });
  const client = await h.createTenant({ name: "Test Client LLC" });

  // Invite and accept a firm link.
  const invite = await owner.as.post("/api/firm/client-links", {
    inviteeEmail: client.email,
  });
  expect(invite.status, invite.text).toBe(201);
  const linkId = invite.body.link.id as string;
  const accepted = await client.as.post(`/api/firm-invitations/${linkId}/accept`, {
    companyId: client.company.id,
  });
  expect(accepted.status, accepted.text).toBe(200);
  return { owner, client };
}

it("firm_admin cannot assign staff (403 FIRM_PERMISSION_DENIED)", async () => {
  const { owner: _, client } = await linkedClient();
  const admin = await h.createTenant({ firmRole: "firm_admin" });

  // firm_admin tries to assign themselves to the client.
  const r = await admin.as.post(`/api/firm/clients/${client.company.id}/assign-staff`, {
    staffUserId: admin.user.id,
    action: "assign",
  });
  expect(r.status).toBe(403);
  expect(r.body.code).toBe("FIRM_PERMISSION_DENIED");
  expect(r.body.details?.permission).toBe("firm.staff.manage");
  expect(r.body.details?.role).toBe("firm_admin");
});

it("firm_owner can assign a preparer to a client (200)", async () => {
  const { owner, client } = await linkedClient();
  const preparer = await h.createTenant({ firmRole: "preparer" });

  const r = await owner.as.post(`/api/firm/clients/${client.company.id}/assign-staff`, {
    staffUserId: preparer.user.id,
    action: "assign",
  });
  expect(r.status, r.text).toBe(200);
  const assignments = await h.sql<{ role: string }>(
    "SELECT role FROM firm_staff_assignments WHERE company_id = $1 AND user_id = $2",
    [client.company.id, preparer.user.id]
  );
  expect(assignments).toEqual([{ role: "accountant" }]);
});

it("assign-staff rejects an invalid bearer token (401 TOKEN_INVALID)", async () => {
  // CSRF runs before auth for POSTs without a bearer token. Sending an invalid
  // bearer token exercises the auth middleware's token validation.
  const { client } = await linkedClient();
  const r = await h
    .client("not-a-real-jwt")
    .post(`/api/firm/clients/${client.company.id}/assign-staff`, {
      staffUserId: "00000000-0000-0000-0000-000000000000",
      action: "assign",
    });
  expect(r.status, r.text).toBe(401);
  expect(r.body.code).toBe("TOKEN_INVALID");
});
