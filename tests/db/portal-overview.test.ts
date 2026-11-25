/**
 * /api/portal/:token/overview: the customer portal's first screen in one request (info +
 * invoices), with the same answers as the separate routes and the same token rules.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const DATE = new Date().toISOString().slice(0, 10);

async function portalFor(t: Tenant, name: string) {
  const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name,
    email: `${name.toLowerCase().replace(/\W/g, "")}@example.test`,
    emirate: "dubai",
    preferredLanguage: "ar",
  });
  expect(c.status, c.text).toBeLessThan(300);
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId: c.body.id,
    date: DATE,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
  });
  expect(inv.status, inv.text).toBe(200);
  await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  const link = await t.as.post(`/api/portal/generate-access`, { contactId: c.body.id });
  expect(link.status, link.text).toBe(200);
  return {
    token: link.body.token as string,
    contactId: c.body.id as string,
    number: inv.body.number as string,
    invoiceId: inv.body.id as string,
  };
}

describe("portal overview", () => {
  it("honors the selected supplier on statement downloads and rejects a revoked selection", async () => {
    const first = await h.createTenant({ emailVerified: true });
    const second = await h.createSecondTenant();
    const customer = await h.createSecondTenant();
    const a = await portalFor(first, "First Customer");
    const b = await portalFor(second, "Second Customer");
    const [older, newer] = await h.sql(
      `INSERT INTO customer_portal_accounts (user_id, company_id, contact_id, created_at)
       VALUES ($1, $2, $3, now() - interval '1 day'), ($1, $4, $5, now()) RETURNING id`,
      [customer.user.id, first.company.id, a.contactId, second.company.id, b.contactId]
    );
    const url = "/api/client-portal/statements";
    const unscoped = await customer.as.get(url);
    expect(unscoped.body.accountId).toBe(newer.id);
    const headers = { "X-Portal-Account": older.id };
    const selected = await customer.as.get(url, { headers });
    expect(selected.body).toMatchObject({ accountId: older.id, party: { id: a.contactId } });
    for (const [binding, owner, data] of [
      [older, first, a],
      [newer, second, b],
    ] as const) {
      const scoped = { headers: { "X-Portal-Account": binding.id } };
      expect((await customer.as.get("/api/client-portal/company", scoped)).body).toMatchObject({
        id: owner.company.id,
        portalAccountId: binding.id,
      });
      expect((await customer.as.get("/api/client-portal/invoices", scoped)).body).toMatchObject([
        { id: data.invoiceId },
      ]);
      expect((await customer.as.get("/api/client-portal/dashboard", scoped)).body).toMatchObject({
        recentInvoices: [{ id: data.invoiceId }],
      });
      expect((await customer.as.get(url, scoped)).body).toMatchObject({
        accountId: binding.id,
        party: { id: data.contactId },
      });
    }
    const pdf = await customer.as.get(`${url}?format=pdf`, { headers });
    expect(pdf.status, pdf.text).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    const messageUrl = "/api/client-portal/messages";
    const sent = await customer.as.post(
      messageUrl,
      { content: "For the displayed supplier" },
      { headers }
    );
    expect(sent.status, sent.text).toBe(201);
    expect(sent.body).toMatchObject({ content: "For the displayed supplier", fromMe: true });
    const [stored] = await h.sql("SELECT company_id, contact_id FROM messages WHERE id = $1", [
      sent.body.id,
    ]);
    expect(stored).toMatchObject({ company_id: first.company.id, contact_id: a.contactId });

    const upload = (accountId: string) => {
      const form = new FormData();
      form.append("name", "Scoped document");
      form.append("file", new Blob(["first supplier only"], { type: "text/plain" }), "scope.txt");
      return fetch(h.baseUrl + "/api/client-portal/documents", {
        method: "POST",
        body: form,
        headers: { Authorization: `Bearer ${customer.token}`, "X-Portal-Account": accountId },
      });
    };
    const doc = await upload(older.id);
    expect(doc.status).toBe(201);
    expect(await doc.json()).toMatchObject({ companyId: first.company.id, contactId: a.contactId });

    await h.sql(`UPDATE customer_portal_accounts SET revoked_at = now() WHERE id = $1`, [older.id]);
    const removed = await customer.as.get(`${url}?format=pdf`, { headers });
    expect(removed.status).toBe(403);
    expect(removed.body.code).toBe("PORTAL_ACCESS_REVOKED");
    const rejected = await customer.as.post(
      messageUrl,
      { content: "Should not reach supplier B" },
      { headers }
    );
    expect(rejected.status).toBe(403);
    expect(
      (await customer.as.post(messageUrl, { content: "Missing pinned supplier" })).status
    ).toBe(403);
    expect((await upload(older.id)).status).toBe(403);
    const secondScope = { headers: { "X-Portal-Account": newer.id } };
    expect((await customer.as.get(messageUrl, secondScope)).body).toEqual([]);
    expect((await customer.as.get("/api/client-portal/documents", secondScope)).body).toEqual([]);
  });

  it("returns info and invoices that equal the separate routes, with no caching", async () => {
    const t = await h.createTenant();
    const p = await portalFor(t, "Gulf Retail");
    const overview = await h.anon.get(`/api/portal/${p.token}/overview`);
    expect(overview.status, overview.text).toBe(200);
    const info = await h.anon.get(`/api/portal/${p.token}/info`);
    const invoices = await h.anon.get(`/api/portal/${p.token}/invoices`);
    expect(overview.body.info).toEqual(info.body);
    expect(overview.body.invoices).toEqual(invoices.body);
    expect(overview.body.info.preferredLanguage).toBe("ar");
    expect(overview.body.invoices.map((i: { number: string }) => i.number)).toEqual([p.number]);
    expect(overview.headers.get("cache-control")).toContain("no-store");
  });

  it("a token only ever shows its own customer's invoices, and bad tokens are 404", async () => {
    const t = await h.createTenant();
    const a = await portalFor(t, "Alpha Co");
    const b = await portalFor(t, "Beta Co");
    const ra = await h.anon.get(`/api/portal/${a.token}/overview`);
    const rb = await h.anon.get(`/api/portal/${b.token}/overview`);
    expect(ra.body.invoices).toHaveLength(1);
    expect(ra.body.invoices[0].number).toBe(a.number);
    expect(rb.body.invoices[0].number).toBe(b.number);
    expect(ra.body.info.customerName).toBe("Alpha Co");
    const bad = await h.anon.get(`/api/portal/${"0".repeat(64)}/overview`);
    expect(bad.status).toBe(404);
    expect(bad.body.code).toBe("PORTAL_LINK_INVALID");
  });

  it("a revoked link answers 410 with PORTAL_LINK_REVOKED, an expired one PORTAL_LINK_EXPIRED", async () => {
    const t = await h.createTenant();
    const p = await portalFor(t, "Gamma Co");
    await h.sql(
      `UPDATE portal_access_tokens SET expires_at = now() - interval '1 day' WHERE contact_id = $1`,
      [p.contactId]
    );
    const expired = await h.anon.get(`/api/portal/${p.token}/overview`);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe("PORTAL_LINK_EXPIRED");
    const q = await portalFor(t, "Delta Co");
    const revoke = await t.as.post(`/api/portal/revoke-access`, { contactId: q.contactId });
    expect(revoke.status, revoke.text).toBe(200);
    const revoked = await h.anon.get(`/api/portal/${q.token}/overview`);
    expect(revoked.status).toBe(410);
    expect(revoked.body.code).toBe("PORTAL_LINK_REVOKED");
  });
});
