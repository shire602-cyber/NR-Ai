/**
 * checkUsageLimit (middleware/featureGate.ts): the monthly invoice / receipt caps in TIER_LIMITS.
 *
 *  - BILLING_ENFORCEMENT=true and the cap reached: 403 USAGE_LIMIT_REACHED with the limit in details.
 *  - BILLING_ENFORCEMENT not 'true': never blocks; flags `X-Billing-Would-Block: usage:<resource>`.
 *  - Unlimited plans, plans under their cap, callers without company access, and any failure while
 *    counting all let the request through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const subscriptions: Record<string, Record<string, any> | undefined> = {};
const companies: Record<string, any> = {};
const usage: Record<string, number> = {};
let countThrows = false;
let hasAccess = true;

vi.mock("../../server/storage", () => ({
  storage: {
    getSubscription: vi.fn(async (companyId: string) => subscriptions[companyId] ?? undefined),
    getCompany: vi.fn(async (companyId: string) => companies[companyId] ?? undefined),
    hasCompanyAccess: vi.fn(async () => hasAccess),
    createSubscription: vi.fn(),
  },
}));
vi.mock("../../server/services/stripe.service", () => ({
  isStripeConfigured: () => true,
  subscriptionLimitFields: () => ({}),
}));
vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../server/services/usage-counts.service", () => ({
  countMonthlyUsage: vi.fn(async (companyId: string, resource: string) => {
    if (countThrows) throw new Error("db down");
    return usage[`${companyId}:${resource}`] ?? 0;
  }),
}));

import { checkUsageLimit } from "../../server/middleware/featureGate";

const OLD = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

function appWithCaps() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: "u1" };
    next();
  });
  app.post("/api/companies/:companyId/invoices", checkUsageLimit("invoices"), (_req, res) => res.status(201).json({ ok: true }));
  app.post("/api/companies/:companyId/receipts", checkUsageLimit("receipts"), (_req, res) => res.status(201).json({ ok: true }));
  return app;
}

async function post(path: string) {
  const app = appWithCaps();
  const s = app.listen(0);
  try {
    const addr = s.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { method: "POST" });
    return {
      status: res.status,
      body: (await res.json().catch(() => ({}))) as any,
      wouldBlock: res.headers.get("x-billing-would-block"),
    };
  } finally {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}

const savedFlag = process.env.BILLING_ENFORCEMENT;

beforeEach(() => {
  for (const k of Object.keys(subscriptions)) delete subscriptions[k];
  for (const k of Object.keys(usage)) delete usage[k];
  for (const id of ["co-free", "co-starter", "co-pro"]) companies[id] = { id, createdAt: OLD, companyType: "customer" };
  subscriptions["co-free"] = { planId: "free", status: "active" };
  subscriptions["co-starter"] = { planId: "starter", status: "active" };
  subscriptions["co-pro"] = { planId: "professional", status: "active" };
  countThrows = false;
  hasAccess = true;
  process.env.BILLING_ENFORCEMENT = "true";
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.BILLING_ENFORCEMENT;
  else process.env.BILLING_ENFORCEMENT = savedFlag;
});

describe("checkUsageLimit with BILLING_ENFORCEMENT=true", () => {
  it("lets a free company create invoices below the cap (20 per month)", async () => {
    usage["co-free:invoices"] = 19;
    expect((await post("/api/companies/co-free/invoices")).status).toBe(201);
  });

  it("blocks the invoice that would exceed the cap with USAGE_LIMIT_REACHED and the limit in details", async () => {
    usage["co-free:invoices"] = 20;
    const r = await post("/api/companies/co-free/invoices");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("USAGE_LIMIT_REACHED");
    expect(r.body.details).toMatchObject({ resource: "invoices", limit: 20, currentUsage: 20, planId: "free" });
  });

  it("applies the receipt cap separately from the invoice cap", async () => {
    usage["co-free:invoices"] = 20;
    expect((await post("/api/companies/co-free/receipts")).status).toBe(201);
    usage["co-free:receipts"] = 20;
    const r = await post("/api/companies/co-free/receipts");
    expect(r.status).toBe(403);
    expect(r.body.details).toMatchObject({ resource: "receipts", limit: 20 });
  });

  it("uses the plan's own cap (starter 200) and leaves unlimited plans alone", async () => {
    usage["co-starter:invoices"] = 199;
    expect((await post("/api/companies/co-starter/invoices")).status).toBe(201);
    usage["co-starter:invoices"] = 200;
    const blocked = await post("/api/companies/co-starter/invoices");
    expect(blocked.status).toBe(403);
    expect(blocked.body.details.limit).toBe(200);

    usage["co-pro:invoices"] = 100000;
    expect((await post("/api/companies/co-pro/invoices")).status).toBe(201);
  });

  it("does not describe usage to a caller without access to the company", async () => {
    usage["co-free:invoices"] = 20;
    hasAccess = false;
    expect((await post("/api/companies/co-free/invoices")).status).toBe(201); // the route's own 403 follows
  });

  it("fails open when counting fails", async () => {
    countThrows = true;
    expect((await post("/api/companies/co-free/invoices")).status).toBe(201);
  });
});

describe("checkUsageLimit without BILLING_ENFORCEMENT", () => {
  it("never blocks, and flags the request that would have been blocked", async () => {
    delete process.env.BILLING_ENFORCEMENT;
    usage["co-free:invoices"] = 500;
    const r = await post("/api/companies/co-free/invoices");
    expect(r.status).toBe(201);
    expect(r.wouldBlock).toBe("usage:invoices");
  });

  it("sends no flag below the cap", async () => {
    delete process.env.BILLING_ENFORCEMENT;
    const r = await post("/api/companies/co-free/invoices");
    expect(r.status).toBe(201);
    expect(r.wouldBlock).toBeNull();
  });
});
