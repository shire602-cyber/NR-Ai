/**
 * S5 / WQ7 central plan gates fail closed: planFeaturePolicy, usageLimitPolicy, checkUsageLimit
 * and checkCompanyQuota with the plan lookup stubbed. With enforcement on:
 *   - a company inside its trial has the top plan's modules (TRIAL_LIMITS caps);
 *   - a company whose trial ended without a plan (or that has no subscription row and is older
 *     than the trial) is read-only: writes are 402 PLAN_REQUIRED, reads pass;
 *   - a paid plan lacking a module is 403 TIER_LOCKED on writes only;
 *   - NR-managed client books, admins and NR firm staff are exempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/services/stripe.service", () => ({ isStripeConfigured: () => false }));

const DAY = 86_400_000;
const ID = {
  trial: "11111111-1111-4111-8111-111111111111",
  expired: "22222222-2222-4222-8222-222222222222",
  norow: "33333333-3333-4333-8333-333333333333",
  starter: "44444444-4444-4444-8444-444444444444",
  pro: "55555555-5555-4555-8555-555555555555",
  client: "66666666-6666-4666-8666-666666666666",
  extended: "77777777-7777-4777-8777-777777777777",
};

interface Row {
  company_type: string;
  company_created_at: Date;
  plan_id: string | null;
  status: string | null;
  sub_created_at: Date | null;
  trial_ends_at: Date | null;
}
const companies: Record<string, Row> = {};
const counters = new Map<string, number>();
let caller: { isAdmin?: boolean; firmRole?: string | null } = {};

vi.mock("../../server/services/connectors/pq", () => ({
  pq: vi.fn(async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ");
    const out = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    if (sql.includes("FROM companies c LEFT JOIN LATERAL")) {
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
    if (sql.includes("FROM company_users")) return out([{ n: "50" }]);
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
  storage: { getCompaniesByUserId: vi.fn(async () => owned) },
}));

import {
  checkCompanyQuota,
  checkUsageLimit,
  companyEntitlement,
  companyPlanId,
  getAllPlanDefinitions,
  getTierFeatures,
  getTierLimits,
  planFeaturePolicy,
  usageLimitPolicy,
} from "../../server/middleware/featureGate";
import { PLAN_MONTHLY_PRICES, TRIAL_LIMITS, TOP_PLAN_ID } from "../../shared/plans";

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

const row = (plan: string | null, ageDays: number, extra: Partial<Row> = {}): Row => {
  const at = new Date(Date.now() - ageDays * DAY);
  return {
    company_type: "customer",
    company_created_at: at,
    plan_id: plan,
    status: plan ? "active" : null,
    sub_created_at: plan ? at : null,
    trial_ends_at: null,
    ...extra,
  };
};

const original = process.env.BILLING_ENFORCEMENT;
beforeEach(() => {
  process.env.BILLING_ENFORCEMENT = "true";
  for (const k of Object.keys(companies)) delete companies[k];
  companies[ID.trial] = row("free", 2);
  companies[ID.expired] = row("free", 30);
  companies[ID.norow] = row(null, 30);
  companies[ID.starter] = row("starter", 90);
  companies[ID.pro] = row("professional", 90);
  companies[ID.client] = { ...row(null, 90), company_type: "client" };
  companies[ID.extended] = row("free", 30, { trial_ends_at: new Date(Date.now() + 5 * DAY) });
  counters.clear();
  caller = {};
  owned.length = 0;
});
afterEach(() => {
  if (original === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = original;
});

describe("WQ7 entitlement resolution", () => {
  it("trial = top plan; expired and no-row = no plan; paid = its plan; client books = exempt", async () => {
    expect(await companyPlanId(ID.trial)).toBe(TOP_PLAN_ID);
    expect((await companyEntitlement(ID.trial))?.limits).toEqual(TRIAL_LIMITS);
    expect((await companyEntitlement(ID.expired))?.state).toBe("expired");
    expect(await companyPlanId(ID.expired)).toBe("free");
    expect((await companyEntitlement(ID.norow))?.state).toBe("expired");
    expect(await companyPlanId(ID.pro)).toBe("professional");
    expect(await companyPlanId(ID.client)).toBeNull();
    expect(await companyPlanId("not-a-uuid")).toBeNull();
    // An NR admin extended this trial (subscriptions.trial_ends_at).
    expect((await companyEntitlement(ID.extended))?.state).toBe("trial");
  });

  it("the public catalog has three paid plans, the live prices, yearly = 10 × monthly", () => {
    const cat = getAllPlanDefinitions();
    expect(cat.plans.map((p) => p.id)).toEqual(["starter", "professional", "enterprise"]);
    expect(cat.cycles).toEqual(["monthly", "yearly"]);
    for (const p of cat.plans) {
      expect(p.pricing.monthly).toBe(PLAN_MONTHLY_PRICES[p.id]);
      expect(p.pricing.yearly).toBe(PLAN_MONTHLY_PRICES[p.id] * 10);
      expect(p.limits.maxUsers).toBe(-1);
    }
    expect(PLAN_MONTHLY_PRICES).toEqual({ starter: 59, professional: 119, enterprise: 229 });
    expect(cat.trial).toMatchObject({ days: 14, planId: "enterprise", cardRequired: false });
    expect(getTierLimits("free").maxInvoicesPerMonth).toBe(0);
    expect(getTierFeatures("free").bookkeeping).toBe(false);
    expect(getTierFeatures("enterprise").webhooks).toBe(true);
  });
});

describe("WQ7 planFeaturePolicy", () => {
  it("a module outside the paid plan is 403 TIER_LOCKED on writes, with the upgrade hint", async () => {
    const r = await run(
      planFeaturePolicy,
      req("POST", `/api/companies/${ID.starter}/payroll-runs`)
    );
    expect(r.passed).toBe(false);
    expect(r.res.statusCode).toBe(403);
    expect(r.res.body).toMatchObject({
      code: "TIER_LOCKED",
      messageKey: "forms.serverErrors.TIER_LOCKED",
      feature: "payroll",
      currentTier: "starter",
      requiredTier: "professional",
      upgrade: { requiredPlan: "professional", url: "/subscription" },
    });
  });

  it("reads are never gated: the data stays visible", async () => {
    for (const id of [ID.starter, ID.expired, ID.norow]) {
      expect(
        (await run(planFeaturePolicy, req("GET", `/api/companies/${id}/payroll-runs`))).passed
      ).toBe(true);
    }
  });

  it("after the trial without a plan every bookkeeping write is 402 PLAN_REQUIRED (exports pass)", async () => {
    for (const path of ["invoices", "journal", "bills", "payroll-runs"]) {
      const r = await run(planFeaturePolicy, req("POST", `/api/companies/${ID.norow}/${path}`));
      expect(r.res.statusCode, path).toBe(402);
      expect(r.res.body.code).toBe("PLAN_REQUIRED");
    }
    expect(
      (await run(planFeaturePolicy, req("POST", `/api/companies/${ID.expired}/invoices/x/pdf`)))
        .passed
    ).toBe(true);
    expect(
      (await run(planFeaturePolicy, req("POST", `/api/companies/${ID.expired}/billing/checkout`)))
        .passed
    ).toBe(true);
  });

  it("trial, paid plans, client books, admins / firm staff and enforcement-off pass", async () => {
    expect(
      (await run(planFeaturePolicy, req("POST", `/api/companies/${ID.trial}/payroll-runs`))).passed
    ).toBe(true);
    expect(
      (await run(planFeaturePolicy, req("POST", `/api/companies/${ID.pro}/payroll-runs`))).passed
    ).toBe(true);
    expect(
      (await run(planFeaturePolicy, req("POST", `/api/companies/${ID.client}/payroll-runs`))).passed
    ).toBe(true);
    caller = { firmRole: "firm_admin" };
    expect(
      (await run(planFeaturePolicy, req("POST", `/api/companies/${ID.expired}/invoices`))).passed
    ).toBe(true);
    caller = {};
    process.env.BILLING_ENFORCEMENT = "false";
    expect(
      (await run(planFeaturePolicy, req("POST", `/api/companies/${ID.expired}/invoices`))).passed
    ).toBe(true);
  });
});

describe("WQ7 usage limits", () => {
  it("Starter's 200 invoices a month: the 201st is 402 USAGE_LIMIT_REACHED naming Professional", async () => {
    counters.set(`${ID.starter}:invoices`, 199);
    const ok = await run(usageLimitPolicy, req("POST", `/api/companies/${ID.starter}/invoices`));
    expect(ok.passed).toBe(true);
    ok.res.finish(201);
    const blocked = await run(
      usageLimitPolicy,
      req("POST", `/api/companies/${ID.starter}/invoices`)
    );
    expect(blocked.res.statusCode).toBe(402);
    expect(blocked.res.body).toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      limit: 200,
      currentTier: "starter",
      upgrade: { requiredPlan: "professional" },
    });
    // Professional has no invoice limit.
    counters.set(`${ID.pro}:invoices`, 5000);
    expect(
      (await run(usageLimitPolicy, req("POST", `/api/companies/${ID.pro}/invoices`))).passed
    ).toBe(true);
  });

  it("a failed create releases its reservation; seats are unlimited; off = metered only", async () => {
    const r = await run(usageLimitPolicy, req("POST", `/api/companies/${ID.starter}/receipts`));
    expect(counters.get(`${ID.starter}:receipts`)).toBe(1);
    r.res.finish(422);
    await new Promise((x) => setTimeout(x, 0));
    expect(counters.get(`${ID.starter}:receipts`)).toBe(0);
    // 50 members already: still no seat limit on any plan.
    const seats = await run(
      usageLimitPolicy,
      req("POST", `/api/companies/${ID.starter}/team/invite`)
    );
    expect(seats.passed).toBe(true);
    process.env.BILLING_ENFORCEMENT = "false";
    const metered = await run(
      usageLimitPolicy,
      req("POST", `/api/companies/${ID.starter}/receipts`)
    );
    expect(metered.passed).toBe(true);
    metered.res.finish(201);
    await new Promise((x) => setTimeout(x, 0));
    expect(counters.get(`${ID.starter}:receipts`)).toBe(1);
  });

  it("AI credits during the trial are capped at TRIAL_LIMITS; checkUsageLimit agrees", async () => {
    const mw = checkUsageLimit("aiCredits");
    counters.set(`${ID.trial}:ai_calls`, TRIAL_LIMITS.aiCreditsPerMonth - 1);
    expect((await run(mw, { params: { companyId: ID.trial }, body: {} })).passed).toBe(true);
    const blocked = await run(mw, { params: { companyId: ID.trial }, body: {} });
    expect(blocked.res.statusCode).toBe(402);
    expect(blocked.res.body.code).toBe("USAGE_LIMIT_REACHED");
    const expired = await run(mw, { params: { companyId: ID.expired }, body: {} });
    expect(expired.res.statusCode).toBe(402);
    expect(expired.res.body.code).toBe("PLAN_REQUIRED");
    const client = await run(mw, { params: { companyId: ID.client }, body: {} });
    expect(client.passed).toBe(true);
  });

  it("checkCompanyQuota caps company creation by the best owned plan", async () => {
    owned.push({ id: ID.starter });
    const blocked = await run(checkCompanyQuota(), { user: { id: "u" } });
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.res.body).toMatchObject({
      code: "COMPANY_LIMIT_REACHED",
      details: { planId: "starter", limit: 1, current: 1 },
      upgrade: { requiredPlan: "professional" },
    });
    owned.push({ id: ID.pro });
    expect((await run(checkCompanyQuota(), { user: { id: "u" } })).passed).toBe(true);
    expect((await run(checkCompanyQuota(), { user: { id: "u", isAdmin: true } })).passed).toBe(
      true
    );
    // Only expired companies: no new trials by creating more companies.
    owned.length = 0;
    owned.push({ id: ID.expired });
    expect((await run(checkCompanyQuota(), { user: { id: "u" } })).res.statusCode).toBe(403);
  });
});
