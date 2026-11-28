/**
 * CL-B (WP9): admin-created client invitations work end to end. The admin issues an
 * invitation (and the bulk client import hands out /register?invite= links); the invitee
 * previews it, accepts with a name and password, gets a session, and owns the invited company.
 * The Register page reads `?invite=` and calls the same two public endpoints.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const email = () => `admin-invitee-${randomBytes(4).toString("hex")}@example.test`;

/** Anonymous browser POST: fetch the CSRF token + cookies first, like the client does. */
async function anonPost(url: string, body: unknown) {
  const res = await fetch(`${h.baseUrl}/api/csrf-token`);
  const { csrfToken } = (await res.json()) as { csrfToken: string };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return h.anon.post(url, body, { headers: { Cookie: cookie, "X-CSRF-Token": csrfToken } });
}

describe("CL-B admin invitations", () => {
  it("[CL-B-invite] admin invites a client; the invitee previews, accepts, signs in and owns the company", async () => {
    const admin = await h.createTenant({ name: "InviteAdmin", isAdmin: true });
    const target = await h.createTenant({ name: "InvitedClientCo" });
    const to = email();

    const created = await admin.as.post("/api/admin/invitations", {
      email: to,
      companyId: target.company.id,
      userType: "client",
    });
    expect(created.status, created.text).toBe(201);
    const token = created.body.token as string;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const preview = await h.anon.get(`/api/invitations/verify/${token}`);
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body).toMatchObject({
      email: to,
      userType: "client",
      company: { id: target.company.id },
    });

    // The password policy applies to the invited account.
    const weak = await anonPost(`/api/invitations/accept/${token}`, {
      name: "Invited Owner",
      password: "Password1",
    });
    expect(weak.status).toBe(400);

    const accepted = await anonPost(`/api/invitations/accept/${token}`, {
      name: "Invited Owner",
      password: "Invitee9Secret!",
    });
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.body.user).toMatchObject({ email: to, userType: "client" });
    expect(accepted.body.token).toBeTruthy();

    const [membership] = await h.sql(
      `SELECT cu.role FROM company_users cu JOIN users u ON u.id = cu.user_id
        WHERE lower(u.email) = $1 AND cu.company_id = $2`,
      [to, target.company.id]
    );
    expect(membership.role).toBe("owner");
    const [invitation] = await h.sql(`SELECT status FROM invitations WHERE token = $1`, [token]);
    expect(invitation.status).toBe("accepted");

    // The invitee can sign in with the chosen password.
    const login = await anonPost("/api/auth/login", { email: to, password: "Invitee9Secret!" });
    expect(login.status, login.text).toBe(200);

    // A used link is dead: preview and accept both refuse it.
    expect((await h.anon.get(`/api/invitations/verify/${token}`)).status).toBe(400);
    const again = await anonPost(`/api/invitations/accept/${token}`, {
      name: "Second Try",
      password: "Invitee9Secret!",
    });
    expect(again.status).toBe(400);
  });

  it("[CL-B-invite] unknown and expired invitation links are refused", async () => {
    const admin = await h.createTenant({ name: "InviteAdmin2", isAdmin: true });
    const unknown = await h.anon.get(`/api/invitations/verify/${"0".repeat(64)}`);
    expect(unknown.status).toBe(404);

    const created = await admin.as.post("/api/admin/invitations", {
      email: email(),
      userType: "client",
    });
    expect(created.status, created.text).toBe(201);
    const token = created.body.token as string;
    await h.sql(`UPDATE invitations SET expires_at = now() - interval '1 day' WHERE token = $1`, [
      token,
    ]);
    expect((await h.anon.get(`/api/invitations/verify/${token}`)).status).toBe(400);
    const accept = await anonPost(`/api/invitations/accept/${token}`, {
      name: "Late Invitee",
      password: "Invitee9Secret!",
    });
    expect(accept.status).toBe(400);
  });

  it("[CL-B-invite] only a platform admin can create invitations", async () => {
    const customer = await h.createTenant({ name: "NotAdmin" });
    const r = await customer.as.post("/api/admin/invitations", {
      email: email(),
      userType: "client",
    });
    expect([401, 403]).toContain(r.status);
  });

  it("[CL-B-invite] the bulk client import hands out /register?invite= links that accept", async () => {
    const admin = await h.createTenant({ name: "ImportAdmin", isAdmin: true });
    const to = email();
    const imported = await admin.as.post("/api/admin/import/clients", {
      data: [{ companyName: "Imported Client LLC", name: "Imported Client LLC", email: to }],
      createInvitations: true,
    });
    expect(imported.status, imported.text).toBe(200);
    const link = imported.body.results.invitations[0]?.inviteLink as string | undefined;
    expect(link, imported.text).toMatch(/^\/register\?invite=[0-9a-f]{64}$/);
    const token = new URL(link!, "http://x").searchParams.get("invite")!;
    const accepted = await anonPost(`/api/invitations/accept/${token}`, {
      name: "Imported Owner",
      password: "Invitee9Secret!",
    });
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.body.user.email).toBe(to);
  });
});
