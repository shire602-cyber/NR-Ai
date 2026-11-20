/**
 * W5-B e-commerce adapters (R19-03, R19-08, R19-14) through an injectable HTTP
 * client fed with recorded, API-shaped fixtures (tests/fixtures/ecommerce/).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "ecommerce", name), "utf8"));

type Handler = (
  url: string,
  init: { headers: Record<string, string> }
) => {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

async function mockPlatform(handler: Handler | "offline") {
  const { setEcommerceHttpClient } = await import("../../server/services/ecommerce");
  const { PlatformUnreachableError } = await import("../../server/services/ecommerce/http");
  const calls: string[] = [];
  setEcommerceHttpClient(async (url, init) => {
    calls.push(url);
    if (handler === "offline") throw new PlatformUnreachableError("getaddrinfo ENOTFOUND");
    const r = handler(url, init);
    return { status: r.status, body: r.body, headers: r.headers ?? {} };
  });
  return calls;
}

const shopify: Handler = (url, init) => {
  if (init.headers["X-Shopify-Access-Token"] !== "shpat_valid")
    return { status: 401, body: { errors: "[API] Invalid API key or access token" } };
  if (url.endsWith("/shop.json"))
    return {
      status: 200,
      body: { shop: { name: "Oud House", myshopify_domain: "oud-house.myshopify.com" } },
    };
  if (url.includes("/orders.json")) return { status: 200, body: fixture("shopify-orders.json") };
  return { status: 404, body: {} };
};

async function connectShopify(t: Tenant, token: string) {
  return t.as.post(`/api/integrations/ecommerce/connect`, {
    companyId: t.company.id,
    platform: "shopify",
    shopDomain: "oud-house",
    accessToken: token,
  });
}

afterEach(async () => {
  const { setEcommerceHttpClient } = await import("../../server/services/ecommerce");
  setEcommerceHttpClient(null);
});

describe("W5-B Shopify adapter", () => {
  it("[R19-03] connecting with a junk token is refused (Shopify answers 401) and nothing is stored", async () => {
    await mockPlatform(shopify);
    const t = await h.createTenant();
    const r = await connectShopify(t, "fake");
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_CREDENTIALS");
    const rows = await h.sql(
      `SELECT count(*)::int AS n FROM ecommerce_integrations WHERE company_id = $1`,
      [t.company.id]
    );
    expect(rows[0].n).toBe(0);
  });

  it("[R19-03] a valid token connects; sync imports orders as draft invoices exactly once and refunds as draft credit notes", async () => {
    const calls = await mockPlatform(shopify);
    const t = await h.createTenant();
    const c = await connectShopify(t, "shpat_valid");
    expect(c.status, c.text).toBe(201);
    expect(c.body).toMatchObject({
      connectionStatus: "connected",
      externalAccountName: "Oud House",
      hasAccessToken: true,
    });
    expect(JSON.stringify(c.body)).not.toContain("shpat_valid");
    const stored = await h.sql(`SELECT access_token FROM ecommerce_integrations WHERE id = $1`, [
      c.body.id,
    ]);
    expect(stored[0].access_token).toMatch(/^enc:v1:/);
    expect(calls[0]).toBe("https://oud-house.myshopify.com/admin/api/2024-07/shop.json");

    const s1 = await t.as.post(`/api/integrations/ecommerce/${c.body.id}/sync`);
    expect(s1.status, s1.text).toBe(200);
    expect(s1.body).toMatchObject({ status: "success", documents: 2, pending: 1 });
    const invs = await h.sql(
      `SELECT customer_name, status, total::text AS total, invoice_type FROM invoices WHERE company_id = $1 ORDER BY invoices.total DESC`,
      [t.company.id]
    );
    expect(invs).toEqual([
      { customer_name: "Layla Haddad", status: "draft", total: "210.00", invoice_type: "invoice" },
      {
        customer_name: "Shopify customer (#1002)",
        status: "draft",
        total: "52.50",
        invoice_type: "invoice",
      },
    ]);

    // Idempotent: a second sync imports nothing new.
    const s2 = await t.as.post(`/api/integrations/ecommerce/${c.body.id}/sync`);
    expect(s2.body).toMatchObject({ imported: 0, documents: 0 });
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM invoices WHERE company_id = $1`, [t.company.id])
      )[0].n
    ).toBe(2);

    // Once the order invoice is issued, the waiting refund becomes a draft credit note.
    const [inv] = await h.sql(`SELECT id FROM invoices WHERE company_id = $1 AND total = 210`, [
      t.company.id,
    ]);
    const issue = await t.as.patch(`/api/invoices/${inv.id}/status`, { status: "sent" });
    expect(issue.status, issue.text).toBe(200);
    const s3 = await t.as.post(`/api/integrations/ecommerce/${c.body.id}/sync`);
    expect(s3.status, s3.text).toBe(200);
    const cn = await h.sql(
      `SELECT status, total::text AS total, original_invoice_id FROM invoices WHERE company_id = $1 AND invoice_type = 'credit_note'`,
      [t.company.id]
    );
    expect(cn).toHaveLength(1);
    expect(cn[0]).toMatchObject({ status: "draft", original_invoice_id: inv.id });
    expect(Math.abs(Number(cn[0].total))).toBe(105);
  });

  it("[R19-03] with no outbound access connect fails with 503 and nothing reports connected", async () => {
    await mockPlatform("offline");
    const t = await h.createTenant();
    const r = await connectShopify(t, "shpat_valid");
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("PLATFORM_UNREACHABLE");
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM ecommerce_integrations WHERE company_id = $1`, [
          t.company.id,
        ])
      )[0].n
    ).toBe(0);
  });

  it("[R19-03] sync on an unconfigured (not connected) integration is 503 — never 'success'", async () => {
    const t = await h.createTenant();
    const [row] = await h.sql(
      `INSERT INTO ecommerce_integrations (company_id, platform, is_active, access_token, sync_status)
       VALUES ($1, 'shopify', true, 'fake', 'never') RETURNING id, connection_status`,
      [t.company.id]
    );
    expect(row.connection_status).toBe("not_connected");
    const r = await t.as.post(`/api/integrations/ecommerce/${row.id}/sync`);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("INTEGRATION_NOT_CONNECTED");
    await new Promise((res) => setTimeout(res, 2500)); // the old fake timer flipped to success after 2s
    const after = await h.sql(`SELECT sync_status FROM ecommerce_integrations WHERE id = $1`, [
      row.id,
    ]);
    expect(after[0].sync_status).toBe("never");
  });

  it("[R19-08] connecting and syncing need settings.company: a viewer or employee is refused", async () => {
    await mockPlatform(shopify);
    const viewer = await h.createTenant({ role: "employee" });
    const r = await connectShopify(viewer, "shpat_valid");
    expect(r.status).toBe(403);
    const owner = await h.createTenant();
    const c = await connectShopify(owner, "shpat_valid");
    const other = await h.createSecondTenant();
    const s = await other.as.post(`/api/integrations/ecommerce/${c.body.id}/sync`);
    expect([403, 404]).toContain(s.status);
  });
});

describe("W5-B Stripe payouts adapter", () => {
  it("[R19-14] verifies the key, imports charges/fees/payouts once as bank-style lines", async () => {
    await mockPlatform((url, init) => {
      if (init.headers.Authorization !== "Bearer rk_test_validkey123")
        return { status: 401, body: { error: { type: "invalid_request_error" } } };
      if (url.endsWith("/balance"))
        return { status: 200, body: { object: "balance", livemode: false } };
      if (url.includes("/balance_transactions"))
        return { status: 200, body: fixture("stripe-balance-transactions.json") };
      return { status: 404, body: {} };
    });
    const t = await h.createTenant();
    const bad = await t.as.post(`/api/integrations/ecommerce/connect`, {
      companyId: t.company.id,
      platform: "stripe_payouts",
      apiKey: "rk_test_wrongkey999",
    });
    expect(bad.status).toBe(400);
    const c = await t.as.post(`/api/integrations/ecommerce/connect`, {
      companyId: t.company.id,
      platform: "stripe_payouts",
      apiKey: "rk_test_validkey123",
    });
    expect(c.status, c.text).toBe(201);
    expect(c.body.externalAccountName).toBe("Stripe (test mode)");
    const s = await t.as.post(`/api/integrations/ecommerce/${c.body.id}/sync`);
    expect(s.status, s.text).toBe(200);
    const lines = await h.sql(
      `SELECT external_id, amount::text AS amount, import_source FROM bank_transactions WHERE company_id = $1 ORDER BY external_id`,
      [t.company.id]
    );
    expect(lines).toEqual([
      { external_id: "txn_1Charge", amount: "105.00", import_source: "stripe" },
      { external_id: "txn_1Charge:fee", amount: "-3.36", import_source: "stripe" },
      { external_id: "txn_1Payout", amount: "-101.64", import_source: "stripe" },
    ]);
    const again = await t.as.post(`/api/integrations/ecommerce/${c.body.id}/sync`);
    expect(again.body.imported).toBe(0);
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM bank_transactions WHERE company_id = $1`, [
          t.company.id,
        ])
      )[0].n
    ).toBe(3);
  });
});
