/**
 * Server-side plan enforcement (middleware/featureGate.ts).
 *
 * Contract:
 *  - BILLING_ENFORCEMENT=true: a company whose effective plan lacks a feature
 *    gets a structured 403, whatever the frontend claims.
 *  - Anything else (unset, "false", production with Stripe configured): gates
 *    NEVER block, but a request that WOULD have been blocked carries
 *    `X-Billing-Would-Block: <feature>` so the owner can see the impact before
 *    switching enforcement on. Turning on Stripe does not turn on enforcement.
 *  - Effective plan: paid subscription > unexpired trial > free; a company with
 *    no subscription row gets a trial lazily, counted from its creation date.
 *  - BILLING_GRANDFATHER_BEFORE keeps companies created before that date on the
 *    top plan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

type Sub = Record<string, any> | undefined;
const subscriptions: Record<string, Sub> = {};
const companies: Record<string, any> = {};
const created: Array<Record<string, any>> = [];

vi.mock("../../server/storage", () => ({
  storage: {
    getSubscription: vi.fn(async (companyId: string) => subscriptions[companyId] ?? undefined),
    getCompany: vi.fn(async (companyId: string) => companies[companyId] ?? undefined),
    createSubscription: vi.fn(async (data: Record<string, any>) => {
      created.push(data);
      subscriptions[data.companyId] = { id: `sub-${data.companyId}`, ...data };
      return subscriptions[data.companyId];
    }),
  },
}));

vi.mock("../../server/services/stripe.service", () => ({
  isStripeConfigured: () => true,
  subscriptionLimitFields: () => ({}),
}));

vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { requireFeature, requireTier } from "../../server/middleware/featureGate";

const DAY = 24 * 60 * 60 * 1000;
const OLD = new Date(Date.now() - 400 * DAY);
const RECENT = new Date(Date.now() - 2 * DAY);

function appWithGates() {
  const app = express();
  app.use(express.json());
  app.get("/api/companies/:companyId/quotes", requireFeature("quotes"), (_req, res) => res.json({ ok: true }));
  app.get("/api/companies/:companyId/payroll", requireTier("professional"), (_req, res) => res.json({ ok: true }));
  return app;
}

async function get(app: express.Express, path: string) {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    return {
      status: res.status,
      body: (await res.json().catch(() => ({}))) as any,
      wouldBlock: res.headers.get("x-billing-would-block"),
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const saved = { flag: process.env.BILLING_ENFORCEMENT, gf: process.env.BILLING_GRANDFATHER_BEFORE, env: process.env.NODE_ENV };

beforeEach(() => {
  for (const k of Object.keys(subscriptions)) delete subscriptions[k];
  for (const k of Object.keys(companies)) delete companies[k];
  created.length = 0;
  for (const id of ["co-free", "co-starter", "co-pro", "co-trial", "co-expired", "co-lazy-old", "co-lazy-new", "co-client"]) {
    companies[id] = { id, createdAt: OLD, companyType: "customer" };
  }
  companies["co-lazy-new"].createdAt = RECENT;
  companies["co-client"].companyType = "client";
  subscriptions["co-free"] = { planId: "free", status: "active" };
  subscriptions["co-starter"] = { planId: "starter", status: "active" };
  subscriptions["co-pro"] = { planId: "professional", status: "active" };
  subscriptions["co-trial"] = { planId: "professional", status: "trialing", trialEndsAt: new Date(Date.now() + 5 * DAY) };
  subscriptions["co-expired"] = { planId: "professional", status: "trialing", trialEndsAt: new Date(Date.now() - 1000) };
  delete process.env.BILLING_ENFORCEMENT;
  delete process.env.BILLING_GRANDFATHER_BEFORE;
});

afterEach(() => {
  for (const [k, v] of [["BILLING_ENFORCEMENT", saved.flag], ["BILLING_GRANDFATHER_BEFORE", saved.gf], ["NODE_ENV", saved.env]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("BILLING_ENFORCEMENT not 'true' (observe only)", () => {
  it("never blocks, but flags what would be blocked", async () => {
    const app = appWithGates();
    const free = await get(app, "/api/companies/co-free/quotes");
    expect(free.status).toBe(200);
    expect(free.wouldBlock).toBe("quotes");

    const expired = await get(app, "/api/companies/co-expired/quotes");
    expect(expired.status).toBe(200);
    expect(expired.wouldBlock).toBe("quotes");
  });

  it("sends no header when the company's plan includes the feature", async () => {
    const app = appWithGates();
    for (const co of ["co-starter", "co-pro", "co-trial"]) {
      const r = await get(app, `/api/companies/${co}/quotes`);
      expect(r.status).toBe(200);
      expect(r.wouldBlock).toBeNull();
    }
  });

  it("flags tier gates too", async () => {
    const r = await get(appWithGates(), "/api/companies/co-starter/payroll");
    expect(r.status).toBe(200);
    expect(r.wouldBlock).toBe("tier:professional");
  });

  it("stays observe-only in production even when Stripe is configured", async () => {
    process.env.NODE_ENV = "production";
    const r = await get(appWithGates(), "/api/companies/co-free/quotes");
    expect(r.status).toBe(200);
    expect(r.wouldBlock).toBe("quotes");
  });

  it("explicit BILLING_ENFORCEMENT=false is observe-only", async () => {
    process.env.BILLING_ENFORCEMENT = "false";
    expect((await get(appWithGates(), "/api/companies/co-free/quotes")).status).toBe(200);
  });
});

describe("lazy trial for companies without a subscription row", () => {
  it("a company created recently gets a trial counted from its creation date and passes", async () => {
    const r = await get(appWithGates(), "/api/companies/co-lazy-new/quotes");
    expect(r.status).toBe(200);
    expect(r.wouldBlock).toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ companyId: "co-lazy-new", status: "trialing", planId: "professional" });
    expect(created[0].trialEndsAt.getTime()).toBe(RECENT.getTime() + 14 * DAY);
  });

  it("an old company gets an already-expired trial, so it would be blocked", async () => {
    const r = await get(appWithGates(), "/api/companies/co-lazy-old/quotes");
    expect(r.wouldBlock).toBe("quotes");
    expect(created[0].trialEndsAt.getTime()).toBe(OLD.getTime() + 14 * DAY);
  });

  it("is idempotent across requests", async () => {
    const app = appWithGates();
    await get(app, "/api/companies/co-lazy-old/quotes");
    await get(app, "/api/companies/co-lazy-old/quotes");
    expect(created).toHaveLength(1);
  });
});

describe("BILLING_ENFORCEMENT=true", () => {
  beforeEach(() => {
    process.env.BILLING_ENFORCEMENT = "true";
  });

  it("blocks the free tier with a structured 403", async () => {
    const res = await get(appWithGates(), "/api/companies/co-free/quotes");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: "TIER_LOCKED",
      feature: "quotes",
      currentTier: "free",
      requiredTier: "starter",
    });
  });

  it("blocks an expired trial, admits an active trial", async () => {
    const app = appWithGates();
    expect((await get(app, "/api/companies/co-expired/quotes")).status).toBe(403);
    expect((await get(app, "/api/companies/co-trial/quotes")).status).toBe(200);
    expect((await get(app, "/api/companies/co-trial/payroll")).status).toBe(200);
  });

  it("requireTier blocks below the minimum tier and admits at/above it", async () => {
    const app = appWithGates();
    const starter = await get(app, "/api/companies/co-starter/payroll");
    expect(starter.status).toBe(403);
    expect(starter.body).toMatchObject({ code: "TIER_LOCKED", requiredTier: "professional" });
    expect((await get(app, "/api/companies/co-pro/payroll")).status).toBe(200);
  });

  it("firm-managed client companies are never gated", async () => {
    expect((await get(appWithGates(), "/api/companies/co-client/quotes")).status).toBe(200);
  });

  it("BILLING_GRANDFATHER_BEFORE keeps older companies on the top plan", async () => {
    process.env.BILLING_GRANDFATHER_BEFORE = new Date(Date.now() - 30 * DAY).toISOString();
    const app = appWithGates();
    // OLD (400 days ago) is before the cutoff: through, even on a free row.
    expect((await get(app, "/api/companies/co-free/quotes")).status).toBe(200);
    expect((await get(app, "/api/companies/co-free/payroll")).status).toBe(200);
    // A company created after the cutoff is not grandfathered.
    companies["co-free"].createdAt = RECENT;
    expect((await get(app, "/api/companies/co-free/quotes")).status).toBe(403);
  });
});
