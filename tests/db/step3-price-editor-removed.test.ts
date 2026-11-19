/**
 * STEP3: the unused admin price editor is gone. The /api/admin/plans routes are 404, the
 * subscription_plans / user_subscriptions tables are dropped, plan prices still come only from
 * shared/plans.ts, and the NR admin set-plan route (what the company dialog uses) keeps working.
 */
import { describe, expect, it } from "vitest";
import { PLAN_MONTHLY_PRICES, planPrice, publicPlanCatalog } from "../../shared/plans";
import { useHarness } from "./harness";

const h = useHarness();
const ID = "00000000-0000-4000-8000-000000000001";

type PlanRow = { id: string; pricing: { monthly: number; yearly: number } };
const prices = (body: { plans: PlanRow[] }) =>
  Object.fromEntries(body.plans.map((p) => [p.id, [p.pricing.monthly, p.pricing.yearly]]));

describe("STEP3 price editor removed", () => {
  it("STEP3 GET/POST /api/admin/plans and PUT/DELETE /api/admin/plans/:id are 404 ROUTE_NOT_FOUND", async () => {
    const admin = await h.createTenant({ name: "S3Admin", isAdmin: true });
    const body = { name: "Pro", priceMonthly: 99 };
    const res = [
      await admin.as.get(`/api/admin/plans`),
      await admin.as.post(`/api/admin/plans`, body),
      await admin.as.put(`/api/admin/plans/${ID}`, body),
      await admin.as.delete(`/api/admin/plans/${ID}`),
    ];
    for (const r of res) {
      expect(r.status, r.text).toBe(404);
      expect(r.body.code).toBe("ROUTE_NOT_FOUND");
    }
    // The admin gate still runs first: a non-admin gets 403, not a route-existence hint.
    const t = await h.createTenant({ name: "S3Plain" });
    expect((await t.as.get(`/api/admin/plans`)).status).toBe(403);
    expect((await t.as.post(`/api/admin/plans`, body)).status).toBe(403);
  });

  it("STEP3 subscription_plans and user_subscriptions no longer exist", async () => {
    const rows = await h.sql<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('subscription_plans', 'user_subscriptions')`
    );
    expect(rows).toEqual([]);
  });

  it("STEP3 GET /api/billing/plans still serves 59/119/229 and 590/1190/2290 AED from the plan module", async () => {
    const r = await h.anon.get("/api/billing/plans");
    expect(r.status, r.text).toBe(200);
    expect(r.body).toEqual(JSON.parse(JSON.stringify(publicPlanCatalog())));
    expect(r.body.currency).toBe("AED");
    expect(PLAN_MONTHLY_PRICES).toEqual({ starter: 59, professional: 119, enterprise: 229 });
    expect(prices(r.body)).toEqual({
      starter: [planPrice("starter", "monthly"), planPrice("starter", "yearly")],
      professional: [planPrice("professional", "monthly"), planPrice("professional", "yearly")],
      enterprise: [planPrice("enterprise", "monthly"), planPrice("enterprise", "yearly")],
    });
    expect(prices(r.body)).toEqual({
      starter: [59, 590],
      professional: [119, 1190],
      enterprise: [229, 2290],
    });
  });

  it("STEP3 PUT /api/admin/companies/:id/plan still works for an admin, with an audit row", async () => {
    const t = await h.createTenant({ name: "S3Target" });
    const admin = await h.createTenant({ name: "S3PlanAdmin", isAdmin: true });
    const url = `/api/admin/companies/${t.company.id}/plan`;
    expect((await t.as.put(url, { planId: "starter" })).status).toBe(403);
    expect((await admin.as.put(url, { planId: "starter", seats: 3 })).status).toBe(400);
    const set = await admin.as.put(url, { planId: "starter", billingCycle: "yearly" });
    expect(set.status, set.text).toBe(200);
    expect(set.body).toMatchObject({ state: "active", planId: "starter" });
    const audit = await h.sql(
      `SELECT action FROM audit_logs WHERE company_id = $1 AND action = 'billing.plan_set'`,
      [t.company.id]
    );
    expect(audit).toHaveLength(1);
  });

  it("STEP3 an admin setting named like a price changes no price", async () => {
    const admin = await h.createTenant({ name: "S3Settings", isAdmin: true });
    const put = await admin.as.put(`/api/admin/settings`, {
      key: "pricing.starter.monthly",
      value: "1",
    });
    expect(put.status, put.text).toBe(200);
    const r = await h.anon.get("/api/billing/plans");
    expect(prices(r.body).starter).toEqual([59, 590]);
  });

  it("STEP3 /api/admin/users returns each user's own live company count", async () => {
    const admin = await h.createTenant({ name: "S3Count", isAdmin: true });
    const solo = await h.createSecondTenant({ name: "S3Solo" });
    const multi = await h.createTenant({ name: "S3Multi" });
    // Give `multi` a second membership in the solo company.
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')`,
      [solo.company.id, multi.user.id]
    );
    const r = await admin.as.get(`/api/admin/users`);
    expect(r.status, r.text).toBe(200);
    const by = Object.fromEntries(
      (r.body as { id: string; companyCount: number }[]).map((u) => [u.id, u.companyCount])
    );
    expect(by[solo.user.id]).toBe(1);
    expect(by[multi.user.id]).toBe(2);
    expect(by[admin.user.id]).toBe(1);
    expect(r.body[0]).not.toHaveProperty("passwordHash");
  });
});
