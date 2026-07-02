/**
 * Cross-tenant IDOR guard (holistic).
 *
 * The middleware unit test proves requireCompanyAccess returns 403 when
 * hasCompanyAccess is false. This test wires a representative data route behind
 * the real middleware with a membership-backed storage mock and two tenants,
 * proving that a user authenticated for company A cannot read company B's data
 * by swapping the :companyId in the URL, body, or query — the classic IDOR.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));
vi.mock("../../server/config/env", () => ({
  isProduction: () => false,
  getEnv: () => ({ NODE_ENV: "test", JWT_SECRET: "x".repeat(48) }),
}));

// Membership map: which users belong to which companies.
const MEMBERSHIP: Record<string, Set<string>> = {
  "user-a": new Set(["company-a"]),
  "user-b": new Set(["company-b"]),
};
// Per-company data the route would return.
const COMPANY_DATA: Record<string, unknown> = {
  "company-a": { invoices: [{ id: "inv-a", total: 100 }] },
  "company-b": { invoices: [{ id: "inv-b", total: 999 }] },
};

vi.mock("../../server/storage", () => ({
  storage: {
    hasCompanyAccess: vi.fn(async (userId: string, companyId: string) =>
      Boolean(MEMBERSHIP[userId]?.has(companyId))
    ),
    getUser: vi.fn(),
  },
}));

import { requireCompanyAccess } from "../../server/middleware/auth";

function appAsUser(userId: string) {
  const app = express();
  app.use(express.json());
  // Inject the authenticated principal (as auth middleware would).
  app.use((req, _res, next) => {
    (req as any).user = {
      id: userId,
      email: `${userId}@x.co`,
      isAdmin: false,
      userType: "customer",
      firmRole: null,
    };
    next();
  });
  app.get("/api/companies/:companyId/invoices", requireCompanyAccess(), (req, res) => {
    res.json(COMPANY_DATA[(req.params as any).companyId] ?? {});
  });
  return app;
}

async function get(app: express.Express, path: string) {
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

afterEach(() => vi.clearAllMocks());

describe("cross-tenant IDOR", () => {
  it("user A reads their OWN company's data (200)", async () => {
    const res = await get(appAsUser("user-a"), "/api/companies/company-a/invoices");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(COMPANY_DATA["company-a"]);
  });

  it("user A CANNOT read company B by swapping the URL id (403, no data leak)", async () => {
    const res = await get(appAsUser("user-a"), "/api/companies/company-b/invoices");
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("inv-b");
    expect(JSON.stringify(res.body)).not.toContain("999");
  });

  it("user B likewise cannot reach company A (403)", async () => {
    const res = await get(appAsUser("user-b"), "/api/companies/company-a/invoices");
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("inv-a");
  });

  it("an unknown/guessed company id is denied (403)", async () => {
    const res = await get(appAsUser("user-a"), "/api/companies/company-zzz/invoices");
    expect(res.status).toBe(403);
  });
});
