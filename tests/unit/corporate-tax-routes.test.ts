import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  hasCompanyAccess: vi.fn(),
  updateCorporateTaxReturn: vi.fn(),
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", email: "user@example.com", isAdmin: false, userType: "customer" };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getCorporateTaxReturn: vi.fn(async () => ({
      id: "ct-1",
      companyId: "company-2",
      status: "draft",
    })),
    hasCompanyAccess: mocks.hasCompanyAccess,
    updateCorporateTaxReturn: mocks.updateCorporateTaxReturn,
    getCorporateTaxReturnsByCompanyId: vi.fn(async () => []),
    createCorporateTaxReturn: vi.fn(),
    getJournalEntriesByCompanyId: vi.fn(async () => []),
  },
}));

vi.mock("../../server/services/period-lock.service", () => ({
  assertPeriodNotLocked: vi.fn(async () => undefined),
}));

import { registerCorporateTaxRoutes } from "../../server/routes/corporate-tax.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerCorporateTaxRoutes(app);
  return app;
}

async function request(method: "GET" | "PATCH"): Promise<{ status: number; body: any }> {
  const server = appWithRoutes().listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const response = await fetch(`http://127.0.0.1:${addr.port}/api/corporate-tax/returns/ct-1`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "PATCH" ? JSON.stringify({ status: "filed" }) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("corporate tax return tenant access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not read a corporate tax return from an inaccessible company", async () => {
    mocks.hasCompanyAccess.mockResolvedValue(false);

    const response = await request("GET");

    expect(response.status).toBe(403);
    expect(mocks.hasCompanyAccess).toHaveBeenCalledWith("user-1", "company-2");
  });

  it("does not update a corporate tax return from an inaccessible company", async () => {
    mocks.hasCompanyAccess.mockResolvedValue(false);

    const response = await request("PATCH");

    expect(response.status).toBe(403);
    expect(mocks.updateCorporateTaxReturn).not.toHaveBeenCalled();
  });

  it("updates after company access is verified", async () => {
    mocks.hasCompanyAccess.mockResolvedValue(true);
    mocks.updateCorporateTaxReturn.mockResolvedValue({
      id: "ct-1",
      companyId: "company-2",
      status: "filed",
    });

    const response = await request("PATCH");

    expect(response.status).toBe(200);
    expect(mocks.updateCorporateTaxReturn).toHaveBeenCalledWith("ct-1", { status: "filed" });
  });
});
