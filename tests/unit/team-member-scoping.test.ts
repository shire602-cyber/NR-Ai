/**
 * Team-member routes must scope the :memberId to the :companyId in the URL.
 *
 * Before this guard, PUT/DELETE /api/companies/:companyId/team/:memberId only
 * checked that the caller owned :companyId and then mutated the membership row
 * by id alone — so an owner of company A could change or delete any
 * membership row in company B by supplying B's row id. This test wires the
 * real routes behind a membership-backed storage mock with two tenants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../../server/services/audit.service", () => ({
  recordAudit: vi.fn(async () => undefined),
}));
// Inject the principal from a header instead of verifying a JWT.
vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: req.headers["x-user"],
      email: `${req.headers["x-user"]}@x.co`,
      isAdmin: false,
      userType: "customer",
      firmRole: null,
    };
    next();
  },
}));

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";
const ROW_A_OWNER = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ROW_A_STAFF = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const ROW_B_OWNER = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROW_B_STAFF = "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

type Row = { id: string; companyId: string; userId: string; role: string };
let rows: Row[];

function seed(): Row[] {
  return [
    { id: ROW_A_OWNER, companyId: COMPANY_A, userId: "owner-a", role: "owner" },
    { id: ROW_A_STAFF, companyId: COMPANY_A, userId: "staff-a", role: "employee" },
    { id: ROW_B_OWNER, companyId: COMPANY_B, userId: "owner-b", role: "owner" },
    { id: ROW_B_STAFF, companyId: COMPANY_B, userId: "staff-b", role: "accountant" },
  ];
}

vi.mock("../../server/storage", () => ({
  storage: {
    getUserRole: vi.fn(async (companyId: string, userId: string) =>
      rows.find((r) => r.companyId === companyId && r.userId === userId)
    ),
    getCompanyUsersByCompanyId: vi.fn(async (companyId: string) =>
      rows.filter((r) => r.companyId === companyId)
    ),
    // Mirrors the real storage: scoped by (id, companyId).
    updateCompanyUser: vi.fn(async (id: string, companyId: string, data: Partial<Row>) => {
      const row = rows.find((r) => r.id === id && r.companyId === companyId);
      if (!row) return undefined;
      Object.assign(row, data);
      return row;
    }),
    deleteCompanyUser: vi.fn(async (id: string, companyId: string) => {
      const before = rows.length;
      rows = rows.filter((r) => !(r.id === id && r.companyId === companyId));
      return rows.length < before;
    }),
    hasCompanyAccess: vi.fn(),
    getCompanyUserWithUser: vi.fn(),
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    createCompanyUser: vi.fn(),
  },
}));

import { registerTeamRoutes } from "../../server/routes/team.routes";
import { storage } from "../../server/storage";

function buildApp() {
  const app = express();
  app.use(express.json());
  registerTeamRoutes(app);
  return app;
}

async function call(method: string, path: string, user: string, body?: unknown) {
  const server = buildApp().listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-user": user },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

beforeEach(() => {
  rows = seed();
});
afterEach(() => vi.clearAllMocks());

describe("team member routes are scoped to the company in the URL", () => {
  it("owner of A can change a role inside A", async () => {
    const res = await call("PUT", `/api/companies/${COMPANY_A}/team/${ROW_A_STAFF}`, "owner-a", {
      role: "accountant",
    });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("accountant");
    expect(rows.find((r) => r.id === ROW_A_STAFF)?.role).toBe("accountant");
  });

  it("owner of A CANNOT change a role in B by supplying B's row id (404, row untouched)", async () => {
    const res = await call("PUT", `/api/companies/${COMPANY_A}/team/${ROW_B_STAFF}`, "owner-a", {
      role: "owner",
    });
    expect(res.status).toBe(404);
    expect(rows.find((r) => r.id === ROW_B_STAFF)?.role).toBe("accountant");
    expect(storage.updateCompanyUser).not.toHaveBeenCalled();
  });

  it("owner of A CANNOT delete a member of B by supplying B's row id (404, row untouched)", async () => {
    const res = await call("DELETE", `/api/companies/${COMPANY_A}/team/${ROW_B_STAFF}`, "owner-a");
    expect(res.status).toBe(404);
    expect(rows.some((r) => r.id === ROW_B_STAFF)).toBe(true);
    expect(storage.deleteCompanyUser).not.toHaveBeenCalled();
  });

  it("a non-owner of A cannot mutate A's team (403)", async () => {
    const put = await call("PUT", `/api/companies/${COMPANY_A}/team/${ROW_A_OWNER}`, "staff-a", {
      role: "employee",
    });
    expect(put.status).toBe(403);
    const del = await call("DELETE", `/api/companies/${COMPANY_A}/team/${ROW_A_OWNER}`, "staff-a");
    expect(del.status).toBe(403);
    expect(rows.find((r) => r.id === ROW_A_OWNER)?.role).toBe("owner");
  });

  it("owner of B cannot act on A at all, even with A's row ids (403)", async () => {
    const res = await call("DELETE", `/api/companies/${COMPANY_A}/team/${ROW_A_STAFF}`, "owner-b");
    expect(res.status).toBe(403);
    expect(rows.some((r) => r.id === ROW_A_STAFF)).toBe(true);
  });

  it("owner of A can remove a member of A", async () => {
    const res = await call("DELETE", `/api/companies/${COMPANY_A}/team/${ROW_A_STAFF}`, "owner-a");
    expect(res.status).toBe(204);
    expect(rows.some((r) => r.id === ROW_A_STAFF)).toBe(false);
    expect(storage.deleteCompanyUser).toHaveBeenCalledWith(ROW_A_STAFF, COMPANY_A);
  });

  it("the last owner cannot be demoted or removed (422 LAST_OWNER)", async () => {
    const demote = await call("PUT", `/api/companies/${COMPANY_A}/team/${ROW_A_OWNER}`, "owner-a", {
      role: "employee",
    });
    expect(demote.status).toBe(422);
    expect(demote.body.code).toBe("LAST_OWNER");

    const remove = await call(
      "DELETE",
      `/api/companies/${COMPANY_A}/team/${ROW_A_OWNER}`,
      "owner-a"
    );
    expect(remove.status).toBe(422);
    expect(rows.find((r) => r.id === ROW_A_OWNER)?.role).toBe("owner");
  });

  it("rejects an unknown role value (400) and malformed ids (400)", async () => {
    const badRole = await call(
      "PUT",
      `/api/companies/${COMPANY_A}/team/${ROW_A_STAFF}`,
      "owner-a",
      {
        role: "superuser",
      }
    );
    expect(badRole.status).toBe(400);

    const badId = await call("PUT", `/api/companies/${COMPANY_A}/team/not-a-uuid`, "owner-a", {
      role: "employee",
    });
    expect(badId.status).toBe(400);
  });
});
