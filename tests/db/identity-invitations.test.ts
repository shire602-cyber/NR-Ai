/**
 * W2-C team invitations (R01-04, R01-15): hashed token, expiry, resend,
 * revoke, accept for new and existing users, no placeholder accounts.
 */
import { randomBytes, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const email = () => `invitee-${randomBytes(4).toString("hex")}@example.test`;
const tokenOf = (inviteUrl: string) => new URL(inviteUrl).searchParams.get("teamInvite")!;

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

async function invite(owner: Tenant, to: string, role = "accountant") {
  const r = await owner.as.post(`/api/companies/${owner.company.id}/team/invite`, {
    email: to,
    role,
  });
  expect(r.status, r.text).toBe(201);
  return r.body as {
    invitation: { id: string; status: string };
    delivery: string;
    inviteUrl: string;
  };
}

describe("R01-04 invitations without placeholder users", () => {
  it("R01-04: inviting a new email creates no user; the invitee accepts and sets a password", async () => {
    const owner = await h.createTenant({ name: "InvOwner" });
    const to = email();
    const inv = await invite(owner, to);
    // No email provider in the harness: the link is returned honestly.
    expect(inv.delivery).toBe("link");
    const token = tokenOf(inv.inviteUrl);
    expect(await h.sql(`SELECT 1 FROM users WHERE lower(email) = $1`, [to])).toHaveLength(0);
    const [row] = await h.sql(`SELECT token_hash FROM company_invitations WHERE id = $1`, [
      inv.invitation.id,
    ]);
    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.token_hash).not.toBe(token);

    const peek = await h.anon.get(`/api/team-invitations/${token}`);
    expect(peek.status).toBe(200);
    expect(peek.body).toMatchObject({ email: to, role: "accountant", accountExists: false });

    const accept = await anonPost(`/api/team-invitations/${token}/accept`, {
      name: "New Member",
      password: "Invitee9Secret!",
    });
    expect(accept.status, accept.text).toBe(200);
    expect(accept.body.token).toBeTruthy();
    const members = await h.sql(
      `SELECT cu.role FROM company_users cu JOIN users u ON u.id = cu.user_id
        WHERE cu.company_id = $1 AND u.email = $2`,
      [owner.company.id, to]
    );
    expect(members).toEqual([{ role: "accountant" }]);
    const login = await h.anon.post("/api/auth/login", { email: to, password: "Invitee9Secret!" });
    expect(login.status).toBe(200);

    const again = await anonPost(`/api/team-invitations/${token}/accept`, {
      name: "x",
      password: "Invitee9Secret!",
    });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe("INVITATION_ACCEPTED");
  });

  it("R01-04: the invited address can still self-register (no squatting)", async () => {
    const owner = await h.createTenant({ name: "Squat" });
    const to = email();
    await invite(owner, to, "viewer");
    const reg = await h.anon.post("/api/auth/register", {
      name: "Self",
      email: to,
      password: "Selfreg9Secret!",
    });
    expect(reg.status).toBe(200);
    // W5-E: registration answers generically; the new account can sign in.
    const login = await h.anon.post("/api/auth/login", { email: to, password: "Selfreg9Secret!" });
    expect(login.status, login.text).toBe(200);
    expect(login.body.token).toBeTruthy();
  });
});

describe("R01-15 invitation lifecycle", () => {
  it("R01-15: resend rotates the token; revoke and expiry block acceptance", async () => {
    const owner = await h.createTenant({ name: "Life" });
    const inv = await invite(owner, email());
    const oldToken = tokenOf(inv.inviteUrl);

    const resend = await owner.as.post(
      `/api/companies/${owner.company.id}/team/invitations/${inv.invitation.id}/resend`,
      {}
    );
    expect(resend.status, resend.text).toBe(200);
    const newToken = tokenOf(resend.body.inviteUrl);
    expect(newToken).not.toBe(oldToken);
    expect((await h.anon.get(`/api/team-invitations/${oldToken}`)).status).toBe(404);
    expect((await h.anon.get(`/api/team-invitations/${newToken}`)).status).toBe(200);

    // Expiry
    await h.sql(
      `UPDATE company_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [inv.invitation.id]
    );
    const expired = await h.anon.get(`/api/team-invitations/${newToken}`);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe("INVITATION_EXPIRED");

    // Resend revives an expired invitation, then revoke kills it.
    const revived = await owner.as.post(
      `/api/companies/${owner.company.id}/team/invitations/${inv.invitation.id}/resend`,
      {}
    );
    const liveToken = tokenOf(revived.body.inviteUrl);
    const revoke = await owner.as.delete(
      `/api/companies/${owner.company.id}/team/invitations/${inv.invitation.id}`
    );
    expect(revoke.status).toBe(200);
    expect(revoke.body.invitation.status).toBe("revoked");
    const blocked = await anonPost(`/api/team-invitations/${liveToken}/accept`, {
      name: "x",
      password: "Invitee9Secret!",
    });
    expect(blocked.status).toBe(410);
    expect(blocked.body.code).toBe("INVITATION_REVOKED");

    const list = await owner.as.get(`/api/companies/${owner.company.id}/team/invitations`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
  });

  it("leaves a placeholder untouched when a concurrent revoke wins", async () => {
    if (!h.concurrencySupported) return;
    const owner = await h.createTenant();
    const member = await h.createTenant();
    await h.sql("UPDATE users SET password_hash = '$placeholder$' WHERE id = $1", [member.user.id]);
    const invitation = await invite(owner, member.email);
    const token = tokenOf(invitation.inviteUrl);
    const { db } = await import("../../server/db");
    const { companyInvitations } = await import("../../shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    let acceptance: ReturnType<typeof anonPost> | undefined;
    await db.transaction(async (tx) => {
      const {
        rows: [backend],
      } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      await tx
        .select()
        .from(companyInvitations)
        .where(eq(companyInvitations.id, invitation.invitation.id))
        .for("update");
      acceptance = anonPost(`/api/team-invitations/${token}/accept`, {
        name: "New name",
        password: `${randomBytes(16).toString("hex")}A1!`,
      });
      await vi.waitFor(
        async () => {
          const blocked = await h.sql(
            "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
            [backend.pid]
          );
          expect(blocked).toHaveLength(1);
        },
        { timeout: 6000 }
      );
      await tx
        .update(companyInvitations)
        .set({ status: "revoked" })
        .where(eq(companyInvitations.id, invitation.invitation.id));
    });
    const rejected = await acceptance!;
    expect(rejected.status, rejected.text).toBe(410);
    expect(rejected.body.code).toBe("INVITATION_REVOKED");
    expect(
      await h.sql(
        "SELECT password_hash = '$placeholder$' AS placeholder, password_changed_at IS NULL AS unchanged FROM users WHERE id = $1",
        [member.user.id]
      )
    ).toEqual([{ placeholder: true, unchanged: true }]);
  });

  it("keeps scoped firm onboarding for a client without creating independent firm-staff access", async () => {
    const firm = await h.createTenant({ firmRole: "firm_owner" });
    const client = await h.createTenant({ companyColumns: { company_type: "client" } });
    const newcomer = await h.createTenant();
    const coworker = await h.createTenant({ firmRole: "reviewer" });
    const endpoint = `/api/companies/${client.company.id}/team/invite`;
    const invited = await firm.as.post(endpoint, { email: newcomer.email, role: "viewer" });
    expect(invited.status, invited.text).toBe(201);
    const accepted = await newcomer.as.post(
      `/api/team-invitations/${tokenOf(invited.body.inviteUrl)}/accept`,
      {}
    );
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.body.role).toBe("viewer");
    const denied = await firm.as.post(endpoint, { email: coworker.email, role: "accountant" });
    expect(denied.status, denied.text).toBe(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
  });

  it.each([false, true])(
    "keeps an invited viewer out of implicit firm assignment with mixed clocks = %s",
    async (mixedHistory) => {
      const customer = await h.createTenant({ companyColumns: { company_type: "client" } });
      const viewer = await h.createTenant();
      const invitation = await invite(customer, viewer.email, "viewer");
      if (mixedHistory) {
        // The receipt did not yet include a membership ID. Acceptance and the new membership
        // used one database transaction, but the recorded acceptance time came from Node UTC.
        const { db } = await import("../../server/db");
        const { recordAudit } = await import("../../server/services/audit.service");
        const { sql } = await import("drizzle-orm");
        await db.transaction(async (tx) => {
          await tx.execute(sql`INSERT INTO company_users (company_id, user_id, role)
            VALUES (${customer.company.id}, ${viewer.user.id}, 'viewer')`);
          await tx.execute(sql`UPDATE company_invitations SET status = 'accepted', accepted_user_id = ${viewer.user.id},
            accepted_at = (statement_timestamp() AT TIME ZONE 'UTC') - interval '4 hours' WHERE id = ${invitation.invitation.id}`);
          await recordAudit({
            userId: viewer.user.id,
            companyId: customer.company.id,
            action: "team.invite_accept",
            entityType: "company_invitation",
            entityId: invitation.invitation.id,
            after: { role: "viewer", directCompanyGrant: true },
            tx,
          });
        });
      } else {
        const accepted = await viewer.as.post(
          `/api/team-invitations/${tokenOf(invitation.inviteUrl)}/accept`,
          {}
        );
        expect(accepted.status, accepted.text).toBe(200);
      }
      await h.sql("UPDATE users SET firm_role = 'firm_admin', is_admin = true WHERE id = $1", [
        viewer.user.id,
      ]);
      const provider = `/api/companies/${customer.company.id}/einvoicing`;
      const blocked = await viewer.as.put(`${provider}/partner`, { partner: "acube" });
      expect(blocked.status, blocked.text).toBe(403);
      expect(blocked.body).toMatchObject({
        code: "PERMISSION_DENIED",
        details: { role: "viewer" },
      });
      const read = await viewer.as.get(`${provider}/provider`);
      expect(read.status, read.text).toBe(200);
      expect(read.body.status).toBe("not_selected");
    }
  );

  it("does not infer firm assignment from unaudited accepted legacy records", async () => {
    const customer = await h.createTenant({ companyColumns: { company_type: "client" } });
    const viewer = await h.createTenant({ firmRole: "firm_admin", isAdmin: true });
    const invitation = await invite(customer, viewer.email, "viewer");
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')", [
      customer.company.id,
      viewer.user.id,
    ]);
    await h.sql(
      `UPDATE company_invitations SET status = 'accepted', accepted_user_id = $1,
      accepted_at = (statement_timestamp() AT TIME ZONE 'UTC') - interval '4 hours' WHERE id = $2`,
      [viewer.user.id, invitation.invitation.id]
    );
    const url = `/api/companies/${customer.company.id}/einvoicing/partner`;
    const ambiguous = await viewer.as.put(url, { partner: "acube" });
    expect(ambiguous.status, ambiguous.text).toBe(403);
    expect(ambiguous.body.code).toBe("COMPANY_ACCESS_DENIED");
    await h.sql("INSERT INTO firm_staff_assignments (company_id, user_id) VALUES ($1, $2)", [
      customer.company.id,
      viewer.user.id,
    ]);
    const assigned = await viewer.as.put(url, { partner: "acube" });
    expect(assigned.status, assigned.text).toBe(200);
  });

  it("pins each new application database session to UTC", async () => {
    const { pool } = await import("../../server/db");
    for (let n = 0; n < 2; n++) {
      const client = await pool.connect();
      try {
        const { rows } = await client.query<{ TimeZone: string }>("SHOW TimeZone");
        expect(rows).toEqual([{ TimeZone: "UTC" }]);
      } finally {
        client.release(true);
      }
    }
  });

  it("requires explicit owner authority for owner role edits, removal, and invitations", async () => {
    const firm = await h.createTenant({ firmRole: "firm_owner", isAdmin: true });
    const client = await h.createTenant({ companyColumns: { company_type: "client" } });
    const secondOwner = await h.createTenant();
    const invitee = await h.createTenant();
    const [member] = await h.sql(
      "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id",
      [client.company.id, secondOwner.user.id]
    );
    const team = `/api/companies/${client.company.id}/team`;
    for (const result of [
      await firm.as.put(`${team}/${member.id}`, { role: "viewer" }),
      await firm.as.delete(`${team}/${member.id}`),
      await firm.as.post(`${team}/invite`, { email: invitee.email, role: "owner" }),
    ]) {
      expect(result.status, result.text).toBe(403);
      expect(result.body.code).toBe("ROLE_NOT_GRANTABLE");
    }
    const platform = await h.createTenant({ isAdmin: true });
    const saved = await platform.as.put(`${team}/${member.id}`, { role: "viewer" });
    expect(saved.status, saved.text).toBe(200);
  });

  it("preserves one owner when owner removal and demotion race", async () => {
    if (!h.concurrencySupported) return;
    const company = await h.createTenant();
    const second = await h.createTenant();
    const operator = await h.createTenant({ isAdmin: true });
    const [otherOwner] = await h.sql(
      "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner') RETURNING id",
      [company.company.id, second.user.id]
    );
    const [firstOwner] = await h.sql(
      "SELECT id FROM company_users WHERE company_id = $1 AND user_id = $2",
      [company.company.id, company.user.id]
    );
    const { db } = await import("../../server/db");
    const { users } = await import("../../shared/schema");
    const { inArray } = await import("drizzle-orm");
    const owners = [company.user.id, second.user.id];
    const team = `/api/companies/${company.company.id}/team`;
    const requests = await db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, owners))
        .orderBy(users.id)
        .for("update");
      const writes = [
        operator.as.delete(`${team}/${otherOwner.id}`),
        operator.as.put(`${team}/${firstOwner.id}`, { role: "viewer" }),
      ];
      await vi.waitFor(
        async () => {
          const blocked = await h.sql(
            "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0"
          );
          expect(blocked).toHaveLength(2);
        },
        { timeout: 7000 }
      );
      return writes;
    });
    const results = await Promise.all(requests);
    expect(results.filter((result) => result.status >= 200 && result.status < 300)).toHaveLength(1);
    expect(results.find((result) => result.status === 409)?.body.code).toBe("LAST_OWNER");
    expect(
      await h.sql("SELECT user_id FROM company_users WHERE company_id = $1 AND role = 'owner'", [
        company.company.id,
      ])
    ).toHaveLength(1);
  });

  it.each([false, true])(
    "does not accept a case-duplicate mailbox (signed in = %s)",
    async (authenticated) => {
      const company = await h.createTenant();
      const intended = await h.createTenant();
      const invitation = await invite(company, intended.email, "viewer");
      const token = tokenOf(invitation.inviteUrl);
      const duplicateId = `00000000-0000-4000-8000-0000000000${authenticated ? "ac" : "ab"}`;
      // Migration 0092 skips this index when historical case duplicates already exist.
      await h.sql("DROP INDEX users_email_lower_unique");
      try {
        await h.sql(
          "INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, 'Former import', '$placeholder$')",
          [duplicateId, intended.email.toUpperCase()]
        );
        const endpoint = `/api/team-invitations/${token}/accept`;
        const response = authenticated
          ? await intended.as.post(endpoint, {})
          : await anonPost(endpoint, {
              name: "Recipient",
              password: `${randomBytes(16).toString("hex")}A1!`,
            });
        expect(response.status, response.body.code).toBe(409);
        expect(response.body.code).toBe("INVITATION_EMAIL_AMBIGUOUS");
        expect(
          await h.sql("SELECT status FROM company_invitations WHERE id = $1", [
            invitation.invitation.id,
          ])
        ).toEqual([{ status: "pending" }]);
        expect(
          await h.sql(
            "SELECT password_hash = '$placeholder$' AS unchanged FROM users WHERE id = $1",
            [duplicateId]
          )
        ).toEqual([{ unchanged: true }]);
        expect(
          await h.sql(
            "SELECT user_id FROM company_users WHERE company_id = $1 AND user_id IN ($2, $3)",
            [company.company.id, duplicateId, intended.user.id]
          )
        ).toEqual([]);
      } finally {
        await h.sql("DELETE FROM company_users WHERE user_id = $1", [duplicateId]);
        await h.sql(
          "UPDATE company_invitations SET accepted_user_id = NULL WHERE accepted_user_id = $1",
          [duplicateId]
        );
        // Accepted baseline audit logs can reference the duplicate user, so change its email first.
        await h.sql("UPDATE users SET email = $1 WHERE id = $2", [email(), duplicateId]);
        await h.sql("CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))");
      }
    }
  );

  it("requires the inviter's independent authority when the invitation is accepted", async () => {
    const owner = await h.createTenant();
    const deputy = await h.createTenant();
    const invitee = await h.createTenant();
    const [access] = await h.sql(
      "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'admin') RETURNING id",
      [owner.company.id, deputy.user.id]
    );
    const team = `/api/companies/${owner.company.id}/team`;
    const invited = await deputy.as.post(`${team}/invite`, { email: invitee.email, role: "admin" });
    expect(invited.status, invited.text).toBe(201);
    const oldToken = tokenOf(invited.body.inviteUrl);
    const demoted = await owner.as.put(`${team}/${access.id}`, { role: "viewer" });
    expect(demoted.status, demoted.text).toBe(200);
    const rejected = await invitee.as.post(`/api/team-invitations/${oldToken}/accept`, {});
    expect(rejected.status, rejected.text).toBe(403);
    expect(rejected.body.code).toBe("PERMISSION_DENIED");
    const resent = await owner.as.post(
      `${team}/invitations/${invited.body.invitation.id}/resend`,
      {}
    );
    expect(resent.status, resent.text).toBe(200);
    const accepted = await invitee.as.post(
      `/api/team-invitations/${tokenOf(resent.body.inviteUrl)}/accept`,
      {}
    );
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.body.role).toBe("admin");
  });

  it("R01-15: an existing account must sign in to accept, as the invited email", async () => {
    const owner = await h.createTenant({ name: "Existing" });
    const invitee = await h.createSecondTenant({ name: "Invitee" });
    const stranger = await h.createTenant({ name: "Stranger" });
    const inv = await invite(owner, invitee.email.toUpperCase(), "bookkeeper");
    const token = tokenOf(inv.inviteUrl);

    const anon = await anonPost(`/api/team-invitations/${token}/accept`, {});
    expect(anon.status).toBe(409);
    expect(anon.body.code).toBe("LOGIN_REQUIRED");
    const wrong = await stranger.as.post(`/api/team-invitations/${token}/accept`, {});
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("INVITATION_EMAIL_MISMATCH");
    const ok = await invitee.as.post(`/api/team-invitations/${token}/accept`, {});
    expect(ok.status, ok.text).toBe(200);
    const rows = await h.sql(
      `SELECT role FROM company_users WHERE company_id = $1 AND user_id = $2`,
      [owner.company.id, invitee.user.id]
    );
    expect(rows).toEqual([{ role: "bookkeeper" }]);

    const dup = await owner.as.post(`/api/companies/${owner.company.id}/team/invite`, {
      email: invitee.email,
      role: "viewer",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("ALREADY_MEMBER");
  });

  it("R01-15: invitations are tenant-scoped and need team.manage", async () => {
    const a = await h.createTenant({ name: "ScopeA" });
    const b = await h.createSecondTenant({ name: "ScopeB" });
    const inv = await invite(a, email());
    const cross = await b.as.delete(
      `/api/companies/${b.company.id}/team/invitations/${inv.invitation.id}`
    );
    expect(cross.status).toBe(404);
    const crossResend = await b.as.post(
      `/api/companies/${b.company.id}/team/invitations/${inv.invitation.id}/resend`,
      {}
    );
    expect(crossResend.status).toBe(404);
    const [row] = await h.sql(`SELECT status FROM company_invitations WHERE id = $1`, [
      inv.invitation.id,
    ]);
    expect(row.status).toBe("pending");

    const emp = await h.createTenant({ name: "ScopeEmp" });
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'employee')`,
      [a.company.id, emp.user.id]
    );
    const denied = await emp.as.post(`/api/companies/${a.company.id}/team/invite`, {
      email: email(),
      role: "viewer",
    });
    expect(denied.status).toBe(403);

    const admin = await h.createTenant({ name: "ScopeAdmin" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'admin')`, [
      a.company.id,
      admin.user.id,
    ]);
    const ownerInvite = await admin.as.post(`/api/companies/${a.company.id}/team/invite`, {
      email: email(),
      role: "owner",
    });
    expect(ownerInvite.status).toBe(403);
    expect(ownerInvite.body.code).toBe("ROLE_NOT_GRANTABLE");
  });
});
