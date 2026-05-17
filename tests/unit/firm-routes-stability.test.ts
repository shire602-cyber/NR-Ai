import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  user: {
    id: "firm-owner-1",
    email: "owner@nra.test",
    isAdmin: true,
    userType: "admin",
    firmRole: "firm_owner",
  } as any,
  getCompany: vi.fn(),
  updateCompany: vi.fn(),
  createActivityLog: vi.fn(),
  getAllUsers: vi.fn(),
  getUser: vi.fn(),
  companyHasAccounts: vi.fn(),
  createBulkAccounts: vi.fn(),
  getCompanyByName: vi.fn(),
  createCompany: vi.fn(),
  selectResults: [] as any[][],
  insertCalls: [] as any[],
  insertValues: [] as any[],
  deleteCalls: [] as any[],
}));

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";

function makeSelectChain() {
  const result = mocks.selectResults.shift() ?? [];
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(result)),
    orderBy: vi.fn(() => chain),
    groupBy: vi.fn(() => Promise.resolve(result)),
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function makeInsertChain(table: unknown) {
  mocks.insertCalls.push(table);
  const chain: any = {
    values: vi.fn((values: unknown) => {
      mocks.insertValues.push(values);
      return chain;
    }),
    onConflictDoUpdate: vi.fn(() => Promise.resolve()),
    onConflictDoNothing: vi.fn(() => Promise.resolve()),
  };
  return chain;
}

function makeDeleteChain(table: unknown) {
  mocks.deleteCalls.push(table);
  return {
    where: vi.fn(() => Promise.resolve()),
  };
}

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = mocks.user;
    next();
  },
}));

vi.mock("../../server/middleware/rbac", () => ({
  requireFirmRole: () => (req: any, res: any, next: any) => {
    if (!req.user?.firmRole) {
      return res.status(403).json({ message: "NRA firm staff access required" });
    }
    next();
  },
  getAccessibleCompanyIds: vi.fn(async (_userId: string, firmRole: string) =>
    firmRole === "firm_owner" ? null : []
  ),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getCompany: mocks.getCompany,
    updateCompany: mocks.updateCompany,
    createActivityLog: mocks.createActivityLog,
    getAllUsers: mocks.getAllUsers,
    getUser: mocks.getUser,
    companyHasAccounts: mocks.companyHasAccounts,
    createBulkAccounts: mocks.createBulkAccounts,
    getCompanyByName: mocks.getCompanyByName,
    createCompany: mocks.createCompany,
  },
}));

vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn((table: unknown) => makeInsertChain(table)),
    delete: vi.fn((table: unknown) => makeDeleteChain(table)),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { registerFirmRoutes } from "../../server/routes/firm.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerFirmRoutes(app);
  return app;
}

async function request(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const server = appWithRoutes().listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const response = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("firm client route stability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.firmRole = "firm_owner";
    mocks.selectResults = [];
    mocks.insertCalls = [];
    mocks.insertValues = [];
    mocks.deleteCalls = [];
    mocks.createActivityLog.mockResolvedValue({});
    mocks.companyHasAccounts.mockResolvedValue(false);
  });

  it("rejects non-client updates through the firm client endpoint", async () => {
    mocks.getCompany.mockResolvedValue({
      id: "customer-company",
      name: "Customer Company",
      companyType: "customer",
      deletedAt: null,
    });

    const response = await request("PUT", "/api/firm/clients/customer-company", {
      name: "Should Not Update",
    });

    expect(response.status).toBe(400);
    expect(mocks.updateCompany).not.toHaveBeenCalled();
  });

  it("rejects archived client updates through the firm client endpoint", async () => {
    mocks.getCompany.mockResolvedValue({
      id: "archived-client",
      name: "Archived Client",
      companyType: "client",
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const response = await request("PUT", "/api/firm/clients/archived-client", {
      name: "Should Not Update",
    });

    expect(response.status).toBe(400);
    expect(mocks.updateCompany).not.toHaveBeenCalled();
  });

  it("lists only users with a firm role in firm staff results", async () => {
    mocks.getAllUsers.mockResolvedValue([
      {
        id: "owner-1",
        name: "Owner",
        email: "owner@nra.test",
        isAdmin: true,
        firmRole: "firm_owner",
        passwordHash: "secret",
      },
      {
        id: "admin-1",
        name: "Admin",
        email: "admin@nra.test",
        isAdmin: true,
        firmRole: "firm_admin",
        passwordHash: "secret",
      },
      {
        id: "support-1",
        name: "Support",
        email: "support@nra.test",
        isAdmin: true,
        firmRole: null,
        passwordHash: "secret",
      },
    ]);
    mocks.selectResults = [[], []];

    const response = await request("GET", "/api/firm/staff");

    expect(response.status).toBe(200);
    expect(response.body.map((u: any) => u.email)).toEqual(["owner@nra.test", "admin@nra.test"]);
    expect(response.body.some((u: any) => "passwordHash" in u)).toBe(false);
  });

  it("assigns firm admins to both assignment stores", async () => {
    mocks.getCompany.mockResolvedValue({
      id: CLIENT_ID,
      name: "Client One",
      companyType: "client",
      deletedAt: null,
    });
    mocks.getUser.mockResolvedValue({
      id: ADMIN_ID,
      name: "Admin",
      email: "admin@nra.test",
      firmRole: "firm_admin",
    });

    const response = await request("POST", `/api/firm/clients/${CLIENT_ID}/assign-staff`, {
      staffUserId: ADMIN_ID,
      action: "assign",
      role: "accountant",
    });

    expect(response.status).toBe(200);
    expect(mocks.insertCalls).toHaveLength(2);
    expect(mocks.insertValues).toEqual([
      { companyId: CLIENT_ID, userId: ADMIN_ID, role: "accountant" },
      { companyId: CLIENT_ID, userId: ADMIN_ID, role: "accountant" },
    ]);
  });

  it("does not explicitly assign firm owners to client files", async () => {
    mocks.getCompany.mockResolvedValue({
      id: CLIENT_ID,
      name: "Client One",
      companyType: "client",
      deletedAt: null,
    });
    mocks.getUser.mockResolvedValue({
      id: OWNER_ID,
      name: "Owner",
      email: "owner@nra.test",
      firmRole: "firm_owner",
    });

    const response = await request("POST", `/api/firm/clients/${CLIENT_ID}/assign-staff`, {
      staffUserId: OWNER_ID,
      action: "assign",
      role: "accountant",
    });

    expect(response.status).toBe(400);
    expect(mocks.insertCalls).toHaveLength(0);
  });
});
