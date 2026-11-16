/**
 * S5 central plan gates fail closed (W5-B FAIL-OPEN): planFeaturePolicy, usageLimitPolicy,
 * checkUsageLimit and checkCompanyQuota with the plan lookup stubbed. With enforcement on, a
 * company without a subscription row is gated as Free; NR-managed client books are exempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/services/stripe.service", () => ({ isStripeConfigured: () => false }));

const companies: Record<string, { company_type: string; plan_id: string | null }> = {};
const counters = new Map<string, number>();
let caller: { isAdmin?: boolean; firmRole?: string | null } = {};

vi.mock("../../server/services/connectors/pq", () => ({
  pq: vi.fn(async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ");
    const out = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    if (sql.includes("FROM companies c WHERE c.id = $1")) {
      const c = companies[String(params[0])];
      return out(c ? [c] : []);
    }
    if (sql.includes("INSERT INTO usage_counters AS u")) {
      const key = `${params[0]}:${params[2]}`;
      const n = counters.get(key) ?? 0;
      if (n >= Number(params[3])) return out([]);
      counters.set(key, n + 1);
      return out([{ count: n + 1 }]);
    }
    if (sql.includes("INSERT INTO usage_counters")) {
      const key = `${params[0]}:${params[2]}`;
      counters.set(key, Math.max(0, (counters.get(key) ?? 0) + Number(params[3])));
      return out([]);
    }
    if (sql.includes("SELECT count FROM usage_counters")) {
      return out([{ count: counters.get(`${params[0]}:${params[2]}`) ?? 0 }]);
    }
    if (sql.includes("FROM company_users")) return out([{ n: "5" }]);
    return out([]);
  }),
}));

vi.mock("../../server/middleware/companyRolePolicy", () => ({
  resolveRequestCompany: vi.fn(async (_req: unknown, path: string) => {
    const m = path.match(/companies\/([^/]+)/);
    return m ? m[1] : null;
  }),
}));

vi.mock("../../server/middleware/auth", () => ({
  authenticateRequest: vi.fn(async () => ({ user: { id: "u", ...caller } })),
}));

const owned: Array<{ id: string }> = [];
vi.mock("../../server/storage", () => ({
  storage: {
    getCompaniesByUserId: vi.fn(async () => owned),
    getSubscription: vi.fn(async (id: string) =>
      companies[id]?.plan_id ? { planId: companies[id].plan_id } : undefined
    ),
    getCompany: vi.fn(async (id: string) =>
      companies[id] ? { id, companyType: companies[id].company_type } : undefined
    ),
  },
}));

import {
  centrallyGatedFeatures,
  checkCompanyQuota,
  checkUsageLimit,
  companyPlanId,
  getAllPlanDefinitions,
  getTierFeatures,
  getTierLimits,
  matchGateRule,
  planFeaturePolicy,
  PLAN_FEATURE_RULES,
  usageLimitPolicy,
  usagePeriod,
  USAGE_LIMIT_RULES,
} from "../../server/middleware/featureGate";

type Res = {
  statusCode: number;
  body: any;
  handlers: Array<() => void>;
  status(n: number): Res;
  json(b: unknown): Res;
  on(ev: string, fn: () => void): void;
  finish(code: number): void;
};
function mkRes(): Res {
  const r: Res = {
    statusCode: 200,
    body: null,
    handlers: [],
    status(n) {
      r.statusCode = n;
      return r;
    },
    json(b) {
      r.body = b;
      return r;
    },
    on(_ev, fn) {
      r.handlers.push(fn);
    },
    finish(code) {
      r.statusCode = code;
      r.handlers.forEach((h) => h());
    },
  };
  return r;
}
const req = (method: string, url: string, extra: Record<string, unknown> = {}) =>
  ({ method, originalUrl: url, path: url, params: {}, body: {}, ...extra }) as never;

async function run(mw: any, r: unknown) {
  const res = mkRes();
  let nexted: unknown = "no";
  await mw(r, res, (e?: unknown) => {
    nexted = e;
  });
  return { res, passed: nexted === undefined, error: nexted };
}

const original = process.env.BILLING_ENFORCEMENT;
beforeEach(() => {
  process.env.BILLING_ENFORCEMENT = "true";
  for (const k of Object.keys(companies)) delete companies[k];
  companies["free-co"] = { company_type: "customer", plan_id: "free" };
  companies["norow-co"] = { company_type: "customer", plan_id: null };
  companies["pro-co"] = { company_type: "customer", plan_id: "professional" };
  companies["client-co"] = { company_type: "client", plan_id: null };
  counters.clear();
  caller = {};
  owned.length = 0;
});
afterEach(() => {
  if (original === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = original;
});

describe("S5 plan resolution", () => {
  it("[S5-1] missing row = free; client books and unknown companies = not gated (null)", async () => {
    expect(await companyPlanId("free-co")).toBe("free");
    expect(await companyPlanId("norow-co")).toBe("free");
    expect(await companyPlanId("pro-co")).toBe("professional");
    expect(await companyPlanId("client-co")).toBeNull();
    expect(await companyPlanId("ghost")).toBeNull();
  });

  it("plan definitions, limits and the rule tables are consistent", () => {
    const defs = getAllPlanDefinitions();
    expect(defs.map((d) => d.id)).toEqual(["free", "starter", "professional", "enterprise"]);
    expect(defs[0].pricing.monthly).toBe(0);
    expect(getTierLimits("nope")).toEqual(getTierLimits("free"));
    expect(getTierFeatures("enterprise").webhooks).toBe(true);
    expect(centrallyGatedFeatures()).toEqual(expect.arrayContaining(["payroll", "webhooks"]));
    expect(usagePeriod(new Date("2026-01-31T21:00:00Z"))).toBe("2026-02");
    expect(matchGateRule(PLAN_FEATURE_RULES, "GET", "/api/companies/x/payroll/runs")?.feature).toBe(
      "payroll"
    );
    expect(matchGateRule(PLAN_FEATURE_RULES, "GET", "/api/webhooks/stripe")).toBeNull();
    expect(
      matchGateRule(PLAN_FEATURE_RULES, "POST", "/api/companies/x/invoices", {
        body: { currency: "USD" },
      } as never)?.feature
    ).toBe("multiCurrency");
    expect(
      matchGateRule(PLAN_FEATURE_RULES, "POST", "/api/companies/x/invoices", { body: {} } as never)
    ).toBeNull();
    expect(matchGateRule(USAGE_LIMIT_RULES, "POST", "/api/companies/x/receipts")?.metric).toBe(
      "receipts"
    );
  });
});

describe("S5 planFeaturePolicy fails closed", () => {
  it("[S5-1] a company with no subscription row is 403 TIER_LOCKED on a paid feature", async () => {
    const r = await run(planFeaturePolicy, req("GET", "/api/companies/norow-co/payroll/runs"));
    expect(r.passed).toBe(false);
    expect(r.res.statusCode).toBe(403);
    expect(r.res.body).toMatchObject({
      code: "TIER_LOCKED",
      currentTier: "free",
      requiredTier: "professional",
    });
  });

  it("paid plans, client books, admins/firm staff, ungated paths and enforcement-off pass", async () => {
    expect(
      (await run(planFeaturePolicy, req("GET", "/api/companies/pro-co/payroll/runs"))).passed
    ).toBe(true);
    expect(
      (await run(planFeaturePolicy, req("GET", "/api/companies/client-co/payroll/runs"))).passed
    ).toBe(true);
    expect(
      (await run(planFeaturePolicy, req("GET", "/api/companies/free-co/invoices"))).passed
    ).toBe(true);
    caller = { firmRole: "firm_admin" };
    expect(
      (await run(planFeaturePolicy, req("GET", "/api/companies/free-co/payroll/runs"))).passed
    ).toBe(true);
    caller = {};
    process.env.BILLING_ENFORCEMENT = "false";
    expect(
      (await run(planFeaturePolicy, req("GET", "/api/companies/free-co/payroll/runs"))).passed
    ).toBe(true);
  });
});

describe("S5 usage limits fail closed", () => {
  it("[S5-1] a no-row company is metered against the Free quota (402 after 20 invoices)", async () => {
    for (let i = 0; i < 20; i++) {
      const r = await run(usageLimitPolicy, req("POST", "/api/companies/norow-co/invoices"));
      expect(r.passed).toBe(true);
      r.res.finish(201);
    }
    const blocked = await run(usageLimitPolicy, req("POST", "/api/companies/norow-co/invoices"));
    expect(blocked.res.statusCode).toBe(402);
    expect(blocked.res.body).toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      limit: 20,
      currentTier: "free",
    });
  });

  it("a failed create releases its reservation; seats are a live count; off = metered only", async () => {
    const r = await run(usageLimitPolicy, req("POST", "/api/companies/free-co/receipts"));
    expect(counters.get("free-co:receipts")).toBe(1);
    r.res.finish(422);
    await new Promise((x) => setTimeout(x, 0));
    expect(counters.get("free-co:receipts")).toBe(0);
    const seats = await run(usageLimitPolicy, req("POST", "/api/companies/free-co/team/invite"));
    expect(seats.res.statusCode).toBe(402);
    process.env.BILLING_ENFORCEMENT = "false";
    const metered = await run(usageLimitPolicy, req("POST", "/api/companies/free-co/receipts"));
    expect(metered.passed).toBe(true);
    metered.res.finish(201);
    await new Promise((x) => setTimeout(x, 0));
    expect(counters.get("free-co:receipts")).toBe(1);
  });

  it("checkUsageLimit (route level) also treats a no-row company as Free", async () => {
    const mw = checkUsageLimit("aiCredits");
    for (let i = 0; i < 10; i++) {
      const r = await run(mw, { params: { companyId: "norow-co" }, body: {} });
      expect(r.passed).toBe(true);
    }
    const blocked = await run(mw, { params: { companyId: "norow-co" }, body: {} });
    expect(blocked.res.statusCode).toBe(402);
    const client = await run(mw, { params: { companyId: "client-co" }, body: {} });
    expect(client.passed).toBe(true);
  });

  it("checkCompanyQuota caps company creation by the best owned plan", async () => {
    owned.push({ id: "free-co" });
    const blocked = await run(checkCompanyQuota(), { user: { id: "u" } });
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.res.body.code).toBe("COMPANY_LIMIT_REACHED");
    owned.push({ id: "pro-co" });
    expect((await run(checkCompanyQuota(), { user: { id: "u" } })).passed).toBe(true);
    expect((await run(checkCompanyQuota(), { user: { id: "u", isAdmin: true } })).passed).toBe(
      true
    );
  });
});
