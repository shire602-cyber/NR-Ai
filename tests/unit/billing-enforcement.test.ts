/**
 * Server-side plan enforcement (middleware/featureGate.ts).
 *
 * The launch-gate acceptance from the plan: once BILLING_ENFORCEMENT=true, a
 * free/unpaid plan cannot reach paid endpoints no matter what the frontend
 * claims — the 403 comes from the server. Until the flag is set, gates fail
 * open by design (no dead paywalls while Stripe is pending approval).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const subscriptions: Record<string, { planId: string } | undefined> = {};

vi.mock("../../server/storage", () => ({
  storage: {
    getSubscription: vi.fn(async (companyId: string) => subscriptions[companyId] ?? null),
  },
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
  app.get("/api/companies/:companyId/quotes", requireFeature("quotes"), (_req, res) =>
    res.json({ ok: true })
  );
  app.get("/api/companies/:companyId/payroll", requireTier("professional"), (_req, res) =>
    res.json({ ok: true })
  );
  return app;
}

async function get(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const originalFlag = process.env.BILLING_ENFORCEMENT;

beforeEach(() => {
  subscriptions["co-free"] = { planId: "free" };
  subscriptions["co-starter"] = { planId: "starter" };
  subscriptions["co-pro"] = { planId: "professional" };
});

afterEach(() => {
  if (originalFlag === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = originalFlag;
});

describe("BILLING_ENFORCEMENT off (non-production default)", () => {
  it("fails open — free tier reaches gated endpoints", async () => {
    delete process.env.BILLING_ENFORCEMENT;
    const app = appWithGates();
    expect((await get(app, "/api/companies/co-free/quotes")).status).toBe(200);
    expect((await get(app, "/api/companies/co-free/payroll")).status).toBe(200);
  });
});

describe("production defaults", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    __resetBillingEnforcementCacheForTests();
  });

  afterEach(() => {
    stripeConfigured = false;
    __resetBillingEnforcementCacheForTests();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("auto-ENFORCES in production once Stripe is configured (no flag set)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BILLING_ENFORCEMENT;
    stripeConfigured = true;
    const app = appWithGates();
    const res = await get(app, "/api/companies/co-free/quotes");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TIER_LOCKED");
  });

  it("fails open in production while Stripe is NOT configured (no dead paywalls)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BILLING_ENFORCEMENT;
    stripeConfigured = false;
    const app = appWithGates();
    expect((await get(app, "/api/companies/co-free/quotes")).status).toBe(200);
  });

  it("explicit BILLING_ENFORCEMENT=false overrides even with Stripe configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.BILLING_ENFORCEMENT = "false";
    stripeConfigured = true;
    const app = appWithGates();
    expect((await get(app, "/api/companies/co-free/quotes")).status).toBe(200);
  });

  it("explicit BILLING_ENFORCEMENT=true enforces even without Stripe", async () => {
    process.env.NODE_ENV = "production";
    process.env.BILLING_ENFORCEMENT = "true";
    stripeConfigured = false;
    const app = appWithGates();
    expect((await get(app, "/api/companies/co-free/quotes")).status).toBe(403);
  });
});

describe("BILLING_ENFORCEMENT=true", () => {
  beforeEach(() => {
    process.env.BILLING_ENFORCEMENT = "true";
  });

  it("blocks the free tier on a feature-gated endpoint with a structured 403", async () => {
    const app = appWithGates();
    const res = await get(app, "/api/companies/co-free/quotes");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TIER_LOCKED");
    expect(res.body.feature).toBe("quotes");
    expect(res.body.currentTier).toBe("free");
    expect(res.body.requiredTier).toBe("starter");
  });

  it("admits a plan that includes the feature", async () => {
    const app = appWithGates();
    expect((await get(app, "/api/companies/co-starter/quotes")).status).toBe(200);
  });

  it("requireTier blocks below the minimum tier and admits at/above it", async () => {
    const app = appWithGates();
    const starter = await get(app, "/api/companies/co-starter/payroll");
    expect(starter.status).toBe(403);
    expect(starter.body.code).toBe("TIER_LOCKED");
    expect(starter.body.requiredTier).toBe("professional");

    expect((await get(app, "/api/companies/co-pro/payroll")).status).toBe(200);
  });

  it("frontend state cannot help — the block is server-side per company", async () => {
    // Same request shape a tampered client would send; only the company's
    // actual subscription row decides.
    const app = appWithGates();
    const blocked = await get(app, "/api/companies/co-free/quotes");
    const allowed = await get(app, "/api/companies/co-starter/quotes");
    expect(blocked.status).toBe(403);
    expect(allowed.status).toBe(200);
  });
});
