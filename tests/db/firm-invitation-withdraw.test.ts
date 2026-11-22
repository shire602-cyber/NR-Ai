import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

it.skipIf(process.env.HARNESS_MODE !== "postgres")(
  "withdrawing while acceptance commits revokes access for that link and preserves a replacement link",
  async () => {
    const owner = await h.createTenant({ name: "Firm invitation owner" });
    const client = await h.createTenant({ name: "Client accepting an invitation" });
    const firmId = randomUUID();
    const companyId = client.company.id;
    await h.sql("INSERT INTO firms (id, name, slug, status) VALUES ($1, $2, $3, 'active')", [
      firmId,
      "Independent firm",
      `firm-${firmId}`,
    ]);
    await h.sql("INSERT INTO firm_members (firm_id, user_id, role) VALUES ($1, $2, 'firm_owner')", [
      firmId,
      owner.user.id,
    ]);
    const { inviteClient, withdrawFirmLink } =
      await import("../../server/services/firm/clients.service");
    const ctx = {
      firmId,
      isNr: false,
      role: "firm_owner",
      userId: owner.user.id,
      platformAdmin: false,
    } as const;
    const invite = await inviteClient(ctx, { inviteeEmail: client.email });
    const { pool } = await import("../../server/db");
    const blocker = await pool.connect();
    let acceptance: ReturnType<typeof client.as.post> | undefined;
    let withdrawal: ReturnType<typeof withdrawFirmLink> | undefined;
    async function waitForLock(queryPattern: string) {
      await vi.waitFor(
        async () => {
          const [row] = await h.sql<{ waiting: boolean }>(
            `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
               AND wait_event_type = 'Lock' AND query ~* $1
           ) AS waiting`,
            [queryPattern]
          );
          expect(row.waiting).toBe(true);
        },
        { timeout: 5000 }
      );
    }

    try {
      await blocker.query("BEGIN");
      // Acceptance has made the link active inside its transaction when it reaches the
      // automatic owner grant. Pause that insert while other transactions still see invited.
      await blocker.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [owner.user.id]);
      acceptance = client.as.post(`/api/firm-invitations/${invite.id}/accept`, { companyId });
      await waitForLock('insert into "company_users"');
      withdrawal = withdrawFirmLink(ctx, invite.id);
      await waitForLock('firm_membership|update "firm_client_links"');
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled([acceptance, withdrawal]);
    }

    const accepted = await acceptance!;
    expect(accepted.status, accepted.text).toBe(200);
    await withdrawal;
    expect(await h.sql("SELECT status FROM firm_client_links WHERE id = $1", [invite.id])).toEqual([
      { status: "revoked" },
    ]);
    const accessRows = () =>
      h.sql(
        `SELECT EXISTS (SELECT 1 FROM firm_company_grants WHERE company_id = $1 AND user_id = $2) AS grant,
              EXISTS (SELECT 1 FROM company_users WHERE company_id = $1 AND user_id = $2) AS membership`,
        [companyId, owner.user.id]
      );
    expect(await accessRows()).toEqual([{ grant: false, membership: false }]);
    expect((await owner.as.get(`/api/companies/${companyId}/accounts`)).status).toBe(403);

    const replacement = await inviteClient(ctx, { inviteeEmail: client.email });
    const linked = await client.as.post(`/api/firm-invitations/${replacement.id}/accept`, {
      companyId,
    });
    expect(linked.status, linked.text).toBe(200);
    await withdrawFirmLink(ctx, invite.id);
    expect(
      await h.sql("SELECT status FROM firm_client_links WHERE id = $1", [replacement.id])
    ).toEqual([{ status: "active" }]);
    expect(await accessRows()).toEqual([{ grant: true, membership: true }]);
    expect((await owner.as.get(`/api/companies/${companyId}/accounts`)).status).toBe(200);
  }
);

it.skipIf(process.env.HARNESS_MODE !== "postgres")(
  "checks the newly linked client's MFA when withdrawal started while the invitation was pending",
  async () => {
    const owner = await h.createTenant({ firmRole: "firm_owner" });
    const client = await h.createTenant();
    const companyId = client.company.id;
    const result = await owner.as.post("/api/firm/client-links", { inviteeEmail: client.email });
    expect(result.status, result.text).toBe(201);
    const linkId = result.body.link.id as string;
    const firmId = result.body.link.firmId as string;
    await h.sql(
      "INSERT INTO company_security_policies (company_id, require_mfa) VALUES ($1, 'all')",
      [companyId]
    );

    const { pool } = await import("../../server/db");
    const blocker = await pool.connect();
    let withdrawal: ReturnType<typeof owner.as.delete> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('firm_membership'), hashtext($1))",
        [firmId]
      );
      await blocker.query(
        "UPDATE firm_client_links SET status = 'active', company_id = $1 WHERE id = $2",
        [companyId, linkId]
      );
      withdrawal = owner.as.delete(`/api/firm/client-links/${linkId}`);
      await vi.waitFor(async () => {
        const [row] = await h.sql<{ waiting: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query LIKE '%firm_membership%'
        ) AS waiting`);
        expect(row!.waiting).toBe(true);
      });
      await blocker.query("COMMIT");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled([withdrawal]);
    }
    const denied = await withdrawal!;
    expect(denied.status, denied.text).toBe(403);
    expect(denied.body.code).toBe("MFA_ENROLLMENT_REQUIRED");
    expect(denied.body.details.companyId).toBe(companyId);
    expect(await h.sql("SELECT status FROM firm_client_links WHERE id = $1", [linkId])).toEqual([
      { status: "active" },
    ]);
  }
);
