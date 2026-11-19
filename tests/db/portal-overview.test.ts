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
  };
}

describe("portal overview", () => {
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
