/**
 * Server-side plan enforcement (middleware/featureGate.ts), route-level gates.
 *
 * WQ7 (owner decision 2026-11-18: plan limits are enforced now): production enforces with no flag,
 * whether or not online checkout (Stripe) is configured; BILLING_ENFORCEMENT=false switches it off,
 * and development / test fail open unless the flag says otherwise. Gates refuse writes only — a
 * module outside the plan stays readable — and the block is server-side per company.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const DAY = 86_400_000;
const ID = {
  expired: "a1111111-1111-4111-8111-111111111111",
  norow: "a2222222-2222-4222-8222-222222222222",
  starter: "a3333333-3333-4333-8333-333333333333",
  pro: "a4444444-4444-4444-8444-444444444444",
  client: "a5555555-5555-4555-8555-555555555555",
};
const rows: Record<string, Record<string, unknown>> = {};

vi.mock("../../server/services/connectors/pq", () => ({
  pq: vi.fn(async (_text: string, params: unknown[] = []) => {
    const r = rows[String(params[0])];
    return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
  }),
}));
vi.mock("../../server/middleware/auth", () => ({
  authenticateRequest: vi.fn(async () => ({ user: { id: "u" } })),
}));
vi.mock("../../server/middleware/companyRolePolicy", () => ({
  resolveRequestCompany: vi.fn(async () => null),
}));

let stripeConfigured = false;
vi.mock("../../server/services/stripe.service", () => ({
  isStripeConfigured: () => stripeConfigured,
}));

import {
  requireFeature,
  requireTier,
  __resetBillingEnforcementCacheForTests,
} from "../../server/middleware/featureGate";

function appWithGates() {
  const app = express();
  app.use(express.json());
  const ok = (_req: express.Request, res: express.Response) => res.json({ ok: true });
  app.get("/api/companies/:companyId/purchase-orders", requireFeature("purchaseOrders"), ok);
  app.post("/api/companies/:companyId/purchase-orders", requireFeature("purchaseOrders"), ok);
  app.post("/api/companies/:companyId/payroll", requireTier("professional"), ok);
  return app;
}

async function call(
  app: express.Express,
  method: "GET" | "POST",
  path: string
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const originalFlag = process.env.BILLING_ENFORCEMENT;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  const at = (days: number) => new Date(Date.now() - days * DAY);
  const row = (plan: string | null, type = "customer") => ({
    company_type: type,
    company_created_at: at(60),
    plan_id: plan,
    status: plan ? "active" : null,
    sub_created_at: plan ? at(60) : null,
    trial_ends_at: null,
  });
  rows[ID.expired] = row("free");
  rows[ID.norow] = row(null);
  rows[ID.starter] = row("starter");
  rows[ID.pro] = row("professional");
  rows[ID.client] = row(null, "client");
});

afterEach(() => {
  stripeConfigured = false;
  __resetBillingEnforcementCacheForTests();
  if (originalFlag === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = originalFlag;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("enforcement posture", () => {
  it("development / test without a flag fail open", async () => {
    delete process.env.BILLING_ENFORCEMENT;
    const app = appWithGates();
    expect((await call(app, "POST", `/api/companies/${ID.starter}/purchase-orders`)).status).toBe(
      200
    );
  });

  it("production ENFORCES with no flag even while Stripe is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BILLING_ENFORCEMENT;
    stripeConfigured = false;
    const res = await call(appWithGates(), "POST", `/api/companies/${ID.starter}/purchase-orders`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TIER_LOCKED");
  });

  it("explicit BILLING_ENFORCEMENT=false switches it off, even in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.BILLING_ENFORCEMENT = "false";
    stripeConfigured = true;
    expect(
      (await call(appWithGates(), "POST", `/api/companies/${ID.starter}/purchase-orders`)).status
    ).toBe(200);
  });
});

describe("BILLING_ENFORCEMENT=true", () => {
  beforeEach(() => {
    process.env.BILLING_ENFORCEMENT = "true";
  });

  it("a write outside the plan is a structured 403 with the upgrade hint; the read passes", async () => {
    const app = appWithGates();
    const res = await call(app, "POST", `/api/companies/${ID.starter}/purchase-orders`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: "TIER_LOCKED",
      feature: "purchaseOrders",
      currentTier: "starter",
      requiredTier: "professional",
      upgrade: { requiredPlan: "professional", url: "/subscription" },
    });
    expect((await call(app, "GET", `/api/companies/${ID.starter}/purchase-orders`)).status).toBe(
      200
    );
  });

  it("[S5] fails closed: no subscription row past the trial = read-only (402 PLAN_REQUIRED)", async () => {
    const app = appWithGates();
    const res = await call(app, "POST", `/api/companies/${ID.norow}/purchase-orders`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PLAN_REQUIRED");
    expect((await call(app, "GET", `/api/companies/${ID.norow}/purchase-orders`)).status).toBe(200);
    expect((await call(app, "POST", `/api/companies/${ID.expired}/payroll`)).status).toBe(402);
  });

  it("[S5] NR-managed client books (company_type client) are firm-billed and not gated", async () => {
    const app = appWithGates();
    expect((await call(app, "POST", `/api/companies/${ID.client}/purchase-orders`)).status).toBe(
      200
    );
    expect((await call(app, "POST", `/api/companies/${ID.client}/payroll`)).status).toBe(200);
  });

  it("requireTier blocks below the minimum plan and admits at/above it", async () => {
    const app = appWithGates();
    const starter = await call(app, "POST", `/api/companies/${ID.starter}/payroll`);
    expect(starter.status).toBe(403);
    expect(starter.body).toMatchObject({ code: "TIER_LOCKED", requiredTier: "professional" });
    expect((await call(app, "POST", `/api/companies/${ID.pro}/payroll`)).status).toBe(200);
  });

  it("frontend state cannot help — only the company's subscription row decides", async () => {
    const app = appWithGates();
    expect((await call(app, "POST", `/api/companies/${ID.starter}/purchase-orders`)).status).toBe(
      403
    );
    expect((await call(app, "POST", `/api/companies/${ID.pro}/purchase-orders`)).status).toBe(200);
  });
});
