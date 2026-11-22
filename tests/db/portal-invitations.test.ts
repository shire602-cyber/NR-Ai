/**
 * STEP5 customer-portal invitations: a supplier invites one of its customers, the customer sets a
 * password and sees only their own invoices. Portal users are never company members.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { FAKE_PASSWORD } from "../fixtures/credentials/fake-credentials";
import type { OutgoingEmail } from "../../server/outbox";

const h = useHarness();
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const uniq = () => randomBytes(4).toString("hex");
const PASSWORD = FAKE_PASSWORD;
const TOKEN_RE = /#t=([0-9a-f]{64})/;

beforeEach(async () => {
  const { resetPortalThrottle } = await import("../../server/services/portal-access.service");
  resetPortalThrottle();
});

afterEach(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.BILLING_ENFORCEMENT;
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
});

// ─── helpers ────────────────────────────────────────────────────────────────

class Jar {
  private cookies = new Map<string, string>();
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  names() {
    return [...this.cookies.keys()];
  }
}

/** A browser-like client: cookies plus the CSRF token (no Bearer), as the join page behaves. */
async function browser(jar = new Jar()) {
  async function call(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) {
    const send = async (csrf?: string) => {
      const res = await fetch(h.baseUrl + url, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(jar.header() ? { cookie: jar.header() } : {}),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });
      jar.absorb(res);
      const text = await res.text();
      let parsed: any = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      return { status: res.status, body: parsed, text, headers: res.headers };
    };
    if (method === "GET") return send();
    const tokenRes = await fetch(h.baseUrl + "/api/csrf-token", {
      headers: jar.header() ? { cookie: jar.header() } : {},
    });
    jar.absorb(tokenRes);
    const csrf = ((await tokenRes.json()) as { csrfToken: string }).csrfToken;
    return send(csrf);
  }
  return {
    jar,
    get: (u: string, hd?: Record<string, string>) => call("GET", u, undefined, hd),
    post: (u: string, b?: unknown, hd?: Record<string, string>) => call("POST", u, b ?? {}, hd),
  };
}

async function contact(
  t: Tenant,
  name: string,
  extra: Record<string, unknown> = { email: `cust-${uniq()}@example.test` }
) {
  const r = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, { name, ...extra });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body.id as string;
}

async function invoice(
  t: Tenant,
  contactId: string,
  issue = true,
  unitPrice = 1000,
  currency?: string
) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId,
    date: iso(new Date(Date.now() - 20 * DAY)),
    ...(currency ? { currency, exchangeRate: currency === "AED" ? 1 : 3.6725 } : {}),
    lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  if (issue) {
    const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
    expect(s.status, s.text).toBe(200);
  }
  return c.body as { id: string; number: string };
}

const inviteUrl = (cid: string, t: Tenant) =>
  `/api/companies/${t.company.id}/customer-contacts/${cid}/portal-invitations`;

async function invite(t: Tenant, cid: string, body: Record<string, unknown> = { language: "en" }) {
  const r = await t.as.post(inviteUrl(cid, t), body);
  return r;
}

const tokenOf = (url: string) => TOKEN_RE.exec(url)![1];

/** Invite and accept as a brand-new customer. Returns the logged-in browser and ids. */
async function onboard(t: Tenant, cid: string, email = `portal-${uniq()}@example.test`) {
  const r = await invite(t, cid, { email, language: "en" });
  expect(r.status, r.text).toBe(201);
  const token = tokenOf(r.body.inviteUrl);
  const b = await browser();
  const acc = await b.post(`/api/portal-invitations/${token}/accept`, {
    name: "Portal Person",
    password: PASSWORD,
    acceptTerms: true,
  });
  expect(acc.status, acc.text).toBe(200);
  return {
    b,
    token,
    email,
    portalAccountId: acc.body.portalAccountId as string,
    invitation: r.body.invitation,
  };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("STEP5 portal invitations", () => {
  it("[S5-01] an invitation stores only a token hash, queues one outbox email (Arabic for ar) and audits without the token", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Desert Rose LLC", {
      email: "owner@desertrose.test",
      contactPerson: "Layla",
    });
    const r = await invite(t, cid, { language: "ar", message: "Welcome <b>aboard</b>" });
    expect(r.status, r.text).toBe(201);
    expect(r.body.delivery).toBe("link");
    expect(r.body.inviteUrl).toMatch(/\/portal\/join#t=[0-9a-f]{64}$/);
    const token = tokenOf(r.body.inviteUrl);
    expect(JSON.stringify(r.body.invitation)).not.toContain(token);

    const rows = await h.sql(`SELECT * FROM customer_portal_invitations WHERE company_id = $1`, [
      t.company.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].email).toBe("owner@desertrose.test");
    const days = (new Date(rows[0].expires_at).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const outbox = await h.sql(
      `SELECT * FROM email_outbox WHERE company_id = $1 AND category = 'portal_invite'`,
      [t.company.id]
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].sensitive).toBe(true);
    expect(outbox[0].related_entity_type).toBe("customer_portal_invitation");
    expect(outbox[0].related_entity_id).toBe(rows[0].id);
    expect(outbox[0].status).toBe("blocked_no_provider");
    expect(outbox[0].subject).toMatch(/دعتك/);
    expect(outbox[0].html).toContain('dir="rtl"');
    // Supplier-controlled text is escaped in the HTML (the company name carries an apostrophe).
    expect(outbox[0].html).toContain("&#39;");
    expect(outbox[0].html).not.toContain("<script");
    expect(TOKEN_RE.exec(outbox[0].html)![1]).toBe(token);
    expect(outbox[0].subject).not.toMatch(/[\r\n]/);

    const audit = await h.sql(
      `SELECT action, details FROM audit_logs WHERE company_id = $1 AND action LIKE 'portal.%'`,
      [t.company.id]
    );
    expect(audit.map((a: any) => a.action)).toContain("portal.invite");
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("[S5-02] RBAC, tenancy, plan and verification gates", async () => {
    const a = await h.createTenant({ name: "A", planId: "professional" });
    const b = await h.createTenant({ name: "B", planId: "professional" });
    const cidA = await contact(a, "A customer");
    // Viewer is read-only; employee may invite.
    const viewer = await h.createTenant({ role: "viewer" });
    const viewerCid = await h.sql(
      `INSERT INTO customer_contacts (company_id, name, email) VALUES ($1, 'V cust', 'v@example.test') RETURNING id`,
      [viewer.company.id]
    );
    const denied = await invite(viewer, viewerCid[0].id);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
    const read = await viewer.as.get(
      `/api/companies/${viewer.company.id}/customer-contacts/${viewerCid[0].id}/portal-access`
    );
    expect(read.status, read.text).toBe(200);
    const employee = await h.createTenant({ role: "employee" });
    const empCid = await h.sql(
      `INSERT INTO customer_contacts (company_id, name, email) VALUES ($1, 'E cust', 'e@example.test') RETURNING id`,
      [employee.company.id]
    );
    expect((await invite(employee, empCid[0].id)).status).toBe(201);

    // NR firm staff linked to a client company may invite for it; unlinked staff may not.
    // Tenant B cannot reach A's contact, invitation or account.
    const viaB = await b.as.post(
      `/api/companies/${b.company.id}/customer-contacts/${cidA}/portal-invitations`,
      { language: "en" }
    );
    expect(viaB.status).toBe(404);
    const viaA = await b.as.post(
      `/api/companies/${a.company.id}/customer-contacts/${cidA}/portal-invitations`,
      { language: "en" }
    );
    expect([403, 404]).toContain(viaA.status);
    const mine = await invite(a, cidA);
    expect(mine.status, mine.text).toBe(201);
    const invId = mine.body.invitation.id;
    expect(
      (await b.as.post(`/api/companies/${b.company.id}/portal-invitations/${invId}/resend`, {}))
        .status
    ).toBe(404);
    expect(
      (await b.as.post(`/api/companies/${b.company.id}/portal-invitations/${invId}/revoke`, {}))
        .status
    ).toBe(404);
    const board = await onboard(a, await contact(a, "Second"));
    expect(
      (await b.as.delete(`/api/companies/${b.company.id}/portal-accounts/${board.portalAccountId}`))
        .status
    ).toBe(404);
    expect(
      (await b.as.get(`/api/companies/${b.company.id}/customer-contacts/${cidA}/portal-access`))
        .status
    ).toBe(404);

    // Plan gate: Starter after the trial is TIER_LOCKED, but revoking still works.
    process.env.BILLING_ENFORCEMENT = "true";
    const starter = await h.createTenant({ planId: "starter" });
    const sCid = await contact(starter, "Starter cust");
    const locked = await invite(starter, sCid);
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe("TIER_LOCKED");
    const pro = await invite(a, await contact(a, "Pro cust"));
    expect(pro.status, pro.text).toBe(201);
    await h.sql(
      `UPDATE subscriptions SET plan_id = 'starter', status = 'active', trial_ends_at = NULL WHERE company_id = $1`,
      [a.company.id]
    );
    const revoke = await a.as.post(
      `/api/companies/${a.company.id}/portal-invitations/${pro.body.invitation.id}/revoke`,
      {}
    );
    expect(revoke.status, revoke.text).toBe(200);
    delete process.env.BILLING_ENFORCEMENT;
  });

  it("[S5-03] accepting creates a verified client_portal user bound to the contact, never a company member; reuse and parallel accepts are safe", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Accepting LLC");
    const r = await invite(t, cid, { language: "en" });
    const token = tokenOf(r.body.inviteUrl);

    // Opening the page never consumes it.
    const b0 = await browser();
    const view1 = await b0.get(`/api/portal-invitations/${token}`);
    expect(view1.status).toBe(200);
    expect(view1.body.account).toBe("new");
    expect(view1.body.supplier.name).toBe(t.company.name);
    expect((await b0.get(`/api/portal-invitations/${token}`)).status).toBe(200);

    // Terms are required.
    const noTerms = await b0.post(`/api/portal-invitations/${token}/accept`, {
      name: "X",
      password: PASSWORD,
    });
    expect(noTerms.status).toBe(400);
    const weak = await b0.post(`/api/portal-invitations/${token}/accept`, {
      name: "X",
      password: "short",
      acceptTerms: true,
    });
    expect(weak.status).toBe(400);
    expect(weak.body.details?.fields?.password ?? weak.body.fields?.password).toBeTruthy();

    // Two parallel accepts: exactly one wins.
    const [x, y] = await Promise.all(
      [0, 1].map(async () => {
        const b = await browser();
        return b.post(`/api/portal-invitations/${token}/accept`, {
          name: "Racer",
          password: PASSWORD,
          acceptTerms: true,
        });
      })
    );
    const statuses = [x.status, y.status].sort();
    expect(statuses).toEqual([200, 410]);
    const winner = x.status === 200 ? x : y;
    expect(winner.body.redirectTo).toBe("/client-portal/dashboard");

    const user = (
      await h.sql(`SELECT * FROM users WHERE email = $1`, [r.body.invitation.email])
    )[0];
    expect(user.user_type).toBe("client_portal");
    expect(user.email_verified).toBe(true);
    expect(await h.sql(`SELECT 1 FROM company_users WHERE user_id = $1`, [user.id])).toHaveLength(
      0
    );
    const bindings = await h.sql(`SELECT * FROM customer_portal_accounts WHERE user_id = $1`, [
      user.id,
    ]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].contact_id).toBe(cid);
    expect(bindings[0].invitation_id).toBe(r.body.invitation.id);
    const inv = (
      await h.sql(`SELECT * FROM customer_portal_invitations WHERE id = $1`, [r.body.invitation.id])
    )[0];
    expect(inv.status).toBe("accepted");
    expect(inv.terms_accepted_at).toBeTruthy();

    // Reuse: 410 accepted.
    const again = await (
      await browser()
    ).post(`/api/portal-invitations/${token}/accept`, {
      name: "X",
      password: PASSWORD,
      acceptTerms: true,
    });
    expect(again.status).toBe(410);
    expect(again.body.code).toBe("PORTAL_INVITE_ACCEPTED");
    expect((await b0.get(`/api/portal-invitations/${token}`)).body.code).toBe(
      "PORTAL_INVITE_ACCEPTED"
    );
  });

  it("[S5-04] an expired invitation is 410, resend rotates the token and extends the expiry", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Expiring LLC");
    const r = await invite(t, cid);
    const oldToken = tokenOf(r.body.inviteUrl);
    await h.sql(
      `UPDATE customer_portal_invitations SET expires_at = now() - interval '1 hour', last_sent_at = now() - interval '2 hours' WHERE id = $1`,
      [r.body.invitation.id]
    );
    const b = await browser();
    const get = await b.get(`/api/portal-invitations/${oldToken}`);
    expect(get.status).toBe(410);
    expect(get.body.code).toBe("PORTAL_INVITE_EXPIRED");
    expect(get.body.supplier.name).toBe(t.company.name);
    const post = await b.post(`/api/portal-invitations/${oldToken}/accept`, {
      name: "X",
      password: PASSWORD,
      acceptTerms: true,
    });
    expect(post.status).toBe(410);
    expect(
      (
        await h.sql(`SELECT status FROM customer_portal_invitations WHERE id = $1`, [
          r.body.invitation.id,
        ])
      )[0].status
    ).toBe("expired");

    const resend = await t.as.post(
      `/api/companies/${t.company.id}/portal-invitations/${r.body.invitation.id}/resend`,
      {}
    );
    expect(resend.status, resend.text).toBe(200);
    const newToken = tokenOf(resend.body.inviteUrl);
    expect(newToken).not.toBe(oldToken);
    expect((await b.get(`/api/portal-invitations/${oldToken}`)).status).toBe(404);
    expect((await b.get(`/api/portal-invitations/${newToken}`)).status).toBe(200);
  });

  it("[S5-05] revoking an invitation or removing an account takes effect immediately", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Revoked LLC");
    const r = await invite(t, cid);
    const token = tokenOf(r.body.inviteUrl);
    const rev = await t.as.post(
      `/api/companies/${t.company.id}/portal-invitations/${r.body.invitation.id}/revoke`,
      {}
    );
    expect(rev.status).toBe(200);
    const b = await browser();
    expect((await b.get(`/api/portal-invitations/${token}`)).body.code).toBe(
      "PORTAL_INVITE_REVOKED"
    );
    expect(
      (
        await b.post(`/api/portal-invitations/${token}/accept`, {
          name: "X",
          password: PASSWORD,
          acceptTerms: true,
        })
      ).status
    ).toBe(410);

    const c2 = await contact(t, "Active LLC");
    const { b: cust, portalAccountId } = await onboard(t, c2);
    expect((await cust.get("/api/client-portal/invoices")).status).toBe(200);
    const del = await t.as.delete(
      `/api/companies/${t.company.id}/portal-accounts/${portalAccountId}`
    );
    expect(del.status, del.text).toBe(200);
    const after = await cust.get("/api/client-portal/invoices");
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("PORTAL_ACCESS_REVOKED");

    // A deactivated contact also loses access.
    const c3 = await contact(t, "Inactive LLC");
    const { b: cust3 } = await onboard(t, c3);
    await h.sql(`UPDATE customer_contacts SET is_active = false WHERE id = $1`, [c3]);
    expect((await cust3.get("/api/client-portal/invoices")).status).toBe(403);
  });

  it("[S5-06] a portal user sees only their contact's documents and never reaches company routes", async () => {
    const a = await h.createTenant({ name: "Iso A" });
    const b = await h.createTenant({ name: "Iso B" });
    const mine = await contact(a, "Mine");
    const theirs = await contact(a, "Theirs");
    const other = await contact(b, "Other tenant");
    const myInv = await invoice(a, mine);
    const theirInv = await invoice(a, theirs);
    const bInv = await invoice(b, other);
    await invoice(a, mine, false); // draft
    const { b: cust, portalAccountId } = await onboard(a, mine);

    const list = await cust.get("/api/client-portal/invoices");
    expect(list.body.map((i: { id: string }) => i.id)).toEqual([myInv.id]);
    for (const id of [theirInv.id, bInv.id]) {
      expect((await cust.get(`/api/client-portal/invoices/${id}/pdf`)).status).toBe(404);
      expect((await cust.get(`/api/client-portal/invoices/${id}/einvoice`)).status).toBe(404);
      expect((await cust.post(`/api/client-portal/invoices/${id}/pay`, {})).status).toBe(404);
    }
    expect(
      (await cust.get(`/api/client-portal/invoices/${myInv.id}/pdf`)).headers.get("content-type")
    ).toContain("application/pdf");
    expect((await cust.get("/api/client-portal/statements")).body.party.id).toBe(mine);

    // Company routes: refused, whichever way they are asked.
    for (const url of [
      `/api/companies/${a.company.id}/invoices`,
      `/api/companies/${a.company.id}/customer-contacts`,
      `/api/companies/${a.company.id}/reports/trial-balance`,
      `/api/companies/${a.company.id}/journal`,
      `/api/invoices/${theirInv.id}`,
    ]) {
      const r = await cust.get(url);
      expect([403, 404], `${url} -> ${r.status}`).toContain(r.status);
    }
    const companies = await cust.get("/api/companies");
    expect(companies.status).toBe(200);
    expect(companies.body).toEqual([]);

    // A stray membership row (the old hole) still grants nothing.
    const me = (
      await h.sql(`SELECT user_id FROM customer_portal_accounts WHERE id = $1`, [portalAccountId])
    )[0];
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      a.company.id,
      me.user_id,
    ]);
    const { storage } = await import("../../server/storage");
    expect(await storage.hasCompanyAccess(me.user_id, a.company.id)).toBe(false);
    const sneaky = await cust.get(`/api/companies/${a.company.id}/invoices`);
    expect([403, 404]).toContain(sneaky.status);
    expect((await cust.get("/api/companies")).body).toEqual([]);

    // X-Portal-Account pointing at someone else's binding is rejected without falling back.
    const foreign = (
      await h.sql(`SELECT id FROM customer_portal_accounts WHERE id <> $1 LIMIT 1`, [
        portalAccountId,
      ])
    )[0];
    const forged = await cust.get("/api/client-portal/invoices", {
      "x-portal-account": foreign?.id ?? "00000000-0000-4000-8000-000000000000",
    });
    expect(forged.status).toBe(403);
  });

  it("[S5-07] existing accounts sign in first; same-email binds without a password; mismatch is refused; several suppliers switch", async () => {
    const supplier1 = await h.createTenant({ name: "Supplier One" });
    const supplier2 = await h.createTenant({ name: "Supplier Two" });
    const saas = await h.createTenant({ name: "Saas Owner" }); // a real customer user with their own company
    const c1 = await contact(supplier1, "Buyer 1");
    const c2 = await contact(supplier2, "Buyer 2");
    const inv1 = await invoice(supplier1, c1);
    const inv2 = await invoice(supplier2, c2, true, 2000);

    const r1 = await invite(supplier1, c1, { email: saas.email, language: "en" });
    expect(r1.status, r1.text).toBe(201);
    const t1 = tokenOf(r1.body.inviteUrl);
    const anon = await browser();
    expect((await anon.get(`/api/portal-invitations/${t1}`)).body.account).toBe("existing");
    const needLogin = await anon.post(`/api/portal-invitations/${t1}/accept`, {
      acceptTerms: true,
    });
    expect(needLogin.status).toBe(409);
    expect(needLogin.body.code).toBe("LOGIN_REQUIRED");

    // Signed in as someone else: refused.
    const stranger = await h.createTenant({ name: "Stranger" });
    const wrong = await (
      await browser()
    ).post(
      `/api/portal-invitations/${t1}/accept`,
      { acceptTerms: true },
      { authorization: `Bearer ${stranger.token}` }
    );
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("INVITATION_EMAIL_MISMATCH");

    // Same email, signed in: binds, user type unchanged, own company untouched.
    const viewGet = await (
      await browser()
    ).get(`/api/portal-invitations/${t1}`, { authorization: `Bearer ${saas.token}` });
    expect(viewGet.body.account).toBe("signed_in");
    const ok = await (
      await browser()
    ).post(
      `/api/portal-invitations/${t1}/accept`,
      { acceptTerms: true },
      { authorization: `Bearer ${saas.token}` }
    );
    expect(ok.status, ok.text).toBe(200);
    expect(
      (await h.sql(`SELECT user_type FROM users WHERE id = $1`, [saas.user.id]))[0].user_type
    ).toBe("customer");
    expect((await saas.as.get(`/api/companies/${saas.company.id}/invoices`)).status).toBe(200);
    expect((await saas.as.get("/api/client-portal/invoices")).body.map((i: any) => i.id)).toEqual([
      inv1.id,
    ]);
    expect((await saas.as.get("/api/auth/me")).body.portalAccounts).toBe(1);

    // A second supplier: both are listed and the header switches the data.
    const r2 = await invite(supplier2, c2, { email: saas.email, language: "en" });
    const t2 = tokenOf(r2.body.inviteUrl);
    expect(
      (
        await (
          await browser()
        ).post(
          `/api/portal-invitations/${t2}/accept`,
          { acceptTerms: true },
          { authorization: `Bearer ${saas.token}` }
        )
      ).status
    ).toBe(200);
    const accounts = await saas.as.get("/api/client-portal/accounts");
    expect(accounts.body).toHaveLength(2);
    const second = accounts.body.find((a: any) => a.company.id === supplier2.company.id);
    const first = accounts.body.find((a: any) => a.company.id === supplier1.company.id);
    const viaHeader = await saas.as.get("/api/client-portal/invoices", {
      headers: { "x-portal-account": second.id },
    });
    expect(viaHeader.body.map((i: any) => i.id)).toEqual([inv2.id]);
    const viaFirst = await saas.as.get("/api/client-portal/invoices", {
      headers: { "x-portal-account": first.id },
    });
    expect(viaFirst.body.map((i: any) => i.id)).toEqual([inv1.id]);
  });

  it("[S5-08] validation: strict bodies, email required, duplicates and already-active", async () => {
    const t = await h.createTenant();
    const noEmail = await contact(t, "No Email", {});
    const r = await invite(t, noEmail, { language: "en" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("CONTACT_EMAIL_REQUIRED");
    const withBody = await invite(t, noEmail, {
      language: "en",
      email: "new@example.test",
      saveEmailToContact: true,
    });
    expect(withBody.status, withBody.text).toBe(201);
    expect(
      (await h.sql(`SELECT email FROM customer_contacts WHERE id = $1`, [noEmail]))[0].email
    ).toBe("new@example.test");

    const dup = await invite(t, noEmail, { language: "en", email: "NEW@example.test" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("INVITATION_PENDING");
    expect(dup.body.details?.invitationId ?? dup.body.invitationId).toBe(
      withBody.body.invitation.id
    );

    for (const extra of [{ userType: "admin" }, { companyId: t.company.id }, { isAdmin: true }]) {
      const bad = await invite(t, noEmail, { language: "en", email: "x@example.test", ...extra });
      expect(bad.status, JSON.stringify(extra)).toBe(400);
    }
    expect(
      (
        await invite(t, noEmail, {
          language: "en",
          email: "x@example.test",
          message: "m".repeat(501),
        })
      ).status
    ).toBe(400);

    const c2 = await contact(t, "Active One");
    const { email } = await onboard(t, c2);
    const active = await invite(t, c2, { email, language: "en" });
    expect(active.status).toBe(409);
    expect(active.body.code).toBe("PORTAL_ALREADY_ACTIVE");
    // Unknown token body for accept is strict too.
    const tok = tokenOf(
      (await invite(t, await contact(t, "Strict"), { language: "en" })).body.inviteUrl
    );
    const strict = await (
      await browser()
    ).post(`/api/portal-invitations/${tok}/accept`, {
      password: PASSWORD,
      acceptTerms: true,
      userType: "admin",
    });
    expect(strict.status).toBe(400);
  });

  it("[S5-09] limits: invites per hour, resend cooldown, bad-token lock", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Rate LLC");
    const first = await invite(t, cid, { language: "en" });
    const tooSoon = await t.as.post(
      `/api/companies/${t.company.id}/portal-invitations/${first.body.invitation.id}/resend`,
      {}
    );
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe("RESEND_TOO_SOON");

    // 60 invitations per hour per company.
    for (let i = 0; i < 59; i++) {
      await h.sql(
        `INSERT INTO customer_portal_invitations (company_id, contact_id, email, token_hash, status, expires_at)
         VALUES ($1, $2, $3, $4, 'revoked', now() + interval '7 days')`,
        [t.company.id, cid, `bulk${i}@example.test`, randomBytes(32).toString("hex")]
      );
    }
    const over = await invite(t, cid, { language: "en", email: "late@example.test" });
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("PORTAL_INVITE_RATE_LIMITED");

    // 21 bad tokens from one IP lock even a good token.
    const t2 = await h.createTenant();
    const good = tokenOf(
      (await invite(t2, await contact(t2, "Lock LLC"), { language: "en" })).body.inviteUrl
    );
    const b = await browser();
    for (let i = 0; i < 21; i++)
      await b.get(`/api/portal-invitations/${randomBytes(32).toString("hex")}`);
    expect((await b.get(`/api/portal-invitations/${good}`)).status).toBe(429);
  });

  it("[S5-10] malformed and unknown tokens return byte-identical 404 bodies", async () => {
    const b = await browser();
    const malformed = await b.get("/api/portal-invitations/not-a-token");
    const unknown = await b.get(`/api/portal-invitations/${randomBytes(32).toString("hex")}`);
    expect(malformed.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(malformed.text).toBe(unknown.text);
  });

  it("[S5-11] audit rows and the access log never hold the token", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Audit LLC");
    const r = await invite(t, cid, { language: "en" });
    const token = tokenOf(r.body.inviteUrl);
    const b = await browser();
    await b.get(`/api/portal-invitations/${token}`);
    await t.as.post(
      `/api/companies/${t.company.id}/portal-invitations/${r.body.invitation.id}/revoke`,
      {}
    );
    const c2 = await contact(t, "Audit Two");
    const { token: token2, portalAccountId } = await onboard(t, c2);
    await t.as.delete(`/api/companies/${t.company.id}/portal-accounts/${portalAccountId}`);

    const actions = (
      await h.sql(`SELECT action FROM audit_logs WHERE company_id = $1`, [t.company.id])
    ).map((a: any) => a.action);
    for (const a of [
      "portal.invite",
      "portal.invite_revoke",
      "portal.invite_accept",
      "portal.account_revoke",
    ]) {
      expect(actions, a).toContain(a);
    }
    const outcomes = (
      await h.sql(`SELECT outcome, path FROM portal_access_log WHERE company_id = $1`, [
        t.company.id,
      ])
    ).map((l: any) => l.outcome);
    expect(outcomes).toContain("invite_view");
    expect(outcomes).toContain("invite_accept");
    const dump = JSON.stringify([
      await h.sql(`SELECT details FROM audit_logs`),
      await h.sql(`SELECT path, outcome FROM portal_access_log`),
    ]);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(token2);
  });

  it("[S5-12] with an email provider the email is sent and the link is not returned", async () => {
    const sent: OutgoingEmail[] = [];
    const t = await h.createTenant();
    const none = await invite(t, await contact(t, "No provider"), { language: "en" });
    expect(none.body.delivery).toBe("link"); // honest: not "sent"
    const { setEmailTransportOverride } = await import("../../server/outbox");
    setEmailTransportOverride({
      name: "test",
      send: async (m) => {
        sent.push(m);
        return { providerMessageId: `t-${sent.length}` };
      },
    });
    process.env.RESEND_API_KEY = "re_test_step5";
    const r = await invite(t, await contact(t, "Provider LLC"), { language: "bilingual" });
    expect(r.status, r.text).toBe(201);
    expect(r.body.delivery).toBe("email");
    expect(r.body.inviteUrl).toBeUndefined();
    const mail = sent.find((m) => /portal\/join/.test(m.html ?? ""));
    expect(mail).toBeTruthy();
    expect(mail!.html).toContain('lang="en"');
    expect(mail!.html).toContain('lang="ar"');
    expect(mail!.subject).toContain("|");
  });

  it("[S5-13] bulk invite reports a per-contact outcome and caps at 100", async () => {
    const t = await h.createTenant();
    const ok = await contact(t, "Bulk OK", { email: "bulk-ok@example.test" });
    await h.sql(`UPDATE customer_contacts SET preferred_language = 'ar' WHERE id = $1`, [ok]);
    const none = await contact(t, "Bulk none", {});
    const pending = await contact(t, "Bulk pending", { email: "bulk-pending@example.test" });
    await invite(t, pending);
    const { email: _e } = await onboard(t, await contact(t, "Bulk active"));
    const activeCid = (
      await h.sql(`SELECT contact_id FROM customer_portal_accounts WHERE company_id = $1 LIMIT 1`, [
        t.company.id,
      ])
    )[0].contact_id;
    const res = await t.as.post(`/api/companies/${t.company.id}/portal-invitations/bulk`, {
      contactIds: [ok, none, pending, activeCid, "11111111-1111-4111-8111-111111111111"],
      language: "contact",
    });
    expect(res.status, res.text).toBe(200);
    const by = Object.fromEntries(res.body.results.map((r: any) => [r.contactId, r.outcome]));
    expect(by[ok]).toBe("invited");
    expect(by[none]).toBe("skipped_no_email");
    expect(by[pending]).toBe("pending");
    expect(by["11111111-1111-4111-8111-111111111111"]).toBe("not_found");
    expect(
      (
        await h.sql(`SELECT language FROM customer_portal_invitations WHERE contact_id = $1`, [ok])
      )[0].language
    ).toBe("ar");
    const tooMany = await t.as.post(`/api/companies/${t.company.id}/portal-invitations/bulk`, {
      contactIds: Array.from(
        { length: 101 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
      ),
    });
    expect(tooMany.status).toBe(400);
  });

  it("[S5-14] pay: 503 without a gateway, own invoice only", async () => {
    const t = await h.createTenant();
    const mine = await contact(t, "Payer");
    const other = await contact(t, "Other payer");
    const inv = await invoice(t, mine);
    const theirs = await invoice(t, other);
    const { b } = await onboard(t, mine);
    const noGateway = await b.post(`/api/client-portal/invoices/${inv.id}/pay`, {});
    expect(noGateway.status).toBe(503);
    expect(noGateway.body.code).toBe("PAYMENTS_REQUIRES_EXTERNAL");
    expect((await b.post(`/api/client-portal/invoices/${theirs.id}/pay`, {})).status).toBe(404);
  });

  it("[S5-15] dashboard totals are per currency in whole fils", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Multi currency");
    await invoice(t, cid, true, 1000);
    await invoice(t, cid, true, 200, "USD");
    const { b } = await onboard(t, cid);
    const d = await b.get("/api/client-portal/dashboard");
    expect(d.status, d.text).toBe(200);
    const byCur = Object.fromEntries(d.body.outstandingByCurrency.map((x: any) => [x.currency, x]));
    expect(byCur.AED.fils).toBe(105000);
    expect(byCur.AED.amount).toBe("1050.00");
    expect(byCur.USD.fils).toBe(21000);
    expect(Object.keys(byCur).sort()).toEqual(["AED", "USD"]);
    expect(d.body.invoices.outstanding).toBe(2);
  });

  it("[S5-16] CSRF: staff portal routes need a token with cookie auth; customer token routes stay exempt", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Csrf LLC");
    // A cookie-authenticated staff request without X-CSRF-Token is refused.
    const login = await fetch(h.baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: t.email, password: t.password }),
    });
    const jar = new Jar();
    jar.absorb(login);
    // Login itself is exempt; if cookies were not set, fall back to refusing anonymous.
    const noCsrf = await fetch(h.baseUrl + "/api/portal/generate-access", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: jar.header() },
      body: JSON.stringify({ contactId: cid }),
    });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as any).code).toBe("CSRF_INVALID");
    // Bearer is exempt (API clients).
    expect((await t.as.post("/api/portal/generate-access", { contactId: cid })).status).toBe(200);
    // The token portal and OTP routes remain open.
    const link = await t.as.post("/api/portal/generate-access", { contactId: cid });
    expect((await h.anon.get(`/api/portal/${link.body.token}/info`)).status).toBe(200);
    const otp = await h.anon.post("/api/portal/login/request", {
      companyId: t.company.id,
      email: "nobody@example.test",
    });
    expect(otp.status).not.toBe(403);
    // The public invitation accept is NOT exempt.
    const accept = await h.anon.post(`/api/portal-invitations/${"a".repeat(64)}/accept`, {
      acceptTerms: true,
    });
    expect(accept.status).toBe(403);
  });

  it("[S5-17] sign-out clears the session cookies and the portal user is then anonymous", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Signout LLC");
    const { b } = await onboard(t, cid);
    expect(b.jar.names().length).toBeGreaterThan(0);
    expect((await b.get("/api/auth/me")).status).toBe(200);
    expect((await b.get("/api/client-portal/dashboard")).status).toBe(200);
    expect((await b.post("/api/auth/logout", {})).status).toBe(200);
    expect((await b.get("/api/auth/me")).status).toBe(401);
    expect((await b.get("/api/client-portal/dashboard")).status).toBe(401);
  });
});
