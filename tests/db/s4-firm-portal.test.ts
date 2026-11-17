/**
 * S4 final sweep (firm & portal residuals): VAT workpaper maker-checker by
 * firm role, email-to-task for firm practice, the client-side firm screens'
 * API path (invitation accept/revoke, engagement letter, request upload), and
 * the /api/firms/me contract FirmRoute/AppSidebar rely on.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

// X6b: firm sign-up is closed by default (NR-internal); these tests onboard a second firm on purpose.
process.env.FIRM_SELF_SIGNUP = "true";

const h = useHarness();
const TRN = "100000000000003";

async function nrOwner() {
  return h.createTenant({ name: "S4NROwner", firmRole: "firm_owner" });
}

async function nrStaff(role: "firm_admin" | "preparer" | "reviewer" | "viewer", name: string) {
  const t = await h.createTenant({ name });
  await h.sql(`UPDATE users SET firm_role = $2 WHERE id = $1`, [t.user.id, role]);
  return t;
}

async function createClient(owner: Tenant, name: string) {
  const r = await owner.as.post("/api/firm/clients", { name, trnVatNumber: TRN });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string };
}

async function assign(owner: Tenant, companyId: string, staff: Tenant) {
  const r = await owner.as.post(`/api/firm/clients/${companyId}/assign-staff`, {
    staffUserId: staff.user.id,
    action: "assign",
  });
  expect(r.status, r.text).toBe(200);
}

/** A second, non-NR accounting firm approved by a platform admin. */
async function firmB() {
  const owner = await h.createTenant({ name: "S4FirmBOwner" });
  const applied = await owner.as.post("/api/firms/apply", { name: "S4 Second Firm LLC" });
  expect(applied.status, applied.text).toBe(201);
  const admin = await h.createTenant({ name: "S4PlatformAdmin", isAdmin: true });
  const decided = await admin.as.post(`/api/admin/firms/${applied.body.firm.id}/decision`, {
    decision: "approve",
  });
  expect(decided.status, decided.text).toBe(200);
  return owner;
}

describe("S4 VAT workpaper maker-checker uses canPrepare/canReviewFirmWorkpaper", () => {
  it("[S4-vat-maker-checker] a reviewer cannot prepare, a preparer cannot review; each side does its own step", async () => {
    const owner = await nrOwner();
    const preparer = await nrStaff("preparer", "S4Preparer");
    const reviewer = await nrStaff("reviewer", "S4Reviewer");
    const client = await createClient(owner, "S4 Workpaper Client LLC");
    await assign(owner, client.id, preparer);
    await assign(owner, client.id, reviewer);
    const body = { companyId: client.id, periodStart: "2026-07-01", periodEnd: "2026-09-30" };

    const denied = await reviewer.as.post("/api/firm/vat-workpapers", body);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("FIRM_WORKPAPER_PREPARE_DENIED");

    const created = await preparer.as.post("/api/firm/vat-workpapers", body);
    expect(created.status, created.text).toBe(201);
    const id = created.body.id as string;
    const url = `/api/firm/vat-workpapers/${id}/status`;

    expect((await reviewer.as.patch(url, { status: "prepared" })).body.code).toBe(
      "FIRM_WORKPAPER_PREPARE_DENIED"
    );
    const prepared = await preparer.as.patch(url, { status: "prepared" });
    expect(prepared.status, prepared.text).toBe(200);

    const selfReview = await preparer.as.patch(url, { status: "reviewed" });
    expect(selfReview.status).toBe(403);
    expect(selfReview.body.code).toBe("FIRM_WORKPAPER_REVIEW_DENIED");
    expect(
      (await preparer.as.post(`/api/firm/vat-workpapers/${id}/generate-return`, {})).body.code
    ).toBe("FIRM_WORKPAPER_REVIEW_DENIED");

    const reviewed = await reviewer.as.patch(url, { status: "reviewed" });
    expect(reviewed.status, reviewed.text).toBe(200);
    expect(reviewed.body.status).toBe("reviewed");
    // Reads stay open to both sides.
    expect((await reviewer.as.get(`/api/firm/vat-workpapers/${id}`)).status).toBe(200);
  });
});

describe("S4 email-to-task for firm practice (R15-15)", () => {
  it("[S4-email-to-task] an ingested client email becomes one review task; the mailbox boundary is labelled", async () => {
    const owner = await nrOwner();
    const client = await createClient(owner, "S4 Email Client LLC");
    const [source] = await h.sql<{ id: string }>(
      `INSERT INTO client_email_sources (company_id, firm_id, sender_email, status, created_by)
       VALUES ($1, $2, 'books@client.example', 'active', $2) RETURNING id`,
      [client.id, owner.user.id]
    );
    const messages: string[] = [];
    for (const subject of ["March receipts", "Bank statement"]) {
      const [m] = await h.sql<{ id: string }>(
        `INSERT INTO email_intake_messages
           (company_id, source_id, provider_message_id, from_email, subject, received_at,
            attachment_count, status)
         VALUES ($1, $2, $3, 'books@client.example', $4, '2026-03-10T08:00:00Z', 2, 'done')
         RETURNING id`,
        [client.id, source.id, `msg-${randomUUID()}`, subject]
      );
      messages.push(m.id);
    }

    const status = await owner.as.get("/api/firm/email-intake/status");
    expect(status.status).toBe(200);
    expect(status.body.emailToTask.automatic).toBe(true);
    expect(["disabled", "requires_external", "connected"]).toContain(
      status.body.emailToTask.mailbox
    );
    expect(status.body.emailToTask.note.en).toMatch(/external mailbox/i);
    expect(status.body.emailToTask.note.ar.length).toBeGreaterThan(20);

    const first = await owner.as.post(`/api/firm/email-intake/messages/${messages[0]}/task`, {});
    expect(first.status, first.text).toBe(201);
    expect(first.body.task).toMatchObject({
      companyId: client.id,
      source: "email",
      sourceKey: `email:${messages[0]}`,
      dueDate: "2026-03-13",
      status: "open",
    });
    expect(first.body.task.title).toContain("March receipts");
    const again = await owner.as.post(`/api/firm/email-intake/messages/${messages[0]}/task`, {});
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.task.id).toBe(first.body.task.id);

    const { createTasksForUntriagedMessages } =
      await import("../../server/services/firm/email-tasks.service");
    const swept = await createTasksForUntriagedMessages({ companyIds: [client.id] });
    expect(swept.created).toBe(1);
    expect((await createTasksForUntriagedMessages({ companyIds: [client.id] })).created).toBe(0);

    const listed = await owner.as.get(`/api/firm/email-intake/messages/${client.id}`);
    expect(listed.status).toBe(200);
    expect(listed.body.messages.every((m: { taskId: string | null }) => !!m.taskId)).toBe(true);
    const tasks = await owner.as.get(`/api/firm/tasks?companyId=${client.id}`);
    expect(tasks.status, tasks.text).toBe(200);
    expect(JSON.stringify(tasks.body)).toContain(`email:${messages[1]}`);
    const rows = await h.sql(
      `SELECT 1 FROM firm_tasks WHERE source = 'email' AND company_id = $1`,
      [client.id]
    );
    expect(rows).toHaveLength(2);

    // Email intake (and so email-to-task) stays NR-only; unknown message ids are 404.
    const b = await firmB();
    expect(
      (await b.as.post(`/api/firm/email-intake/messages/${messages[0]}/task`, {})).status
    ).toBe(403);
    expect(
      (await owner.as.post(`/api/firm/email-intake/messages/${randomUUID()}/task`, {})).status
    ).toBe(404);
    expect(
      (
        await owner.as.post(`/api/firm/email-intake/messages/${messages[0]}/task`, {
          bogus: true,
        })
      ).status
    ).toBe(400);
  });
});

describe("S4 firm UI access contract (/api/firms/me)", () => {
  it("[S4-firm-route] approved non-NR firm staff get a membership with permissions; NR-only APIs stay closed", async () => {
    const b = await firmB();
    const me = await b.as.get("/api/firms/me");
    expect(me.status).toBe(200);
    expect(me.body.membership).toMatchObject({ isNr: false, role: "firm_owner" });
    expect(me.body.membership.permissions.length).toBeGreaterThan(0);
    expect(me.body.membership.firm.status).toBe("active");
    expect((await b.as.get("/api/firm/clients")).status).toBe(200);
    for (const url of [
      "/api/firm/email-intake/status",
      "/api/firm/comms/templates",
      "/api/firm/value-ops/overview",
    ]) {
      expect((await b.as.get(url)).status, url).toBe(403);
    }
    const customer = await h.createTenant({ name: "S4Customer" });
    expect((await customer.as.get("/api/firms/me")).body.membership).toBeNull();
  });
});

describe("S4 client-side firm screens (invitation, engagement letter, request upload)", () => {
  it("[S4-portal] the owner accepts and revokes; a member signs the letter and uploads a requested document", async () => {
    const b = await firmB();
    const client = await h.createTenant({ name: "S4PortalClient" });
    const cid = client.company.id;
    const invite = await b.as.post("/api/firm/client-links", { inviteeEmail: client.email });
    expect(invite.status, invite.text).toBe(201);
    const inbox = await client.as.get("/api/firm-invitations");
    expect(inbox.body.ownedCompanies.map((c: { id: string }) => c.id)).toContain(cid);
    const accepted = await client.as.post(`/api/firm-invitations/${invite.body.link.id}/accept`, {
      companyId: cid,
    });
    expect(accepted.status, accepted.text).toBe(200);
    const links = await client.as.get(`/api/companies/${cid}/firm-links`);
    expect(links.body.links[0]).toMatchObject({ status: "active", firmName: "S4 Second Firm LLC" });

    // Engagement letter: typed-name acceptance.
    const letter = await b.as.post(`/api/firm/clients/${cid}/engagement-letters`, {
      title: "Bookkeeping engagement",
      body: "We will keep your books.",
      feeAmount: 500,
      billingCycle: "monthly",
    });
    expect(letter.status, letter.text).toBe(201);
    await b.as.post(`/api/firm/engagement-letters/${letter.body.letter.id}/send`);
    const shown = await client.as.get(`/api/companies/${cid}/engagement-letters`);
    expect(shown.body.letters[0].status).toBe("sent");
    const signed = await client.as.post(
      `/api/companies/${cid}/engagement-letters/${letter.body.letter.id}/respond`,
      { decision: "accept", typedName: "Client Owner" }
    );
    expect(signed.status, signed.text).toBe(200);
    expect(signed.body.letter).toMatchObject({ status: "accepted", acceptedName: "Client Owner" });

    // Request list: the screen uploads into the vault, then fulfils with that document.
    const list = await b.as.post(`/api/firm/clients/${cid}/requests`, {
      listName: "Quarter close",
      items: [{ title: "September bank statement" }],
    });
    expect(list.status, list.text).toBe(201);
    const reqId = list.body.requests[0].id;
    const pdf = Buffer.from("%PDF-1.4\n% september statement\n%%EOF\n");
    const doc = await client.as.post(`/api/companies/${cid}/documents`, {
      fileData: `data:application/pdf;base64,${pdf.toString("base64")}`,
      fileName: "september.pdf",
      name: "september",
      category: "other",
    });
    expect(doc.status, doc.text).toBe(201);
    const fulfilled = await client.as.post(`/api/companies/${cid}/firm-requests/${reqId}/fulfil`, {
      documentId: doc.body.id,
    });
    expect(fulfilled.status, fulfilled.text).toBe(200);
    expect(fulfilled.body.request.status).toBe("uploaded");
    const after = await client.as.get(`/api/companies/${cid}/firm-requests`);
    expect(after.body.requests[0].status).toBe("uploaded");

    // Revoke ends the firm's access immediately.
    const revoked = await client.as.post(
      `/api/companies/${cid}/firm-links/${invite.body.link.id}/revoke`,
      { reason: "Changed accountant" }
    );
    expect(revoked.status, revoked.text).toBe(200);
    expect((await b.as.get(`/api/firm/clients/${cid}/summary`)).status).toBe(403);
  });
});
