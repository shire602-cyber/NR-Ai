/**
 * STEP5 product fixes on the customer portal: overdue by the settlement rule and the Asia/Dubai
 * calendar date, "next due" never in the past, fallback to another active supplier, bulk invites
 * that return their links without an email provider, the invitation note and the display name.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const DAY = 86_400_000;
const uniq = () => randomBytes(4).toString("hex");
const TOKEN_RE = /#t=([0-9a-f]{64})/;
const dubaiDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(
    new Date(Date.now() + offsetDays * DAY)
  );

beforeEach(async () => {
  const { resetPortalThrottle } = await import("../../server/services/portal-access.service");
  resetPortalThrottle();
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

async function contact(t: Tenant, name: string, extra: Record<string, unknown> = {}) {
  const r = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name,
    email: `cust-${uniq()}@example.test`,
    ...extra,
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body.id as string;
}

async function invoice(t: Tenant, contactId: string, dueDate: string | null, unitPrice = 1000) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId,
    date: dubaiDate(-30),
    ...(dueDate ? { dueDate } : {}),
    lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string; number: string };
}

async function pay(t: Tenant, invoiceId: string, amount: number) {
  const bank = await h.sql(`SELECT id FROM accounts WHERE company_id = $1 AND code = '1020'`, [
    t.company.id,
  ]);
  const r = await t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/payments`, {
    date: dubaiDate(0),
    method: "bank",
    paymentAccountId: bank[0].id,
    amount,
  });
  expect(r.status, r.text).toBeLessThan(300);
}

/** The raw token only ever lives in the invitation email (here: the outbox, no provider). */
async function tokenOf(invitationId: string) {
  const [mail] = await h.sql(
    `SELECT html FROM email_outbox WHERE category = 'portal_invite' AND related_entity_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [invitationId]
  );
  const token = TOKEN_RE.exec(mail?.html ?? "")?.[1];
  if (!token) throw new Error("Missing invitation email in test outbox");
  return token;
}

/** A cookie-session visitor (the join page): CSRF token first, then the POST. */
async function anonPost(url: string, body: unknown) {
  const tokenRes = await fetch(h.baseUrl + "/api/csrf-token");
  const cookie = (tokenRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const csrf = ((await tokenRes.json()) as { csrfToken: string }).csrfToken;
  const res = await fetch(h.baseUrl + url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-csrf-token": csrf },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}

/** Bind an existing (SaaS) user to a contact through the invitation. */
async function bind(supplier: Tenant, cid: string, user: Tenant) {
  // Accepting needs proof of the mailbox: the account's email must be verified.
  await h.sql(`UPDATE users SET email_verified = true, email_verified_at = now() WHERE id = $1`, [
    user.user.id,
  ]);
  const r = await supplier.as.post(
    `/api/companies/${supplier.company.id}/customer-contacts/${cid}/portal-invitations`,
    { email: user.email, language: "en" }
  );
  expect(r.status, r.text).toBe(201);
  const token = await tokenOf(r.body.invitation.id);
  const res = await fetch(`${h.baseUrl}/api/portal-invitations/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ token, email: user.email, acceptTerms: true }),
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return (JSON.parse(text) as { portalAccountId: string }).portalAccountId;
}

describe("STEP5 portal product fixes", () => {
  it("[S5-P2] a partly paid invoice past its due date is overdue; due today is not; next due is never in the past", async () => {
    const supplier = await h.createTenant({ emailVerified: true, name: "Overdue Supplier" });
    const customer = await h.createTenant({ name: "Overdue Customer" });
    const cid = await contact(supplier, "Overdue Buyer");
    const partlyPaidPast = await invoice(supplier, cid, dubaiDate(-10));
    await pay(supplier, partlyPaidPast.id, 300);
    const unpaidPast = await invoice(supplier, cid, dubaiDate(-2), 500);
    const dueToday = await invoice(supplier, cid, dubaiDate(0), 700);
    const dueLater = await invoice(supplier, cid, dubaiDate(6), 900);
    await bind(supplier, cid, customer);

    const list = await customer.as.get("/api/client-portal/invoices");
    expect(list.status, list.text).toBe(200);
    const status = Object.fromEntries(list.body.map((i: any) => [i.id, i.paymentStatus]));
    expect(status[partlyPaidPast.id]).toBe("overdue");
    expect(status[unpaidPast.id]).toBe("overdue");
    expect(status[dueToday.id]).toBe("unpaid");
    expect(status[dueLater.id]).toBe("unpaid");
    const partly = list.body.find((i: any) => i.id === partlyPaidPast.id);
    expect(partly.amountPaid).toBe(300);
    expect(partly.amountDue).toBe(750);

    const dash = await customer.as.get("/api/client-portal/dashboard");
    expect(dash.body.invoices.overdue).toBe(2);
    const overdueAed = dash.body.overdueByCurrency.find((o: any) => o.currency === "AED");
    expect(overdueAed.count).toBe(2);
    // 1,050 - 300 on the partly paid one, 525 on the other: summed in fils.
    expect(overdueAed.fils).toBe(75000 + 52500);
    expect(dash.body.nextDue.id).toBe(dueToday.id);

    // The share-link list uses the same rule.
    const link = await supplier.as.post("/api/portal/generate-access", { contactId: cid });
    const shared = await h.anon.get(`/api/portal/${link.body.token}/invoices`);
    const sharedStatus = Object.fromEntries(shared.body.map((i: any) => [i.id, i.paymentStatus]));
    expect(sharedStatus[partlyPaidPast.id]).toBe("overdue");
    expect(sharedStatus[dueToday.id]).toBe("unpaid");
  });

  it("[S5-P7] a deactivated supplier never shows another supplier's data by itself; the customer picks an active one, and with none left gets a clear 403", async () => {
    const s1 = await h.createTenant({ emailVerified: true, name: "Fallback One" });
    const s2 = await h.createTenant({ emailVerified: true, name: "Fallback Two" });
    const customer = await h.createTenant({ name: "Fallback Customer" });
    const c1 = await contact(s1, "Buyer One");
    const c2 = await contact(s2, "Buyer Two");
    const inv1 = await invoice(s1, c1, dubaiDate(5));
    const inv2 = await invoice(s2, c2, dubaiDate(5), 2000);
    const acc1 = await bind(s1, c1, customer);
    const acc2 = await bind(s2, c2, customer);
    const withAccount = (id: string) => ({ headers: { "x-portal-account": id } });

    // Supplier two (the newest) is deactivated: its data is refused, whether selected or not...
    await h.sql(`UPDATE customer_contacts SET is_active = false WHERE id = $1`, [c2]);
    const unscoped = await customer.as.get("/api/client-portal/invoices");
    expect(unscoped.status).toBe(403);
    expect(unscoped.body.code).toBe("PORTAL_ACCESS_REVOKED");
    const dead = await customer.as.get("/api/client-portal/invoices", withAccount(acc2));
    expect(dead.status).toBe(403);
    // ...the chooser lists only the active supplier, and picking it works.
    const accounts = await customer.as.get("/api/client-portal/accounts");
    expect(accounts.body.map((a: any) => a.id)).toEqual([acc1]);
    const picked = await customer.as.get("/api/client-portal/invoices", withAccount(acc1));
    expect(picked.status, picked.text).toBe(200);
    expect(picked.body.map((i: any) => i.id)).toEqual([inv1.id]);

    // The other way round: supplier one is deactivated, supplier two is chosen explicitly.
    await h.sql(`UPDATE customer_contacts SET is_active = true WHERE id = $1`, [c2]);
    await h.sql(`UPDATE customer_contacts SET is_active = false WHERE id = $1`, [c1]);
    const viaTwo = await customer.as.get("/api/client-portal/invoices", withAccount(acc2));
    expect(viaTwo.body.map((i: any) => i.id)).toEqual([inv2.id]);

    // None left: a clear "removed" answer, not a dead end with data.
    await h.sql(`UPDATE customer_contacts SET is_active = false WHERE id = $1`, [c2]);
    const none = await customer.as.get("/api/client-portal/invoices", withAccount(acc2));
    expect(none.status).toBe(403);
    expect(none.body.code).toBe("PORTAL_ACCESS_REVOKED");
    expect((await customer.as.get("/api/client-portal/accounts")).body).toEqual([]);
  });

  it("[S5-P4] bulk invite without an email provider reports the invitations as queued, never as sent, and returns no links", async () => {
    const t = await h.createTenant({ emailVerified: true });
    const a = await contact(t, "Bulk Queue A");
    const b = await contact(t, "Bulk Queue B");
    const res = await t.as.post(`/api/companies/${t.company.id}/portal-invitations/bulk`, {
      contactIds: [a, b],
      language: "contact",
    });
    expect(res.status, res.text).toBe(200);
    for (const r of res.body.results) {
      expect(r.outcome).toBe("invited");
      expect(r.delivery).toBe("queued");
      expect(r.inviteUrl).toBeUndefined();
    }
    expect(res.text).not.toMatch(/[0-9a-f]{64}/);
  });

  it("[S5-P12] the join page data carries the personal note as plain text", async () => {
    const t = await h.createTenant({ emailVerified: true });
    const email = `note-${uniq()}@example.test`;
    const cid = await contact(t, "Note Buyer", { email });
    const r = await t.as.post(
      `/api/companies/${t.company.id}/customer-contacts/${cid}/portal-invitations`,
      { language: "en", message: "Welcome aboard\nSee you soon" }
    );
    expect(r.status, r.text).toBe(201);
    const view = await anonPost("/api/portal-invitations/lookup", {
      token: await tokenOf(r.body.invitation.id),
    });
    expect(view.status, view.text).toBe(200);
    expect(view.body.note).toBe("Welcome aboard\nSee you soon");
    const otherCid = await contact(t, "No note");
    const none = await t.as.post(
      `/api/companies/${t.company.id}/customer-contacts/${otherCid}/portal-invitations`,
      { language: "en" }
    );
    const view2 = await anonPost("/api/portal-invitations/lookup", {
      token: await tokenOf(none.body.invitation.id),
    });
    expect(view2.body.note).toBeNull();
  });

  it("[S5-P11] a portal customer can rename themselves, and only that", async () => {
    const supplier = await h.createTenant({ emailVerified: true, name: "Rename Supplier" });
    const customer = await h.createTenant({ name: "Rename Customer" });
    const stranger = await h.createTenant({ name: "Not A Customer" });
    const cid = await contact(supplier, "Rename Buyer");
    await bind(supplier, cid, customer);
    const ok = await customer.as.patch("/api/client-portal/profile", { name: "  Layla Haddad " });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.name).toBe("Layla Haddad");
    expect((await customer.as.get("/api/auth/me")).body.name).toBe("Layla Haddad");
    for (const bad of [
      { name: "" },
      { name: "x", email: "evil@example.test" },
      { name: "x", userType: "admin" },
      {},
    ]) {
      expect((await customer.as.patch("/api/client-portal/profile", bad)).status).toBe(400);
    }
    // A user with no portal binding cannot use it.
    expect((await stranger.as.patch("/api/client-portal/profile", { name: "Nope" })).status).toBe(
      403
    );
    // Anonymous is refused.
    expect([401, 403]).toContain(
      (await h.anon.patch("/api/client-portal/profile", { name: "Nope" })).status
    );
  });
});
