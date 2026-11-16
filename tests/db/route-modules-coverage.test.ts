/**
 * R20-14: HTTP-level coverage for the ten route modules that had no test referencing them:
 * admin-health, ai-gl, compliance-dashboard, firm-analytics, firm-bulk, firm-comms,
 * firm-growth, firm-value-ops, portal.public and referrals. Each block covers
 * authentication, authorization / tenant isolation, validation and one happy path.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();

let cache: { customer: Tenant; other: Tenant; firm: Tenant; admin: Tenant } | null = null;
async function actors() {
  if (cache) return cache;
  cache = {
    customer: await h.createTenant({ name: "CovCustomer" }),
    other: await h.createSecondTenant({ name: "CovOther" }),
    firm: await h.createTenant({ name: "CovFirm", firmRole: "firm_owner" }),
    admin: await h.createTenant({ name: "CovAdmin", isAdmin: true }),
  };
  return cache;
}

describe("admin-health.routes [R20-14]", () => {
  it("[R20-14] admin-health: anonymous 401, non-admin 403, admin gets schema health", async () => {
    const { customer, admin } = await actors();
    expect((await h.anon.get("/api/admin/schema-health")).status).toBe(401);
    expect((await customer.as.get("/api/admin/schema-health")).status).toBe(403);
    const ok = await admin.as.get("/api/admin/schema-health");
    expect(ok.status, ok.text).toBe(200);
    const sso = await admin.as.get("/api/admin/auth/sso-status");
    expect(sso.status).toBe(200);
    expect(sso.body.saml.status).toBe("requires_external");
  });
});

describe("ai-gl.routes [R20-14]", () => {
  it("[R20-14] ai-gl: auth, tenant isolation, threshold validation and settings round trip", async () => {
    const { customer, other } = await actors();
    const base = `/api/companies/${customer.company.id}/ai-gl`;
    expect((await h.anon.get(`${base}/queue`)).status).toBe(401);
    expect([403, 404]).toContain((await other.as.get(`${base}/queue`)).status);
    expect([403, 404]).toContain(
      (await other.as.put(`${base}/settings`, { confidenceThreshold: 0.9 })).status
    );
    const bad = await customer.as.put(`${base}/settings`, { confidenceThreshold: 2 });
    expect(bad.status).toBe(400);
    const queue = await customer.as.get(`${base}/queue`);
    expect(queue.status, queue.text).toBe(200);
    const missing = await customer.as.post(
      `${base}/queue/00000000-0000-4000-8000-000000000000/correct`,
      {}
    );
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.status).toBeLessThan(500);
  });
});

describe("ai-gl.routes settings defect [R20-14]", () => {
  // Fixed in the W5 integration: the upsert now writes the NOT NULL `category` column.
  it("[R20-14] ai-gl: a valid confidence threshold is saved", async () => {
    const { customer } = await actors();
    const ok = await customer.as.put(`/api/companies/${customer.company.id}/ai-gl/settings`, {
      confidenceThreshold: 0.85,
    });
    expect(ok.status, ok.text).toBe(200);
  });
});

describe("compliance-dashboard.routes [R20-14]", () => {
  it("[R20-14] compliance-dashboard: auth, tenant isolation, overview for the owner", async () => {
    const { customer, other } = await actors();
    const url = `/api/companies/${customer.company.id}/compliance/overview`;
    expect((await h.anon.get(url)).status).toBe(401);
    expect([403, 404]).toContain((await other.as.get(url)).status);
    const bad = await customer.as.get(`/api/companies/not-a-uuid/compliance/overview`);
    expect([400, 403, 404]).toContain(bad.status);
    const ok = await customer.as.get(url);
    expect(ok.status, ok.text).toBe(200);
    expect(typeof ok.body).toBe("object");
  });
});

describe("firm-analytics.routes [R20-14]", () => {
  it("[R20-14] firm-analytics: customers are refused, lead validation, firm owner reads analytics", async () => {
    const { customer, firm } = await actors();
    expect((await h.anon.get("/api/firm/analytics/revenue")).status).toBe(401);
    expect((await customer.as.get("/api/firm/analytics/revenue")).status).toBe(403);
    const bad = await firm.as.post("/api/firm/pipeline/leads", { userId: "nope" });
    expect(bad.status).toBe(400);
    const ok = await firm.as.get("/api/firm/analytics/client-health-summary");
    expect(ok.status, ok.text).toBe(200);
    const pipeline = await firm.as.get("/api/firm/pipeline");
    expect(pipeline.status, pipeline.text).toBe(200);
  });
});

describe("firm-bulk.routes [R20-14]", () => {
  it("[R20-14] firm-bulk: customers are refused, bad bulk body rejected, firm owner reads import status", async () => {
    const { customer, firm } = await actors();
    expect((await h.anon.get("/api/firm/bulk/bank-import-status")).status).toBe(401);
    expect((await customer.as.get("/api/firm/bulk/bank-import-status")).status).toBe(403);
    expect((await customer.as.post("/api/firm/bulk/vat-queue", {})).status).toBe(403);
    const bad = await firm.as.post("/api/firm/bulk/invoices", { companyIds: "nope" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const queue = await firm.as.post("/api/firm/bulk/vat-queue", {});
    expect(queue.status, queue.text).toBe(200);
    const status = await firm.as.get("/api/firm/bulk/bank-import-status");
    expect(status.status, status.text).toBe(200);
  });
});

describe("firm-comms.routes [R20-14]", () => {
  it("[R20-14] firm-comms: customers are refused, template validation, firm owner lists the log", async () => {
    const { customer, firm } = await actors();
    expect((await h.anon.get("/api/firm/comms/log")).status).toBe(401);
    expect((await customer.as.get("/api/firm/comms/log")).status).toBe(403);
    const bad = await firm.as.post("/api/firm/comms/templates", { name: "", channel: "fax" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const ok = await firm.as.get("/api/firm/comms/log");
    expect(ok.status, ok.text).toBe(200);
    const templates = await firm.as.get("/api/firm/comms/templates");
    expect(templates.status, templates.text).toBe(200);
  });
});

describe("firm-growth.routes [R20-14]", () => {
  it("[R20-14] firm-growth: customers are refused, invalid id 400, firm owner lists opportunities", async () => {
    const { customer, firm } = await actors();
    expect((await h.anon.get("/api/firm/growth-opportunities")).status).toBe(401);
    expect((await customer.as.get("/api/firm/growth-opportunities")).status).toBe(403);
    const bad = await firm.as.patch("/api/firm/growth-opportunities/not-an-id", {});
    expect(bad.status).toBe(400);
    const ok = await firm.as.get("/api/firm/growth-opportunities");
    expect(ok.status, ok.text).toBe(200);
  });
});

describe("firm-value-ops.routes [R20-14]", () => {
  it("[R20-14] firm-value-ops: customers are refused, invalid company id 400, firm owner reads the review queue", async () => {
    const { customer, firm } = await actors();
    expect((await h.anon.get("/api/firm/value-ops/review-queue")).status).toBe(401);
    expect((await customer.as.get("/api/firm/value-ops/review-queue")).status).toBe(403);
    const bad = await firm.as.get("/api/firm/value-ops/clients/not-a-uuid/audit-pack");
    expect(bad.status).toBe(400);
    const ok = await firm.as.get("/api/firm/value-ops/review-queue");
    expect(ok.status, ok.text).toBe(200);
  });
});

describe("portal.public.routes [R20-14]", () => {
  it("[R20-14] portal.public: staff link issuance needs auth + ownership; bad tokens are refused", async () => {
    const { customer, other } = await actors();
    const [contact] = await h.sql(
      `INSERT INTO customer_contacts (company_id, name, email)
       VALUES ($1, 'Portal Buyer', 'buyer@portal.test') RETURNING id`,
      [customer.company.id]
    );
    expect(
      (await h.anon.post("/api/portal/generate-access", { contactId: contact.id })).status
    ).toBe(401);
    const leak = await other.as.post("/api/portal/generate-access", { contactId: contact.id });
    expect([403, 404]).toContain(leak.status);
    const bad = await customer.as.post("/api/portal/generate-access", {
      contactId: contact.id,
      extra: 1,
    });
    expect(bad.status).toBe(400);
    const ok = await customer.as.post("/api/portal/generate-access", { contactId: contact.id });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.shownOnce).toBe(true);
    const info = await h.anon.get(`/api/portal/${ok.body.token}/info`);
    expect(info.status, info.text).toBe(200);
    const forged = await h.anon.get(`/api/portal/${"f".repeat(64)}/info`);
    expect([401, 403, 404]).toContain(forged.status);
  });
});

describe("referrals.routes [R20-14]", () => {
  it("[R20-14] referrals: auth required, unknown code refused, own code issued once", async () => {
    const { customer } = await actors();
    expect((await h.anon.get("/api/referral/my-code")).status).toBe(401);
    const first = await customer.as.get("/api/referral/my-code");
    expect(first.status, first.text).toBe(200);
    const again = await customer.as.get("/api/referral/my-code");
    expect(again.body.code ?? again.body.referralCode).toBe(
      first.body.code ?? first.body.referralCode
    );
    const unknown = await customer.as.get("/api/referral/validate/NOPE-NOPE");
    expect([400, 404]).toContain(unknown.status);
    const stats = await customer.as.get("/api/referral/stats");
    expect(stats.status).toBe(200);
  });
});
